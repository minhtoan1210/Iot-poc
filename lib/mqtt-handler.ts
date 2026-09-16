import { subscribeDeviceTopics, publishSchedule } from "./mqtt";
import {
  updateHeartbeat,
  updateCommandStatus,
  updateDeviceLastCommand,
  markDeviceOffline,
  saveDeviceSchedules,
  getSchedulesByDevice,
  sweepStaleData,
  dbEvents,
} from "./db-service";
import { broadcastEvent } from "./sse-manager";
import type {
  MQTTStatusPayload,
  MQTTHeartbeatPayload,
  MQTTSchedulesPayload,
  MQTTPresencePayload,
} from "@/types/device";

let initialized = false;

/**
 * The device just reconnected. Anything published to it while it was away was
 * dropped by the broker (QoS 1 + clean session), so push the schedules down
 * again — otherwise a schedule created during the outage would silently never
 * run. Upserts are keyed by schedule_id, so re-sending is harmless.
 */
async function resyncSchedules(deviceId: string): Promise<void> {
  const schedules = await getSchedulesByDevice(deviceId);
  const enabled = schedules.filter((s) => s.enabled);
  if (enabled.length === 0) return;

  console.log(
    `[Handler] ${deviceId} came back online → re-sending ${enabled.length} schedule(s)`
  );
  for (const s of enabled) {
    publishSchedule(deviceId, s.scheduleId, s.time, s.command, s.enabled);
  }
}

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
     * devices/+/heartbeat → ONLINE + lastSeen, and re-sync the output state
     * the device reports, so a power cut or a lost status message cannot leave
     * the dashboard showing the wrong thing forever.
     */
    onHeartbeat: (deviceId: string, payload: MQTTHeartbeatPayload) => {
      updateHeartbeat(deviceId, {
        state: payload?.state,
        firmware: payload?.fw,
      })
        .then(({ cameOnline, stateCorrected }) => {
          if (stateCorrected) {
            console.log(
              `[Handler] ${deviceId} reported state ${payload.state} — corrected the stored value`
            );
          }
          if (cameOnline) return resyncSchedules(deviceId);
        })
        .catch((err) => {
          console.error(
            `[Handler] Failed to update heartbeat for ${deviceId}:`,
            err
          );
        });
    },

    /**
     * devices/+/status → two messages per command:
     *   ACK              device received it, nothing switched yet
     *   SUCCESS/FAILED   device switched and read the pin back
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
      if (!["ACK", "SUCCESS", "FAILED"].includes(payload.status)) {
        console.warn(
          `[Handler] Ignoring unknown status "${payload.status}" from ${deviceId}`
        );
        return;
      }

      // Defensive: honor device_id inside the payload, fallback to topic
      const targetDeviceId = payload.device_id || deviceId;
      const isAck = payload.status === "ACK";

      updateCommandStatus(
        payload.command_id,
        payload.status,
        payload.state,
        payload.error
      )
        .then((command) => {
          if (!command) {
            // Either a command we never stored (a schedule the device ran on
            // its own), or a late message for one already finished.
            console.warn(
              `[Handler] Status ${payload.status} for ${payload.command_id} did not apply (unknown or already final)`
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

      // An ACK carries the state from BEFORE the switch, so it says nothing
      // about the outcome. Only record the state on a real result.
      if (!isAck) {
        updateDeviceLastCommand(targetDeviceId, payload.state).catch((err) => {
          console.error(
            `[Handler] Failed to update lastCommand for ${targetDeviceId}:`,
            err
          );
        });
      }
    },

    /**
     * devices/+/schedules → the table the device actually holds in NVS.
     * Lets the UI show the hardware's own answer instead of assuming every
     * schedule message we published arrived.
     */
    onSchedules: (deviceId: string, payload: MQTTSchedulesPayload) => {
      if (!payload || !Array.isArray(payload.schedules)) {
        console.warn(`[Handler] Ignoring malformed schedules from ${deviceId}`);
        return;
      }
      const rows = payload.schedules
        .filter((s) => s && s.schedule_id && s.time)
        .map((s) => ({
          scheduleId: s.schedule_id,
          time: s.time,
          command: s.command,
          enabled: s.enabled !== false,
        }));

      saveDeviceSchedules(payload.device_id || deviceId, rows)
        .then((device) =>
          console.log(
            device
              ? `[Handler] ${deviceId} holds ${rows.length} schedule(s) in NVS`
              : `[Handler] Could not store the schedule report from ${deviceId}`
          )
        )
        .catch((err) =>
          console.error(
            `[Handler] Failed to store reported schedules for ${deviceId}:`,
            err
          )
        );
    },

    /**
     * devices/+/lwt → retained presence. online:false is published by the
     * BROKER when the device drops, so the dashboard flips to OFFLINE at once
     * instead of waiting out the 45s heartbeat window.
     */
    onPresence: (deviceId: string, payload: MQTTPresencePayload) => {
      if (!payload || payload.online !== false) return; // online:true handled by heartbeat

      markDeviceOffline(payload.device_id || deviceId)
        .then((device) => {
          if (device) {
            console.log(
              `[Handler] ${deviceId} → OFFLINE via Last Will (${payload.reason ?? "connection lost"})`
            );
          }
        })
        .catch((err) =>
          console.error(`[Handler] Failed to apply LWT for ${deviceId}:`, err)
        );
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
      `[Sweeper] Started (every ${SWEEP_INTERVAL_MS / 1000}s: stale PENDING/ACKNOWLEDGED → TIMEOUT, silent devices → OFFLINE)`
    );
  }
}
