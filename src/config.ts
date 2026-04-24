import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = join(__dirname, "..");

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function defaultXrayConfigPath(): string {
  const raw = process.env.XRAY_CONFIG_PATH;
  if (raw) {
    return isAbsolute(raw) ? raw : resolve(appRoot, raw);
  }
  return join(appRoot, "config", "xray", "config.json");
}

export const env = {
  appRoot,
  port: Number(process.env.PORT ?? 3000),
  apiKey: process.env.API_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  xrayApiHost: process.env.XRAY_API_HOST ?? "127.0.0.1",
  xrayApiPort: Number(process.env.XRAY_API_PORT ?? 10085),
  xrayProtoRoot: process.env.XRAY_PROTO_ROOT ?? "",
  xrayConfigPath: defaultXrayConfigPath(),
  /**
   * none: reload API disabled; compose: docker compose exec (same logic as scripts/vpn-panel);
   * script: sh -c XRAY_RELOAD_SCRIPT
   */
  xrayReloadType: process.env.XRAY_RELOAD_TYPE ?? "none",
  /** Project directory with docker-compose ymls (e.g. bind-mount of install dir) */
  xrayReloadComposeDir: process.env.XRAY_RELOAD_COMPOSE_DIR ?? "",
  /** e.g. docker-compose.yml:docker-compose.xray-ports.gen.yml */
  xrayReloadComposeFile:
    process.env.XRAY_RELOAD_COMPOSE_FILE ??
    process.env.COMPOSE_FILE ??
    "docker-compose.yml:docker-compose.xray-ports.gen.yml",
  /** must match the stack in `docker compose ls` on the host for compose mode */
  composeProjectName: process.env.COMPOSE_PROJECT_NAME ?? "",
  xrayReloadScript: process.env.XRAY_RELOAD_SCRIPT ?? "",
  /** for XRAY_RELOAD_TYPE=script and mode=withPanel, e.g. 'cd /opt/fast-panel && ./scripts/vpn-panel reload-xray' */
  xrayReloadWithPanelCommand: process.env.XRAY_RELOAD_WITH_PANEL_COMMAND ?? "",
  trafficSyncIntervalMs: Number(
    process.env.TRAFFIC_SYNC_INTERVAL_MS ?? 60_000
  ),
  activeUsersWindowMs: Number(
    process.env.ACTIVE_USERS_WINDOW_MS ??
      Number(process.env.TRAFFIC_SYNC_INTERVAL_MS ?? 60_000) * 2
  ),
  tlsCert: process.env.TLS_CERT ?? "",
  tlsKey: process.env.TLS_KEY ?? "",
};

export type AppEnv = typeof env;
