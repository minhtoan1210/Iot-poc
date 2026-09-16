#include <Arduino.h>
#include <ArduinoJson.h>
#include <string.h>
#include "protocol.h"
#include "device.h"
#include "schedule.h"
#include "clock.h"
#include "log.h"

const char* proto_source_str(cmd_source_t s) {
    switch (s) {
        case SRC_CLOUD:    return "cloud";
        case SRC_SCHEDULE: return "schedule";
        case SRC_BOOT:     return "boot";
        default:           return "unknown";
    }
}

/* "ON" -> true, "OFF" -> false. Chi nhan dung hai gia tri nay (API.md 2.1). */
static bool on_off_to_bool(const char* s, bool* out) {
    if (!s) return false;
    if (!strcmp(s, "ON"))  { *out = true;  return true; }
    if (!strcmp(s, "OFF")) { *out = false; return true; }
    return false;
}

/* Broker cong khai co thiet bi cua nguoi khac. Ban tin ghi device_id khac
   thi bo, dung de mot ban tin lac lam den nha minh bat len. */
static bool device_id_ok(JsonDocument& d) {
    const char* id = d["device_id"] | "";
    return !id[0] || !strcmp(id, state_device_id());
}

void proto_gen_command_id(char* buf, size_t len) {
    snprintf(buf, len, "cmd-%08lx%04x",
             (unsigned long)millis(), (unsigned)(esp_random() & 0xFFFF));
}

/* ================= Giai ma ================= */
bool proto_parse_command(const char* payload, size_t len, in_msg_t* out) {
    memset(out, 0, sizeof(*out));
    out->kind = IN_COMMAND;

    JsonDocument d;
    if (deserializeJson(d, payload, len)) {
        applog("CMD", "dropped: malformed JSON");
        return false;
    }
    if (!device_id_ok(d)) {
        applog("CMD", "dropped: device_id '%s' is not ours",
               (const char*)(d["device_id"] | "?"));
        return false;
    }

    const char* id = d["command_id"] | "";
    if (!id[0]) { applog("CMD", "dropped: command_id missing"); return false; }
    strncpy(out->id, id, MAX_ID_LEN - 1);

    if (!on_off_to_bool(d["command"] | "", &out->value)) {
        applog("CMD", "dropped %s: command must be ON or OFF", out->id);
        return false;
    }

    /* Truong ngoai spec, chi dung khi test duong FAILED tren board that.
       Web khong bao gio gui truong nay. */
    out->inject_fault = d["inject_fault"] | false;
    return true;
}

bool proto_parse_schedule(const char* payload, size_t len, in_msg_t* out) {
    memset(out, 0, sizeof(*out));
    out->kind    = IN_SCHEDULE;
    out->enabled = true;

    JsonDocument d;
    if (deserializeJson(d, payload, len)) {
        applog("SCHED", "dropped: malformed JSON");
        return false;
    }
    if (!device_id_ok(d)) {
        applog("SCHED", "dropped: device_id is not ours");
        return false;
    }

    const char* id = d["schedule_id"] | "";
    if (!id[0] || strlen(id) >= SCHED_ID_MAX) {
        applog("SCHED", "dropped: schedule_id missing or too long");
        return false;
    }
    strncpy(out->id, id, MAX_ID_LEN - 1);

    /* action="delete" chi can schedule_id, khong doi hoi time/command. */
    const char* action = d["action"] | "set";
    if (!strcmp(action, "delete")) { out->remove = true; return true; }

    /* Server la nguoi quyet dinh "HH:MM" thuoc mui gio nao. Khong gui thi
       device giu nguyen mui gio dang dung (mac dinh SCHED_DEFAULT_TZ_MIN). */
    if (d["tz_offset_min"].is<int>()) {
        int tz = d["tz_offset_min"].as<int>();
        if (tz >= -720 && tz <= 840) { out->has_tz = true; out->tz_offset_min = (int16_t)tz; }
        else applog("SCHED", "tz_offset_min %d out of range, ignored", tz);
    }

    const char* t = d["time"] | "";
    int hh = -1, mm = -1;
    if (sscanf(t, "%d:%d", &hh, &mm) != 2 ||
        hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        applog("SCHED", "dropped %s: time '%s' is not HH:MM", out->id, t);
        return false;
    }
    out->hh = (uint8_t)hh;
    out->mm = (uint8_t)mm;

    if (!on_off_to_bool(d["command"] | "", &out->value)) {
        applog("SCHED", "dropped %s: command must be ON or OFF", out->id);
        return false;
    }

    out->enabled = d["enabled"] | true;
    return true;
}

/* ================= Sinh ban tin ================= */
size_t proto_build_status(char* buf, size_t len, const char* command_id,
                          const char* status, bool state_on,
                          const char* err_code, uint32_t ts) {
    char iso[24]; time_iso8601(ts, iso, sizeof(iso));

    JsonDocument d;
    d["device_id"]  = state_device_id();
    d["command_id"] = command_id;
    d["status"]     = status;
    d["state"]      = state_on ? "ON" : "OFF";
    d["timestamp"]  = iso;
    if (err_code && err_code[0]) d["error"] = err_code;
    else                         d["error"] = nullptr;
    return serializeJson(d, buf, len);
}

size_t proto_build_heartbeat(char* buf, size_t len) {
    char iso[24]; time_iso8601(time_now(), iso, sizeof(iso));

    JsonDocument d;
    d["device_id"] = state_device_id();
    d["timestamp"] = iso;
    /* Kem trang thai den: sau mat dien hoac sau mot ban tin status roi mat,
       server tu doi chieu lai duoc thay vi hien sai mai mai. */
    d["state"]     = state_get_relay(0) ? "ON" : "OFF";
    d["fw"]        = FW_VERSION;
    d["uptime_s"]  = (uint32_t)(millis() / 1000);
    return serializeJson(d, buf, len);
}

size_t proto_build_schedules(char* buf, size_t len) {
    char iso[24]; time_iso8601(time_now(), iso, sizeof(iso));

    JsonDocument d;
    d["device_id"]     = state_device_id();
    d["timestamp"]     = iso;
    d["tz_offset_min"] = schedule_tz_offset();

    JsonArray arr = d["schedules"].to<JsonArray>();
    sched_slot_t sl;
    char hhmm[6];
    for (uint8_t i = 0; i < schedule_count(); i++) {
        if (!schedule_get_slot(i, &sl)) continue;
        snprintf(hhmm, sizeof(hhmm), "%02u:%02u", sl.hh, sl.mm);
        JsonObject o = arr.add<JsonObject>();
        o["schedule_id"] = sl.id;
        o["time"]        = hhmm;
        o["command"]     = sl.value ? "ON" : "OFF";
        o["enabled"]     = sl.enable ? true : false;
    }
    return serializeJson(d, buf, len);
}

size_t proto_build_presence(char* buf, size_t len, bool online) {
    JsonDocument d;
    d["device_id"] = state_device_id();
    d["online"]    = online;
    if (!online) d["reason"] = "connection_lost";
    return serializeJson(d, buf, len);
}
