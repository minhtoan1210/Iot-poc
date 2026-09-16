/**
 * MQTT Mock Device - Simulates ESP32 with Offline Scheduling
 *
 * Usage:
 *   npx tsx scripts/mock-device.ts
 *
 * Features:
 * - Subscribes to devices/esp32-001/command (ON/OFF)
 * - Subscribes to devices/esp32-001/schedule (lưu lịch cục bộ)
 * - setInterval mỗi 1 phút kiểm tra lịch và tự thực thi
 * - Offline Mode: giả lập mất mạng, lưu kết quả vào offlineQueue
 * - Sync Mode: khi có mạng lại, đẩy offlineQueue lên server
 *
 * Keyboard controls (gõ trong terminal):
 *   d + Enter  → ngắt kết nối Internet giả lập
 *   c + Enter  → kết nối lại MQTT, đồng bộ hàng đợi
 *   q + Enter  → thoát chương trình
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import mqtt from "mqtt";

// ============================================================
// CONFIG
// ============================================================
const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
// Đổi được để chạy song song với board thật mà không giành nhau trả lời:
//   MOCK_DEVICE_ID=mock-01 npm run mock-device
const DEVICE_ID = process.env.MOCK_DEVICE_ID || "esp32-001";

const TOPIC_COMMAND = `devices/${DEVICE_ID}/command`;
const TOPIC_SCHEDULE = `devices/${DEVICE_ID}/schedule`;
const TOPIC_STATUS = `devices/${DEVICE_ID}/status`;
const TOPIC_HEARTBEAT = `devices/${DEVICE_ID}/heartbeat`;
const TOPIC_SCHEDULES = `devices/${DEVICE_ID}/schedules`;
const TOPIC_LWT = `devices/${DEVICE_ID}/lwt`;

/** Giả vờ là phiên bản firmware, để UI có gì đó hiển thị. */
const FW_VERSION = "mock-1.0.0";
const BOOT_MS = Date.now();

// ============================================================
// STATE
// ============================================================
let client: mqtt.MqttClient | null = null;
let isOffline = false;
let currentState: "ON" | "OFF" = "OFF";

/** Lịch nhận từ server, lưu cục bộ trên "thiết bị" */
interface LocalSchedule {
  schedule_id: string;
  time: string; // "HH:mm"
  command: "ON" | "OFF";
  enabled: boolean; // server tắt tạm thì vẫn giữ nhưng không kích hoạt
  executedToday: boolean; // đánh dấu đã thực thi hôm nay chưa
}
const localSchedules: LocalSchedule[] = [];

/** Hàng đợi kết quả thực thi khi offline */
interface OfflineQueueItem {
  command_id: string;
  state: "ON" | "OFF";
  timestamp: string;
  scheduled_time: string;
}
const offlineQueue: OfflineQueueItem[] = [];

// ============================================================
// HELPERS
// ============================================================
function now(): string {
  return new Date().toISOString();
}

function nowHHmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function generateCommandId(): string {
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================
// MQTT CONNECTION
// ============================================================
function connectMQTT(): void {
  if (client) {
    client.end(true);
  }

  console.log(`\n[MockDevice] 🔌 Đang kết nối tới MQTT Broker: ${BROKER_URL}`);
  console.log(`[MockDevice]    Device ID: ${DEVICE_ID}`);
  console.log(`[MockDevice]    Trạng thái: ${isOffline ? "OFFLINE" : "ONLINE"}`);

  client = mqtt.connect(BROKER_URL, {
    clientId: `mock-${DEVICE_ID}-${Date.now().toString(36)}`,
    clean: true,
    reconnectPeriod: 0, // không tự reconnect, ta tự xử lý
    connectTimeout: 5000,
    // Last Will: broker tự publish khi mất kết nối đột ngột → server đánh
    // OFFLINE ngay, không phải chờ hết 45s vắng heartbeat.
    will: {
      topic: TOPIC_LWT,
      payload: Buffer.from(
        JSON.stringify({
          device_id: DEVICE_ID,
          online: false,
          reason: "connection_lost",
        })
      ),
      qos: 1,
      retain: true,
    },
  });

  client.on("connect", () => {
    console.log("[MockDevice] ✅ Đã kết nối tới MQTT Broker");

    // Subscribe command & schedule
    client!.subscribe(TOPIC_COMMAND, { qos: 1 });
    client!.subscribe(TOPIC_SCHEDULE, { qos: 1 });
    console.log(`[MockDevice] 📡 Subscribed: ${TOPIC_COMMAND}`);
    console.log(`[MockDevice] 📡 Subscribed: ${TOPIC_SCHEDULE}`);

    // Ghi đè LWT retained của lần rớt trước
    client!.publish(
      TOPIC_LWT,
      JSON.stringify({ device_id: DEVICE_ID, online: true }),
      { qos: 1, retain: true }
    );

    // Gửi heartbeat lần đầu (kèm trạng thái đèn) + báo bảng lịch đang giữ
    sendHeartbeat();
    publishSchedules();

    // Đồng bộ hàng đợi offline nếu có
    if (offlineQueue.length > 0) {
      syncOfflineQueue();
    }
  });

  client.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());

      if (topic === TOPIC_COMMAND) {
        handleCommand(payload);
      } else if (topic === TOPIC_SCHEDULE) {
        handleSchedule(payload);
      }
    } catch (err) {
      console.error("[MockDevice] ❌ Lỗi parse message:", err);
    }
  });

  client.on("error", (err) => {
    console.error("[MockDevice] ❌ MQTT Error:", err.message);
  });

  client.on("offline", () => {
    console.log("[MockDevice] ⚠️  MQTT offline");
  });

  client.on("close", () => {
    if (!isOffline) {
      console.log("[MockDevice] ⚠️  MQTT connection closed");
    }
  });
}

