import { assign, setup } from "xstate";

export interface SpellCastContext {
  selectedSpellId: number | null;
  casterCellId: number | null;
  targetCellId: number | null;
  rejectionReason: string | null;
}

export type SpellCastEvent =
  | { type: "SELECT_SPELL"; spellId: number; casterCellId: number }
  | { type: "DESELECT" }
  | { type: "TARGET_CELL"; cellId: number }
  | { type: "VALIDATION_PASSED" }
  | { type: "VALIDATION_FAILED"; reason: string }
  | { type: "ANIMATION_COMPLETE" }
  | { type: "EFFECT_APPLIED" }
  | { type: "RESET" };

/**
 * Spell cast UX flow — replaces implicit state scattered across fight-ui.ts
 * and spell-handler paths.
 *
 *   idle ──SELECT_SPELL──> targeting ──TARGET_CELL──> validating
 *                              │                         │
 *                              │ DESELECT                │ VALIDATION_PASSED
 *                              ▼                         ▼
 *                            idle                    animating ──ANIMATION_COMPLETE──> applying
 *                                                                                        │
 *                                                                                        │ EFFECT_APPLIED
 *                                                                                        ▼
 *                                                                                      idle
 *   VALIDATION_FAILED from validating → rejected → idle
 */
export const spellCastMachine = setup({
  types: {
    context: {} as SpellCastContext,
    events: {} as SpellCastEvent,
  },
  actions: {
    selectSpell: assign(({ event }) =>
      event.type === "SELECT_SPELL"
        ? {
            selectedSpellId: event.spellId,
            casterCellId: event.casterCellId,
            targetCellId: null,
            rejectionReason: null,
          }
        : {}
    ),
    targetCell: assign(({ event }) =>
      event.type === "TARGET_CELL" ? { targetCellId: event.cellId } : {}
    ),
    recordRejection: assign(({ event }) =>
      event.type === "VALIDATION_FAILED"
        ? { rejectionReason: event.reason }
        : {}
    ),
    reset: assign(() => ({
      selectedSpellId: null,
      casterCellId: null,
      targetCellId: null,
      rejectionReason: null,
    })),
  },
}).createMachine({
  id: "spellCast",
  initial: "idle",
  context: {
    selectedSpellId: null,
    casterCellId: null,
    targetCellId: null,
    rejectionReason: null,
  },
  states: {
    idle: {
      on: {
        SELECT_SPELL: { target: "targeting", actions: "selectSpell" },
      },
    },
    targeting: {
      on: {
        TARGET_CELL: { target: "validating", actions: "targetCell" },
        SELECT_SPELL: { target: "targeting", actions: "selectSpell" },
        DESELECT: { target: "idle", actions: "reset" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
    validating: {
      on: {
        VALIDATION_PASSED: { target: "animating" },
        VALIDATION_FAILED: { target: "rejected", actions: "recordRejection" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
    animating: {
      on: {
        ANIMATION_COMPLETE: { target: "applying" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
    applying: {
      on: {
        EFFECT_APPLIED: { target: "idle", actions: "reset" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
    rejected: {
      on: {
        SELECT_SPELL: { target: "targeting", actions: "selectSpell" },
        RESET: { target: "idle", actions: "reset" },
      },
    },
  },
});

export type SpellCastMachine = typeof spellCastMachine;
