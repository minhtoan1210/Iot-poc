# IoT PoC — Báo cáo nghiên cứu & thiết kế hệ thống

> Phạm vi tài liệu: **Team Web (Next.js + MongoDB + MQTT)**. Các mục thuộc phần nhúng (board, firmware, lưu trữ trên thiết bị) được đánh dấu 🔧 **— Team Nhúng quyết định** — xem bảng phân công ở cuối tài liệu.
>
> Tài liệu tham chiếu API chi tiết: [API.md](./API.md)

---

## 1. Kiến trúc tổng quan

```
┌──────────┐   REST/JSON    ┌─────────────────────┐   MQTT pub/sub    ┌──────────────┐
│ Website  │ ─────────────► │  Next.js Backend    │ ◄───────────────► │ ESP32/Device │
│ (React)  │ ◄───────────── │  + MongoDB Atlas    │  broker.emqx.io   │  (🔧 Team    │
└──────────┘   SSE stream  └─────────────────────┘  :1883            │   Nhúng)     │
                                                                    └──────────────┘
```
server-sent events

- **Website ↔ Backend**: REST (gửi lệnh, tạo lịch, lấy trạng thái) + **SSE** (nhận cập nhật realtime).
- **Backend ↔ Device**: **MQTT** pub/sub qua broker công khai `mqtt://broker.emqx.io:1883`.
- **Backend persistence**: MongoDB Atlas, database `iot-dashboard` (collections: `devices`, `commands`, `schedules`).

---

## 2. Các nội dung nghiên cứu

### 2.1 Sử dụng board/phần cứng gì? 🔧 — Team Nhúng

Phía web không ràng buộc phần cứng. Yêu cầu duy nhất với phần cứng: chạy được MQTT client (QoS 0/1), có NTP/RTC để lấy giờ, và có nơi lưu lịch local (flash/NVRAM/RTC memory). Team nhúng tự quyết định board (ESP32/ESP8266/…), loại LED/relay và chân GPIO.

### 2.2 Firmware viết bằng gì? 🔧 — Team Nhúng

Không ràng buộc. Gợi ý: Arduino framework + thư viện `PubSubClient`/`AsyncMqttClient`, hoặc ESP-IDF. Mock device đối chứng của team web viết bằng TypeScript (`scripts/mock-device.ts`, chạy `npm run mock-device`) mô phỏng đúng hành vi giao thức.

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

Thiết kế hiện tại: **không có bước ACK riêng** — device trả kết quả thực thi trực tiếp qua topic `status`, backend chuyển lệnh từ `PENDING` → `SUCCESS`/`FAILED`. Nhược điểm: backend không phân biệt được "đã nhận chưa chạy" với "chưa nhận".

Phương án nâng cấp (đề xuất với Team Nhúng, chưa triển khai):
- Bước 1: device publish `status` với `status: "ACK"` ngay khi nhận lệnh.
- Bước 2: khi chạy xong, publish lại `status: "SUCCESS"|"FAILED"`.
- Backend thêm giá trị trạng thái trung gian `ACKNOWLEDGED`.

### 2.6 Cách Device báo kết quả thành công/thất bại

Device publish QoS 1 lên `devices/{deviceId}/status`:

| Trường hợp | `status` | `state` | `error` |
|---|---|---|---|
| Thực hiện thành công | `"SUCCESS"` | `"ON"`/`"OFF"` (trạng thái LED sau chạy) | `null` |
| Thất bại | `"FAILED"` | trạng thái hiện tại | mã lỗi, vd `"GPIO_ERROR"` |

Backend sau đó: cập nhật lệnh trong MongoDB + đồng bộ `currentState`, `lastCommand` của device + bắn SSE `command_update`, `device_update` cho mọi UI đang mở.

### 2.7 Format dữ liệu gửi/nhận

