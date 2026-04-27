import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  ItemMovementSchema,
  type ItemMoveRequest,
  ItemMoveRequestSchema,
} from "@dofus/proto/items_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class ItemMoveHandler {
  constructor(
    private readonly sessions: SessionRegistry,
    private readonly inventory: InventoryRepository,
    private readonly stats: StatsService,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(ItemMoveRequestSchema)
  async handle(ctx: HandlerContext, msg: ItemMoveRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      return;
    }

    const item = await this.inventory.findById(String(msg.itemUnicId));

    if (!item || item.playerId !== session.characterId) {
      return;
    }

    const newPosition = msg.position;

    // If equipping (position >= 0), check if slot is occupied and unequip existing
    if (newPosition >= 0 && newPosition <= 15) {
      const equipped = await this.inventory.findEquipped(session.characterId);
      const existing = equipped.find(
        (e) => e.position === newPosition && e.id !== item.id
      );

      if (existing) {
        await this.inventory.moveItem(existing.id, -1);

        this.frames.broadcast(
          [ctx.sessionId],
          create(DofusMessageSchema, {
            payload: {
              case: "itemMovement",
              value: create(ItemMovementSchema, {
                itemUnicId: Number(existing.id),
                position: -1,
              }),
            },
          })
        );
      }
    }

    await this.inventory.moveItem(item.id, newPosition);

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemMovement",
          value: create(ItemMovementSchema, {
            itemUnicId: Number(item.id),
            position: newPosition,
          }),
        },
      })
    );

    await this.stats.sendStats(ctx.sessionId, session.characterId);
  }
}
