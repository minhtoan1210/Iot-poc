/**
 * Cleanup tool for the iot-dashboard database.
 *
 * Usage:
 *   node scripts/cleanup-test-data.mjs
 *     → default: removes the 2026-09-14 smoke-test artifacts
 *       (device esp32-001 + command cmd-696b2aac)
 *
 *   node scripts/cleanup-test-data.mjs --device <id> [--device <id> ...]
 *   node scripts/cleanup-test-data.mjs --command <id> [--command <id> ...]
 *     → removes the specific documents listed on the command line
 *
 * Always prints every document found before deleting, then verifies after.
 */

import dotenv from "dotenv";
// Ưu tiên .env.local, .env làm fallback (dotenv không ghi đè biến có sẵn)
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import { MongoClient } from "mongodb";

// Parse CLI args: --device X --command Y (repeatable)
const args = process.argv.slice(2);
const deviceTargets = [];
const commandTargets = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--device" && args[i + 1]) {
    deviceTargets.push(args[i + 1]);
    i++;
  } else if (args[i] === "--command" && args[i + 1]) {
    commandTargets.push(args[i + 1]);
    i++;
  }
}

// Defaults: smoke-test artifacts from 2026-09-14
if (deviceTargets.length === 0 && commandTargets.length === 0) {
  deviceTargets.push("esp32-001");
  commandTargets.push("cmd-696b2aac");
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("[Cleanup] ❌ MONGODB_URI is not set (.env.local)");
    process.exit(1);
  }

  console.log(
    `[Cleanup] Targets → devices: [${deviceTargets.join(", ")}] commands: [${commandTargets.join(", ")}]`
  );

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    const db = client.db("iot-dashboard");

    // ---- Before: show everything so we only delete what we saw ----
    const devicesBefore = await db.collection("devices").find({}).toArray();
    const commandsBefore = await db.collection("commands").find({}).toArray();
    const schedulesBefore = await db.collection("schedules").find({}).toArray();

    console.log(
      `[Cleanup] Before → devices: ${devicesBefore.length}, commands: ${commandsBefore.length}, schedules: ${schedulesBefore.length}`
    );
    for (const d of devicesBefore) {
      console.log(`  device: ${d.deviceId} (name=${d.name}, status=${d.status})`);
    }
    for (const c of commandsBefore) {
      console.log(`  command: ${c.commandId} (${c.command}, status=${c.status})`);
    }
    for (const s of schedulesBefore) {
      console.log(`  schedule: ${s.scheduleId} (${s.time} → ${s.command})`);
    }

    // ---- Delete only the targeted documents ----
    let deletedDevices = 0;
    for (const id of deviceTargets) {
      const r = await db.collection("devices").deleteOne({ deviceId: id });
      console.log(`[Cleanup] device ${id} → deleted ${r.deletedCount}`);
      deletedDevices += r.deletedCount;
    }

    let deletedCommands = 0;
    for (const id of commandTargets) {
      const r = await db.collection("commands").deleteOne({ commandId: id });
      console.log(`[Cleanup] command ${id} → deleted ${r.deletedCount}`);
      deletedCommands += r.deletedCount;
    }

    console.log(
      `[Cleanup] Deleted → devices: ${deletedDevices}, commands: ${deletedCommands}`
    );

    // ---- After: verify ----
    const devicesAfter = await db.collection("devices").find({}).toArray();
    const commandsAfter = await db.collection("commands").countDocuments();
    const schedulesAfter = await db.collection("schedules").countDocuments();

    console.log(
      `[Cleanup] After  → devices: ${devicesAfter.length}, commands: ${commandsAfter}, schedules: ${schedulesAfter}`
    );
    for (const d of devicesAfter) {
      console.log(`  device remaining: ${d.deviceId}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("[Cleanup] ❌ Failed:", err);
  process.exit(1);
});
