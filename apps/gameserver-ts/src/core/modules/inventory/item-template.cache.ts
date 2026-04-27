import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class ItemTemplateCacheService {
  private readonly cache = new Map<
    number,
    Awaited<ReturnType<ItemTemplateCacheService["queryTemplate"]>>
  >();

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  async load(templateId: number) {
    const hit = this.cache.get(templateId);
    if (hit) {
      return hit;
    }
    const row = await this.queryTemplate(templateId);
    if (!row) {
      return undefined;
    }
    this.cache.set(templateId, row);
    return row;
  }

  private queryTemplate(templateId: number) {
    return this.txHost.tx
      .selectFrom("itemTemplates")
      .selectAll()
      .where("id", "=", templateId)
      .executeTakeFirst();
  }
}
