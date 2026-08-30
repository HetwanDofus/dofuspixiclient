import { describe, expect, test } from "bun:test";

import type { ItemRow, ItemTemplateRow } from "@shared/db/schema";
import {
  type GroupableListing,
  groupListings,
  isLotSize,
  isUnitaryItem,
  listingTax,
  lotSizeAtIndex,
  parseCategories,
} from "@modules/exchange/big-store.pricing";

function stock(id: string, templateId = 100): ItemRow {
  return {
    id,
    ownerKind: 4,
    ownerId: id,
    templateId,
    position: -1,
    quantity: 1,
    effects: [],
    effectsHash: "hash",
  } as unknown as ItemRow;
}

function listing(id: string, lotSize: number, price: bigint): GroupableListing {
  return { id, templateId: 100, lotSize, price, item: stock(id) };
}

describe("listingTax", () => {
  // `BigStoreSell.calculateTax` is Math.max(1, Math.round(p * t / 100)).
  test("is a percentage of the lot price", () => {
    expect(listingTax(10_000n, 1)).toBe(100n);
    expect(listingTax(10_000n, 2.5)).toBe(250n);
  });

  test("never lets a sale be free", () => {
    // The screenshot: a lot priced at 40 in a 1% hall is taxed 1, not 0.
    expect(listingTax(40n, 1)).toBe(1n);
    expect(listingTax(1n, 1)).toBe(1n);
  });

  test("a tax-free hall really is free", () => {
    expect(listingTax(10_000n, 0)).toBe(0n);
  });
});

describe("lot sizes", () => {
  test("only 1, 10 and 100 exist", () => {
    expect(isLotSize(1)).toBe(true);
    expect(isLotSize(10)).toBe(true);
    expect(isLotSize(100)).toBe(true);
    expect(isLotSize(5)).toBe(false);
    expect(isLotSize(0)).toBe(false);
  });

  test("EHB names a lot by its 1-based position", () => {
    expect(lotSizeAtIndex(1)).toBe(1);
    expect(lotSizeAtIndex(2)).toBe(10);
    expect(lotSizeAtIndex(3)).toBe(100);
    expect(lotSizeAtIndex(0)).toBeUndefined();
    expect(lotSizeAtIndex(4)).toBeUndefined();
  });
});

describe("isUnitaryItem", () => {
  const template = (type: number) => ({ type }) as ItemTemplateRow;

  test("anything wearable is sold one at a time", () => {
    expect(isUnitaryItem(template(1), [1])).toBe(true);
  });

  test("a resource is not", () => {
    expect(isUnitaryItem(template(15), [])).toBe(false);
  });

  test("a filled soul stone is, despite not being wearable", () => {
    expect(isUnitaryItem(template(83), [])).toBe(true);
  });
});

describe("parseCategories", () => {
  test("reads the dump's own comma-separated list", () => {
    expect(parseCategories("1,9")).toEqual([1, 9]);
    expect(parseCategories("12, 14 ,26")).toEqual([12, 14, 26]);
  });

  test("an empty specialisation is an empty list, not a zero", () => {
    expect(parseCategories("")).toEqual([]);
  });
});

describe("groupListings — unitary items", () => {
  test("every exemplar is its own row, cheapest first", () => {
    const groups = groupListings(
      [listing("2", 1, 90_000n), listing("1", 1, 71_500n)],
      true
    );

    expect(groups.map((g) => g.lineId)).toEqual(["1", "2"]);
    expect(groups[0]?.prices).toEqual({ 1: 71_500n, 10: 0n, 100: 0n });
  });
});

describe("groupListings — generic items", () => {
  test("one row, cheapest price per lot size", () => {
    const groups = groupListings(
      [
        listing("1", 1, 80n),
        listing("2", 1, 50n),
        listing("3", 10, 800n),
        listing("4", 100, 9_000n),
      ],
      false
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.prices).toEqual({ 1: 50n, 10: 800n, 100: 9_000n });
  });

  test("a lot size nobody sells stays at zero — the client draws '-'", () => {
    const groups = groupListings([listing("1", 1, 50n)], false);

    expect(groups[0]?.prices).toEqual({ 1: 50n, 10: 0n, 100: 0n });
  });

  test("the row is named after its cheapest lot", () => {
    const groups = groupListings(
      [listing("1", 10, 800n), listing("2", 1, 50n)],
      false
    );

    expect(groups[0]?.lineId).toBe("2");
  });

  test("nothing on sale is no row at all", () => {
    expect(groupListings([], false)).toEqual([]);
    expect(groupListings([], true)).toEqual([]);
  });
});
