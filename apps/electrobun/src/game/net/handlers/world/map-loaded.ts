// GDK — Server-side ack that we asked it to consider us "map-loaded".
// Inbound carries no body — it's a marker frame the canonical client
// emits in response to the GDK request after rendering completes.
// (Outbound GDK is sent by the map loader once it's ready for sprite
// streams; this inbound flow exists for parity but rarely triggers
// in practice on AraknemuHorizon.)

import { GDK } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GDK");

export function registerMapLoaded(client: NetClient): void {
  client.on(GDK, () => {
    log.debug("map-loaded ack");
  });
}
