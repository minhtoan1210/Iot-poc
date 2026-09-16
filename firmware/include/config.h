/**
 * config.h - Hang so cau hinh + kieu du lieu dung chung.
 *
 * Sua o day, khong rai magic number trong code. File nay khong phu thuoc vao
 * file nao khac cua du an, moi file khac deu include no.
 *
 * Gom hai phan:
 *   1. CAU HINH - chan GPIO, timeout, kich thuoc hang doi, stack cua task
 *   2. KIEU     - struct di qua hang doi FreeRTOS va blob luu trong NVS
 */
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

/* Thong tin WiFi / broker: xem include/secrets.example.h */
#include "secrets.h"

/* ---------- Identity ----------
 * device_id PHAI trung voi DEVICE_ID trong app/dashboard-client.tsx cua web
 * (mac dinh "esp32-001"). Khong sinh tu MAC nua: web dang bam cung 1 thiet bi. */
#define DEVICE_ID            "esp32-001"   /* mac dinh; NVS co the ghi de - xem storage.h */
#define DEVICE_ID_MAX        32
#define TOPIC_ROOT           "devices"       /* devices/<id>/command|schedule|status|heartbeat */

/* ---------- Phan cung ---------- */
#define RELAY_COUNT          1                /* so kenh dieu khien (PoC: 1 den) */
/* ---- Chan dieu khien tai ----
 *
 * Ban do chan cua ESP32 classic (ESP32-D0WD), theo tai lieu ESP-IDF:
 *
 *   NEN DUNG cho tai    4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27
 *                       -> lai output duoc, khong vuong flash, khong phai strapping pin
 *
 *   CAN THAN            0, 2, 5, 12, 15   strapping pin: muc dien ap luc khoi dong
 *                                      quyet dinh che do boot. Mac LED keo xuong mass
 *                                      thi khong sao (DevKit van dung GPIO 2), nhung
 *                                      mac relay keo len muc cao co the lam board
 *                                      khong nap duoc hoac khong boot.
 *                       32, 33         lai output duoc nhung dung chung voi
 *                                      thach anh 32kHz tren mot so module
 *                       16, 17         PSRAM tren ban WROVER (WROOM thi dung thoai mai)
 *
 *   KHONG DUOC          6..11          noi thang vao chip flash SPI, dung la treo
 *                       34..39         INPUT-ONLY: trong silicon khong co mach
 *                                      driver output. digitalWrite() khong co tac
 *                                      dung, chan tha noi. Xem SOC_GPIO_VALID_OUTPUT_
 *                                      GPIO_MASK trong soc_caps.h cua ESP-IDF:
 *                                      mask nay loai tru dung BIT34..BIT39.
 *                                      (Cac chan nay khong co ca dien tro keo noi.)
 *                       24, 28..31     khong ton tai tren chip
 *
 * 34..39 van rat hop de LAM CHAN PHAN HOI (RELAY_FEEDBACK_CH0) - viec cua chung
 * la doc, va chung co ADC1 nen doc duoc ca dien ap tuong tu.
 *
 * Luu y: tren ESP32-S3 khong co han che nay (mask output = mask valid), nen
 * chan 34 lai output binh thuong. Khac biet giua hai dong chip, rat de nham. */
#define RELAY_GPIO_CH0       5

/* GPIO 5 LA STRAPPING PIN (chon thoi diem SDIO slave). Chip co dien tro KEO LEN
 * san ben trong, nen trong ~0.2s dau luc boot chan nay o MUC CAO truoc khi
 * relay_init() keo no ve muc tat. Hau qua theo cach dau tai:
 *   - Module relay kich muc THAP (pho bien nhat): keo len = TAT -> khong sao.
 *   - Dau truc tiep muc CAO (RELAY_ACTIVE_HIGH = 1): tai co the NHAP MOT CAI
 *     luc cap dien. Khong hong gi, nhung neu khong muon thay den chop thi
 *     doi RELAY_ACTIVE_HIGH ve 0, hoac dung chan khong phai strapping (4, 18,
 *     19, 21, 22, 23, 25, 26, 27).
 * Khong dung SDIO slave thi muc cua chan 5 luc boot khong anh huong gi khac. */

#if (RELAY_GPIO_CH0 >= 34) && (RELAY_GPIO_CH0 <= 39)
#error "ESP32 classic: GPIO 34-39 la input-only, khong lam chan dieu khien tai duoc."
#endif
#define RELAY_ACTIVE_HIGH    1                /* 1 = muc cao bat. Relay module thuong la 0 */

/* Chan phan hoi (feedback) de XAC MINH den that su sang.
 * = -1  : khong co day phan hoi -> doc nguoc lai GPIO dang lai (readback).
 * >= 0  : doc chan nay (vd: tiep diem phu cua relay, hoac opto do dong tai).
 * Day la thu bien "server bao da bat" thanh "device xac nhan da bat". */
