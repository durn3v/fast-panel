export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  apiKey: process.env.API_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  xrayApiHost: process.env.XRAY_API_HOST ?? "127.0.0.1",
  xrayApiPort: Number(process.env.XRAY_API_PORT ?? 10085),
  xrayProtoRoot: process.env.XRAY_PROTO_ROOT ?? "",
  trafficSyncIntervalMs: Number(
    process.env.TRAFFIC_SYNC_INTERVAL_MS ?? 60_000
  ),
};
