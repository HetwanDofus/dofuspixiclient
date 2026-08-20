import { describe, expect, it, mock } from "bun:test";

import type { ItemData } from "@/game/network/protocol";

import { InventoryStore } from "./inventory-store";

/**
 * There is no bulk "here is your whole inventory" message: the server sends
 * the initial load as one `ItemAdd` carrying every item, then streams deltas
 * (`ItemChange`, `ItemRemove`, `ItemQuantity`, `ItemMovement`, `ItemWeight`).
 * The store is keyed by `ItemData.unicId`.
 */
function item(
  overrides: Partial<ItemData> & Pick<ItemData, "unicId">
): ItemData {
  return {
    itemId: 100,
    quantity: 1,
    position: -1,
    effects: [],
    effectsRaw: "",
    ...overrides,
  } as ItemData;
}

describe("InventoryStore", () => {
  describe("handleItemAdd", () => {
    it("loads items, and kamaReceived accumulates onto kamas", () => {
      const store = new InventoryStore();
      store.handleItemAdd({
        items: [item({ unicId: 1 }), item({ unicId: 2, quantity: 5 })],
        kamaReceived: 1_000n,
      } as never);

      expect(store.getItems()).toHaveLength(2);
      expect(store.kamas).toBe(1_000);
    });

    it("overwrites an item already held under the same unicId", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ unicId: 1, quantity: 1 })] } as never);
      store.handleItemAdd({ items: [item({ unicId: 1, quantity: 3 })] } as never);

      expect(store.getItems()).toHaveLength(1);
      expect(store.getItem(1)?.quantity).toBe(3);
    });

    it("clear() drops everything before a fresh load", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      store.clear();
      store.handleItemAdd({ items: [item({ unicId: 99 })] } as never);

      expect(store.getItem(1)).toBeUndefined();
      expect(store.getItem(99)).toBeDefined();
    });
  });

  describe("filters", () => {
    it("splits bag vs equipped by position", () => {
      const store = new InventoryStore();
      store.handleItemAdd({
        items: [
          item({ unicId: 1, position: -1 }),
          item({ unicId: 2, position: 0 }),
          item({ unicId: 3, position: 1 }),
        ],
      } as never);

      expect(store.getBagItems().map((i) => i.unicId)).toEqual([1]);
      expect(
        store
          .getEquippedItems()
          .map((i) => i.unicId)
          .sort()
      ).toEqual([2, 3]);
    });

    it("getEquippedAt looks up by slot", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ unicId: 7, position: 3 })] } as never);

      expect(store.getEquippedAt(3)?.unicId).toBe(7);
      expect(store.getEquippedAt(99)).toBeUndefined();
    });
  });

  describe("delta handlers", () => {
    it("handleItemRemove deletes by unicId", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      store.handleItemRemove({ itemUnicId: 1 } as never);

      expect(store.getItem(1)).toBeUndefined();
    });

    it("handleItemQuantity mutates existing item (no-op if missing)", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ unicId: 1, quantity: 1 })] } as never);
      store.handleItemQuantity({ itemUnicId: 1, newQuantity: 42 } as never);
      expect(store.getItem(1)?.quantity).toBe(42);

      // Unknown unicId silently no-ops
      store.handleItemQuantity({ itemUnicId: 999, newQuantity: 1 } as never);
      expect(store.getItem(999)).toBeUndefined();
    });

    it("handleItemMovement updates position", () => {
      const store = new InventoryStore();
      store.handleItemAdd({ items: [item({ unicId: 1, position: -1 })] } as never);
      store.handleItemMovement({ itemUnicId: 1, position: 2 } as never);

      expect(store.getItem(1)?.position).toBe(2);
    });

    it("handleWeightUpdate replaces weight", () => {
      const store = new InventoryStore();
      store.handleWeightUpdate({ currentWeight: 50, maxWeight: 200 } as never);

      expect(store.weight).toEqual({ current: 50, max: 200 });
    });
  });

  describe("listeners", () => {
    it("fires on every mutation", () => {
      const store = new InventoryStore();
      const listener = mock(() => {});
      store.onChange(listener);

      store.handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      store.handleItemRemove({ itemUnicId: 1 } as never);
      store.handleWeightUpdate({ currentWeight: 1, maxWeight: 10 } as never);
      store.setKamas(5);
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
      store.handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      store.setKamas(500);
      store.handleWeightUpdate({ currentWeight: 50, maxWeight: 100 } as never);
      store.clear();

      expect(store.getItems()).toHaveLength(0);
      expect(store.kamas).toBe(0);
      expect(store.weight).toEqual({ current: 0, max: 1000 });
    });
  });
});
