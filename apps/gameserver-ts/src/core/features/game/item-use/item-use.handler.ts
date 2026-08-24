import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type ItemUseRequest,
  ItemUseRequestSchema,
  type ItemUseSelfRequest,
  ItemUseSelfRequestSchema,
} from "@dofus/proto/items_pb";
import { InventoryService } from "@modules/inventory/inventory.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * OU / Ou — use a consumable. Both the targeted (`OU`, target sprite/cell
 * ignored — nothing this pass understands needs one) and self (`Ou`)
 * variants land on the same `InventoryService.use`, which only knows how
 * to apply an instant heal (effect 108); anything else is refused with
 * `no-supported-effect` and nothing is consumed.
 */
@Injectable()
export class ItemUseHandler {
  private readonly logger = new Logger(ItemUseHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly inventoryService: InventoryService,
    private readonly stats: StatsService
  ) {}

  @MessageHandler(ItemUseRequestSchema)
  async handleUse(ctx: HandlerContext, msg: ItemUseRequest): Promise<void> {
    await this.use(ctx, msg.itemUnicId);
  }

  @MessageHandler(ItemUseSelfRequestSchema)
  async handleUseSelf(
    ctx: HandlerContext,
    msg: ItemUseSelfRequest
  ): Promise<void> {
    await this.use(ctx, msg.itemUnicId);
  }

  private async use(ctx: HandlerContext, itemUnicId: number): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const itemId = String(itemUnicId);
    const result = await this.inventoryService.use(
      ctx.sessionId,
      session.characterId,
      itemId
    );

    if (!result.ok) {
      this.logger.debug(
        `item use refused: character=${session.characterId} item=${itemId} ` +
          `reason=${result.reason}`
      );
      return;
    }

    await this.stats.sendStats(ctx.sessionId, session.characterId);
  }
}
