import type {
  CloseReason,
  ExchangeKind,
  ExchangeSession,
  OpenDenialReason,
} from "@modules/exchange/exchange.types";
import type { StorageMoveResult } from "@modules/exchange/storage.flow";
import type { TradeResult } from "@modules/exchange/trade.flow";
import type { ItemOwner } from "@modules/items/item-owner";
import { ExchangeType } from "@dofus/proto/common_pb";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { ExchangeSerializer } from "@modules/exchange/exchange.serializer";
import { StorageFlow } from "@modules/exchange/storage.flow";
import { TradeFlow } from "@modules/exchange/trade.flow";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { Injectable, Logger } from "@nestjs/common";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

export type OpenResult = { ok: true } | { ok: false; reason: OpenDenialReason };

export type MoveResult = StorageMoveResult | TradeResult;

/**
 * The way in and out of an exchange.
 *
 * Three responsibilities, and only three: decide whether a session may
 * enter one (the lock), make sure a session's operations do not overlap
 * (the queue), and hand the work to the flow for its kind. Everything
 * about *what* a particular exchange does lives in its flow, so a new
 * type is a new flow and a new entry point here, never a new subsystem.
 *
 * The queue is keyed on `session.lockKey`, not on the session id. A
 * storage locks alone and the two are the same string; both halves of a
 * trade carry the trade's id, so their operations run on **one** queue.
 * That is the whole of the "two sessions to lock together without
 * deadlocking" problem QA-107 flagged: there are not two locks to order.
 */
