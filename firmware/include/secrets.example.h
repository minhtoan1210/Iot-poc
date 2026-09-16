/**
 * secrets.example.h
 * ---------------------------------------------------------------
 * Copy file nay thanh  include/secrets.h  roi dien thong tin that.
 * secrets.h nam trong .gitignore -> khong bao gio len repo.
 * ---------------------------------------------------------------
 */
#pragma once

#define CFG_WIFI_SSID   "TEN_WIFI"
#define CFG_WIFI_PASS   "MAT_KHAU_WIFI"

/* Broker PHAI trung voi MQTT_BROKER_URL trong .env.local cua web.
 * Mac dinh cua du an: broker cong khai broker.emqx.io:1883 (khong TLS, khong auth).
 * Chay broker rieng trong LAN thi thay bang IP may do - KHONG dung 127.0.0.1. */
#define CFG_MQTT_HOST   "broker.emqx.io"
#define CFG_MQTT_PORT   1883
#define CFG_MQTT_USER   ""
#define CFG_MQTT_PASS   ""
