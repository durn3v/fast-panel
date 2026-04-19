import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import * as db from "../db.js";
import { userToApi } from "../serialize.js";
import type { XrayClients } from "../services/xrayClient.js";
import {
  grpcAddUser,
  grpcListInboundTags,
  grpcRemoveUser,
} from "../services/xrayClient.js";

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
      expireAt?: string | null;
      dataLimit?: number | string | null;
    };
  }>("/users", async (req, reply) => {
    const { name, inboundTag } = req.body;
    if (!name || !inboundTag) {
      return reply.status(400).send({ error: "name and inboundTag required" });
    }

    if (xray) {
      try {
        const tags = await grpcListInboundTags(xray);
        if (!tags.includes(inboundTag)) {
          return reply.status(400).send({
            error: "inboundTag not found in running Xray",
            knownTags: tags,
          });
        }
      } catch (e) {
        console.error(e);
        return reply.status(502).send({
          error: "xray ListInbounds failed",
          detail: String(e),
        });
      }
    }

    const id = randomUUID();
    const vlessUuid = randomUUID();
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
      dataLimit = BigInt(req.body.dataLimit);
    }

    if (xray) {
      try {
        await grpcAddUser(xray, inboundTag, id, vlessUuid);
      } catch (e) {
        console.error(e);
        return reply.status(502).send({
          error: "xray AddUser failed",
          detail: String(e),
        });
      }
    }

    await db.insertUser({
      id,
      name,
      uuid: vlessUuid,
      inbound_tag: inboundTag,
      enabled: true,
      expire_at: expireAt,
      data_limit: dataLimit,
    });

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
      expireAt: string | null;
      dataLimit: number | string | null;
    }>;
  }>("/users/:id", async (req, reply) => {
    const u = await db.getUser(req.params.id);
    if (!u) return reply.status(404).send({ error: "not found" });
    const patch: Parameters<typeof db.updateUser>[1] = {};
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.enabled !== undefined) patch.enabled = req.body.enabled;
    if (req.body.expireAt !== undefined) {
      patch.expire_at =
        req.body.expireAt === null ? null : new Date(req.body.expireAt);
      if (patch.expire_at && Number.isNaN(patch.expire_at.getTime())) {
        return reply.status(400).send({ error: "invalid expireAt" });
      }
    }
    if (req.body.dataLimit !== undefined) {
      patch.data_limit =
        req.body.dataLimit === null ? null : BigInt(req.body.dataLimit);
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
          console.error(e);
          return reply.status(502).send({
            error: "xray RemoveUser failed",
            detail: String(e),
          });
        }
      }
      await db.deleteUser(req.params.id);
      return reply.status(204).send();
    }
  );
}