#define RELAY_FEEDBACK_CH0   (-1)
#define RELAY_SETTLE_MS      30               /* cho relay dong/mo xong roi moi doc feedback */

/* LED bao trang thai mang: sang lien = MQTT OK, nhap nhay = chua noi duoc.
 * GPIO 2 la LED gan san tren hau het ban DevKit. Dat -1 neu khong muon dung. */
#define LED_STATUS_GPIO      2

/* ---------- Mang ---------- */
#define WIFI_CONNECT_TIMEOUT_MS   15000
#define WIFI_RETRY_MIN_MS         1000        /* backoff toi thieu khi reconnect */
#define WIFI_RETRY_MAX_MS         30000       /* backoff toi da */
#define MQTT_KEEPALIVE_S          20          /* -> broker phat hien chet sau ~1.5x = 30s */
#define MQTT_RETRY_MIN_MS         1000
#define MQTT_RETRY_MAX_MS         30000
#define MQTT_SUB_QOS              1           /* at-least-once cho command + schedule */

/* ---------- Thoi gian ---------- */
#define NTP_SERVER_1         "pool.ntp.org"
#define NTP_SERVER_2         "time.google.com"
#define NTP_RESYNC_MS        (6UL * 3600UL * 1000UL)   /* dong bo lai moi 6 gio */
#define TIME_VALID_EPOCH     1700000000UL              /* < moc nay coi nhu chua co gio that */
#define TIME_PERSIST_MS      (5UL * 60UL * 1000UL)     /* luu epoch vao NVS de boot sau con moc tho */

/* ---------- Lich ---------- */
#define SCHED_MAX_SLOTS      8
#define SCHED_ID_MAX         32              /* "schedule-a1b2c3d4" + du phong */
#define SCHED_TICK_MS        1000            /* quet lich moi giay */
#define SCHED_DEFAULT_TZ_MIN 420             /* UTC+7 (Asia/Ho_Chi_Minh) - "HH:MM" la gio dia phuong */
#define SCHED_CATCHUP_ON_BOOT 1              /* boot xong: ap dung slot gan nhat da qua trong ngay */

/* ---------- Hang doi / bo nho ---------- */
#define MAX_ID_LEN           41              /* command_id / schedule_id */
#define MAX_OUT_JSON_LEN     768             /* ban tin dai nhat la bang lich (8 slot) */
#define Q_IN_DEPTH           6
#define Q_ACT_DEPTH          6
#define Q_OUT_DEPTH          10

/* ---------- Outbox (hang doi khi mat mang) ---------- */
#define OUTBOX_MAX           20              /* so ban tin luu trong NVS cho toi khi gui duoc */
#define OUTBOX_ITEM_MAX      320             /* cat bot ban tin dai hon muc nay */

/* ---------- Dedupe ---------- */
#define CMD_HISTORY_SIZE     8               /* nho 8 command_id gan nhat (QoS1 co the giao 2 lan) */

/* ---------- Heartbeat ---------- */
#define HEARTBEAT_PERIOD_MS  15000           /* web coi la OFFLINE neu im qua 45s */

/* ---------- FreeRTOS: stack (word) & priority ---------- */
/* Stack tinh bang BYTE (Arduino-ESP32, khac FreeRTOS goc dung word).
 * Task nao dung ban tin JSON deu om mot buffer MAX_OUT_JSON_LEN tren stack,
 * nen sua hang so do la phai xem lai cac con so duoi day.
 * Xem stack con lai luc chay: phim 't' tren console, hoac truong stack= o dong STAT. */
#define TASK_NET_STACK       8192            /* + out_msg_t (~776B) + buffer JSON + WiFi/MQTT */
#define TASK_NET_PRIO        5
#define TASK_CMD_STACK       8192            /* + buffer JSON + ArduinoJson khi bao bang lich */
#define TASK_CMD_PRIO        4
#define TASK_ACT_STACK       6144            /* + buffer JSON */
#define TASK_ACT_PRIO        6               /* cao nhat: dong cat tai phai kip */
#define TASK_SCHED_STACK     4096
#define TASK_SCHED_PRIO      3
#define TASK_HEALTH_STACK    6144            /* + buffer JSON + dong STAT nhieu tham so */
#define TASK_HEALTH_PRIO     2
#define TASK_CONS_STACK      4096            /* + buffer doc outbox */
#define TASK_CONS_PRIO       1               /* thap nhat: go phim khong duoc chen viec that */

/* Phim 'd' tren serial gia lap mat mang bao lau */
#define CONSOLE_FAKE_DOWN_MS 20000

/* Gan task vao core: 0 = core WiFi/BT, 1 = core ung dung */
#define CORE_NET             0
#define CORE_APP             1

