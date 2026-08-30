import type {
  BigStoreListingLine,
  BigStoreOwnListing,
  ExchangeBigStoreParams,
} from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/**
 * Which half of the auction house is on screen.
 *
 * Two modes, not two tabs: 1.29 opens them as two different exchange
 * types (10 sell, 11 buy) and switching is a fresh request against the
 * same vendor, so the whole window is replaced rather than a panel being
 * swapped out.
 */
export type BigStoreMode = "buy" | "sell";

export interface BigStoreState {
  open: boolean;
  mode: BigStoreMode;
  /** The hall's own rules, from `EHK`. Null until it lands. */
  params: BigStoreParams | null;
  /** The category currently selected in the buy list. */
  typeId: number | null;
  /** The templates on sale in that category, in the server's order. */
  templateIds: number[];
  /** The template whose price grid is open. */
  templateId: number | null;
  /** The price grid itself. */
  lines: BigStoreListingLine[];
  /** `EHP`, per template. -1 means "never sold here". */
  middlePrices: Map<number, number>;
  /** Your own lots, in sell mode. */
  ownListings: Map<string, BigStoreOwnListing>;
  /** The row the buyer or the seller has picked, if any. */
  selectedLineId: string | null;
}

/** `ExchangeBigStoreParams`, with the numbers already widened. */
export interface BigStoreParams {
  lotSizes: number[];
  types: number[];
  /** Positional with `types` — what the category dropdown shows. */
  typeNames: string[];
  taxPercent: number;
  levelMax: number;
  maxItems: number;
  npcId: number;
  sellTimeHours: number;
}

const closed: BigStoreState = {
  open: false,
  mode: "buy",
  params: null,
  typeId: null,
  templateIds: [],
  templateId: null,
  lines: [],
  middlePrices: new Map(),
  ownListings: new Map(),
  selectedLineId: null,
};

export const bigStoreStore = new ExternalStore<BigStoreState>(closed);

/** `EC` for type 10 or 11. The parameters follow in `EHK`. */
export function openBigStore(mode: BigStoreMode): void {
  bigStoreStore.replaceState({
    ...closed,
    open: true,
    mode,
    middlePrices: new Map(),
    ownListings: new Map(),
  });
}

/** `EHK` — the hall's specialisation, tax, level cap and slot count. */
export function setBigStoreParams(params: ExchangeBigStoreParams): void {
  const state = bigStoreStore.getSnapshot();

  // A late frame must not reopen a window the player has closed — the
  // same guard every server-driven store here carries.
  if (!state.open) {
    return;
  }

  bigStoreStore.replaceState({
    ...state,
    params: {
      lotSizes: [...params.lotSizes],
      types: [...params.types],
      typeNames: [...params.typeNames],
      taxPercent: params.taxPercent,
      levelMax: params.levelMax,
      maxItems: params.maxItems,
      npcId: params.npcId,
      sellTimeHours: params.sellTimeHours,
    },
  });
}

/** `EHL` — the templates on sale in one category. */
export function setBigStoreTypeItems(
  typeId: number,
  templateIds: number[]
): void {
  const state = bigStoreStore.getSnapshot();

  if (!state.open) {
    return;
  }

  bigStoreStore.replaceState({
    ...state,
    typeId,
    templateIds,
    // Changing category invalidates the grid: it was showing a template
    // that is very probably not in this list.
    templateId: null,
    lines: [],
    selectedLineId: null,
  });
}

/** `EHM` — one template appeared in or vanished from the category. */
export function applyBigStoreTypeMovement(
  add: boolean,
  typeId: number,
  templateId: number
): void {
  const state = bigStoreStore.getSnapshot();

  if (!state.open || state.typeId !== typeId) {
    return;
  }

  const present = state.templateIds.includes(templateId);

  if (add === present) {
    return;
  }

  bigStoreStore.replaceState({
    ...state,
    templateIds: add
      ? [...state.templateIds, templateId]
      : state.templateIds.filter((id) => id !== templateId),
  });
}

/** `EHl` — the price grid for one template, replacing whatever was shown. */
export function setBigStoreLines(
  templateId: number,
  lines: BigStoreListingLine[]
): void {
  const state = bigStoreStore.getSnapshot();

  if (!state.open) {
    return;
  }

  bigStoreStore.replaceState({
    ...state,
    templateId,
    lines,
    selectedLineId: null,
  });
}

/** `EHP` — the average this template sells for here. */
export function setBigStoreMiddlePrice(
  templateId: number,
  price: number
): void {
  const state = bigStoreStore.getSnapshot();

  if (!state.open) {
    return;
  }

  const middlePrices = new Map(state.middlePrices);
  middlePrices.set(templateId, price);

  bigStoreStore.replaceState({ ...state, middlePrices });
}

/** `EHo` — every lot you have on sale here. */
export function setBigStoreOwnListings(listings: BigStoreOwnListing[]): void {
  const state = bigStoreStore.getSnapshot();

  if (!state.open) {
    return;
  }

  bigStoreStore.replaceState({
    ...state,
    ownListings: new Map(
      listings.map((listing) => [String(listing.lineId), listing])
    ),
  });
}

/** `EHO` — one of your lots appeared or went away. */
export function applyBigStoreOwnListing(
  add: boolean,
  lineId: string,
  listing?: BigStoreOwnListing
): void {
  const state = bigStoreStore.getSnapshot();

  if (!state.open) {
    return;
  }

  const ownListings = new Map(state.ownListings);

  if (add && listing) {
    ownListings.set(String(listing.lineId), listing);
  } else if (!add) {
    ownListings.delete(lineId);
  } else {
    return;
  }

  bigStoreStore.replaceState({
    ...state,
    ownListings,
    selectedLineId:
      !add && state.selectedLineId === lineId ? null : state.selectedLineId,
  });
}

/** The row the player has picked, in either mode. */
export function selectBigStoreLine(lineId: string | null): void {
  const state = bigStoreStore.getSnapshot();

  if (!state.open) {
    return;
  }

  bigStoreStore.replaceState({
    ...state,
    selectedLineId: state.selectedLineId === lineId ? null : lineId,
  });
}

/** `EV`. Idempotent — the server may send it unprompted. */
export function closeBigStore(): void {
  if (bigStoreStore.getSnapshot().open) {
    bigStoreStore.replaceState({
      ...closed,
      middlePrices: new Map(),
      ownListings: new Map(),
    });
  }
}

/** Your own lots, in a stable order. */
export function getOwnListings(state: BigStoreState): BigStoreOwnListing[] {
  return [...state.ownListings.values()];
}
