// GM — Sprite add/replace/remove stream. The dofus1-net parser hands
// us a uniform `GMRow` array; per-kind branching lives here so the
// battlefield UI can subscribe to wire-decoupled events.
//
// Step 3 ships the player / creature / monster sprite kinds (the bulk
// of roleplay + fight traffic); other kinds (NPC, monster groups,
// mutants, prisms, mounts) are dropped into `onSpriteRaw` so the UI
// can render a placeholder while we port the type-specific blocks.

import {
  GM,
  type GMRow,
  type GMSpriteAdd,
  type GMSpriteRemove,
} from "@dofus/dofus1-net";
import { match } from "ts-pattern";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GM");

export interface MovementListeners {
  onSpriteAdd?: (row: GMSpriteAdd) => void;
  onSpriteReplace?: (row: GMSpriteAdd) => void;
  onSpriteRemove?: (row: GMSpriteRemove) => void;
  /** Catch-all for sprite types step-3 hasn't ported yet. */
  onSpriteRaw?: (row: GMSpriteAdd) => void;
}

const listeners = new Set<MovementListeners>();

export function onMovement(cb: MovementListeners): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerMovement(client: NetClient): void {
  client.on(GM, (msg) => {
    log.debug(`GM rows=${msg.rows.length}`);
    for (const row of msg.rows) {
      dispatchRow(row);
    }
  });
}

function dispatchRow(row: GMRow): void {
  if (row.op === "remove") {
    for (const l of listeners) {
      l.onSpriteRemove?.(row);
    }
    return;
  }
  match(row.kind)
    .with(
      "player",
      "creature",
      "monster",
      "monsterGroup",
      "npc",
      "offlineCharacter",
      "taxCollector",
      "mutant",
      "prism",
      () => {
        for (const l of listeners) {
          if (row.op === "replace") {
            l.onSpriteReplace?.(row);
          } else {
            l.onSpriteAdd?.(row);
          }
        }
      },
    )
    .otherwise(() => {
      log.debug(
        `unhandled sprite kind ${row.kind} (sprite=${row.spriteId}) — routing as raw`,
      );
      for (const l of listeners) {
        l.onSpriteRaw?.(row);
      }
    });
}
