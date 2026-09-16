/**
 * task_actuator - Noi duy nhat cham vao phan cung.
 *
 * Day la cho "web bao da bat" bien thanh "device xac nhan da bat":
 * relay_set() lai chan roi DOC LAI trang thai thuc te. Khong khop -> FAILED.
 *
 * Moi lan tac dong deu bao ve mot ban tin status. Lenh tu web mang theo
 * command_id cua web; lich tu chay mang command_id sinh cuc bo.
 */
#include <Arduino.h>
#include "tasks.h"
#include "device.h"
#include "protocol.h"
#include "storage.h"
#include "clock.h"
#include "log.h"

void task_actuator(void* pv) {
    (void)pv;
    act_req_t r;

    for (;;) {
        if (xQueueReceive(q_act, &r, portMAX_DELAY) != pdTRUE) continue;

        uint32_t t0 = millis();
        bool     ok = relay_set(r.channel, r.value);        /* lai chan + doc lai de xac minh */
        uint32_t ms = millis() - t0;

        if (ok) {
            state_set_relay(r.channel, r.value, r.source);
            storage_save_relay(r.channel, r.value);         /* mat dien -> boot lai khoi phuc dung */
            state_inc_cmd_ok();
        } else {
            state_inc_cmd_fail();
        }

        applog("ACT", "channel %u -> %-3s  readback %-8s => %s  (%lu ms, source: %s)",
               r.channel, r.value ? "ON" : "OFF",
               ok ? "match" : "MISMATCH", ok ? "SUCCESS" : "FAILED",
               (unsigned long)ms, proto_source_str(r.source));

        /* persist = true: ket qua thuc thi KHONG duoc mat khi dang offline.
           Mat mang thi vao outbox NVS, co mang lai task_net day len. */
        char j[MAX_OUT_JSON_LEN];
        proto_build_status(j, sizeof(j), r.cmd_id, ok ? ST_SUCCESS : ST_FAILED,
                           relay_read(r.channel), ok ? nullptr : ERR_VERIFY, time_now());
        out_enqueue(OUT_STATUS, true, j);
    }
}
