import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type {
  Device,
  Command,
  Schedule,
  DeviceDoc,
  CommandDoc,
  ScheduleDoc,
  DeviceState,
  CommandStatus,
  DeviceSchedule,
} from "@/types/device";
import {
  devicesCollection,
  commandsCollection,
  schedulesCollection,
  connectDB,
  ensureIndexes,
} from "./mongodb";

// ============================================================
// EVENT EMITTER (SSE bridge)
// ============================================================
export type DBEvent =
  | { type: "device_updated"; data: Device }
  | { type: "command_updated"; data: Command }
  | { type: "schedule_updated"; data: Schedule };

const globalForBus = globalThis as typeof globalThis & {
  __dbEventBus?: EventEmitter;
};

export const dbEvents: EventEmitter =
  globalForBus.__dbEventBus ?? new EventEmitter();
dbEvents.setMaxListeners(0); // unlimited: many SSE routes may subscribe

// Survive dev hot-reload so SSE subscribers don't get orphaned
if (process.env.NODE_ENV !== "production") {
  globalForBus.__dbEventBus = dbEvents;
}

function emitDeviceUpdated(device: Device): void {
  dbEvents.emit("device_updated", device);
}

function emitCommandUpdated(command: Command): void {
  dbEvents.emit("command_updated", command);
}

// ============================================================
// MAPPERS: Mongo documents → API/Client shapes
// ============================================================
function mapDevice(doc: DeviceDoc): Device {
  return {
    deviceId: doc.deviceId,
    name: doc.name,
    status: doc.status,
    currentState: doc.currentState,
    lastSeen: doc.lastSeen ? doc.lastSeen.toISOString() : null,
    lastCommand: doc.lastCommand,
    firmware: doc.firmware ?? null,
    deviceSchedules: doc.deviceSchedules ?? null,
    schedulesSyncedAt: doc.schedulesSyncedAt
      ? doc.schedulesSyncedAt.toISOString()
      : null,
  };
}

