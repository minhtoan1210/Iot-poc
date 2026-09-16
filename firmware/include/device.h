/**
 * device.h - Ban than thiet bi: phan cung + trang thai.
 *
 *   relay_*  cham vao chan GPIO. set() co DOC LAI de xac minh, khong phai
 *            "ghi xong thi coi nhu thanh cong".
 *   state_*  trang thai chia se giua cac task, moi ham co mutex ben trong
 *            nen khong task nao phai tu khoa.
 *
 * device_id la hang so bien dich (DEVICE_ID trong config.h), khong nam o day.
 */
#pragma once
#include "config.h"



/* ===================================================================
 * PHAN CUNG - relay / den
 * =================================================================== */

void relay_init(void);

/**
 * Dat trang thai 1 kenh roi doc lai de xac minh.
 * @return true  = phan hoi khop voi gia tri mong muon (SUCCESS)
 *         false = da lai chan nhung doc lai khong khop (FAILED / E_VERIFY_FAILED)
 */
bool relay_set(uint8_t ch, bool on);

/** Doc trang thai vat ly hien tai (feedback pin, hoac readback GPIO). */
bool relay_read(uint8_t ch);

/** Test: ep kenh loi o lan set ke tiep, de demo duong FAILED tu web. */
void relay_inject_fault(uint8_t ch, bool enable);

/* ===================================================================
 * TRANG THAI TOAN CUC
 * =================================================================== */

void        state_init(void);

/** 3 byte cuoi cua MAC dang hex, vd "a1b2c3".
 *  Dung lam duoi clientId MQTT de hai board khong da nhau ra khoi broker. */
const char* state_mac_suffix(void);

/** device_id dang dung: doc tu NVS luc boot, khong co thi lay DEVICE_ID.
 *  Moi noi phai goi ham nay, KHONG dung thang macro DEVICE_ID. */
const char* state_device_id(void);

/** Ghi device_id moi xuong NVS. Doi hoi khoi dong lai de topic duoc dung lai. */
bool        state_set_device_id(const char* id);

/* Relay */
void        state_set_relay(uint8_t ch, bool on, cmd_source_t src);
bool        state_get_relay(uint8_t ch);
cmd_source_t state_get_relay_source(uint8_t ch);

/* Mang */
void        state_set_net(net_state_t s);
net_state_t state_get_net(void);

/* Dem */
void        state_inc_cmd_ok(void);
void        state_inc_cmd_fail(void);
uint32_t    state_cmd_ok(void);
uint32_t    state_cmd_fail(void);

/* Chong lap command_id (QoS1 co the giao 2 lan cung 1 ban tin) */
bool        state_cmd_seen(const char* cmd_id);   /* true neu da xu ly roi */
void        state_cmd_remember(const char* cmd_id);