@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);

  constructor(
    private readonly registry: ExchangeRegistryService,
    private readonly serializer: ExchangeSerializer,
    private readonly frames: ExchangeFramesService,
    private readonly storage: StorageFlow,
    private readonly trade: TradeFlow,
    private readonly fights: FightRegistryService,
    private readonly sessions: SessionRegistry
  ) {}

  /**
   * Open a bank or a house chest.
   *
   * Pushed by the server, never requested: the 1.29 client has no code
   * path that sends `ER` for a storage — every `startExchange` call site
   * uses another type — so this is reached from the interactive object,
   * not from a client message.
   */
  async openStorage(
    sessionId: string,
    accountId: string,
    characterId: string,
    remote: ItemOwner,
    kind: ExchangeKind
  ): Promise<OpenResult> {
    const denial = this.claim(sessionId);

    if (denial) {
      this.frames.refuse(sessionId, denial);
      return { ok: false, reason: denial };
    }

    const session: ExchangeSession = {
      sessionId,
      characterId,
      accountId,
      kind,
      remote,
      // A storage is open the moment it exists and locks alone.
      phase: "open",
      lockKey: sessionId,
      openedAt: Date.now(),
    };

    this.registry.open(session);

    await this.serializer.runExclusive(session.lockKey, () =>
      this.storage.announceContents(session)
    );

    this.logger.log(
      `exchange: opened kind=${kind} session=${sessionId} character=${characterId}`
    );

    return { ok: true };
  }

  /**
   * `ER1` — propose a trade to another player.
   *
   * Not queued, and it does not need to be: `TradeFlow.request` is
   * synchronous from its first check to the moment both sessions are in
   * the registry, so a second `ER` from the same burst finds the lock
   * already taken rather than racing it.
   */
  requestTrade(sessionId: string, targetCharacterId: string): TradeResult {
    const denial = this.claim(sessionId);

    if (denial) {
      this.frames.refuseRequest(sessionId, denial);
      return { ok: false, reason: denial };
    }

    const session = this.sessions.get(sessionId);

    if (!session) {
      return { ok: false, reason: "not-in-world" };
    }

    const result = this.trade.request(session, targetCharacterId);

    if (!result.ok) {
      this.frames.refuseRequest(sessionId, result.reason);
    }

    return result;
  }

  /**
   * `ER` with `success: false`.
   *
   * Exposed because the slice refuses an exchange *type* it does not
   * serve before this service ever sees it, and the canonical client
   * leaves its waiting box up until something answers.
   */
  refuseRequest(sessionId: string, reason: string): void {
    this.frames.refuseRequest(sessionId, reason);
  }

  /** `EA` — accept a proposal. Only the target may. */
  accept(sessionId: string): Promise<TradeResult> {
    return this.onSession(sessionId, (session) =>
      Promise.resolve(this.trade.accept(session))
    );
  }

  /** `EK` — validate. The second one commits. */
  setReady(sessionId: string): Promise<TradeResult> {
    return this.onSession(sessionId, (session) => this.trade.setReady(session));
  }

  /**
   * `EMO`.
   *
   * `add` means "into the container" for a storage and "onto the table"
   * for a trade, and `quantity` is an amount to move in the first case
   * and the absolute size of an offer in the second. The two flows read
   * the same frame differently on purpose; see `TradeFlow.moveKamas`.
   */
  moveItem(
    sessionId: string,
    add: boolean,
    itemId: string,
    quantity: number
  ): Promise<MoveResult> {
    return this.onSession(sessionId, (session) =>
      session.kind === ExchangeType.EXCHANGE_PLAYER
        ? this.trade.moveItem(session, add, itemId, quantity)
        : this.storage.moveItem(session, add, itemId, quantity)
    );
  }

  /** `EMG`. Signed for a storage, absolute for a trade. */
  moveKamas(sessionId: string, amount: bigint): Promise<MoveResult> {
    return this.onSession(sessionId, (session) =>
      session.kind === ExchangeType.EXCHANGE_PLAYER
        ? this.trade.moveKamas(session, amount)
        : this.storage.moveKamas(session, amount)
    );
  }

  /**
   * Close an exchange.
   *
   * `EV` is idempotent on the client — canonical `onLeave` unloads every
   * exchange window regardless of which one was open — so it is always
   * safe to send, including on a close the client asked for itself.
   *
   * One player leaving a trade ends it for both. There is no such thing
   * as half an open trade, and leaving the other side's window up over a
   * partner who has gone is the failure QA-113 describes.
   */
  leave(sessionId: string, reason: CloseReason): void {
    const session = this.registry.get(sessionId);

    if (!session) {
      return;
    }

    const trade = session.tradeId ? this.trade.tradeOf(session) : undefined;

    if (trade) {
      // Closes both sessions and sends both `EV`s. A disconnected socket
      // is skipped by `TradeFlow.close` itself.
      this.trade.close(trade, false);
      this.serializer.forget(session.lockKey);
      this.logger.log(
        `exchange: closed trade=${trade.tradeId} reason=${reason}`
      );
      return;
    }

    this.registry.close(sessionId);
    this.serializer.forget(session.lockKey);

    if (reason !== "disconnected") {
      this.frames.leave(sessionId);
    }

    this.logger.log(`exchange: closed session=${sessionId} reason=${reason}`);
  }

  /**
   * Whether this session is pinned in place.
   *
   * True only for an **open** trade: canonical 1.29 will not send a
   * movement while the Exchange window is up, and two players walking
   * apart mid-deal is exactly what the same-map rule exists to prevent.
   * A pending proposal does not block — the yes/no box is not a window,
   * and the map is re-checked on accept.
   *
   * A storage returns false, which keeps the bank and the house chest
   * behaving exactly as they were shipped.
   */
  blocksMovement(sessionId: string): boolean {
    const session = this.registry.get(sessionId);

    return (
      session?.kind === ExchangeType.EXCHANGE_PLAYER && session.phase === "open"
    );
  }

  /**
   * Run `fn` on the session's queue, re-reading the session inside it.
   *
   * The re-read is not defensive padding: by the time a queued operation
   * runs, an earlier `EV` in the same burst may already have closed the
   * exchange out from under it.
   */
  private onSession<T extends { ok: boolean }>(
    sessionId: string,
    fn: (session: ExchangeSession) => Promise<T>
  ): Promise<T | { ok: false; reason: string }> {
    const known = this.registry.get(sessionId);

    if (!known) {
      return Promise.resolve({ ok: false as const, reason: "no-session" });
    }

    return this.serializer.runExclusive(known.lockKey, async () => {
      const session = this.registry.get(sessionId);

      if (!session) {
        return { ok: false as const, reason: "no-session" };
      }

      return await fn(session);
    });
  }

  /**
   * Whether `sessionId` may enter an exchange, and why not when it may
   * not.
   *
   * The one place occupancy is decided. Combat and NPC dialogue each
   * keep their own map today and consult nobody (QA-112); when they move
   * behind a shared lock, this is the method that grows, not every
   * caller.
   */
  private claim(sessionId: string): OpenDenialReason | null {
    if (this.registry.has(sessionId)) {
      return "already-exchanging";
    }

    if (this.fights.isInFight(sessionId)) {
      return "in-fight";
    }

    if (!this.sessions.get(sessionId)?.characterId) {
      return "not-in-world";
    }

    return null;
  }
}
