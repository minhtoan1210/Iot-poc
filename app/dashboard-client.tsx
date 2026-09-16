"use client";

import { useState, useEffect, useCallback, useEffectEvent, useRef } from "react";
import type {
  Device,
  Command,
  Schedule,
  DeviceState,
  CommandStatus,
  SSEEvent,
} from "@/types/device";
import { DeviceCard } from "@/components/device-card";
import { ScheduleList } from "@/components/schedule-list";

const DEVICE_ID = "esp32-001";
// Không nghe thấy gì từ thiết bị -> TIMEOUT. Phải khớp với sweeper của backend.
const COMMAND_TIMEOUT_MS = 10000;
// Thiết bị đã ACK: nó có nghe, chỉ là chưa xong -> cho thêm thời gian.
const COMMAND_EXEC_TIMEOUT_MS = 30000;

export default function DashboardClient() {
  const [device, setDevice] = useState<Device | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [commandStatus, setCommandStatus] = useState<CommandStatus | null>(null);
  const [commandState, setCommandState] = useState<DeviceState | null>(null);
  const [lastResponse, setLastResponse] = useState("");
  const [sending, setSending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch device + commands from MongoDB (initial load & polling fallback).
  // Only the device state is restored from DB — old command badges are NOT
  // replayed on page load, so users never see stale "Timeout" banners.
  const fetchDeviceStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices/${DEVICE_ID}`);
      if (res.ok) {
        const data = await res.json();
        setDevice(data.device);
      }
    } catch (err) {
      console.error("Failed to fetch device status:", err);
    }
  }, []);

  // Fetch schedules
  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices/${DEVICE_ID}/schedules`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules);
      }
    } catch (err) {
      console.error("Failed to fetch schedules:", err);
    }
  }, []);

  // Polling fallback - fetch status mỗi 3 giây để đảm bảo UI luôn đồng bộ
  const pollNow = useEffectEvent(() => {
    fetchDeviceStatus();
    fetchSchedules();
  });

  useEffect(() => {
    // Defer initial fetch to a timer so we don't setState synchronously in the effect
    const initial = setTimeout(pollNow, 0);
    const pollInterval = setInterval(pollNow, 3000);

    return () => {
      clearTimeout(initial);
      clearInterval(pollInterval);
    };
  }, []);

  // Connect to SSE
  useEffect(() => {
    const eventSource = new EventSource("/api/sse");

    eventSource.onmessage = (event) => {
      try {
        const data: SSEEvent | { type: string } = JSON.parse(event.data);

        if (data.type === "device_update") {
          const updatedDevice = data as { type: string; data: Device };
          if (updatedDevice.data.deviceId === DEVICE_ID) {
            setDevice(updatedDevice.data);
          }
        } else if (data.type === "command_update") {
          const updatedCommand = data as { type: string; data: Command };
          if (updatedCommand.data.deviceId === DEVICE_ID) {
            setCommandStatus(updatedCommand.data.status);
            setCommandState(updatedCommand.data.state);
            setLastResponse(
              updatedCommand.data.error
                ? `Error: ${updatedCommand.data.error}`
                : `Last update: ${new Date(updatedCommand.data.updatedAt).toLocaleTimeString()}`
            );

            // Thiết bị đã xác nhận nhận được lệnh: gia hạn đồng hồ đếm ngược
            // cho khớp với backend, đừng báo TIMEOUT trong khi nó đang chạy.
            if (updatedCommand.data.status === "ACKNOWLEDGED") {
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
              timeoutRef.current = setTimeout(() => {
                setCommandStatus("TIMEOUT");
                setSending(false);
                setLastResponse(
                  `Đã nhận lệnh nhưng không báo kết quả - timeout lúc ${new Date().toLocaleTimeString()}`
                );
              }, COMMAND_EXEC_TIMEOUT_MS);
            }

            // Clear sending state and timeout when we get a definitive result
            if (
              updatedCommand.data.status === "SUCCESS" ||
              updatedCommand.data.status === "FAILED" ||
              updatedCommand.data.status === "TIMEOUT"
            ) {
              setSending(false);
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
      }
    };

    eventSource.onerror = () => {
      console.log("SSE connection error, will reconnect...");
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Send command
  const handleCommand = async (command: DeviceState) => {
    setSending(true);
    setCommandStatus("PENDING");
    setCommandState(null);
    setLastResponse("");

    // Set timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setCommandStatus("TIMEOUT");
      setSending(false);
      setLastResponse(
        `Timeout at ${new Date().toLocaleTimeString()}`
      );
    }, COMMAND_TIMEOUT_MS);

    try {
      const res = await fetch(`/api/devices/${DEVICE_ID}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });

      if (!res.ok) {
        const errData = await res.json();
        setCommandStatus("FAILED");
        setLastResponse(errData.error || "Failed to send command");
        setSending(false);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }
      // If successful, the command is PENDING and we wait for MQTT response via SSE
    } catch {
      setCommandStatus("FAILED");
      setLastResponse("Network error - could not reach server");
      setSending(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  };

  // Add schedule
  const handleAddSchedule = async (time: string, command: DeviceState) => {
    try {
      const res = await fetch(`/api/devices/${DEVICE_ID}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time, command, enabled: true }),
      });

      if (res.ok) {
        await fetchSchedules();
      }
    } catch (err) {
      console.error("Failed to add schedule:", err);
    }
  };

  // Delete schedule (real DELETE endpoint, backed by MongoDB)
  const handleDeleteSchedule = async (scheduleId: string) => {
    setSchedules((prev) => prev.filter((s) => s.scheduleId !== scheduleId));
    try {
      const res = await fetch(
        `/api/devices/${DEVICE_ID}/schedules?scheduleId=${encodeURIComponent(scheduleId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        console.error("Failed to delete schedule on server");
        await fetchSchedules(); // restore list on failure
      }
    } catch (err) {
      console.error("Failed to delete schedule:", err);
      await fetchSchedules();
    }
  };

  if (!device) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="text-sm text-zinc-500">Loading device...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <DeviceCard
        device={device}
        commandStatus={commandStatus}
        commandState={commandState}
        lastResponse={lastResponse}
        onCommand={handleCommand}
        sending={sending}
      />

      <ScheduleList
        schedules={schedules}
        onAddSchedule={handleAddSchedule}
        onDeleteSchedule={handleDeleteSchedule}
        deviceSchedules={device.deviceSchedules}
        schedulesSyncedAt={device.schedulesSyncedAt}
      />
    </div>
  );
}
