#include <Arduino.h>
#include <WiFi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <string.h>
#include "device.h"
#include "storage.h"

/* ===================================================================
 * PHAN CUNG - drv relay
 * =================================================================== */

static const int s_gpio[RELAY_COUNT]     = { RELAY_GPIO_CH0 };
static const int s_feedback[RELAY_COUNT] = { RELAY_FEEDBACK_CH0 };
static bool      s_fault[RELAY_COUNT]    = { false };

static inline int level_for(bool on) {
#if RELAY_ACTIVE_HIGH
    return on ? HIGH : LOW;
#else
    return on ? LOW : HIGH;
#endif
}
static inline bool on_from_level(int lvl) {
#if RELAY_ACTIVE_HIGH
    return lvl == HIGH;
#else
    return lvl == LOW;
#endif
}

void relay_init(void) {
    for (int i = 0; i < RELAY_COUNT; i++) {
        pinMode(s_gpio[i], OUTPUT);
        digitalWrite(s_gpio[i], level_for(false));   /* mac dinh TAT cho an toan */
        if (s_feedback[i] >= 0) pinMode(s_feedback[i], INPUT_PULLDOWN);
    }
#if LED_STATUS_GPIO >= 0
    pinMode(LED_STATUS_GPIO, OUTPUT);
    digitalWrite(LED_STATUS_GPIO, LOW);
#endif
}

bool relay_read(uint8_t ch) {
    if (ch >= RELAY_COUNT) return false;
    if (s_feedback[ch] >= 0) {
        /* Co day phan hoi that -> day moi la "den co sang khong". */
        return digitalRead(s_feedback[ch]) == HIGH;
    }
    /* Khong co day phan hoi -> doc nguoc lai chan dang lai.
       Lam duoc vi trong Arduino-ESP32, OUTPUT = 0x03 = INPUT|OUTPUT
       (esp32-hal-gpio.h) -> bo dem input van bat, digitalRead() tra ve dung
       muc dang lai. DUNG doi thanh gpio_set_direction(GPIO_MODE_OUTPUT):
       lam vay se tat bo dem input va relay_read() luon tra ve 0.
       Bat duoc loi driver/cau hinh chan, KHONG bat duoc dut day / chay bong. */
    return on_from_level(digitalRead(s_gpio[ch]));
}

bool relay_set(uint8_t ch, bool on) {
    if (ch >= RELAY_COUNT) return false;

    digitalWrite(s_gpio[ch], level_for(on));

    /* Cho tiep diem on dinh roi moi doc phan hoi. */
    vTaskDelay(pdMS_TO_TICKS(RELAY_SETTLE_MS));

    if (s_fault[ch]) {          /* che do test: gia lap phan cung hong */
        s_fault[ch] = false;    /* chi loi 1 lan */
        return false;
    }

    bool actual = relay_read(ch);
    return actual == on;        /* false -> tang tren tra ve FAILED / E_VERIFY_FAILED */
}

void relay_inject_fault(uint8_t ch, bool enable) {
    if (ch < RELAY_COUNT) s_fault[ch] = enable;
}

/* ===================================================================
 * TRANG THAI TOAN CUC
 * =================================================================== */

static SemaphoreHandle_t s_mtx = nullptr;
static char         s_mac_suffix[8] = {0};
static char         s_device_id[DEVICE_ID_MAX] = {0};

static bool         s_relay[RELAY_COUNT]        = {false};
static cmd_source_t s_relay_src[RELAY_COUNT]    = {SRC_BOOT};

static net_state_t  s_net    = NET_DOWN;
static uint32_t     s_cmd_ok = 0, s_cmd_fail = 0;

/* Vong tron nho cac command_id da xu ly -> chong thuc thi 2 lan khi broker
   giao lai ban tin QoS1. */
static char     s_hist[CMD_HISTORY_SIZE][MAX_ID_LEN];
static uint8_t  s_hist_idx = 0;

