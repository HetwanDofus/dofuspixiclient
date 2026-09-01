import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { ExchangeType } from "@dofus/proto/common_pb";
import {
  type ExchangeAccept,
  ExchangeAcceptSchema,
  type ExchangeBigStoreBuyRequest,
  ExchangeBigStoreBuyRequestSchema,
  type ExchangeBigStoreItemListRequest,
  ExchangeBigStoreItemListRequestSchema,
  type ExchangeBigStoreSearchRequest,
  ExchangeBigStoreSearchRequestSchema,
  type ExchangeBigStoreTypeRequest,
  ExchangeBigStoreTypeRequestSchema,
  type ExchangeGetCrafterRequest,
  ExchangeGetCrafterRequestSchema,
  type ExchangeGetMiddlePrice,
  ExchangeGetMiddlePriceSchema,
  type ExchangeLeaveRequest,
  ExchangeLeaveRequestSchema,
  type ExchangeMoveItem,
  ExchangeMoveItemSchema,
  type ExchangeMoveKama,
  ExchangeMoveKamaSchema,
  type ExchangeMovePayItem,
  ExchangeMovePayItemSchema,
  type ExchangeMovePayKama,
  ExchangeMovePayKamaSchema,
  type ExchangeRepeatCraft,
  ExchangeRepeatCraftSchema,
  type ExchangeReplayCraft,
  ExchangeReplayCraftSchema,
  type ExchangeRequestSend,
  ExchangeRequestSendSchema,
  type ExchangeSetReady,
  ExchangeSetReadySchema,
  type ExchangeStopRepeatCraft,
  ExchangeStopRepeatCraftSchema,
} from "@dofus/proto/exchange_pb";
import { ExchangeService } from "@modules/exchange/exchange.service";
import { HdvService } from "@modules/exchange/hdv.service";
import { JobsService } from "@modules/jobs/jobs.service";
import { MapNpcService } from "@modules/npcs/map-npc.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
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
    private readonly presence: PlayerPresenceService,
    private readonly npcs: MapNpcService,
    private readonly halls: HdvService,
    private readonly exchange: ExchangeService,
    private readonly jobs: JobsService
  ) {}

  /**
   * `ER<type>|<id>` — ask to open an exchange.
   *
   * Types 1 (another player) and 10/11 (an auction house) are served.
   * An unknown type is refused rather than ignored: the canonical client
   * leaves its "En attente..." box up until something answers, so
   * silence would hang the window.
   */
  @MessageHandler(ExchangeRequestSendSchema)
  async request(ctx: HandlerContext, msg: ExchangeRequestSend): Promise<void> {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    if (
      msg.exchangeType === ExchangeType.EXCHANGE_BIGSTORE_SELL ||
      msg.exchangeType === ExchangeType.EXCHANGE_BIGSTORE_BUY
    ) {
      await this.openBigStore(ctx, msg);
      return;
    }

    if (
      msg.exchangeType === ExchangeType.EXCHANGE_SECURE_CRAFT_CLIENT ||
      msg.exchangeType === ExchangeType.EXCHANGE_SECURE_CRAFT_ARTISAN
    ) {
      // `cell_num` carries the craft skill. 1.29 describes it as an
      // optional cell number and no secure-craft request has ever needed
      // one, while the menu entry that sends this ("Inviter à Bûcheron")
      // does have to name a skill — reusing the spare field is cheaper
      // than a nineteenth exchange message.
      const result = await this.exchange.requestSecureCraft(
        ctx.sessionId,
        msg.targetId,
        msg.cellNum,
        msg.exchangeType === ExchangeType.EXCHANGE_SECURE_CRAFT_ARTISAN
      );

      if (!result.ok) {
        this.logger.debug(
          `ER${msg.exchangeType} refused (${result.reason}) ` +
            `session=${ctx.sessionId}`
        );
      }

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

  /**
   * The auction house of the map the player is standing on.
   *
   * Two checks, and they are different things: the **NPC** proves the
   * click was real — it is resolved against the player's own map, so a
   * client naming any id it likes resolves nothing — and the **map**
   * decides which hall opens, because `hdvs` is keyed by map and the
   * vendor is only the door.
   */
  private async openBigStore(
    ctx: HandlerContext,
    msg: ExchangeRequestSend
  ): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    const placed = session?.characterId
      ? this.presence.getByCharacter(session.characterId)
      : undefined;

    if (!session?.characterId || !placed) {
      this.exchange.refuseRequest(ctx.sessionId, "not-in-world");
      return;
    }

    const npc = this.npcs.onMapById(placed.mapId, Number(msg.targetId));

    if (!npc) {
      this.logger.warn(
        `ER${msg.exchangeType}: sprite ${msg.targetId} is not an NPC on ` +
          `map ${placed.mapId} session=${ctx.sessionId}`
      );
      this.exchange.refuseRequest(ctx.sessionId, "no-such-npc");
      return;
    }

    const hall = await this.halls.onMap(placed.mapId);

    if (!hall) {
      // The vendor is there and the hall is not: `hdv_templates` has no
      // row for this map, which means the world import has not run or
      // the dump does not describe this one.
      this.logger.warn(
        `ER${msg.exchangeType}: no auction house on map ${placed.mapId}`
      );
      this.exchange.refuseRequest(ctx.sessionId, "no-hall");
      return;
    }

    await this.exchange.openBigStore(
      ctx.sessionId,
      session.accountId,
      session.characterId,
      hall,
      msg.exchangeType,
      npc.id
    );
  }

  /** `EHT` — the templates on sale in one category. */
  @MessageHandler(ExchangeBigStoreTypeRequestSchema)
  async bigStoreType(
    ctx: HandlerContext,
    msg: ExchangeBigStoreTypeRequest
  ): Promise<void> {
    await this.exchange.browseBigStoreType(ctx.sessionId, msg.typeId);
  }

  /**
   * `EHl` — one template's price grid.
   *
   * `unic_id` is 1.29's name for it and it is a **template** id here:
   * `BigStoreBuy` builds its object list out of
   * `new Item(0, templateId, ...)`, whose second argument the original
   * calls `nUnicID`. The two names are the wrong way round in the
   * original; the field keeps its name and this comment carries the
   * meaning.
   */
  @MessageHandler(ExchangeBigStoreItemListRequestSchema)
  async bigStoreItemList(
    ctx: HandlerContext,
    msg: ExchangeBigStoreItemListRequest
  ): Promise<void> {
    await this.exchange.browseBigStoreTemplate(ctx.sessionId, msg.unicId);
  }

  /** `EHB` — buy one lot. */
  @MessageHandler(ExchangeBigStoreBuyRequestSchema)
  async bigStoreBuy(
    ctx: HandlerContext,
    msg: ExchangeBigStoreBuyRequest
  ): Promise<void> {
    const result = await this.exchange.buyBigStore(
      ctx.sessionId,
      String(msg.itemId),
      msg.quantityIndex,
      msg.price
    );

    if (!result.ok) {
      this.logger.debug(
        `EHB refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  /** `EHS` — the search box, which lands on the same price grid. */
  @MessageHandler(ExchangeBigStoreSearchRequestSchema)
  async bigStoreSearch(
    ctx: HandlerContext,
    msg: ExchangeBigStoreSearchRequest
  ): Promise<void> {
    await this.exchange.searchBigStore(ctx.sessionId, msg.unicId);
  }

  /** `EHP` — what one template has been selling for. */
  @MessageHandler(ExchangeGetMiddlePriceSchema)
  async bigStoreMiddlePrice(
    ctx: HandlerContext,
    msg: ExchangeGetMiddlePrice
  ): Promise<void> {
    await this.exchange.bigStoreMiddlePrice(ctx.sessionId, msg.itemId);
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
      msg.quantity,
      msg.price
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

  /**
   * `EMR<n>` — craft the same recipe up to `n` times.
   *
   * The whole series runs inside the session's own queue, so a stop arriving
   * mid-run is handled by `stopCraftSeries` outside it rather than queueing
   * behind the thing it is meant to interrupt.
   */
  @MessageHandler(ExchangeRepeatCraftSchema)
  async repeatCraft(
    ctx: HandlerContext,
    msg: ExchangeRepeatCraft
  ): Promise<void> {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    const result = await this.exchange.craftSeries(ctx.sessionId, msg.count);

    if (!result.ok) {
      this.logger.debug(
        `EMR refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  /** `EMr` — stop the running series. */
  @MessageHandler(ExchangeStopRepeatCraftSchema)
  stopRepeatCraft(ctx: HandlerContext, _msg: ExchangeStopRepeatCraft): void {
    this.exchange.stopCraftSeries(ctx.sessionId);
  }

  /** `EL` — "Créer" again with the same recipe. One more attempt. */
  @MessageHandler(ExchangeReplayCraftSchema)
  async replayCraft(
    ctx: HandlerContext,
    _msg: ExchangeReplayCraft
  ): Promise<void> {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    const result = await this.exchange.craftOnce(ctx.sessionId);

    if (!result.ok) {
      this.logger.debug(
        `EL refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  /** `EPO` — the customer offers an item in payment. */
  @MessageHandler(ExchangeMovePayItemSchema)
  async movePayItem(
    ctx: HandlerContext,
    msg: ExchangeMovePayItem
  ): Promise<void> {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    const result = await this.exchange.movePayItem(
      ctx.sessionId,
      msg.add,
      String(msg.itemId),
      msg.quantity
    );

    if (!result.ok) {
      this.logger.debug(
        `EPO refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  /** `EPG` — the same, in kamas. */
  @MessageHandler(ExchangeMovePayKamaSchema)
  async movePayKamas(
    ctx: HandlerContext,
    msg: ExchangeMovePayKama
  ): Promise<void> {
    if (!this.inWorld(ctx.sessionId)) {
      return;
    }

    const result = await this.exchange.movePayKamas(
      ctx.sessionId,
      msg.quantity
    );

    if (!result.ok) {
      this.logger.debug(
        `EPG refused (${result.reason}) session=${ctx.sessionId}`
      );
    }
  }

  /** `EJF<jobId>` — the craftsmen's book, for one job. */
  @MessageHandler(ExchangeGetCrafterRequestSchema)
  async crafterList(
    ctx: HandlerContext,
    msg: ExchangeGetCrafterRequest
  ): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      return;
    }

    await this.jobs.sendCrafterList(ctx.sessionId, msg.jobId);
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
