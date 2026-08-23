import type { PlayerItemRow } from "@shared/db/schema";
import { create } from "@bufbuild/protobuf";
import { ItemDataSchema, ItemEffectSchema } from "@dofus/proto/common_pb";
import { ItemAddSchema } from "@dofus/proto/items_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { parseItemEffects } from "@modules/inventory/item-effects";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * Telling a client about the items it owns.
 *
 * The client has had `itemAdd` bound to its inventory store from the
 * start; the server had simply never emitted a single `item*` frame,
 * because nothing had ever created an item. QA-060 opens that tap, so
 * this is where the frames are built — in one place, so loot, merchants,
 * exchanges and the bank all describe an item the same way.
 */
@Injectable()
export class InventoryFramesService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly frames: GatewayFrameService
  ) {}

  /** Announce one newly-created (or newly-grown) stack. */
  sendItemAdd(sessionId: string, item: PlayerItemRow): void {
    this.send(sessionId, [item]);
  }

  /**
   * Send the character's whole inventory.
   *
   * Called on entering the game: without it, an item looted in one
   * session is invisible in the next — it is in the database and
   * nowhere on screen, which reads exactly like the loot never worked.
   */
  async sendInventory(sessionId: string, playerId: string): Promise<void> {
    const items = await this.inventory.findByPlayer(playerId);

    if (items.length === 0) {
      return;
    }

    this.send(sessionId, items);
  }

  private send(sessionId: string, items: readonly PlayerItemRow[]): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemAdd",
          value: create(ItemAddSchema, {
            success: true,
            items: items.map((item) => toItemData(item)),
          }),
        },
      })
    );
  }
}

function toItemData(item: PlayerItemRow) {
  return create(ItemDataSchema, {
    itemId: item.templateId,
    // `player_items.id` is a bigserial and the 1.29 protocol carries the
    // instance id as a 32-bit value. Nothing in this project comes close
    // to overflowing it, but the narrowing is deliberate and belongs
    // here rather than being implied at a dozen call sites.
    unicId: Number(item.id),
    quantity: item.quantity,
    position: item.position,
    effects: parseItemEffects(item.effects).map((effect) =>
      create(ItemEffectSchema, {
        effectType: effect.id,
        param1: effect.param1,
        param2: effect.param2,
        param3: 0,
        param4: effect.param3,
      })
    ),
  });
}
