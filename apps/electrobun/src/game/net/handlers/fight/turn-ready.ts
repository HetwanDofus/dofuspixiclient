// GTR — Server-side acknowledgement that a fighter is ready in
// placement. The machine treats this as a no-op marker (placement →
// fighting is driven by GS), but we keep the handler so the frame
// doesn't surface as "unhandled opcode" in step-5 traces.

import { GTR } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GTR");

export function registerTurnReady(client: NetClient): void {
  client.on(GTR, (msg) => {
    log.debug(`ready ack spriteId=${msg.spriteId}`);
  });
}
