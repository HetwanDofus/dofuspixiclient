import type { ListingGroup } from "@modules/exchange/big-store.pricing";
import type { ListingWithStock } from "@modules/exchange/big-store.repository";
import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { Hall } from "@modules/exchange/hdv.service";
import type { ItemOwner } from "@modules/items/item-owner";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow, ItemTemplateRow } from "@shared/db/schema";
import { ExchangeType } from "@dofus/proto/common_pb";
import {
  BIG_STORE_EXPIRE,
  expiryJobId,
} from "@modules/exchange/big-store.expiry";
import { BigStoreFramesService } from "@modules/exchange/big-store.frames.service";
import {
  groupListings,
  isLotSize,
  isUnitaryItem,
  listingTax,
  lotSizeAtIndex,
} from "@modules/exchange/big-store.pricing";
import { BigStoreRegistry } from "@modules/exchange/big-store.registry";
import { BigStoreRepository } from "@modules/exchange/big-store.repository";
import { HdvService } from "@modules/exchange/hdv.service";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { ItemPresentationCacheService } from "@modules/inventory/item-presentation.cache";
import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { bankOwner, OwnerKind, playerOwner } from "@modules/items/item-owner";
import { ItemTransferService } from "@modules/items/item-transfer.service";
import { ItemsRepository } from "@modules/items/items.repository";
import { KamasTransferService } from "@modules/items/kamas-transfer.service";
import { SchedulerService } from "@modules/scheduler/scheduler.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

export type BigStoreDenial =
  | "no-session"
  | "no-hall"
  | "wrong-mode"
  | "bad-type"
  | "bad-level"
  | "bad-lot"
  | "bad-price"
  | "no-slot"
  | "no-tax"
  | "not-found"
  | "not-enough"
  | "equipped"
  | "own-sale"
  | "price-changed"
  | "conflict";

export type BigStoreResult = { ok: true } | { ok: false; reason: string };

/**
 * The auction house — exchange types 10 (sell) and 11 (buy).
 *
 * The first exchange in this server whose far side belongs to **other
 * players**, and every difference from `StorageFlow` follows from that:
 *
 *   1. **A lot is a container of its own.** The stock is an `items` row
 *      owned by `(OwnerKind.BigStore, listingId)`, so listing, buying
 *      and withdrawing are all `ItemTransferService.transfer` calls and
 *      the object keeps its identity and its jet from the seller's bag
 *      to the buyer's. `big_store_listings` holds the price and the
 *      deadline, nothing else.
 *   2. **Money and unsold goods go to the bank, never to the purse.**
 *      1.29 says so in as many words (`BIGSTORE_SELL_TOTAL`, NPC dialog
 *      2349), and it is what makes a sale work while the seller is
 *      offline — which is the whole point of an auction house.
 *   3. **Someone else can change what is on your screen.** A price grid
 *      is a live view, so every write here tells the sessions watching
 *      the affected shelf (`BigStoreRegistry`), and only those.
 *
 * Two modes, two exchange types, one flow: the mode decides which frames
 * open the window and which gestures are legal, and nothing else.
 * Switching mode is a fresh `ER` on the other type against the same NPC,
 * exactly as `BigStoreSell.as:449` does it.
 */
@Injectable()
export class BigStoreFlow {
  private readonly logger = new Logger(BigStoreFlow.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly repository: BigStoreRepository,
    private readonly halls: HdvService,
    private readonly views: BigStoreRegistry,
    private readonly items: ItemsRepository,
    private readonly transfers: ItemTransferService,
    private readonly kamas: KamasTransferService,
    private readonly templates: ItemTemplateCacheService,
    private readonly presentation: ItemPresentationCacheService,
    private readonly frames: BigStoreFramesService,
    private readonly inventory: InventoryFramesService,
    private readonly stats: StatsService,
    private readonly scheduler: SchedulerService
  ) {}

  /** `EC` + `EHK`, and in sell mode the seller's own stock. */
  async announceOpen(
    session: ExchangeSession,
    hall: Hall,
    npcId: number
  ): Promise<void> {
    this.views.enter(session.sessionId, hall.id);
    this.frames.open(session.sessionId, session.kind, hall, npcId);

    if (session.kind !== ExchangeType.EXCHANGE_BIGSTORE_SELL) {
      return;
    }

    const own = await this.repository.ownListings(hall.id, session.accountId);

    await this.sendTemplatesFor(
      session.sessionId,
      own.map((entry) => entry.item.templateId)
    );

    this.frames.ownList(session.sessionId, own);
  }

