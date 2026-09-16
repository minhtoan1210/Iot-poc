/**
 * task_schedule - Bo dinh gio chay TREN DEVICE.
 *
 * Diem mau chot: task nay khong he biet den MQTT. Mat Internet, mat server,
 * lich van chay binh thuong vi:
 *   - lich nam trong NVS (con sau mat dien)
 *   - gio lay tu RTC noi cua ESP32 (da duoc SNTP chinh truoc do)
 *   - ket qua thuc thi di vao outbox NVS, co mang lai thi tu day len web
 *
 * Catch-up: sau khi mat dien roi co lai, den co the dang sai trang thai so voi lich.
 * Luc boot, tim lan kich hoat gan nhat da qua trong 24h va ap dung lai.
 */
#include <Arduino.h>
#include "tasks.h"
#include "schedule.h"
#include "clock.h"
#include "protocol.h"
#include "log.h"

#define CATCHUP_WAIT_TRUSTED_MS 60000   /* cho SNTP toi da 60s roi moi dung gio "tho" */

static void push_action(const sched_slot_t* sl) {
    act_req_t r = {};
    /* Web khong biet truoc lan chay nay -> device tu sinh command_id.
       Backend nhan status voi id la se cap nhat trang thai den, va ghi nhan
       la mot lan tac dong khong thuoc lenh nao. */
    proto_gen_command_id(r.cmd_id, MAX_ID_LEN);
    r.source  = SRC_SCHEDULE;
    r.channel = 0;
    r.value   = sl->value ? true : false;

    if (xQueueSend(q_act, &r, pdMS_TO_TICKS(500)) != pdTRUE)
        applog("SCHED", "actuator queue full, dropped %s", sl->id);
}

void task_schedule(void* pv) {
    (void)pv;
    bool     catchup_done = false;
    uint32_t boot_ms      = millis();

    for (;;) {
        uint32_t now = time_now();

#if SCHED_CATCHUP_ON_BOOT
        if (!catchup_done && now) {
            bool trusted = time_is_trusted();
            bool waited  = (millis() - boot_ms) > CATCHUP_WAIT_TRUSTED_MS;
            if (trusted || waited) {
                if (!trusted)
                    applog("SCHED", "catch-up using COARSE time from NVS (SNTP not done yet)");
                sched_slot_t sl;
                if (schedule_catchup(now, &sl)) {
                    applog("SCHED", "catch-up: %02u:%02u already passed -> setting output %s",
                           sl.hh, sl.mm, sl.value ? "ON" : "OFF");
                    push_action(&sl);
                }
                catchup_done = true;
            }
        }
#else
        catchup_done = true;
#endif

        sched_slot_t sl;
        if (schedule_due(now, &sl)) {
            applog("SCHED", "DUE %02u:%02u -> %s  (%s)",
                   sl.hh, sl.mm, sl.value ? "ON" : "OFF", sl.id);
            push_action(&sl);
        }

        vTaskDelay(pdMS_TO_TICKS(SCHED_TICK_MS));
    }
}
