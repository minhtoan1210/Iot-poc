# IoT PoC — Tài liệu API & Nguồn

> Tham chiếu chi tiết cho cả repo: mỗi API endpoint (công dụng + request/response payload), mỗi file nguồn làm gì (web và firmware), và toàn bộ MQTT payload.
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

Backend publish lịch xuống device qua MQTT topic `devices/{deviceId}/schedule` (payload xem mục 2.4) — **kể cả khi `enabled: false`**, với cờ `enabled` tương ứng: device cần biết lịch đó tồn tại thì sau này bật lại mới có tác dụng.

**Lỗi POST:** `400` — thiếu `time`/`command`, hoặc `time` không đúng `HH:MM`.

**DELETE response 200:** `{ "success": true }` · `404` nếu không tìm thấy lịch.
DELETE còn publish `action: "delete"` xuống device để xoá lịch khỏi NVS — không có bước này device vẫn bật đèn đúng giờ đó mãi.

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

**Sáu topic**, tất cả đều dưới `devices/{device_id}/`:

| Topic | Chiều | QoS | Nội dung |
|---|---|---|---|
| `command` | server → device | 1 | lệnh bật/tắt |
| `schedule` | server → device | 1 | thêm / sửa / xoá một lịch |
| `status` | device → server | 1 | ACK rồi kết quả thực thi |
| `heartbeat` | device → server | 0 | nhịp tim 15s, kèm trạng thái thật |
| `schedules` | device → server | 1 | bảng lịch device đang thực sự giữ |
| `lwt` | device/broker → server | 1, retained | còn sống / đã rớt |

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

### 2.2 📤 Device GỬI — Status (ACK, rồi kết quả)

**Topic:** `devices/{device_id}/status` · **QoS 1**

Mỗi lệnh sinh ra **hai** bản tin trên topic này:

**Bước 1 — ACK**, gửi ngay khi nhận được, chưa đóng cắt gì:

```json
{
  "device_id": "esp32-001",
  "command_id": "cmd-a1b2c3d4",
  "status": "ACK",
  "state": "OFF",
  "timestamp": "2026-09-14T10:30:00.120Z",
  "error": null
}
```

`state` ở bước này là trạng thái **hiện tại**, chưa đổi — backend không ghi nó vào kết quả lệnh.

**Bước 2 — kết quả**, sau khi device đã lái chân và **đọc lại xác minh**:

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

| Field | Giá trị | Mô tả |
|---|---|---|
| `status` | `"ACK"` | đã nhận lệnh, chưa thực hiện → command chuyển `PENDING` → `ACKNOWLEDGED` |
| | `"SUCCESS"` | đã thực hiện, đọc lại khớp |
| | `"FAILED"` | đã thử nhưng phần cứng không đạt trạng thái yêu cầu |
| `state` | `"ON"` / `"OFF"` | trạng thái đọc lại từ chân sau khi chạy |
| `error` | string / null | `"VERIFY_FAILED"`, `"DEVICE_BUSY"`… · `null` nếu không lỗi |

**Vì sao tách ACK:** trước đây "device chưa nhận được lệnh" và "device nhận rồi, đang chạy" đều nằm ở `PENDING`, không phân biệt được. Giờ backend chờ `PENDING` tối đa **10 giây**, còn `ACKNOWLEDGED` được tới **30 giây** rồi mới đánh `TIMEOUT`.

**Thứ tự không đảm bảo:** MQTT không hứa ACK tới trước kết quả. Backend chỉ cho lệnh đi tới (`PENDING → ACKNOWLEDGED → SUCCESS/FAILED`), một ACK tới muộn không kéo `SUCCESS` ngược về được.

⚠️ Backend **bỏ qua** payload thiếu `command_id` hoặc `state` (chống rác từ thiết bị lạ trên broker công khai).

### 2.3 📤 Device GỬI — Heartbeat

**Topic:** `devices/{device_id}/heartbeat` · **QoS 0** · mỗi **15 giây**

