import protobuf from "protobufjs";
import { join } from "node:path";

let cached: Promise<protobuf.Root> | null = null;

export function getProtoRoot(protoRoot: string): Promise<protobuf.Root> {
  if (!cached) {
    const root = new protobuf.Root();
    root.resolvePath = (_origin: string, target: string) =>
      join(protoRoot, target);
    cached = (async () => {
      await root.load(
        join(protoRoot, "app", "proxyman", "command", "command.proto")
      );
      await root.load(
        join(protoRoot, "app", "stats", "command", "command.proto")
      );
      return root;
    })();
  }
  return cached;
}

export function wrapAsTypedMessage(
  root: protobuf.Root,
  typeName: string,
  message: protobuf.Message
): protobuf.Message {
  const T = root.lookupType(typeName);
  const buf = T.encode(message).finish();
  const TM = root.lookupType("xray.common.serial.TypedMessage");
  const tmErr = TM.verify({ type: typeName, value: buf });
  if (tmErr) throw new Error(tmErr);
  return TM.create({ type: typeName, value: buf });
}

export function encodeTypedMessage(
  root: protobuf.Root,
  typeName: string,
  payload: protobuf.Message | object
): protobuf.Message {
  const T = root.lookupType(typeName);
  const err = T.verify(payload);
  if (err) throw new Error(`Proto verify ${typeName}: ${err}`);
  const msg = T.create(payload);
  const buf = T.encode(msg).finish();
  const TM = root.lookupType("xray.common.serial.TypedMessage");
  const tmErr = TM.verify({ type: typeName, value: buf });
  if (tmErr) throw new Error(tmErr);
  return TM.create({ type: typeName, value: buf });
}
