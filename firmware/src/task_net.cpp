/**
 * task_net - Chu so huu DUY NHAT cua WiFi + MQTT.
 *
 *  - Giu WiFi/MQTT song, reconnect co backoff.
 *  - Bom PubSubClient (nhan command/schedule -> day vao q_in).
 *  - Lay ban tin tu q_out ra publish.
 *  - Mat mang: ban tin co persist=true duoc cat vao outbox NVS,
 *    co mang lai thi day het len (khong mat ket qua cua lich) - giu nguyen
 *    timestamp GOC luc thuc thi, dung nhu mock-device.ts lam.
 */
#include <Arduino.h>
#include <string.h>
#include "tasks.h"
#include "net.h"
#include "protocol.h"
#include "device.h"
#include "storage.h"
#include "clock.h"
#include "log.h"

static uint32_t s_mqtt_backoff = MQTT_RETRY_MIN_MS;
static uint32_t s_mqtt_last_try = 0;

/* Day outbox: moi vong day toi da 3 ban tin de khong chiem CPU qua lau.
   Cach nhau vai chuc ms cho backend kip ghi MongoDB. */
static void flush_outbox(void) {
    for (int i = 0; i < 3 && storage_outbox_count() > 0; i++) {
        char buf[OUTBOX_ITEM_MAX];
        if (!storage_outbox_peek(buf, sizeof(buf))) break;
        if (!mqtt_publish_status_raw(buf)) break;    /* mat ket noi -> giu lai, thu sau */
        storage_outbox_pop();
        /* In nguyen ban tin: timestamp trong do la luc THUC THI, khong phai
           luc gui - de doi chieu voi gio den that su bat/tat. */
        applog("NET", "flushed (%u left) -> %s", storage_outbox_count(), buf);
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

void task_net(void* pv) {
    (void)pv;
    wifi_setup();
    mqtt_setup();
    bool was_up = false;
    bool wifi_was_up = false;

    for (;;) {
        wifi_loop();

        if (wifi_is_up()) {
            if (!wifi_was_up) {          /* WiFi vua len -> xin gio tu SNTP */
                wifi_was_up = true;
                time_start_sync();
            }
            if (!mqtt_is_up()) {
                state_set_net(NET_WIFI_OK);
                uint32_t now = millis();
                if (now - s_mqtt_last_try >= s_mqtt_backoff) {
                    s_mqtt_last_try = now;
                    if (mqtt_connect()) {
                        s_mqtt_backoff = MQTT_RETRY_MIN_MS;
                        state_set_net(NET_MQTT_OK);
                        /* Vua noi lai thi bao ngay ba thu, khong cho chu ky 15s:
                           1) {online:true} de ghi de LWT retained cua lan rot truoc
                           2) heartbeat co kem trang thai den -> server dong bo lai
                           3) bang lich dang giu -> server doi chieu voi MongoDB */
                        char j[MAX_OUT_JSON_LEN];
                        if (proto_build_presence(j, sizeof(j), true))
                            out_enqueue(OUT_BIRTH, false, j);
                        if (proto_build_heartbeat(j, sizeof(j)))
                            out_enqueue(OUT_HEARTBEAT, false, j);
                        out_report_schedules();
                    } else {
                        s_mqtt_backoff = min((uint32_t)MQTT_RETRY_MAX_MS, s_mqtt_backoff * 2);
                    }
                }
            } else {
                state_set_net(NET_MQTT_OK);
                mqtt_loop();
                flush_outbox();
            }
        } else {
            wifi_was_up = false;
            state_set_net(NET_DOWN);
            if (mqtt_is_up()) mqtt_disconnect();
        }

        bool up = mqtt_is_up();
        if (up != was_up) {
            applog("NET", "uplink %s", up ? "UP" : "DOWN");
            was_up = up;
        }

        /* --- Lay ban tin can gui --- */
        out_msg_t m;
        while (xQueueReceive(q_out, &m, 0) == pdTRUE) {
            if (up && mqtt_publish_out(&m)) continue;         /* gui duoc */

            if (m.persist) {                                  /* khong gui duoc + quan trong */
                storage_outbox_push(m.json);
                applog("NET", "offline -> result queued to NVS outbox (%u waiting)",
                       storage_outbox_count());
            } else {
                applog("NET", "offline -> heartbeat dropped");
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
