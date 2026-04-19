import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { join } from "node:path";
import type protobuf from "protobufjs";
import {
  getProtoRoot,
  encodeTypedMessage,
  wrapAsTypedMessage,
} from "./xrayProto.js";

export type XrayClients = {
  handler: grpc.Client;
  stats: grpc.Client;
  root: protobuf.Root;
};

export async function createXrayClients(
  protoRoot: string,
  host: string,
  port: number
): Promise<XrayClients> {
  const root = await getProtoRoot(protoRoot);
  const def = protoLoader.loadSync(
    [
      join(protoRoot, "app", "proxyman", "command", "command.proto"),
      join(protoRoot, "app", "stats", "command", "command.proto"),
    ],
    {
      includeDirs: [protoRoot],
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    }
  );
  const grpcPkg = grpc.loadPackageDefinition(def) as any;
  const HandlerService =
    grpcPkg.xray.app.proxyman.command.HandlerService as grpc.ServiceClientConstructor;
  const StatsService =
    grpcPkg.xray.app.stats.command.StatsService as grpc.ServiceClientConstructor;

  const addr = `${host}:${port}`;
  const creds = grpc.credentials.createInsecure();
  return {
    handler: new HandlerService(addr, creds),
    stats: new StatsService(addr, creds),
    root,
  };
}

function promisifyUnary<TReq, TRes>(
  client: grpc.Client,
  method: string,
  request: TReq
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    (client as any)[method](request, (err: grpc.ServiceError | null, res: TRes) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

export type InboundInfo = { tag: string; protocol: string };

/**
 * Returns all inbounds currently loaded in Xray with their tag and protocol.
 * Protocol is derived from the proxy_settings type URL, e.g.
 * "xray.proxy.vless.ServerObject" → "vless".
 */
export async function grpcListInbounds(
  clients: XrayClients
): Promise<InboundInfo[]> {
  const res = (await promisifyUnary(clients.handler, "listInbounds", {})) as {
    inbounds?: { tag?: string; proxy_settings?: { type?: string } }[];
  };
  return (res.inbounds ?? [])
    .filter((ib): ib is { tag: string; proxy_settings?: { type?: string } } =>
      Boolean(ib.tag)
    )
    .map((ib) => ({
      tag: ib.tag,
      protocol: extractProtocolFromType(ib.proxy_settings?.type),
    }));
}

/** @deprecated Use grpcListInbounds instead. */
export async function grpcListInboundTags(
  clients: XrayClients
): Promise<string[]> {
  return (await grpcListInbounds(clients)).map((ib) => ib.tag);
}

function extractProtocolFromType(typeUrl?: string): string {
  if (!typeUrl) return "vless";
  // "xray.proxy.vless.ServerObject" → "vless"
  const m = typeUrl.match(/xray\.proxy\.(\w+)\./);
  return m?.[1] ?? "vless";
}

function buildAccountTypedMessage(
  root: protobuf.Root,
  protocol: string,
  uuid: string,
  flow: string | null
): protobuf.Message {
  switch (protocol) {
    case "vmess":
      return encodeTypedMessage(root, "xray.proxy.vmess.Account", { id: uuid });

    case "trojan":
      return encodeTypedMessage(root, "xray.proxy.trojan.Account", {
        password: uuid,
      });

    case "vless":
    default:
      return encodeTypedMessage(root, "xray.proxy.vless.Account", {
        id: uuid,
        flow: flow ?? "",
        encryption: "none",
      });
  }
}

export async function grpcAddUser(
  clients: XrayClients,
  inboundTag: string,
  email: string,
  uuid: string,
  protocol = "vless",
  flow: string | null = "xtls-rprx-vision"
): Promise<void> {
  const root = clients.root;
  const accountTm = buildAccountTypedMessage(root, protocol, uuid, flow);

  const User = root.lookupType("xray.common.protocol.User");
  const userMsg = User.create({
    level: 0,
    email,
    account: accountTm,
  });

  const AddUserOperation = root.lookupType(
    "xray.app.proxyman.command.AddUserOperation"
  );
  const addOp = AddUserOperation.create({ user: userMsg });
  const operation = wrapAsTypedMessage(
    root,
    "xray.app.proxyman.command.AddUserOperation",
    addOp
  );
  const TM = root.lookupType("xray.common.serial.TypedMessage");
  await promisifyUnary(clients.handler, "alterInbound", {
    tag: inboundTag,
    operation: TM.toObject(operation as protobuf.Message, {
      defaults: true,
    }),
  });
}

export async function grpcRemoveUser(
  clients: XrayClients,
  inboundTag: string,
  email: string
): Promise<void> {
  const root = clients.root;
  const RemoveUserOperation = root.lookupType(
    "xray.app.proxyman.command.RemoveUserOperation"
  );
  const rm = RemoveUserOperation.create({ email });
  const operation = wrapAsTypedMessage(
    root,
    "xray.app.proxyman.command.RemoveUserOperation",
    rm
  );
  const TM = root.lookupType("xray.common.serial.TypedMessage");
  await promisifyUnary(clients.handler, "alterInbound", {
    tag: inboundTag,
    operation: TM.toObject(operation as protobuf.Message, {
      defaults: true,
    }),
  });
}

export type StatRow = { name: string; value: string };

export async function grpcQueryStats(
  clients: XrayClients,
  pattern: string,
  reset: boolean
): Promise<StatRow[]> {
  const res = (await promisifyUnary(clients.stats, "queryStats", {
    pattern,
    reset,
  })) as { stat?: { name: string; value: string | number }[] };
  const rows = res.stat ?? [];
  return rows.map((s) => ({
    name: s.name,
    value: String(s.value ?? 0),
  }));
}
