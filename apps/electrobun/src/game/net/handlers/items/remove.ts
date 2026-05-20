// OR — Item remove (by unicId). Inventory store deletes the matching
// row.

import { OR } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.OR");

export function registerItemRemove(client: NetClient): void {
  client.on(OR, (msg) => {
    log.debug(`remove itemId=${msg.itemId}`);
    // TODO(step-4): once GameClient is gone, route into the
    // InventoryStore instance owned by the new app shell.
  });
}