  /** The session left the hall; stop sending it shelf updates. */
  forget(sessionId: string): void {
    this.views.leave(sessionId);
  }

  /**
   * `EHT` — the templates on sale in one category.
   *
   * The templates themselves go out with the list. Without that, an item
   * the player has never owned draws as a nameless empty cell: templates
   * are otherwise sent once at login for what the character carries, and
   * an auction house is *entirely* made of other people's things. Same
   * hole `sendTemplateFor` plugged for the trade window.
   */
  async browseType(
    session: ExchangeSession,
    typeId: number
  ): Promise<BigStoreResult> {
    const hall = await this.hallOf(session);

    if (!hall) {
      return { ok: false, reason: "no-hall" };
    }

    if (!hall.types.includes(typeId)) {
      return { ok: false, reason: "bad-type" };
    }

    const templateIds = await this.repository.templatesOnSale(hall.id, typeId);

    this.views.browseType(session.sessionId, typeId);
    await this.sendTemplatesFor(session.sessionId, templateIds);
    this.frames.typeItems(session.sessionId, typeId, templateIds);

    return { ok: true };
  }

  /** `EHl` — the price grid for one template. */
  async browseTemplate(
    session: ExchangeSession,
    templateId: number
  ): Promise<BigStoreResult> {
    const hall = await this.hallOf(session);

    if (!hall) {
      return { ok: false, reason: "no-hall" };
    }

    const groups = await this.groupsFor(hall, templateId);

    this.views.browseTemplate(session.sessionId, templateId);
    await this.sendTemplatesFor(session.sessionId, [templateId]);
    this.frames.itemList(session.sessionId, templateId, groups);

    return { ok: true };
  }

  /** `EHS` — the same grid, reached from the search box. */
  async search(
    session: ExchangeSession,
    templateId: number
  ): Promise<BigStoreResult> {
    return await this.browseTemplate(session, templateId);
  }

  /** `EHP` — what this template has been selling for. */
  async middlePrice(
    session: ExchangeSession,
    templateId: number
  ): Promise<BigStoreResult> {
    const average = await this.repository.averageUnitPrice(
      templateId,
      ExchangeType.EXCHANGE_BIGSTORE_BUY
    );

    this.frames.middlePrice(session.sessionId, templateId, average);

    return { ok: true };
  }

