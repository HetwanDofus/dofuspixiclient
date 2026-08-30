import { randomUUID } from "node:crypto";

import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { TradeSide, TradeState } from "@modules/exchange/trade.registry";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow } from "@shared/db/schema";
import { ExchangeType } from "@dofus/proto/common_pb";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { TradeRegistryService } from "@modules/exchange/trade.registry";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { playerOwner } from "@modules/items/item-owner";
import { ItemTransferService } from "@modules/items/item-transfer.service";
import { BAG_POSITION, ItemsRepository } from "@modules/items/items.repository";
import { KamasTransferService } from "@modules/items/kamas-transfer.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

export type TradeDenial =
  | "no-session"
  | "not-open"
  | "not-target"
  | "invalid-quantity"
  | "not-found"
  | "equipped"
  | "not-enough"
  | "commit-failed";

export type TradeResult = { ok: true } | { ok: false; reason: string };

/** The exchange this flow serves. */
const KIND = ExchangeType.EXCHANGE_PLAYER;

/**
 * Player to player — exchange type 1.
 *
 * The flow the socle was built for. Everything `StorageFlow` gets to
 * leave out, this one has: a second session to keep in step, an offer
 * that is a *proposal* rather than a movement, two validation flags, and
 * a commit that is all-or-nothing across two inventories and two purses.
 *
 * Three rules carry almost all of the correctness, and all three come
 * from the decompiled client rather than from taste:
 *
 *   1. **Nothing touches the database before both players validate.**
 *      An offer lives in `TradeRegistry` and nowhere else. Canonical
 *      1.29 does the same on its side — `Exchange.inventory` is a
 *      `deepClone()` and the offer is a separate array — and it means a
 *      cancelled trade needs no undo, only a forgotten map entry.
 *   2. **Any change to either offer clears both validations.** The
 *      client will not do it: `updateLocalData` / `updateDistantData`
 *      touch the button and never the flags (`ui/Exchange.as:230-240`).
 *      Without this rule a player validates, the other adds a rock and
 *      removes a sword, and the deal closes on an offer nobody agreed
 *      to. This is *the* scam the two-sided protocol exists to prevent.
 *   3. **The commit is one transaction, and any refusal inside it
 *      throws.** `ItemTransferService` reports a unique-index collision
 *      as `{ ok: false, reason: "conflict" }`, but by then Postgres has
 *      already aborted the transaction: testing the flag and carrying on
 *      would run the rest of the trade against a dead handle. A refusal
 *      here is fatal by construction, which is also what it should be —
 *      half a trade is worse than none.
 *
 * Both sides share one `ExchangeSerializer` queue (see
 * `ExchangeSession.lockKey`), so nothing in here has to reason about two
 * sessions acting at once: they cannot.
 */
@Injectable()
export class TradeFlow {
  private readonly logger = new Logger(TradeFlow.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly trades: TradeRegistryService,
    private readonly exchanges: ExchangeRegistryService,
    private readonly frames: ExchangeFramesService,
    private readonly presence: PlayerPresenceService,
    private readonly sessions: SessionRegistry,
    private readonly fights: FightRegistryService,
    private readonly items: ItemsRepository,
    private readonly transfers: ItemTransferService,
    private readonly kamas: KamasTransferService,
    private readonly players: PlayersRepository,
    private readonly inventory: InventoryFramesService,
    private readonly stats: StatsService
  ) {}