```json
{
  "device_id": "esp32-001",
  "timestamp": "2026-09-14T10:30:00.000Z",
  "state": "ON",
  "fw": "1.0.0",
  "uptime_s": 45
}
```

| Field | Mô tả |
|---|---|
| `state` | trạng thái **đọc lại từ chân**. Backend so với `currentState` trong DB, lệch thì sửa theo device |
| `fw` | phiên bản firmware, hiển thị trên UI |
| `uptime_s` | giây kể từ lần khởi động gần nhất — nhảy về 0 nghĩa là device vừa reboot |

Nhận heartbeat → device `ONLINE`, cập nhật `lastSeen`. Không heartbeat trong **45s** → sweeper đánh `OFFLINE`.

**`state` trong heartbeat là cơ chế tự chữa.** Mất điện rồi có lại, hoặc một bản tin `status` rơi mất giữa đường — trước đây web hiển thị sai vĩnh viễn vì không có gì đối chiếu. Giờ chậm nhất 15 giây là đúng lại.

Device vừa nối lại broker thì gửi heartbeat **ngay**, không chờ hết chu kỳ.

### 2.4 📥 Device NHẬN — Schedule

**Topic:** `devices/{device_id}/schedule` · **QoS 1**

```json
{
  "schedule_id": "schedule-x1y2z3",
  "device_id": "esp32-001",
  "action": "set",
  "time": "07:00",
  "command": "ON",
  "enabled": true,
  "tz_offset_min": 420
}
```

| Field | Mô tả |
|---|---|
| `schedule_id` | khoá để cập nhật/chống trùng. Gửi lại cùng id = sửa tại chỗ |
| `action` | `"set"` (mặc định) thêm hoặc sửa · `"delete"` xoá khỏi NVS của device |
| `time` | `"HH:MM"` — **giờ địa phương theo `tz_offset_min` bên dưới** |
| `command` | `"ON"` hoặc `"OFF"` |
| `enabled` | `false` = device vẫn giữ lịch nhưng không kích hoạt |
| `tz_offset_min` | phút lệch so với UTC, `420` = UTC+7. **Server quyết định**, device lưu vào NVS |

Xoá chỉ cần `schedule_id`:

```json
{ "schedule_id": "schedule-x1y2z3", "device_id": "esp32-001", "action": "delete" }
```

**Vì sao cần `action: "delete"`:** lịch nằm trong flash của device. Xoá dòng trong MongoDB thôi thì device vẫn bật đèn đúng giờ đó mãi mãi.

**Vì sao cần `tz_offset_min`:** `"07:00"` là 7 giờ ở đâu? Trước đây hai bên ngầm hiểu giống nhau. Giờ server nói rõ, device đem thiết bị đi múi giờ khác vẫn chạy đúng.

**Device offline thì mất lịch** — QoS 1 + clean session, broker không giữ. Bù lại: backend thấy device chuyển `OFFLINE → ONLINE` thì **tự đẩy lại toàn bộ lịch** đang bật.

### 2.5 📤 Device GỬI — Schedules (bảng lịch đang giữ)

**Topic:** `devices/{device_id}/schedules` · **QoS 1**

```json
{
  "device_id": "esp32-001",
  "timestamp": "2026-09-14T10:30:02.000Z",
  "tz_offset_min": 420,
  "schedules": [
    { "schedule_id": "schedule-x1y2z3", "time": "07:00", "command": "ON",  "enabled": true },
    { "schedule_id": "schedule-a4b5c6", "time": "22:00", "command": "OFF", "enabled": true }
  ]
}
```

Device gửi sau **mỗi lần đổi lịch** và sau khi **nối lại broker**. Backend lưu vào `devices.deviceSchedules` + `schedulesSyncedAt`.

Đây là đường phản hồi cho lịch — trước đây server gửi lịch xuống rồi thôi, không có cách nào biết device có nhận được không. Giờ đối chiếu được bảng này với collection `schedules`.

### 2.6 📤 Device GỬI — Presence / Last Will

**Topic:** `devices/{device_id}/lwt` · **QoS 1** · **retained**

