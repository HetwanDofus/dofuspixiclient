import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { ExchangeType } from "@dofus/proto/common_pb";
import {
  type ExchangeAccept,
  ExchangeAcceptSchema,
  type ExchangeLeaveRequest,
  ExchangeLeaveRequestSchema,
  type ExchangeMoveItem,
  ExchangeMoveItemSchema,
  type ExchangeMoveKama,
  ExchangeMoveKamaSchema,
  type ExchangeRequestSend,
  ExchangeRequestSendSchema,
  type ExchangeSetReady,
  ExchangeSetReadySchema,
} from "@dofus/proto/exchange_pb";
import { ExchangeService } from "@modules/exchange/exchange.service";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * `ER` / `EA` / `EK` / `EMO` / `EMG` / `EV` — the client half of an
 * exchange.
 *
 * `ER` never arrives for a storage: the 1.29 client has no
 * `startExchange` call site that asks for one, and the bank is pushed by
 * the server from the interactive object it was opened on. It arrives
 * for a **trade**, which is why the handler routes on `exchange_type`
 * rather than assuming — the NPC shop (QA-106) adds a branch there and
 * nothing else.
 *
 * A refusal is otherwise silent, as everywhere else in this server: the
 * client simply does not see the move happen, and its own state is
 * unchanged because it only ever moves an item when the server says it
 * did.
 */
@Injectable()
export class ExchangeHandler {
  private readonly logger = new Logger(ExchangeHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly exchange: ExchangeService
  ) {}

  /**
   * `ER<type>|<id>` — ask to trade.
   *
   * Only type 1 is served. An unknown type is refused rather than
   * ignored: the canonical client leaves its "En attente..." box up
   * until something answers, so silence would hang the window.
   */
  @MessageHandler(ExchangeRequestSendSchema)
  request(ctx: HandlerContext, msg: ExchangeRequestSend): void {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    if (msg.exchangeType !== ExchangeType.EXCHANGE_PLAYER) {
      this.logger.debug(
        `ER type=${msg.exchangeType} not implemented session=${ctx.sessionId}`
      );
      this.exchange.refuseRequest(ctx.sessionId, "unsupported-type");
      return;
    }

    const result = this.exchange.requestTrade(ctx.sessionId, msg.targetId);

    if (!result.ok) {
      this.logger.debug(
        `ER refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  @MessageHandler(ExchangeAcceptSchema)
  async accept(ctx: HandlerContext, _msg: ExchangeAccept): Promise<void> {
    const result = await this.exchange.accept(ctx.sessionId);

    if (!result.ok) {
      this.logger.debug(
        `EA refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  @MessageHandler(ExchangeSetReadySchema)
  async setReady(ctx: HandlerContext, _msg: ExchangeSetReady): Promise<void> {
    const result = await this.exchange.setReady(ctx.sessionId);

    if (!result.ok) {
      this.logger.debug(
        `EK refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  @MessageHandler(ExchangeMoveItemSchema)
  async moveItem(ctx: HandlerContext, msg: ExchangeMoveItem): Promise<void> {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    const result = await this.exchange.moveItem(
      ctx.sessionId,
      msg.add,
      String(msg.itemUnicId),
      msg.quantity
    );

    if (!result.ok) {
      this.logger.debug(
        `EMO refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  @MessageHandler(ExchangeMoveKamaSchema)
  async moveKamas(ctx: HandlerContext, msg: ExchangeMoveKama): Promise<void> {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    const result = await this.exchange.moveKamas(ctx.sessionId, msg.quantity);

    if (!result.ok) {
      this.logger.debug(
        `EMG refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  @MessageHandler(ExchangeLeaveRequestSchema)
  leave(ctx: HandlerContext, _msg: ExchangeLeaveRequest): void {
    this.exchange.leave(ctx.sessionId, "left");
  }

  /**
   * A dropped socket has to release the exchange, or the occupancy lock
   * would refuse the player the window they are no longer in. Same
   * pattern as `NpcDialogHandler.onSessionClosed`: each subsystem cleans
   * up after itself rather than a central teardown knowing about all of
   * them.
   *
   * No `EV` goes out — there is nobody left to read it, and the client
   * clears its own exchange state on socket close anyway.
   */
  @OnEvent("session.closed")
  onSessionClosed({ session }: { session: { sessionId: string } }): void {
    this.exchange.leave(session.sessionId, "disconnected");
  }

  private inWorld(sessionId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.characterId);
  }
}