  /**
   * `EMO+` — put a lot on sale.
   *
   * `quantity` is the **lot size**, not an amount to move: the client
   * picked it from the three the hall advertises. See the note on
   * `ExchangeMoveItem` in the proto.
   */
  async list(
    session: ExchangeSession,
    itemId: string,
    lotSize: number,
    price: bigint
  ): Promise<BigStoreResult> {
    if (session.kind !== ExchangeType.EXCHANGE_BIGSTORE_SELL) {
      return { ok: false, reason: "wrong-mode" };
    }

    const hall = await this.hallOf(session);

    if (!hall) {
      return { ok: false, reason: "no-hall" };
    }

    if (!isLotSize(lotSize)) {
      return this.refuseSale(session, "bad-lot");
    }

    if (price <= 0n) {
      return this.refuseSale(session, "bad-price");
    }

    const stack = await this.items.findOwned(
      playerOwner(session.characterId),
      itemId
    );

    if (!stack) {
      return this.refuseSale(session, "not-found");
    }

    if (stack.quantity < lotSize) {
      return this.refuseSale(session, "not-enough");
    }

    const template = await this.templates.load(stack.templateId);

    if (!template) {
      return this.refuseSale(session, "not-found");
    }

    if (!hall.types.includes(template.type)) {
      return this.refuseSale(session, "bad-type");
    }

    if (template.level > hall.levelMax) {
      return this.refuseSale(session, "bad-level");
    }

    if ((await this.isUnitary(template)) && lotSize !== 1) {
      return this.refuseSale(session, "bad-lot");
    }

    const used = await this.repository.usedSlots(hall.id, session.accountId);

    if (used >= hall.maxItems) {
      return this.refuseSale(session, "no-slot");
    }

    const tax = listingTax(price, hall.taxPercent);
    const expiresAt = new Date(Date.now() + hall.sellTimeHours * 3_600_000);

    // One transaction: the tax, the listing and the stock move together
    // or not at all. A lot that exists with no tax paid, or a tax paid
    // for a lot that was never created, are both worse than a refusal.
    const listed = await this.txHost
      .withTransaction(async () => {
        const paid = await this.kamas.transfer({
          from: playerOwner(session.characterId),
          // The tax is spent, not held: it goes to the hall's own purse so
          // it shows up in the ledger rather than vanishing into an
          // arithmetic difference nobody can audit.
          to: { kind: OwnerKind.BigStore, id: String(hall.id) },
          amount: tax,
          actorCharacterId: session.characterId,
          exchangeKind: session.kind,
          exchangeSessionId: session.sessionId,
        });

        if (!paid.ok) {
          return null;
        }

        const listing = await this.repository.insert({
          hdvId: hall.id,
          sellerId: session.characterId,
          sellerAccountId: session.accountId,
          templateId: stack.templateId,
          lotSize,
          price,
          expiresAt,
        });

        const moved = await this.transfers.transfer({
          from: playerOwner(session.characterId),
          to: { kind: OwnerKind.BigStore, id: listing.id },
          itemId,
          quantity: lotSize,
          actorCharacterId: session.characterId,
          exchangeKind: session.kind,
          exchangeSessionId: session.sessionId,
        });

        if (!moved.ok) {
          // Inside the transaction, so the tax and the listing row unwind
          // with it. Throwing rather than returning is deliberate: a
          // refusal from `ItemTransferService` on a unique-index collision
          // has already aborted the Postgres transaction, and carrying on
          // would run against a dead handle. Same rule as `TradeFlow`.
          throw new ListingFailed(moved.reason);
        }

        return { listing, move: moved.move };
      })
      .catch((err: unknown) => {
        if (err instanceof ListingFailed) {
          return err;
        }
        throw err;
      });

    if (listed === null) {
      return this.refuseSale(session, "no-tax");
    }

    if (listed instanceof ListingFailed) {
      return this.refuseSale(session, listed.reason);
    }

    // The seller's bag shrank.
    if (listed.move.sourceRemaining > 0) {
      this.inventory.sendItemQuantity(
        session.sessionId,
        listed.move.source.id,
        listed.move.sourceRemaining
      );
    } else {
      this.inventory.sendItemRemove(session.sessionId, listed.move.source.id);
    }

    this.scheduler.schedule({
      id: expiryJobId(listed.listing.id),
      dueAt: expiresAt.getTime(),
      channel: BIG_STORE_EXPIRE,
      payload: { listingId: listed.listing.id },
    });

    this.frames.sold(session.sessionId, true);
    this.frames.ownMovement(session.sessionId, true, {
      listing: listed.listing,
      item: listed.move.destination,
    });

    await this.stats.sendStats(session.sessionId, session.characterId);
    await this.refreshWatchers(hall, stack.templateId, template.type);

    this.logger.log(
      `bigstore: listed template=${stack.templateId} x${lotSize} ` +
        `for ${price} in hall=${hall.id} by character=${session.characterId}`
    );

    return { ok: true };
  }

  /**
   * `EMO-` — take a lot off sale.
   *
   * `itemId` is a **listing id** here, not an item id. The tax is not
   * refunded: 1.29 charges for the shelf space, not for the sale.
   */
  async withdraw(
    session: ExchangeSession,
    listingId: string
  ): Promise<BigStoreResult> {
    if (session.kind !== ExchangeType.EXCHANGE_BIGSTORE_SELL) {
      return { ok: false, reason: "wrong-mode" };
    }

    const hall = await this.hallOf(session);
    const entry = await this.repository.byId(listingId);

    if (!hall || !entry || entry.listing.hdvId !== hall.id) {
      return { ok: false, reason: "not-found" };
    }

    // Per account, not per character: the bank is shared, so a second
    // character of the same account may take a lot back down.
    if (entry.listing.sellerAccountId !== session.accountId) {
      return { ok: false, reason: "not-found" };
    }

    const returned = await this.release(
      entry,
      playerOwner(session.characterId),
      session
    );

    if (!returned) {
      return { ok: false, reason: "not-found" };
    }

    this.inventory.sendItemAdd(session.sessionId, returned);
    this.frames.ownMovement(session.sessionId, false, listingId);

    await this.stats.sendStats(session.sessionId, session.characterId);
    await this.refreshWatchersFor(hall, entry.listing.templateId);

    return { ok: true };
  }

