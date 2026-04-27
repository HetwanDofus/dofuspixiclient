import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class LoginRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findByUsername(username: string) {
    return this.txHost.tx
      .selectFrom("accounts")
      .select(["id", "pwdHash", "isBanned"])
      .where("username", "=", username)
      .executeTakeFirst();
  }

  async markLoggedIn(accountId: string, ip: string | null): Promise<void> {
    await this.txHost.tx
      .updateTable("accounts")
      .set({ lastLoginAt: new Date(), lastLoginIp: ip })
      .where("id", "=", accountId)
      .execute();
  }
}
