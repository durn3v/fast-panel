#!/usr/bin/env node
/**
 * Shallow-clone Xray-core into ./xray-core for gRPC/proto-loader (dev).
 * Docker build clones separately into /app/xray-core.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = join(__dirname, "..");
const dest = join(root, "xray-core");

if (existsSync(join(dest, "app", "proxyman", "command", "command.proto"))) {
  console.log("xray-core protos already present, skip.");
  process.exit(0);
}

if (existsSync(dest)) rmSync(dest, { recursive: true });
mkdirSync(root, { recursive: true });
execSync(
  "git clone --depth 1 https://github.com/XTLS/Xray-core.git xray-core",
  { cwd: root, stdio: "inherit" }
);
console.log("Cloned Xray-core into", dest);
