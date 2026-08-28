import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { ItemMove } from "@modules/items/item-transfer.service";
import type { ItemRow } from "@shared/db/schema";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { ContainerKamasRepository } from "@modules/items/container-kamas.repository";
import { type ItemOwner, playerOwner } from "@modules/items/item-owner";
import { ItemTransferService } from "@modules/items/item-transfer.service";
import { ItemsRepository } from "@modules/items/items.repository";
import { KamasTransferService } from "@modules/items/kamas-transfer.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";

export type StorageMoveDenial =
  | "no-session"
  | "invalid-quantity"
  | "not-found"
  | "equipped"
  | "not-enough"
  | "conflict"
  | "same-owner"
  | "unsupported-owner"
  | "invalid-amount";

export type StorageMoveResult = { ok: true } | { ok: false; reason: string };

/**
 * Bank and house chest — exchange type 5.
 *
 * The simplest flow there is, and deliberately the first one built: one
 * player, one container, and every movement commits on its own. There is
 * no ready phase — 1.29's `onCreate` case 5 never constructs
 * `datacenter.Exchange`, so an `EK` frame would dereference undefined on
 * the client — and therefore nothing to roll back.
 *
 * Everything harder about the other seventeen types is *absence* here:
 * no second session to keep in step, no snapshot, no two-sided commit.
 * That is what makes it the right thing to prove the socle with.
 *
 * Both sides of the window are told about every move, and they speak
 * different dialects: the player's half is the ordinary inventory
 * protocol the client already binds (`OA`/`OQ`/`OR`), the container's
 * half is `Es`. Pods (`Ow`) and the purse (`As`) are refreshed too —
 * canonical `Storage` computes how much a player may withdraw from
 * `maxWeight - currentWeight`, so a stale weight makes the *client*
 * compute a nonsense quantity.
 */
@Injectable()
export class StorageFlow {
  private readonly logger = new Logger(StorageFlow.name);

  constructor(
    private readonly items: ItemsRepository,
    private readonly transfers: ItemTransferService,
    private readonly kamas: KamasTransferService,
    private readonly containers: ContainerKamasRepository,
    private readonly frames: ExchangeFramesService,
    private readonly inventory: InventoryFramesService,
    private readonly stats: StatsService
  ) {}

  /** The `EC` + `EL` pair, with whatever the container currently holds. */
  async announceContents(session: ExchangeSession): Promise<void> {
    const [contents, kamas] = await Promise.all([
      this.items.findByOwner(session.remote),
      this.heldKamas(session.remote),
    ]);

    this.frames.open(session, contents, kamas);
  }

  /**
   * Move one stack across the window.
   *
   * `toStorage` is the direction the client asked for: `EMO+` deposits,
   * `EMO-` withdraws.
   */
  async moveItem(
    session: ExchangeSession,
    toStorage: boolean,
    itemId: string,
    quantity: number
  ): Promise<StorageMoveResult> {
    const player = playerOwner(session.characterId);
    const from = toStorage ? player : session.remote;
    const to = toStorage ? session.remote : player;

    const result = await this.transfers.transfer({
      from,
      to,
      itemId,
      quantity,
      actorCharacterId: session.characterId,
      exchangeKind: session.kind,
      exchangeSessionId: session.sessionId,
    });

    if (!result.ok) {
      this.logger.debug(
        `storage: move refused (${result.reason}) session=${session.sessionId}`
      );
      return { ok: false, reason: result.reason };
    }

    if (toStorage) {
      this.announceDeposit(session, result.move);
    } else {
      this.announceWithdrawal(session, result.move);
    }

    await this.stats.sendStats(session.sessionId, session.characterId);

    return { ok: true };
  }

  /** `EMG`. Positive deposits, negative withdraws — the client's sign. */
  async moveKamas(
    session: ExchangeSession,
    signedAmount: bigint
  ): Promise<StorageMoveResult> {
    if (signedAmount === 0n) {
      return { ok: false, reason: "invalid-amount" };
    }

    const player = playerOwner(session.characterId);
    const toStorage = signedAmount > 0n;
    const amount = toStorage ? signedAmount : -signedAmount;

    const result = await this.kamas.transfer({
      from: toStorage ? player : session.remote,
      to: toStorage ? session.remote : player,
      amount,
      actorCharacterId: session.characterId,
      exchangeKind: session.kind,
      exchangeSessionId: session.sessionId,
    });

    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }

    this.frames.storageKamas(
      session.sessionId,
      await this.heldKamas(session.remote)
    );

    // Nothing in the exchange protocol carries the *player's* balance —
    // `As` does, and it is the same call `item-move` already makes after
    // a change. Without it the purse on the left of the window stays at
    // its old value until the next map change.
    await this.stats.sendStats(session.sessionId, session.characterId);

    return { ok: true };
  }

  /**
   * The player's stack shrank or vanished; the container's grew.
   *
   * The container side is always an `add`: `Es` with `add = true` is an
   * upsert keyed on the item id, and `destination` is already the stack
   * as it now stands.
   */
  private announceDeposit(session: ExchangeSession, move: ItemMove): void {
    this.frames.storageItem(session.sessionId, true, move.destination);

    if (move.sourceRemaining > 0) {
      this.inventory.sendItemQuantity(
        session.sessionId,
        move.source.id,
        move.sourceRemaining
      );
      return;
    }

    this.inventory.sendItemRemove(session.sessionId, move.source.id);
  }

  /**
   * The container's stack shrank or vanished; the player's grew.
   *
   * A partial withdrawal sends the *remaining* container stack in full
   * rather than a delta, because that is what `Es` means.
   */
  private announceWithdrawal(session: ExchangeSession, move: ItemMove): void {
    this.inventory.sendItemAdd(session.sessionId, move.destination);

    if (move.sourceRemaining > 0) {
      const remaining: ItemRow = {
        ...move.source,
        quantity: move.sourceRemaining,
      };

      this.frames.storageItem(session.sessionId, true, remaining);
      return;
    }

    this.frames.storageItem(session.sessionId, false, move.source);
  }

  /** Whatever this container holds — a bank, a chest, later a stall. */
  private heldKamas(owner: ItemOwner): Promise<bigint> {
    return this.containers.balance(owner);
  }
}
