# IoT PoC — Báo cáo nghiên cứu & thiết kế hệ thống

> Phạm vi tài liệu: **cả hai phía** — web (Next.js + MongoDB + MQTT) và firmware ESP32 trong [firmware/](./firmware) (C++/Arduino trên PlatformIO). Hai bên gặp nhau ở đúng 4 topic MQTT mô tả trong [API.md](./API.md) mục 2; ngoài 4 topic đó không có đường nào khác.
>
> Tài liệu tham chiếu API chi tiết: [API.md](./API.md)

---

## Chạy thử nhanh

Cần Node 18+ và Docker. Board ESP32 chỉ cần khi muốn chạy phần cứng thật — không có thì dùng thiết bị giả lập.

```bash
# 1. MongoDB cục bộ
docker run -d --name iot-mongo -p 127.0.0.1:27017:27017 -v iot-mongo-data:/data/db mongo:7

# 2. Cấu hình
cat > .env.local <<'EOF'
MQTT_BROKER_URL=mqtt://broker.emqx.io:1883
MONGODB_URI=mongodb://127.0.0.1:27017
EOF

# 3. Web
npm install
npm run dev                          # http://localhost:3000

# 4. Thiết bị — chọn MỘT trong hai
npm run mock-device                  # giả lập, terminal riêng
cd firmware && make flash            # board thật (nạp + mở serial)
```

Mở http://localhost:3000 rồi bấm BẬT/TẮT. **Phải mở trang thì backend mới nối MQTT** — xem 5.1.

Từng bước chi tiết ở mục 5, gỡ rối ở mục 7.

---

## 1. Kiến trúc tổng quan

```
┌──────────┐   REST/JSON    ┌─────────────────────┐   MQTT pub/sub    ┌──────────────┐
│ Website  │ ─────────────► │  Next.js Backend    │ ◄───────────────► │ ESP32/Device │
│ (React)  │ ◄───────────── │  + MongoDB          │  broker.emqx.io   │  firmware/   │
└──────────┘   SSE stream  └─────────────────────┘  :1883            └──────────────┘
```
SSE = server-sent events

- **Website ↔ Backend**: REST (gửi lệnh, tạo lịch, lấy trạng thái) + **SSE** (nhận cập nhật realtime).
- **Backend ↔ Device**: **MQTT** pub/sub qua broker công khai `mqtt://broker.emqx.io:1883`.
- **Backend persistence**: MongoDB, database `iot-dashboard` (collections: `devices`, `commands`, `schedules`). Atlas hoặc một `mongod` cục bộ đều chạy — code không dùng change stream hay transaction nên không cần replica set.

---

## 2. Các nội dung nghiên cứu

### 2.1 Sử dụng board/phần cứng gì?

**ESP32 classic DevKit** (ESP32-D0WD, cầu USB-UART CH340, flash 4MB) — chọn vì có sẵn WiFi + NVS (flash không mất khi cúp điện) + RTC nội để lịch tự chạy khi mất mạng.

**Chân điều khiển tải: GPIO 5.** Đổi chân thì sửa một dòng `RELAY_GPIO_CH0` trong [firmware/include/config.h](./firmware/include/config.h) — file đó có bản đồ chân đầy đủ kèm lý do từng nhóm chân.

> Tránh **34–39** (input-only, không lái output được — firmware có `#error` chặn ngay lúc build) và **6–11** (nối thẳng vào flash SPI).

**Lưu ý riêng cho GPIO 5**: đây là strapping pin (chọn thời điểm SDIO slave) và chip có **điện trở kéo lên sẵn bên trong**, nên khoảng 0,2 giây đầu lúc cấp điện chân này ở mức cao trước khi `relay_init()` kéo về mức tắt. Với module relay kích **mức thấp** (loại phổ biến) thì mức cao = tắt, không sao. Nếu đấu trực tiếp mức cao (`RELAY_ACTIVE_HIGH = 1`) thì tải có thể **nháy một cái** lúc cắm điện — không hỏng gì, nhưng muốn tránh thì đổi `RELAY_ACTIVE_HIGH` về 0 hoặc dùng chân không phải strapping (4, 18, 19, 21, 22, 23, 25, 26, 27).

**LED báo trạng thái mạng: GPIO 2** (LED gắn sẵn trên DevKit) — sáng liền là đã nối được MQTT, nhấp nháy là chưa. Đặt `LED_STATUS_GPIO` về `-1` nếu không dùng.

Firmware **đọc lại** trạng thái chân sau khi bật/tắt rồi mới báo `SUCCESS` (xem 2.6). Muốn xác minh thật sự đến mức "đèn có sáng không" thì đấu thêm chân phản hồi và khai báo `RELAY_FEEDBACK_CH0`.

### 2.2 Firmware viết bằng gì?

**C++ / Arduino-ESP32 trên PlatformIO**, bên dưới là ESP-IDF + FreeRTOS. Thư viện: `PubSubClient` (MQTT) + `ArduinoJson` (payload).

