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
// Load .env.local trước (nếu có), .env làm fallback — dotenv không ghi đè
// biến đã tồn tại nên thứ tự này luôn ưu tiên .env.local.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import mqtt from "mqtt";

// ============================================================
// CONFIG
// ============================================================
const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const DEVICE_ID = "esp32-001";

const TOPIC_COMMAND = `devices/${DEVICE_ID}/command`;
const TOPIC_SCHEDULE = `devices/${DEVICE_ID}/schedule`;
const TOPIC_STATUS = `devices/${DEVICE_ID}/status`;
const TOPIC_HEARTBEAT = `devices/${DEVICE_ID}/heartbeat`;

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
    // Tự reconnect khi broker ngắt kết nối ngoài ý muốn (broker public
    // broker.emqx.io hay reset TCP). client.end() chủ động (phím 'd') vẫn
    // không bị auto-reconnect cản trở vì end() set cờ disconnecting.
    reconnectPeriod: 5000,
    connectTimeout: 5000,
  });

  client.on("connect", () => {
    console.log("[MockDevice] ✅ Đã kết nối tới MQTT Broker");

    // Subscribe command & schedule
    client!.subscribe(TOPIC_COMMAND, { qos: 1 });
    client!.subscribe(TOPIC_SCHEDULE, { qos: 1 });
    console.log(`[MockDevice] 📡 Subscribed: ${TOPIC_COMMAND}`);
    console.log(`[MockDevice] 📡 Subscribed: ${TOPIC_SCHEDULE}`);

    // Gửi heartbeat lần đầu
    sendHeartbeat();

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

  client.on("reconnect", () => {
    console.log("[MockDevice] 🔄 Đang tự kết nối lại MQTT broker...");
  });

  client.on("close", () => {
    if (!isOffline) {
      console.log("[MockDevice] ⚠️  MQTT connection closed (sẽ tự kết nối lại)");
    }
  });
}

// ============================================================
// COMMAND HANDLER
// ============================================================
function handleCommand(payload: { command_id: string; command: string }): void {
  console.log(`\n[MockDevice] 📩 Nhận lệnh: ${payload.command} (ID: ${payload.command_id})`);

  // Bước 1 (ACK flow): báo "đã nhận lệnh" ngay, trước khi bắt đầu chạy.
  // Server sẽ chuyển lệnh PENDING → ACKNOWLEDGED.
  const ackPayload = {
    device_id: DEVICE_ID,
    command_id: payload.command_id,
    status: "ACK",
    timestamp: now(),
    error: null,
  };
  if (!client || !client.connected) {
    console.error("[MockDevice] ❌ Không thể gửi ACK, MQTT chưa kết nối");
    return;
  }
  client.publish(TOPIC_STATUS, JSON.stringify(ackPayload), { qos: 1 }, (err) => {
    if (err) {
      console.error("[MockDevice] ❌ Gửi ACK thất bại:", err.message);
    } else {
      console.log(`[MockDevice] 📨 Đã gửi ACK cho ${payload.command_id}`);
    }
  });

  // Giả lập 1 giây delay (bật/tắt LED thật)
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
  time: string;
  command: string;
}): void {
  console.log(`\n[MockDevice] 📅 Nhận lịch mới: ${payload.time} → ${payload.command} (ID: ${payload.schedule_id})`);

  // Kiểm tra trùng lặp
  const exists = localSchedules.find((s) => s.schedule_id === payload.schedule_id);
  if (exists) {
    exists.time = payload.time;
    exists.command = payload.command as "ON" | "OFF";
    exists.executedToday = false;
    console.log(`[MockDevice] 🔄 Cập nhật lịch cũ: ${payload.schedule_id}`);
  } else {
    localSchedules.push({
      schedule_id: payload.schedule_id,
      time: payload.time,
      command: payload.command as "ON" | "OFF",
      executedToday: false,
    });
  }

  console.log(`[MockDevice] 📋 Tổng lịch hiện tại: ${localSchedules.length}`);
  localSchedules.forEach((s) => {
    const status = s.executedToday ? "✅ đã chạy" : "⏳ chờ";
    console.log(`[MockDevice]    ${s.time} → ${s.command} [${status}]`);
  });
}

// ============================================================
// CRONJOB KIỂM TRA LỊCH (chạy mỗi 60 giây)
// ============================================================
function checkSchedules(): void {
  const currentTime = nowHHmm();

  localSchedules.forEach((schedule) => {
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
  status: "SUCCESS" | "FAILED",
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
      // Broker public hay reset TCP giữa chừng — thử gửi lại sau khi
      // client tự kết nối lại, tránh backend chờ hoài rồi đánh TIMEOUT.
      setTimeout(() => {
        if (client && client.connected) {
          console.log("[MockDevice] 🔁 Gửi lại status sau lỗi...");
          client.publish(TOPIC_STATUS, JSON.stringify(payload), { qos: 1 });
        }
      }, 3000);
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
