import type { ItemData } from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/**
 * What kind of exchange is open. Mirrors `dofus.ExchangeType`; only the
 * storage form is implemented, and `null` means no window.
 */
export type ExchangeKind = number;

export interface ExchangeState {
  open: boolean;
  kind: ExchangeKind | null;
  /**
   * The container's contents, keyed by `ItemData.unicId` — the same key
   * the inventory store uses, so a stack that moves from one side of the
   * window to the other keeps its identity in both.
   */
  items: Map<number, ItemData>;
  /** The container's own kamas. The player's live in `characterStore`. */
  kamas: number;
}

const closed: ExchangeState = {
  open: false,
  kind: null,
  items: new Map(),
  kamas: 0,
};

export const exchangeStore = new ExternalStore<ExchangeState>(closed);

/**
 * `EC`. Opens an empty window: the contents arrive in the `EL` that the
 * server always sends straight after, never in this frame.
 */
export function openExchange(kind: ExchangeKind): void {
  exchangeStore.replaceState({ ...closed, open: true, kind, items: new Map() });
}

/** `EL` — the container's full contents, replacing whatever was shown. */
export function setExchangeContents(items: ItemData[], kamas: number): void {
  const state = exchangeStore.getSnapshot();

  // A late list must not reopen a window the player has already closed —
  // the same guard `npc-dialog-store` needed for a straggling question.
  if (!state.open) {
    return;
  }

  exchangeStore.replaceState({
    ...state,
    items: new Map(items.map((item) => [item.unicId, item])),
    kamas,
  });
}

/**
 * `Es` for an item.
 *
 * `add` is an **upsert** and `item.quantity` is the stack's absolute
 * size, not a delta: the server sends what the stack now is, so applying
 * it is a replace. A removal carries a meaningful id and nothing else.
 */
export function applyExchangeItem(add: boolean, item: ItemData): void {
  const state = exchangeStore.getSnapshot();

  if (!state.open) {
    return;
  }

  const items = new Map(state.items);

  if (add) {
    items.set(item.unicId, item);
  } else {
    items.delete(item.unicId);
  }

  exchangeStore.replaceState({ ...state, items });
}

/** `Es` for kamas. Absolute, like the item form. */
export function applyExchangeKamas(kamas: number): void {
  const state = exchangeStore.getSnapshot();

  if (!state.open) {
    return;
  }

  exchangeStore.replaceState({ ...state, kamas });
}

/** `EV`. Idempotent — the server may send it unprompted. */
export function closeExchange(): void {
  if (exchangeStore.getSnapshot().open) {
    exchangeStore.replaceState({ ...closed, items: new Map() });
  }
}

/** Everything currently in the container, in a stable order. */
export function getExchangeItems(state: ExchangeState): ItemData[] {
  return [...state.items.values()];
}
