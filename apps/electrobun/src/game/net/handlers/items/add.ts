// OA — Item add. Wire format is opaque (Items.parseItemData decoder
// still pending in dofus1-net); we forward the raw blob to the
// inventory store, which is responsible for parsing once the
// decoder lands. Until then this is a trace-only handler so the
// frame doesn't surface as "unhandled" in step-5.

import { OA } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.OA");

export function registerItemAdd(client: NetClient): void {
  client.on(OA, (msg) => {
    log.debug(`add raw=${msg.raw.slice(0, 80)}${msg.raw.length > 80 ? "…" : ""}`);
  });
}
