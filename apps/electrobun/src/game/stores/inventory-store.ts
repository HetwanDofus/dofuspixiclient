import type {
  ItemAdd,
  ItemChange,
  ItemData,
  ItemMovement,
  ItemQuantity,
  ItemRemove,
  ItemTemplateData,
  ItemTemplates,
  ItemWeight,
} from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

export interface InventoryWeight {
  current: number;
  max: number;
}

export interface InventoryState {
  /** Keyed by `ItemData.unicId`, the per-instance id the server assigns. */
  items: Map<number, ItemData>;
  /**
   * Presentation for every template the player currently owns, keyed by
   * `ItemTemplateData.id`. Populated by the `ItemTemplates` frame
   * (`InventoryFramesService.sendTemplates`, server-side) rather than any
   * bundle the client loads itself — an `ItemData.item_id` on its own is
   * just a number until its template arrives here.
   */
  templates: Map<number, ItemTemplateData>;
  weight: InventoryWeight;
}

const initialState: InventoryState = {
  items: new Map(),
  templates: new Map(),
  weight: { current: 0, max: 1000 },
};

/**
 * Client-side inventory store: the current character's items and their
 * templates. Kamas live in `characterStore` instead — they arrive on the
 * `AccountStats` frame the same as every other character-sheet number, and
 * duplicating them here would give two answers to "how many kamas".
 *
 * `ExternalStore`, like every other store in this project, rather than the
 * previous hand-rolled class: `useSyncExternalStore` needs a `getSnapshot`
 * that returns a new reference when — and only when — something changed,
 * which is what `replaceState`/`setState` give for free.
 */
export const inventoryStore = new ExternalStore<InventoryState>(initialState);

/** Bag items (position === -1). */
export function getBagItems(state: InventoryState): ItemData[] {
  return Array.from(state.items.values()).filter((i) => i.position === -1);
}

/** Equipped items (position >= 0). */
export function getEquippedItems(state: InventoryState): ItemData[] {
  return Array.from(state.items.values()).filter((i) => i.position >= 0);
}

export function getEquippedAt(
  state: InventoryState,
  position: number
): ItemData | undefined {
  return Array.from(state.items.values()).find((i) => i.position === position);
}

export function getTemplate(
  state: InventoryState,
  templateId: number
): ItemTemplateData | undefined {
  return state.templates.get(templateId);
}

/** Replace/add every item in an `ItemAdd` frame (initial load, or a grant). */
export function handleItemAdd(payload: ItemAdd): void {
  const { items } = inventoryStore.getSnapshot();
  const next = new Map(items);
  for (const item of payload.items) {
    next.set(item.unicId, item);
  }
  inventoryStore.setState({ items: next });
}

export function handleItemChange(payload: ItemChange): void {
  const { items } = inventoryStore.getSnapshot();
  const next = new Map(items);
  for (const item of payload.items) {
    next.set(item.unicId, item);
  }
  inventoryStore.setState({ items: next });
}

export function handleItemRemove(payload: ItemRemove): void {
  const { items } = inventoryStore.getSnapshot();
  if (!items.has(payload.itemUnicId)) {
    return;
  }
  const next = new Map(items);
  next.delete(payload.itemUnicId);
  inventoryStore.setState({ items: next });
}

export function handleItemQuantity(payload: ItemQuantity): void {
  const { items } = inventoryStore.getSnapshot();
  const item = items.get(payload.itemUnicId);
  if (!item) {
    return;
  }
  const next = new Map(items);
  next.set(payload.itemUnicId, { ...item, quantity: payload.newQuantity });
  inventoryStore.setState({ items: next });
}

export function handleItemMovement(payload: ItemMovement): void {
  const { items } = inventoryStore.getSnapshot();
  const item = items.get(payload.itemUnicId);
  if (!item) {
    return;
  }
  const next = new Map(items);
  next.set(payload.itemUnicId, { ...item, position: payload.position });
  inventoryStore.setState({ items: next });
}

export function handleWeightUpdate(payload: ItemWeight): void {
  inventoryStore.setState({
    weight: { current: payload.currentWeight, max: payload.maxWeight },
  });
}

/** Merge in newly-described templates; never removes one already known. */
export function handleItemTemplates(payload: ItemTemplates): void {
  const { templates } = inventoryStore.getSnapshot();
  const next = new Map(templates);
  for (const template of payload.templates) {
    next.set(template.id, template);
  }
  inventoryStore.setState({ templates: next });
}

export function clearInventory(): void {
  inventoryStore.replaceState({
    items: new Map(),
    templates: new Map(),
    weight: { current: 0, max: 1000 },
  });
}
