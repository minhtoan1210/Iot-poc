import { NextRequest, NextResponse } from "next/server";
import {
  getSchedulesByDevice,
  createSchedule,
  deleteSchedule,
  ensureDevice,
} from "@/lib/db-service";
import { publishSchedule, publishScheduleDelete } from "@/lib/mqtt";
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

    // Push it to the device. A disabled schedule is sent too, with
    // enabled:false — the device needs to know it exists but must not fire it,
    // otherwise re-enabling later would be the only thing that ever reaches it.
    publishSchedule(
      deviceId,
      schedule.scheduleId,
      time,
      command as "ON" | "OFF",
      enabled !== false
    );

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
  const { deviceId } = await params;
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

    // The device keeps schedules in its own flash — deleting the row here is
    // not enough, it would go on switching the light at that time forever.
    publishScheduleDelete(deviceId, scheduleId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API] Failed to delete schedule:", err);
    return NextResponse.json(
      { error: "Internal server error while deleting schedule" },
      { status: 500 }
    );
  }
}
