#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "net.h"
#include "protocol.h"
#include "device.h"
#include "tasks.h"
#include "log.h"

/* ===================================================================
 * WIFI - ket noi va reconnect co backoff
 * =================================================================== */

static uint32_t s_backoff_ms   = WIFI_RETRY_MIN_MS;
static uint32_t s_last_try_ms  = 0;
static bool     s_connecting   = false;
static char     s_ip[20]       = "0.0.0.0";
static uint32_t s_hold_until   = 0;        /* != 0: dang gia lap mat mang */

void wifi_setup(void) {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(false);
    WiFi.setSleep(false);          /* giam do tre nhan lenh, doi lai ton dien hon */
    s_last_try_ms = 0;
}

static uint16_t s_try = 0;

static void start_connect(void) {
    s_try++;
    applog("WIFI", "attempt %u: connecting to \"%s\"...", s_try, CFG_WIFI_SSID);
    WiFi.disconnect(true);
    WiFi.begin(CFG_WIFI_SSID, CFG_WIFI_PASS);
    s_connecting  = true;
    s_last_try_ms = millis();
}

void wifi_force_down(uint32_t ms) {
    s_hold_until = millis() + ms;
    WiFi.setAutoReconnect(false);          /* khong cho lop duoi tu noi lai */
    WiFi.disconnect(true);
    strncpy(s_ip, "0.0.0.0", sizeof(s_ip) - 1);
    s_connecting = false;
    applog("WIFI", "SIMULATED OUTAGE for %lu s - schedules keep running, results go to the outbox",
           (unsigned long)(ms / 1000));
}

void wifi_loop(void) {
    /* Dang trong khoang gia lap mat mang: khong lam gi ngoai dem gio. */
    if (s_hold_until) {
        if ((int32_t)(millis() - s_hold_until) < 0) {
            if (WiFi.status() == WL_CONNECTED) WiFi.disconnect(true);
            return;
        }
        s_hold_until = 0;
        WiFi.setAutoReconnect(true);
        s_backoff_ms  = WIFI_RETRY_MIN_MS;
        s_last_try_ms = 0;
        applog("WIFI", "simulated outage over, reconnecting");
    }

    if (WiFi.status() == WL_CONNECTED) {
        if (s_connecting) {
            s_connecting = false;
            s_backoff_ms = WIFI_RETRY_MIN_MS;      /* reset backoff khi thanh cong */
            strncpy(s_ip, WiFi.localIP().toString().c_str(), sizeof(s_ip) - 1);
            applog("WIFI", "connected. ip=%s  gateway=%s  rssi=%d dBm  channel=%d",
                   s_ip, WiFi.gatewayIP().toString().c_str(),
                   WiFi.RSSI(), WiFi.channel());
        }
        return;
    }

    /* Mat ket noi / chua ket noi */
    if (s_ip[0] != '0') applog("WIFI", "connection LOST, will retry");
    strncpy(s_ip, "0.0.0.0", sizeof(s_ip) - 1);
    uint32_t now = millis();

    if (s_connecting && (now - s_last_try_ms) < WIFI_CONNECT_TIMEOUT_MS) return;  /* dang thu */

    if (s_connecting) {
        /* Het thoi gian cho -> tang backoff (1s,2s,4s...30s) roi thu lai */
        s_connecting = false;
        s_backoff_ms = min((uint32_t)WIFI_RETRY_MAX_MS, s_backoff_ms * 2);
        applog("WIFI", "connect FAILED (check the SSID character by character, the "
                       "password, and that the router broadcasts 2.4 GHz). Retry in %lu s",
               (unsigned long)(s_backoff_ms / 1000));
        s_last_try_ms = now;
        return;
    }

    if ((now - s_last_try_ms) >= s_backoff_ms) start_connect();
}

bool wifi_is_up(void)      { return WiFi.status() == WL_CONNECTED; }
int  wifi_rssi(void)       { return wifi_is_up() ? WiFi.RSSI() : 0; }
const char* wifi_ip(void)  { return s_ip; }

/* ===================================================================
 * MQTT - 4 topic cua API.md muc 2
 * =================================================================== */

static WiFiClient   s_tcp;
static PubSubClient s_mqtt(s_tcp);

static char s_t_command[64], s_t_schedule[64], s_t_status[64], s_t_heartbeat[64],
            s_t_schedules[64], s_t_lwt[64];
static char s_client_id[48];

static void build_topics(void) {
    const char* id = state_device_id();
    snprintf(s_t_command,   sizeof(s_t_command),   "%s/%s/command",   TOPIC_ROOT, id);
    snprintf(s_t_schedule,  sizeof(s_t_schedule),  "%s/%s/schedule",  TOPIC_ROOT, id);
    snprintf(s_t_status,    sizeof(s_t_status),    "%s/%s/status",    TOPIC_ROOT, id);
    snprintf(s_t_heartbeat, sizeof(s_t_heartbeat), "%s/%s/heartbeat", TOPIC_ROOT, id);
    snprintf(s_t_schedules, sizeof(s_t_schedules), "%s/%s/schedules", TOPIC_ROOT, id);
    snprintf(s_t_lwt,       sizeof(s_t_lwt),       "%s/%s/lwt",       TOPIC_ROOT, id);

    /* clientId phai duy nhat tren broker cong khai: trung id thi broker da
       client cu ra, hai ben thay nhau reconnect vo tan. */
    snprintf(s_client_id, sizeof(s_client_id), "%s-%s", id, state_mac_suffix());
}

