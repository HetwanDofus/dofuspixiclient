// WV — Close the zaap teleport UI.

import { WV } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.WV");

const listeners = new Set<() => void>();

export function onWaypointClose(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerWaypointLeave(client: NetClient): void {
  client.on(WV, () => {
    log.info("zaap close");
    for (const cb of listeners) cb();
  });
}
