import type {
  InventoryItem,
  InventoryListPayload,
  InventoryWeightPayload,
  ItemAddPayload,
  ItemMovePayload,
  ItemQuantityPayload,
  ItemRemovePayload,
} from "@/network/protocol";
import { createLogger } from "@/utils/logger";

const log = createLogger("InventoryStore");

export type InventoryChangeListener = () => void;

/**
 * Client-side inventory store. Holds the current character's items,
 * kamas, and weight. Updated from server messages.
 */
export class InventoryStore {
  private items: Map<number, InventoryItem> = new Map();
  private _kamas = 0;
  private _weight: InventoryWeightPayload = { current: 0, max: 1000 };
  private listeners: InventoryChangeListener[] = [];

  // ── Accessors ──

  get kamas(): number {
    return this._kamas;
  }

  get weight(): InventoryWeightPayload {
    return this._weight;
  }

  /** All items as an array */
  getItems(): InventoryItem[] {
    return Array.from(this.items.values());
  }

  /** Get a single item by uid */
  getItem(uid: number): InventoryItem | undefined {
    return this.items.get(uid);
  }

  /** Items in the bag (not equipped) */
  getBagItems(): InventoryItem[] {
    return this.getItems().filter((i) => i.position === -1);
  }

  /** Items equipped (position >= 0) */
  getEquippedItems(): InventoryItem[] {
    return this.getItems().filter((i) => i.position >= 0);
  }

  /** Get item equipped in a specific slot */
  getEquippedAt(position: number): InventoryItem | undefined {
    return this.getItems().find((i) => i.position === position);
  }

  // ── Listeners ──

  onChange(listener: InventoryChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        log.error("Listener error:", e);
      }
    }
  }

  // ── Server message handlers ──

  handleInventoryList(payload: InventoryListPayload): void {
    this.items.clear();
    for (const item of payload.items) {
      this.items.set(item.uid, item);
    }
    this._kamas = payload.kamas;
    this._weight = payload.weight;
    log.info(`Inventory loaded: ${payload.items.length} items, ${payload.kamas} kamas`);
    this.notify();
  }

  handleItemAdd(payload: ItemAddPayload): void {
    for (const item of payload.items) {
      this.items.set(item.uid, item);
    }
    log.debug(`Items added: ${payload.items.length}`);
    this.notify();
  }

  handleItemRemove(payload: ItemRemovePayload): void {
    this.items.delete(payload.uid);
    log.debug(`Item removed: uid=${payload.uid}`);
    this.notify();
  }

  handleItemQuantity(payload: ItemQuantityPayload): void {
    const item = this.items.get(payload.uid);
    if (item) {
      item.quantity = payload.quantity;
      log.debug(`Item quantity: uid=${payload.uid} qty=${payload.quantity}`);
      this.notify();
    }
  }

  handleItemMove(payload: ItemMovePayload): void {
    const item = this.items.get(payload.uid);
    if (item) {
      item.position = payload.position;
      log.debug(`Item moved: uid=${payload.uid} pos=${payload.position}`);
      this.notify();
    }
  }

  handleWeightUpdate(payload: InventoryWeightPayload): void {
    this._weight = payload;
    this.notify();
  }

  /** Clear all state (on logout) */
  clear(): void {
    this.items.clear();
    this._kamas = 0;
    this._weight = { current: 0, max: 1000 };
    this.notify();
  }
}
