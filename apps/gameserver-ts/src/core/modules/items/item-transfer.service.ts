import { randomUUID } from "node:crypto";

import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow } from "@shared/db/schema";
import { parseItemEffects } from "@modules/inventory/item-effects";
import { ItemLedgerRepository } from "@modules/items/item-ledger.repository";
import {
  describeOwner,
  type ItemOwner,
  sameOwner,
} from "@modules/items/item-owner";
import { BAG_POSITION, ItemsRepository } from "@modules/items/items.repository";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

export interface TransferCommand {
  from: ItemOwner;
  to: ItemOwner;
  itemId: string;
  quantity: number;
  /** Whose action this was, for the ledger. */
  actorCharacterId: string | null;
  exchangeKind?: number;
  exchangeSessionId?: string;
}

export type TransferDenialReason =
  /** `quantity` was zero or negative. */
  | "invalid-quantity"
  /** No such stack under `from` — or it moved before we looked. */
  | "not-found"
  /** Worn gear has to be taken off before it can go anywhere. */
  | "equipped"
  /** The stack is smaller than the request, now. */
  | "not-enough"
  /** `from` and `to` are the same container. */
  | "same-owner"
  /** Another move won the same destination stack. Safe to retry. */
  | "conflict";

export interface ItemMove {
  /**
   * The source stack as it stood **before** the move. Callers need its
   * effects and template to describe what is left of it, and the wire
   * form of a partial move is the remaining stack in full, not a delta.
   */
  source: ItemRow;
  /** How many units changed hands. */
  quantity: number;
  /** What is left in the source; 0 means the row is gone. */
  sourceRemaining: number;
  /** The destination stack **after** the move — an absolute state. */
  destination: ItemRow;
  /** True when the row itself moved and kept its id. */
  keptIdentity: boolean;
}

export type TransferResult =
  | { ok: true; move: ItemMove }
  | { ok: false; reason: TransferDenialReason };

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * Moving a stack from one container to another.
 *
 * This is the single write path every exchange goes through — bank,
 * chest, shop, trade, auction house — and the reason `items` has one
 * table and one id space instead of four.
 *
 * Two paths, chosen per move:
 *
 *   - **Relocate.** A whole stack, into a container that holds nothing
 *     identical: one `UPDATE`, and the item keeps its id. The `NOT
 *     EXISTS` guard inside that statement means it matches nothing
 *     rather than raising when the assumption turns out to be false,
 *     so falling through costs nothing and unwinds nothing.
 *   - **Split and merge.** Everything else: take from the source under
 *     a predicate, then `INSERT … ON CONFLICT DO UPDATE` into the
 *     destination. The item gets a new id, which is honest — a split
 *     stack genuinely is a different object from the one it came from.
 *
 * Neither path takes a lock. Both carry their preconditions in the
 * statement and report the rows they touched, which is what makes two
 * concurrent moves of the same stack resolve to one winner and one
 * `not-enough` rather than to two winners.
 */
@Injectable()
export class ItemTransferService {
  private readonly logger = new Logger(ItemTransferService.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly items: ItemsRepository,
    private readonly ledger: ItemLedgerRepository
  ) {}

  async transfer(cmd: TransferCommand): Promise<TransferResult> {
    if (!Number.isInteger(cmd.quantity) || cmd.quantity <= 0) {
      return { ok: false, reason: "invalid-quantity" };
    }

    if (sameOwner(cmd.from, cmd.to)) {
      return { ok: false, reason: "same-owner" };
    }

    try {
      return await this.txHost.withTransaction(() => this.run(cmd));
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Another move claimed the same destination stack between our
        // guard and our write. Nothing was duplicated and nothing was
        // lost — the whole transaction rolled back.
        this.logger.warn(
          `transfer: conflict moving item=${cmd.itemId} ` +
            `${describeOwner(cmd.from)} -> ${describeOwner(cmd.to)}`
        );
        return { ok: false, reason: "conflict" };
      }

      throw err;
    }
  }

  private async run(cmd: TransferCommand): Promise<TransferResult> {
    const stack = await this.items.findOwned(cmd.from, cmd.itemId);

    if (!stack) {
      return { ok: false, reason: "not-found" };
    }

    if (stack.position !== BAG_POSITION) {
      return { ok: false, reason: "equipped" };
    }

    if (stack.quantity < cmd.quantity) {
      return { ok: false, reason: "not-enough" };
    }

    const txId = randomUUID();

    if (stack.quantity === cmd.quantity) {
      const relocated = await this.items.relocateWholeStack(
        cmd.from,
        cmd.to,
        cmd.itemId,
        cmd.quantity
      );

      if (relocated) {
        const destination: ItemRow = {
          ...stack,
          ownerKind: cmd.to.kind,
          ownerId: cmd.to.id,
        };

        await this.write(cmd, txId, stack.id, stack.templateId, cmd.quantity);

        return {
          ok: true,
          move: {
            source: stack,
            quantity: cmd.quantity,
            sourceRemaining: 0,
            destination,
            keptIdentity: true,
          },
        };
      }
    }

    const taken = await this.items.take(cmd.from, cmd.itemId, cmd.quantity);

    if (!taken) {
      return { ok: false, reason: "not-enough" };
    }

    const destination = await this.items.give({
      owner: cmd.to,
      templateId: stack.templateId,
      quantity: cmd.quantity,
      effects: parseItemEffects(stack.effects),
    });

    await this.write(cmd, txId, destination.id, stack.templateId, cmd.quantity);

    return {
      ok: true,
      move: {
        source: stack,
        quantity: cmd.quantity,
        sourceRemaining: taken.remaining,
        destination,
        keptIdentity: false,
      },
    };
  }

  private write(
    cmd: TransferCommand,
    txId: string,
    itemId: string,
    templateId: number,
    quantity: number
  ): Promise<void> {
    return this.ledger.record({
      txId,
      actorCharacterId: cmd.actorCharacterId,
      from: cmd.from,
      to: cmd.to,
      itemId,
      templateId,
      quantity,
      exchangeKind: cmd.exchangeKind ?? null,
      exchangeSessionId: cmd.exchangeSessionId ?? null,
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
