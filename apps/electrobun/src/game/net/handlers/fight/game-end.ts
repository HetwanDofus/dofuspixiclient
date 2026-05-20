// GE — Fight end. Payload is the raw fight-result block (winners,
// loot, xp) which the HUD modal renders. For now we extract the
// winner team (first numeric section per canonical decoder) and let
// the machine clear fight state.

import { GE } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";

export function registerGameEnd(client: NetClient): void {
  client.on(GE, (msg) => {
    // Canonical Aks/extend/GameIn#onEnd splits the raw blob into
    // sections; section[0] carries the winning team. Default to -1
    // when missing so the modal renders "draw / unknown".
    const winnerTeam = Number.parseInt(msg.sections[0] ?? "", 10);
    fightActor.send({
      type: "FIGHT_END",
      payload: {
        winnerTeam: Number.isNaN(winnerTeam) ? -1 : winnerTeam,
      },
    });
  });
}
