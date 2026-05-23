import { readXrayConfigJson } from "./xrayConfigFile.js";

type InboundJson = {
  tag?: string;
  protocol?: string;
  streamSettings?: {
    security?: string;
  };
};

/** VLESS flow required/recommended for xtls and reality; empty for plain tls/none. */
export function defaultVlessFlowForInbound(inbound: InboundJson): string {
  if (inbound.protocol !== "vless") return "";
  const security = (inbound.streamSettings?.security ?? "none").toLowerCase();
  if (security === "xtls" || security === "reality") {
    return "xtls-rprx-vision";
  }
  return "";
}

function findInboundInConfig(
  config: Record<string, unknown>,
  inboundTag: string
): InboundJson | undefined {
  const inbounds = config.inbounds;
  if (!Array.isArray(inbounds)) return undefined;
  for (const raw of inbounds) {
    if (typeof raw !== "object" || raw === null) continue;
    const ib = raw as InboundJson;
    if (ib.tag === inboundTag) return ib;
  }
  return undefined;
}

export async function resolveDefaultVlessFlow(
  configPath: string,
  inboundTag: string
): Promise<string> {
  try {
    const config = await readXrayConfigJson(configPath);
    const inbound = findInboundInConfig(config, inboundTag);
    if (!inbound) return "";
    return defaultVlessFlowForInbound(inbound);
  } catch {
    return "";
  }
}