**JSON, UTF-8, timestamp chuẩn ISO 8601 UTC** trên mọi kênh. Bảng field đầy đủ của từng message: xem [API.md](./API.md) (mục MQTT Payload).

Quy ước đặt tên: **snake_case** trong payload MQTT (`command_id`, `device_id`) — giữ tương thích firmware; **camelCase** trong REST/SSE cho UI (`commandId`, `deviceId`).

### 2.8 Device Identity

- Mỗi thiết bị có **`deviceId` duy nhất** (vd `esp32-001`), hiện nhúng cứng trong firmware.
- `deviceId` xuất hiện ở **2 nơi**: trong **topic** (`devices/{deviceId}/...`) và trong **payload** (`device_id`). Backend ưu tiên payload, topic làm fallback.
- MongoDB đánh unique index trên `devices.deviceId` và `commands.commandId`.
- Device chưa tồn tại trong DB sẽ được **tự đăng ký** ở lần heartbeat/lệnh đầu tiên (`ensureDevice`).
- Chưa có auth: **bất kỳ client nào biết `deviceId` đều có thể giả mạo**. Broker công khai còn có thiết bị lạ của người khác (đã gặp thật: `LAB301-METER-02`). Đã chặn phía backend bằng validate payload; về lâu dài cần broker có username/password/TLS + token theo device.

### 2.9 Cách xác định Online/Offline

| Trạng thái | Điều kiện |
|---|---|
| `ONLINE` | Nhận heartbeat tại `devices/{id}/heartbeat` (device gửi mỗi **15s**, QoS 0) → cập nhật `lastSeen` |
| `OFFLINE` | Sweeper chạy mỗi 5s: device `ONLINE` có `lastSeen` cũ hơn **45s** (3 nhịp tim mất) → đánh dấu `OFFLINE` |

Cờ MQTT Last Will 🔧 (khuyến nghị cho Team Nhúng): đăng ký LWT `OFFLINE` khi connect để broker tự báo offline ngay khi device mất kết nối, không phải chờ 45s.

### 2.10 Reconnect khi mất mạng

**Phía backend** (đã triển khai): mqtt.js `reconnectPeriod: 5000` — tự reconnect mỗi 5s, subscribe lại topic sau khi kết nối lại; kết nối MQTT client + SSE client registry được giữ trên `globalThis` để sống qua hot-reload.

**Phía device** 🔧: mock device mẫu có sẵn pattern — `reconnectPeriod: 0`, tự quản lý vòng lặp connect, khi vào lại mạng thì: subscribe lại topic → gửi heartbeat ngay → **đẩy hàng đợi kết quả offline lên server** (mỗi 500ms một bản).

### 2.11 Lưu lịch ở đâu

**Hai nơi:**

1. **Server — MongoDB** collection `schedules`: `{ scheduleId, deviceId, time "HH:MM", command, enabled, createdAt }`. Là nguồn chân lý để UI hiển thị/quản lý; tạo lịch mới xong backend publish xuống device qua topic `schedule`.
2. **Thiết bị — bộ nhớ local** 🔧: device nhận lịch qua MQTT và lưu vào flash/NVRAM để **tự thực thi khi mất Internet** (xem 2.13). Mock device giữ mảng `localSchedules` + cờ `executedToday` chống chạy trùng trong ngày.

### 2.12 Device lấy và đồng bộ thời gian như thế nào 🔧 — Team Nhúng

Backend chỉ làm việc với ISO 8601 UTC. Phía device, phương án đề xuất (mock device dùng giờ hệ thống, ESP32 thật cần):
- **NTP** (`configTime` với timezone ví dụ `Asia/Ho_Chi_Minh`) khi có mạng;
- **RTC ngoài (DS3231)** hoặc đồng hồ nội + cron NTP định kỳ để chống trôi;
- schedule chỉ cần chính xác tới **phút** (`"HH:MM"` local).

### 2.13 Restart/mất điện thì lịch có còn không

