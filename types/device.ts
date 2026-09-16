import type { ObjectId } from "mongodb";

// Device status
export type DeviceOnlineStatus = "ONLINE" | "OFFLINE";
export type DeviceState = "ON" | "OFF";

// Command
export type CommandStatus =
  | "PENDING" // saved in Mongo, published to MQTT, device has not answered yet
  | "ACKNOWLEDGED" // device confirmed it received the command, still executing
  | "SUCCESS"
  | "FAILED"
  | "TIMEOUT";

/** A schedule as the DEVICE reports it back — what it really holds in NVS. */
export interface DeviceSchedule {
  scheduleId: string;
  time: string;
  command: DeviceState;
  enabled: boolean;
}

export interface Device {
  deviceId: string;
  name: string;
  status: DeviceOnlineStatus;
  currentState: DeviceState;
  lastSeen: string | null;
  lastCommand: string | null;
  /** Firmware version the device reports in its heartbeat. */
  firmware: string | null;
  /** Schedules the device says it is holding — compare against `schedules`. */
  deviceSchedules: DeviceSchedule[] | null;
  schedulesSyncedAt: string | null;
}

export interface Command {
  commandId: string;
  deviceId: string;
  command: DeviceState;
  status: CommandStatus;
  state: DeviceState | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  scheduleId: string;
  deviceId: string;
  time: string;
  command: DeviceState;
  enabled: boolean;
  createdAt: string;
}

// MongoDB documents (as stored in the "iot-dashboard" database)
export interface DeviceDoc {
  _id?: ObjectId;
  deviceId: string;
  name: string;
  status: DeviceOnlineStatus;
  currentState: DeviceState;
  lastSeen: Date | null;
  lastCommand: string | null;
  firmware?: string | null;
  deviceSchedules?: DeviceSchedule[] | null;
  schedulesSyncedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommandDoc {
  _id?: ObjectId;
  commandId: string;
  deviceId: string;
  command: DeviceState;
  status: CommandStatus;
  state: DeviceState | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleDoc {
  _id?: ObjectId;
  scheduleId: string;
  deviceId: string;
  time: string;
  command: DeviceState;
  enabled: boolean;
  createdAt: Date;
}

// MQTT payload types
export interface MQTTCommandPayload {
  command_id: string;
  device_id: string;
  command: DeviceState;
  timestamp: string;
}

export interface MQTTStatusPayload {
  device_id: string;
  command_id: string;
  /** "ACK" = received, not executed yet. SUCCESS/FAILED = executed. */
  status: "ACK" | "SUCCESS" | "FAILED";
  state: DeviceState;
  timestamp: string;
  error: string | null;
}

export interface MQTTHeartbeatPayload {
  device_id: string;
  timestamp: string;
  /** Actual output state read back from the pin — lets the server re-sync. */
  state?: DeviceState;
  fw?: string;
  uptime_s?: number;
}

export interface MQTTSchedulePayload {
  schedule_id: string;
  device_id: string;
  /** "set" (default) upserts; "delete" removes it from the device. */
  action?: "set" | "delete";
  time?: string;
  command?: DeviceState;
  enabled?: boolean;
  /** Which timezone the "HH:MM" above belongs to. The server decides. */
  tz_offset_min?: number;
}

/** devices/{id}/schedules — what the device actually holds in NVS. */
export interface MQTTSchedulesPayload {
  device_id: string;
  timestamp: string;
  tz_offset_min: number;
  schedules: {
    schedule_id: string;
    time: string;
    command: DeviceState;
    enabled: boolean;
  }[];
}

/** devices/{id}/lwt — retained. online:false is published by the broker. */
export interface MQTTPresencePayload {
  device_id: string;
  online: boolean;
  reason?: string;
}

// API types
export interface CommandRequest {
  command: DeviceState;
}

export interface ScheduleRequest {
  time: string;
  command: DeviceState;
  enabled: boolean;
}

// SSE event types
export interface SSEEvent {
  type: "device_update" | "command_update" | "schedule_update";
  data: Device | Command | Schedule;
}