// ============================================================
// COMMAND HANDLER
// ============================================================
function handleCommand(payload: { command_id: string; command: string }): void {
  console.log(`\n[MockDevice] 📩 Nhận lệnh: ${payload.command} (ID: ${payload.command_id})`);

  // BƯỚC 1 — ACK ngay: "tôi đã nhận được", đèn CHƯA đổi. Nhờ bước này server
  // phân biệt được "thiết bị không nghe thấy" với "nghe rồi, đang làm".
  // state ở đây là trạng thái hiện tại, chưa đổi.
  if (!isOffline) publishStatus(payload.command_id, currentState, "ACK", null);

  // BƯỚC 2 — giả lập 1 giây delay (bật/tắt LED thật) rồi báo kết quả
  setTimeout(() => {
    if (payload.command === "ON" || payload.command === "OFF") {
      currentState = payload.command as "ON" | "OFF";
      console.log(`[MockDevice] 💡 LED đã đổi sang: ${currentState}`);

      if (isOffline) {
        // Đang offline → lưu vào hàng đợi
        console.log(`[MockDevice] 📴 Đang offline, lưu kết quả vào hàng đợi offlineQueue`);
        offlineQueue.push({
          command_id: payload.command_id,
          state: currentState,
          timestamp: now(),
          scheduled_time: nowHHmm(),
        });
        console.log(`[MockDevice] 📋 Hàng đợi hiện có: ${offlineQueue.length} item(s)`);
      } else {
        // Online → publish status bình thường
        publishStatus(payload.command_id, currentState, "SUCCESS", null);
      }
    }
  }, 1000);
}

// ============================================================
// SCHEDULE HANDLER
// ============================================================
function handleSchedule(payload: {
  schedule_id: string;
  action?: "set" | "delete";
  time?: string;
  command?: string;
  enabled?: boolean;
  tz_offset_min?: number;
}): void {
  // Xoá: web đã bỏ lịch này. Không xử lý thì "thiết bị" vẫn bật đèn đúng giờ đó.
  if (payload.action === "delete") {
    const i = localSchedules.findIndex(
      (s) => s.schedule_id === payload.schedule_id
    );
    if (i < 0) {
      console.log(`\n[MockDevice] 📅 Xoá ${payload.schedule_id}: không có trong bộ nhớ`);
      return;
    }
    localSchedules.splice(i, 1);
    console.log(`\n[MockDevice] 🗑️  Đã xoá lịch ${payload.schedule_id}`);
    logSchedules();
    publishSchedules();
    return;
  }

  if (!payload.time || !payload.command) {
    console.log(`\n[MockDevice] ⚠️  Bỏ lịch ${payload.schedule_id}: thiếu time hoặc command`);
    return;
  }

  const enabled = payload.enabled !== false;
  console.log(
    `\n[MockDevice] 📅 Nhận lịch: ${payload.time} → ${payload.command}` +
      `${enabled ? "" : " [tạm tắt]"} (ID: ${payload.schedule_id})`
  );
  if (payload.tz_offset_min !== undefined) {
    console.log(`[MockDevice]    múi giờ server chỉ định: UTC${payload.tz_offset_min >= 0 ? "+" : ""}${payload.tz_offset_min / 60}`);
  }

  // Khoá là schedule_id: gửi lại cùng id thì sửa tại chỗ, không sinh bản trùng.
  const exists = localSchedules.find((s) => s.schedule_id === payload.schedule_id);
  if (exists) {
    exists.time = payload.time;
    exists.command = payload.command as "ON" | "OFF";
    exists.enabled = enabled;
    exists.executedToday = false;
    console.log(`[MockDevice] 🔄 Cập nhật lịch cũ: ${payload.schedule_id}`);
  } else {
    localSchedules.push({
      schedule_id: payload.schedule_id,
      time: payload.time,
      command: payload.command as "ON" | "OFF",
      enabled,
      executedToday: false,
    });
  }

  logSchedules();
  publishSchedules();
}