- **Server-side**: **Có** — lịch nằm trong MongoDB Atlas, sống sót qua restart/mất điện/deploy lại.
- **Device-side** 🔧: phụ thuộc Team Nhúng lưu lịch ở bộ nhớ không mất (flash/NVS/EEPROM) hay RAM. Yêu cầu đặt ra: **phải còn** sau khi mất điện → khuyến nghị NVS + cờ `executedToday` reset theo ngày (mock device reset vào 00:00).

### 2.14 Mất Internet thì lịch có tiếp tục chạy không

- **Thiết kế: CÓ** — lịch thực thi **trên thiết bị**, không phụ thuộc server:
  1. Device đã nhận lịch trước đó và lưu local.
  2. Đến giờ, device tự bật/tắt dù không mạng, kết quả đẩy vào **hàng đợi offline**.
  3. Có mạng lại → device publish lần lượt kết quả trong hàng đợi lên `status` (kèm `command_id` sinh cục bộ) → backend ghi vào MongoDB như lệnh bình thường.
- Mock device (`scripts/mock-device.ts`) chứng minh đủ kịch bản này: phím `d` = ngắt mạng giả lập, `c` = có mạng lại + đồng bộ hàng đợi.
- Giới hạn đã biết: trong lúc offline, **web không thấy** thay đổi trạng thái (chỉ cập nhật khi device sync lại); lịch thêm mới trong lúc device offline sẽ chỉ đến device khi có mạng lại (QoS 1 + session sạch — nếu broker/device dùng persistent session thì nhận được cả message gửi khi offline).

---

## 3. Trạng thái vòng đời của một lệnh

```
UI bấm → POST API → [PENDING] → publish MQTT → device chạy
                     │                            │
                     │                 ┌──────────┴──────────┐
                     ▼                 ▼                     ▼
              [TIMEOUT] (sweeper   [SUCCESS]            [FAILED]
               sau 10s, không      state = ON/OFF       error = mã lỗi
               ai phản hồi)
```

UI hiển thị tương ứng: `Đang xử lý...` → `✅ Đã bật/Đã tắt` / `❌ Thất bại` / `⚠️ Timeout`.

---

## 4. Phân công hai team

| # | Hạng mục | Team |
|---|---|---|
| 1 | Chọn board, chân GPIO, relay/LED | 🔧 Nhúng |
| 2 | Firmware + MQTT client + reconnect | 🔧 Nhúng |
| 3 | ACK trung gian (nếu làm mục 2.5) | 🔧 Nhúng + Web |
| 4 | REST API + MQTT backend + MongoDB | ✅ Web (xong) |
| 5 | SSE realtime cho UI | ✅ Web (xong) |
| 6 | Online/Offline detection + sweeper TIMEOUT | ✅ Web (xong) |
| 7 | Lưu lịch server + đẩy xuống device | ✅ Web (xong) |
| 8 | Lưu lịch local + tự chạy khi mất mạng + sync queue | 🔧 Nhúng |
| 9 | NTP/RTC đồng bộ giờ | 🔧 Nhúng |
| 10 | Broker có auth/TLS, token theo device | Web (chưa làm — cần quyết định chung) |

---

## 5. Chạy thử hệ thống (team web)

```bash
npm run dev           # Next.js + API + SSE tại http://localhost:3000
npm run mock-device   # terminal riêng: giả lập ESP32 (đủ cả offline scheduling)
```

Biến môi trường `.env.local`:

```
MQTT_BROKER_URL=mqtt://broker.emqx.io:1883
MONGODB_URI=mongodb+srv://...   # MongoDB Atlas, DB iot-dashboard
```

Công cụ hỗ trợ:

```bash
node scripts/mqtt-probe.mjs          # giả làm thiết bị: heartbeat + trả lời lệnh PENDING mới nhất
node scripts/cleanup-test-data.mjs   # dọn document test (xem --help trong file)
```