  /**
   * `ER1|<target>` — propose a trade.
   *
   * Both players get an `ExchangeSession` immediately, in `"pending"`.
   * That is what makes a proposal *occupy* them: a third player asking
   * either one now gets the same refusal as if the window were already
   * open, which is what the canonical client answers with `EREO`.
   */
  request(
    session: { sessionId: string; accountId: string; characterId: string },
    targetCharacterId: string
  ): TradeResult {
    if (targetCharacterId === session.characterId) {
      return { ok: false, reason: "self" };
    }

    const me = this.presence.getByCharacter(session.characterId);
    const them = this.presence.getByCharacter(targetCharacterId);

    if (!me) {
      return { ok: false, reason: "not-in-world" };
    }

    if (!them) {
      return { ok: false, reason: "target-not-found" };
    }

    // The map, not the distance. Nothing else in this server checks
    // adjacency outside a fight (QA-114) and inventing the rule here
    // would make trading stricter than talking to a banker.
    if (me.mapId !== them.mapId) {
      return { ok: false, reason: "different-map" };
    }

    if (
      this.exchanges.has(them.sessionId) ||
      this.fights.isInFight(them.sessionId)
    ) {
      return { ok: false, reason: "target-busy" };
    }

    const tradeId = randomUUID();

    this.trades.open({
      tradeId,
      mapId: me.mapId,
      initiator: side(session.sessionId, session.characterId, me.name),
      target: side(them.sessionId, targetCharacterId, them.name),
    });

    for (const [sessionId, characterId, accountId] of [
      [session.sessionId, session.characterId, session.accountId],
      [them.sessionId, targetCharacterId, this.accountOf(them.sessionId)],
    ] as const) {
      this.exchanges.open({
        sessionId,
        characterId,
        accountId,
        kind: KIND,
        remote: playerOwner(
          characterId === session.characterId
            ? targetCharacterId
            : session.characterId
        ),
        phase: "pending",
        // The shared key. This single line is what stops A's `EK` from
        // interleaving with B's `EMO`.
        lockKey: tradeId,
        tradeId,
        openedAt: Date.now(),
      });
    }

    this.frames.request(
      [session.sessionId, them.sessionId],
      { id: session.characterId, name: me.name },
      { id: targetCharacterId, name: them.name },
      KIND
    );

    this.logger.log(
      `trade ${tradeId}: ${session.characterId} -> ${targetCharacterId}`
    );

    return { ok: true };
  }

  /**
   * `EA` — the target says yes.
   *
   * Everything checked at request time is checked again: a proposal can
   * sit on screen for as long as the target likes, and walking away or
   * being dragged into a fight in the meantime is entirely ordinary.
   */
  accept(session: ExchangeSession): TradeResult {
    const trade = this.tradeOf(session);

    if (!trade) {
      return { ok: false, reason: "no-session" };
    }

    if (trade.target.sessionId !== session.sessionId) {
      // The initiator cannot accept their own proposal.
      return { ok: false, reason: "not-target" };
    }

    const denial = this.stillValid(trade);

    if (denial) {
      this.close(trade, false);
      return { ok: false, reason: denial };
    }

    for (const s of this.bothSessions(trade)) {
      const open = this.exchanges.get(s);

      if (open) {
        open.phase = "open";
      }
    }

    // `EC` alone — no `EL`. See `ExchangeFramesService.openTrade`.
    this.frames.openTrade(this.bothSessions(trade), KIND);

    return { ok: true };
  }

  /**
   * `EMO` — put a stack on the table, or take it back.
   *
   * `quantity` is the **absolute** size of the offer for that stack, not
   * an increment: canonical `modifyLocal` replaces the entry it finds.
   * `add = false` removes the line whatever it held.
   */
  async moveItem(
    session: ExchangeSession,
    add: boolean,
    itemId: string,
    quantity: number
  ): Promise<TradeResult> {
    const trade = this.tradeOf(session);
    const sides = trade && this.trades.sides(trade, session.sessionId);

    if (!trade || !sides) {
      return { ok: false, reason: "no-session" };
    }

    if (session.phase !== "open") {
      return { ok: false, reason: "not-open" };
    }

    const stack = await this.items.findOwned(
      playerOwner(session.characterId),
      itemId
    );

    if (!stack) {
      return { ok: false, reason: "not-found" };
    }

    if (stack.position !== BAG_POSITION) {
      return { ok: false, reason: "equipped" };
    }

    if (!add) {
      delete sides.mine.offer[itemId];
    } else {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return { ok: false, reason: "invalid-quantity" };
      }

      if (quantity > stack.quantity) {
        return { ok: false, reason: "not-enough" };
      }

      sides.mine.offer[itemId] = quantity;
    }

    this.frames.offerItem(sides.mine.sessionId, sides.theirs.sessionId, add, {
      ...stack,
      quantity: add ? quantity : stack.quantity,
    });