#define LOCK()   xSemaphoreTake(s_mtx, portMAX_DELAY)
#define UNLOCK() xSemaphoreGive(s_mtx)

void state_init(void) {
    s_mtx = xSemaphoreCreateMutex();

    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_mac_suffix, sizeof(s_mac_suffix), "%02x%02x%02x", mac[3], mac[4], mac[5]);

    /* device_id: NVS thang hon hang so bien dich -> mot ban firmware nap
       duoc nhieu board, khong phai build lai chi de doi ten. */
    if (!storage_load_device_id(s_device_id, sizeof(s_device_id)))
        strncpy(s_device_id, DEVICE_ID, sizeof(s_device_id) - 1);

    /* Lich su command_id song qua reboot: broker giao lai ban tin QoS 1 sau
       khi device khoi dong lai se khong lam den bat/tat lan thu hai. */
    if (!storage_load_cmd_history(s_hist, sizeof(s_hist)))
        memset(s_hist, 0, sizeof(s_hist));
}

const char* state_mac_suffix(void) { return s_mac_suffix; }
const char* state_device_id(void)  { return s_device_id;  }

bool state_set_device_id(const char* id) {
    if (!id || !id[0] || strlen(id) >= DEVICE_ID_MAX) return false;
    if (!storage_save_device_id(id)) return false;
    LOCK();
    strncpy(s_device_id, id, DEVICE_ID_MAX - 1);
    s_device_id[DEVICE_ID_MAX - 1] = '\0';
    UNLOCK();
    return true;
}

void state_set_relay(uint8_t ch, bool on, cmd_source_t src) {
    if (ch >= RELAY_COUNT) return;
    LOCK();
    s_relay[ch]     = on;
    s_relay_src[ch] = src;
    UNLOCK();
}
bool state_get_relay(uint8_t ch) {
    if (ch >= RELAY_COUNT) return false;
    LOCK(); bool v = s_relay[ch]; UNLOCK(); return v;
}
cmd_source_t state_get_relay_source(uint8_t ch) {
    if (ch >= RELAY_COUNT) return SRC_BOOT;
    LOCK(); cmd_source_t v = s_relay_src[ch]; UNLOCK(); return v;
}

void        state_set_net(net_state_t s) { LOCK(); s_net = s; UNLOCK(); }
net_state_t state_get_net(void)          { LOCK(); net_state_t v = s_net; UNLOCK(); return v; }

void     state_inc_cmd_ok(void)   { LOCK(); s_cmd_ok++;   UNLOCK(); }
void     state_inc_cmd_fail(void) { LOCK(); s_cmd_fail++; UNLOCK(); }
uint32_t state_cmd_ok(void)       { LOCK(); uint32_t v = s_cmd_ok;   UNLOCK(); return v; }
uint32_t state_cmd_fail(void)     { LOCK(); uint32_t v = s_cmd_fail; UNLOCK(); return v; }

bool state_cmd_seen(const char* cmd_id) {
    if (!cmd_id || !cmd_id[0]) return false;
    bool found = false;
    LOCK();
    for (int i = 0; i < CMD_HISTORY_SIZE; i++) {
        if (s_hist[i][0] && strncmp(s_hist[i], cmd_id, MAX_ID_LEN - 1) == 0) { found = true; break; }
    }
    UNLOCK();
    return found;
}

void state_cmd_remember(const char* cmd_id) {
    if (!cmd_id || !cmd_id[0]) return;
    LOCK();
    strncpy(s_hist[s_hist_idx], cmd_id, MAX_ID_LEN - 1);
    s_hist[s_hist_idx][MAX_ID_LEN - 1] = '\0';
    s_hist_idx = (s_hist_idx + 1) % CMD_HISTORY_SIZE;
    UNLOCK();
    /* Ghi NVS ngay: lenh den thua hon nhieu so voi so lan ghi flash chiu duoc,
       va mat mot lan ghi la mat luon tac dung chong lap qua reboot. */
    storage_save_cmd_history(s_hist, sizeof(s_hist));
}