/* ---------- Firmware ---------- */
#ifndef FW_VERSION
#define FW_VERSION           "0.0.0-dev"
#endif

/* ===================================================================
 * KIEU DU LIEU DUNG CHUNG
 *
 * Tat ca struct o day deu la POD (copy-by-value) vi FreeRTOS queue copy byte.
 * KHONG dat String / con tro tro vao heap trong nay.
 * Giao thuc: API.md muc 2 (MQTT Payload).
 * =================================================================== */

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

/* ---------- Nguon goc cua mot lan tac dong ---------- */
typedef enum {
    SRC_CLOUD = 0,      /* lenh tu web (devices/<id>/command) */
    SRC_SCHEDULE,       /* lich tu chay tren device */
    SRC_BOOT            /* khoi phuc trang thai luc boot */
} cmd_source_t;

/* ---------- Ma loi (gui len server trong truong "error" cua status) ---------- */
#define ERR_NONE            ""
#define ERR_VERIFY          "VERIFY_FAILED"   /* da lai GPIO nhung doc lai khong khop */
#define ERR_BUSY            "DEVICE_BUSY"     /* hang doi thuc thi day */

/* ============================================================
 * 1) in_msg_t : task_net  --q_in-->  task_cmd
 *    Mot ban tin den, da parse. Hai topic dung chung mot hang doi.
 * ============================================================ */
typedef enum {
    IN_COMMAND = 0,     /* devices/<id>/command  */
    IN_SCHEDULE         /* devices/<id>/schedule */
} in_kind_t;

typedef struct {
    in_kind_t kind;
    char      id[MAX_ID_LEN];   /* command_id, hoac schedule_id */
    bool      value;            /* "ON" -> true, "OFF" -> false */
    uint8_t   hh;               /* chi IN_SCHEDULE: gio dia phuong */
    uint8_t   mm;
    bool      enabled;          /* IN_SCHEDULE: lich dang bat hay tam tat */
    bool      remove;           /* IN_SCHEDULE: action="delete" -> xoa khoi NVS */
    bool      has_tz;           /* IN_SCHEDULE: server co gui tz_offset_min khong */
    int16_t   tz_offset_min;    /* vd 420 = UTC+7. Server la nguoi quyet dinh. */
    bool      inject_fault;     /* chi de test duong FAILED, web khong gui truong nay */
} in_msg_t;

/* ============================================================
 * 2) act_req_t : task_cmd / task_schedule  --q_act-->  task_actuator
 * ============================================================ */
typedef struct {
    char          cmd_id[MAX_ID_LEN];     /* command_id tu web, hoac id sinh cuc bo khi lich chay */
    cmd_source_t  source;
    uint8_t       channel;
    bool          value;
} act_req_t;

/* ============================================================
 * 3) out_msg_t : moi task  --q_out-->  task_net (nguoi duy nhat duoc publish)
 * ============================================================ */
typedef enum {
    OUT_STATUS = 0,     /* devices/<id>/status     ACK / ket qua thuc thi */
    OUT_HEARTBEAT,      /* devices/<id>/heartbeat  nhip tim 15s, co kem trang thai den */
    OUT_SCHEDULES,      /* devices/<id>/schedules  bang lich device dang thuc su giu */
    OUT_BIRTH           /* devices/<id>/lwt        {online:true} retained, de len tren LWT */
} out_kind_t;

typedef struct {
    out_kind_t kind;
    bool       persist;                   /* true = gui that bai thi cat vao outbox NVS */
    char       json[MAX_OUT_JSON_LEN];
} out_msg_t;

/* ============================================================
 * 4) Lich - luu trong NVS dang blob
 *    Web gui TUNG lich mot qua devices/<id>/schedule, device tu gop lai.
 * ============================================================ */
typedef struct __attribute__((packed)) {
    char     id[SCHED_ID_MAX];  /* schedule_id tu server - khoa de cap nhat/chong trung */
    uint8_t  enable;            /* 0/1 */
    uint8_t  hh;                /* 0..23 gio dia phuong */
    uint8_t  mm;                /* 0..59 */
    uint8_t  value;             /* 0 = OFF, 1 = ON */
} sched_slot_t;

typedef struct __attribute__((packed)) {
    uint32_t     magic;                     /* nhan dang blob hop le */
    int16_t      tz_offset_min;             /* vd 420 = UTC+7 */
    uint8_t      count;
    uint8_t      _pad;
    sched_slot_t slots[SCHED_MAX_SLOTS];
} schedule_t;

#define SCHEDULE_MAGIC  0x494F5431UL        /* "IOT1" */

/* ---------- Trang thai ket noi (de log / LED bao hieu) ---------- */
typedef enum {
    NET_DOWN = 0,
    NET_WIFI_OK,
    NET_MQTT_OK
} net_state_t;
