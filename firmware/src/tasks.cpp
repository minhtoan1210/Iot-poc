#include <Arduino.h>
#include <string.h>
#include "tasks.h"
#include "protocol.h"
#include "storage.h"
#include "log.h"

QueueHandle_t q_in  = nullptr;
QueueHandle_t q_act = nullptr;
QueueHandle_t q_out = nullptr;

void tasks_create_queues(void) {
    q_in  = xQueueCreate(Q_IN_DEPTH,  sizeof(in_msg_t));
    q_act = xQueueCreate(Q_ACT_DEPTH, sizeof(act_req_t));
    q_out = xQueueCreate(Q_OUT_DEPTH, sizeof(out_msg_t));
    configASSERT(q_in && q_act && q_out);
    applog("BOOT", "queues ready: in %d, act %d, out %d (%u bytes RAM)",
           Q_IN_DEPTH, Q_ACT_DEPTH, Q_OUT_DEPTH,
           (unsigned)(Q_IN_DEPTH * sizeof(in_msg_t) + Q_ACT_DEPTH * sizeof(act_req_t)
                      + Q_OUT_DEPTH * sizeof(out_msg_t)));
}

bool out_enqueue(out_kind_t kind, bool persist, const char* json) {
    if (!json || !json[0]) return false;

    out_msg_t m;
    m.kind    = kind;
    m.persist = persist;
    strncpy(m.json, json, MAX_OUT_JSON_LEN - 1);
    m.json[MAX_OUT_JSON_LEN - 1] = '\0';

    if (xQueueSend(q_out, &m, pdMS_TO_TICKS(100)) == pdTRUE) return true;

    /* Hang doi day (thuong la dang mat mang va task_net chua kip xu ly).
       Ban tin quan trong thi cat thang vao outbox NVS, con lai thi bo. */
    applog("NET", "outbound queue FULL");
    if (persist) storage_outbox_push(m.json);
    return false;
}

void out_report_schedules(void) {
    char j[MAX_OUT_JSON_LEN];
    /* persist = false: bang lich cu khong con gia tri, gui lai duoc bat cu luc nao. */
    if (proto_build_schedules(j, sizeof(j))) out_enqueue(OUT_SCHEDULES, false, j);
}

/* Giu handle de doc duoc stack con lai cua tung task luc chay. */
#define TASK_COUNT 6
static TaskHandle_t s_handle[TASK_COUNT];
static const char*  s_name[TASK_COUNT] = { "net", "cmd", "act", "sched", "health", "cons" };

void tasks_start_all(void) {
    xTaskCreatePinnedToCore(task_net,      "net",    TASK_NET_STACK,    nullptr, TASK_NET_PRIO,    &s_handle[0], CORE_NET);
    xTaskCreatePinnedToCore(task_cmd,      "cmd",    TASK_CMD_STACK,    nullptr, TASK_CMD_PRIO,    &s_handle[1], CORE_APP);
    xTaskCreatePinnedToCore(task_actuator, "act",    TASK_ACT_STACK,    nullptr, TASK_ACT_PRIO,    &s_handle[2], CORE_APP);
    xTaskCreatePinnedToCore(task_schedule, "sched",  TASK_SCHED_STACK,  nullptr, TASK_SCHED_PRIO,  &s_handle[3], CORE_APP);
    xTaskCreatePinnedToCore(task_health,   "health", TASK_HEALTH_STACK, nullptr, TASK_HEALTH_PRIO, &s_handle[4], CORE_APP);
    xTaskCreatePinnedToCore(task_console,  "cons",   TASK_CONS_STACK,   nullptr, TASK_CONS_PRIO,   &s_handle[5], CORE_APP);
}

/* uxTaskGetStackHighWaterMark tren ESP-IDF tra ve BYTE (FreeRTOS goc tra ve word). */
uint32_t tasks_min_stack_free(void) {
    uint32_t lowest = UINT32_MAX;
    for (int i = 0; i < TASK_COUNT; i++) {
        if (!s_handle[i]) continue;
        uint32_t free_bytes = uxTaskGetStackHighWaterMark(s_handle[i]);
        if (free_bytes < lowest) lowest = free_bytes;
    }
    return (lowest == UINT32_MAX) ? 0 : lowest;
}

void tasks_log_stacks(void) {
    applog("STAT", "stack con lai (byte, thap nhat ke tu luc boot):");
    for (int i = 0; i < TASK_COUNT; i++) {
        if (!s_handle[i]) { applog("STAT", "  %-6s CHUA TAO DUOC", s_name[i]); continue; }
        applog("STAT", "  %-6s %u", s_name[i],
               (unsigned)uxTaskGetStackHighWaterMark(s_handle[i]));
    }
}
