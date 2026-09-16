#include <Arduino.h>
#include <time.h>
#include <sys/time.h>
#include "clock.h"
#include "storage.h"
#include "config.h"
#include "log.h"
#include "schedule.h"

static bool     s_trusted       = false;   /* da SNTP thanh cong trong phien nay */
static uint32_t s_last_sync_ms  = 0;
static uint32_t s_last_save_ms  = 0;
static bool     s_sync_started  = false;

/* Theo doi lan dong bo LAI (dinh ky 6h): SNTP chinh gio khong dong bo nen phai
   cho vai giay roi moi doc lai de biet no da chinh bao nhieu. */
static uint32_t s_resync_at_ms   = 0;      /* != 0: dang cho ket qua resync */
static uint32_t s_resync_epoch   = 0;      /* gio ngay truoc luc goi resync   */
#define RESYNC_REPORT_AFTER_MS   5000

void time_init(void) {
    /* Sau khi mat dien, RTC noi ve 0 -> nap moc tho tu NVS de lich con co
       khai niem "bay gio la may gio". Chua dang tin cho toi khi SNTP xong. */
    uint32_t saved = storage_load_epoch();
    if (saved > TIME_VALID_EPOCH) {
        struct timeval tv = { .tv_sec = (time_t)saved, .tv_usec = 0 };
        settimeofday(&tv, nullptr);
        char iso[24]; time_iso8601(saved, iso, sizeof(iso));
        applog("TIME", "coarse time from NVS: %s (untrusted, waiting for SNTP)", iso);
    }
    s_trusted = false;
}

void time_start_sync(void) {
    /* Lam viec hoan toan bang UTC. Doi sang gio dia phuong o tang lich,
       dua vao tz_offset_min server gui xuong -> khong phu thuoc TZ database. */
    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
    s_sync_started = true;
    applog("TIME", "syncing with SNTP (%s)...", NTP_SERVER_1);
}

uint32_t time_now(void) {
    time_t t = ::time(nullptr);
    return (t < (time_t)TIME_VALID_EPOCH) ? 0 : (uint32_t)t;
}

bool time_is_valid(void)   { return time_now() != 0; }
bool time_is_trusted(void) { return s_trusted; }

void time_tick(void) {
    uint32_t now_ms = millis();

    /* SNTP vua co ket qua lan dau? */
    if (s_sync_started && !s_trusted && time_is_valid()) {
        s_trusted      = true;
        s_last_sync_ms = now_ms;
        char iso[24]; time_iso8601(time_now(), iso, sizeof(iso));
        int hh, mm, ss, dow;
        time_local_parts(time_now(), schedule_tz_offset(), &hh, &mm, &ss, &dow);
        applog("TIME", "synced: %s (local %02d:%02d:%02d)", iso, hh, mm, ss);
        storage_save_epoch(time_now());
    }

    /* Dong bo lai dinh ky (bu troi thach anh). */
    if (s_trusted && (now_ms - s_last_sync_ms) > NTP_RESYNC_MS) {
        s_resync_epoch = time_now();
        s_resync_at_ms = now_ms ? now_ms : 1;
        applog("TIME", "periodic resync due (every %lu h)", (unsigned long)(NTP_RESYNC_MS / 3600000UL));
        time_start_sync();
        s_last_sync_ms = now_ms;
    }

    /* Doc ket qua resync: lech bao nhieu giay so voi dong ho noi. */
    if (s_resync_at_ms && (now_ms - s_resync_at_ms) > RESYNC_REPORT_AFTER_MS) {
        uint32_t expect = s_resync_epoch + (now_ms - s_resync_at_ms) / 1000;
        int32_t  drift  = (int32_t)time_now() - (int32_t)expect;
        char iso[24]; time_iso8601(time_now(), iso, sizeof(iso));
        applog("TIME", "resync done: %s (internal clock was %s by %ld s)",
               iso, drift >= 0 ? "slow" : "fast", (long)(drift >= 0 ? drift : -drift));
        s_resync_at_ms = 0;
        storage_save_epoch(time_now());
    }

    /* Luu moc tho xuong NVS de lan boot sau khong ve 1970. */
    if (time_is_valid() && (now_ms - s_last_save_ms) > TIME_PERSIST_MS) {
        storage_save_epoch(time_now());
        s_last_save_ms = now_ms;
    }
}

void time_local_parts(uint32_t epoch, int16_t tz_min,
                      int* hh, int* mm, int* ss, int* dow) {
    time_t    local = (time_t)epoch + (time_t)tz_min * 60;
    struct tm tmv;
    gmtime_r(&local, &tmv);
    if (hh) *hh = tmv.tm_hour;
    if (mm) *mm = tmv.tm_min;
    if (ss) *ss = tmv.tm_sec;
    /* tm_wday: 0=CN..6=T7  ->  doi ve 0=T2..6=CN cho khop bitmask cua lich */
    if (dow) *dow = (tmv.tm_wday + 6) % 7;
}

void time_iso8601(uint32_t epoch, char* buf, size_t len) {
    if (!buf || len < 21) return;
    if (epoch == 0) { snprintf(buf, len, "1970-01-01T00:00:00Z"); return; }
    time_t    t = (time_t)epoch;
    struct tm tmv;
    gmtime_r(&t, &tmv);
    strftime(buf, len, "%Y-%m-%dT%H:%M:%SZ", &tmv);
}