  /**
   * `EHB` — buy one lot.
   *
   * The client names a *group*, an amount and the price it was shown.
   * All three are needed: the group and the amount say which shelf, and
   * the price is what makes buying at a figure the player never saw
   * impossible — between drawing the grid and clicking Acheter, the lot
   * that price came from may well have been sold to somebody else.
   */
  async buy(
    session: ExchangeSession,
    lineId: string,
    quantityIndex: number,
    price: bigint
  ): Promise<BigStoreResult> {
    if (session.kind !== ExchangeType.EXCHANGE_BIGSTORE_BUY) {
      return { ok: false, reason: "wrong-mode" };
    }

    const hall = await this.hallOf(session);
    const lotSize = lotSizeAtIndex(quantityIndex);

    if (!hall || lotSize === undefined) {
      return this.refusePurchase(session, "bad-lot");
    }

    const reference = await this.repository.byId(lineId);

    if (!reference || reference.listing.hdvId !== hall.id) {
      return this.refusePurchase(session, "not-found");
    }

    const target = await this.repository.cheapestMatching(
      reference,
      lotSize,
      price
    );

    if (!target) {
      return this.refusePurchase(session, "price-changed");
    }

    if (target.listing.sellerAccountId === session.accountId) {
      return this.refusePurchase(session, "own-sale");
    }

    const bought = await this.txHost
      .withTransaction(async () => {
        // The delete is the lock. Two buyers reaching here for the same
        // lot both try it; one removes a row and one removes none, and the
        // loser is told the lot is gone rather than being handed a second
        // copy of it. No `SELECT ... FOR UPDATE`, same as everywhere else
        // in this server.
        if (!(await this.repository.remove(target.listing.id))) {
          return null;
        }

        const paid = await this.kamas.transfer({
          from: playerOwner(session.characterId),
          // The seller's bank, not their purse: they may well be offline,
          // and 1.29 credits the chest either way.
          to: bankOwner(target.listing.sellerAccountId),
          amount: BigInt(target.listing.price),
          actorCharacterId: session.characterId,
          exchangeKind: session.kind,
          exchangeSessionId: session.sessionId,
        });

        if (!paid.ok) {
          throw new ListingFailed(paid.reason);
        }

        const moved = await this.transfers.transfer({
          from: { kind: OwnerKind.BigStore, id: target.listing.id },
          to: playerOwner(session.characterId),
          itemId: target.item.id,
          quantity: target.item.quantity,
          actorCharacterId: session.characterId,
          exchangeKind: session.kind,
          exchangeSessionId: session.sessionId,
        });

        if (!moved.ok) {
          throw new ListingFailed(moved.reason);
        }

        return moved.move.destination;
      })
      .catch((err: unknown) => {
        if (err instanceof ListingFailed) {
          return err;
        }
        throw err;
      });

    if (bought === null) {
      return this.refusePurchase(session, "price-changed");
    }

    if (bought instanceof ListingFailed) {
      return this.refusePurchase(session, bought.reason);
    }

    this.scheduler.cancel(expiryJobId(target.listing.id));

    this.inventory.sendItemAdd(session.sessionId, bought);
    this.frames.bought(session.sessionId, true);

    await this.stats.sendStats(session.sessionId, session.characterId);
    await this.refreshWatchersFor(hall, target.listing.templateId);

    this.logger.log(
      `bigstore: bought listing=${target.listing.id} ` +
        `template=${target.listing.templateId} for ${target.listing.price} ` +
        `by character=${session.characterId}`
    );

    return { ok: true };
  }

  /**
   * A lot reached its deadline: the stock goes to the seller's bank.
   *
   * Called by `BigStoreExpiryService`, not by a client, which is why it
   * takes ids rather than a session — there may well be nobody connected
   * on either side.
   */
  async expire(listingId: string): Promise<void> {
    const entry = await this.repository.byId(listingId);

    if (!entry) {
      return;
    }

    const returned = await this.release(
      entry,
      bankOwner(entry.listing.sellerAccountId),
      null
    );

    if (!returned) {
      return;
    }

    const hall = await this.halls.byId(entry.listing.hdvId);

    if (hall) {
      await this.refreshWatchersFor(hall, entry.listing.templateId);
    }

    this.logger.log(
      `bigstore: listing=${listingId} expired, ${entry.item.quantity} ` +
        `of template=${entry.listing.templateId} returned to the bank`
    );
  }

  /** Every listing the expiry service has to re-arm on a cold start. */
  pending() {
    return this.repository.pending();
  }

