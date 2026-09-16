/**
 * task_health - Nhip tim cua thiet bi.
 *   - Bom clock.cpp (phat hien SNTP xong, resync dinh ky, luu moc gio vao NVS)
 *   - Moi 15s publish heartbeat -> web giu device o trang thai ONLINE.
 *     Im qua 45s (3 nhip) la sweeper ben web danh OFFLINE (API.md muc 2.9).
 *   - Nhap nhay LED bao trang thai mang (neu co).
 */
#include <Arduino.h>
#include "tasks.h"
#include "protocol.h"
#include "clock.h"
#include "device.h"
#include "log.h"
#include "net.h"
#include "storage.h"
#include "schedule.h"

/* Mot dong tom tat - du de biet thiet bi dang the nao ma khong lam ngap
   man hinh serial. In dinh ky 15s, hoac ngay lap tuc khi bam 's' tren console. */
void health_log_summary(void) {
    net_state_t ns = state_get_net();
    applog("STAT", "net=%-8s rssi=%ddBm | load=%s | clock=%-6s | schedules=%u | "
                   "outbox=%u | ok/fail=%lu/%lu | heap=%uKB | stack=%luB | uptime=%lus",
           ns == NET_MQTT_OK ? "mqtt-up" : ns == NET_WIFI_OK ? "wifi-only" : "down",
           wifi_rssi(),
           relay_read(0) ? "ON " : "OFF",
           time_is_trusted() ? "synced" : (time_is_valid() ? "coarse" : "unset"),
           schedule_count(),
           storage_outbox_count(),
           (unsigned long)state_cmd_ok(), (unsigned long)state_cmd_fail(),
           (unsigned)(ESP.getFreeHeap() / 1024),
           (unsigned long)tasks_min_stack_free(),
           (unsigned long)(millis() / 1000));
}

void task_health(void* pv) {
    (void)pv;
    uint32_t last_beat_ms = 0;
    bool     led_on = false;

    for (;;) {
        time_tick();

        uint32_t now = millis();
        if (now - last_beat_ms >= HEARTBEAT_PERIOD_MS) {
            last_beat_ms = now;

            /* persist = false: heartbeat cu khong con gia tri, mat mang thi bo. */
            char j[MAX_OUT_JSON_LEN];
            if (proto_build_heartbeat(j, sizeof(j)))
                out_enqueue(OUT_HEARTBEAT, false, j);

            health_log_summary();
        }

#if LED_STATUS_GPIO >= 0
        /* MQTT OK: sang lien. WiFi OK / mat mang: nhap nhay. */
        net_state_t ns = state_get_net();
        if (ns == NET_MQTT_OK)      { digitalWrite(LED_STATUS_GPIO, HIGH); }
        else                        { led_on = !led_on; digitalWrite(LED_STATUS_GPIO, led_on); }
#else
        (void)led_on;
#endif
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
