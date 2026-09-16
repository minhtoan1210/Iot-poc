/**
 * storage.h - Luu tru ben vung (NVS flash).
 * Con sau khi mat dien / restart.
 *
 * Namespace:
 *   "iotcfg"  : schedule blob, relay state cuoi, epoch moc tho
 *   "iotout"  : outbox (status chua gui duoc luc mat mang)
 */
#pragma once
#include "config.h"
#include <stddef.h>

void storage_init(void);

/* ---- Lich ---- */
bool storage_save_schedule(const schedule_t* s);
bool storage_load_schedule(schedule_t* s);      /* false neu chua co / hong */

/* ---- Trang thai relay cuoi cung (khoi phuc sau mat dien) ---- */
void storage_save_relay(uint8_t ch, bool on);
bool storage_load_relay(uint8_t ch, bool* on);

/* ---- Device identity ----
 * Khong bien dich cung: doc tu NVS truoc, khong co thi lay DEVICE_ID trong config.h.
 * Dat bang phim 'i' tren console serial -> mot ban firmware nap duoc nhieu board. */
bool storage_load_device_id(char* buf, size_t len);   /* false = NVS chua co */
bool storage_save_device_id(const char* id);

/* ---- Lich su command_id da xu ly ----
 * Con sau khi khoi dong lai -> broker giao lai ban tin QoS 1 sau reboot
 * khong lam den bat/tat lan thu hai. */
bool storage_save_cmd_history(const void* blob, size_t len);
bool storage_load_cmd_history(void* blob, size_t len);

/* ---- Moc thoi gian tho ---- */
void     storage_save_epoch(uint32_t epoch);
uint32_t storage_load_epoch(void);

/* ---- Outbox: vong tron trong NVS ----
 * Dung khi mat mang: ket qua thuc thi (nhat la cua lich) khong duoc mat.
 * Co mang lai, task_net day len devices/<id>/status voi timestamp GOC. */
bool storage_outbox_push(const char* json);
bool storage_outbox_peek(char* buf, size_t len);  /* lay ban tin cu nhat, chua xoa */
void storage_outbox_pop(void);                    /* xoa ban tin cu nhat (sau khi publish OK) */
uint16_t storage_outbox_count(void);
