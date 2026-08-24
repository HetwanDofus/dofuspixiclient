import type { PlayerAccessoryPresence } from "@modules/player-presence/player-presence.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { Injectable } from "@nestjs/common";
import { match, P } from "ts-pattern";

/**
 * Equipped item position → client-side look ordinal. The 1.29 client expects
 * five accessory slots in this order: weapon, hat, cape, pet, shield.
 *
 *   position 1  = weapon  → ordinal 0
 *   position 6  = hat     → ordinal 1
 *   position 7  = cape    → ordinal 2
 *   position 8  = pet     → ordinal 3
 *   position 15 = shield  → ordinal 4
 *
 * These positions come from `EquipmentPosition` / `items.json`'s `I.ss`
 * (see `packages/protocol/src/item-types.ts` — the values there were wrong
 * for hat/cape/pet/shield until they were re-derived from that bundle; this
 * table must stay in lockstep with it). Anything outside those five
 * positions is a worn piece with no client look representation
 * (amulet/ring/belt/boots/dofus/mount) and is skipped here.
 */
function positionToOrdinal(position: number): number | null {
  return match(position)
    .with(1, () => 0)
    .with(6, () => 1)
    .with(7, () => 2)
    .with(8, () => 3)
    .with(15, () => 4)
    .otherwise(() => null);
}

@Injectable()
export class AccessoriesService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly templateCache: ItemTemplateCacheService
  ) {}

  /**
   * Visible accessories for a character's look — resolved from equipped items
   * + their item_template.gfx_id. Items in non-look slots (amulet/boots/…)
   * are filtered out, and items whose template's gfx_id is 0 are skipped
   * (unset in the seed — client would try to fetch a non-existent sprite).
   */
  async buildPresence(playerId: string): Promise<PlayerAccessoryPresence[]> {
    const equipped = await this.inventory.findEquipped(playerId);

    // Only visible slots matter for the character look. Filter first so we
    // never fetch a template for items that'll be discarded anyway (belts,
    // rings, dofus, mounts — all off the Dofus 1.29 look).
    const visible = equipped.flatMap((item) => {
      const ordinal = positionToOrdinal(item.position);
      return ordinal === null ? [] : [{ item, ordinal }];
    });
    if (visible.length === 0) {
      return [];
    }

    // Templates fetch in parallel — cache hits are sync anyway and misses
    // shouldn't serialize since a player rarely has more than five look
    // items equipped.
    const rows = await Promise.all(
      visible.map(({ item }) => this.templateCache.load(item.templateId))
    );

    const out: PlayerAccessoryPresence[] = [];
    for (let i = 0; i < visible.length; i++) {
      const template = rows[i];
      if (!template || template.gfxId <= 0) {
        continue;
      }
      out.push({
        itemType: template.type,
        gfxId: template.gfxId,
        ordinal: visible[i]?.ordinal ?? 0,
      });
    }

    out.sort((a, b) => a.ordinal - b.ordinal);
    return out;
  }
}

// Suppress unused import warning on lint passes that don't treat `P` as used.
void P;
