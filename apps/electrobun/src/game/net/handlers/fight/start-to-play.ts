// GS — Placement → fighting transition. The state machine's
// `placement → fighting` edge listens for `FIGHT_START`.

import { GS } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";

export function registerStartToPlay(client: NetClient): void {
  client.on(GS, () => {
    fightActor.send({ type: "FIGHT_START" });
  });
}
