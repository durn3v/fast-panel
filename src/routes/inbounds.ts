import type { FastifyInstance } from "fastify";
import type { XrayClients } from "../services/xrayClient.js";
import { grpcListInboundTags } from "../services/xrayClient.js";

export async function registerInbounds(
  app: FastifyInstance,
  xray: XrayClients | null
) {
  app.get("/inbounds", async (_req, reply) => {
    if (!xray) {
      return reply
        .status(503)
        .send({ error: "Xray gRPC unavailable (check XRAY_PROTO_ROOT / API)" });
    }
    try {
      const tags = await grpcListInboundTags(xray);
      return tags.map((tag) => ({ tag }));
    } catch (e) {
      console.error(e);
      return reply.status(502).send({
        error: "xray ListInbounds failed",
        detail: String(e),
      });
    }
  });
}
