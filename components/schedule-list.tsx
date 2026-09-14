"use client";

import { useState } from "react";
import type { Schedule, DeviceState } from "@/types/device";

interface ScheduleListProps {
  schedules: Schedule[];
  onAddSchedule: (time: string, command: DeviceState) => void;
  onDeleteSchedule: (scheduleId: string) => void;
}

export function ScheduleList({
  schedules,
  onAddSchedule,
  onDeleteSchedule,
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
    </div>
  );
}
