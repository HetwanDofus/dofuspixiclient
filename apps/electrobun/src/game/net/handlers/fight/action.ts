// GA — Action stream. The server emits actionType-keyed records inside
// a GAS / GAF bracket. Each `actionType` triggers a specific visual /
// state effect on the battlefield; canonical reference is
// `assets/sources/client-code/dofus/aks/GameActions.as#onActions` (the
// huge switch starting at L319).
//
// Wire shape (dofus1-net's `GA` class):
//
//   actionId   = unique stream id (server-side bookkeeping)
//   actionType = the sub-code we switch on
//   sourceSpriteId = sprite that initiated the action (caster, mover…)
//   args       = `;`-split tail. Most actions encode their data as a
//                single `,`-separated string at `args[0]`; we re-split
//                inside each case to recover the per-field layout.
//
// Per the step-3 plan we route the common sub-codes (movement, damage,
// AP/MP delta, spell launch, death, direction change, challenges) and
// fall through to a debug trace for anything else so step-5 can
// triage unknown codes against the live server.

import { GA } from "@dofus/dofus1-net";
import { match, P } from "ts-pattern";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GA");

export type FightActionEvent =
  | {
      type: "movement";
      sourceSpriteId: string;
      spriteId: string;
      /** Server-assigned action id. After the visual move is done the
       *  client must send `GKK<actionId>` (canonical AS2 actionAck)
       *  or the server will NOOP every subsequent action with
       *  `GA;0`. */
      actionId: number;
      /** Base64-encoded cell path. Decode via the grid layer. */
      path: string;
    }
  | {
      /** GA action 2 — CHANGE_MAP. Server signals "you're leaving
       *  this map; clear sprite roster + UI, expect a new GDM next".
       *  Canonical AS2 (`GameActionsEx.as:177+`) clears gfx +
       *  datacenter.clearGame() on this event. */
      type: "change-map";
      sourceSpriteId: string;
      /** Optional cinematic SWF name to play during the transition. */
      cinematic: string;
    }
  | { type: "level-up"; sourceSpriteId: string; level: number }
  | {
      type: "spell-cooldown";
      sourceSpriteId: string;
      spellId: number;
      remainingTurns: number;
    }
  | { type: "join-fight"; sourceSpriteId: string; challengeId: number }
  | { type: "end-turn"; sourceSpriteId: string }
  | {
      type: "damage";
      sourceSpriteId: string;
      targetSpriteId: string;
      amount: number;
      element: number;
    }
  | {
      type: "ap-change";
      sourceSpriteId: string;
      targetSpriteId: string;
      delta: number;
    }
  | {
      type: "mp-change";
      sourceSpriteId: string;
      targetSpriteId: string;
      delta: number;
    }
  | {
      type: "spell-boost";
      sourceSpriteId: string;
      targetSpriteId: string;
      value: number;
    }
  | {
      type: "glyph-trigger";
      sourceSpriteId: string;
      glyphId: string;
    }
  | {
      type: "spell-launch";
      sourceSpriteId: string;
      casterId: string;
      targetCell: number;
      spellId: number;
      level: number;
      critical: number;
      visualGfxId: number;
      animation: string;
    }
  | { type: "death"; sourceSpriteId: string; targetSpriteId: string }
  | {
      type: "direction-change";
      sourceSpriteId: string;
      targetSpriteId: string;
      direction: number;
    }
  | {
      type: "challenge";
      sourceSpriteId: string;
      actionType: number;
      args: string[];
    }
  | {
      type: "unknown";
      sourceSpriteId: string;
      actionType: number;
      args: string[];
    };

const listeners = new Set<(e: FightActionEvent) => void>();

export function onFightAction(
  cb: (e: FightActionEvent) => void,
): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(e: FightActionEvent): void {
  for (const cb of listeners) {
    cb(e);
  }
}

/**
 * Most actions encode their payload as a single comma-separated
 * string at `args[0]`. Some carry multiple `;`-separated argument
 * blocks (challenges, trap triggers); for those we expose the raw
 * `args` array.
 */
function firstCsv(args: readonly string[]): string[] {
  return (args[0] ?? "").split(",");
}
function intAt(parts: readonly string[], i: number): number {
  const n = Number.parseInt(parts[i] ?? "", 10);
  return Number.isNaN(n) ? 0 : n;
}

export function registerAction(client: NetClient): void {
  client.on(GA, (msg) => {
    routeAction(msg.actionId, msg.actionType, msg.sourceSpriteId, msg.args);
  });
}

