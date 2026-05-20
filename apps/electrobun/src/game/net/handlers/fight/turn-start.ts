// GTS — Turn start. Drives `fight.machine`'s TURN_START event, which
// transitions into `myTurn` / `opponentTurn` based on the active
// fighter's spriteId vs. `context.mySpriteId`.

import { GTS } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";

export function registerTurnStart(client: NetClient): void {
  client.on(GTS, (msg) => {
    fightActor.send({
      type: "TURN_START",
      payload: {
        spriteId: msg.spriteId,
        tableTurnNum: msg.tableTurn,
      },
    });
  });
}
