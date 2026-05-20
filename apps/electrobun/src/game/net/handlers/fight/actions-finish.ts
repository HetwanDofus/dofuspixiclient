// GAF — End of a GAS-bracketed action stream.

import { GAF } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GAF");

export function registerActionsFinish(client: NetClient): void {
  client.on(GAF, (msg) => {
    log.debug(`actions finish id=${msg.actionId} sprite=${msg.spriteId}`);
  });
}