function routeAction(
  actionId: number,
  actionType: number,
  sourceSpriteId: string,
  args: readonly string[],
): void {
  match(actionType)
    // 1 — Player movement. Wire: `GA<id>;1;<spriteId>;<compressedPath>`.
    // The path arrives whole at `args[0]` (no comma split); the mover
    // is the action's `sourceSpriteId`, not an inner field. Canonical
    // AS2 reads `_loc7_` (= the rest after the third `;`) verbatim
    // and feeds it to `Compressor.extractFullPath`.
    .with(1, () => {
      emit({
        type: "movement",
        sourceSpriteId,
        spriteId: sourceSpriteId,
        actionId,
        path: args[0] ?? "",
      });
    })
    // 2 — Change map. Wire: `GA<id>;2;<sprite>;<cinematic>`. Sent
    // by the server when a trigger-cell teleport (TeleportToCell /
    // Teleport from `maps.json:triggers[].action=0`) fires, AFTER
    // the new GDM has been pushed. Canonical client clears its
    // sprite/datacenter state on this signal.
    .with(2, () => {
      emit({
        type: "change-map",
        sourceSpriteId,
        cinematic: args[0] ?? "",
      });
    })
    // 4 — Level up. Wire: <newLevel>
    .with(4, () => {
      emit({
        type: "level-up",
        sourceSpriteId,
        level: intAt(firstCsv(args), 0),
      });
    })
    // 50 — Spell cooldown lockout. Wire: <spellId>,<turns>
    .with(50, () => {
      const csv = firstCsv(args);
      emit({
        type: "spell-cooldown",
        sourceSpriteId,
        spellId: intAt(csv, 0),
        remainingTurns: intAt(csv, 1),
      });
    })
    // 70 — Challenge join.
    .with(70, () => {
      emit({
        type: "join-fight",
        sourceSpriteId,
        challengeId: intAt(firstCsv(args), 0),
      });
    })
    // 99 — Voluntary end-of-turn (the active fighter pressed "pass").
    .with(99, () => {
      emit({ type: "end-turn", sourceSpriteId });
    })
    // 100 / 108 / 110 — Damage (positive amount). Wire: <target>,<amount>,<element>
    .with(100, 108, 110, () => {
      const csv = firstCsv(args);
      emit({
        type: "damage",
        sourceSpriteId,
        targetSpriteId: csv[0] ?? "",
        amount: intAt(csv, 1),
        element: intAt(csv, 2),
      });
    })
    // 101 / 102 / 111 / 120 / 168 — AP delta. Wire: <target>,<delta>
    .with(101, 102, 111, 120, 168, () => {
      const csv = firstCsv(args);
      emit({
        type: "ap-change",
        sourceSpriteId,
        targetSpriteId: csv[0] ?? "",
        delta: intAt(csv, 1),
      });
    })
    // 127 / 128 / 129 / 78 / 169 — MP delta. Wire: <target>,<delta>
    .with(127, 128, 129, 78, 169, () => {
      const csv = firstCsv(args);
      emit({
        type: "mp-change",
        sourceSpriteId,
        targetSpriteId: csv[0] ?? "",
        delta: intAt(csv, 1),
      });
    })
    // 140 — Spell boost (transient buff). Wire: <target>,<value>
    .with(140, () => {
      const csv = firstCsv(args);
      emit({
        type: "spell-boost",
        sourceSpriteId,
        targetSpriteId: csv[0] ?? "",
        value: intAt(csv, 1),
      });
    })
    // 164 — Trap / glyph trigger. Wire: <glyphId>,…
    .with(164, () => {
      emit({
        type: "glyph-trigger",
        sourceSpriteId,
        glyphId: firstCsv(args)[0] ?? "",
      });
    })
    // 300 — Spell launch. Wire:
    //   <casterId>,<targetCell>,<spellId>,<level>,<critical>,<gfxId>,<animation>
    .with(300, () => {
      const csv = firstCsv(args);
      emit({
        type: "spell-launch",
        sourceSpriteId,
        casterId: csv[0] ?? "",
        targetCell: intAt(csv, 1),
        spellId: intAt(csv, 2),
        level: intAt(csv, 3),
        critical: intAt(csv, 4),
        visualGfxId: intAt(csv, 5),
        animation: csv[6] ?? "",
      });
    })
    // 103 / 501 — Death. AS2 1.29 uses 103, AraknemuHorizon may use 501;
    // route both into the same event.
    .with(103, 501, () => {
      emit({
        type: "death",
        sourceSpriteId,
        targetSpriteId: firstCsv(args)[0] ?? "",
      });
    })
    // 11 / 764 — Direction change. AS2 1.29 uses 11, AraknemuHorizon may
    // use 764; route both.
    .with(11, 764, () => {
      const csv = firstCsv(args);
      emit({
        type: "direction-change",
        sourceSpriteId,
        targetSpriteId: csv[0] ?? "",
        direction: intAt(csv, 1),
      });
    })
    // 900-999 — Challenge lifecycle (create / accept / refuse / cancel).
    .with(P.number.between(900, 999), () => {
      emit({
        type: "challenge",
        sourceSpriteId,
        actionType,
        args: [...args],
      });
    })
    .otherwise(() => {
      log.debug(
        `unhandled GA type=${actionType} src=${sourceSpriteId} args=${args.join(";")}`,
      );
      emit({
        type: "unknown",
        sourceSpriteId,
        actionType,
        args: [...args],
      });
    });
}
