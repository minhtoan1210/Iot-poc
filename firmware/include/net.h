/**
 * net.h - Mang: WiFi va MQTT.
 *
 * CHI task_net duoc goi cac ham trong file nay - PubSubClient khong thread-safe.
 * Task khac muon gui gi len thi day vao q_out (xem tasks.h).
 */
#pragma once
#include "config.h"



/* ===================================================================
 * WIFI
 * =================================================================== */

#include <stdbool.h>
#include <stdint.h>

void wifi_setup(void);
/** Goi lien tuc trong task_net. Tu ket noi lai khi rot, backoff 1s -> 30s. */
void wifi_loop(void);

/** Test: ngat WiFi va CHAN khong cho noi lai trong ms mili giay.
 *  Dung de dien kich ban mat mang ma khong phai rut day router. */
void wifi_force_down(uint32_t ms);
bool wifi_is_up(void);
int  wifi_rssi(void);
const char* wifi_ip(void);

/* ===================================================================
 * MQTT
 * =================================================================== */

void mqtt_setup(void);
bool mqtt_connect(void);          /* 1 lan thu ket noi + subscribe */
void mqtt_loop(void);             /* bom PubSubClient, xu ly ban tin den */
bool mqtt_is_up(void);
void mqtt_disconnect(void);

/** Publish 1 ban tin. @return false neu that bai (mat ket noi / qua kich thuoc). */
bool mqtt_publish_out(const out_msg_t* m);

/** Publish JSON tho len topic status (dung khi day outbox luc co mang lai). */
bool mqtt_publish_status_raw(const char* json);
