// GJ — Game Join (start of placement / spectate). Drives the fight
// machine into either `placement` or `spectating` depending on the
// `isSpectator` flag.
//
// Critical: the FIGHT_INIT event MUST carry `mySpriteId`. The fight
// machine's `isMyTurn` guard (fight.machine.ts:150-153) compares
// `context.mySpriteId` against TURN_START's spriteId — if mySpriteId
// stays null, the guard never matches, the machine never enters the
// `fighting.myTurn` substate, and the HUD's pass-turn / cast buttons
// stay disabled forever. The wire frame doesn't carry our sprite id
// (we already know it from auth handshake), so we pull from
// `playerStore.spriteId` which session.ts seeds on character select.

import { GJ } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";
import { playerStore } from "@/game/stores/player-store";

export function registerJoin(client: NetClient): void {
  client.on(GJ, (msg) => {
    if (msg.isSpectator) {
      fightActor.send({ type: "FIGHT_SPECTATE_INIT" });
      return;
    }
    const { spriteId } = playerStore.getSnapshot();
    fightActor.send({
      type: "FIGHT_INIT",
      ...(spriteId ? { mySpriteId: spriteId } : {}),
    });
  });
}
