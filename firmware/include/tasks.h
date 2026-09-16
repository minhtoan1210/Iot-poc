/**
 * tasks.h - Khai bao cac FreeRTOS task va hang doi dung chung.
 *
 * So do:
 *
 *   [broker] --command--> task_net ==q_in==> task_cmd ==q_act==> task_actuator
 *            --schedule->                       |                     |
 *                                               v                     |
 *                                         schedule.cpp (NVS)          |
 *                                               |                     |
 *                        task_schedule ==q_act==+                     |
 *                                                                     v
 *   [broker] <--status/heartbeat-- task_net <==q_out== (out_msg_t) <---+
 *                                      ^
 *                                 task_health (heartbeat 15s)
 *
 * Nguyen tac: CHI task_net duoc dung MQTT. Moi thu can gui len deu day vao q_out.
 */
#pragma once
#include "config.h"
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

extern QueueHandle_t q_in;    /* in_msg_t  - command + schedule tu web */
extern QueueHandle_t q_act;   /* act_req_t - viec cham vao phan cung   */
extern QueueHandle_t q_out;   /* out_msg_t - ban tin cho publish       */

void tasks_create_queues(void);
void tasks_start_all(void);

/** Helper: day 1 ban tin len q_out tu bat ky task nao. Khong block lau.
 *  persist = true: gui khong duoc thi cat vao outbox NVS thay vi bo. */
bool out_enqueue(out_kind_t kind, bool persist, const char* json);

/** Bao bang lich device dang giu len devices/<id>/schedules.
 *  Goi sau moi lan doi lich va sau khi noi lai broker. */
void out_report_schedules(void);

/** Stack con lai it nhat trong so 6 task, tinh bang byte.
 *  Tut ve gan 0 la sap tran stack - task se chet im lang hoac panic. */
uint32_t tasks_min_stack_free(void);

/** In stack con lai cua tung task (phim 't' tren console). */
void     tasks_log_stacks(void);

/* Than cua tung task (dat trong file rieng cung ten) */
void task_net(void* pv);
void task_cmd(void* pv);
void task_actuator(void* pv);
void task_schedule(void* pv);
void task_health(void* pv);
void task_console(void* pv);

/** In dong STAT tom tat. task_health goi dinh ky, console goi khi bam phim 's'. */
void health_log_summary(void);
