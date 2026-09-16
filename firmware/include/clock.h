/**
 * clock.h - Dong bo va cap phat thoi gian.
 *
 * Chien luoc:
 *  - Co mang  : SNTP -> epoch UTC chuan.
 *  - Mat mang : ESP32 tiep tuc dem bang RTC noi -> lich van chay.
 *  - Mat dien : RTC noi mat. Boot lai lay moc tho tu NVS (epoch luu dinh ky)
 *               va danh dau time_trusted = false cho toi khi SNTP thanh cong.
 *               -> Muon chac chan, gan them RTC ngoai (DS3231).
 */
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

void     time_init(void);
void     time_start_sync(void);          /* goi khi WiFi vua len */
void     time_tick(void);                /* task_health goi dinh ky: resync + luu NVS */

uint32_t time_now(void);                 /* epoch UTC (giay). 0 neu chua co gio */
bool     time_is_valid(void);            /* da co gio (du la moc tho tu NVS) */
bool     time_is_trusted(void);          /* da SNTP thanh cong trong phien nay */

/** Doi epoch UTC -> gio dia phuong theo tz_offset_min. */
void     time_local_parts(uint32_t epoch, int16_t tz_min,
                          int* hh, int* mm, int* ss, int* dow /*0=T2..6=CN*/);

/** Chuoi ISO8601 UTC, vd 2026-09-13T11:22:33Z. buf >= 21 byte. */
void     time_iso8601(uint32_t epoch, char* buf, size_t len);
