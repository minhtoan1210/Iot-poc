import mqtt from "mqtt";
import type {
  DeviceState,
  MQTTCommandPayload,
  MQTTSchedulePayload,
} from "@/types/device";

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

/**
 * Which timezone the "HH:MM" in a schedule belongs to. The SERVER decides and
 * tells the device, so a device shipped anywhere still fires at the right local
 * time. 420 = UTC+7 (Asia/Ho_Chi_Minh).
 */
const SCHEDULE_TZ_OFFSET_MIN = Number(
  process.env.SCHEDULE_TZ_OFFSET_MIN ?? 420
);

let client: mqtt.MqttClient | null = null;

const globalForMqtt = globalThis as typeof globalThis & {
  __mqttClient?: mqtt.MqttClient;
};

export function getMQTTClient(): mqtt.MqttClient {
  if (!client) {
    // Reuse across dev hot-reload to avoid connection leaks
    client = globalForMqtt.__mqttClient ?? mqtt.connect(BROKER_URL, {
      clientId: `nextjs-backend-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });
    globalForMqtt.__mqttClient = client;

    client.on("connect", () => {
      console.log("[MQTT] Connected to broker:", BROKER_URL);
    });

    client.on("error", (err) => {
      console.error("[MQTT] Connection error:", err.message);
    });

    client.on("offline", () => {
      console.log("[MQTT] Client offline");
    });

    client.on("reconnect", () => {
      console.log("[MQTT] Reconnecting...");
    });
  }
  return client;
}

// ============================================================
// PUBLISH HELPERS
// ============================================================
export function publishCommand(
  deviceId: string,
  commandId: string,
  command: DeviceState
): void {
  const mqttClient = getMQTTClient();
  const topic = `devices/${deviceId}/command`;
  const payload: MQTTCommandPayload = {
    command_id: commandId,
    device_id: deviceId,
    command,
    timestamp: new Date().toISOString(),
  };

  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error("[MQTT] Failed to publish command:", err.message);
    } else {
      console.log(`[MQTT] Published command to ${topic}:`, command);
    }
  });
}

export function publishSchedule(
  deviceId: string,
  scheduleId: string,
  time: string,
  command: DeviceState,
  enabled = true
): void {
  const payload: MQTTSchedulePayload = {
    schedule_id: scheduleId,
    device_id: deviceId,
    action: "set",
    time,
    command,
    enabled,
    tz_offset_min: SCHEDULE_TZ_OFFSET_MIN,
  };
  sendSchedule(deviceId, payload);
}

/**
 * Tell the device to drop a schedule. Without this the device keeps firing a
 * schedule the user already deleted on the website — it lives in NVS.
 */
export function publishScheduleDelete(
  deviceId: string,
  scheduleId: string
): void {
  sendSchedule(deviceId, {
    schedule_id: scheduleId,
    device_id: deviceId,
    action: "delete",
  });
}

function sendSchedule(deviceId: string, payload: MQTTSchedulePayload): void {
  const mqttClient = getMQTTClient();
  const topic = `devices/${deviceId}/schedule`;

  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error("[MQTT] Failed to publish schedule:", err.message);
    } else {
      console.log(`[MQTT] Published schedule to ${topic}:`, payload);
    }
  });
}

// ============================================================
// SUBSCRIPTION + MESSAGE ROUTING
// ============================================================
type Handlers = {
  onHeartbeat: (
    deviceId: string,
    payload: import("@/types/device").MQTTHeartbeatPayload
  ) => void;
  onStatus: (
    deviceId: string,
    payload: import("@/types/device").MQTTStatusPayload
  ) => void;
  /** Device reported the schedule table it actually holds in NVS. */
  onSchedules: (
    deviceId: string,
    payload: import("@/types/device").MQTTSchedulesPayload
  ) => void;
  /** Last Will (online:false) or the birth message the device sends on connect. */
  onPresence: (
    deviceId: string,
    payload: import("@/types/device").MQTTPresencePayload
  ) => void;
};

let handlers: Handlers | null = null;

const SUBSCRIPTIONS = [
  "devices/+/heartbeat",
  "devices/+/status",
  "devices/+/schedules",
  "devices/+/lwt",
];

/**
 * Subscribe to all device topics once and route each message to
 * exactly one handler based on the topic suffix.
 */
export function subscribeDeviceTopics(h: Handlers): void {
  const mqttClient = getMQTTClient();

  handlers = h;

  // Re-wire safely on dev hot-reload: the client lives on globalThis,
  // so drop the previous router before attaching the fresh one.
  mqttClient.removeAllListeners("message");

  mqttClient.subscribe(SUBSCRIPTIONS, { qos: 1 }, (err) => {
    if (err) {
      console.error("[MQTT] Failed to subscribe:", err.message);
    } else {
      console.log("[MQTT] Subscribed:", SUBSCRIPTIONS.join(", "));
    }
  });

  mqttClient.on("message", (topic, message) => {
    const parts = topic.split("/");
    // Expected: devices/<deviceId>/<kind>
    if (parts.length !== 3 || parts[0] !== "devices") return;
    const [, deviceId, kind] = parts;

    // A retained LWT is delivered as an empty buffer once it is cleared.
    const raw = message.toString();
    if (!raw) return;

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.error(`[MQTT] Ignoring non-JSON message on ${topic}`);
      return;
    }

    switch (kind) {
      case "heartbeat":
        handlers?.onHeartbeat(deviceId, payload as never);
        break;
      case "status":
        handlers?.onStatus(deviceId, payload as never);
        break;
      case "schedules":
        handlers?.onSchedules(deviceId, payload as never);
        break;
      case "lwt":
        handlers?.onPresence(deviceId, payload as never);
        break;
    }
  });
}
