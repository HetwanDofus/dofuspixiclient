import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/** Lowest and highest legal hotbar slot — mirrors `chk_slot_range` (0050). */
export const MIN_SHORTCUT_SLOT = 1;
export const MAX_SHORTCUT_SLOT = 42;

export function isLegalSlot(slot: number): boolean {
  return (
    Number.isInteger(slot) &&
    slot >= MIN_SHORTCUT_SLOT &&
    slot <= MAX_SHORTCUT_SLOT
  );
}

@Injectable()
export class ShortcutsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findByPlayer(playerId: string) {
    return this.txHost.tx
      .selectFrom("playerItemShortcuts")
      .selectAll()
      .where("playerId", "=", playerId)
      .orderBy("slot", "asc")
      .execute();
  }

  findSlot(playerId: string, slot: number) {
    return this.txHost.tx
      .selectFrom("playerItemShortcuts")
      .selectAll()
      .where("playerId", "=", playerId)
      .where("slot", "=", slot)
      .executeTakeFirst();
  }

  /** Claim a slot for a template, replacing whatever sat there. */
  async put(playerId: string, slot: number, templateId: number): Promise<void> {
    await this.txHost.tx
      .insertInto("playerItemShortcuts")
      .values({ playerId, slot, templateId })
      .onConflict((oc) =>
        oc.columns(["playerId", "slot"]).doUpdateSet({ templateId })
      )
      .execute();
  }

  async deleteSlot(playerId: string, slot: number): Promise<void> {
    await this.txHost.tx
      .deleteFrom("playerItemShortcuts")
      .where("playerId", "=", playerId)
      .where("slot", "=", slot)
      .execute();
  }
}
