/**
 * task_cmd - Bo dinh tuyen ban tin den.
 *
 *   command  -> tra ACK ngay, roi chuyen cho task_actuator thuc thi
 *   schedule -> them / sua / xoa trong NVS, roi bao lai bang lich cho server
 *
 * Mot lenh sinh ra HAI ban tin status (API.md muc 2.2):
 *   1. ACK              gui ngay khi nhan duoc, chua dong cat gi ca
 *   2. SUCCESS / FAILED do task_actuator gui sau khi DOC LAI phan cung
 * Nho vay server phan biet duoc "device chua nhan duoc lenh" voi
 * "da nhan roi, dang thuc hien" - hai truong hop truoc day deu nam o PENDING.
 */
#include <Arduino.h>
#include "tasks.h"
#include "protocol.h"
#include "device.h"
#include "schedule.h"
#include "clock.h"
#include "log.h"

static void send_status(const char* id, const char* st, const char* err) {
    char j[MAX_OUT_JSON_LEN];
    proto_build_status(j, sizeof(j), id, st, state_get_relay(0), err, time_now());
    /* ACK het gia tri neu gui tre nen khong can cat vao outbox;
       ket qua thuc thi thi khong duoc mat. */
    out_enqueue(OUT_STATUS, strcmp(st, ST_ACK) != 0, j);
}

static void handle_schedule(const in_msg_t& m) {
    /* Mui gio di kem lich: server la nguoi quyet dinh "HH:MM" thuoc mui nao. */
    if (m.has_tz) schedule_set_tz(m.tz_offset_min);

    if (m.remove) schedule_remove(m.id);
    else          schedule_upsert(m.id, m.hh, m.mm, m.value, m.enabled);

    /* Bao lai bang lich device DANG THUC SU giu -> server doi chieu duoc voi
       MongoDB thay vi tin rang ban tin gui xuong chac chan da toi noi. */
    out_report_schedules();
}

void task_cmd(void* pv) {
    (void)pv;
    in_msg_t m;

    for (;;) {
        if (xQueueReceive(q_in, &m, portMAX_DELAY) != pdTRUE) continue;

        if (m.kind == IN_SCHEDULE) { handle_schedule(m); continue; }

        /* --- IN_COMMAND --- */

        /* Chong thuc thi 2 lan: broker giao lai ban tin QoS1 thi bo qua,
           web da nhan status cho command_id nay tu lan truoc roi.
           Lich su nay nam trong NVS nen con nguyen sau khi khoi dong lai. */
        if (state_cmd_seen(m.id)) {
            applog("CMD", "ignored %s: already handled (duplicate QoS 1 delivery)", m.id);
            continue;
        }
        state_cmd_remember(m.id);

        /* 1) ACK ngay. "state" o day la trang thai HIEN TAI, chua doi. */
        send_status(m.id, ST_ACK, nullptr);

        if (m.inject_fault) relay_inject_fault(0, true);   /* chi de demo duong FAILED */

        act_req_t r = {};
        strncpy(r.cmd_id, m.id, MAX_ID_LEN - 1);
        r.source  = SRC_CLOUD;
        r.channel = 0;
        r.value   = m.value;

        if (xQueueSend(q_act, &r, pdMS_TO_TICKS(200)) != pdTRUE) {
            /* Khong xep duoc viec -> tra FAILED ngay, dung de web treo o
               ACKNOWLEDGED cho toi khi sweeper danh TIMEOUT. */
            applog("CMD", "actuator queue FULL -> reporting FAILED for %s", m.id);
            send_status(m.id, ST_FAILED, ERR_BUSY);
            state_inc_cmd_fail();
        }
        /* 2) Con lai: task_actuator gui SUCCESS/FAILED sau khi doc lai phan cung. */
    }
}
