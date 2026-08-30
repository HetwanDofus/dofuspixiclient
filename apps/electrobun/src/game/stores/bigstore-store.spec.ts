import { beforeEach, describe, expect, test } from "bun:test";

import type {
  BigStoreListingLine,
  BigStoreOwnListing,
} from "@/game/network/protocol";

import {
  applyBigStoreOwnListing,
  applyBigStoreTypeMovement,
  bigStoreStore,
  closeBigStore,
  getOwnListings,
  openBigStore,
  selectBigStoreLine,
  setBigStoreLines,
  setBigStoreOwnListings,
  setBigStoreTypeItems,
} from "./bigstore-store";

function line(lineId: number, priceQty1: bigint): BigStoreListingLine {
  return {
    lineId: BigInt(lineId),
    templateId: 100,
    priceQty1,
    priceQty10: 0n,
    priceQty100: 0n,
  } as unknown as BigStoreListingLine;
}

function ownListing(lineId: number): BigStoreOwnListing {
  return {
    lineId: BigInt(lineId),
    lotSize: 10,
    price: 800n,
  } as unknown as BigStoreOwnListing;
}

beforeEach(() => {
  closeBigStore();
});

describe("opening and closing", () => {
  test("opens empty in the mode the server named", () => {
    openBigStore("sell");

    const state = bigStoreStore.getSnapshot();
    expect(state.open).toBe(true);
    expect(state.mode).toBe("sell");
    expect(state.lines).toEqual([]);
    expect(state.params).toBeNull();
  });

  test("closing is idempotent", () => {
    openBigStore("buy");
    closeBigStore();
    closeBigStore();

    expect(bigStoreStore.getSnapshot().open).toBe(false);
  });
});

describe("straggling frames", () => {
  // Every server-driven store here carries the same guard: a frame that
  // arrives after the player closed the window must not reopen it.
  test("a late price grid does not reopen a closed window", () => {
    setBigStoreLines(100, [line(1, 50n)]);

    expect(bigStoreStore.getSnapshot().open).toBe(false);
    expect(bigStoreStore.getSnapshot().lines).toEqual([]);
  });
});

describe("the category list", () => {
  test("changing category drops the grid it no longer describes", () => {
    openBigStore("buy");
    setBigStoreTypeItems(1, [100, 200]);
    setBigStoreLines(100, [line(1, 50n)]);
    setBigStoreTypeItems(9, [300]);

    const state = bigStoreStore.getSnapshot();
    expect(state.templateIds).toEqual([300]);
    expect(state.templateId).toBeNull();
    expect(state.lines).toEqual([]);
  });

  test("EHM only applies to the category on screen", () => {
    openBigStore("buy");
    setBigStoreTypeItems(1, [100]);
    applyBigStoreTypeMovement(true, 9, 300);

    expect(bigStoreStore.getSnapshot().templateIds).toEqual([100]);
  });

  test("EHM adds and removes a template", () => {
    openBigStore("buy");
    setBigStoreTypeItems(1, [100]);
    applyBigStoreTypeMovement(true, 1, 200);
    expect(bigStoreStore.getSnapshot().templateIds).toEqual([100, 200]);

    applyBigStoreTypeMovement(false, 1, 100);
    expect(bigStoreStore.getSnapshot().templateIds).toEqual([200]);
  });
});

describe("the price grid", () => {
  test("a replaced grid drops the selection with it", () => {
    openBigStore("buy");
    setBigStoreLines(100, [line(1, 50n)]);
    selectBigStoreLine("1");
    setBigStoreLines(100, [line(2, 80n)]);

    const state = bigStoreStore.getSnapshot();
    expect(state.lines).toHaveLength(1);
    expect(state.selectedLineId).toBeNull();
  });

  test("selecting the same row twice clears it", () => {
    openBigStore("buy");
    selectBigStoreLine("1");
    selectBigStoreLine("1");

    expect(bigStoreStore.getSnapshot().selectedLineId).toBeNull();
  });
});

describe("your own stock", () => {
  test("EHo replaces the whole list", () => {
    openBigStore("sell");
    setBigStoreOwnListings([ownListing(1), ownListing(2)]);

    expect(getOwnListings(bigStoreStore.getSnapshot())).toHaveLength(2);
  });

  test("EHO adds one and removes one", () => {
    openBigStore("sell");
    setBigStoreOwnListings([ownListing(1)]);
    applyBigStoreOwnListing(true, "2", ownListing(2));
    expect(getOwnListings(bigStoreStore.getSnapshot())).toHaveLength(2);

    applyBigStoreOwnListing(false, "1");
    const left = getOwnListings(bigStoreStore.getSnapshot());
    expect(left).toHaveLength(1);
    expect(String(left[0]?.lineId)).toBe("2");
  });
});
