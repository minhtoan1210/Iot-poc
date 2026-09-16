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
const COMMAND_TIMEOUT_MS = 10000;
// Ngưỡng coi thiết bị là "mới gör" — phải khớp DEVICE_OFFLINE_MS trong lib/db-service.ts
const DEVICE_OFFLINE_MS = 45_000;
// Thời gian ân hạn khi mới vào trang: lastSeen cũ/Never thì chờ thêm ~1 nhịp
// heartbeat (15s) + dự phòng xem thiết bị có báo tín hiệu không, trước khi
// kết luận Offline — tránh chớp đỏ "Offline" rồi xanh ngay sau đó.
const CHECK_GRACE_MS = 20_000;

export default function DashboardClient() {
  const [device, setDevice] = useState<Device | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [commandStatus, setCommandStatus] = useState<CommandStatus | null>(null);
  const [commandState, setCommandState] = useState<DeviceState | null>(null);
  const [lastResponse, setLastResponse] = useState("");
  const [serverOk, setServerOk] = useState(true);
  const [sending, setSending] = useState(false);
  // true từ lúc mở trang đến khi có tín hiệu xác thực trạng thái đầu tiên
  const [statusChecking, setStatusChecking] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkingDoneRef = useRef(false);

  // Kết thúc phiên "Checking..." ban đầu: đã có tín hiệu xác thực (heartbeat
  // qua SSE) hoặc hết thời gian ân hạn → hiển thị trạng thái thật.
  const finishChecking = useCallback(() => {
    checkingDoneRef.current = true;
    if (checkGraceRef.current) {
      clearTimeout(checkGraceRef.current);
      checkGraceRef.current = null;
    }
    setStatusChecking(false);
  }, []);

  // Fetch device + commands from MongoDB (initial load & polling fallback).
  // Only the device state is restored from DB — old command badges are NOT
  // replayed on page load, so users never see stale "Timeout" banners.
  const fetchDeviceStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices/${DEVICE_ID}`);
      if (res.ok) {
        const data = await res.json();
        setDevice(data.device);
        setServerOk(true);

        // lastSeen còn mới → tin trạng thái DB luôn. Ngược lại (OFFLINE cũ
        // hoặc Never) → vào thời gian ân hạn chờ heartbeat đầu tiên qua SSE,
        // thay vì kết luận đỏ ngay khi dữ liệu có thể đã lỗi thời.
        if (!checkingDoneRef.current) {
          const d = data.device;
          const fresh =
            !!d?.lastSeen &&
            Date.now() - new Date(d.lastSeen).getTime() < DEVICE_OFFLINE_MS;
          if (fresh) {
            finishChecking();
          } else if (checkGraceRef.current === null) {
            checkGraceRef.current = setTimeout(finishChecking, CHECK_GRACE_MS);
          }
        }
      }
    } catch {
      // Im lặng — server tạm chưa chạy thì hiện banner, đừng spam console
      setServerOk(false);
      finishChecking(); // server không hỏi được → thôi check, hiện banner cảnh báo
    }
  }, [finishChecking]);

  // Fetch schedules
  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices/${DEVICE_ID}/schedules`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules);
      }
    } catch {
      setServerOk(false);
    }
  }, []);

  // KHÔNG poll định kỳ nữa: realtime do SSE đảm nhiệm. Chỉ fetch 1 lần khi
  // load trang, khi người dùng bấm lệnh, và khi quay lại tab.
  const pollNow = useEffectEvent(() => {
    fetchDeviceStatus();
    fetchSchedules();
  });

  useEffect(() => {
    const initial = setTimeout(pollNow, 0);

    const onFocus = () => pollNow();
    window.addEventListener("focus", onFocus);

    return () => {
      clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
      if (checkGraceRef.current) {
        clearTimeout(checkGraceRef.current);
      }
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
            // Có tín hiệu sống từ thiết bị → kết thúc phiên check ban đầu
            finishChecking();
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

            // Trạng thái trung gian ACKNOWLEDGED: thiết bị đã nhận lệnh,
            // tiếp tục chờ SUCCESS/FAILED — chưa clear timeout.
            if (updatedCommand.data.status === "ACKNOWLEDGED") {
              setLastResponse(
                `Thiết bị xác nhận đã nhận lệnh lúc ${new Date(updatedCommand.data.updatedAt).toLocaleTimeString()}`
              );
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

    eventSource.onopen = () => setServerOk(true);
    eventSource.onerror = () => setServerOk(false);

    return () => {
      eventSource.close();
    };
  }, [finishChecking]);

  // Send command
  const handleCommand = async (command: DeviceState) => {
    // "Bấm thì mới check": làm mới trạng thái device ngay lúc bấm lệnh
    fetchDeviceStatus();
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
          {!serverOk ? (
            <>
              <p className="mb-4 text-sm text-orange-600 dark:text-orange-400">
                ⚠️ Không kết nối được server — backend/broker chưa chạy?
              </p>
              <button
                onClick={() => {
                  fetchDeviceStatus();
                  fetchSchedules();
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Thử lại
              </button>
            </>
          ) : (
            <>
              <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="text-sm text-zinc-500">Loading device...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      {!serverOk && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
          ⚠️ Mất kết nối server — dữ liệu có thể cũ. Bấm lệnh hoặc chuyển tab để thử lại.
        </div>
      )}
      <DeviceCard
        device={device}
        statusChecking={statusChecking}
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
      />
    </div>
  );
}
