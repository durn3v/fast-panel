import type { FastifyInstance } from "fastify";
import * as db from "../db.js";
import type { XrayClients } from "../services/xrayClient.js";
import {
  grpcGetOnlineUserIds,
  grpcListInboundTags,
  grpcListInbounds,
} from "../services/xrayClient.js";

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
      console.error("xray ListInbounds failed:", e);
      return reply.status(502).send({ error: "xray ListInbounds failed" });
    }
  });

  app.get("/inbounds/online", async (_req, reply) => {
    if (!xray) {
      return reply
        .status(503)
        .send({ error: "Xray gRPC unavailable (check XRAY_PROTO_ROOT / API)" });
    }
    try {
      const [inbounds, panelUsers] = await Promise.all([
        grpcListInbounds(xray),
        db.listUsers(),
      ]);
      const onlineIds = await grpcGetOnlineUserIds(xray);
      const inboundByUserId = new Map(panelUsers.map((u) => [u.id, u.inbound_tag]));
      const countByTag = new Map<string, number>();
      for (const ib of inbounds) {
        countByTag.set(ib.tag, 0);
      }
      let unmappedOnlineUsers = 0;
      for (const id of onlineIds) {
        const tag = inboundByUserId.get(id);
        if (!tag) {
          unmappedOnlineUsers += 1;
          continue;
        }
        countByTag.set(tag, (countByTag.get(tag) ?? 0) + 1);
      }
      return {
        inbounds: inbounds.map((ib) => ({
          tag: ib.tag,
          protocol: ib.protocol,
          onlineUsers: countByTag.get(ib.tag) ?? 0,
        })),
        unmappedOnlineUsers,
      };
    } catch (e) {
      console.error("xray online inbounds failed:", e);
      return reply.status(502).send({ error: "xray online stats failed" });
    }
  });
}
