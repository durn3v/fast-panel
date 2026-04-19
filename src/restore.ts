import * as db from "./db.js";
import type { XrayClients } from "./services/xrayClient.js";
import { grpcAddUser } from "./services/xrayClient.js";

/** Повторно добавляет пользователей в уже загруженный из `config.json` Xray. */
export async function restoreXrayFromDb(xray: XrayClients): Promise<void> {
  const users = await db.listUsers();
  let restored = 0;
  let failed = 0;
  for (const u of users) {
    if (!u.enabled) continue;
    try {
      await grpcAddUser(xray, u.inbound_tag, u.id, u.uuid, u.protocol, u.flow);
      restored++;
    } catch (e) {
      console.error(`restore: failed to add user ${u.id} (tag=${u.inbound_tag}):`, e);
      failed++;
    }
  }
  if (failed > 0) {
    console.warn(`restore: ${restored} users restored, ${failed} skipped due to errors`);
  }
}
