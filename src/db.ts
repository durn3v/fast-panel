import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql, type JSONValue } from "postgres";
import { runner } from "node-pg-migrate";
import { env } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type UserRow = {
  id: string;
  name: string;
  uuid: string;
  inbound_tag: string;
  protocol: string;
  flow: string | null;
  enabled: boolean;
  expire_at: Date | null;
  data_limit: string | null;
  traffic_up: string;
  traffic_down: string;
  last_seen_at: Date | null;
  created_at: Date;
};

let sql: Sql | null = null;

export function getSql(): Sql {
  if (!sql) {
    if (!env.databaseUrl) throw new Error("DATABASE_URL is not set");
    sql = postgres(env.databaseUrl, { max: 10 });
  }
  return sql;
}

export async function runMigrations(): Promise<void> {
  if (!env.databaseUrl) throw new Error("DATABASE_URL is not set");
  const dir = path.join(__dirname, "..", "migrations");
  await runner({
    databaseUrl: env.databaseUrl,
    dir,
    direction: "up",
    count: Infinity,
    migrationsTable: "pgmigrations",
    log: () => {},
  });
}

export async function listUsers(inboundTag?: string): Promise<UserRow[]> {
  if (inboundTag) {
    return getSql()<UserRow[]>`
      SELECT id, name, uuid, inbound_tag, protocol, flow, enabled, expire_at, data_limit, traffic_up, traffic_down, last_seen_at, created_at
      FROM users WHERE inbound_tag = ${inboundTag} ORDER BY created_at DESC
    `;
  }
  return getSql()<UserRow[]>`
    SELECT id, name, uuid, inbound_tag, protocol, flow, enabled, expire_at, data_limit, traffic_up, traffic_down, last_seen_at, created_at
    FROM users ORDER BY created_at DESC
  `;
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const [r] = await getSql()<UserRow[]>`
    SELECT id, name, uuid, inbound_tag, protocol, flow, enabled, expire_at, data_limit, traffic_up, traffic_down, last_seen_at, created_at
    FROM users WHERE id = ${id}::uuid
  `;
  return r;
}

export async function getUserByUuid(uuid: string): Promise<UserRow | undefined> {
  const [r] = await getSql()<UserRow[]>`
    SELECT id, name, uuid, inbound_tag, protocol, flow, enabled, expire_at, data_limit, traffic_up, traffic_down, last_seen_at, created_at
    FROM users WHERE uuid = ${uuid}::uuid
  `;
  return r;
}

export async function insertUser(row: {
  id: string;
  name: string;
  uuid: string;
  inbound_tag: string;
  protocol: string;
  flow: string | null;
  enabled: boolean;
  expire_at: Date | null;
  data_limit: bigint | null;
}): Promise<void> {
  const s = getSql();
  await s`
    INSERT INTO users (id, name, uuid, inbound_tag, protocol, flow, enabled, expire_at, data_limit)
    VALUES (
      ${row.id}::uuid,
      ${row.name},
      ${row.uuid}::uuid,
      ${row.inbound_tag},
      ${row.protocol},
      ${row.flow},
      ${row.enabled},
      ${row.expire_at},
      ${row.data_limit as never}
    )
  `;
}

export async function deleteUser(id: string): Promise<void> {
  await getSql()`DELETE FROM users WHERE id = ${id}::uuid`;
}

export async function updateUser(
  id: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    flow: string | null;
    expire_at: Date | null;
    data_limit: bigint | null;
  }>
): Promise<UserRow | undefined> {
  const u = await getUser(id);
  if (!u) return undefined;
  const name = patch.name ?? u.name;
  const enabled = patch.enabled ?? u.enabled;
  const flow = patch.flow !== undefined ? patch.flow : u.flow;
  const expire_at =
    patch.expire_at === undefined ? u.expire_at : patch.expire_at;
  let dataLimitNext: bigint | null;
  if (patch.data_limit !== undefined) {
    dataLimitNext = patch.data_limit;
  } else if (u.data_limit === null) {
    dataLimitNext = null;
  } else {
    dataLimitNext = BigInt(u.data_limit);
  }
  const s = getSql();
  await s`
    UPDATE users SET
      name = ${name},
      enabled = ${enabled},
      flow = ${flow},
      expire_at = ${expire_at},
      data_limit = ${dataLimitNext as never}
    WHERE id = ${id}::uuid
  `;
  return getUser(id);
}

export async function resetTraffic(id: string): Promise<UserRow | undefined> {
  await getSql()`
    UPDATE users SET traffic_up = 0, traffic_down = 0 WHERE id = ${id}::uuid
  `;
  return getUser(id);
}

export async function addTraffic(
  id: string,
  deltaUp: bigint,
  deltaDown: bigint
): Promise<void> {
  const s = getSql();
  await s`
    UPDATE users SET
      traffic_up = traffic_up + ${deltaUp as never},
      traffic_down = traffic_down + ${deltaDown as never}
    WHERE id = ${id}::uuid
  `;
}

export async function setUserDisabled(id: string): Promise<void> {
  await getSql()`UPDATE users SET enabled = false WHERE id = ${id}::uuid`;
}

export async function touchUsersLastSeen(
  userIds: readonly string[],
  seenAt = new Date()
): Promise<void> {
  if (userIds.length === 0) return;
  await getSql()`
    UPDATE users
    SET last_seen_at = ${seenAt}
    WHERE id = ANY(${userIds}::uuid[])
  `;
}
