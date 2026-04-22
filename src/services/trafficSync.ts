import type { XrayClients } from "./xrayClient.js";
import { grpcQueryStats, grpcRemoveUser } from "./xrayClient.js";
import * as db from "../db.js";

const USER_STAT =
  /^user>>>(?<email>[^>]+)>>>traffic>>>(?<dir>uplink|downlink)$/;

export function startTrafficSync(
  clients: XrayClients,
  intervalMs: number
): NodeJS.Timeout {
  return setInterval(() => {
    void syncOnce(clients);
  }, intervalMs);
}

async function syncOnce(clients: XrayClients): Promise<void> {
  const now = new Date();
  const allUsers = await db.listUsers();

  for (const u of allUsers) {
    if (!u.enabled || !u.expire_at) continue;
    if (u.expire_at <= now) {
      try {
        // DB first: source of truth. Even if Xray removal fails, the user
        // won't be re-added on restart (enabled=false).
        await db.setUserDisabled(u.id);
        try {
          await grpcRemoveUser(clients, u.inbound_tag, u.id);
        } catch (e) {
          console.error("trafficSync: grpcRemoveUser (expire) failed — user disabled in DB, will be cleaned on restart:", u.id, e);
        }
      } catch (e) {
        console.error("trafficSync: setUserDisabled (expire) failed:", u.id, e);
      }
    }
  }

  let stats: { name: string; value: string }[];
  try {
    stats = await grpcQueryStats(clients, "user>>>", true);
  } catch (e) {
    console.error("trafficSync: queryStats failed", e);
    return;
  }

  const deltas = new Map<string, { up: bigint; down: bigint }>();
  for (const s of stats) {
    const m = USER_STAT.exec(s.name);
    if (!m?.groups?.email || !m.groups.dir) continue;
    const email = m.groups.email;
    const v = BigInt(s.value || 0);
    let row = deltas.get(email);
    if (!row) {
      row = { up: 0n, down: 0n };
      deltas.set(email, row);
    }
    if (m.groups.dir === "uplink") row.up += v;
    else row.down += v;
  }

  for (const [userId, d] of deltas) {
    if (d.up === 0n && d.down === 0n) continue;
    try {
      await db.addTraffic(userId, d.up, d.down);
    } catch (e) {
      console.error("trafficSync: addTraffic", userId, e);
    }
  }

  const activeUserIds = [...deltas.entries()]
    .filter(([, d]) => d.up !== 0n || d.down !== 0n)
    .map(([userId]) => userId);
  if (activeUserIds.length > 0) {
    try {
      await db.touchUsersLastSeen(activeUserIds, now);
    } catch (e) {
      console.error("trafficSync: touchUsersLastSeen failed", e);
    }
  }

  // Re-fetch to get updated traffic totals after addTraffic calls above.
  const users = await db.listUsers();
  for (const u of users) {
    if (!u.enabled || u.data_limit === null) continue;
    const limit = BigInt(u.data_limit);
    const total = BigInt(u.traffic_up) + BigInt(u.traffic_down);
    if (total < limit) continue;
    try {
      // DB first: see expiry comment above.
      await db.setUserDisabled(u.id);
      try {
        await grpcRemoveUser(clients, u.inbound_tag, u.id);
      } catch (e) {
        console.error("trafficSync: grpcRemoveUser (limit) failed — user disabled in DB, will be cleaned on restart:", u.id, e);
      }
    } catch (e) {
      console.error("trafficSync: setUserDisabled (limit) failed:", u.id, e);
    }
  }
}
