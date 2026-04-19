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

/** Tags of inbounds currently loaded in Xray (из `config.json` + gRPC, не из БД). */
export async function grpcListInboundTags(
  clients: XrayClients
): Promise<string[]> {
  const res = (await promisifyUnary(clients.handler, "listInbounds", {
    isOnlyTags: true,
  })) as { inbounds?: { tag?: string }[] };
  return (res.inbounds ?? [])
    .map((ib) => ib.tag)
    .filter((t): t is string => Boolean(t));
}

export async function grpcAddUser(
  clients: XrayClients,
  inboundTag: string,
  email: string,
  vlessUuid: string,
  flow = "xtls-rprx-vision"
): Promise<void> {
  const root = clients.root;
  const accountTm = encodeTypedMessage(root, "xray.proxy.vless.Account", {
    id: vlessUuid,
    flow,
    encryption: "none",
  });

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
