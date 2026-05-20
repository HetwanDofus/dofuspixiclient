// GDM — Server tells us "the map you're on is <mapId>; here's the
// dateTime + decryptKey to fetch and decrypt the map blob".
//
// The map loader subscribes via `onMapData(cb)` and is responsible for
// (a) fetching the map asset, (b) feeding the decryptKey to the
// in-app decoder, and (c) emitting GDK once the map is fully loaded
// so the server can stream sprite data.

import { GDM } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GDM");

export interface MapDataListener {
  (info: { mapId: string; dateTime: string; decryptKey: string }): void;
}

const listeners = new Set<MapDataListener>();

export function onMapData(cb: MapDataListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerMapData(client: NetClient): void {
  client.on(GDM, (msg) => {
    log.info(`map=${msg.mapId} dt=${msg.dateTime} key=${msg.decryptKey.length}c`);
    for (const cb of listeners) {
      cb({
        mapId: msg.mapId,
        dateTime: msg.dateTime,
        decryptKey: msg.decryptKey,
      });
    }
  });
}
