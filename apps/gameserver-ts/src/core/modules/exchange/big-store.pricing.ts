import type { ItemRow, ItemTemplateRow } from "@shared/db/schema";

/**
 * The rules of a 1.29 auction house that are pure arithmetic.
 *
 * Separated from the flow because every one of them is a decision a
 * reader will want to check against the retail client, and none of them
 * needs a database to be true.
 */

/**
 * The three lots, in the order the protocol indexes them.
 *
 * `EHB` names a lot by its **1-based position** in this list, not by its
 * size (`Exchange.as:110` sends `nQuantityIndex`; `BigStore.as` reads
 * `quantity1/2/3`), which is why the list travels on the wire in
 * `ExchangeBigStoreParams.lot_sizes` rather than being assumed at both
 * ends.
 */
export const LOT_SIZES = [1, 10, 100] as const;

export type LotSize = (typeof LOT_SIZES)[number];

export function isLotSize(value: number): value is LotSize {
  return (LOT_SIZES as readonly number[]).includes(value);
}

/** The lot a 1-based `EHB` index names, or `undefined` if out of range. */
export function lotSizeAtIndex(index: number): LotSize | undefined {
  return LOT_SIZES[index - 1];
}

/**
 * Whether this item is sold one at a time.
 *
 * Anything that can be worn has a jet of its own — two Boufbottes with
 * different rolls are two different objects and must never be offered as
 * an interchangeable lot of ten. `item_super_types.positions` is exactly
 * "where on the paperdoll this goes", so an empty list is the definition
 * of "not a distinct object", and it already covers weapons, pets and
 * every piece of gear without naming a single type id.
 *
 * Soul stones are the one exception the super-type cannot express: they
 * are used, not worn, but a filled one carries the monster it caught.
 * `dofus.datacenter.Item.isFullSoul` names the same three types.
 */
export const FULL_SOUL_TYPE_IDS: readonly number[] = [83, 84, 85];

export function isUnitaryItem(
  template: Pick<ItemTemplateRow, "type">,
  superTypePositions: readonly number[]
): boolean {
  return (
    superTypePositions.length > 0 || FULL_SOUL_TYPE_IDS.includes(template.type)
  );
}

/**
 * The listing tax, in kamas.
 *
 * `BigStoreSell.calculateTax` is `Math.max(1, Math.round(price * tax /
 * 100))`: a percentage, but never free. The client previews this number
 * live while the seller types a price, so the server must compute it the
 * same way to the kama or the confirmation and the debit disagree.
 */
export function listingTax(price: bigint, taxPercent: number): bigint {
  if (taxPercent <= 0) {
    return 0n;
  }

  const rounded = Math.round(Number(price) * (taxPercent / 100));

  return BigInt(Math.max(1, rounded));
}

/** `hdv_templates.categories` — "1,9" — as item type ids. */
export function parseCategories(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** One listing, reduced to what grouping needs. */
export interface GroupableListing {
  id: string;
  templateId: number;
  lotSize: number;
  price: bigint;
  item: ItemRow;
}

/** One row of the price grid: a group and its cheapest lot of each size. */
export interface ListingGroup {
  lineId: string;
  templateId: number;
  /** The exemplar the card opens on. */
  item: ItemRow;
  prices: { 1: bigint; 10: bigint; 100: bigint };
}

/**
 * Turn the lots on sale for one template into the rows the price grid
 * draws.
 *
 * Two shapes, and the choice between them is the whole of the 1/10/100
 * design:
 *
 *   - **unitary** — one row per exemplar, cheapest first, only the x1
 *     column filled. The buyer is choosing between *objects*.
 *   - **generic** — a single row for the template, each column showing
 *     the cheapest lot of that size. The buyer is choosing an *amount*,
 *     and the three prices may come from three different sellers.
 *
 * Sorted by ascending price in both cases, which is what the screenshot
 * shows and what makes "the cheapest" a well-defined thing to buy.
 */
export function groupListings(
  listings: readonly GroupableListing[],
  unitary: boolean
): ListingGroup[] {
  if (unitary) {
    return [...listings]
      .sort((a, b) => Number(a.price - b.price))
      .map((listing) => ({
        lineId: listing.id,
        templateId: listing.templateId,
        item: listing.item,
        prices: { 1: listing.price, 10: 0n, 100: 0n },
      }));
  }

  const prices = { 1: 0n, 10: 0n, 100: 0n };
  let cheapest: GroupableListing | undefined;

  for (const listing of listings) {
    if (!isLotSize(listing.lotSize)) {
      continue;
    }

    const current = prices[listing.lotSize];

    if (current === 0n || listing.price < current) {
      prices[listing.lotSize] = listing.price;
    }

    if (!cheapest || listing.price < cheapest.price) {
      cheapest = listing;
    }
  }

  // Every lot had an illegal size, or there were none: no row to draw.
  if (!cheapest) {
    return [];
  }

  // The group's id is the cheapest lot in it. Any of them would do —
  // `EHB` re-resolves the actual lot from the group, the amount and the
  // price — but a stable, meaningful choice makes a log line readable.
  return [
    {
      lineId: cheapest.id,
      templateId: cheapest.templateId,
      item: cheapest.item,
      prices,
    },
  ];
}
