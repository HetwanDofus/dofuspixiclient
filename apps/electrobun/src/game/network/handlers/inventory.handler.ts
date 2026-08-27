import type { MessageHandler } from "@/game/network/message-handler";
import {
  handleItemAdd,
  handleItemChange,
  handleItemMovement,
  handleItemQuantity,
  handleItemRemove,
  handleItemTemplates,
  handleWeightUpdate,
} from "@/game/stores/inventory-store";
import {
  handleShortcutAdd,
  handleShortcutRemove,
} from "@/game/stores/shortcuts-store";

/**
 * Wires inventory proto messages into `inventoryStore`.
 *
 * Proto → handler map:
 *   itemAdd        → handleItemAdd (OA)
 *   itemChange     → handleItemChange (OC)
 *   itemRemove     → handleItemRemove (OR)
 *   itemQuantity   → handleItemQuantity (OQ)
 *   itemMovement   → handleItemMovement (OM)
 *   itemWeight     → handleWeightUpdate (Ow)
 *   itemTemplates  → handleItemTemplates (custom — see inventory-store.ts)
 *
 * Plus the item half of the hotbar, which rides the same `Or` family:
 *   inventoryShortcutAdd    → handleShortcutAdd (OrA)
 *   inventoryShortcutRemove → handleShortcutRemove (OrR)
 */
export class InventoryHandler {
  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  private register(): void {
    this.messageHandler.on("itemAdd", handleItemAdd);
    this.messageHandler.on("itemChange", handleItemChange);
    this.messageHandler.on("itemRemove", handleItemRemove);
    this.messageHandler.on("itemQuantity", handleItemQuantity);
    this.messageHandler.on("itemMovement", handleItemMovement);
    this.messageHandler.on("itemWeight", handleWeightUpdate);
    this.messageHandler.on("itemTemplates", handleItemTemplates);
    this.messageHandler.on("inventoryShortcutAdd", handleShortcutAdd);
    this.messageHandler.on("inventoryShortcutRemove", handleShortcutRemove);
  }
}
