// WC — Open the zaap teleport UI. Carries the current map id and the
// full list of known waypoints with the player's per-waypoint level.

import { WC } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.WC");

export interface WaypointOpenListener {
  (info: {
    currentMapId: number;
    waypoints: ReadonlyArray<{ id: number; level: number }>;
  }): void;
}

const listeners = new Set<WaypointOpenListener>();

export function onWaypointOpen(cb: WaypointOpenListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerWaypointCreate(client: NetClient): void {
  client.on(WC, (msg) => {
    log.info(`zaap open map=${msg.currentMapId} wps=${msg.waypoints.length}`);
    for (const cb of listeners) {
      cb({
        currentMapId: msg.currentMapId,
        waypoints: msg.waypoints,
      });
    }
  });
}
