import type { ItemData } from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/**
 * Where a player-to-player trade is.
 *
 *   - `awaiting-answer` — I proposed; a box says "En attente de la
 *     reponse de X" with a Cancel.
 *   - `asked` — somebody proposed to me; a box asks yes or no.
 *   - `open` — both said yes and the window is up.
 *
 * The two boxes are the same `ER` frame read from opposite ends:
 * canonical `onRequest` compares its own id with the initiator's to
 * decide which to show, which is why the server sends one frame to both.
 */
export type TradePhase = "idle" | "awaiting-answer" | "asked" | "open";

export interface TradeSideState {
  /**
   * What is on the table from this side, keyed by `ItemData.unicId` —
   * the same key the inventory store uses, so a stack keeps its identity
   * whichever grid it is drawn in.
   */
  items: Map<number, ItemData>;
  kamas: number;
  ready: boolean;
}

export interface TradeState {
  phase: TradePhase;
  /** The other player's sprite id, and the name to put on their pane. */
  partnerId: string;
  partnerName: string;
  mine: TradeSideState;
  theirs: TradeSideState;
  /**
   * When either offer last changed, in `performance.now()` terms.
   *
   * Canonical `ui/Exchange.as:40` disables the validate button for
   * `DELAY_BEFORE_VALIDATE = 3000` ms after **any** change to either
   * side. It is the client's whole anti-scam measure: it costs the
   * honest player three seconds and it costs the swapper their trick.
   */
  changedAt: number;
}

/** Canonical `DELAY_BEFORE_VALIDATE`. */
export const VALIDATE_DELAY_MS = 3000;

function emptySide(): TradeSideState {
  return { items: new Map(), kamas: 0, ready: false };
}

const closed: TradeState = {
  phase: "idle",
  partnerId: "",
  partnerName: "",
  mine: emptySide(),
  theirs: emptySide(),
  changedAt: 0,
};

export const tradeStore = new ExternalStore<TradeState>(closed);

function fresh(over: Partial<TradeState>): TradeState {
  return { ...closed, mine: emptySide(), theirs: emptySide(), ...over };
}

/**
 * `ER` — a proposal, from either end.
 *
 * `amInitiator` is what the frame lets each client work out for itself,
 * and it picks which of the two boxes appears.
 */
export function openTradeRequest(
  amInitiator: boolean,
  partnerId: string,
  partnerName: string
): void {
  tradeStore.replaceState(
    fresh({
      phase: amInitiator ? "awaiting-answer" : "asked",
      partnerId,
      partnerName,
    })
  );
}

/** `EC` of type 1 — both said yes. Both offers start empty. */
export function openTradeWindow(): void {
  const state = tradeStore.getSnapshot();

  // A straggling `EC` must not resurrect a trade the player has already
  // walked away from — the same guard `npc-dialog-store` needed.
  if (state.phase === "idle") {
    return;
  }

  tradeStore.replaceState(
    fresh({
      phase: "open",
      partnerId: state.partnerId,
      partnerName: state.partnerName,
      changedAt: now(),
    })
  );
}

/**
 * `EM` / `Em` for an item.
 *
 * `add` is an upsert and `item.quantity` is the **absolute** size of the
 * offer for that stack, not a delta; a removal carries a meaningful id
 * and nothing else. Same contract as `Es`.
 */
export function applyTradeItem(
  side: "mine" | "theirs",
  add: boolean,
  item: ItemData
): void {
  update(side, (s) => {
    const items = new Map(s.items);

    if (add) {
      items.set(item.unicId, item);
    } else {
      items.delete(item.unicId);
    }

    return { ...s, items };
  });
}

/** `EM` / `Em` for kamas. Absolute. */
export function applyTradeKamas(side: "mine" | "theirs", kamas: number): void {
  update(side, (s) => ({ ...s, kamas }));
}

/**
 * `EK` — one side's validation flag.
 *
 * Does **not** touch `changedAt`: a validation is not a change to an
 * offer, and restarting the three-second delay on it would make the
 * button impossible to press whenever both players clicked at once.
 */
export function applyTradeReady(side: "mine" | "theirs", ready: boolean): void {
  const state = tradeStore.getSnapshot();

  if (state.phase !== "open") {
    return;
  }

  tradeStore.replaceState({
    ...state,
    [side]: { ...state[side], ready },
  });
}

/** `EV`. Idempotent — the server may send it unprompted. */
export function closeTrade(): void {
  if (tradeStore.getSnapshot().phase !== "idle") {
    tradeStore.replaceState(fresh({}));
  }
}

/** Everything one side has put up, in a stable order. */
export function getTradeItems(side: TradeSideState): ItemData[] {
  return [...side.items.values()];
}

function update(
  side: "mine" | "theirs",
  fn: (s: TradeSideState) => TradeSideState
): void {
  const state = tradeStore.getSnapshot();

  if (state.phase !== "open") {
    return;
  }

  tradeStore.replaceState({
    ...state,
    [side]: fn(state[side]),
    changedAt: now(),
  });
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
