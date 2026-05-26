// GDA — Server pushes the current map + its left/right/bottom
// neighbour descriptors in a single frame. The session subscribes via
// `onAdjacentMapsData(cb)` and is responsible for:
//   (a) fetching + decrypting the current map and handing it to the
//       battlefield as today,
//   (b) loading the three neighbour maps in parallel and pushing them
//       into the NeighborBandRenderer for the side-band preview,
//   (c) emitting GI once the current map is rendered so the server
//       streams sprite data.

import { GDA, type GDASegments } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GDA");

export type AdjacentMapsListener = (info: GDASegments) => void;

const listeners = new Set<AdjacentMapsListener>();

export function onAdjacentMapsData(cb: AdjacentMapsListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerAdjacentMapsData(client: NetClient): void {
  client.on(GDA, (msg) => {
    const segs = msg.segments();
    log.info(
      `cur=${segs.current.mapId} l=${segs.left?.mapId ?? "-"} r=${segs.right?.mapId ?? "-"} b=${segs.bottom?.mapId ?? "-"}`
    );
    for (const cb of listeners) {
      cb(segs);
    }
  });
}
