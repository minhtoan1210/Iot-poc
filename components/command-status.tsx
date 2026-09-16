"use client";

import type { CommandStatus, DeviceState } from "@/types/device";

interface CommandStatusBadgeProps {
  status: CommandStatus;
  state: DeviceState | null;
  response: string;
}

export function CommandStatusBadge({
  status,
  state,
  response,
}: CommandStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "PENDING":
        return {
          bg: "bg-amber-50 dark:bg-amber-950/30",
          border: "border-amber-200 dark:border-amber-800",
          text: "text-amber-800 dark:text-amber-300",
          icon: "⏳",
          label: "Đã gửi lệnh, chờ thiết bị xác nhận...",
        };
      // The device answered "I got it" but has not switched yet. Splitting this
      // out is the whole point of the ACK step: a silent device and a busy one
      // used to look identical from here.
      case "ACKNOWLEDGED":
        return {
          bg: "bg-sky-50 dark:bg-sky-950/30",
          border: "border-sky-200 dark:border-sky-800",
          text: "text-sky-800 dark:text-sky-300",
          icon: "📨",
          label: "Thiết bị đã nhận lệnh, đang thực hiện...",
        };
      case "SUCCESS":
        return {
          bg: "bg-green-50 dark:bg-green-950/30",
          border: "border-green-200 dark:border-green-800",
          text: "text-green-800 dark:text-green-300",
          icon: "✅",
          label:
            state === "ON"
              ? "Đã bật"
              : state === "OFF"
                ? "Đã tắt"
                : "Thành công",
        };
      case "FAILED":
        return {
          bg: "bg-red-50 dark:bg-red-950/30",
          border: "border-red-200 dark:border-red-800",
          text: "text-red-800 dark:text-red-300",
          icon: "❌",
          label: "Thực hiện thất bại",
        };
      case "TIMEOUT":
        return {
          bg: "bg-orange-50 dark:bg-orange-950/30",
          border: "border-orange-200 dark:border-orange-800",
          text: "text-orange-800 dark:text-orange-300",
          icon: "⚠️",
          label: "Timeout - Không nhận được phản hồi từ thiết bị",
        };
      default:
        return {
          bg: "bg-zinc-50 dark:bg-zinc-900",
          border: "border-zinc-200 dark:border-zinc-700",
          text: "text-zinc-700 dark:text-zinc-300",
          icon: "•",
          label: String(status),
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div
      className={`rounded-lg border p-3 ${config.bg} ${config.border}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{config.icon}</span>
        <span className={`text-sm font-medium ${config.text}`}>
          {config.label}
        </span>
      </div>
      {response && (
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          {response}
        </p>
      )}
    </div>
  );
}
