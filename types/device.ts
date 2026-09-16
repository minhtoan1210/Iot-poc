import type { ObjectId } from "mongodb";

// Device status
export type DeviceOnlineStatus = "ONLINE" | "OFFLINE";
export type DeviceState = "ON" | "OFF";

// Command
// ACKNOWLEDGED: device đã nhận lệnh (ACK) nhưng chưa báo kết quả thực thi
export type CommandStatus =
  | "PENDING"
  | "ACKNOWLEDGED"
  | "SUCCESS"
  | "FAILED"
  | "TIMEOUT";

export interface Device {
  deviceId: string;
  name: string;
  status: DeviceOnlineStatus;
  currentState: DeviceState;
  lastSeen: string | null;
  lastCommand: string | null;
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
  /** ACK = đã nhận lệnh (chưa chạy); SUCCESS/FAILED = kết quả thực thi */
  status: "ACK" | "SUCCESS" | "FAILED";
  /** Bắt buộc với SUCCESS/FAILED; ACK có thể bỏ trống */
  state?: DeviceState;
  timestamp: string;
  error?: string | null;
}

export interface MQTTHeartbeatPayload {
  device_id: string;
  timestamp: string;
}

export interface MQTTSchedulePayload {
  schedule_id: string;
  device_id: string;
  time: string;
  command: DeviceState;
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
