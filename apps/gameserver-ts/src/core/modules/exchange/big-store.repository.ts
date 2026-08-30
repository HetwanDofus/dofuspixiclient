import type { GroupableListing } from "@modules/exchange/big-store.pricing";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type {
  BigStoreListingRow,
  DB,
  HdvTemplateRow,
  ItemRow,
} from "@shared/db/schema";
import { OwnerKind } from "@modules/items/item-owner";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { sql } from "kysely";

/** A listing joined to the stack it holds. */
export interface ListingWithStock {
  listing: BigStoreListingRow;
  item: ItemRow;
}

/**
 * Reads and writes on `big_store_listings`.
 *
 * A listing's stock is not a column here: it is the one `items` row owned
 * by `(OwnerKind.BigStore, listing.id)`. Every read that needs the goods
 * therefore joins on the owner pair, which `idx_items_owner` covers.
 */
@Injectable()
export class BigStoreRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /** Every auction house, for the by-map cache. */
  allHalls(): Promise<HdvTemplateRow[]> {
    return this.txHost.tx.selectFrom("hdvTemplates").selectAll().execute();
  }

  /**
   * The distinct templates on sale in one hall, restricted to one item
   * type and ordered by name — which is the order the retail list shows
   * and the only one a player can scan.
   */
  async templatesOnSale(hdvId: number, typeId: number): Promise<number[]> {
    const rows = await this.txHost.tx
      .selectFrom("bigStoreListings")
      .innerJoin(
        "itemTemplates",
        "itemTemplates.id",
        "bigStoreListings.templateId"
      )
      .select("bigStoreListings.templateId")
      .distinct()
      .where("bigStoreListings.hdvId", "=", hdvId)
      .where("itemTemplates.type", "=", typeId)
      .orderBy("bigStoreListings.templateId")
      .execute();

    return rows.map((row) => row.templateId);
  }

  /** Every lot of one template on sale in one hall, with its stock. */
  async listingsFor(
    hdvId: number,
    templateId: number
  ): Promise<GroupableListing[]> {
    const rows = await this.txHost.tx
      .selectFrom("bigStoreListings")
      .selectAll()
      .where("hdvId", "=", hdvId)
      .where("templateId", "=", templateId)
      .execute();

    const hydrated = await this.withStock(rows);

    return hydrated.map(({ listing, item }) => ({
      id: listing.id,
      templateId: listing.templateId,
      lotSize: listing.lotSize,
      price: BigInt(listing.price),
      item,
    }));
  }

  /** One listing and its stock, or nothing if it is already gone. */
  async byId(listingId: string): Promise<ListingWithStock | undefined> {
    const row = await this.txHost.tx
      .selectFrom("bigStoreListings")
      .selectAll()
      .where("id", "=", listingId)
      .executeTakeFirst();

    return row ? (await this.withStock([row]))[0] : undefined;
  }

  /**
   * The cheapest lot of a given size, among the lots that are
   * interchangeable with `reference` — same hall, same template, same
   * effects.
   *
   * This is how `EHB` turns "the x10 column of that row, at 800 kamas"
   * back into an actual listing: the row named a *group*, and by the time
   * the click lands the lot the price came from may already be sold. The
   * price is part of the predicate on purpose — buying at a price the
   * player never saw is worse than refusing.
   */
  async cheapestMatching(
    reference: ListingWithStock,
    lotSize: number,
    price: bigint
  ): Promise<ListingWithStock | undefined> {
    const rows = await this.txHost.tx
      .selectFrom("bigStoreListings")
      .selectAll()
      .where("hdvId", "=", reference.listing.hdvId)
      .where("templateId", "=", reference.listing.templateId)
      .where("lotSize", "=", lotSize)
      .where("price", "=", price.toString())
      .orderBy("id")
      .execute();

    const hydrated = await this.withStock(rows);

    // Same template is not the same object: two Boufbottes with
    // different rolls share a template and must never substitute for one
    // another, so the effects have to match too. `effects_hash` is the
    // generated column `items_stack` is already keyed on.
    return hydrated.find(
      (entry) => entry.item.effectsHash === reference.item.effectsHash
    );
  }

  /** Everything one account currently has on sale in one hall. */
  async ownListings(
    hdvId: number,
    accountId: string
  ): Promise<ListingWithStock[]> {
    const rows = await this.txHost.tx
      .selectFrom("bigStoreListings")
      .selectAll()
      .where("hdvId", "=", hdvId)
      .where("sellerAccountId", "=", accountId)
      .orderBy("id")
      .execute();

    return await this.withStock(rows);
  }

  /** How many slots this account is using in this hall. */
  async usedSlots(hdvId: number, accountId: string): Promise<number> {
    const row = await this.txHost.tx
      .selectFrom("bigStoreListings")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("hdvId", "=", hdvId)
      .where("sellerAccountId", "=", accountId)
      .executeTakeFirst();

    return Number(row?.n ?? 0);
  }

  /** Every listing due to expire, for the cold-start reload. */
  pending(): Promise<BigStoreListingRow[]> {
    return this.txHost.tx
      .selectFrom("bigStoreListings")
      .selectAll()
      .orderBy("expiresAt")
      .execute();
  }

  async insert(listing: {
    hdvId: number;
    sellerId: string;
    sellerAccountId: string;
    templateId: number;
    lotSize: number;
    price: bigint;
    expiresAt: Date;
  }): Promise<BigStoreListingRow> {
    const row = await this.txHost.tx
      .insertInto("bigStoreListings")
      .values({
        hdvId: listing.hdvId,
        sellerId: listing.sellerId,
        sellerAccountId: listing.sellerAccountId,
        templateId: listing.templateId,
        lotSize: listing.lotSize,
        price: listing.price.toString(),
        expiresAt: listing.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return row;
  }

  /**
   * Delete one listing, but only if it is still there.
   *
   * The house pattern: the precondition is the statement, and the number
   * of rows it touched is the answer. Two buyers racing for the last lot
   * both reach here; one deletes a row, the other deletes none and is
   * told the lot is gone.
   */
  async remove(listingId: string): Promise<boolean> {
    const result = await this.txHost.tx
      .deleteFrom("bigStoreListings")
      .where("id", "=", listingId)
      .executeTakeFirst();

    return (result.numDeletedRows ?? 0n) > 0n;
  }

  /**
   * The average unit price this template has actually sold for.
   *
   * Read from `item_ledger`, not from the listings: a sold lot is
   * deleted, and the ledger is where the sale survives. `exchange_kind`
   * 11 is `EXCHANGE_BIGSTORE_BUY`, so this counts purchases and nothing
   * else. Returns `undefined` when it has never sold here — the client
   * says so in as many words ("Cet objet n'a encore jamais été vendu
   * dans cet hôtel de vente").
   */
  async averageUnitPrice(
    templateId: number,
    exchangeKind: number,
    sample = 50
  ): Promise<number | undefined> {
    const row = await sql<{ avg: string | null }>`
      SELECT avg(kamas::numeric / quantity) AS avg
        FROM (
          SELECT kamas, quantity
            FROM item_ledger
           WHERE exchange_kind = ${exchangeKind}
             AND template_id = ${templateId}
             AND quantity > 0
             AND kamas > 0
           ORDER BY at DESC
           LIMIT ${sample}
        ) AS recent
    `
      .execute(this.txHost.tx)
      .then((result) => result.rows[0]);

    if (!row?.avg) {
      return undefined;
    }

    return Math.round(Number(row.avg));
  }

  /**
   * Attach each listing's stock.
   *
   * Two statements rather than one join, on purpose: `items` is fetched
   * by `(owner_kind, owner_id)`, which `idx_items_owner` serves
   * directly, and both rows then come back as the row types the rest of
   * the server already speaks. A join would have to be flattened and put
   * back together by hand, and a listing whose stack has somehow gone
   * would be indistinguishable from one that was never there.
   */
  private async withStock(
    listings: BigStoreListingRow[]
  ): Promise<ListingWithStock[]> {
    if (listings.length === 0) {
      return [];
    }

    const stock = await this.txHost.tx
      .selectFrom("items")
      .selectAll()
      .where("ownerKind", "=", OwnerKind.BigStore)
      .where(
        "ownerId",
        "in",
        listings.map((listing) => listing.id)
      )
      .execute();

    const byListing = new Map(stock.map((item) => [item.ownerId, item]));

    return listings.flatMap((listing) => {
      const item = byListing.get(listing.id);

      return item ? [{ listing, item }] : [];
    });
  }
}