function mapCommand(doc: CommandDoc): Command {
  return {
    commandId: doc.commandId,
    deviceId: doc.deviceId,
    command: doc.command,
    status: doc.status,
    state: doc.state,
    error: doc.error,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function mapSchedule(doc: ScheduleDoc): Schedule {
  return {
    scheduleId: doc.scheduleId,
    deviceId: doc.deviceId,
    time: doc.time,
    command: doc.command,
    enabled: doc.enabled,
    createdAt: doc.createdAt.toISOString(),
  };
}

// ============================================================
// ONE-TIME INIT (indexes) — call before first DB use
// ============================================================
export async function initDB(): Promise<void> {
  await connectDB();
  await ensureIndexes();
}

// ============================================================
// DEVICE OPERATIONS
// ============================================================

/**
 * Ensures a device document exists in the `devices` collection.
 * Creates it on first heartbeat/command if not present.
 */
export async function ensureDevice(
  deviceId: string,
  name = deviceId
): Promise<Device> {
  const col = await devicesCollection();
  const now = new Date();

  const doc = await col.findOneAndUpdate(
    { deviceId },
    [
      {
        $set: {
          deviceId,
          name: { $ifNull: ["$name", name] },
          status: { $ifNull: ["$status", "OFFLINE"] },
          currentState: { $ifNull: ["$currentState", "OFF"] },
          lastSeen: { $ifNull: ["$lastSeen", null] },
          lastCommand: { $ifNull: ["$lastCommand", null] },
          createdAt: { $ifNull: ["$createdAt", now] },
          updatedAt: now,
        },
      },
    ],
    { upsert: true, returnDocument: "after" }
  );

  return mapDevice(doc as DeviceDoc);
}

/**
 * A heartbeat arrived. Besides keeping the device ONLINE, the heartbeat now
 * carries the output state the device actually read back from its pin, so the
 * server re-syncs even after a power cut or a lost status message — without it
 * a wrong currentState would stay wrong forever.
 *
 * Returns `cameOnline` so the caller can push the schedules down again: while
 * the device was away, schedule messages published to it were dropped by the
 * broker (QoS 1 + clean session).
 */
export async function updateHeartbeat(
  deviceId: string,
  info: { state?: DeviceState; firmware?: string } = {}
): Promise<{ device: Device; cameOnline: boolean; stateCorrected: boolean }> {
  await ensureIndexes();
  const now = new Date();

  const before = await (await devicesCollection()).findOne({ deviceId });

  const set: Record<string, unknown> = {
    lastSeen: now,
    status: "ONLINE",
    updatedAt: now,
  };
  if (info.state) set.currentState = info.state;
  if (info.firmware) set.firmware = info.firmware;

  const insert: Record<string, unknown> = {
    deviceId,
    name: deviceId,
    lastCommand: null,
    createdAt: now,
  };
  // NOTE: a field must not appear in both $set and $setOnInsert — MongoDB
  // rejects that with "Updating the path 'x' would create a conflict".
  if (!info.state) insert.currentState = "OFF";

  const doc = await (
    await devicesCollection()
  ).findOneAndUpdate(
    { deviceId },
    { $set: set, $setOnInsert: insert },
    { upsert: true, returnDocument: "after" }
  );

  const device = mapDevice(doc as DeviceDoc);
  emitDeviceUpdated(device);

  return {
    device,
    cameOnline: !before || before.status !== "ONLINE",
    stateCorrected: Boolean(
      before && info.state && before.currentState !== info.state
    ),
  };
}

/**
 * The broker delivered the device's Last Will: the TCP connection dropped.
 * Faster and more certain than waiting 45s for missed heartbeats.
 */
export async function markDeviceOffline(
  deviceId: string
): Promise<Device | null> {
  const doc = await (
    await devicesCollection()
  ).findOneAndUpdate(
    { deviceId, status: "ONLINE" },
    { $set: { status: "OFFLINE", updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!doc) return null;

  const device = mapDevice(doc);
  emitDeviceUpdated(device);
  return device;
}

/**
 * Record the schedule table the device says it is holding in NVS. Lets the UI
 * show what the hardware really has instead of assuming every schedule message
 * arrived.
 */
export async function saveDeviceSchedules(
  deviceId: string,
  schedules: DeviceSchedule[]
): Promise<Device | null> {
  const now = new Date();
  const doc = await (
    await devicesCollection()
  ).findOneAndUpdate(
    { deviceId },
    {
      $set: {
        deviceSchedules: schedules,
        schedulesSyncedAt: now,
        updatedAt: now,
      },
      // Upsert: MQTT does not order messages across topics, so this report can
      // land before the device's first heartbeat has created the document.
      // Without it the report would be dropped and the UI would show nothing.
      $setOnInsert: {
        deviceId,
        name: deviceId,
        status: "OFFLINE",
        currentState: "OFF",
        lastSeen: null,
        lastCommand: null,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: "after" }
  );
  if (!doc) return null;

  const device = mapDevice(doc);
  emitDeviceUpdated(device);
  return device;
}

/**
 * Persist the reported device state (from devices/+/status).
 */
export async function updateDeviceState(
  deviceId: string,
  state: DeviceState
): Promise<Device> {
  const doc = await (
    await devicesCollection()
  ).findOneAndUpdate(
    { deviceId },
    { $set: { currentState: state, updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );

  const device = mapDevice(doc as DeviceDoc);
  emitDeviceUpdated(device);
  return device;
}

/**
 * Persist the last command issued for a device (UI info panel).
 */
export async function updateDeviceLastCommand(
  deviceId: string,
  command: DeviceState
): Promise<Device> {
  const doc = await (
    await devicesCollection()
  ).findOneAndUpdate(
    { deviceId },
    { $set: { lastCommand: command, updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );

  return mapDevice(doc as DeviceDoc);
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  const doc = await (await devicesCollection()).findOne({ deviceId });
  return doc ? mapDevice(doc) : null;
}

export async function getAllDevices(): Promise<Device[]> {
  const docs = await (await devicesCollection()).find({}).toArray();
  return docs.map(mapDevice);
}

// ============================================================
// COMMAND OPERATIONS
// ============================================================

/** Create a PENDING command document before publishing to MQTT. */
export async function createCommand(
  deviceId: string,
  command: DeviceState
): Promise<Command> {
  await ensureIndexes();
  const now = new Date();
  const commandId = `cmd-${uuidv4().slice(0, 8)}`;

  const doc: CommandDoc = {
    commandId,
    deviceId,
    command,
    status: "PENDING",
    state: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  await (await commandsCollection()).insertOne(doc);

  const created = mapCommand(doc);
  emitCommandUpdated(created);
  return created;
}

export async function getCommand(commandId: string): Promise<Command | null> {
  const doc = await (await commandsCollection()).findOne({ commandId });
  return doc ? mapCommand(doc) : null;
}

/**
 * Update a command's status after the device reports on devices/+/status.
 * Also syncs the device's currentState so the UI reflects reality.
 */
export async function updateCommandStatus(
  commandId: string,
  reported: "ACK" | "SUCCESS" | "FAILED",
  state: DeviceState | null = null,
  error: string | null = null
): Promise<Command | null> {
  const now = new Date();
  const isAck = reported === "ACK";
  const status: CommandStatus = isAck ? "ACKNOWLEDGED" : reported;

  // Only move a command forward. An ACK that arrives after the result (MQTT
  // gives no ordering guarantee across messages) must not drag SUCCESS back to
  // ACKNOWLEDGED, and a result must not overwrite a TIMEOUT that already fired.
  const allowedNow: CommandStatus[] = isAck
    ? ["PENDING"]
    : ["PENDING", "ACKNOWLEDGED"];

  // On ACK the device has not switched anything yet: its "state" is still the
  // old one, so do not record it as the command's result.
  const set: Record<string, unknown> = { status, updatedAt: now };
  if (!isAck) {
    set.state = state;
    set.error = error;
  }

  const doc = await (
    await commandsCollection()
  ).findOneAndUpdate(
    { commandId, status: { $in: allowedNow } },
    { $set: set },
    { returnDocument: "after" }
  );

  if (!doc) return null;

  const command = mapCommand(doc);
  emitCommandUpdated(command);

  // Keep device state in sync with the actual reported state
  if (!isAck && state) {
    await updateDeviceState(command.deviceId, state);
  }
  return command;
}

/** Latest N commands for a device (newest first). */
export async function getCommandsByDevice(
  deviceId: string,
  limit = 20
): Promise<Command[]> {
  const docs = await (
    await commandsCollection()
  )
    .find({ deviceId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(mapCommand);
}

// ============================================================
// TIMEOUT SWEEPER
// ============================================================
// Commands stuck in PENDING longer than this are marked TIMEOUT: the device
// never even acknowledged, so it is probably not listening.
// Must match the UI's COMMAND_TIMEOUT_MS.
export const COMMAND_TIMEOUT_MS = 10_000;
// A command the device DID acknowledge gets longer: it confirmed receipt, so
// the failure mode is a slow or stuck execution, not a lost message.
export const COMMAND_EXEC_TIMEOUT_MS = 30_000;
// Devices whose lastSeen is older than this are marked OFFLINE
// (3 missed 15s heartbeats).
export const DEVICE_OFFLINE_MS = 45_000;

/**
 * Periodic maintenance:
 * 1. PENDING commands older than COMMAND_TIMEOUT_MS → status TIMEOUT
 *    (each one broadcast as command_updated so all UIs sync)
 * 2. ONLINE devices with stale lastSeen → status OFFLINE
 *    (each one broadcast as device_updated)
 */
export async function sweepStaleData(): Promise<{
  timedOutCommands: Command[];
  offlineDevices: Device[];
}> {
  const now = Date.now();

  // 1) Expire commands the device never finished — two different deadlines
  //    depending on whether it acknowledged receipt.
  const staleCommands = await (
    await commandsCollection()
  )
    .find({
      $or: [
        {
          status: "PENDING",
          createdAt: { $lt: new Date(now - COMMAND_TIMEOUT_MS) },
        },
        {
          status: "ACKNOWLEDGED",
          updatedAt: { $lt: new Date(now - COMMAND_EXEC_TIMEOUT_MS) },
        },
      ],
    })
    .toArray();

  const timedOutCommands: Command[] = [];
  for (const doc of staleCommands) {
    const updated = await (await commandsCollection()).findOneAndUpdate(
      { commandId: doc.commandId, status: doc.status }, // re-check to avoid race
      { $set: { status: "TIMEOUT", updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (updated) {
      const command = mapCommand(updated);
      timedOutCommands.push(command);
      emitCommandUpdated(command);
    }
  }

  // 2) Mark silent devices offline
  const staleDevices = await (
    await devicesCollection()
  )
    .find({
      status: "ONLINE",
      lastSeen: { $lt: new Date(now - DEVICE_OFFLINE_MS) },
    })
    .toArray();

  const offlineDevices: Device[] = [];
  for (const doc of staleDevices) {
    const updated = await (await devicesCollection()).findOneAndUpdate(
      { deviceId: doc.deviceId, status: "ONLINE" },
      { $set: { status: "OFFLINE", updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (updated) {
      const device = mapDevice(updated);
      offlineDevices.push(device);
      emitDeviceUpdated(device);
    }
  }

  if (timedOutCommands.length || offlineDevices.length) {
    console.log(
      `[Sweeper] ${timedOutCommands.length} command(s) → TIMEOUT, ${offlineDevices.length} device(s) → OFFLINE`
    );
  }

  return { timedOutCommands, offlineDevices };
}

// ============================================================
// SCHEDULE OPERATIONS
// ============================================================
export async function createSchedule(
  deviceId: string,
  time: string,
  command: DeviceState,
  enabled: boolean
): Promise<Schedule> {
  const now = new Date();
  const scheduleId = `schedule-${uuidv4().slice(0, 8)}`;

  const doc: ScheduleDoc = {
    scheduleId,
    deviceId,
    time,
    command,
    enabled,
    createdAt: now,
  };

  await (await schedulesCollection()).insertOne(doc);

  const created = mapSchedule(doc);
  dbEvents.emit("schedule_updated", created);
  return created;
}

export async function getSchedulesByDevice(
  deviceId: string
): Promise<Schedule[]> {
  const docs = await (
    await schedulesCollection()
  )
    .find({ deviceId })
    .sort({ time: 1 })
    .toArray();
  return docs.map(mapSchedule);
}

export async function deleteSchedule(scheduleId: string): Promise<boolean> {
  const res = await (
    await schedulesCollection()
  ).deleteOne({ scheduleId });
  return res.deletedCount > 0;
}
