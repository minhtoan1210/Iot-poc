# IoT PoC — Tài liệu API & Nguồn (Team Web)

> Tham chiếu chi tiết cho source tree của team web: mỗi API endpoint (công dụng + request/response payload), mỗi file nguồn làm gì, và toàn bộ MQTT payload.
>
> Kiến trúc tổng quan & quyết định thiết kế: [README.md](./README.md)

---

## 1. REST API

Base URL khi chạy local: `http://localhost:3000`

### 1.1 Gửi lệnh ON/OFF

```
POST /api/devices/{deviceId}/commands
```

**Công dụng:** UI bấm BẬT/TẮT. Backend lưu lệnh `PENDING` vào MongoDB **trước**, rồi mới publish MQTT xuống thiết bị (đảm bảo lệnh không mất nếu backend crash).

**Request body:**
```json
{ "command": "ON" }
```

**Response 201:**
```json
{
  "command_id": "cmd-a1b2c3d4",
  "device_id": "esp32-001",
  "command": "ON",
  "status": "PENDING",
  "createdAt": "2026-09-14T10:30:00.000Z",
  "updatedAt": "2026-09-14T10:30:00.000Z"
}
```

**Lỗi:** `400` — command không phải ON/OFF · `500` — lỗi DB/MQTT.

**Phụ:** `GET /api/devices/{deviceId}/commands` — 20 lệnh mới nhất (mới nhất trước), dùng cho lịch sử lệnh.

---

### 1.2 Dữ liệu ban đầu cho dashboard

```
GET /api/devices/{deviceId}
```

**Công dụng:** UI fetch **một lần khi vừa load trang** — thay vì nhiều endpoint — để có trạng thái thiết bị + lịch sử lệnh từ MongoDB. Nếu thiết bị chưa từng kết nối (chưa có document), trả về placeholder `OFFLINE` thay vì 404 để UI render được ngay.

**Response 200:**
```json
{
  "device": {
    "deviceId": "esp32-001",
    "name": "esp32-001",
    "status": "ONLINE",
    "currentState": "ON",
    "lastSeen": "2026-09-14T10:29:45.000Z",
    "lastCommand": "ON"
  },
  "lastCommand": {
    "commandId": "cmd-a1b2c3d4",
    "deviceId": "esp32-001",
    "command": "ON",
    "status": "SUCCESS",
    "state": "ON",
    "error": null,
    "createdAt": "2026-09-14T10:30:00.000Z",
    "updatedAt": "2026-09-14T10:30:01.500Z"
  },
  "commands": [ "...tối đa 20 lệnh, mới nhất trước..." ]
}
```

---

### 1.3 Trạng thái thiết bị (polling fallback)

```
GET /api/devices/{deviceId}/status
```

**Công dụng:** giống 1.2 nhưng **bắt buộc device phải tồn tại** (404 nếu chưa). UI đang poll mỗi 3s làm phương án dự phòng khi SSE đứt; SSE là kênh chính.

**Response 200:** giống mục 1.2 · **404:** `{ "error": "Device esp32-001 not found" }`

---

### 1.4 Quản lý lịch trình

```
GET  /api/devices/{deviceId}/schedules          — danh sách lịch (sort theo giờ)
POST /api/devices/{deviceId}/schedules          — tạo lịch mới
DELETE /api/devices/{deviceId}/schedules?scheduleId={id} — xóa lịch
```

**POST request body:**
```json
{ "time": "07:00", "command": "ON", "enabled": true }
```

**POST response 201:**
```json
{
  "scheduleId": "schedule-x1y2z3",
  "deviceId": "esp32-001",
  "time": "07:00",
  "command": "ON",
  "enabled": true,
  "createdAt": "2026-09-14T10:30:00.000Z"
}
```

Nếu `enabled: true`, backend publish lịch xuống device qua MQTT topic `devices/{deviceId}/schedule` (payload xem mục 2.4).

**Lỗi POST:** `400` — thiếu `time`/`command`, hoặc `time` không đúng `HH:MM`.

**DELETE response 200:** `{ "success": true }` · `404` nếu không tìm thấy lịch.

---

