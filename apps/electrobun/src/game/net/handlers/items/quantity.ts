// OQ — Item quantity update. Used when stacking items or after a
// recipe consumes ingredients without removing the slot.

import { OQ } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.OQ");

export function registerItemQuantity(client: NetClient): void {
  client.on(OQ, (msg) => {
    log.debug(`qty itemId=${msg.itemId} → ${msg.quantity}`);
  });
}
