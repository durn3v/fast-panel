import * as db from "./db.js";
import type { XrayClients } from "./services/xrayClient.js";
import { grpcAddUser } from "./services/xrayClient.js";

/** Повторно добавляет пользователей в уже загруженный из `config.json` Xray. */
export async function restoreXrayFromDb(xray: XrayClients): Promise<void> {
  const users = await db.listUsers();
  for (const u of users) {
    if (!u.enabled) continue;
    try {
      await grpcAddUser(xray, u.inbound_tag, u.id, u.uuid);
    } catch (e) {
      console.error(`restore user ${u.id}`, e);
      throw e;
    }
  }
}
