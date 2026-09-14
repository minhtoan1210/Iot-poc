import { NextRequest, NextResponse } from "next/server";
import {
  getSchedulesByDevice,
  createSchedule,
  deleteSchedule,
  ensureDevice,
} from "@/lib/db-service";
import { publishSchedule } from "@/lib/mqtt";
import { initializeMQTTHandlers } from "@/lib/mqtt-handler";

// Ensure MQTT handlers are initialized
initializeMQTTHandlers();

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;

  try {
    const schedules = await getSchedulesByDevice(deviceId);
    return NextResponse.json({ schedules });
  } catch (err) {
    console.error("[API] Failed to fetch schedules:", err);
    return NextResponse.json(
      { error: "Internal server error while fetching schedules" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const body = await request.json();
  const { time, command, enabled } = body;

  // Validate
  if (!time || !command || !["ON", "OFF"].includes(command)) {
    return NextResponse.json(
      { error: "Invalid schedule data. Need 'time' and 'command' (ON/OFF)." },
      { status: 400 }
    );
  }

  // Validate time format (HH:MM)
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json(
      { error: "Invalid time format. Must be HH:MM." },
      { status: 400 }
    );
  }

  try {
    // Ensure the device exists in MongoDB (auto-register on first schedule)
    await ensureDevice(deviceId);

    // Create schedule in MongoDB
    const schedule = await createSchedule(
      deviceId,
      time,
      command as "ON" | "OFF",
      enabled !== false
    );

    // Publish schedule to device via MQTT (enabled only)
    if (enabled !== false) {
      publishSchedule(deviceId, schedule.scheduleId, time, command as "ON" | "OFF");
    }

    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    console.error("[API] Failed to create schedule:", err);
    return NextResponse.json(
      { error: "Internal server error while creating schedule" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  await params;
  const { searchParams } = new URL(_request.url);
  const scheduleId = searchParams.get("scheduleId");

  if (!scheduleId) {
    return NextResponse.json(
      { error: "Query parameter 'scheduleId' is required." },
      { status: 400 }
    );
  }

  try {
    const ok = await deleteSchedule(scheduleId);
    if (!ok) {
      return NextResponse.json(
        { error: `Schedule ${scheduleId} not found` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API] Failed to delete schedule:", err);
    return NextResponse.json(
      { error: "Internal server error while deleting schedule" },
      { status: 500 }
    );
  }
}