/* Chay trong ngu canh task_net (do s_mqtt.loop() goi).
   Chi PARSE roi day vao q_in - khong thuc thi tai day de khong chan MQTT loop. */
static void on_message(char* topic, uint8_t* payload, unsigned int len) {
    in_msg_t m;

    if (!strcmp(topic, s_t_command)) {
        if (!proto_parse_command((const char*)payload, len, &m)) return;
        applog("CMD", "<- command %s  %s", m.id, m.value ? "ON" : "OFF");
    } else if (!strcmp(topic, s_t_schedule)) {
        if (!proto_parse_schedule((const char*)payload, len, &m)) return;
        applog("SCHED", "<- schedule %s  %02u:%02u -> %s", m.id, m.hh, m.mm, m.value ? "ON" : "OFF");
    } else {
        return;                                  /* topic la, bo qua */
    }

    if (xQueueSend(q_in, &m, pdMS_TO_TICKS(50)) != pdTRUE)
        applog("CMD", "inbound queue full, DROPPED %s", m.id);
}

void mqtt_setup(void) {
    build_topics();
    s_mqtt.setServer(CFG_MQTT_HOST, CFG_MQTT_PORT);
    s_mqtt.setCallback(on_message);
    s_mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
    s_mqtt.setBufferSize(MQTT_MAX_PACKET_SIZE);
    s_mqtt.setSocketTimeout(5);
}

bool mqtt_connect(void) {
    if (!wifi_is_up()) return false;

    const char* user = CFG_MQTT_USER;
    const char* pass = CFG_MQTT_PASS;

    /* Last Will: broker tu publish ban tin nay khi device rot ket noi dot ngot,
       server biet OFFLINE ngay thay vi doi het 45s vang heartbeat.
       Retained de server ket noi sau van doc duoc; task_net ghi de bang
       {online:true} ngay khi noi lai. */
    char will[128];
    proto_build_presence(will, sizeof(will), false);

    bool ok = s_mqtt.connect(s_client_id,
                             user[0] ? user : nullptr,
                             pass[0] ? pass : nullptr,
                             s_t_lwt, MQTT_SUB_QOS, /*retain*/ true, will,
                             /*cleanSession*/ true);
    if (!ok) {
        applog("MQTT", "connect to %s:%d FAILED -> %s",
               CFG_MQTT_HOST, CFG_MQTT_PORT, applog_mqtt_err(s_mqtt.state()));
        return false;
    }

    s_mqtt.subscribe(s_t_command,  MQTT_SUB_QOS);
    s_mqtt.subscribe(s_t_schedule, MQTT_SUB_QOS);
    applog("MQTT", "connected to %s:%d as %s", CFG_MQTT_HOST, CFG_MQTT_PORT, s_client_id);
    applog("MQTT", "subscribed  %s  and  %s", s_t_command, s_t_schedule);
    applog("MQTT", "publishing  %s, %s, %s", s_t_status, s_t_heartbeat, s_t_schedules);
    return true;
}

void mqtt_loop(void)       { s_mqtt.loop(); }
bool mqtt_is_up(void)      { return s_mqtt.connected(); }
void mqtt_disconnect(void) { s_mqtt.disconnect(); }

static const char* topic_for(out_kind_t k) {
    switch (k) {
        case OUT_HEARTBEAT: return s_t_heartbeat;
        case OUT_SCHEDULES: return s_t_schedules;
        case OUT_BIRTH:     return s_t_lwt;
        default:            return s_t_status;
    }
}

bool mqtt_publish_out(const out_msg_t* m) {
    if (!s_mqtt.connected()) return false;
    const char* t = topic_for(m->kind);
    /* Ban tin bao con song phai retained de ghi de LWT retained cua lan truoc. */
    const bool retain = (m->kind == OUT_BIRTH);
    /* PubSubClient chi publish duoc QoS 0. Backend cho QoS 1 nhung khong tu
       choi QoS 0; doi lai, ban tin co the mat neu TCP dut dung luc gui ->
       da bu bang outbox NVS ben duoi (persist). */
    bool ok = s_mqtt.publish(t, (const uint8_t*)m->json, strlen(m->json), retain);
    if (!ok) {
        applog("MQTT", "publish FAILED -> %s (%u bytes, buffer %d)",
               t, (unsigned)strlen(m->json), MQTT_MAX_PACKET_SIZE);
        return false;
    }
    /* In nguyen ban tin status: day la bang chung firmware da bao cao len,
       de doi chieu voi log cua backend khi web khong thay gi.
       Heartbeat khong in (moi 15s mot cai, da co dong STAT cung nhip). */
    if (m->kind == OUT_STATUS) applog("MQTT", "-> %s", m->json);
    return true;
}

bool mqtt_publish_status_raw(const char* json) {
    if (!s_mqtt.connected()) return false;
    return s_mqtt.publish(s_t_status, (const uint8_t*)json, strlen(json), false);
}