Chia thành **6 task FreeRTOS**, mỗi task một việc:

| Task | Việc | File |
|---|---|---|
| `net` | chủ sở hữu duy nhất của WiFi + MQTT; reconnect có backoff; đẩy outbox | `src/task_net.cpp` |
| `cmd` | định tuyến bản tin đến, chống trùng `command_id`, nạp lịch vào NVS | `src/task_cmd.cpp` |
| `act` | nơi duy nhất chạm vào phần cứng: bật/tắt rồi **đọc lại xác minh** | `src/task_actuator.cpp` |
| `sched` | quét lịch mỗi giây, tự chạy kể cả khi mất mạng | `src/task_schedule.cpp` |
| `health` | heartbeat 15s + đồng bộ NTP + một dòng log tóm tắt | `src/task_health.cpp` |
| `cons` | phím tắt trên serial để diễn các kịch bản lỗi (xem 5.2) | `src/task_console.cpp` |

Các task chỉ nói chuyện qua 3 hàng đợi (`q_in`, `q_act`, `q_out`) — sơ đồ ở đầu [firmware/include/tasks.h](./firmware/include/tasks.h).

Mock device bằng TypeScript (`scripts/mock-device.ts`, chạy `npm run mock-device`) vẫn giữ để test web khi chưa cắm board — nó mô phỏng đúng hành vi của firmware này.

### 2.3 Backend giao tiếp Device bằng gì?

**MQTT** — lựa chọn và lý do:

| Tiêu chí | MQTT ✅ | REST ❌ | WebSocket ❌ |
|---|---|---|---|
| Device phía NAT/4G không có IP công khai | pub/sub 2 chiều tự nhiên | device phải poll | phức tạp, dễ đứt |
| Băng thông/năng lượng trên thiết bị nhỏ | rất nhẹ (header ~2 byte) | overhead HTTP lớn | trung bình |
| Giao tranh (nhiều backend instance) | broker lo phần việc này | tự viết | tự viết |
| Offline buffering | broker giữ QoS 1 | không | không |

Chi tiết topic + payload: xem [API.md](./API.md).

### 2.4 Cách gửi command xuống Device

Trình tự khi người dùng bấm ON/OFF trên web:

1. UI gọi `POST /api/devices/{deviceId}/commands` với body `{"command": "ON"}`.
2. Backend **lưu trước** document vào collection `commands` với `status: "PENDING"` (MongoDB là source of truth — lệnh không mất nếu backend crash sau khi lưu).
3. Chỉ sau khi lưu DB thành công, backend publish MQTT:
   - Topic: `devices/{deviceId}/command`
   - QoS **1** (at-least-once — thiết bị có thể nhận trùng, cần idempotent theo `command_id`).
4. Không có thiết bị trả lời trong **10 giây** → sweeper tự đánh dấu lệnh `TIMEOUT`.

### 2.5 Cách Device ACK xác nhận đã nhận command

**Hai bước, hai bản tin** trên cùng topic `status` ([API.md mục 2.2](./API.md)):

| Bước | Khi nào | `status` | Lệnh trong MongoDB |
|---|---|---|---|
| 1 | ngay khi `task_cmd` nhận được, **chưa đóng cắt gì** | `"ACK"` | `PENDING` → `ACKNOWLEDGED` |
| 2 | sau khi lái chân và **đọc lại xác minh** | `"SUCCESS"` / `"FAILED"` | → `SUCCESS` / `FAILED` |

Tách ra để trả lời được câu hỏi mà một bản tin không trả lời nổi: **device có nghe thấy lệnh không?** Trước đây "chưa nhận được" và "nhận rồi đang chạy" đều nằm ở `PENDING`, nhìn từ server giống hệt nhau.

Hệ quả là hai đồng hồ đếm ngược khác nhau: `PENDING` chờ **10 giây** (im lặng hoàn toàn — chắc không nghe thấy), `ACKNOWLEDGED` được tới **30 giây** (có nghe, chỉ là chưa xong). UI cũng hiện hai trạng thái riêng.

MQTT không đảm bảo thứ tự giữa hai bản tin, nên backend chỉ cho lệnh **đi tới**: một ACK đến muộn không kéo `SUCCESS` ngược về `ACKNOWLEDGED` được.

### 2.6 Cách Device báo kết quả thành công/thất bại

Device publish QoS 1 lên `devices/{deviceId}/status`:

| Trường hợp | `status` | `state` | `error` |
|---|---|---|---|
| Thực hiện thành công | `"SUCCESS"` | `"ON"`/`"OFF"` (trạng thái LED sau chạy) | `null` |
| Thất bại | `"FAILED"` | trạng thái hiện tại | mã lỗi, vd `"GPIO_ERROR"` |

Backend sau đó: cập nhật lệnh trong MongoDB + đồng bộ `currentState`, `lastCommand` của device + bắn SSE `command_update`, `device_update` cho mọi UI đang mở.

Mã lỗi firmware đang dùng:

