#include <Arduino.h>
#include <string.h>
#include "schedule.h"
#include "storage.h"
#include "clock.h"
#include "log.h"

static schedule_t s_sched;
/* Phut (epoch/60) ma tung slot da chay lan gan nhat -> chong ban 2 lan trong 1 phut.
   Chi nam trong RAM: boot lai thi dung co che catch-up ben duoi. */
static uint32_t   s_last_fire_min[SCHED_MAX_SLOTS];

static void log_slots(void) {
    for (uint8_t i = 0; i < s_sched.count; i++)
        applog("SCHED", "  %02u:%02u -> %-3s  (%s)",
               s_sched.slots[i].hh, s_sched.slots[i].mm,
               s_sched.slots[i].value ? "ON" : "OFF", s_sched.slots[i].id);
}

void schedule_log_all(void) {
    if (s_sched.count == 0) { applog("SCHED", "no schedules stored"); return; }
    applog("SCHED", "%u schedule(s), local time UTC%+d:",
           s_sched.count, s_sched.tz_offset_min / 60);
    log_slots();
}

void schedule_init(void) {
    memset(&s_sched, 0, sizeof(s_sched));
    memset(s_last_fire_min, 0, sizeof(s_last_fire_min));

    if (storage_load_schedule(&s_sched)) {
        applog("SCHED", "loaded %u schedule(s) from NVS, local time UTC%+d",
               s_sched.count, s_sched.tz_offset_min / 60);
        log_slots();
    } else {
        /* Chua co lich -> khoi tao rong, van chay binh thuong. */
        s_sched.magic         = SCHEDULE_MAGIC;
        s_sched.count         = 0;
        s_sched.tz_offset_min = SCHED_DEFAULT_TZ_MIN;
        applog("SCHED", "no schedules in NVS, waiting for the server");
    }
}

bool schedule_upsert(const char* id, uint8_t hh, uint8_t mm, bool value, bool enabled) {
    if (!id || !id[0]) return false;

    /* Da co schedule_id nay -> cap nhat tai cho (web sua gio/lenh cua lich cu,
       hoac broker giao lai ban tin QoS1). */
    int idx = -1;
    for (uint8_t i = 0; i < s_sched.count; i++)
        if (!strncmp(s_sched.slots[i].id, id, SCHED_ID_MAX - 1)) { idx = i; break; }

    bool is_new = (idx < 0);
    if (is_new) {
        if (s_sched.count >= SCHED_MAX_SLOTS) {
            applog("SCHED", "storage full (%d schedules), rejected %s", SCHED_MAX_SLOTS, id);
            return false;
        }
        idx = s_sched.count;
    }

    schedule_t ns;
    memcpy(&ns, &s_sched, sizeof(ns));
    memset(&ns.slots[idx], 0, sizeof(sched_slot_t));
    strncpy(ns.slots[idx].id, id, SCHED_ID_MAX - 1);
    ns.slots[idx].enable = enabled ? 1 : 0;
    ns.slots[idx].hh     = hh;
    ns.slots[idx].mm     = mm;
    ns.slots[idx].value  = value ? 1 : 0;
    if (is_new) ns.count++;

    /* Ghi NVS TRUOC khi doi RAM: neu ghi hong thi lich cu van con nguyen ven. */
    if (!storage_save_schedule(&ns)) {
        applog("SCHED", "NVS write FAILED, keeping previous schedules");
        return false;
    }
    memcpy(&s_sched, &ns, sizeof(ns));
    s_last_fire_min[idx] = 0;

    applog("SCHED", "%s %02u:%02u -> %-3s %s (saved to NVS, survives power loss)",
           is_new ? "added" : "updated", hh, mm, value ? "ON" : "OFF",
           enabled ? "" : "[disabled]");
    applog("SCHED", "%u schedule(s) stored:", s_sched.count);
    log_slots();
    return true;
}