  /**
   * Take a lot off the shelf and hand its stock to `to`.
   *
   * The delete comes first and its row count is the decision, so a
   * withdrawal racing an expiry — or a purchase — produces one winner
   * and one no-op rather than two copies of the goods.
   */
  private async release(
    entry: ListingWithStock,
    to: ItemOwner,
    session: ExchangeSession | null
  ): Promise<ItemRow | null> {
    const released = await this.txHost
      .withTransaction(async () => {
        if (!(await this.repository.remove(entry.listing.id))) {
          return null;
        }

        const moved = await this.transfers.transfer({
          from: { kind: OwnerKind.BigStore, id: entry.listing.id },
          to,
          itemId: entry.item.id,
          quantity: entry.item.quantity,
          actorCharacterId: session?.characterId ?? entry.listing.sellerId,
          exchangeKind: ExchangeType.EXCHANGE_BIGSTORE_SELL,
          ...(session ? { exchangeSessionId: session.sessionId } : {}),
        });

        if (!moved.ok) {
          throw new ListingFailed(moved.reason);
        }

        return moved.move.destination;
      })
      .catch((err: unknown) => {
        if (err instanceof ListingFailed) {
          // The row is already back where it was — the transaction
          // unwound with the throw. Nothing was taken off the shelf.
          this.logger.warn(
            `bigstore: could not release listing=${entry.listing.id} ` +
              `(${err.reason})`
          );
          return null;
        }
        throw err;
      });

    if (released) {
      // Harmless when the job is the very one that called us in.
      this.scheduler.cancel(expiryJobId(entry.listing.id));
    }

    return released;
  }

  /** The hall this session opened, re-read rather than carried. */
  private async hallOf(session: ExchangeSession): Promise<Hall | undefined> {
    return await this.halls.byId(Number(session.remote.id));
  }

  private async isUnitary(template: ItemTemplateRow): Promise<boolean> {
    const superType = await this.presentation.loadSuperType(template.superType);

    return isUnitaryItem(template, superType?.positions ?? []);
  }

  private async groupsFor(
    hall: Hall,
    templateId: number
  ): Promise<ListingGroup[]> {
    const [listings, template] = await Promise.all([
      this.repository.listingsFor(hall.id, templateId),
      this.templates.load(templateId),
    ]);

    if (!template) {
      return [];
    }

    return groupListings(listings, await this.isUnitary(template));
  }

  /**
   * Redraw one shelf for everybody looking at it.
   *
   * Recomputed rather than decremented: a group whose cheapest lot just
   * sold is still a group, with the next price in it, and working that
   * out from a delta on the client would mean the client holding every
   * lot it was never sent.
   */
  private async refreshWatchersFor(
    hall: Hall,
    templateId: number
  ): Promise<void> {
    const template = await this.templates.load(templateId);

    await this.refreshWatchers(hall, templateId, template?.type ?? -1);
  }

  private async refreshWatchers(
    hall: Hall,
    templateId: number,
    typeId: number
  ): Promise<void> {
    const groups = await this.groupsFor(hall, templateId);
    const watchers = this.views.watchingTemplate(hall.id, templateId);

    // The whole grid, not a delta — and that is a deliberate departure
    // from 1.29's `EHm`.
    //
    // A generic item's row is a *group*, and this server names the group
    // after the cheapest lot in it. That id therefore changes the moment
    // the cheapest lot is bought or undercut, so an upsert keyed on it
    // leaves the old row standing beside the new one: the buyer sees the
    // same wheat twice, and clicking the stale row is refused because
    // the listing behind it is gone. Retail avoids this because its
    // groups have a row of their own in the database.
    //
    // A price grid is a handful of rows. Sending it whole is one frame,
    // and it cannot drift.
    for (const sessionId of watchers) {
      this.frames.itemList(sessionId, templateId, groups);
    }

    // The category list only changes when a template appears in it or
    // leaves it entirely, which is exactly "there were no groups before
    // and there are now", or the reverse.
    if (typeId > 0) {
      this.frames.typeMovement(
        this.views.watchingType(hall.id, typeId),
        groups.length > 0,
        typeId,
        templateId
      );
    }
  }

  private async sendTemplatesFor(
    sessionId: string,
    templateIds: readonly number[]
  ): Promise<void> {
    for (const id of new Set(templateIds)) {
      await this.inventory.sendTemplateFor(sessionId, id);
    }
  }

  private refuseSale(session: ExchangeSession, reason: string): BigStoreResult {
    this.frames.sold(session.sessionId, false, reason);
    this.logger.debug(`bigstore: sale refused (${reason})`);

    return { ok: false, reason };
  }

  private refusePurchase(
    session: ExchangeSession,
    reason: string
  ): BigStoreResult {
    this.frames.bought(session.sessionId, false, reason);
    this.logger.debug(`bigstore: purchase refused (${reason})`);

    return { ok: false, reason };
  }
}

/**
 * A refusal from inside a transaction.
 *
 * Thrown rather than returned because a denial from
 * `ItemTransferService` or `KamasTransferService` may already have
 * aborted the Postgres transaction; unwinding is the only correct
 * answer, and an exception is the only thing that unwinds.
 */
class ListingFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ListingFailed";
  }
}
