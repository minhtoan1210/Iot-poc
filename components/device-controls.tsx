"use client";

import type { DeviceState } from "@/types/device";

interface DeviceControlsProps {
  onCommand: (command: DeviceState) => void;
  disabled: boolean;
}

export function DeviceControls({ onCommand, disabled }: DeviceControlsProps) {
  return (
    <div className="flex gap-3">
      <button
        onClick={() => onCommand("ON")}
        disabled={disabled}
        className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        BẬT
      </button>
      <button
        onClick={() => onCommand("OFF")}
        disabled={disabled}
        className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        TẮT
      </button>
    </div>
  );
}
