/**
 * protocol.h - Tang giao thuc: JSON <-> struct.
 * Chi file nay biet ten truong JSON. Doi format chi sua o day.
 * Spec day du: API.md muc 2 (MQTT Payload).
 */
#pragma once
#include "config.h"

/* Gia tri cho truong "status" cua ban tin devices/<id>/status */
#define ST_ACK      "ACK"        /* da nhan duoc lenh, CHUA thuc thi */
#define ST_SUCCESS  "SUCCESS"    /* da thuc thi va doc lai khop */
#define ST_FAILED   "FAILED"     /* da thu nhung phan cung khong dat trang thai */

/* ---- Giai ma ban tin tu web ---- */

/** devices/<id>/command:  {command_id, device_id, command:"ON"|"OFF", timestamp} */
bool proto_parse_command(const char* payload, size_t len, in_msg_t* out);

/** devices/<id>/schedule: {schedule_id, device_id, time:"HH:MM", command,
 *                          enabled?, tz_offset_min?, action?:"set"|"delete"} */
bool proto_parse_schedule(const char* payload, size_t len, in_msg_t* out);

/* ---- Sinh ban tin gui len ---- */

/** devices/<id>/status. Goi 2 lan cho moi lenh:
 *    - ngay khi nhan duoc  -> status = ST_ACK, state = trang thai HIEN TAI
 *    - sau khi doc lai     -> status = ST_SUCCESS / ST_FAILED
 *  @param err_code  NULL/rong -> truong "error" la null. */
size_t proto_build_status(char* buf, size_t len, const char* command_id,
                          const char* status, bool state_on,
                          const char* err_code, uint32_t ts);

/** devices/<id>/heartbeat: {device_id, timestamp, state, fw, uptime_s}
 *  Co kem "state" de server tu dong bo lai neu hai ben lech nhau. */
size_t proto_build_heartbeat(char* buf, size_t len);

/** devices/<id>/schedules: bang lich device DANG THUC SU giu trong NVS.
 *  Gui sau moi lan doi lich va sau khi noi lai broker -> server doi chieu
 *  duoc voi MongoDB thay vi tin rang lenh gui xuong da toi noi. */
size_t proto_build_schedules(char* buf, size_t len);

/** devices/<id>/lwt: {device_id, online}. online=false la ban tin broker tu
 *  publish khi device rot; online=true la ban tin device gui luc vua noi. */
size_t proto_build_presence(char* buf, size_t len, bool online);

/* ---- Tien ich ---- */
const char* proto_source_str(cmd_source_t s);

/** Sinh command_id cho lan tu chay theo lich (web khong biet truoc id nay). */
void proto_gen_command_id(char* buf, size_t len);
