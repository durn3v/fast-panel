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
        await grpcRemoveUser(clients, u.inbound_tag, u.id);
        await db.setUserDisabled(u.id);
      } catch (e) {
        console.error("trafficSync: expire user", u.id, e);
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

  const users = await db.listUsers();
  for (const u of users) {
    if (!u.enabled || u.data_limit === null) continue;
    const limit = BigInt(u.data_limit);
    const up = BigInt(u.traffic_up);
    const down = BigInt(u.traffic_down);
    const total = up + down;
    if (total < limit) continue;
    try {
      await grpcRemoveUser(clients, u.inbound_tag, u.id);
      await db.setUserDisabled(u.id);
    } catch (e) {
      console.error("trafficSync: limit remove user", u.id, e);
    }
  }
}
