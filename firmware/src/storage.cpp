#include <Arduino.h>
#include <Preferences.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "storage.h"

static Preferences       s_cfg;    /* namespace "iotcfg": lich, relay, epoch */
static Preferences       s_out;    /* namespace "iotout": outbox            */
static SemaphoreHandle_t s_mtx = nullptr;

/* Outbox la hang doi vong: key "m0".."m<OUTBOX_MAX-1>", con head/count o "h"/"c". */
static uint16_t s_head = 0, s_count = 0;

/* Goi truoc storage_init() la loi lap trinh, nhung tha tra ve "khong co du
   lieu" con hon assert giua luc boot: Preferences chua begin() se tu tra ve
   rong/false. Kiem s_mtx de khong lay mot mutex NULL. */
#define LOCK()   do { if (s_mtx) xSemaphoreTake(s_mtx, portMAX_DELAY); } while (0)
#define UNLOCK() do { if (s_mtx) xSemaphoreGive(s_mtx); } while (0)

void storage_init(void) {
    s_mtx = xSemaphoreCreateMutex();
    s_cfg.begin("iotcfg", false);
    s_out.begin("iotout", false);
    s_head  = s_out.getUShort("h", 0);
    s_count = s_out.getUShort("c", 0);
    if (s_head >= OUTBOX_MAX)  s_head = 0;
    if (s_count > OUTBOX_MAX)  s_count = 0;
    /* Khong log o day: storage_init() chay truoc ca banner. main.cpp in ho. */
}

/* ---------------- Lich ---------------- */
bool storage_save_schedule(const schedule_t* s) {
    if (!s) return false;
    LOCK();
    size_t n = s_cfg.putBytes("sched", s, sizeof(schedule_t));
    UNLOCK();
    return n == sizeof(schedule_t);
}

bool storage_load_schedule(schedule_t* s) {
    if (!s) return false;
    LOCK();
    /* Hoi truoc bang isKey(): lan boot dau chua co khoa "sched", goi thang
       getBytes() se lam Preferences in mot dong loi cua ESP-IDF ra serial
       ("nvs_get_blob len fail: sched NOT_FOUND") - dung la loi that. */
    size_t n = s_cfg.isKey("sched")
             ? s_cfg.getBytes("sched", s, sizeof(schedule_t))
             : 0;
    UNLOCK();
    if (n != sizeof(schedule_t))   return false;
    if (s->magic != SCHEDULE_MAGIC) return false;   /* blob cu / hong */
    if (s->count > SCHED_MAX_SLOTS) return false;
    return true;
}

/* ---------------- Trang thai relay ---------------- */
void storage_save_relay(uint8_t ch, bool on) {
    char key[8]; snprintf(key, sizeof(key), "r%u", ch);
    LOCK(); s_cfg.putUChar(key, on ? 1 : 0); UNLOCK();
}
bool storage_load_relay(uint8_t ch, bool* on) {
    char key[8]; snprintf(key, sizeof(key), "r%u", ch);
    LOCK();
    bool exists = s_cfg.isKey(key);
    uint8_t v   = s_cfg.getUChar(key, 0);
    UNLOCK();
    if (!exists) return false;
    *on = (v != 0);
    return true;
}

/* ---------------- Device identity ---------------- */
bool storage_load_device_id(char* buf, size_t len) {
    if (!buf || !len) return false;
    LOCK();
    bool has = s_cfg.isKey("devid");
    if (has) s_cfg.getString("devid", buf, len);
    UNLOCK();
    return has && buf[0];
}

bool storage_save_device_id(const char* id) {
    if (!id || !id[0]) return false;
    LOCK();
    bool ok = s_cfg.putString("devid", id) > 0;
    UNLOCK();
    return ok;
}

/* ---------------- Lich su command_id ---------------- */
bool storage_save_cmd_history(const void* blob, size_t len) {
    LOCK();
    size_t n = s_cfg.putBytes("cmdhist", blob, len);
    UNLOCK();
    return n == len;
}

bool storage_load_cmd_history(void* blob, size_t len) {
    LOCK();
    size_t n = s_cfg.isKey("cmdhist") ? s_cfg.getBytes("cmdhist", blob, len) : 0;
    UNLOCK();
    return n == len;
}

/* ---------------- Moc thoi gian ---------------- */
void storage_save_epoch(uint32_t e) {
    LOCK(); s_cfg.putULong("epoch", e); UNLOCK();
}
uint32_t storage_load_epoch(void) {
    LOCK(); uint32_t v = s_cfg.getULong("epoch", 0); UNLOCK(); return v;
}

/* ---------------- Outbox ---------------- */
static void outbox_key(uint16_t slot, char* buf, size_t len) {
    snprintf(buf, len, "m%u", slot);
}

bool storage_outbox_push(const char* json) {
    if (!json || !json[0]) return false;
    LOCK();
    if (s_count >= OUTBOX_MAX) {
        /* Day: bo ban tin CU NHAT. Trang thai moi nhat quan trong hon. */
        char k[8]; outbox_key(s_head, k, sizeof(k));
        s_out.remove(k);
        s_head = (s_head + 1) % OUTBOX_MAX;
        s_count--;
    }
    uint16_t slot = (s_head + s_count) % OUTBOX_MAX;
    char k[8]; outbox_key(slot, k, sizeof(k));

    char tmp[OUTBOX_ITEM_MAX];
    strncpy(tmp, json, OUTBOX_ITEM_MAX - 1);
    tmp[OUTBOX_ITEM_MAX - 1] = '\0';

    bool ok = s_out.putString(k, tmp) > 0;
    if (ok) {
        s_count++;
        s_out.putUShort("h", s_head);
        s_out.putUShort("c", s_count);
    }
    UNLOCK();
    return ok;
}

bool storage_outbox_peek(char* buf, size_t len) {
    LOCK();
    if (s_count == 0) { UNLOCK(); return false; }
    char k[8]; outbox_key(s_head, k, sizeof(k));
    size_t n = s_out.getString(k, buf, len);
    UNLOCK();
    return n > 0;
}

void storage_outbox_pop(void) {
    LOCK();
    if (s_count == 0) { UNLOCK(); return; }
    char k[8]; outbox_key(s_head, k, sizeof(k));
    s_out.remove(k);
    s_head = (s_head + 1) % OUTBOX_MAX;
    s_count--;
    s_out.putUShort("h", s_head);
    s_out.putUShort("c", s_count);
    UNLOCK();
}

uint16_t storage_outbox_count(void) {
    LOCK(); uint16_t v = s_count; UNLOCK(); return v;
}
