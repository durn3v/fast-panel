import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import * as db from "../db.js";
import { userToApi } from "../serialize.js";
import type { XrayClients } from "../services/xrayClient.js";
import {
  grpcAddUser,
  grpcListInbounds,
  grpcRemoveUser,
} from "../services/xrayClient.js";

function parseBigIntField(
  value: number | string,
  fieldName: string
): { ok: true; value: bigint } | { ok: false; error: string } {
  try {
    const n = BigInt(value);
    if (n < 0n) return { ok: false, error: `${fieldName} must be non-negative` };
    return { ok: true, value: n };
  } catch {
    return { ok: false, error: `${fieldName} must be a valid integer` };
  }
}

export async function registerUsers(
  app: FastifyInstance,
  xray: XrayClients | null
) {
  app.get<{
    Querystring: { inboundTag?: string };
  }>("/users", async (req) => {
    const rows = await db.listUsers(req.query.inboundTag);
    return rows.map(userToApi);
  });

  app.post<{
    Body: {
      name: string;
      inboundTag: string;
      enabled?: boolean;
      protocol?: string;
      flow?: string | null;
      expireAt?: string | null;
      dataLimit?: number | string | null;
    };
  }>("/users", async (req, reply) => {
    const { name, inboundTag } = req.body;
    if (!name || !inboundTag) {
      return reply.status(400).send({ error: "name and inboundTag required" });
    }

    let protocol = req.body.protocol ?? "vless";

    if (xray) {
      let inbounds: { tag: string; protocol: string }[];
      try {
        inbounds = await grpcListInbounds(xray);
      } catch (e) {
        console.error("xray ListInbounds failed:", e);
        return reply.status(502).send({ error: "xray ListInbounds failed" });
      }
      const found = inbounds.find((ib) => ib.tag === inboundTag);
      if (!found) {
        return reply.status(400).send({
          error: "inboundTag not found in running Xray",
          knownTags: inbounds.map((ib) => ib.tag),
        });
      }
      protocol = found.protocol;
    }

    const id = randomUUID();
    const userUuid = randomUUID();
    const expireAt =
      req.body.expireAt === undefined || req.body.expireAt === null
        ? null
        : new Date(req.body.expireAt);
    if (expireAt && Number.isNaN(expireAt.getTime())) {
      return reply.status(400).send({ error: "invalid expireAt" });
    }
    if (expireAt && expireAt.getTime() <= Date.now()) {
      return reply.status(400).send({ error: "expireAt must be in the future" });
    }
    let dataLimit: bigint | null = null;
    if (req.body.dataLimit !== undefined && req.body.dataLimit !== null) {
      const parsed = parseBigIntField(req.body.dataLimit, "dataLimit");
      if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
      dataLimit = parsed.value;
    }

    // flow only applies to vless; default to xtls-rprx-vision when not specified
    const flow =
      protocol === "vless"
        ? (req.body.flow !== undefined ? req.body.flow : "xtls-rprx-vision")
        : null;

    const enabled = req.body.enabled !== false;

    if (xray && enabled) {
      try {
        await grpcAddUser(xray, inboundTag, id, userUuid, protocol, flow);
      } catch (e) {
        console.error("xray AddUser failed:", e);
        return reply.status(502).send({ error: "xray AddUser failed" });
      }
    }

    try {
      await db.insertUser({
        id,
        name,
        uuid: userUuid,
        inbound_tag: inboundTag,
        protocol,
        flow,
        enabled,
        expire_at: expireAt,
        data_limit: dataLimit,
      });
    } catch (e) {
      if (xray && enabled) {
        try {
          await grpcRemoveUser(xray, inboundTag, id);
        } catch (re) {
          console.error("rollback grpcRemoveUser failed:", re);
        }
      }
      throw e;
    }

    const created = await db.getUser(id);
    return userToApi(created!);
  });

  app.get<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
    const u = await db.getUser(req.params.id);
    if (!u) return reply.status(404).send({ error: "not found" });
    return userToApi(u);
  });

  app.patch<{
    Params: { id: string };
    Body: Partial<{
      name: string;
      enabled: boolean;
      flow: string | null;
      expireAt: string | null;
      dataLimit: number | string | null;
    }>;
  }>("/users/:id", async (req, reply) => {
    const u = await db.getUser(req.params.id);
    if (!u) return reply.status(404).send({ error: "not found" });
    const patch: Parameters<typeof db.updateUser>[1] = {};
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.enabled !== undefined) patch.enabled = req.body.enabled;
    if (req.body.flow !== undefined && u.protocol === "vless") {
      patch.flow = req.body.flow;
    }
    if (req.body.expireAt !== undefined) {
      patch.expire_at =
        req.body.expireAt === null ? null : new Date(req.body.expireAt);
      if (patch.expire_at && Number.isNaN(patch.expire_at.getTime())) {
        return reply.status(400).send({ error: "invalid expireAt" });
      }
    }
    if (req.body.dataLimit !== undefined) {
      if (req.body.dataLimit === null) {
        patch.data_limit = null;
      } else {
        const parsed = parseBigIntField(req.body.dataLimit, "dataLimit");
        if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
        patch.data_limit = parsed.value;
      }
    }

    const enablingUser =
      xray &&
      req.body.enabled === true &&
      u.enabled === false;
    const disablingUser =
      xray &&
      req.body.enabled === false &&
      u.enabled === true;

    if (enablingUser) {
      try {
        await grpcAddUser(xray!, u.inbound_tag, u.id, u.uuid);
      } catch (e) {
        console.error("xray AddUser (re-enable) failed:", e);
        return reply.status(502).send({ error: "xray AddUser failed" });
      }
    } else if (disablingUser) {
      try {
        await grpcRemoveUser(xray!, u.inbound_tag, u.id);
      } catch (e) {
        console.error("xray RemoveUser (disable) failed:", e);
        return reply.status(502).send({ error: "xray RemoveUser failed" });
      }
    }

    const next = await db.updateUser(req.params.id, patch);
    return userToApi(next!);
  });

  app.delete<{ Params: { id: string } }>(
    "/users/:id",
    async (req, reply) => {
      const u = await db.getUser(req.params.id);
      if (!u) return reply.status(404).send({ error: "not found" });
      if (xray) {
        try {
          await grpcRemoveUser(xray, u.inbound_tag, u.id);
        } catch (e) {
          console.error("xray RemoveUser failed:", e);
          return reply.status(502).send({ error: "xray RemoveUser failed" });
        }
      }
      await db.deleteUser(req.params.id);
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    "/users/:id/reset-traffic",
    async (req, reply) => {
      const u = await db.getUser(req.params.id);
      if (!u) return reply.status(404).send({ error: "not found" });
      const updated = await db.resetTraffic(req.params.id);
      return userToApi(updated!);
    }
  );
}
