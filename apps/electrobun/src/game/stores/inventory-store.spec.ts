import { beforeEach, describe, expect, it, mock } from "bun:test";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";

import {
  clearInventory,
  getBagItems,
  getEquippedAt,
  getEquippedItems,
  getTemplate,
  handleItemAdd,
  handleItemMovement,
  handleItemQuantity,
  handleItemRemove,
  handleItemTemplates,
  handleWeightUpdate,
  inventoryStore,
} from "./inventory-store";

/**
 * There is no bulk "here is your whole inventory" message: the server sends
 * the initial load as one `ItemAdd` carrying every item, then streams deltas
 * (`ItemChange`, `ItemRemove`, `ItemQuantity`, `ItemMovement`, `ItemWeight`).
 * Item presentation arrives separately, once, via `ItemTemplates`. The
 * store is keyed by `ItemData.unicId`.
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

function template(
  overrides: Partial<ItemTemplateData> & Pick<ItemTemplateData, "id">
): ItemTemplateData {
  return {
    name: "",
    description: "",
    typeId: 0,
    typeName: "",
    superType: 0,
    level: 1,
    weight: 0,
    gfxId: 0,
    usable: false,
    targetable: false,
    twoHanded: false,
    itemSetId: 0,
    positions: [],
    criteria: "",
    ...overrides,
  } as ItemTemplateData;
}

beforeEach(() => {
  clearInventory();
});

describe("inventory-store", () => {
  describe("handleItemAdd", () => {
    it("loads items into the store", () => {
      handleItemAdd({
        items: [item({ unicId: 1 }), item({ unicId: 2, quantity: 5 })],
        kamaReceived: 0n,
      } as never);

      expect(inventoryStore.getSnapshot().items.size).toBe(2);
    });

    it("overwrites an item already held under the same unicId", () => {
      handleItemAdd({ items: [item({ unicId: 1, quantity: 1 })] } as never);
      handleItemAdd({ items: [item({ unicId: 1, quantity: 3 })] } as never);

      const { items } = inventoryStore.getSnapshot();
      expect(items.size).toBe(1);
      expect(items.get(1)?.quantity).toBe(3);
    });

    it("clearInventory() drops everything before a fresh load", () => {
      handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      clearInventory();
      handleItemAdd({ items: [item({ unicId: 99 })] } as never);

      const { items } = inventoryStore.getSnapshot();
      expect(items.has(1)).toBe(false);
      expect(items.has(99)).toBe(true);
    });
  });

  describe("filters", () => {
    it("splits bag vs equipped by position", () => {
      handleItemAdd({
        items: [
          item({ unicId: 1, position: -1 }),
          item({ unicId: 2, position: 0 }),
          item({ unicId: 3, position: 1 }),
        ],
      } as never);
      const state = inventoryStore.getSnapshot();

      expect(getBagItems(state).map((i) => i.unicId)).toEqual([1]);
      expect(
        getEquippedItems(state)
          .map((i) => i.unicId)
          .sort()
      ).toEqual([2, 3]);
    });

    it("getEquippedAt looks up by slot", () => {
      handleItemAdd({ items: [item({ unicId: 7, position: 3 })] } as never);
      const state = inventoryStore.getSnapshot();

      expect(getEquippedAt(state, 3)?.unicId).toBe(7);
      expect(getEquippedAt(state, 99)).toBeUndefined();
    });
  });

  describe("delta handlers", () => {
    it("handleItemRemove deletes by unicId", () => {
      handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      handleItemRemove({ itemUnicId: 1 } as never);

      expect(inventoryStore.getSnapshot().items.has(1)).toBe(false);
    });

    it("handleItemQuantity replaces the item's quantity (no-op if missing)", () => {
      handleItemAdd({ items: [item({ unicId: 1, quantity: 1 })] } as never);
      handleItemQuantity({ itemUnicId: 1, newQuantity: 42 } as never);
      expect(inventoryStore.getSnapshot().items.get(1)?.quantity).toBe(42);

      // Unknown unicId silently no-ops
      handleItemQuantity({ itemUnicId: 999, newQuantity: 1 } as never);
      expect(inventoryStore.getSnapshot().items.has(999)).toBe(false);
    });

    it("handleItemMovement updates position", () => {
      handleItemAdd({ items: [item({ unicId: 1, position: -1 })] } as never);
      handleItemMovement({ itemUnicId: 1, position: 2 } as never);

      expect(inventoryStore.getSnapshot().items.get(1)?.position).toBe(2);
    });

    it("handleWeightUpdate replaces weight", () => {
      handleWeightUpdate({ currentWeight: 50, maxWeight: 200 } as never);

      expect(inventoryStore.getSnapshot().weight).toEqual({
        current: 50,
        max: 200,
      });
    });
  });

  describe("handleItemTemplates", () => {
    it("merges templates in, keyed by id", () => {
      handleItemTemplates({
        templates: [template({ id: 39, name: "Petite Amulette du Hibou" })],
      } as never);
      handleItemTemplates({
        templates: [template({ id: 1182, name: "Potion de Mini Soin" })],
      } as never);

      const state = inventoryStore.getSnapshot();
      expect(getTemplate(state, 39)?.name).toBe("Petite Amulette du Hibou");
      expect(getTemplate(state, 1182)?.name).toBe("Potion de Mini Soin");
    });

    it("never drops a template already known", () => {
      handleItemTemplates({
        templates: [template({ id: 1, name: "A" })],
      } as never);
      handleItemTemplates({ templates: [] } as never);

      expect(getTemplate(inventoryStore.getSnapshot(), 1)?.name).toBe("A");
    });
  });

  describe("listeners", () => {
    it("fires on every mutation", () => {
      const listener = mock(() => {});
      const unsubscribe = inventoryStore.subscribe(listener);

      handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      handleItemRemove({ itemUnicId: 1 } as never);
      handleWeightUpdate({ currentWeight: 1, maxWeight: 10 } as never);
      clearInventory();

      expect(listener).toHaveBeenCalledTimes(4);
      unsubscribe();
    });

    it("unsubscribe stops further notifications", () => {
      const listener = mock(() => {});
      const off = inventoryStore.subscribe(listener);

      clearInventory();
      off();
      clearInventory();

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("clearInventory", () => {
    it("resets items, templates and weight to defaults", () => {
      handleItemAdd({ items: [item({ unicId: 1 })] } as never);
      handleItemTemplates({ templates: [template({ id: 1 })] } as never);
      handleWeightUpdate({ currentWeight: 50, maxWeight: 100 } as never);
      clearInventory();

      const state = inventoryStore.getSnapshot();
      expect(state.items.size).toBe(0);
      expect(state.templates.size).toBe(0);
      expect(state.weight).toEqual({ current: 0, max: 1000 });
    });
  });
});
