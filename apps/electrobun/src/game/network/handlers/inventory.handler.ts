import type { MessageHandler } from "@/game/network/message-handler";
import { InventoryStore } from "@/game/stores/inventory-store";

/**
 * Wires inventory proto messages into the InventoryStore.
 *
 * Proto → handler map:
 *   itemAdd        → handleItemAdd (OA)
 *   itemChange     → handleItemChange (OC)
 *   itemRemove     → handleItemRemove (OR)
 *   itemQuantity   → handleItemQuantity (OQ)
 *   itemMovement   → handleItemMovement (OM)
 *   itemWeight     → handleWeightUpdate (Ow)
 */
export class InventoryHandler {
  readonly store = new InventoryStore();

  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  private register(): void {
    this.messageHandler.on("itemAdd", (payload) =>
      this.store.handleItemAdd(payload)
    );
    this.messageHandler.on("itemChange", (payload) =>
      this.store.handleItemChange(payload)
    );
    this.messageHandler.on("itemRemove", (payload) =>
      this.store.handleItemRemove(payload)
    );
    this.messageHandler.on("itemQuantity", (payload) =>
      this.store.handleItemQuantity(payload)
    );
    this.messageHandler.on("itemMovement", (payload) =>
      this.store.handleItemMovement(payload)
    );
    this.messageHandler.on("itemWeight", (payload) =>
      this.store.handleWeightUpdate(payload)
    );
  }
}
