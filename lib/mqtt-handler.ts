import { subscribeDeviceTopics } from "./mqtt";
import {
  updateHeartbeat,
  updateCommandStatus,
  updateDeviceLastCommand,
  sweepStaleData,
  dbEvents,
} from "./db-service";
import { broadcastEvent } from "./sse-manager";
import type { MQTTStatusPayload } from "@/types/device";

let initialized = false;

export function initializeMQTTHandlers(): void {
  if (initialized) return;
  initialized = true;

  console.log("[Handler] Initializing MQTT handlers (MongoDB-backed)...");

  // Re-wire cleanly on dev hot-reload: the event bus lives on globalThis,
  // so drop listeners created by the previous module evaluation first,
  // otherwise every reload would stack duplicate SSE broadcasts.
  dbEvents.removeAllListeners();

  // ============================================================
  // BRIDGE: DB events (EventEmitter) → SSE broadcast
  // All DB writes funnel through dbEvents; every connected dashboard
  // receives device_update / command_update / schedule_update events.
  // ============================================================
  dbEvents.on("device_updated", (device: import("@/types/device").Device) =>
    broadcastEvent({ type: "device_update", data: device })
  );
  dbEvents.on("command_updated", (command: import("@/types/device").Command) =>
    broadcastEvent({ type: "command_update", data: command })
  );
  dbEvents.on("schedule_updated", (schedule: import("@/types/device").Schedule) =>
    broadcastEvent({ type: "schedule_update", data: schedule })
  );

  subscribeDeviceTopics({
    /**
     * devices/+/heartbeat → update lastSeen + status ONLINE in DB,
     * then broadcast device_updated for SSE.
     */
    onHeartbeat: (deviceId: string) => {
      updateHeartbeat(deviceId)
        .then(() => {
          console.log(`[Handler] Heartbeat from ${deviceId} → DB updated`);
        })
        .catch((err) => {
          console.error(
            `[Handler] Failed to update heartbeat for ${deviceId}:`,
            err
          );
        });
    },

    /**
     * devices/+/status → update command SUCCESS/FAILED + device state in DB,
     * then broadcast command_updated + device_updated for SSE.
     */
    onStatus: (deviceId: string, payload: MQTTStatusPayload) => {
      // Guard: the public broker carries foreign devices sending empty or
      // malformed payloads — never let them pollute the database.
      if (!payload || !payload.command_id || !payload.state) {
        console.warn(
          `[Handler] Ignoring malformed status from ${deviceId}:`,
          JSON.stringify(payload)
        );
        return;
      }

      // Defensive: honor device_id inside the payload, fallback to topic
      const targetDeviceId = payload.device_id || deviceId;

      updateCommandStatus(
        payload.command_id,
        payload.status,
        payload.state,
        payload.error
      )
        .then((command) => {
          if (!command) {
            console.warn(
              `[Handler] Status for unknown command ${payload.command_id}`
            );
            return;
          }
          console.log(
            `[Handler] Command ${payload.command_id} → ${command.status}`
          );
        })
        .catch((err) => {
          console.error(
            `[Handler] Failed to update command ${payload.command_id}:`,
            err
          );
        });

      // currentState is already synced inside updateCommandStatus,
      // but keep lastCommand fresh for the device info panel
      updateDeviceLastCommand(targetDeviceId, payload.state)
        .catch((err) => {
          console.error(
            `[Handler] Failed to update lastCommand for ${targetDeviceId}:`,
            err
          );
        });
    },
  });

  // ============================================================
  // TIMEOUT SWEEPER — periodic maintenance
  // Runs alongside MQTT handlers; globalThis guard prevents duplicates
  // across dev hot-reloads (same pattern as the MQTT client).
  // ============================================================
  const globalForSweeper = globalThis as typeof globalThis & {
    __sweeperInterval?: NodeJS.Timeout;
  };
  if (!globalForSweeper.__sweeperInterval) {
    const SWEEP_INTERVAL_MS = 5_000;
    globalForSweeper.__sweeperInterval = setInterval(
      () => {
        sweepStaleData().catch((err) =>
          console.error("[Sweeper] Failed:", err)
        );
      },
      SWEEP_INTERVAL_MS
    );
    console.log(
      `[Sweeper] Started (every ${SWEEP_INTERVAL_MS / 1000}s: stale PENDING → TIMEOUT, silent devices → OFFLINE)`
    );
  }
}