function logSchedules(): void {
  console.log(`[MockDevice] 📋 Tổng lịch hiện tại: ${localSchedules.length}`);
  localSchedules.forEach((s) => {
    const status = s.executedToday ? "✅ đã chạy" : "⏳ chờ";
    console.log(
      `[MockDevice]    ${s.time} → ${s.command} [${status}]${s.enabled ? "" : " (tạm tắt)"}`
    );
  });
}

/**
 * Báo lên server bảng lịch "thiết bị" đang thực sự giữ. Đây là đường phản hồi
 * duy nhất cho lịch — không có nó, server gửi lịch xuống rồi không biết có tới
 * nơi không.
 */
function publishSchedules(): void {
  if (!client || !client.connected) return;

  const payload = {
    device_id: DEVICE_ID,
    timestamp: now(),
    tz_offset_min: 420,
    schedules: localSchedules.map((s) => ({
      schedule_id: s.schedule_id,
      time: s.time,
      command: s.command,
      enabled: s.enabled,
    })),
  };

  client.publish(TOPIC_SCHEDULES, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) console.error("[MockDevice] ❌ Publish schedules thất bại:", err.message);
    else console.log(`[MockDevice] 📤 Đã báo bảng lịch: ${localSchedules.length} lịch`);
  });
}

// ============================================================
// CRONJOB KIỂM TRA LỊCH (chạy mỗi 60 giây)
// ============================================================
function checkSchedules(): void {
  const currentTime = nowHHmm();

  localSchedules.forEach((schedule) => {
    if (!schedule.enabled) return;
    if (schedule.time === currentTime && !schedule.executedToday) {
      console.log(`\n[MockDevice] ⏰ ĐÃ ĐẾN GIỜ: ${schedule.time} → ${schedule.command}`);

      // Thực thi lệnh
      currentState = schedule.command;
      schedule.executedToday = true;
      console.log(`[MockDevice] 💡 LED đã đổi sang: ${currentState}`);

      const commandId = generateCommandId();

      if (isOffline) {
        console.log(`[MockDevice] 📴 Đang offline, tự động BẬT/TẮT đèn và lưu vào hàng đợi.`);
        offlineQueue.push({
          command_id: commandId,
          state: currentState,
          timestamp: now(),
          scheduled_time: schedule.time,
        });
        console.log(`[MockDevice] 📋 Hàng đợi hiện có: ${offlineQueue.length} item(s)`);
      } else {
        console.log(`[MockDevice] 📡 Online, gửi status lên server...`);
        publishStatus(commandId, currentState, "SUCCESS", null);
      }
    }
  });

  // Reset executedToday vào nửa đêm (00:00)
  if (currentTime === "00:00") {
    localSchedules.forEach((s) => (s.executedToday = false));
    console.log("[MockDevice] 🔄 Đã reset executedToday cho tất cả lịch");
  }
}

// ============================================================
// PUBLISH STATUS
// ============================================================
function publishStatus(
  commandId: string,
  state: "ON" | "OFF",
  status: "ACK" | "SUCCESS" | "FAILED",
  error: string | null
): void {
  if (!client || !client.connected) {
    console.log("[MockDevice] ⚠️  Không thể publish, MQTT chưa kết nối");
    return;
  }

  const payload = {
    device_id: DEVICE_ID,
    command_id: commandId,
    status,
    state,
    timestamp: now(),
    error,
  };

  client.publish(TOPIC_STATUS, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error("[MockDevice] ❌ Publish status thất bại:", err.message);
    } else {
      console.log(`[MockDevice] ✅ Đã gửi status: ${status} → ${state}`);
    }
  });
}

// ============================================================
// HEARTBEAT
// ============================================================
function sendHeartbeat(): void {
  if (!client || !client.connected) return;

  const payload = {
    device_id: DEVICE_ID,
    timestamp: now(),
    // Trạng thái đèn đi kèm mỗi nhịp: server tự sửa lại nếu hai bên lệch
    // (mất điện, hoặc một bản tin status rơi giữa đường).
    state: currentState,
    fw: FW_VERSION,
    uptime_s: Math.floor((Date.now() - BOOT_MS) / 1000),
  };

  client.publish(TOPIC_HEARTBEAT, JSON.stringify(payload), { qos: 0 }, (err) => {
    if (err) {
      console.error("[MockDevice] ❌ Heartbeat error:", err.message);
    } else {
      console.log(`[MockDevice] 💓 Heartbeat sent (${nowHHmm()})`);
    }
  });
}

