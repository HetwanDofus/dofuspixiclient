// GAS — Start of a server-driven action stream (a sequence of GA
// frames that visually belong together, e.g. spell launch + damage +
// AP change). The fight machine doesn't gate on this today, but
// step-5 traces want a confirmed handler so unhandled-opcode warnings
// don't spam the log.

import { GAS } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GAS");

export function registerActionsStart(client: NetClient): void {
  client.on(GAS, (msg) => {
    log.debug(`actions start sprite=${msg.spriteId}`);
  });
}
