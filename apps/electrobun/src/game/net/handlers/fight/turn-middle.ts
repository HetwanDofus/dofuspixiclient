// GTM — Periodic mid-turn snapshot of every fighter's hp/ap/mp/cell.
// Server emits this on summons, deaths, debuffs, and round transitions.
// We map each row into `FIGHTER_UPDATE` so existing fighter snapshots
// patch in-place; if the fighter is missing the machine ignores the
// event (a follow-up FIGHTER_UPSERT will create it).

import { GTM } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { fightActor } from "@/game/stores/fight-store";

export function registerTurnMiddle(client: NetClient): void {
  client.on(GTM, (msg) => {
    for (const u of msg.updates) {
      fightActor.send({
        type: "FIGHTER_UPDATE",
        spriteId: u.spriteId,
        patch: {
          dead: u.dead,
          hp: u.hp,
          maxHp: u.hpMax,
          ap: u.ap,
          mp: u.mp,
          cell: u.cell,
        },
      });
    }
  });
}
