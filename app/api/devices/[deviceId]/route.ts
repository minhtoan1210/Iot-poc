import { NextResponse } from "next/server";
import { getDevice, getCommandsByDevice } from "@/lib/db-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/devices/:deviceId
 * Initial payload for the dashboard: device state + most recent commands
 * straight from MongoDB (no more mock data).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;

  try {
    const device = await getDevice(deviceId);

    // Device may not have sent a heartbeat yet — return a placeholder
    // instead of 404 so the UI can render immediately.
    const deviceData = device ?? {
      deviceId,
      name: deviceId,
      status: "OFFLINE" as const,
      currentState: "OFF" as const,
      lastSeen: null,
      lastCommand: null,
    };

    // Latest commands, newest first (index: deviceId + createdAt desc)
    const commands = await getCommandsByDevice(deviceId, 20);
    const lastCommand = commands[0] ?? null;

    return NextResponse.json({
      device: deviceData,
      lastCommand,
      commands,
    });
  } catch (err) {
    console.error("[API] Failed to fetch device data:", err);
    return NextResponse.json(
      { error: "Internal server error while fetching device data" },
      { status: 500 }
    );
  }
}
