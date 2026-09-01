import type { ItemData } from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/** The last attempt's outcome, for the line the window prints. */
export type CraftOutcome = "none" | "success" | "failure";

export interface CraftState {
  open: boolean;
  /**
   * The craft skill the bench was opened with — "Scier", "Fondre"…
   * The recipe list is resolved client-side from `crafts.json` against
   * `SK[skillId].cl`, exactly as `Job.initialize` does.
   */
  skillId: number;
  /** What is laid in the slots, keyed by `ItemData.unicId`. */
  slots: Map<number, ItemData>;
  /** How many slots the character has; frozen by the server at open. */
  maxSlots: number;
  outcome: CraftOutcome;
  /** Set while a series is running, so the window can offer "arrêter". */
  seriesRemaining: number;
  seriesCrafted: number;
}

const closed: CraftState = {
  open: false,
  skillId: 0,
  slots: new Map(),
  maxSlots: 0,
  outcome: "none",
  seriesRemaining: 0,
  seriesCrafted: 0,
};

/**
 * The workbench window.
 *
 * Deliberately separate from `exchange-store` even though both ride the `E`
 * channel: a bench has no far-side container, so nothing in it maps onto the
 * storage store's two-grid shape. It is separate from `trade-store` for the
 * opposite reason — no second player, no ready flags, no anti-scam delay.
 */
export const craftStore = new ExternalStore<CraftState>(closed);

/**
 * The skill the player last asked an interactive element for.
 *
 * `EC3` says "a craft window opened" and nothing else — 1.29 has no field
 * for which bench it is, because its client already knows: it sent the
 * `GA;500;<cell>;<skill>` that caused it. This is that memory, and it is
 * what lets the window build its recipe list from `SK[skillId].cl` without
 * a frame the retail protocol does not have.
 */
let requestedSkillId = 0;

export function noteRequestedSkill(skillId: number): void {
  requestedSkillId = skillId;
}

export function lastRequestedSkill(): number {
  return requestedSkillId;
}

/** `EC3` — the bench opened. */
export function openCraft(skillId: number, maxSlots: number): void {
  craftStore.replaceState({
    ...closed,
    open: true,
    skillId,
    maxSlots,
    slots: new Map(),
  });
}

export function closeCraft(): void {
  if (craftStore.getSnapshot().open) {
    craftStore.replaceState(closed);
  }
}

/**
 * `EM` — one stack changed on the bench.
 *
 * `item.quantity` is the **absolute** amount now in the slot, not a delta;
 * a removal is `add: false` and only the id is read.
 */
export function applyBenchItem(add: boolean, item: ItemData | undefined): void {
  const state = craftStore.getSnapshot();

  if (!state.open || !item) {
    return;
  }

  const slots = new Map(state.slots);

  if (add) {
    slots.set(item.unicId, item);
  } else {
    slots.delete(item.unicId);
  }

  craftStore.setState({ slots, outcome: "none" });
}

/** `Ec` — how the attempt went. */
export function applyCraftResult(resultCode: string): void {
  if (!craftStore.getSnapshot().open) {
    return;
  }

  craftStore.setState({
    // The bench is emptied by the server on every attempt, success or not.
    slots: new Map(),
    outcome: resultCode === "S" ? "success" : "failure",
  });
}

/** `EA` — one round of a series went by. */
export function applyCraftLoop(remaining: number): void {
  craftStore.setState({ seriesRemaining: remaining });
}

/** `Ea` — the series ended. */
export function applyCraftLoopEnd(totalCrafted: number): void {
  craftStore.setState({ seriesRemaining: 0, seriesCrafted: totalCrafted });
}
