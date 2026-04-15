import { describe, expect, it, mock } from "bun:test";

import type { InventoryItem } from "@/game/network/protocol";

import { InventoryStore } from "./inventory-store";

function item(
  overrides: Partial<InventoryItem> & Pick<InventoryItem, "uid">
): InventoryItem {
  return {
    templateId: 100,
    quantity: 1,
    position: -1,
    effects: [],
    ...overrides,
  } as InventoryItem;
}

describe("InventoryStore", () => {
  describe("handleInventoryList", () => {
    it("replaces items, kamas, and weight", () => {
      const store = new InventoryStore();
      store.handleInventoryList({
        items: [item({ uid: 1 }), item({ uid: 2, quantity: 5 })],
        kamas: 1_000,
        weight: { current: 10, max: 100 },
      });

      expect(store.getItems()).toHaveLength(2);
      expect(store.kamas).toBe(1_000);
      expect(store.weight).toEqual({ current: 10, max: 100 });
    });

    it("clears previous items before loading new ones", () => {
      const store = new InventoryStore();
      store.handleInventoryList({
        items: [item({ uid: 1 })],
        kamas: 0,
        weight: { current: 0, max: 1 },
      });
      store.handleInventoryList({
        items: [item({ uid: 99 })],
        kamas: 0,
        weight: { current: 0, max: 1 },
      });
      expect(store.getItem(1)).toBeUndefined();
      expect(store.getItem(99)).toBeDefined();
    });
  });

  describe("filters", () => {
    it("splits bag vs equipped by position", () => {
      const store = new InventoryStore();
      store.handleInventoryList({
        items: [
          item({ uid: 1, position: -1 }),
          item({ uid: 2, position: 0 }),
          item({ uid: 3, position: 1 }),
        ],
        kamas: 0,
        weight: { current: 0, max: 1 },
      });
      expect(store.getBagItems().map((i) => i.uid)).toEqual([1]);
      expect(
        store
          .getEquippedItems()
          .map((i) => i.uid)
          .sort()
      ).toEqual([2, 3]);
    });

    it("getEquippedAt looks up by slot", () => {
      const store = new InventoryStore();
      store.handleInventoryList({
        items: [item({ uid: 7, position: 3 })],
        kamas: 0,
        weight: { current: 0, max: 1 },
      });
      expect(store.getEquippedAt(3)?.uid).toBe(7);
      expect(store.getEquippedAt(99)).toBeUndefined();
    });
  });

  describe("delta handlers", () => {
    it("handleItemAdd inserts and overwrites", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ uid: 1, quantity: 1 })] });
      store.handleItemAdd({ items: [item({ uid: 1, quantity: 3 })] });
      expect(store.getItem(1)?.quantity).toBe(3);
    });

    it("handleItemRemove deletes by uid", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ uid: 1 })] });
      store.handleItemRemove({ uid: 1 });
      expect(store.getItem(1)).toBeUndefined();
    });

    it("handleItemQuantity mutates existing item (no-op if missing)", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ uid: 1, quantity: 1 })] });
      store.handleItemQuantity({ uid: 1, quantity: 42 });
      expect(store.getItem(1)?.quantity).toBe(42);

      // Unknown uid silently no-ops
      store.handleItemQuantity({ uid: 999, quantity: 1 });
      expect(store.getItem(999)).toBeUndefined();
    });

    it("handleItemMove updates position", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ uid: 1, position: -1 })] });
      store.handleItemMove({ uid: 1, position: 2 });
      expect(store.getItem(1)?.position).toBe(2);
    });

    it("handleWeightUpdate replaces weight", () => {
      const store = new InventoryStore();
      store.handleWeightUpdate({ current: 50, max: 200 });
      expect(store.weight).toEqual({ current: 50, max: 200 });
    });
  });

  describe("listeners", () => {
    it("fires on every mutation", () => {
      const store = new InventoryStore();
      const listener = mock(() => {});
      store.onChange(listener);

      store.handleInventoryList({
        items: [],
        kamas: 0,
        weight: { current: 0, max: 1 },
      });
      store.handleItemAdd({ items: [item({ uid: 1 })] });
      store.handleItemRemove({ uid: 1 });
      store.handleWeightUpdate({ current: 1, max: 10 });
      store.clear();

      expect(listener).toHaveBeenCalledTimes(5);
    });

    it("unsubscribe stops further notifications", () => {
      const store = new InventoryStore();
      const listener = mock(() => {});
      const off = store.onChange(listener);

      store.clear();
      off();
      store.clear();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("clear", () => {
    it("resets items, kamas, and weight to defaults", () => {
      const store = new InventoryStore();
      store.handleInventoryList({
        items: [item({ uid: 1 })],
        kamas: 500,
        weight: { current: 50, max: 100 },
      });
      store.clear();

      expect(store.getItems()).toHaveLength(0);
      expect(store.kamas).toBe(0);
      expect(store.weight).toEqual({ current: 0, max: 1000 });
    });
  });
});
