import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { Injectable, Logger } from "@nestjs/common";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

/**
 * One player's half of a trade.
 *
 * `offer` is the whole reason this type exists rather than a pair of
 * `ExchangeSession`s: what a player has *put on the table* is not in the
 * database and must not be. Canonical 1.29 does the same on the client —
 * `Exchange.inventory` is a `deepClone()` of the bag and the offer is a
 * separate "garbage" array — and the server has the same reason to: an
 * offer is a proposal, and a proposal that moved rows would need undoing
 * every time someone changes their mind or walks away.
 *
 * Every field survives `JSON.stringify`, because this crosses a handoff.
 * `kamas` is a string for exactly that reason.
 */
export interface TradeSide {
  sessionId: string;
  characterId: string;
  name: string;
  /** itemId -> how many units of that stack are offered. */
  offer: Record<string, number>;
  /** A `bigint` in string form. Absolute, not a delta. */
  kamas: string;
  ready: boolean;
}

export interface TradeState {
  tradeId: string;
  /** Where it was struck. Re-checked on accept and again on commit. */
  mapId: number;
  initiator: TradeSide;
  target: TradeSide;
}

interface SerializedTrades {
  trades: TradeState[];
}

/**
 * The shared half of a player-to-player exchange.
 *
 * `ExchangeRegistryService` holds one session per socket — the occupancy
 * lock, the thing that answers "is this player busy?". It cannot hold a
 * trade, because a trade is one object owned by two sockets. So it lives
 * here, keyed by its own id, and each side's `ExchangeSession.tradeId`
 * points at it.
 *
 * Handoff-serialised, like the session registry and for a stronger
 * reason: since nothing is written to the database until both players
 * validate, a restored trade is safe by construction — there is no
 * half-finished write to reconcile, only two offers that are still just
 * proposals.
 */
@Injectable()
@HandoffPart()
export class TradeRegistryService implements Serializable<SerializedTrades> {
  readonly name = "exchange.trades";

  private readonly logger = new Logger(TradeRegistryService.name);
  private readonly byId = new Map<string, TradeState>();

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly exchanges: ExchangeRegistryService,
    private readonly frames: ExchangeFramesService
  ) {}

  get(tradeId: string): TradeState | undefined {
    return this.byId.get(tradeId);
  }

  open(trade: TradeState): void {
    this.byId.set(trade.tradeId, trade);
  }

  close(tradeId: string): TradeState | undefined {
    const trade = this.byId.get(tradeId);

    if (trade) {
      this.byId.delete(tradeId);
    }

    return trade;
  }

  all(): TradeState[] {
    return [...this.byId.values()];
  }

  /** The side `sessionId` is playing, and the one facing it. */
  sides(
    trade: TradeState,
    sessionId: string
  ): { mine: TradeSide; theirs: TradeSide } | undefined {
    if (trade.initiator.sessionId === sessionId) {
      return { mine: trade.initiator, theirs: trade.target };
    }

    if (trade.target.sessionId === sessionId) {
      return { mine: trade.target, theirs: trade.initiator };
    }

    return undefined;
  }

  serialize(): SerializedTrades {
    return { trades: this.all() };
  }

  restore(state: SerializedTrades): void {
    this.byId.clear();

    for (const trade of state.trades ?? []) {
      this.byId.set(trade.tradeId, trade);
    }

    this.logger.log(`restored ${this.byId.size} open trade(s)`);
  }

  /**
   * A trade needs *both* its sockets back, or it is not a trade.
   *
   * Deliberately asks `SessionRegistry` rather than
   * `ExchangeRegistryService`: every part's `restore` runs before any
   * part's `onResume`, but the `onResume`s themselves run in
   * registration order, so consulting another part's post-resume state
   * would make this depend on that order. The sockets are settled by
   * then; the sessions are not.
   *
   * The side that did come back is told explicitly. Leaving its window
   * open over nothing is the failure QA-113 describes, and the whole
   * point of serialising this part is not to reproduce it.
   */
  onResume(): void {
    let dropped = 0;

    for (const trade of this.all()) {
      const initiatorBack = Boolean(
        this.sessions.get(trade.initiator.sessionId)
      );
      const targetBack = Boolean(this.sessions.get(trade.target.sessionId));

      if (initiatorBack && targetBack) {
        continue;
      }

      this.byId.delete(trade.tradeId);
      dropped += 1;

      for (const side of [trade.initiator, trade.target]) {
        this.exchanges.close(side.sessionId);

        if (this.sessions.get(side.sessionId)) {
          this.frames.leave(side.sessionId, false);
        }
      }
    }

    this.logger.log(
      `${this.byId.size} trade(s) survived the restart, ${dropped} dropped`
    );
  }
}