    // The watcher has never been told what this template *is* — templates
    // are sent once, on entering the game, for what that character owns.
    // Without this an object the partner offers draws as an empty cell.
    if (add) {
      await this.inventory.sendTemplateFor(
        sides.theirs.sessionId,
        stack.templateId
      );
    }

    this.unready(trade);

    return { ok: true };
  }

  /**
   * `EMG` — how many kamas are on the table.
   *
   * **Absolute, and this is where a trade parts company with a
   * storage.** `StorageFlow.moveKamas` reads the sign as a direction
   * (deposit / withdraw) because a chest transfer commits on the spot;
   * here the value simply *is* the offer, and the canonical client
   * agrees — `askKamaQuantity` seeds its popup with the current
   * `localKama` and `validateKama` clamps to the purse. One message,
   * two flows, two meanings.
   */
  async moveKamas(
    session: ExchangeSession,
    amount: bigint
  ): Promise<TradeResult> {
    const trade = this.tradeOf(session);
    const sides = trade && this.trades.sides(trade, session.sessionId);

    if (!trade || !sides) {
      return { ok: false, reason: "no-session" };
    }

    if (session.phase !== "open") {
      return { ok: false, reason: "not-open" };
    }

    if (amount < 0n) {
      return { ok: false, reason: "invalid-amount" };
    }

    const purse = BigInt(
      (await this.players.findById(session.characterId))?.kamas ?? 0
    );
    // Clamped rather than refused, like the client's own `validateKama`:
    // offering "everything" is a normal thing to ask for and the purse
    // is what it is. The commit re-reads it anyway.
    const offered = amount > purse ? purse : amount;

    sides.mine.kamas = offered.toString();

    this.frames.offerKamas(
      sides.mine.sessionId,
      sides.theirs.sessionId,
      offered
    );

    this.unready(trade);

    return { ok: true };
  }

  /**
   * `EK` — toggle this player's validation, and commit when both hold.
   */
  async setReady(session: ExchangeSession): Promise<TradeResult> {
    const trade = this.tradeOf(session);
    const sides = trade && this.trades.sides(trade, session.sessionId);

    if (!trade || !sides) {
      return { ok: false, reason: "no-session" };
    }

    if (session.phase !== "open") {
      return { ok: false, reason: "not-open" };
    }

    sides.mine.ready = !sides.mine.ready;

    this.frames.ready(
      this.bothSessions(trade),
      sides.mine.characterId,
      sides.mine.ready
    );

    if (!(trade.initiator.ready && trade.target.ready)) {
      return { ok: true };
    }

    return await this.commit(trade);
  }

  /** `EV`, a dropped socket, or any interruption. */
  close(trade: TradeState, completed: boolean): void {
    this.trades.close(trade.tradeId);

    for (const sessionId of this.bothSessions(trade)) {
      this.exchanges.close(sessionId);

      if (this.sessions.get(sessionId)) {
        this.frames.leave(sessionId, completed);
      }
    }
  }

  /** The trade behind a session, if it still exists. */
  tradeOf(session: ExchangeSession): TradeState | undefined {
    return session.tradeId ? this.trades.get(session.tradeId) : undefined;
  }

  /**
   * Hand everything over, both ways, or nothing.
   *
   * The offers are confronted with the database here for the first time
   * since they were made — a stack can have been sold, equipped or
   * eaten in the meantime — and every refusal throws, because a refusal
   * inside this transaction has already killed it (see the class note).
   */
  private async commit(trade: TradeState): Promise<TradeResult> {
    const denial = this.stillValid(trade);

    if (denial) {
      this.close(trade, false);
      return { ok: false, reason: denial };
    }

    const moved: {
      to: TradeSide;
      from: TradeSide;
      source: ItemRow;
      destination: ItemRow;
      remaining: number;
    }[] = [];

    try {
      await this.txHost.withTransaction(async () => {
        moved.length = 0;

        for (const [from, to] of [
          [trade.initiator, trade.target],
          [trade.target, trade.initiator],
        ] as const) {
          for (const [itemId, quantity] of Object.entries(from.offer)) {
            const result = await this.transfers.transfer({
              from: playerOwner(from.characterId),
              to: playerOwner(to.characterId),
              itemId,
              quantity,
              actorCharacterId: from.characterId,
              exchangeKind: KIND,
              exchangeSessionId: trade.tradeId,
            });

            if (!result.ok) {
              throw new TradeAborted(
                `item ${itemId} x${quantity}: ${result.reason}`
              );
            }

            moved.push({
              from,
              to,
              source: result.move.source,
              destination: result.move.destination,
              remaining: result.move.sourceRemaining,
            });
          }

          const amount = BigInt(from.kamas);

          if (amount > 0n) {
            const result = await this.kamas.transfer({
              from: playerOwner(from.characterId),
              to: playerOwner(to.characterId),
              amount,
              actorCharacterId: from.characterId,
              exchangeKind: KIND,
              exchangeSessionId: trade.tradeId,
            });

            if (!result.ok) {
              throw new TradeAborted(`kamas ${amount}: ${result.reason}`);
            }
          }
        }
      });
    } catch (err) {
      // Rolled back in full: neither inventory moved, so there is
      // nothing to repair and nothing to tell the clients beyond "it
      // did not happen".
      this.logger.warn(
        `trade ${trade.tradeId} aborted: ${
          err instanceof TradeAborted ? err.message : String(err)
        }`
      );
      this.close(trade, false);

      if (!(err instanceof TradeAborted)) {
        throw err;
      }

      return { ok: false, reason: "commit-failed" };
    }

    // Only now, after the commit: the windows go away announcing
    // success, then each player's bag and stats are brought up to date.
    // Frames after commit rather than inside it is the `FightEndService`
    // pattern — a rollback must not have told anyone anything.
    this.close(trade, true);

    for (const move of moved) {
      if (move.remaining > 0) {
        this.inventory.sendItemQuantity(
          move.from.sessionId,
          move.source.id,
          move.remaining
        );
      } else {
        this.inventory.sendItemRemove(move.from.sessionId, move.source.id);
      }

      this.inventory.sendItemAdd(move.to.sessionId, move.destination);
    }

    await Promise.all(
      [trade.initiator, trade.target].map((s) =>
        this.stats.sendStats(s.sessionId, s.characterId)
      )
    );

    this.logger.log(`trade ${trade.tradeId}: committed`);

    return { ok: true };
  }

  /**
   * Both players still connected, still on the same map, neither in a
   * fight.
   *
   * Called at accept **and** again at commit. The movement block only
   * stops walking: a zaap, a scroll or a recall potion moves a player
   * without ever telling the exchange, and none of those will grow a
   * notification just for this. Re-reading presence costs a map lookup.
   */
  private stillValid(trade: TradeState): string | null {
    for (const side of [trade.initiator, trade.target]) {
      if (!this.sessions.get(side.sessionId)) {
        return "disconnected";
      }

      if (this.fights.isInFight(side.sessionId)) {
        return "in-fight";
      }
    }

    const a = this.presence.getByCharacter(trade.initiator.characterId);
    const b = this.presence.getByCharacter(trade.target.characterId);

    if (!a || !b || a.mapId !== b.mapId) {
      return "different-map";
    }

    return null;
  }

  /**
   * Clear both validations and say so.
   *
   * Rule 2 of the class note. Announced rather than merely stored: the
   * client tints each half of the window from its own `readyStates`, and
   * a flag cleared in silence would leave a green pane over an offer
   * that has changed.
   */
  private unready(trade: TradeState): void {
    const targets = this.bothSessions(trade);

    for (const side of [trade.initiator, trade.target]) {
      if (!side.ready) {
        continue;
      }

      side.ready = false;
      this.frames.ready(targets, side.characterId, false);
    }
  }

  private bothSessions(trade: TradeState): string[] {
    return [trade.initiator.sessionId, trade.target.sessionId];
  }

  private accountOf(sessionId: string): string {
    return this.sessions.get(sessionId)?.accountId ?? "";
  }
}

/** A refusal from inside the commit transaction. Always fatal. */
class TradeAborted extends Error {}

function side(sessionId: string, characterId: string, name: string): TradeSide {
  return { sessionId, characterId, name, offer: {}, kamas: "0", ready: false };
}
