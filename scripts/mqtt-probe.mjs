/**
 * MQTT isolation probe — pretends to be esp32-001.
 *
 * 1. Publishes a heartbeat  → if device becomes ONLINE in DB, server pipeline OK
 * 2. Publishes a SUCCESS status for the newest PENDING command
 *    → if it flips to SUCCESS in DB, the whole server-side chain is proven;
 *      the fault is on the device/broker side (mock device not connected).
 *
 * Usage: node scripts/mqtt-probe.mjs
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import mqtt from "mqtt";

const BROKER = process.env.MQTT_BROKER_URL || "mqtt://broker.emqx.io:1883";
const DEVICE_ID = "esp32-001";

const res = await fetch("http://localhost:3000/api/devices/" + DEVICE_ID);
const data = await res.json();
const pending = data.commands?.find((c) => c.status === "PENDING");
console.log(`[Probe] Broker: ${BROKER}`);
console.log(
  `[Probe] Newest PENDING command: ${pending ? pending.commandId : "(none)"}`
);

const client = mqtt.connect(BROKER, {
  clientId: `probe-${Math.random().toString(16).slice(2, 8)}`,
  connectTimeout: 8000,
});

client.on("error", (e) => {
  console.error("[Probe] Connect failed:", e.message);
  process.exit(1);
});

client.on("connect", () => {
  console.log("[Probe] Connected to broker");

  // 1) Fake heartbeat
  client.publish(
    `devices/${DEVICE_ID}/heartbeat`,
    JSON.stringify({ device_id: DEVICE_ID, timestamp: new Date().toISOString() }),
    { qos: 0 },
    (err) => console.log(err ? `[Probe] heartbeat publish FAILED: ${err.message}` : "[Probe] heartbeat published ✓")
  );

  // 2) Fake SUCCESS status (only if a PENDING command exists)
  if (pending) {
    const status = {
      device_id: DEVICE_ID,
      command_id: pending.commandId,
      status: "SUCCESS",
      state: pending.command,
      timestamp: new Date().toISOString(),
      error: null,
    };
    client.publish(
      `devices/${DEVICE_ID}/status`,
      JSON.stringify(status),
      { qos: 1 },
      (err) => console.log(err ? `[Probe] status publish FAILED: ${err.message}` : `[Probe] status published ✓ (${pending.commandId} → SUCCESS/${pending.command})`)
    );
  }

  setTimeout(() => {
    client.end(true);
    console.log("[Probe] Done — check http://localhost:3000/api/devices/" + DEVICE_ID);
    process.exit(0);
  }, 1500);
});