| `error` | Nghĩa |
|---|---|
| `VERIFY_FAILED` | đã lái chân nhưng đọc lại không khớp giá trị yêu cầu — hỏng driver/sai cấu hình chân |
| `DEVICE_BUSY` | hàng đợi thực thi đầy, trả `FAILED` ngay thay vì để web treo `PENDING` đến lúc sweeper đánh `TIMEOUT` |

### 2.7 Format dữ liệu gửi/nhận

**JSON, UTF-8, timestamp chuẩn ISO 8601 UTC** trên mọi kênh. Bảng field đầy đủ của từng message: xem [API.md](./API.md) (mục MQTT Payload).

Quy ước đặt tên: **snake_case** trong payload MQTT (`command_id`, `device_id`) — giữ tương thích firmware; **camelCase** trong REST/SSE cho UI (`commandId`, `deviceId`).

### 2.8 Device Identity

- Mỗi thiết bị có **`deviceId` duy nhất** (vd `esp32-001`). Firmware đọc từ **NVS** trước, không có thì mới lấy hằng số `DEVICE_ID` biên dịch sẵn — một bản firmware nạp được nhiều board, không phải build lại chỉ để đổi tên. Đặt bằng phím `i` trên console serial (mục 5.2).
- `deviceId` xuất hiện ở **2 nơi**: trong **topic** (`devices/{deviceId}/...`) và trong **payload** (`device_id`). Backend ưu tiên payload, topic làm fallback.
- MongoDB đánh unique index trên `devices.deviceId` và `commands.commandId`.
- Device chưa tồn tại trong DB sẽ được **tự đăng ký** ở lần heartbeat/lệnh đầu tiên (`ensureDevice`).
- Chưa có auth: **bất kỳ client nào biết `deviceId` đều có thể giả mạo**. Broker công khai còn có thiết bị lạ của người khác (đã gặp thật: `LAB301-METER-02`). Đã chặn phía backend bằng validate payload; về lâu dài cần broker có username/password/TLS + token theo device.

### 2.9 Cách xác định Online/Offline

| Trạng thái | Điều kiện |
|---|---|
| `ONLINE` | Nhận heartbeat tại `devices/{id}/heartbeat` (device gửi mỗi **15s**, QoS 0) → cập nhật `lastSeen` |
| `OFFLINE` | Sweeper chạy mỗi 5s: device `ONLINE` có `lastSeen` cũ hơn **45s** (3 nhịp tim mất) → đánh dấu `OFFLINE` |

**Last Will**: firmware đăng ký LWT trên `devices/{id}/lwt` lúc connect, broker tự publish `{"online": false}` khi TCP đứt đột ngột. Backend subscribe topic này và đánh `OFFLINE` **ngay**, không chờ hết 45 giây. Device nối lại thì tự ghi đè `{"online": true}` (retained, nên backend khởi động sau vẫn đọc được trạng thái cuối).

Sweeper 45 giây vẫn giữ làm lưới an toàn: LWT chỉ bắt được trường hợp mất kết nối TCP, không bắt được device treo mà socket vẫn mở.

### 2.10 Reconnect khi mất mạng

**Phía backend** (đã triển khai): mqtt.js `reconnectPeriod: 5000` — tự reconnect mỗi 5s, subscribe lại topic sau khi kết nối lại; kết nối MQTT client + SSE client registry được giữ trên `globalThis` để sống qua hot-reload.

**Phía device** (`src/task_net.cpp`): WiFi và MQTT đều reconnect có **backoff 1s → 30s**, không quay vòng liên tục làm nóng board. Nối lại được broker thì: subscribe lại 2 topic → gửi heartbeat ngay (web thấy ONLINE không phải chờ hết chu kỳ 15s) → **đẩy outbox NVS lên**, mỗi bản cách nhau 50ms cho backend kịp ghi MongoDB.

### 2.11 Lưu lịch ở đâu

**Hai nơi:**

1. **Server — MongoDB** collection `schedules`: `{ scheduleId, deviceId, time "HH:MM", command, enabled, createdAt }`. Là nguồn chân lý để UI hiển thị/quản lý; tạo lịch mới xong backend publish xuống device qua topic `schedule`.
2. **Thiết bị — NVS (flash)**: firmware nhận từng lịch qua MQTT rồi ghi thẳng vào NVS (`schedule.cpp` → `storage.cpp`), tối đa 8 lịch. Khoá là `schedule_id`: gửi lại cùng id thì cập nhật tại chỗ, không sinh bản trùng. Ghi NVS **trước** rồi mới đổi bảng lịch trong RAM — ghi hỏng thì lịch cũ còn nguyên. Chống chạy 2 lần trong một phút bằng mốc phút đã bắn của từng slot (RAM) + cơ chế catch-up lúc boot.

**Ba việc giữ hai nơi này khớp nhau:**

