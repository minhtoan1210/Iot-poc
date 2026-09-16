#include <Arduino.h>
#include <stdarg.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "log.h"
#include "config.h"
#include "device.h"

static SemaphoreHandle_t s_mtx = nullptr;

void applog_init(void) {
    s_mtx = xSemaphoreCreateMutex();
}

void applog(const char* tag, const char* fmt, ...) {
    char msg[256];   /* du cho in nguyen mot ban tin status */
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);

    /* Giu nguyen ca dong khi nhieu task cung in. */
    if (s_mtx) xSemaphoreTake(s_mtx, pdMS_TO_TICKS(100));
    Serial.printf("[%7.2fs] %-6s %s\n", millis() / 1000.0f, tag, msg);
    if (s_mtx) xSemaphoreGive(s_mtx);
}

void applog_banner(void) {
    if (s_mtx) xSemaphoreTake(s_mtx, pdMS_TO_TICKS(100));
    Serial.println();
    Serial.println("===============================================================");
    Serial.printf ("  IoT PoC firmware v%s\n", FW_VERSION);
    Serial.printf ("  Device   %s\n", state_device_id());
    Serial.printf ("  Chip     %s, %d MHz, %u MB flash\n",
                   ESP.getChipModel(), ESP.getCpuFreqMHz(),
                   (unsigned)(ESP.getFlashChipSize() / (1024 * 1024)));
    Serial.printf ("  Broker   %s:%d\n", CFG_MQTT_HOST, CFG_MQTT_PORT);
    Serial.println("===============================================================");
    if (s_mtx) xSemaphoreGive(s_mtx);
}

void applog_rule(const char* title) {
    if (s_mtx) xSemaphoreTake(s_mtx, pdMS_TO_TICKS(100));
    Serial.printf("--- %s %.*s\n", title,
                  (int)(56 - strlen(title)),
                  "--------------------------------------------------------");
    if (s_mtx) xSemaphoreGive(s_mtx);
}

const char* applog_mqtt_err(int state) {
    switch (state) {
        case -4: return "-4 broker did not respond in time";
        case -3: return "-3 TCP connection lost";
        case -2: return "-2 cannot open TCP to broker (wrong host? broker down? firewall?)";
        case -1: return "-1 broker closed the connection";
        case  0: return "0 connected";
        case  1: return "1 rejected: unsupported protocol version";
        case  2: return "2 rejected: client id not accepted";
        case  3: return "3 broker unavailable";
        case  4: return "4 rejected: bad username or password";
        case  5: return "5 rejected: not authorised";
        default: return "unknown error code";
    }
}