Device đăng ký Last Will lúc connect. Broker tự publish khi mất kết nối đột ngột:

```json
{ "device_id": "esp32-001", "online": false, "reason": "connection_lost" }
```

Device vừa nối lại thì tự ghi đè:

```json
{ "device_id": "esp32-001", "online": true }
```

`online: false` → backend đánh `OFFLINE` **ngay lập tức**, không phải chờ hết 45 giây vắng heartbeat. `online: true` bị bỏ qua vì heartbeat đã lo việc đó.

Retained để backend kết nối sau vẫn đọc được trạng thái cuối cùng.

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

firmware/                        # ESP32 — PlatformIO + Arduino + FreeRTOS
  platformio.ini                 # Board, thư viện, FW_VERSION
  Makefile                       # make flash / build / monitor / ports / erase
  README.md                      # Bản đồ firmware + cách thêm task
  include/                       # Mỗi .h là giao diện của .cpp cùng tên
    config.h                     # Hằng số (chân GPIO kèm bản đồ chân ESP32,
                                 # timeout, stack task) + kiểu dữ liệu dùng chung
    secrets.example.h            # Mẫu WiFi + broker → copy thành secrets.h
    tasks.h                      # Sơ đồ 6 task ↔ 3 hàng đợi
  src/
    main.cpp                     # Khởi tạo theo thứ tự rồi trao quyền cho FreeRTOS
    tasks.cpp                    # Tạo hàng đợi + khởi động 6 task
    net.cpp                      # WiFi (reconnect backoff) + MQTT (4 topic)
    protocol.cpp                 # NƠI DUY NHẤT biết tên trường JSON (mục 2 ở trên)
    device.cpp                   # Relay: lái chân + đọc lại xác minh · trạng thái chung
    storage.cpp                  # NVS: lịch, trạng thái đèn, mốc giờ, outbox
    schedule.cpp                 # Bảng lịch trong NVS, khoá theo schedule_id
    clock.cpp                    # SNTP + mốc thô khi mất điện + đổi giờ địa phương
    log.cpp                      # applog() — log serial có mutex
    task_net.cpp                 # Chủ sở hữu WiFi/MQTT + đẩy outbox
    task_cmd.cpp                 # Chống trùng command_id, định tuyến, nạp lịch
    task_actuator.cpp            # Bật/tắt rồi ĐỌC LẠI xác minh → publish status
    task_schedule.cpp            # Quét lịch mỗi giây + catch-up sau khi boot
    task_health.cpp              # Heartbeat 15s + NTP + dòng log tóm tắt
    task_console.cpp             # Phím tắt serial: ép lỗi, giả lập mất mạng, xem lịch
```

### Luồng dữ liệu một lệnh (tóm tắt 1 màn hình)

```
[UI bấm ON]
   │ POST /commands
   ▼
commands/route.ts ──► db-service.createCommand() ──► MongoDB: {status: PENDING}
   │                        │ bắn command_updated
   │                        ▼
   │                    sse-manager ──► UI: "Đã gửi lệnh, chờ xác nhận..."
   │ publishCommand()
   ▼
MQTT devices/esp32-001/command ──► ESP32 nhận
   │
   ├──► status ACK (ngay lập tức, chưa đóng cắt)
   │      ▼
   │    updateCommandStatus() → ACKNOWLEDGED → SSE → UI: "Đã nhận lệnh, đang thực hiện..."
   │
   └──► lái chân GPIO → ĐỌC LẠI xác minh → status SUCCESS
          ▼
        mqtt.ts router ──► mqtt-handler ──► db-service.updateCommandStatus()
                                                │ MongoDB: SUCCESS + đồng bộ currentState
                                                │ bắn command_updated + device_updated
                                                ▼
                                            sse-manager ──► UI: "✅ Đã bật" + đèn ON

Hai đồng hồ đếm ngược của sweeper:
  PENDING quá 10s      → TIMEOUT  (device không hề trả lời, chắc không nghe thấy)
  ACKNOWLEDGED quá 30s → TIMEOUT  (device có nghe nhưng không báo kết quả)
```