- **Xoá**: web xoá lịch thì backend publish `action: "delete"` xuống device. Không có bước này thì lịch vẫn nằm trong flash và vẫn bật đèn đúng giờ đó mãi.
- **Tạm tắt**: `enabled: false` vẫn được gửi xuống — device giữ lịch nhưng không kích hoạt, để sau này bật lại có tác dụng ngay.
- **Đối chiếu**: sau mỗi lần đổi lịch và sau khi nối lại broker, device publish **bảng lịch nó đang thực sự giữ** lên `devices/{id}/schedules`. Backend lưu vào `devices.deviceSchedules` — đây là cách duy nhất để biết lệnh gửi xuống có tới nơi hay không.

### 2.12 Device lấy và đồng bộ thời gian như thế nào

Backend chỉ làm việc với ISO 8601 UTC, firmware cũng vậy (`clock.cpp`):

- **Có mạng**: SNTP (`pool.ntp.org`, `time.google.com`) → epoch UTC chuẩn, đồng bộ lại mỗi 6 giờ để bù trôi thạch anh.
- **Mất mạng**: RTC nội của ESP32 chạy tiếp → lịch vẫn đúng giờ.
- **Mất điện**: RTC nội mất. Boot lại nạp **mốc thô** từ NVS (epoch được lưu xuống mỗi 5 phút) và đánh dấu "chưa đáng tin" cho tới khi SNTP xong. Lịch catch-up chờ SNTP tối đa 60s rồi mới chịu dùng mốc thô.
- Firmware làm việc bằng UTC, đổi sang giờ địa phương ở tầng lịch. **Múi giờ do server quyết định**: mỗi bản tin schedule mang theo `tz_offset_min` (mặc định 420 = UTC+7, đổi bằng biến môi trường `SCHEDULE_TZ_OFFSET_MIN`), device lưu vào NVS. `SCHED_DEFAULT_TZ_MIN` trong `config.h` chỉ là giá trị dùng tạm cho tới khi nhận được lịch đầu tiên.

**Giới hạn đã biết**: ESP32 không có RTC chạy pin. Mất điện + mất mạng cùng lúc thì giờ lệch cho tới khi SNTP xong. Lên production nên gắn **DS3231**.

### 2.13 Restart/mất điện thì lịch có còn không

- **Server-side**: **Có** — lịch nằm trong MongoDB Atlas, sống sót qua restart/mất điện/deploy lại.
- **Device-side**: **Có** — lịch nằm trong NVS. Ngoài ra firmware còn khôi phục **trạng thái đèn** trước khi mất điện (`storage_load_relay`) và chạy **catch-up**: tìm lần kích hoạt gần nhất đã qua trong 24h rồi áp dụng lại, để đèn không sai trạng thái so với lịch sau một lần cúp điện dài.

### 2.14 Mất Internet thì lịch có tiếp tục chạy không

- **CÓ** — lịch thực thi **trên thiết bị**, không phụ thuộc server:
  1. Device đã nhận lịch trước đó và lưu vào NVS.
  2. Đến giờ, `task_schedule` tự bật/tắt dù không mạng; kết quả vào **outbox trong NVS** (vòng tròn 20 bản tin, đầy thì bỏ bản cũ nhất).
  3. Có mạng lại → `task_net` publish lần lượt lên `status`, **giữ nguyên `timestamp` lúc thực thi** chứ không phải lúc gửi, kèm `command_id` sinh cục bộ.
- **Lịch tạo trong lúc device offline không còn bị mất**: backend thấy device chuyển `OFFLINE → ONLINE` (qua heartbeat) thì tự đẩy lại toàn bộ lịch đang bật. Upsert theo `schedule_id` nên gửi lại vô hại.
- Outbox nằm trong NVS nên **mất điện giữa chừng cũng không mất kết quả** — khác với mock device (hàng đợi chỉ trong RAM).
- Mock device (`scripts/mock-device.ts`) vẫn dùng để diễn lại kịch bản này khi không có board: phím `d` = ngắt mạng giả lập, `c` = có mạng lại + đồng bộ hàng đợi.
- Giới hạn đã biết: trong lúc offline, **web không thấy** thay đổi trạng thái (chỉ cập nhật khi device sync lại); lịch thêm mới trong lúc device offline sẽ chỉ đến device khi có mạng lại (QoS 1 + session sạch — nếu broker/device dùng persistent session thì nhận được cả message gửi khi offline).

---

## 3. Trạng thái vòng đời của một lệnh

```
UI bấm → POST API → [PENDING] → publish MQTT → device nhận
                        │                          │
                        │                          │ ACK (ngay, chưa đóng cắt)
                        │                          ▼
                        │                   [ACKNOWLEDGED] → device lái chân + đọc lại
                        │                          │              │
                        ▼                          ▼              ▼
                   [TIMEOUT]                  [TIMEOUT]      [SUCCESS] / [FAILED]
              im lặng quá 10s           ACK rồi nhưng      state = ON/OFF
              (chắc không nghe thấy)    quá 30s không      error = mã lỗi
                                        báo kết quả
```

UI hiển thị tương ứng: `Đã gửi lệnh, chờ xác nhận...` → `Thiết bị đã nhận lệnh, đang thực hiện...` → `✅ Đã bật/Đã tắt` / `❌ Thất bại` / `⚠️ Timeout`.

