// GR — Placement "ready" toggle for a specific fighter. Used for HUD
// indicators (the green check next to a placed fighter). Until the
// HUD has a ready-tracker, this is a debug-trace only.

import { GR } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GR");

export function registerReady(client: NetClient): void {
  client.on(GR, (msg) => {
    log.debug(`ready=${msg.ready} sprite=${msg.spriteId}`);
  });
}
