import { beforeEach, describe, expect, it } from "bun:test";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import type { InventoryState } from "@/game/stores/inventory-store";

import {
  HOTBAR_PAGES,
  HOTBAR_SLOTS_PER_PAGE,
  handleShortcutAdd,
  handleShortcutRemove,
  resolveShortcut,
  shortcutsStore,
  slotAt,
  stepHotbarPage,
  toggleHotbarTab,
} from "./shortcuts-store";

const POTION = 1182;

function item(
  overrides: Partial<ItemData> & Pick<ItemData, "unicId">
): ItemData {
  return {
    itemId: POTION,
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
    name: "Potion de Mini Soin",
    description: "",
    typeId: 0,
    typeName: "",
    superType: 0,
    level: 1,
    weight: 0,
    gfxId: 0,
    usable: true,
    targetable: false,
    twoHanded: false,
    itemSetId: 0,
    positions: [],
    criteria: "",
    ...overrides,
  } as ItemTemplateData;
}

function inventory(items: ItemData[]): InventoryState {
  return {
    items: new Map(items.map((i) => [i.unicId, i])),
    templates: new Map([[POTION, template({ id: POTION })]]),
    weight: { current: 0, max: 1000 },
  };
}

beforeEach(() => {
  shortcutsStore.replaceState({
    items: new Map(),
    tab: "spells",
    page: 0,
  });
});

describe("shortcuts-store", () => {
  describe("OrA / OrR", () => {
    it("records the template a slot points at", () => {
      handleShortcutAdd({ position: 3, objectId: POTION } as never);

      expect(shortcutsStore.getSnapshot().items.get(3)).toBe(POTION);
    });

    it("clears the slot on OrR", () => {
      handleShortcutAdd({ position: 3, objectId: POTION } as never);
      handleShortcutRemove({ position: 3 } as never);

      expect(shortcutsStore.getSnapshot().items.has(3)).toBe(false);
    });

    it("ignores an OrR for a slot that was already empty", () => {
      const before = shortcutsStore.getSnapshot();

      handleShortcutRemove({ position: 3 } as never);

      // Same object identity — no useSyncExternalStore re-render for a
      // frame that changed nothing.
      expect(shortcutsStore.getSnapshot()).toBe(before);
    });
  });

  describe("resolveShortcut", () => {
    it("returns nothing for an empty slot", () => {
      const resolved = resolveShortcut(
        shortcutsStore.getSnapshot(),
        inventory([]),
        3
      );

      expect(resolved).toBeUndefined();
    });

    it("stays put when the player owns none of the template", () => {
      handleShortcutAdd({ position: 3, objectId: POTION } as never);

      const resolved = resolveShortcut(
        shortcutsStore.getSnapshot(),
        inventory([]),
        3
      );

      // The shortcut survives its stack — 1.29 greys the cell out
      // rather than dropping it.
      expect(resolved?.active).toBe(false);
      expect(resolved?.quantity).toBe(0);
      expect(resolved?.label).toBeUndefined();
      expect(resolved?.template?.name).toBe("Potion de Mini Soin");
    });

    it("labels a stack with its quantity", () => {
      handleShortcutAdd({ position: 3, objectId: POTION } as never);

      const resolved = resolveShortcut(
        shortcutsStore.getSnapshot(),
        inventory([item({ unicId: 10, quantity: 5 })]),
        3
      );

      expect(resolved?.active).toBe(true);
      expect(resolved?.quantity).toBe(5);
      expect(resolved?.label).toBe("5");
      expect(resolved?.item?.unicId).toBe(10);
    });

    it("leaves a lone item unlabelled", () => {
      handleShortcutAdd({ position: 3, objectId: POTION } as never);

      const resolved = resolveShortcut(
        shortcutsStore.getSnapshot(),
        inventory([item({ unicId: 10, quantity: 1 })]),
        3
      );

      expect(resolved?.label).toBeUndefined();
    });

    it("sums every stack of the template but prefers the equipped one", () => {
      handleShortcutAdd({ position: 3, objectId: POTION } as never);

      const resolved = resolveShortcut(
        shortcutsStore.getSnapshot(),
        inventory([
          item({ unicId: 10, quantity: 2 }),
          item({ unicId: 11, quantity: 1, position: 4 }),
        ]),
        3
      );

      expect(resolved?.quantity).toBe(3);
      expect(resolved?.item?.unicId).toBe(11);
      expect(resolved?.label).toBe("Eq");
    });

    it("ignores stacks of another template", () => {
      handleShortcutAdd({ position: 3, objectId: POTION } as never);

      const resolved = resolveShortcut(
        shortcutsStore.getSnapshot(),
        inventory([item({ unicId: 10, itemId: 289, quantity: 25 })]),
        3
      );

      expect(resolved?.active).toBe(false);
      expect(resolved?.quantity).toBe(0);
    });
  });

  describe("pages and tabs", () => {
    it("numbers slots 1-based, page by page", () => {
      expect(slotAt(0, 0)).toBe(1);
      expect(slotAt(0, HOTBAR_SLOTS_PER_PAGE - 1)).toBe(HOTBAR_SLOTS_PER_PAGE);
      expect(slotAt(1, 0)).toBe(HOTBAR_SLOTS_PER_PAGE + 1);
    });

    it("clamps paging at both ends", () => {
      stepHotbarPage(-1);
      expect(shortcutsStore.getSnapshot().page).toBe(0);

      for (let i = 0; i < HOTBAR_PAGES + 2; i++) {
        stepHotbarPage(1);
      }
      expect(shortcutsStore.getSnapshot().page).toBe(HOTBAR_PAGES - 1);
    });

    it("flips between the two exclusive modes", () => {
      toggleHotbarTab();
      expect(shortcutsStore.getSnapshot().tab).toBe("items");

      toggleHotbarTab();
      expect(shortcutsStore.getSnapshot().tab).toBe("spells");
    });
  });
});