---

## 4. Trạng thái từng hạng mục

| # | Hạng mục | Phía | Trạng thái |
|---|---|---|---|
| 1 | Chọn board, chân GPIO, relay/LED | Firmware | ✅ ESP32 DevKit, tải GPIO 5, LED báo GPIO 2 |
| 2 | Firmware + MQTT client + reconnect | Firmware | ✅ xong |
| 3 | REST API + MQTT backend + MongoDB | Web | ✅ xong |
| 4 | SSE realtime cho UI | Web | ✅ xong |
| 5 | Online/Offline detection + sweeper TIMEOUT | Web | ✅ xong |
| 6 | Lưu lịch server + đẩy xuống device | Web | ✅ xong |
| 7 | Lưu lịch local + tự chạy khi mất mạng + sync queue | Firmware | ✅ NVS + outbox |
| 8 | NTP đồng bộ giờ | Firmware | ✅ SNTP + mốc thô trong NVS |
| 9 | ACK trung gian (mục 2.5) | Cả hai | ✅ xong |
| 10 | Xoá / tạm tắt lịch trên device | Cả hai | ✅ `action: "delete"` + cờ `enabled` |
| 11 | Device báo lại bảng lịch đang giữ | Cả hai | ✅ topic `schedules` |
| 12 | Múi giờ do server quyết định | Cả hai | ✅ `tz_offset_min` trong payload |
| 13 | Phát hiện mất kết nối tức thì (LWT) | Cả hai | ✅ topic `lwt`, retained |
| 14 | Trạng thái thật trong heartbeat (tự chữa lệch) | Cả hai | ✅ trường `state` |
| 15 | Đẩy lại lịch khi device online trở lại | Web | ✅ xong |
| 16 | Device identity không biên dịch cứng | Firmware | ✅ đọc từ NVS, đặt bằng phím `i` |
| 17 | Chống trùng lệnh sống qua khởi động lại | Firmware | ✅ lịch sử `command_id` trong NVS |
| 18 | Broker có auth/TLS, token theo device | Cả hai | ⬜ chưa làm |
| 19 | Publish QoS 1 (đổi thư viện MQTT) | Firmware | ⬜ chưa làm (mục 8) |
| 20 | Xác minh bằng chân phản hồi thật | Phần cứng | ⬜ cần đấu dây (mục 8) |
| 21 | Cập nhật firmware qua mạng (OTA) | Cả hai | ⬜ đã bỏ khỏi PoC |

---

## 5. Chạy thử hệ thống

### 5.1 Web

```bash
npm install
npm run dev           # Next.js + API + SSE tại http://localhost:3000
npm run mock-device   # terminal riêng: giả lập ESP32 (đủ cả offline scheduling)
```

**Biến môi trường** — file `.env.local` ở thư mục gốc. File này nằm trong `.gitignore` nên **không theo repo về**, máy mới phải tự tạo:

```
MQTT_BROKER_URL=mqtt://broker.emqx.io:1883
MONGODB_URI=mongodb://127.0.0.1:27017        # Mongo cục bộ
# MONGODB_URI=mongodb+srv://...              # hoặc Atlas của team
```

Tên database do code đặt cứng là `iot-dashboard` ([lib/mongodb.ts](./lib/mongodb.ts)), URI không cần ghi tên DB. Thiếu `MONGODB_URI` thì module throw ngay lúc import, không phải lúc gọi — server chết ngay lần đầu chạm vào API.

Mongo cục bộ bằng Docker, đủ dùng cho PoC:

```bash
docker run -d --name iot-mongo -p 127.0.0.1:27017:27017 -v iot-mongo-data:/data/db mongo:7
```

> **Backend chỉ nối MQTT khi có người mở trang.** `initializeMQTTHandlers()` được gọi từ ba route: `/api/sse`, `/api/devices/[id]/commands`, `/api/devices/[id]/schedules`. Next.js nạp route theo yêu cầu, nên chạy `npm run dev` xong mà chưa ai mở trang thì backend **chưa** subscribe gì — heartbeat của board gửi lên lúc đó không ai ghi, web sẽ hiện OFFLINE dù board đang chạy ngon. Mở `http://localhost:3000` là xong (trang tự mở SSE). Kích bằng dòng lệnh nếu cần:
>
> ```bash
> curl -s --max-time 2 -N http://localhost:3000/api/sse
> ```
>
> Nối được rồi thì log server in:
>
> ```
> [Handler] Initializing MQTT handlers (MongoDB-backed)...
> [Sweeper] Started (every 5s: stale PENDING → TIMEOUT, silent devices → OFFLINE)
> [MQTT] Connected to broker: mqtt://broker.emqx.io:1883
> [MQTT] Subscribed: devices/+/heartbeat, devices/+/status
> ```

Công cụ hỗ trợ:

