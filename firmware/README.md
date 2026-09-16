# Firmware ESP32

Bản đồ để tìm chỗ cần sửa. Giao thức và bối cảnh hệ thống ở [../README.md](../README.md) và [../API.md](../API.md).

```bash
make secrets       # lần đầu: tạo include/secrets.h rồi điền WiFi + broker
make flash         # nạp + mở serial luôn
```

`make` không tham số để xem hết lệnh. Vài cái hay dùng:

| Lệnh | Việc |
|---|---|
| `make build` | chỉ biên dịch |
| `make flash` | nạp rồi mở serial — vòng lặp thường dùng nhất |
| `make monitor` | chỉ mở serial (Ctrl-C để thoát) |
| `make ports` | board đang ở cổng nào |
| `make size` | firmware chiếm bao nhiêu RAM / Flash |
| `make erase` | xoá sạch flash — mất `device_id`, lịch trong NVS, outbox |

Board không tự nhận đúng cổng thì chỉ định: `make flash PORT=/dev/ttyUSB0`.

Không dùng `make` thì gọi thẳng PlatformIO: `pio run -t upload`, `pio device monitor -b 115200`.

## Muốn sửa gì thì mở file nào

| Muốn | File |
|---|---|
| Đổi chân GPIO, timeout, số lịch tối đa, stack của task | `include/config.h` |
| Đổi WiFi / địa chỉ broker | `include/secrets.h` |
| Đổi tên trường JSON, thêm trường vào bản tin | `src/protocol.cpp` |
| Đổi topic MQTT, cách reconnect | `src/net.cpp` |
| Đổi cách lái relay, cách đọc lại xác minh | `src/device.cpp` |
| Đổi quy tắc lịch (giờ nào chạy, chống trùng) | `src/schedule.cpp` |
| Đổi cái gì lưu xuống flash | `src/storage.cpp` |
| Đổi cách lấy giờ, múi giờ | `src/clock.cpp` |
| Đổi định dạng log serial | `src/log.cpp` |
| Thêm phím tắt trên serial | `src/task_console.cpp` |

Mỗi `.h` trong `include/` là giao diện của `.cpp` cùng tên trong `src/`. Riêng `config.h` chỉ có hằng số và kiểu, không có `.cpp`; `tasks.h` khai báo hàng đợi dùng chung.

## 6 task và 3 hàng đợi

```
[broker] --command--> task_net ==q_in==> task_cmd ==q_act==> task_actuator
         --schedule->                       |                     |
                                            v                     |
                                      schedule.cpp (NVS)          |
                                            |                     |
                     task_schedule ==q_act==+                     |
                                                                  v
[broker] <--status/heartbeat/schedules/lwt-- task_net <==q_out== (out_msg_t) <--+
                                   ^
                              task_health (heartbeat 15s)
                              task_console (phím tắt serial)
```

| Task | Việc | Ưu tiên |
|---|---|---|
| `task_actuator` | nơi **duy nhất** chạm vào GPIO: bật/tắt rồi đọc lại xác minh | 6 |
| `task_net` | chủ sở hữu **duy nhất** của WiFi/MQTT; reconnect; đẩy outbox | 5 |
| `task_cmd` | chống trùng `command_id`, định tuyến, nạp lịch vào NVS | 4 |
| `task_schedule` | quét lịch mỗi giây, catch-up sau khi boot | 3 |
| `task_health` | heartbeat 15s + NTP + dòng `STAT` | 2 |
| `task_console` | phím tắt serial để diễn kịch bản lỗi | 1 |

**Luật quan trọng nhất: đừng gọi MQTT ngoài `task_net`.** PubSubClient không thread-safe. Cần gửi gì thì `out_enqueue()`, `task_net` lo nốt — kể cả cất vào outbox khi mất mạng.

## Thêm một task

Bốn chỗ, trong đó một file mới. PlatformIO tự biên dịch mọi `.cpp` trong `src/` nên không phải khai báo vào build script.

**1.** Tạo `src/task_button.cpp`:

```cpp
#include <Arduino.h>
#include "tasks.h"
#include "log.h"

void task_button(void* pv) {
    (void)pv;
    for (;;) {
        /* việc của bạn */
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}
```

**2.** Khai báo ở cuối `include/tasks.h`:

```cpp
void task_button(void* pv);
```

**3.** Stack + độ ưu tiên ở `include/config.h`, cụm `FreeRTOS: stack & priority`:

```c
#define TASK_BTN_STACK  3072
#define TASK_BTN_PRIO   3
```

**4.** Đăng ký trong `tasks_start_all()` ở `src/tasks.cpp`:

```c
xTaskCreatePinnedToCore(task_button, "btn", TASK_BTN_STACK, nullptr, TASK_BTN_PRIO, nullptr, CORE_APP);
```

### Task mới gọi được những gì

| Muốn | Gọi | Xem mẫu |
|---|---|---|
| Bật/tắt đèn | đẩy `act_req_t` vào `q_act` | `task_schedule.cpp` |
| Gửi lên server | `out_enqueue(OUT_STATUS, true, json)` | `task_actuator.cpp` |
| Đọc/ghi trạng thái chung | `state_get_relay()`, `state_set_relay()` | `device.h` |
| Lưu xuống flash | `storage_*()` | `storage.h` |
| Lấy giờ | `time_now()`, `time_local_parts()` | `clock.h` |
| In log | `applog("TAG", "...")` | khắp nơi |

Chọn độ ưu tiên: cao hơn `task_net` (5) chỉ khi việc đó không được để mạng làm trễ. Việc chậm, việc chờ người thì để 1–3.

**Chọn stack**: đơn vị là **byte** (Arduino-ESP32, khác FreeRTOS gốc dùng word). Task chỉ đọc cờ và gọi `applog` thì 3072 là đủ; task ôm một buffer `MAX_OUT_JSON_LEN` trên stack hoặc gọi vào WiFi/MQTT/ArduinoJson thì cần 6144–8192. Nạp xong bấm `t` xem thực tế còn bao nhiêu — dưới ~512 byte là phải nâng. Tràn stack biểu hiện là **task chết im lặng**, không có dòng log nào báo.

## Phím tắt trên serial

Gõ một ký tự rồi Enter trong `pio device monitor`:

| Phím | Việc |
|---|---|
| `h` | danh sách phím tắt |
| `s` | in ngay dòng `STAT` |
| `l` | liệt kê lịch trong NVS |
| `o` | outbox: còn bao nhiêu bản chưa gửi |
| `t` | stack còn lại của từng task |
| `f` | ép lần bật/tắt kế tiếp báo `FAILED` |
| `d` | ngắt WiFi thật 20 giây |
| `i` | đặt `device_id` mới, lưu vào NVS |
| `r` | khởi động lại |
