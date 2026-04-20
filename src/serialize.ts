import type { UserRow } from "./db.js";

export function userToApi(u: UserRow) {
  const up = BigInt(u.traffic_up);
  const down = BigInt(u.traffic_down);
  return {
    uuid: u.uuid,
    name: u.name,
    inboundTag: u.inbound_tag,
    protocol: u.protocol,
    flow: u.protocol === "vless" ? (u.flow ?? "") : null,
    enabled: u.enabled,
    expireAt: u.expire_at ? u.expire_at.toISOString() : null,
    dataLimit: u.data_limit === null ? null : u.data_limit.toString(),
    trafficUp: u.traffic_up,
    trafficDown: u.traffic_down,
    trafficTotal: (up + down).toString(),
    createdAt: u.created_at.toISOString(),
  };
}