```bash
node scripts/mqtt-probe.mjs          # giả làm thiết bị: heartbeat + trả lời lệnh PENDING mới nhất
node scripts/cleanup-test-data.mjs   # dọn document test (xem --help trong file)
```

### 5.2 Firmware (board thật)

Bản đồ firmware, cách thêm task, sửa gì thì mở file nào: [firmware/README.md](./firmware/README.md).

```bash
cd firmware
make secrets    # lần đầu: tạo include/secrets.h rồi điền WiFi + broker
make flash      # nạp firmware + mở serial luôn
```

`make` không tham số để xem hết lệnh (`build`, `monitor`, `ports`, `size`, `erase`).
Board ở cổng khác thì: `make flash PORT=/dev/ttyUSB0`.

**Ba thứ phải khớp nhau, sai một cái là web không thấy thiết bị:**

| | Firmware | Web |
|---|---|---|
| device_id | `DEVICE_ID` trong `firmware/include/config.h` | `DEVICE_ID` trong `app/dashboard-client.tsx` |
| broker | `CFG_MQTT_HOST` trong `firmware/include/secrets.h` | `MQTT_BROKER_URL` trong `.env.local` |

Mặc định cả hai bên là `esp32-001` và `broker.emqx.io:1883`.

Cắm board rồi thì **tắt `npm run mock-device`** — hai bên cùng `device_id` sẽ giành nhau trả lời một lệnh.

**Đọc log serial.** Mỗi dòng có dạng `[giây từ lúc boot] TAG  nội dung`. Log ghi bằng `applog()` ([firmware/src/log.cpp](./firmware/src/log.cpp)) có mutex nên nhiều task in cùng lúc không cắt dòng của nhau.

| Tag | Của ai | Ví dụ |
|---|---|---|
| `BOOT` | khởi tạo | `6 tasks started, 256 KB heap free` |
| `NVS` | `storage.cpp` | `ready, outbox holds 0 unsent message(s)` |
| `RELAY` | `device.cpp` | `channel 0 on GPIO 5, active HIGH, feedback via GPIO readback` |
| `WIFI` | `net.cpp` | `connected. ip=192.168.1.193 gateway=... rssi=-55 dBm channel=7` |
| `TIME` | `clock.cpp` | `synced: 2026-09-14T15:06:02Z (local 22:06:02)` |
| `MQTT` | `net.cpp` | `subscribed ...` và `-> {…}` — nguyên văn bản tin `status` vừa đẩy lên |
| `CMD` | `task_cmd` | `<- command cmd-3b695db7 ON` |
| `ACT` | `task_actuator` | `channel 0 -> ON readback match => SUCCESS (30 ms, source: cloud)` |
| `SCHED` | `task_schedule.cpp`, `schedule.cpp` | `DUE 07:00 -> ON (schedule-x1y2z3)` |
| `NET` | `task_net` | `uplink UP`, `offline -> result queued to NVS outbox (1 waiting)` |
| `STAT` | `task_health` | dòng tóm tắt 15 giây |
| `CONS` | `task_console` | phản hồi phím tắt |

Một lệnh chạy đúng để lại đủ ba dòng, đọc từ trên xuống là thấy trọn vòng:

```
[  21.53s] CMD    <- command cmd-3b695db7  ON
[  21.56s] ACT    channel 0 -> ON   readback match    => SUCCESS  (30 ms, source: cloud)
[  21.57s] MQTT   -> {"device_id":"esp32-001","command_id":"cmd-3b695db7","status":"SUCCESS","state":"ON","timestamp":"2026-09-14T15:06:23Z","error":null}
```

`readback match` là chỗ quan trọng: firmware ghi chân, chờ 30ms cho tiếp điểm ổn định, **đọc lại** rồi mới kết luận. Không khớp thì in `readback MISMATCH => FAILED` và gửi `error: "VERIFY_FAILED"`.

Dòng `STAT` in mỗi 15 giây, cùng nhịp với heartbeat (heartbeat không in riêng để đỡ rác) — thấy `STAT` nghĩa là heartbeat vừa đi:

```
[  45.01s] STAT   net=mqtt-up  rssi=-47dBm | load=ON  | clock=synced | schedules=2 | outbox=0 | ok/fail=3/0 | heap=201KB | stack=2184B | uptime=45s
```

| Trường | Nghĩa |
|---|---|
| `net` | `mqtt-up` = thông cả WiFi lẫn MQTT · `wifi-only` = có WiFi chưa nối được broker · `down` |
| `rssi` | sóng WiFi. Trên −60 dBm tốt, −70 đến −80 hay rớt, dưới −85 chập chờn |
| `load` | trạng thái **đọc lại từ chân**, không phải giá trị vừa yêu cầu |
| `clock` | `synced` = đã NTP · `coarse` = mốc thô từ NVS · `unset` = chưa có giờ, **lịch không chạy** |
| `schedules` | số lịch đang nằm trong NVS |
| `outbox` | số kết quả đang chờ gửi. Khác 0 nghĩa là đang/vừa mất mạng |
| `ok/fail` | số lần đóng cắt thành công/thất bại kể từ lúc boot |
| `heap` | RAM trống. Tụt dần đều qua nhiều giờ mới là dấu hiệu rò bộ nhớ |
| `stack` | task nào còn ít stack nhất, tính bằng byte kể từ lúc boot. Xuống dưới ~512 là sắp tràn — task sẽ chết im lặng hoặc panic. Phím `t` xem chi tiết từng task |
| `uptime` | board chạy được bao lâu |

