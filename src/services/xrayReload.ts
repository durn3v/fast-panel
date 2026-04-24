import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { AppEnv } from "../config.js";

const execFileAsync = promisify(execFile);

/**
 * Соответствует логике `xray_process_restart` в `scripts/vpn-panel`:
 * TERM дочернему xray (супервизор поднимет новый), иначе TERM PID1.
 */
const XRAY_IN_CONTAINER_RESTART = [
  "if [ -f /var/run/xray-child.pid ]; then",
  "pid=$(cat /var/run/xray-child.pid 2>/dev/null) || true;",
  'if [ -n "$pid" ] && [ -d "/proc/$pid" ] && kill -TERM "$pid" 2>/dev/null; then exit 0; fi;',
  "fi;",
  "kill -TERM 1",
].join(" ");

function composeFileArgs(compose: AppEnv): { base: string[] } {
  const dir = compose.xrayReloadComposeDir.trim();
  const project = compose.composeProjectName.trim();
  const fileSpec = compose.xrayReloadComposeFile.trim() || "docker-compose.yml";
  if (!dir || !project) {
    throw new Error("XRAY_RELOAD_COMPOSE_DIR and COMPOSE_PROJECT_NAME are required for compose mode");
  }
  const files = fileSpec
    .split(/[:;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const base: string[] = [
    "compose",
    "--project-directory",
    dir,
    "-p",
    project,
  ];
  for (const f of files) {
    base.push("-f", join(dir, f));
  }
  return { base };
}

export type XrayReloadMode = "xray" | "withPanel";

/**
 * @param compose — snapshot of env (pass from caller so it stays consistent with the request)
 */
export async function reloadXray(
  mode: XrayReloadMode,
  compose: AppEnv
): Promise<string> {
  if (compose.xrayReloadType === "none") {
    throw new Error("XRAY_RELOAD_TYPE=none: reload is disabled. Set type to compose or script.");
  }
  if (compose.xrayReloadType === "script") {
    if (mode === "withPanel") {
      const full = compose.xrayReloadWithPanelCommand.trim();
      if (!full) {
        throw new Error(
          "XRAY_RELOAD_WITH_PANEL_COMMAND is not set. Use it for mode=withPanel, e.g. the same as `vpn-panel reload-xray`."
        );
      }
    const { stdout, stderr } = await execFileAsync("sh", ["-c", full], {
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
      return [stdout, stderr].filter(Boolean).join("");
    }
    const s = compose.xrayReloadScript.trim();
    if (!s) {
      throw new Error("XRAY_RELOAD_SCRIPT is empty");
    }
    const { stdout, stderr } = await execFileAsync("sh", ["-c", s], {
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    return [stdout, stderr].filter(Boolean).join("");
  }
  if (compose.xrayReloadType !== "compose") {
    throw new Error(`Unknown XRAY_RELOAD_TYPE: ${compose.xrayReloadType}`);
  }
  const docker = process.env.DOCKER_BIN || "docker";
  const { base } = composeFileArgs(compose);
  const ex = [...base, "exec", "-T", "xray", "sh", "-c", XRAY_IN_CONTAINER_RESTART];
  let out = "";
  try {
    const r = await execFileAsync(docker, ex, {
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    out = [r.stdout, r.stderr].filter(Boolean).join("");
  } catch {
    const fb = [...base, "restart", "xray"];
    const r2 = await execFileAsync(docker, fb, {
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    out = [r2.stdout, r2.stderr].filter(Boolean).join(" (fallback: docker compose restart xray) ");
  }
  if (mode === "withPanel") {
    const r3 = await execFileAsync(docker, [...base, "restart", "panel"], {
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    out += [r3.stdout, r3.stderr].filter(Boolean).join("");
  }
  return out;
}
