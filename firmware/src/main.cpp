/**
 * main.cpp - Khoi tao he thong roi trao quyen cho FreeRTOS.
 *
 * THU TU KHOI TAO CO Y NGHIA - doi la treo:
 *   storage -> state -> relay -> time -> schedule -> khoi phuc trang thai -> queue -> task
 *
 *   storage TRUOC state  : state_init() doc device_id va lich su lenh tu NVS,
 *                          ma NVS chua mo thi mutex cua no con NULL -> assert.
 *   state   TRUOC banner : banner in device_id that (co the nam trong NVS).
 *   schedule/time can storage; khoi phuc relay can ca hai.
 */
#include <Arduino.h>
#include "config.h"
#include "device.h"
#include "storage.h"
#include "clock.h"
#include "schedule.h"
#include "log.h"
#include "tasks.h"

static void restore_last_output(void) {
    /* Sau mat dien: dua den ve dung trang thai truoc do.
       Neu chua tung co gi trong NVS thi giu TAT cho an toan. */
    for (uint8_t ch = 0; ch < RELAY_COUNT; ch++) {
        bool on = false;
        if (!storage_load_relay(ch, &on)) continue;
        if (!on) continue;
        if (relay_set(ch, on)) {
            state_set_relay(ch, on, SRC_BOOT);
            applog("RELAY", "channel %u restored to ON (state before power loss)", ch);
        } else {
            applog("RELAY", "channel %u restore FAILED", ch);
        }
    }
}

void setup(void) {
    Serial.begin(115200);
    delay(400);                 /* cho serial on dinh, khong mat dong dau */

    applog_init();
    storage_init();     /* mo NVS truoc: state_init() doc du lieu tu day */
    state_init();
    applog_banner();

    applog_rule("Startup");
    applog("NVS", "ready, outbox holds %u unsent message(s)", storage_outbox_count());
    relay_init();
    applog("RELAY", "channel 0 on GPIO %d, active %s, feedback via %s",
           RELAY_GPIO_CH0, RELAY_ACTIVE_HIGH ? "HIGH" : "LOW",
           RELAY_FEEDBACK_CH0 >= 0 ? "dedicated pin" : "GPIO readback");
    time_init();
    schedule_init();
    restore_last_output();

    tasks_create_queues();
    tasks_start_all();
    applog("BOOT", "6 tasks started, %u KB heap free",
           (unsigned)(ESP.getFreeHeap() / 1024));
    applog_rule("Network");
}

void loop(void) {
    /* Moi viec nam trong cac task. Giu loopTask ranh de khong an CPU. */
    vTaskDelay(pdMS_TO_TICKS(1000));
}
