import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { ShortcutsFramesService } from "@modules/shortcuts/shortcuts.frames.service";
import {
  isLegalSlot,
  ShortcutsRepository,
} from "@modules/shortcuts/shortcuts.repository";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

export type ShortcutActionReason =
  | "bad-slot"
  | "not-found"
  | "empty-slot"
  | "same-slot";

export type ShortcutActionResult =
  | { ok: true }
  | { ok: false; reason: ShortcutActionReason };

/**
 * The item half of the hotbar (`OrA` / `OrM` / `OrR`).
 *
 * A shortcut stores a *template*, resolved here from the unic id the
 * client drags. That indirection is what lets the slot survive its
 * stack: 1.29's `InventoryShortcutItem.findRealItem()` re-resolves the
 * template against the live inventory on every render, so a shortcut to
 * a drunk-empty stack greys out rather than vanishing, and refills by
 * itself when the player buys more.
 *
 * Spell slots are deliberately absent — they live in
 * `player_spells.position` and are moved by `SpellsService.moveToSlot`.
 */
@Injectable()
export class ShortcutsService {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly shortcuts: ShortcutsRepository,
    private readonly inventory: InventoryRepository,
    private readonly frames: ShortcutsFramesService
  ) {}

  /**
   * OrA — bind a slot to the template of the dragged stack.
   *
   * `itemUnicId` is a `player_items.id`; it must belong to the caller,
   * or a client could pin someone else's item into its own bar and read
   * a template it has never seen.
   */
  async add(
    sessionId: string,
    playerId: string,
    slot: number,
    itemUnicId: number
  ): Promise<ShortcutActionResult> {
    if (!isLegalSlot(slot)) {
      return { ok: false, reason: "bad-slot" };
    }

    return this.txHost.withTransaction(async () => {
      const item = await this.inventory.findById(String(itemUnicId));

      if (!item || item.playerId !== playerId) {
        return { ok: false, reason: "not-found" as const };
      }

      await this.shortcuts.put(playerId, slot, item.templateId);
      this.frames.sendAdd(sessionId, slot, item.templateId);

      return { ok: true as const };
    });
  }

  /**
   * OrM — drag a shortcut from one slot to another.
   *
   * The destination is overwritten, matching how a spell dropped onto an
   * occupied slot evicts its occupant (`MouseShortcuts.spellMove`). The
   * client is told about both ends: OrR for the slot vacated, OrA for
   * the slot claimed.
   */
  async move(
    sessionId: string,
    playerId: string,
    from: number,
    to: number
  ): Promise<ShortcutActionResult> {
    if (!isLegalSlot(from) || !isLegalSlot(to)) {
      return { ok: false, reason: "bad-slot" };
    }

    if (from === to) {
      return { ok: false, reason: "same-slot" };
    }

    return this.txHost.withTransaction(async () => {
      const row = await this.shortcuts.findSlot(playerId, from);

      if (!row) {
        return { ok: false, reason: "empty-slot" as const };
      }

      await this.shortcuts.deleteSlot(playerId, from);
      await this.shortcuts.put(playerId, to, row.templateId);

      this.frames.sendRemove(sessionId, from);
      this.frames.sendAdd(sessionId, to, row.templateId);

      return { ok: true as const };
    });
  }

  /** OrR — clear a slot. */
  async remove(
    sessionId: string,
    playerId: string,
    slot: number
  ): Promise<ShortcutActionResult> {
    if (!isLegalSlot(slot)) {
      return { ok: false, reason: "bad-slot" };
    }

    return this.txHost.withTransaction(async () => {
      const row = await this.shortcuts.findSlot(playerId, slot);

      if (!row) {
        return { ok: false, reason: "empty-slot" as const };
      }

      await this.shortcuts.deleteSlot(playerId, slot);
      this.frames.sendRemove(sessionId, slot);

      return { ok: true as const };
    });
  }
}
