// GIC — Game Info Coordinates. Server emits this when sprites change
// cell without an animation: most commonly during fight placement when
// the player clicks another team-cell (the server sends Gp<cell> ack
// as a row in GIC), or when two fighters are swapped server-side.
//
// Canonical AS2: `Game.onPlayersCoordinates` → `gfx.setSpritePosition`
// per row. We split that into two effects:
//   1. Fan out a `FIGHTER_UPDATE { cell }` per row so the fight store +
//      every UI subscriber (turn timeline, hover preview anchor) sees
//      the canonical cell immediately.
//   2. Notify external listeners (session.ts) so they can refresh
//      `selfCellId` + teleport the on-screen sprite.

import { GIC, type GICCoordRow } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GIC");

export type PlayerCoordsListener = (coords: ReadonlyArray<GICCoordRow>) => void;

const listeners = new Set<PlayerCoordsListener>();

export function onPlayerCoords(cb: PlayerCoordsListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerInfoCoordinates(client: NetClient): void {
  client.on(GIC, (msg) => {
    if (msg.coords.length === 0) {
      return;
    }
    log.debug(
      `coords ${msg.coords.map((c) => `${c.spriteId}@${c.cell}`).join(",")}`,
    );
    for (const { spriteId, cell } of msg.coords) {
      fightActor.send({
        type: "FIGHTER_UPDATE",
        spriteId,
        patch: { cell },
      });
    }
    for (const cb of listeners) {
      cb(msg.coords);
    }
  });
}
