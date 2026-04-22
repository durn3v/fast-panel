import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import YAML from "yaml";
import { env, requireEnv } from "./config.js";
import * as db from "./db.js";
import { registerInbounds } from "./routes/inbounds.js";
import { registerStatus } from "./routes/status.js";
import { registerUsers } from "./routes/users.js";
import { createXrayClients, type XrayClients } from "./services/xrayClient.js";
import { restoreXrayFromDb } from "./restore.js";
import { startTrafficSync } from "./services/trafficSync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

async function main() {
  requireEnv("API_KEY");
  requireEnv("DATABASE_URL");

  await db.runMigrations();

  let xray: XrayClients | null = null;
  const protoRoot = env.xrayProtoRoot || join(rootDir, "xray-core");
  try {
    xray = await createXrayClients(
      protoRoot,
      env.xrayApiHost,
      env.xrayApiPort
    );
    await restoreXrayFromDb(xray);
    console.log("Xray users replayed from database (inbounds из config.json)");
  } catch (e) {
    console.warn(
      "Xray gRPC unavailable (check XRAY_PROTO_ROOT / xray-core clone):",
      e
    );
  }

  const tlsOptions =
    env.tlsCert && env.tlsKey
      ? {
          https: {
            cert: readFileSync(env.tlsCert),
            key: readFileSync(env.tlsKey),
          },
        }
      : {};

  const app = Fastify({
    ...tlsOptions,
    logger: {
      redact: ["req.headers['x-api-key']"],
    },
  });
  await app.register(cors, { origin: false });

  const openapiYaml = readFileSync(join(rootDir, "docs", "openapi.yaml"), "utf8");
  const openapiObj = YAML.parse(openapiYaml);

  app.get("/openapi.yaml", async (_req, reply) => {
    reply.type("application/yaml").send(openapiYaml);
  });
  app.get("/openapi.json", async (_req, reply) => {
    reply.send(openapiObj);
  });
  app.get("/health", async () => ({ ok: true }));

  const apiKey = env.apiKey;
  app.addHook("preHandler", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    if (
      path === "/health" ||
      path === "/openapi.yaml" ||
      path === "/openapi.json"
    ) {
      return;
    }
    const key = req.headers["x-api-key"];
    if (key !== apiKey) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  });

  await registerInbounds(app, xray);
  await registerStatus(app, xray);
  await registerUsers(app, xray);

  if (xray) {
    startTrafficSync(xray, env.trafficSyncIntervalMs);
  }

  await app.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`Listening on :${env.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