bool schedule_remove(const char* id) {
    if (!id || !id[0]) return false;

    int idx = -1;
    for (uint8_t i = 0; i < s_sched.count; i++)
        if (!strncmp(s_sched.slots[i].id, id, SCHED_ID_MAX - 1)) { idx = i; break; }
    if (idx < 0) {
        applog("SCHED", "delete %s: not stored here, nothing to do", id);
        return false;
    }

    schedule_t ns;
    memcpy(&ns, &s_sched, sizeof(ns));
    /* Don cho: keo cac slot phia sau len mot bac de bang luon lien tuc. */
    for (uint8_t i = idx; i + 1 < ns.count; i++)
        memcpy(&ns.slots[i], &ns.slots[i + 1], sizeof(sched_slot_t));
    memset(&ns.slots[ns.count - 1], 0, sizeof(sched_slot_t));
    ns.count--;

    if (!storage_save_schedule(&ns)) {
        applog("SCHED", "NVS write FAILED, keeping previous schedules");
        return false;
    }
    memcpy(&s_sched, &ns, sizeof(ns));
    for (uint8_t i = idx; i + 1 < SCHED_MAX_SLOTS; i++)
        s_last_fire_min[i] = s_last_fire_min[i + 1];

    applog("SCHED", "deleted %s, %u schedule(s) left", id, s_sched.count);
    return true;
}

bool schedule_set_tz(int16_t tz_offset_min) {
    if (s_sched.tz_offset_min == tz_offset_min) return true;

    schedule_t ns;
    memcpy(&ns, &s_sched, sizeof(ns));
    ns.tz_offset_min = tz_offset_min;
    if (!storage_save_schedule(&ns)) return false;

    applog("SCHED", "local time changed UTC%+d -> UTC%+d (server decides)",
           s_sched.tz_offset_min / 60, tz_offset_min / 60);
    memcpy(&s_sched, &ns, sizeof(ns));
    memset(s_last_fire_min, 0, sizeof(s_last_fire_min));
    return true;
}

bool schedule_get_slot(uint8_t idx, sched_slot_t* out) {
    if (idx >= s_sched.count || !out) return false;
    memcpy(out, &s_sched.slots[idx], sizeof(sched_slot_t));
    return true;
}

uint8_t  schedule_count(void)     { return s_sched.count; }
int16_t  schedule_tz_offset(void) { return s_sched.tz_offset_min; }

bool schedule_due(uint32_t now_epoch, sched_slot_t* out) {
    if (now_epoch == 0 || s_sched.count == 0) return false;   /* chua co gio -> khong dam chay */

    int hh, mm, ss, dow;
    time_local_parts(now_epoch, s_sched.tz_offset_min, &hh, &mm, &ss, &dow);
    uint32_t cur_min = now_epoch / 60;

    for (uint8_t i = 0; i < s_sched.count; i++) {
        const sched_slot_t* sl = &s_sched.slots[i];
        if (!sl->enable)                   continue;
        if (sl->hh != hh || sl->mm != mm)  continue;
        if (s_last_fire_min[i] == cur_min) continue;   /* da ban trong phut nay */

        s_last_fire_min[i] = cur_min;
        memcpy(out, sl, sizeof(sched_slot_t));
        return true;
    }
    return false;
}

bool schedule_catchup(uint32_t now_epoch, sched_slot_t* out) {
    if (now_epoch == 0 || s_sched.count == 0) return false;

    int64_t local_now = (int64_t)now_epoch + (int64_t)s_sched.tz_offset_min * 60;
    int64_t midnight  = (local_now / 86400) * 86400;
    int64_t best_t    = -1;
    int     best_i    = -1;

    /* Lich chay hang ngay: moi slot co dung 2 moc trong 24h qua (hom nay, hom qua). */
    for (uint8_t i = 0; i < s_sched.count; i++) {
        const sched_slot_t* sl = &s_sched.slots[i];
        if (!sl->enable) continue;
        for (int back = 0; back <= 1; back++) {
            int64_t t = midnight - (int64_t)back * 86400
                        + (int64_t)sl->hh * 3600 + (int64_t)sl->mm * 60;
            if (t > local_now)          continue;      /* chua toi gio */
            if (local_now - t >= 86400) continue;      /* qua cu */
            if (t > best_t) { best_t = t; best_i = i; }
        }
    }
    if (best_i < 0) return false;

    /* Danh dau da chay de task_schedule khong ban lai ngay trong phut nay. */
    s_last_fire_min[best_i] = now_epoch / 60;
    memcpy(out, &s_sched.slots[best_i], sizeof(sched_slot_t));
    return true;
}
