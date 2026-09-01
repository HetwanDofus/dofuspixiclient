import type { ItemData } from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/** Which end of the deal this client is standing at. */
export type SecureCraftRole = "none" | "customer" | "artisan";

export interface SecureCraftState {
  open: boolean;
  role: SecureCraftRole;
  /** The bench: the customer's ingredients, keyed by `ItemData.unicId`. */
  slots: Map<number, ItemData>;
  /** What the customer offers for the work. */
  payItems: Map<number, ItemData>;
  payKamas: number;
  outcome: "none" | "success" | "failure";
}

const closed: SecureCraftState = {
  open: false,
  role: "none",
  slots: new Map(),
  payItems: new Map(),
  payKamas: 0,
  outcome: "none",
};

/**
 * A craft done for somebody else — exchange types 12 and 13.
 *
 * One store for both ends. The two windows differ only in what they let you
 * touch, and the server decides that anyway: the customer lays ingredients
 * and sets the payment, the artisan presses "Créer". Keeping one store means
 * the two views cannot disagree about what is on the bench.
 */
export const secureCraftStore = new ExternalStore<SecureCraftState>(closed);

export function openSecureCraft(role: SecureCraftRole): void {
  secureCraftStore.replaceState({
    ...closed,
    open: true,
    role,
    slots: new Map(),
    payItems: new Map(),
  });
}

export function closeSecureCraft(): void {
  if (secureCraftStore.getSnapshot().open) {
    secureCraftStore.replaceState(closed);
  }
}

/** `Er` — an ingredient moved on the bench. Absolute, like every offer. */
export function applyCoopItem(add: boolean, item: ItemData | undefined): void {
  applyTo("slots", add, item);
}

/** `Ep` — the payment pile changed. */
export function applyPayItem(add: boolean, item: ItemData | undefined): void {
  applyTo("payItems", add, item);
}

export function applyPayKamas(kamas: number): void {
  if (secureCraftStore.getSnapshot().open) {
    secureCraftStore.setState({ payKamas: kamas });
  }
}

/** `Ec` — the artisan's attempt. Both piles are cleared by the server. */
export function applySecureCraftResult(resultCode: string): void {
  if (!secureCraftStore.getSnapshot().open) {
    return;
  }

  secureCraftStore.setState({
    slots: new Map(),
    payItems: new Map(),
    payKamas: 0,
    outcome: resultCode === "S" ? "success" : "failure",
  });
}

function applyTo(
  pile: "slots" | "payItems",
  add: boolean,
  item: ItemData | undefined
): void {
  const state = secureCraftStore.getSnapshot();

  if (!state.open || !item) {
    return;
  }

  const next = new Map(state[pile]);

  if (add) {
    next.set(item.unicId, item);
  } else {
    next.delete(item.unicId);
  }

  secureCraftStore.setState({ [pile]: next, outcome: "none" });
}
