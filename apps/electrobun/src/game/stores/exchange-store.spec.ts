import { beforeEach, describe, expect, test } from "bun:test";

import type { ItemData } from "@/game/network/protocol";

import {
  applyExchangeItem,
  applyExchangeKamas,
  closeExchange,
  exchangeStore,
  getExchangeItems,
  openExchange,
  setExchangeContents,
} from "./exchange-store";

const STORAGE = 5;

function item(unicId: number, quantity: number): ItemData {
  return {
    itemId: 39,
    unicId,
    quantity,
    position: -1,
    effects: [],
    effectsRaw: "",
  } as unknown as ItemData;
}

describe("exchangeStore", () => {
  beforeEach(() => {
    closeExchange();
  });

  test("EC opens an empty window — the contents come with EL", () => {
    openExchange(STORAGE);

    const state = exchangeStore.getSnapshot();
    expect(state.open).toBe(true);
    expect(state.kind).toBe(STORAGE);
    expect(getExchangeItems(state)).toEqual([]);
  });

  test("EL replaces the whole contents", () => {
    openExchange(STORAGE);
    setExchangeContents([item(1, 3), item(2, 5)], 400);
    setExchangeContents([item(7, 1)], 900);

    const state = exchangeStore.getSnapshot();
    expect(getExchangeItems(state).map((i) => i.unicId)).toEqual([7]);
    expect(state.kamas).toBe(900);
  });

  test("an Es add carries the stack's absolute size, not a delta", () => {
    openExchange(STORAGE);
    setExchangeContents([item(1, 3)], 0);

    applyExchangeItem(true, item(1, 8));

    // 8, not 11. The server sends what the stack now is, because that is
    // what canonical `onStorageMovement` does with `updateItem`.
    expect(getExchangeItems(exchangeStore.getSnapshot())[0]?.quantity).toBe(8);
  });

  test("an Es add for an unknown id appends", () => {
    openExchange(STORAGE);
    setExchangeContents([], 0);

    applyExchangeItem(true, item(4, 2));

    expect(getExchangeItems(exchangeStore.getSnapshot())).toHaveLength(1);
  });

  test("an Es removal drops the stack", () => {
    openExchange(STORAGE);
    setExchangeContents([item(1, 3)], 0);

    applyExchangeItem(false, item(1, 3));

    expect(getExchangeItems(exchangeStore.getSnapshot())).toEqual([]);
  });

  test("EV clears everything", () => {
    openExchange(STORAGE);
    setExchangeContents([item(1, 3)], 500);

    closeExchange();

    const state = exchangeStore.getSnapshot();
    expect(state.open).toBe(false);
    expect(state.kamas).toBe(0);
    expect(getExchangeItems(state)).toEqual([]);
  });

  describe("frames that arrive after the window closed", () => {
    // The same guard `npc-dialog-store` needed: a straggling frame must
    // not resurrect a window the player has already dismissed.
    test("EL does not reopen it", () => {
      setExchangeContents([item(1, 3)], 500);
      expect(exchangeStore.getSnapshot().open).toBe(false);
    });

    test("Es does not reopen it", () => {
      applyExchangeItem(true, item(1, 3));
      applyExchangeKamas(700);

      const state = exchangeStore.getSnapshot();
      expect(state.open).toBe(false);
      expect(getExchangeItems(state)).toEqual([]);
    });
  });
});
