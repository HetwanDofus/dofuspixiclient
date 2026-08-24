import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemSuperTypeRow, ItemTypeRow } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/**
 * `item_types` / `item_super_types` are small (≈130 / ≈26 rows), static for
 * the process's lifetime, and read on almost every item-presentation frame
 * — the same shape of problem `ItemTemplateCacheService` already solves for
 * `item_templates`, kept as its own service because the two caches are
 * queried from different places (this one from wherever an item's *type
 * name* or *legal equip positions* is needed, not only alongside a
 * template).
 */
@Injectable()
export class ItemPresentationCacheService {
  private readonly types = new Map<number, ItemTypeRow>();
  private readonly superTypes = new Map<number, ItemSuperTypeRow>();

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  async loadType(typeId: number): Promise<ItemTypeRow | undefined> {
    const hit = this.types.get(typeId);
    if (hit) {
      return hit;
    }
    const row = await this.txHost.tx
      .selectFrom("itemTypes")
      .selectAll()
      .where("id", "=", typeId)
      .executeTakeFirst();
    if (row) {
      this.types.set(typeId, row);
    }
    return row;
  }

  async loadSuperType(
    superTypeId: number
  ): Promise<ItemSuperTypeRow | undefined> {
    const hit = this.superTypes.get(superTypeId);
    if (hit) {
      return hit;
    }
    const row = await this.txHost.tx
      .selectFrom("itemSuperTypes")
      .selectAll()
      .where("id", "=", superTypeId)
      .executeTakeFirst();
    if (row) {
      this.superTypes.set(superTypeId, row);
    }
    return row;
  }
}
