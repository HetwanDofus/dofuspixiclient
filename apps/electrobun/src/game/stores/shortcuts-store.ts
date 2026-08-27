import type {
  InventoryShortcutAdd,
  InventoryShortcutRemove,
  ItemData,
  ItemTemplateData,
} from "@/game/network/protocol";
import type { InventoryState } from "@/game/stores/inventory-store";

import { ExternalStore } from "./game-store";

/** Cells in one page of the bar — two rows of seven, as in 1.29. */
export const HOTBAR_SLOTS_PER_PAGE = 14;

/**
 * Pages the bar scrolls through. 1.29 has no pagination — it has 14
 * cells plus a detachable `MovableContainerBar` for slots 15+ — so this
 * is our own affordance for the same 42 slots, and the reason the
 * server's `chk_slot_range` allows 1..42.
 */
export const HOTBAR_PAGES = 3;

export const MAX_HOTBAR_SLOT = HOTBAR_SLOTS_PER_PAGE * HOTBAR_PAGES;

/** The two exclusive modes of the bar (`MouseShortcuts.TAB_*`). */
export type HotbarTab = "spells" | "items";

export interface ShortcutsState {
  /** Slot (1-based) → item template id. Spell slots live in spellsStore. */
  items: Map<number, number>;
  tab: HotbarTab;
  /** 0-based page index. */
  page: number;
}

const initialState: ShortcutsState = {
  items: new Map(),
  tab: "spells",
  page: 0,
};

/**
 * The item half of the hotbar.
 *
 * A slot holds a *template* id, never a stack: that is what lets a
 * shortcut survive the potions it points at. 1.29's
 * `InventoryShortcutItem.findRealItem()` re-resolves the template
 * against the live inventory on every render, greying the cell out when
 * nothing matches — `resolveShortcut` below is that lookup.
 *
 * Which spell sits in which slot is *not* mirrored here: it is
 * `SpellEntry.position` in `spells-store`, kept in one place so the two
 * can never disagree.
 */
export const shortcutsStore = new ExternalStore<ShortcutsState>(initialState);

/** OrA — a slot now holds this template. */
export function handleShortcutAdd(payload: InventoryShortcutAdd): void {
  const { items } = shortcutsStore.getSnapshot();
  const next = new Map(items);
  next.set(payload.position, payload.objectId);
  shortcutsStore.setState({ items: next });
}

/** OrR — a slot is empty again. */
export function handleShortcutRemove(payload: InventoryShortcutRemove): void {
  const { items } = shortcutsStore.getSnapshot();

  if (!items.has(payload.position)) {
    return;
  }

  const next = new Map(items);
  next.delete(payload.position);
  shortcutsStore.setState({ items: next });
}

export function setHotbarTab(tab: HotbarTab): void {
  shortcutsStore.setState({ tab });
}

/** Flip between the two modes — the SWAP shortcut and the tab buttons. */
export function toggleHotbarTab(): void {
  const { tab } = shortcutsStore.getSnapshot();
  shortcutsStore.setState({ tab: tab === "spells" ? "items" : "spells" });
}

/** Move by ±1 page, clamped. */
export function stepHotbarPage(delta: number): void {
  const { page } = shortcutsStore.getSnapshot();
  const next = Math.min(HOTBAR_PAGES - 1, Math.max(0, page + delta));

  if (next !== page) {
    shortcutsStore.setState({ page: next });
  }
}

/** The 1-based slot behind cell `index` (0..13) of `page`. */
export function slotAt(page: number, index: number): number {
  return page * HOTBAR_SLOTS_PER_PAGE + index + 1;
}

export interface ResolvedShortcut {
  templateId: number;
  template: ItemTemplateData | undefined;
  /** The stack the shortcut currently resolves to, if the player owns one. */
  item: ItemData | undefined;
  /** Total owned across every stack of the template. */
  quantity: number;
  /**
   * Corner label: `"Eq"` when the resolved stack is worn, the quantity
   * when there is more than one, nothing otherwise
   * (`InventoryShortcutItem.get label`).
   */
  label: string | undefined;
  /** False when the player owns none — the cell greys out but stays. */
  active: boolean;
}

/**
 * Resolve one slot against the live inventory, the way
 * `InventoryShortcutItem.findRealItem()` does: scan for stacks of the
 * template and prefer an equipped one, so a shortcut to a worn item
 * reads `"Eq"` rather than pointing at a spare in the bag.
 */
export function resolveShortcut(
  shortcuts: ShortcutsState,
  inventory: InventoryState,
  slot: number
): ResolvedShortcut | undefined {
  const templateId = shortcuts.items.get(slot);

  if (templateId === undefined) {
    return undefined;
  }

  let item: ItemData | undefined;
  let quantity = 0;

  for (const candidate of inventory.items.values()) {
    if (candidate.itemId !== templateId) {
      continue;
    }

    quantity += candidate.quantity;

    if (!item || (candidate.position >= 0 && item.position < 0)) {
      item = candidate;
    }
  }

  const equipped = item !== undefined && item.position >= 0;

  return {
    templateId,
    template: inventory.templates.get(templateId),
    item,
    quantity,
    label: equipped ? "Eq" : quantity > 1 ? String(quantity) : undefined,
    active: item !== undefined,
  };
}
