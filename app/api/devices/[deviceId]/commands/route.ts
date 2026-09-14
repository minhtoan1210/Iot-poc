import { NextRequest, NextResponse } from "next/server";
import {
  createCommand,
  ensureDevice,
  getCommandsByDevice,
} from "@/lib/db-service";
import { publishCommand } from "@/lib/mqtt";
import { initializeMQTTHandlers } from "@/lib/mqtt-handler";

// Ensure MQTT handlers are initialized
initializeMQTTHandlers();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;
  const body = await request.json();
  const { command } = body;

  // Validate command
  if (!command || !["ON", "OFF"].includes(command)) {
    return NextResponse.json(
      { error: "Invalid command. Must be 'ON' or 'OFF'." },
      { status: 400 }
    );
  }

  try {
    // Ensure the device exists in MongoDB (auto-register on first command)
    const device = await ensureDevice(deviceId);
    if (!device) {
      return NextResponse.json(
        { error: `Device ${deviceId} not found` },
        { status: 404 }
      );
    }

    // 1. Save the command to MongoDB with status PENDING
    const cmd = await createCommand(deviceId, command as "ON" | "OFF");

    // 2. Only after DB save succeeds, push the command down to the ESP32
    publishCommand(deviceId, cmd.commandId, cmd.command);

    // 3. Respond with the persisted command info
    return NextResponse.json(
      {
        command_id: cmd.commandId,
        device_id: deviceId,
        command: cmd.command,
        status: cmd.status,
        createdAt: cmd.createdAt,
        updatedAt: cmd.updatedAt,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[API] Failed to create command:", err);
    return NextResponse.json(
      { error: "Internal server error while creating command" },
      { status: 500 }
    );
  }
}

// Optional: list recent commands for this device (newest first)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  const { deviceId } = await params;

  try {
    const commands = await getCommandsByDevice(deviceId, 20);
    return NextResponse.json({ commands });
  } catch (err) {
    console.error("[API] Failed to list commands:", err);
    return NextResponse.json(
      { error: "Internal server error while listing commands" },
      { status: 500 }
    );
  }
}
