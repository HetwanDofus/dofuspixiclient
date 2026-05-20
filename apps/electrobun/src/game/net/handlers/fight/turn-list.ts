// GTL — Turn order list. Server pushes the canonical timeline of
// sprite ids on placement → fighting transition and after summons /
// deaths. Drives the HUD timeline strip.

import { GTL } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";

export function registerTurnList(client: NetClient): void {
  client.on(GTL, (msg) => {
    fightActor.send({
      type: "TIMELINE_UPDATE",
      timeline: msg.spriteIds,
    });
  });
}
