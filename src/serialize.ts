import type { UserRow } from "./db.js";

export function userToApi(u: UserRow) {
  const up = BigInt(u.traffic_up);
  const down = BigInt(u.traffic_down);
  return {
    id: u.id,
    name: u.name,
    uuid: u.uuid,
    inboundTag: u.inbound_tag,
    enabled: u.enabled,
    expireAt: u.expire_at ? u.expire_at.toISOString() : null,
    dataLimit: u.data_limit === null ? null : u.data_limit.toString(),
    trafficUp: u.traffic_up,
    trafficDown: u.traffic_down,
    trafficTotal: (up + down).toString(),
    createdAt: u.created_at.toISOString(),
  };
}