**Phím tắt trong `pio device monitor`** — gõ một ký tự rồi Enter. Dùng để diễn các kịch bản lỗi ngay trên board, không phải rút dây router hay tháo tải:

| Phím | Việc |
|---|---|
| `h` | in danh sách phím tắt |
| `s` | in ngay dòng STAT thay vì chờ hết 15s |
| `l` | liệt kê lịch đang lưu trong NVS |
| `o` | xem outbox: còn bao nhiêu kết quả chưa gửi + bản cũ nhất |
| `t` | stack còn lại của từng task — kiểm tra khi có task chết im lặng |
| `f` | ép lần bật/tắt **kế tiếp** báo `FAILED` — bấm ON/OFF trên web để xem đường lỗi |
| `d` | ngắt WiFi thật 20 giây — lịch vẫn chạy, kết quả vào outbox, có mạng lại thì gửi bù |
| `i` | đặt `device_id` mới, lưu vào NVS (gõ `i` + Enter, rồi gõ id + Enter) |
| `r` | khởi động lại (để thử khôi phục trạng thái + catch-up lịch) |

### 5.3 Cấu trúc thư mục

```
.
├── README.md        tài liệu này
├── API.md           tham chiếu endpoint + payload MQTT + từng file làm gì
├── .env.local       cấu hình cục bộ — TỰ TẠO, không theo repo
├── app/             Next.js — UI + API routes + SSE
├── components/      React component của dashboard
├── lib/             MQTT client, MongoDB, db-service, SSE manager
├── types/           kiểu dùng chung: document MongoDB + payload MQTT
├── scripts/         mock-device.ts (bản đầy đủ) + công cụ test
└── firmware/        ESP32 — PlatformIO + FreeRTOS
    ├── Makefile         make flash / build / monitor / ports / erase
    ├── platformio.ini
    ├── include/     config.h (chân GPIO, hằng số, kiểu dữ liệu), secrets.h (WiFi/broker — TỰ TẠO)
    └── src/         6 task + driver relay + dịch vụ lịch/giờ/NVS
```

Hai file phải tự tạo trên máy mới: `.env.local` (mục 5.1) và `firmware/include/secrets.h` (copy từ `secrets.example.h`). Cả hai đều bị gitignore vì chứa thông tin riêng.

---

## 6. Đã kiểm chứng

Ghi đúng những gì đã chạy thật trên board ESP32 + web, ngày 14/09/2026. Những mục chưa chạy để trống, **không ghi là đạt**.

> Cột "Đã chạy" phân biệt ba mức: ✅ **board** = chạy trên ESP32 thật · 🔵 **mock** = chạy thật qua broker + backend nhưng bằng `scripts/mock-device.ts`, chưa xác nhận trên phần cứng · ⬜ = chưa chạy.

| Kịch bản | Kết quả | Đã chạy |
|---|---|---|
| Firmware build | RAM 14,4% (47 KB / 320 KB), Flash 62,3% (797 KB / 1,25 MB) | ✅ |
| Boot → WiFi → SNTP → MQTT | thông trong ~2,9 giây kể từ lúc cấp điện | ✅ |
| Web bấm BẬT/TẮT → đèn đổi → web hiện kết quả | `SUCCESS`, đọc lại khớp; ~40ms từ lúc nhận lệnh tới lúc đẩy `status` lên | ✅ |
| Backend ghi lệnh vào MongoDB + đẩy SSE | badge trên UI đổi theo `status` thật từ device | ✅ |
| Lọc thiết bị lạ trên broker công khai | bắt gặp thật 3 thiết bị của người khác bắn vào `devices/+/status`, backend bỏ hết, DB sạch | ✅ |
| Device tự đăng ký lần đầu | `ensureDevice` tạo `esp32-001` với `OFFLINE`/`OFF` | ✅ |
| Heartbeat giữ ONLINE | dòng `STAT` mỗi 15s, `net=mqtt-up` | ✅ |
| **ACK**: `PENDING → ACKNOWLEDGED → SUCCESS` | backend ghi đủ 3 bước; ACK mang `state` trước khi đổi, đúng thiết kế | 🔵 mock |
| **LWT**: mất kết nối → OFFLINE tức thì | `OFFLINE via Last Will (connection_lost)`, không phải chờ 45s | 🔵 mock |
| **Heartbeat mang `state` + `fw`** | backend nhận và lưu `firmware`, dùng để tự sửa trạng thái lệch | ✅ board |
| **Bảng lịch báo ngược** | device publish `devices/{id}/schedules`, backend lưu `deviceSchedules` + `schedulesSyncedAt` | ✅ board |
| Đường FAILED (phím `f`) | | ⬜ |
| Lịch tự chạy trên device | | ⬜ |
| Mất mạng → outbox → gửi bù (phím `d`) | | ⬜ |
| Mất điện → khôi phục trạng thái + catch-up (phím `r`) | | ⬜ |
| Device im 45s → web đánh OFFLINE | | ⬜ |

