"use client";

import type {
  Device,
  CommandStatus,
  DeviceState,
  DeviceOnlineStatus,
} from "@/types/device";
import { DeviceControls } from "./device-controls";
import { CommandStatusBadge } from "./command-status";
import { LightBulb } from "./light-bulb";

interface DeviceCardProps {
  device: Device;
  /** Đang trong quá trình check lần đầu → chip hiện "Checking..." thay vì đỏ */
  statusChecking?: boolean;
  commandStatus: CommandStatus | null;
  commandState: DeviceState | null;
  lastResponse: string;
  onCommand: (command: DeviceState) => void;
  sending: boolean;
}

export function DeviceCard({
  device,
  statusChecking,
  commandStatus,
  commandState,
  lastResponse,
  onCommand,
  sending,
}: DeviceCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {device.name}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Device ID: {device.deviceId}
          </p>
        </div>
        <StatusIndicator status={device.status} checking={statusChecking} />
      </div>

      {/* Light Bulb Indicator */}
      <div className="mb-5 flex justify-center">
        <LightBulb
          state={device.currentState}
          isPending={commandStatus === "PENDING"}
        />
      </div>

      {/* Device Info */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <InfoItem label="Current State" value={device.currentState} />
        <InfoItem
          label="Last Seen"
          value={
            device.lastSeen
              ? new Date(device.lastSeen).toLocaleTimeString()
              : "Never"
          }
        />
        <InfoItem
          label="Last Command"
          value={device.lastCommand || "None"}
        />
      </div>

      {/* Command Status */}
      {commandStatus && (
        <div className="mb-4">
          <CommandStatusBadge
            status={commandStatus}
            state={commandState}
            response={lastResponse}
          />
        </div>
      )}

      {/* Controls */}
      <DeviceControls
        onCommand={onCommand}
        disabled={sending}
      />
    </div>
  );
}

function StatusIndicator({
  status,
  checking = false,
}: {
  status: DeviceOnlineStatus;
  checking?: boolean;
}) {
  // Đang check lần đầu: chưa kết luận được → vàng nhấp nháy, đừng đỏ vội
  if (checking) {
    return (
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
          Checking...
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          status === "ONLINE" ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <span
        className={`text-sm font-medium ${
          status === "ONLINE"
            ? "text-green-700 dark:text-green-400"
            : "text-red-700 dark:text-red-400"
        }`}
      >
        {status === "ONLINE" ? "Online" : "Offline"}
      </span>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}
