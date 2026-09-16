"use client";

import { useState } from "react";
import type { Schedule, DeviceState, DeviceSchedule } from "@/types/device";

interface ScheduleListProps {
  schedules: Schedule[];
  onAddSchedule: (time: string, command: DeviceState) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  /** Bảng lịch thiết bị báo là nó đang thực sự giữ trong NVS. */
  deviceSchedules?: DeviceSchedule[] | null;
  schedulesSyncedAt?: string | null;
}

export function ScheduleList({
  schedules,
  onAddSchedule,
  onDeleteSchedule,
  deviceSchedules,
  schedulesSyncedAt,
}: ScheduleListProps) {
  const [showForm, setShowForm] = useState(false);
  const [time, setTime] = useState("07:00");
  const [command, setCommand] = useState<DeviceState>("ON");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddSchedule(time, command);
    setShowForm(false);
    setTime("07:00");
    setCommand("ON");
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Device Schedule
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          + Thêm lịch
        </button>
      </div>

      {/* Add Schedule Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Thời gian
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                required
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Lệnh
              </label>
              <select
                value={command}
                onChange={(e) => setCommand(e.target.value as DeviceState)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              >
                <option value="ON">ON</option>
                <option value="OFF">OFF</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
              >
                Lưu
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-300"
              >
                Hủy
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Schedule List */}
      {schedules.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Chưa có lịch nào được thiết lập.
        </p>
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div
              key={schedule.scheduleId}
              className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-4">
                <span className="font-mono text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {schedule.time}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    schedule.command === "ON"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                  }`}
                >
                  {schedule.command}
                </span>
                <span
                  className={`text-xs ${
                    schedule.enabled
                      ? "text-green-600 dark:text-green-400"
                      : "text-zinc-400"
                  }`}
                >
                  {schedule.enabled ? "✓ Active" : "✗ Disabled"}
                </span>
              </div>
              <button
                onClick={() => onDeleteSchedule(schedule.scheduleId)}
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                title="Xóa lịch"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <DeviceScheduleSync
        serverSchedules={schedules}
        deviceSchedules={deviceSchedules}
        syncedAt={schedulesSyncedAt}
      />
    </div>
  );
}

/**
 * Lịch nằm ở hai nơi: MongoDB (bảng trên) và flash của thiết bị. Thiết bị tự
 * báo bảng nó đang giữ qua topic `devices/{id}/schedules`. Khối này đối chiếu
 * hai bên — không có nó thì không cách nào biết lệnh gửi xuống có tới nơi không.
 */
function DeviceScheduleSync({
  serverSchedules,
  deviceSchedules,
  syncedAt,
}: {
  serverSchedules: Schedule[];
  deviceSchedules?: DeviceSchedule[] | null;
  syncedAt?: string | null;
}) {
  if (!deviceSchedules) {
    return (
      <p className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Thiết bị chưa báo bảng lịch của nó. Cần firmware biết gửi topic{" "}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
          devices/&#123;id&#125;/schedules
        </code>
        .
      </p>
    );
  }

  const onDevice = new Set(deviceSchedules.map((s) => s.scheduleId));
  const onServer = new Set(serverSchedules.map((s) => s.scheduleId));

  // Lịch đang bật trên web mà thiết bị không có -> đến giờ sẽ không chạy.
  const missing = serverSchedules.filter(
    (s) => s.enabled && !onDevice.has(s.scheduleId)
  );
  // Lịch còn trong flash mà web đã xoá -> thiết bị vẫn sẽ bật/tắt đèn.
  const stale = deviceSchedules.filter((s) => !onServer.has(s.scheduleId));
  const inSync = missing.length === 0 && stale.length === 0;

  const when = syncedAt ? new Date(syncedAt).toLocaleTimeString() : "?";

  return (
    <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Thiết bị đang giữ trong bộ nhớ
      </p>

      {inSync ? (
        <p className="mt-1 text-sm text-green-700 dark:text-green-400">
          ✅ Khớp — {deviceSchedules.length} lịch, thiết bị báo lúc {when}
        </p>
      ) : (
        <div className="mt-1 space-y-1 text-sm">
          {missing.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              ⚠️ {missing.length} lịch chưa tới được thiết bị (
              {missing.map((s) => `${s.time} ${s.command}`).join(", ")}) — đến
              giờ sẽ không chạy
            </p>
          )}
          {stale.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400">
              ⚠️ {stale.length} lịch còn sót trong bộ nhớ thiết bị (
              {stale.map((s) => `${s.time} ${s.command}`).join(", ")}) — thiết bị
              vẫn sẽ bật/tắt theo lịch này
            </p>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Thiết bị báo lúc {when}. Lệch thường là do thiết bị offline lúc lịch
            được tạo/xoá — nối mạng lại thì server tự đẩy xuống.
          </p>
        </div>
      )}
    </div>
  );
}
