import dns from "node:dns";
import { MongoClient, type Db, type Collection } from "mongodb";
import type { DeviceDoc, CommandDoc, ScheduleDoc } from "@/types/device";

// ============================================================
// DNS WORKAROUND (Windows dev environment)
// When the Wi-Fi adapter only has an IPv6 DNS server configured, Node's
// c-ares resolver ends up with 127.0.0.1 as its only server, so every
// dns.resolve* call — including the SRV lookup that mongodb+srv:// needs —
// fails with ECONNREFUSED. Patch the resolver with public DNS servers.
// dns.lookup() (getaddrinfo) is unaffected, so this only touches resolve*.
// ============================================================
if (
  dns
    .getServers()
    .every((server) => server.startsWith("127.") || server === "::1" || server === "[::1]")
) {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

// ============================================================
// CONFIG
// ============================================================
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = "iot-dashboard";

if (!MONGODB_URI) {
  throw new Error(
    "MONGODB_URI is not defined. Add it to .env.local (e.g. mongodb+srv://...)"
  );
}

// ============================================================
// CLIENT SINGLETON (survives Next.js dev hot-reload)
// ============================================================
const globalForMongo = globalThis as typeof globalThis & {
  __mongoClient?: MongoClient;
};

const client: MongoClient =
  globalForMongo.__mongoClient ?? new MongoClient(MONGODB_URI);

// In dev, cache on globalThis so hot-reload doesn't spawn a new pool each time
if (process.env.NODE_ENV !== "production") {
  globalForMongo.__mongoClient = client;
}

// ============================================================
// DATABASE & TYPED COLLECTIONS
// ============================================================
export async function getDb(): Promise<Db> {
  await connectDB();
  return client.db(DB_NAME);
}

let connectPromise: Promise<Db> | null = null;

/** Connects once; every later call reuses the same pool. */
export async function connectDB(): Promise<Db> {
  connectPromise ||= client.connect().then(() => client.db(DB_NAME));
  try {
    return await connectPromise;
  } catch (err) {
    // Allow a retry on the next call if the first connect failed
    connectPromise = null;
    throw err;
  }
}

// ============================================================
// TYPED COLLECTIONS
// ============================================================
export async function devicesCollection(): Promise<Collection<DeviceDoc>> {
  return (await connectDB()).collection<DeviceDoc>("devices");
}
export async function commandsCollection(): Promise<Collection<CommandDoc>> {
  return (await connectDB()).collection<CommandDoc>("commands");
}
export async function schedulesCollection(): Promise<Collection<ScheduleDoc>> {
  return (await connectDB()).collection<ScheduleDoc>("schedules");
}

// ============================================================
// INDEXES (idempotent, run once per process)
// ============================================================
let indexesPromise: Promise<void> | null = null;

export function ensureIndexes(): Promise<void> {
  indexesPromise ||= (async () => {
    const db = await connectDB();
    await Promise.all([
      db.collection("devices").createIndex({ deviceId: 1 }, { unique: true }),
      db.collection("commands").createIndex({ commandId: 1 }, { unique: true }),
      db.collection("commands").createIndex({ deviceId: 1, createdAt: -1 }),
      // TTL: auto-delete commands older than 24h (PoC housekeeping)
      db
        .collection("commands")
        .createIndex(
          { createdAt: 1 },
          { expireAfterSeconds: 60 * 60 * 24 } // 24h
        ),
    ]);
  })();
  return indexesPromise;
}