### 1.5 SSE — cập nhật realtime

```
GET /api/sse        (Content-Type: text/event-stream)
```

**Công dụng:** kênh đẩy realtime cho UI. Mỗi lần DB ghi thành công (heartbeat, kết quả lệnh, lịch), backend bắn event qua EventEmitter → tất cả client SSE nhận.

**Event stream:**
```
data: {"type":"connected","clientId":"c186482f-..."}

data: {"type":"heartbeat"}                      // keep-alive mỗi 30s

data: {"type":"device_update","data":{"deviceId":"esp32-001","status":"ONLINE","currentState":"ON","lastSeen":"...","lastCommand":"ON"}}

data: {"type":"command_update","data":{"commandId":"cmd-a1b2c3d4","deviceId":"esp32-001","command":"ON","status":"SUCCESS","state":"ON","error":null,"createdAt":"...","updatedAt":"..."}}

data: {"type":"schedule_update","data":{"scheduleId":"schedule-x1y2z3","deviceId":"esp32-001","time":"07:00","command":"ON","enabled":true,"createdAt":"..."}}
```

| `type` | Khi nào bắn | UI làm gì |
|---|---|---|
| `device_update` | heartbeat (→ ONLINE), sweeper (→ OFFLINE), device report state | cập nhật thẻ thiết bị + bóng đèn |
| `command_update` | tạo lệnh (PENDING), device trả kết quả, sweeper (TIMEOUT) | cập nhật badge trạng thái lệnh |
| `schedule_update` | tạo/xóa lịch | cập nhật danh sách lịch |

---

## 2. MQTT Payload (giao tiếp với Device)

Broker: `mqtt://broker.emqx.io:1883` · Format: JSON UTF-8, timestamp ISO 8601 UTC.

### 2.1 📥 Device NHẬN — Command

**Topic:** `devices/{device_id}/command` · **QoS 1**

```json
{
  "command_id": "cmd-a1b2c3d4",
  "device_id": "esp32-001",
  "command": "ON",
  "timestamp": "2026-09-14T10:30:00.000Z"
}
```

| Field | Kiểu | Mô tả |
|---|---|---|
| `command_id` | string | ID duy nhất của lệnh — **device phải trả lại nguyên vẹn** |
| `device_id` | string | ID thiết bị |
| `command` | string | `"ON"` hoặc `"OFF"` |
| `timestamp` | string | ISO 8601 UTC |

### 2.2 📤 Device GỬI — Status (kết quả thực thi)

**Topic:** `devices/{device_id}/status` · **QoS 1**

```json
{
  "device_id": "esp32-001",
  "command_id": "cmd-a1b2c3d4",
  "status": "SUCCESS",
  "state": "ON",
  "timestamp": "2026-09-14T10:30:01.500Z",
  "error": null
}
```

| Field | Kiểu | Giá trị | Mô tả |
|---|---|---|---|
| `device_id` | string | | ID thiết bị |
| `command_id` | string | | Trùng với lệnh đã nhận |
| `status` | string | `"SUCCESS"` / `"FAILED"` | Kết quả |
| `state` | string | `"ON"` / `"OFF"` | Trạng thái LED sau khi chạy |
| `timestamp` | string | | ISO 8601 UTC |
| `error` | string/null | `"GPIO_ERROR"`… | Mã lỗi; `null` nếu thành công |

⚠️ Backend **bỏ qua** payload thiếu `command_id` hoặc `state` (chống rác từ thiết bị lạ trên broker công khai).

### 2.3 📤 Device GỬI — Heartbeat

**Topic:** `devices/{device_id}/heartbeat` · **QoS 0** · mỗi **15 giây**

```json
{ "device_id": "esp32-001", "timestamp": "2026-09-14T10:30:00.000Z" }
```

Nhận heartbeat → device `ONLINE`, cập nhật `lastSeen`. Không heartbeat trong **45s** → sweeper đánh dấu `OFFLINE`.

### 2.4 📥 Device NHẬN — Schedule

**Topic:** `devices/{device_id}/schedule` · **QoS 1**

