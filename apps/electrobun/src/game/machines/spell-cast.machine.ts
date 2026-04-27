import { createActor, assign, setup } from "xstate";

import type { SpellEntry } from "@/game/stores/spells-store";

/**
 * Spell-cast UX flow — the single driver of what the HUD shows and what
 * the client sends to the server when the player is choosing a target.
 *
 *   idle ──SELECT_SPELL──> targeting ──TARGET_CELL──> pending
 *     ▲                       │                         │
 *     │ RESET / DESELECT      │ DESELECT                │ SERVER_ACK
 *     │                       ▼                         ▼
 *     ├───── rejected <─── SERVER_REJECTED         animating
 *     │                                                 │
 *     │                                                 │ ANIMATION_COMPLETE
 *     │                                                 ▼
 *     │                                              resolving
 *     │                                                 │
 *     └────────────────── EFFECTS_RESOLVED ─────────────┘
 *
 *  - `targetingCells` is the range ring the caller computes via
 *    `pf.cellsInRange(caster, rangeMin, rangeMax)` and passes on
 *    SELECT_SPELL; the HUD tints exactly these cells.
 *  - `previewCells` is the AoE-on-hover set the caller computes via
 *    `cellsInArea(fmap, caster, hovered, spell.areaKind, spell.areaSize)`
 *    and passes on HOVER_CELL; the HUD overlays these cells in the
 *    spell-zone tint.
 *
 *  The machine never reaches into the pathfinder itself — it just stores
 *  what the caller feeds in so every transition is deterministic and
 *  testable.
 */

export interface SpellCastContext {
  spell: SpellEntry | null;
  casterCellId: number | null;
  targetCellId: number | null;
  hoveredCellId: number | null;
  targetingCells: number[];
  previewCells: number[];
  rejectionReason: string | null;
}

export type SpellCastEvent =
  | {
      type: "SELECT_SPELL";
      spell: SpellEntry;
      casterCellId: number;
      targetingCells: number[];
    }
  | { type: "DESELECT" }
  | {
      type: "HOVER_CELL";
      cellId: number;
      previewCells: number[];
    }
  | { type: "HOVER_CLEAR" }
  | { type: "TARGET_CELL"; cellId: number }
  | { type: "SERVER_ACK" }
  | { type: "SERVER_REJECTED"; reason: string }
  | { type: "ANIMATION_COMPLETE" }
  | { type: "EFFECTS_RESOLVED" }
  | { type: "TURN_ENDED" }
  | { type: "RESET" };

const initialContext: SpellCastContext = {
  spell: null,
  casterCellId: null,
  targetCellId: null,
  hoveredCellId: null,
  targetingCells: [],
  previewCells: [],
  rejectionReason: null,
};

export const spellCastMachine = setup({
  types: {
    context: {} as SpellCastContext,
    events: {} as SpellCastEvent,
  },
  actions: {
    applySelect: assign(({ event }) =>
      event.type === "SELECT_SPELL"
        ? {
            spell: event.spell,
            casterCellId: event.casterCellId,
            targetingCells: event.targetingCells,
            targetCellId: null,
            hoveredCellId: null,
            previewCells: [],
            rejectionReason: null,
          }
        : {}
    ),
    applyHover: assign(({ event }) =>
      event.type === "HOVER_CELL"
        ? {
            hoveredCellId: event.cellId,
            previewCells: event.previewCells,
          }
        : {}
    ),
    clearHover: assign(() => ({
      hoveredCellId: null,
      previewCells: [] as number[],
    })),
    applyTarget: assign(({ event }) =>
      event.type === "TARGET_CELL" ? { targetCellId: event.cellId } : {}
    ),
    applyRejection: assign(({ event }) =>
      event.type === "SERVER_REJECTED"
        ? { rejectionReason: event.reason }
        : {}
    ),
    reset: assign(() => ({ ...initialContext })),
  },
}).createMachine({
  id: "spellCast",
  initial: "idle",
  context: initialContext,
  on: {
    // TURN_ENDED / RESET cancel the whole flow regardless of substate —
    // server won't accept a cast after the turn flips, so the UI must
    // drop any pending selection.
    TURN_ENDED: { target: ".idle", actions: "reset" },
    RESET: { target: ".idle", actions: "reset" },
  },
  states: {
    idle: {
      on: {
        SELECT_SPELL: { target: "targeting", actions: "applySelect" },
      },
    },
    targeting: {
      on: {
        SELECT_SPELL: { target: "targeting", actions: "applySelect" },
        HOVER_CELL: { actions: "applyHover" },
        HOVER_CLEAR: { actions: "clearHover" },
        TARGET_CELL: { target: "pending", actions: "applyTarget" },
        DESELECT: { target: "idle", actions: "reset" },
      },
    },
    pending: {
      on: {
        SERVER_ACK: { target: "animating" },
        SERVER_REJECTED: { target: "rejected", actions: "applyRejection" },
        // Fallback: if the server goes quiet for longer than the UI
        // wants to block on, the consumer dispatches RESET (handled by
        // the top-level handler above).
      },
    },
    animating: {
      on: {
        ANIMATION_COMPLETE: { target: "resolving" },
      },
    },
    resolving: {
      on: {
        EFFECTS_RESOLVED: { target: "idle", actions: "reset" },
      },
    },
    rejected: {
      // The consumer shows the rejection reason (toast / inline) and
      // dispatches RESET to return to idle, or SELECT_SPELL to start
      // a new attempt.
      on: {
        SELECT_SPELL: { target: "targeting", actions: "applySelect" },
      },
    },
  },
});

export type SpellCastMachine = typeof spellCastMachine;

/**
 * Module-level actor. Mirrors the `fightActor` pattern in
 * `@/game/stores/fight-store` — one long-lived instance started at
 * import time so stores and the composition root can subscribe without
 * plumbing an actor reference everywhere.
 */
export const spellCastActor = createActor(spellCastMachine);
spellCastActor.start();
