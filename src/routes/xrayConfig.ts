import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { env } from "../config.js";
import {
  pathExists,
  readXrayConfigJson,
  writeXrayConfigJson,
} from "../services/xrayConfigFile.js";
import { reloadXray } from "../services/xrayReload.js";

export async function registerXrayConfig(app: FastifyInstance) {
  const configPath = env.xrayConfigPath;

  app.get<{
    Querystring: { raw?: string };
  }>("/xray/config", async (_req, reply) => {
    if (!(await pathExists(configPath))) {
      return reply
        .status(404)
        .send({ error: "Xray config file not found", path: configPath });
    }
    try {
      if (_req.query.raw === "1" || _req.query.raw === "true") {
        const s = await readFile(configPath, "utf8");
        reply.type("application/json; charset=utf-8").send(s);
        return;
      }
      const data = await readXrayConfigJson(configPath);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({ error: "Failed to read Xray config", details: msg });
    }
  });

  app.put<{
    Body: unknown;
  }>("/xray/config", async (req, reply) => {
    const contentType = req.headers["content-type"] ?? "";
    if (!String(contentType).toLowerCase().includes("json")) {
      return reply
        .status(415)
        .send({ error: "Content-Type must be application/json" });
    }
    try {
      if (Buffer.isBuffer(req.body)) {
        return reply
          .status(400)
          .send({ error: "body must be a JSON object (use raw JSON, not a buffer string)" });
      }
      if (req.body === null || req.body === undefined) {
        return reply.status(400).send({ error: "empty body" });
      }
      await writeXrayConfigJson(configPath, req.body);
      return { ok: true, path: configPath };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("must be a JSON object") || msg.includes("not valid JSON")) {
        return reply.status(400).send({ error: msg });
      }
      return reply
        .status(500)
        .send({ error: "Failed to write Xray config", details: msg });
    }
  });

  app.post<{
    Querystring: { mode?: string };
    Body: { mode?: "xray" | "withPanel" };
  }>("/xray/reload", async (req, reply) => {
    const mode =
      req.query?.mode === "withPanel" || req.body?.mode === "withPanel"
        ? "withPanel"
        : "xray";
    try {
      const log = await reloadXray(mode, env);
      return { ok: true, mode, output: log.trim() || undefined };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("XRAY_RELOAD_TYPE=none") ||
        msg.includes("XRAY_RELOAD_TYPE is none")
      ) {
        return reply.status(503).send({ error: msg });
      }
      if (
        msg.includes("XRAY_RELOAD_SCRIPT is empty") ||
        msg.includes("XRAY_RELOAD_WITH_PANEL_COMMAND") ||
        msg.includes("required for compose")
      ) {
        return reply.status(503).send({ error: msg });
      }
      return reply
        .status(502)
        .send({ error: "Xray reload failed", details: msg });
    }
  });
}
