import { NextResponse } from "next/server";
import { getDevice, getCommandsByDevice } from "@/lib/db-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;

  try {
    const device = await getDevice(deviceId);
    if (!device) {
      return NextResponse.json(
        { error: `Device ${deviceId} not found` },
        { status: 404 }
      );
    }

    const commands = await getCommandsByDevice(deviceId, 20);

    return NextResponse.json({
      device,
      commands,
    });
  } catch (err) {
    console.error("[API] Failed to fetch device status:", err);
    return NextResponse.json(
      { error: "Internal server error while fetching device status" },
      { status: 500 }
    );
  }
}
