/**
 * schedule.h - Quan ly lich chay tren device.
 * Lich nam trong NVS -> mat dien / mat Internet van con va van chay.
 *
 * Web gui TUNG lich mot (devices/<id>/schedule), khong gui ca bang.
 * Lich chay HANG NGAY vao "HH:MM" gio dia phuong (API.md muc 2.4).
 */
#pragma once
#include "config.h"

void     schedule_init(void);                          /* nap tu NVS */

/** Them moi hoac cap nhat 1 lich theo schedule_id. Ghi NVS ngay.
 *  @param enabled  false = giu trong bang nhung khong kich hoat.
 *  @return false neu het cho (SCHED_MAX_SLOTS) hoac ghi NVS loi. */
bool     schedule_upsert(const char* id, uint8_t hh, uint8_t mm, bool value, bool enabled);

/** Xoa 1 lich khoi NVS. @return false neu khong co id do. */
bool     schedule_remove(const char* id);

/** Dat mui gio ma "HH:MM" cua server thuoc ve. Ghi NVS neu doi. */
bool     schedule_set_tz(int16_t tz_offset_min);

uint8_t  schedule_count(void);
int16_t  schedule_tz_offset(void);

/** Doc 1 slot theo chi so 0..count-1, de bao cao bang lich len server. */
bool     schedule_get_slot(uint8_t idx, sched_slot_t* out);

/** In bang lich dang luu ra serial (phim 'l' tren console). */
void     schedule_log_all(void);

/** Quet lich: neu co slot dung vao phut hien tai thi tra ve slot do.
 *  Goi 1 lan/giay tu task_schedule. @return true neu co slot can chay. */
bool     schedule_due(uint32_t now_epoch, sched_slot_t* out);

/** Tim lan kich hoat gan nhat DA QUA trong 24h -> dong bo lai trang thai sau khi boot. */
bool     schedule_catchup(uint32_t now_epoch, sched_slot_t* out);