// ============================================================
// OFFLINE / RECONNECT SIMULATION
// ============================================================
function simulateDisconnect(): void {
  if (isOffline) {
    console.log("[MockDevice] ⚠️  Đã offline rồi, không cần ngắt thêm");
    return;
  }

  isOffline = true;

  if (client) {
    client.end(true, {}, () => {
      console.log("\n╔══════════════════════════════════════════════════╗");
      console.log("║  📴  ĐÃ NGẮT KẾT NỐI INTERNET GIẢ LẬP        ║");
      console.log("║  Thiết bị đang offline.                         ║");
      console.log("║  Lịch vẫn chạy tự động, kết quả lưu vào queue. ║");
      console.log("║  Gõ 'c' để kết nối lại và đồng bộ.             ║");
      console.log("╚══════════════════════════════════════════════════╝");
    });
    client = null;
  } else {
    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║  📴  ĐÃ NGẮT KẾT NỐI INTERNET GIẢ LẬP        ║");
    console.log("╚══════════════════════════════════════════════════╝");
  }
}

function simulateReconnect(): void {
  if (!isOffline) {
    console.log("[MockDevice] ⚠️  Đang online rồi, không cần kết nối lại");
    return;
  }

  isOffline = false;

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  🔌  ĐÃ CÓ MẠNG TRỞ LẠI                       ║");
  console.log(`║  Hàng đợi: ${offlineQueue.length} kết quả chưa đồng bộ.        ║`);
  console.log("║  Đang kết nối lại MQTT và đồng bộ...            ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  connectMQTT();
}

// ============================================================
// SYNC OFFLINE QUEUE
// ============================================================
function syncOfflineQueue(): void {
  if (offlineQueue.length === 0) {
    console.log("[MockDevice] ✅ Không có kết quả offline cần đồng bộ");
    return;
  }

  console.log(`\n[MockDevice] 🔄 Đang đồng bộ ${offlineQueue.length} kết quả cũ lên server...`);

  const items = [...offlineQueue];
  let synced = 0;

  const syncNext = (): void => {
    if (items.length === 0) {
      console.log(`[MockDevice] ✅ Đồng bộ hoàn tất: ${synced}/${offlineQueue.length} thành công`);
      offlineQueue.length = 0; // xóa hàng đợi
      return;
    }

    const item = items.shift()!;
    console.log(`[MockDevice] 📤 Đồng bộ: ${item.scheduled_time} → ${item.state} (ID: ${item.command_id})`);

    publishStatus(item.command_id, item.state, "SUCCESS", null);
    synced++;

    // Delay 500ms giữa mỗi lần publish để server xử lý
    setTimeout(syncNext, 500);
  };

  syncNext();
}

// ============================================================
// KEYBOARD CONTROLS
// ============================================================
function setupKeyboard(): void {
  process.stdin.setEncoding("utf-8");
  process.stdin.resume();

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  🎮  KEYBOARD CONTROLS                         ║");
  console.log("║  d + Enter  → Ngắt kết nối Internet (giả lập)  ║");
  console.log("║  c + Enter  → Kết nối lại + đồng bộ queue      ║");
  console.log("║  q + Enter  → Thoát chương trình               ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  process.stdin.on("data", (data: string) => {
    const key = data.trim().toLowerCase();

    if (key === "d") {
      simulateDisconnect();
    } else if (key === "c") {
      simulateReconnect();
    } else if (key === "q") {
      console.log("\n[MockDevice] 👋 Đang thoát...");
      if (client) {
        client.end(true, {}, () => process.exit(0));
      } else {
        process.exit(0);
      }
    }
  });
}

// ============================================================
// SCHEDULE CHECK INTERVAL (mỗi 30 giây)
// ============================================================
function startScheduleChecker(): void {
  setInterval(checkSchedules, 30_000); // 30s để test nhanh hơn (có thể đổi thành 60_000)
  console.log("[MockDevice] ⏰ Schedule checker started (kiểm tra mỗi 30 giây)");
}

// ============================================================
// MAIN
// ============================================================
console.log("╔══════════════════════════════════════════════════════╗");
console.log("║  🤖 MQTT Mock Device - ESP32 Simulator             ║");
console.log("║  Hỗ trợ Offline Scheduling + Queue Sync           ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// Bắt đầu
connectMQTT();
startScheduleChecker();
setupKeyboard();

// Heartbeat mỗi 15 giây
setInterval(() => {
  if (!isOffline) {
    sendHeartbeat();
  }
}, 15_000);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[MockDevice] 👋 Shutting down...");
  if (client) {
    client.end(true, {}, () => process.exit(0));
  } else {
    process.exit(0);
  }
});

process.on("SIGTERM", () => {
  console.log("\n[MockDevice] 👋 Shutting down...");
  if (client) {
    client.end(true, {}, () => process.exit(0));
  } else {
    process.exit(0);
  }
});
