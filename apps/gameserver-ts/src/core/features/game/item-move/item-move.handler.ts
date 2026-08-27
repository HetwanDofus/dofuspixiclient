import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type ItemMoveRequest,
  ItemMoveRequestSchema,
} from "@dofus/proto/items_pb";
import { InventoryService } from "@modules/inventory/inventory.service";
import { PlayerLookService } from "@modules/player-presence/player-presence.look.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * OM — equip or unequip one item. `position >= 0` is an equip attempt
 * (validated and possibly refused by `InventoryService.equip`);
 * `position < 0` unequips back to the bag.
 *
 * There is no per-slot bag position: `player_items.position` is `-1` for
 * the whole bag, not an index within it, so this handler has nothing to
 * do for a client-side reorder — the grid position React draws is purely
 * local state.
 */
@Injectable()
export class ItemMoveHandler {
  private readonly logger = new Logger(ItemMoveHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly inventoryService: InventoryService,
    private readonly stats: StatsService,
    private readonly look: PlayerLookService
  ) {}

  @MessageHandler(ItemMoveRequestSchema)
  async handle(ctx: HandlerContext, msg: ItemMoveRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const itemId = String(msg.itemUnicId);
    const result =
      msg.position < 0
        ? await this.inventoryService.unequip(
            ctx.sessionId,
            session.characterId,
            itemId
          )
        : await this.inventoryService.equip(
            ctx.sessionId,
            session.characterId,
            itemId,
            msg.position
          );

    if (!result.ok) {
      this.logger.debug(
        `item move refused: character=${session.characterId} item=${itemId} ` +
          `position=${msg.position} reason=${result.reason}`
      );
      return;
    }

    // Equipping/unequipping can move every number on the character sheet
    // (stats, life cap, carrying capacity) — `sendStats` is the one frame
    // that refreshes all of them together.
    await this.stats.sendStats(ctx.sessionId, session.characterId);

    // A worn hat/cape/weapon/shield/pet is part of what every other
    // client on the map draws, and nothing else ever refreshes it —
    // without this the change is only visible after a map change.
    // No-op for slots with no look (ring, amulet, belt, boots, dofus).
    await this.look.refresh(session.characterId);
  }
}
