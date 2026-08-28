import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class NpcDialogRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /**
   * The whole question table. Read once at boot rather than per lookup: it is
   * ~5 700 immutable rows the content import writes and nothing else touches,
   * and a dialog turn has to answer inside a click.
   */
  allQuestions() {
    return this.txHost.tx
      .selectFrom("npcDialogQuestions")
      .select(["id", "responseIds", "parameters", "cond", "ifFalse"])
      .execute();
  }

  /** Likewise: ~5 300 rows, several per answer. */
  allResponseActions() {
    return this.txHost.tx
      .selectFrom("npcDialogResponseActions")
      .select(["responseId", "type", "args"])
      .orderBy("responseId")
      .orderBy("type")
      .execute();
  }
}
