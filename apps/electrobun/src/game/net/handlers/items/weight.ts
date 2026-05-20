// Ow — Inventory weight update (current / max in pods).

import { Ow } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.Ow");

export function registerItemWeight(client: NetClient): void {
  client.on(Ow, (msg) => {
    log.debug(`weight ${msg.current}/${msg.max}`);
  });
}
