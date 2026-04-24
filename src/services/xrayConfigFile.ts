import { mkdir, readFile, rename, writeFile, unlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const INDENT = 2;

/**
 * Read parsed JSON; throws if not an object.
 */
export async function readXrayConfigJson(
  filePath: string
): Promise<Record<string, unknown>> {
  const text = await readFile(filePath, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("config is not valid JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("config must be a JSON object");
  }
  return data as Record<string, unknown>;
}

/**
 * Stringify and validate, then write atomically (write temp + rename).
 */
export async function writeXrayConfigJson(
  filePath: string,
  body: unknown
): Promise<void> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("body must be a JSON object");
  }
  const text = JSON.stringify(body, null, INDENT) + "\n";
  try {
    JSON.parse(text);
  } catch {
    throw new Error("serialized config is not valid JSON");
  }
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.xray-config.${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(temp, text, { mode: 0o600 });
  try {
    await rename(temp, filePath);
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
