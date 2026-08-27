import { create } from "@bufbuild/protobuf";
import {
  InventoryShortcutAddSchema,
  InventoryShortcutRemoveSchema,
} from "@dofus/proto/items_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { ShortcutsRepository } from "@modules/shortcuts/shortcuts.repository";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * The `Or*` frames — telling a client which item shortcuts it owns.
 *
 * Split from the service the way `InventoryFramesService` is split from
 * `InventoryService`: one place builds every frame, so entering the
 * game, dropping a shortcut and clearing one all describe a slot the
 * same way.
 */
@Injectable()
export class ShortcutsFramesService {
  constructor(
    private readonly shortcuts: ShortcutsRepository,
    private readonly frames: GatewayFrameService
  ) {}

  /** OrA — a slot now holds this template. */
  sendAdd(sessionId: string, slot: number, templateId: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "inventoryShortcutAdd",
          value: create(InventoryShortcutAddSchema, {
            position: slot,
            objectId: templateId,
          }),
        },
      })
    );
  }

  /** OrR — a slot is now empty. */
  sendRemove(sessionId: string, slot: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "inventoryShortcutRemove",
          value: create(InventoryShortcutRemoveSchema, { position: slot }),
        },
      })
    );
  }

  /**
   * The whole bar, one OrA per occupied slot.
   *
   * Called on entering the game. 1.29 has no bulk shortcut frame — the
   * server replays the adds — and without this a shortcut placed in one
   * session is gone on the next login, which reads exactly like the
   * drag never saved.
   */
  async sendAll(sessionId: string, playerId: string): Promise<void> {
    const rows = await this.shortcuts.findByPlayer(playerId);

    for (const row of rows) {
      this.sendAdd(sessionId, row.slot, row.templateId);
    }
  }
}
