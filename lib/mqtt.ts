import mqtt from "mqtt";
import type {
  DeviceState,
  MQTTCommandPayload,
  MQTTSchedulePayload,
} from "@/types/device";

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

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
      // Broker public hay reset TCP — reconnect nhanh để thu hẹp cửa sổ
      // mất message (QoS 1 + clean session không giữ message cho subscriber
      // đang ngắt kết nối).
      reconnectPeriod: 2000,
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
  command: DeviceState
): void {
  const mqttClient = getMQTTClient();
  const topic = `devices/${deviceId}/schedule`;
  const payload: MQTTSchedulePayload = {
    schedule_id: scheduleId,
    device_id: deviceId,
    time,
    command,
  };

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
type HeartbeatHandler = (deviceId: string, payload: unknown) => void;
type StatusHandler = (
  deviceId: string,
  payload: import("@/types/device").MQTTStatusPayload
) => void;

let heartbeatHandler: HeartbeatHandler | null = null;
let statusHandler: StatusHandler | null = null;

/**
 * Subscribe to all device topics once and route each message to
 * exactly one handler based on the topic suffix.
 */
export function subscribeDeviceTopics(handlers: {
  onHeartbeat: HeartbeatHandler;
  onStatus: StatusHandler;
}): void {
  const mqttClient = getMQTTClient();

  heartbeatHandler = handlers.onHeartbeat;
  statusHandler = handlers.onStatus;

  // Re-wire safely on dev hot-reload: the client lives on globalThis,
  // so drop the previous router before attaching the fresh one.
  mqttClient.removeAllListeners("message");

  mqttClient.subscribe(
    ["devices/+/heartbeat", "devices/+/status"],
    { qos: 1 },
    (err) => {
      if (err) {
        console.error("[MQTT] Failed to subscribe:", err.message);
      } else {
        console.log("[MQTT] Subscribed: devices/+/heartbeat, devices/+/status");
      }
    }
  );

  mqttClient.on("message", (topic, message) => {
      const parts = topic.split("/");
      // Expected: devices/<deviceId>/<kind>
      if (parts.length !== 3 || parts[0] !== "devices") return;
      const [, deviceId, kind] = parts;

      if (kind === "heartbeat") {
        try {
          heartbeatHandler?.(deviceId, JSON.parse(message.toString()));
        } catch (e) {
          console.error("[MQTT] Failed to parse heartbeat message:", e);
        }
      } else if (kind === "status") {
        try {
          statusHandler?.(deviceId, JSON.parse(message.toString()));
        } catch (e) {
          console.error("[MQTT] Failed to parse status message:", e);
        }
      }
  });
}