Cách diễn nốt năm mục còn trống:

- **FAILED**, **outbox**, **khôi phục sau khởi động lại** — ba phím `f`, `d`, `r` ở mục 5.2, không cần dựng thêm gì.
- **Lịch tự chạy** — tạo một lịch trên web rồi đợi tới phút đó; theo dõi dòng `SCHED DUE ...` trên serial.
- **Web đánh OFFLINE** — cần thiết bị im hơn 45 giây, mà phím `d` chỉ giữ 20 giây. Rút nguồn board, hoặc tăng `CONSOLE_FAKE_DOWN_MS` trong `config.h`.

---

## 7. Gỡ rối

| Triệu chứng | Nguyên nhân hay gặp | Kiểm tra ở đâu |
|---|---|---|
| Web hiện **OFFLINE** mãi dù board đang chạy | backend chưa nối MQTT vì chưa ai mở trang | log server phải có `[MQTT] Subscribed` — xem 5.1 |
| | board chưa nối được broker | serial phải có `MQTT connected to ...` |
| | `device_id` hai bên khác nhau | `firmware/include/config.h` so với `app/dashboard-client.tsx` |
| Bấm nút → **⚠️ Timeout** sau 10s | board không nhận được lệnh | serial có dòng `CMD <- command` không? Không có nghĩa là sai topic hoặc sai broker |
| | hai thiết bị cùng `device_id` giành nhau | tắt `npm run mock-device` khi đã cắm board |
| Web báo **❌ Thất bại** | `readback MISMATCH` — sai chân, hoặc chân input-only | dòng `ACT` trên serial, rồi `RELAY_GPIO_CH0` |
| Serial: `WIFI connect FAILED` | sai SSID/mật khẩu, hoặc router chỉ phát 5GHz | ESP32 classic **chỉ bắt 2.4GHz** |
| Serial: `MQTT connect ... -> -2 cannot open TCP` | sai host broker, hoặc bị tường lửa chặn | `CFG_MQTT_HOST` trong `firmware/include/secrets.h` |
| Lịch đến giờ mà không chạy | chưa có giờ | `STAT` hiện `clock=unset` → firmware không dám chạy lịch, chờ SNTP xong |
| Server chết ngay khi gọi API: `MONGODB_URI is not defined` | thiếu `.env.local` | mục 5.1 |
| `npm run dev` nhảy sang cổng 3001 | cổng 3000 đang bị tiến trình khác giữ | `ss -ltnp \| grep :3000` |

---

## 8. Giới hạn đã biết

| Giới hạn | Hệ quả | Cần gì để bỏ |
|---|---|---|
| **Broker công khai, không TLS, không auth** | ai biết `deviceId` cũng bật tắt được đèn; trên `broker.emqx.io` còn có thiết bị lạ của người khác (đã gặp thật: `LAB301-METER-02`) | broker riêng + username/password + TLS + token theo device |
| **PubSubClient chỉ publish được QoS 0** | `status`/`heartbeat` đi ở QoS 0 dù tài liệu ghi QoS 1; bản tin có thể mất nếu TCP đứt đúng lúc gửi | đổi sang `esp-mqtt` của ESP-IDF. Hiện bù bằng hai lớp: outbox NVS (gửi không được thì cất lại) và `state` trong heartbeat (15 giây là tự khớp lại) |
| **Lần chạy theo lịch không tạo bản ghi lệnh** | device sinh `command_id` cục bộ, `updateCommandStatus()` không tìm thấy trong MongoDB nên bỏ qua — lịch sử lệnh không có dòng nào cho lần đó. Trạng thái đèn thì **vẫn đúng**: heartbeat mang `state` nên chậm nhất 15 giây là UI khớp lại | backend tạo bản ghi lệnh mới khi gặp `command_id` lạ từ một device đã biết |
| **Tối đa 8 lịch trên device** | lịch thứ 9 bị từ chối, web vẫn hiển thị vì MongoDB không giới hạn | tăng `SCHED_MAX_SLOTS` trong `config.h` |
| **ESP32 không có RTC chạy pin** | mất điện + mất mạng cùng lúc → giờ lệch tới khi SNTP xong | gắn DS3231 |
| **Xác minh ở mức đọc lại GPIO** | bắt được lỗi cấu hình/driver, chưa bắt được đứt dây hay cháy bóng | đấu chân phản hồi thật rồi khai báo `RELAY_FEEDBACK_CH0` |
| **Không có OTA** | đổi firmware phải cắm dây nạp lại | cần thêm ở cả hai phía: kho `.bin` + API bên web, `Update.h` + topic OTA bên firmware |
