/**
 * task_console - Phim tat tren serial.
 *
 * Muc dich: dien duoc cac kich ban loi ngay tren board ma khong phai rut day
 * router hay thao tai. Go mot ky tu roi Enter trong cua so `pio device monitor`.
 *
 * Khong co phim nao GHI DE trang thai that: 'f' chi ep lan dong cat ke tiep
 * bao loi (dung duong xac minh trong device.cpp), 'd' ngat mang that su.
 */
#include <Arduino.h>
#include <ctype.h>
#include "tasks.h"
#include "device.h"
#include "net.h"
#include "schedule.h"
#include "storage.h"
#include "clock.h"
#include "log.h"

static void print_help(void) {
    applog("CONS", "keys:  h help | s status | l schedules | o outbox | t task stacks");
    applog("CONS", "       i set device_id (stored in NVS)");
    applog("CONS", "       f force a hardware fault on the next switch");
    applog("CONS", "       d simulate a %lu s network outage", (unsigned long)(CONSOLE_FAKE_DOWN_MS / 1000));
    applog("CONS", "       r reboot");
}

/* Doc mot dong tu serial. Bo qua Enter thua truoc khi co ky tu dau tien. */
static bool read_line(char* buf, size_t len, uint32_t timeout_ms) {
    size_t   n  = 0;
    uint32_t t0 = millis();
    while (millis() - t0 < timeout_ms) {
        while (Serial.available() > 0) {
            int c = Serial.read();
            t0 = millis();
            if (c == '\n' || c == '\r') {
                if (n == 0) continue;          /* Enter con lai cua dong truoc */
                buf[n] = '\0';
                return true;
            }
            if (n + 1 < len) buf[n++] = (char)c;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    return false;
}

static void set_device_id(void) {
    applog("CONS", "current device_id: %s", state_device_id());
    applog("CONS", "type a new id then Enter (15s to answer):");

    char id[DEVICE_ID_MAX];
    if (!read_line(id, sizeof(id), 15000)) {
        applog("CONS", "timed out, device_id unchanged");
        return;
    }
    if (!state_set_device_id(id)) {
        applog("CONS", "rejected: empty or longer than %d characters", DEVICE_ID_MAX - 1);
        return;
    }
    applog("CONS", "device_id saved to NVS: %s", id);
    applog("CONS", "press 'r' to reboot - topics are built once at startup");
}

static void print_outbox(void) {
    uint16_t n = storage_outbox_count();
    if (n == 0) { applog("CONS", "outbox empty, nothing waiting to be sent"); return; }

    char buf[OUTBOX_ITEM_MAX];
    applog("CONS", "outbox holds %u message(s), oldest:", n);
    if (storage_outbox_peek(buf, sizeof(buf))) applog("CONS", "  %s", buf);
}

void task_console(void* pv) {
    (void)pv;
    applog("CONS", "type 'h' + Enter for the key list");

    for (;;) {
        while (Serial.available() > 0) {
            int c = tolower(Serial.read());
            switch (c) {
            case 'h': print_help(); break;
            case 's': health_log_summary(); break;
            case 'l': schedule_log_all(); break;
            case 'o': print_outbox(); break;
            case 'i': set_device_id(); break;
            case 't': tasks_log_stacks(); break;

            case 'f':
                relay_inject_fault(0, true);
                applog("CONS", "next switch will report FAILED - press ON/OFF on the web to see it");
                break;

            case 'd':
                wifi_force_down(CONSOLE_FAKE_DOWN_MS);
                break;

            case 'r':
                applog("CONS", "rebooting...");
                vTaskDelay(pdMS_TO_TICKS(200));
                ESP.restart();
                break;

            default: break;      /* bo qua Enter, khoang trang, phim la */
            }
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