```json
{
  "schedule_id": "schedule-x1y2z3",
  "device_id": "esp32-001",
  "time": "07:00",
  "command": "ON"
}
```

| Field | Kiểu | Mô tả |
|---|---|---|
| `schedule_id` | string | ID lịch — dùng để chống nhận trùng |
| `device_id` | string | ID thiết bị |
| `time` | string | `"HH:MM"` giờ **local** của thiết bị |
| `command` | string | `"ON"` hoặc `"OFF"` |

Device lưu lịch local; đến giờ tự thực thi kể cả mất Internet; khi có mạng lại thì push kết quả lên `status`.

---

## 3. Source tree — từng file làm gì

```
app/
  page.tsx                       # Trang chủ: header + render <DashboardClient/>
  layout.tsx                     # HTML shell, font, metadata
  dashboard-client.tsx           # Toàn bộ UI logic (client component):
                                 #   fetch dữ liệu ban đầu, poll 3s fallback,
                                 #   SSE listener, gửi lệnh + timeout 10s, CRUD lịch
  api/
    sse/route.ts                 # GET  /api/sse — SSE stream, đăng ký client
    devices/[deviceId]/
      route.ts                   # GET  — dữ liệu ban đầu (device + commands)
      commands/route.ts          # POST — tạo lệnh PENDING + publish MQTT
                                 # GET  — 20 lệnh mới nhất
      status/route.ts            # GET  — device + commands (404 nếu chưa có device)
      schedules/route.ts         # GET/POST/DELETE — quản lý lịch

components/
  device-card.tsx                # Thẻ thiết bị: tên, trạng thái, đèn, info, controls
  device-controls.tsx            # Nút BẬT/TẮT
  light-bulb.tsx                 # Bóng đèn hiển thị ON/OFF + hiệu ứng đang xử lý
  command-status.tsx             # Badge PENDING/SUCCESS/FAILED/TIMEOUT
  schedule-list.tsx              # Danh sách lịch + form thêm lịch

lib/
  mongodb.ts                     # MongoClient singleton (globalThis, chống rò rỉ
                                 # kết nối khi hot-reload) + indexes + TTL 24h
  db-service.ts                  # Toàn bộ nghiệp vụ DB: CRUD devices/commands/
                                 # schedules + EventEmitter (dbEvents) bắn
                                 # device_updated/command_updated/schedule_updated
                                 # + sweepStaleData() (TIMEOUT/OFFLINE)
  mqtt.ts                        # MQTT client singleton + publish command/schedule
                                 # + router message theo topic (heartbeat/status)
  mqtt-handler.ts                # Wire: MQTT → db-service → dbEvents → SSE
                                 # + khởi động sweeper (mỗi 5s)
  sse-manager.ts                 # Registry client SSE + broadcastEvent()

types/device.ts                  # Type dùng chung: Device, Command, Schedule,
                                 # các *Doc (document MongoDB), MQTT payload types

scripts/
  mock-device.ts                 # Giả lập ESP32 đầy đủ: command, schedule,
                                 # offline queue + sync (phím d/c/q)
  mqtt-probe.mjs                 # Probe 1 lần: heartbeat + trả lời lệnh PENDING
  cleanup-test-data.mjs          # Dọn document test (--device/--command)
```

### Luồng dữ liệu một lệnh (tóm tắt 1 màn hình)

```
[UI bấm ON]
   │ POST /commands
   ▼
commands/route.ts ──► db-service.createCommand() ──► MongoDB: {status: PENDING}
   │                        │ bắn command_updated
   │                        ▼
   │                    sse-manager ──► UI: badge "Đang xử lý..."
   │ publishCommand()
   ▼
MQTT devices/esp32-001/command ──► ESP32 chạy → publish status SUCCESS
   │
   ▼
mqtt.ts router ──► mqtt-handler ──► db-service.updateCommandStatus()
                                        │ MongoDB: SUCCESS + đồng bộ device
                                        │ bắn command_updated + device_updated
                                        ▼
                                    sse-manager ──► UI: "✅ Đã bật" + đèn ON
(không ai trả lời sau 10s → sweeper đánh dấu TIMEOUT → SSE → UI: "⚠️ Timeout")
```
