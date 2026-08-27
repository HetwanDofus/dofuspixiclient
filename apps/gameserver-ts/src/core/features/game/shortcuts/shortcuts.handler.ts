import type { ShortcutActionResult } from "@modules/shortcuts/shortcuts.service";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type InventoryShortcutAddRequest,
  InventoryShortcutAddRequestSchema,
  type InventoryShortcutMoveRequest,
  InventoryShortcutMoveRequestSchema,
  type InventoryShortcutRemoveRequest,
  InventoryShortcutRemoveRequestSchema,
} from "@dofus/proto/items_pb";
import { ShortcutsService } from "@modules/shortcuts/shortcuts.service";
import { Injectable, Logger } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * OrA / OrM / OrR — the item shortcuts of the hotbar.
 *
 * Every refusal is silent apart from a debug log, like `item-use`: the
 * 1.29 client has no error frame for these, and a failed drag simply
 * leaves the bar as it was.
 */
@Injectable()
export class ShortcutsHandler {
  private readonly logger = new Logger(ShortcutsHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly shortcuts: ShortcutsService
  ) {}

  @MessageHandler(InventoryShortcutAddRequestSchema)
  async handleAdd(
    ctx: HandlerContext,
    msg: InventoryShortcutAddRequest
  ): Promise<void> {
    const characterId = this.characterId(ctx);

    if (!characterId) {
      return;
    }

    this.log(
      "add",
      await this.shortcuts.add(
        ctx.sessionId,
        characterId,
        msg.position,
        msg.objectId
      )
    );
  }

  @MessageHandler(InventoryShortcutMoveRequestSchema)
  async handleMove(
    ctx: HandlerContext,
    msg: InventoryShortcutMoveRequest
  ): Promise<void> {
    const characterId = this.characterId(ctx);

    if (!characterId) {
      return;
    }

    this.log(
      "move",
      await this.shortcuts.move(
        ctx.sessionId,
        characterId,
        msg.oldPosition,
        msg.newPosition
      )
    );
  }

  @MessageHandler(InventoryShortcutRemoveRequestSchema)
  async handleRemove(
    ctx: HandlerContext,
    msg: InventoryShortcutRemoveRequest
  ): Promise<void> {
    const characterId = this.characterId(ctx);

    if (!characterId) {
      return;
    }

    this.log(
      "remove",
      await this.shortcuts.remove(ctx.sessionId, characterId, msg.position)
    );
  }

  private characterId(ctx: HandlerContext): string | undefined {
    return this.sessions.get(ctx.sessionId)?.characterId;
  }

  private log(action: string, result: ShortcutActionResult): void {
    if (!result.ok) {
      this.logger.debug(`shortcut ${action} refused: reason=${result.reason}`);
    }
  }
}
