import { randomUUID } from "node:crypto";

import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { ContainerKamasRepository } from "@modules/items/container-kamas.repository";
import { ItemLedgerRepository } from "@modules/items/item-ledger.repository";
import {
  type ItemOwner,
  OwnerKind,
  sameOwner,
} from "@modules/items/item-owner";
import { PlayersRepository } from "@modules/players/players.repository";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

export interface KamasTransferCommand {
  from: ItemOwner;
  to: ItemOwner;
  amount: bigint;
  actorCharacterId: string | null;
  exchangeKind?: number;
  exchangeSessionId?: string;
}

export type KamasDenialReason = "invalid-amount" | "not-enough" | "same-owner";

export type KamasTransferResult =
  | { ok: true }
  | { ok: false; reason: KamasDenialReason };

/**
 * Moving kamas between a character's purse and a container that holds
 * kamas of its own.
 *
 * Every container kind works, not just the bank. That matters more than
 * it sounds: the first thing this service met in the wild was a *house
 * chest*, and recognising only the bank made the kamas half of the
 * storage window silently dead — the 1.29 window shows a balance on both
 * sides whatever it was opened on.
 *
 * Both sides use the debit pattern QA-077 established — the balance
 * predicate inside the `UPDATE`, zero rows meaning refusal — so the
 * whole transfer needs no lock, only a transaction to make the debit and
 * the credit inseparable.
 */
@Injectable()
export class KamasTransferService {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly players: PlayersRepository,
    private readonly containers: ContainerKamasRepository,
    private readonly ledger: ItemLedgerRepository
  ) {}

  async transfer(cmd: KamasTransferCommand): Promise<KamasTransferResult> {
    if (cmd.amount <= 0n) {
      return { ok: false, reason: "invalid-amount" };
    }

    if (sameOwner(cmd.from, cmd.to)) {
      return { ok: false, reason: "same-owner" };
    }

    return await this.txHost.withTransaction(async () => {
      const debited = await this.spend(cmd.from, cmd.amount);

      if (!debited) {
        return { ok: false as const, reason: "not-enough" as const };
      }

      await this.earn(cmd.to, cmd.amount);

      await this.ledger.record({
        txId: randomUUID(),
        actorCharacterId: cmd.actorCharacterId,
        from: cmd.from,
        to: cmd.to,
        kamas: cmd.amount,
        exchangeKind: cmd.exchangeKind ?? null,
        exchangeSessionId: cmd.exchangeSessionId ?? null,
      });

      return { ok: true as const };
    });
  }

  /**
   * A character's purse is `players.kamas`; every other holder is a row
   * in `container_kamas`. That split is the only case analysis in this
   * service, and it is here rather than at the call sites so that a new
   * kind of container needs no change at all.
   */
  private async spend(owner: ItemOwner, amount: bigint): Promise<boolean> {
    if (owner.kind === OwnerKind.Player) {
      return (await this.players.spendKamas(owner.id, Number(amount))) > 0;
    }

    return (await this.containers.spend(owner, amount)) > 0;
  }

  private async earn(owner: ItemOwner, amount: bigint): Promise<void> {
    if (owner.kind === OwnerKind.Player) {
      await this.players.earnKamas(owner.id, Number(amount));
      return;
    }

    await this.containers.earn(owner, amount);
  }
}
