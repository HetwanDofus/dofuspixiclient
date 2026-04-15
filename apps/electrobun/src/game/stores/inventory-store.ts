import type {
  ItemAdd,
  ItemChange,
  ItemData,
  ItemMovement,
  ItemQuantity,
  ItemRemove,
  ItemWeight,
} from "@/game/network/protocol";
import { createLogger } from "@/utils/logger";

const log = createLogger("InventoryStore");

export type InventoryChangeListener = () => void;

export interface InventoryWeight {
  current: number;
  max: number;
}

/**
 * Client-side inventory store. Holds the current character's items,
 * kamas, and weight. Indexed by proto ItemData.unicId (the per-instance
 * unique id assigned by the server).
 */
export class InventoryStore {
  private items: Map<number, ItemData> = new Map();
  private _kamas = 0;
  private _weight: InventoryWeight = { current: 0, max: 1000 };
  private listeners: InventoryChangeListener[] = [];

  get kamas(): number {
    return this._kamas;
  }

  get weight(): InventoryWeight {
    return this._weight;
  }

  getItems(): ItemData[] {
    return Array.from(this.items.values());
  }

  getItem(unicId: number): ItemData | undefined {
    return this.items.get(unicId);
  }

  /** Bag items (position === -1). */
  getBagItems(): ItemData[] {
    return this.getItems().filter((i) => i.position === -1);
  }

  /** Equipped items (position >= 0). */
  getEquippedItems(): ItemData[] {
    return this.getItems().filter((i) => i.position >= 0);
  }

  getEquippedAt(position: number): ItemData | undefined {
    return this.getItems().find((i) => i.position === position);
  }

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

  /** Replace entire inventory (initial load via ItemAdd with many items). */
  handleItemAdd(payload: ItemAdd): void {
    for (const item of payload.items) {
      this.items.set(item.unicId, item);
    }
    if (payload.kamaReceived) {
      this._kamas += Number(payload.kamaReceived);
    }
    log.debug(`Items added: ${payload.items.length}`);
    this.notify();
  }

  handleItemChange(payload: ItemChange): void {
    for (const item of payload.items) {
      this.items.set(item.unicId, item);
    }
    log.debug(`Items changed: ${payload.items.length}`);
    this.notify();
  }

  handleItemRemove(payload: ItemRemove): void {
    this.items.delete(payload.itemUnicId);
    log.debug(`Item removed: unicId=${payload.itemUnicId}`);
    this.notify();
  }

  handleItemQuantity(payload: ItemQuantity): void {
    const item = this.items.get(payload.itemUnicId);
    if (item) {
      item.quantity = payload.newQuantity;
      this.notify();
    }
  }

  handleItemMovement(payload: ItemMovement): void {
    const item = this.items.get(payload.itemUnicId);
    if (item) {
      item.position = payload.position;
      this.notify();
    }
  }

  handleWeightUpdate(payload: ItemWeight): void {
    this._weight = { current: payload.currentWeight, max: payload.maxWeight };
    this.notify();
  }

  setKamas(kamas: number): void {
    this._kamas = kamas;
    this.notify();
  }

  clear(): void {
    this.items.clear();
    this._kamas = 0;
    this._weight = { current: 0, max: 1000 };
    this.notify();
  }
}
