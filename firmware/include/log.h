/**
 * app_log.h - Log ra serial cho NGUOI DOC, khong phai cho may doc.
 *
 * Moi dong co dang:
 *
 *     [   3.12s] WIFI   OK  ip=192.168.1.193  rssi=-47dBm
 *     ^ moc thoi gian  ^ khoi  ^ noi dung
 *
 * Vi sao khong dung log_i() cua Arduino: no in kem ten file, so dong, ten ham
 * (`[ 3120][I][net.cpp:42] wifi_loop():`) va tron lan voi log noi bo cua
 * ESP-IDF -> nhin man hinh serial khong ra duoc dang dien bien.
 *
 * Cac khoi (tag) co dinh 6 ky tu cho de doc theo cot:
 *   BOOT NVS RELAY WIFI TIME MQTT SCHED CMD ACT STAT NET
 */
#pragma once
#include <stdint.h>

void applog_init(void);

/** In mot dong log. Co mutex ben trong nen cac task khong cat dong cua nhau. */
void applog(const char* tag, const char* fmt, ...) __attribute__((format(printf, 2, 3)));

/** Khung tieu de luc khoi dong. */
void applog_banner(void);

/** Dong ke ngang, de tach cac giai doan. */
void applog_rule(const char* title);

/* Dich ma loi cua PubSubClient sang tieng nguoi. */
const char* applog_mqtt_err(int state);
