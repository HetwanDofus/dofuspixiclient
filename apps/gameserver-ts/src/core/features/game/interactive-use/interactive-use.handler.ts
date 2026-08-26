import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type GameActionRequest,
  GameActionRequestSchema,
  GameActionType,
} from "@dofus/proto/game_pb";
import { InteractiveObjectsService } from "@modules/interactive-objects/interactive-objects.service";
import { Injectable, Logger } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

// GA;500 — "use the interactive element on this cell". `params` is the 1.29
// wire shape, `"<cellId>;<skillId>"`, the same way MoveHandler reads a path
// out of the same field. The router hands every GameActionRequest to every
// handler registered for it, so the action-type filter is the convention that
// keeps the slices apart.

@Injectable()
export class InteractiveUseHandler {
  private readonly logger = new Logger(InteractiveUseHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly objects: InteractiveObjectsService
  ) {}

  @MessageHandler(GameActionRequestSchema)
  async handle(ctx: HandlerContext, msg: GameActionRequest): Promise<void> {
    if (msg.actionType !== GameActionType.ACTION_INTERACTIVE_USE) {
      return;
    }

    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      return;
    }

    const parsed = parseParams(msg.params);

    if (!parsed) {
      this.logger.warn(
        `interactive-use: params "${msg.params}" malformed, expected "<cellId>;<skillId>"`
      );
      return;
    }

    await this.objects.use(
      ctx.sessionId,
      session.accountId,
      session.characterId,
      parsed.cellId,
      parsed.skillId
    );
  }
}

function parseParams(raw: string): { cellId: number; skillId: number } | null {
  const parts = raw.split(";");

  if (parts.length < 2) {
    return null;
  }

  const cellId = Number.parseInt((parts[0] ?? "").trim(), 10);
  const skillId = Number.parseInt((parts[1] ?? "").trim(), 10);

  return Number.isFinite(cellId) && Number.isFinite(skillId)
    ? { cellId, skillId }
    : null;
}
