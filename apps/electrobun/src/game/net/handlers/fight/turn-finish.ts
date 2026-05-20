// GTF — Turn finished. Counterpart to GTS; transitions the fight
// machine back to `waitingForTurn`.

import { GTF } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";

export function registerTurnFinish(client: NetClient): void {
  client.on(GTF, (msg) => {
    fightActor.send({
      type: "TURN_END",
      payload: { spriteId: msg.spriteId },
    });
  });
}
