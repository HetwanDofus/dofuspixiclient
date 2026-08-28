import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB, ItemRow } from "@shared/db/schema";
import {
  type CriteriaContext,
  evaluateCriteria,
} from "@modules/inventory/equip-criteria";
import {
  canEquip,
  type EquipDenialReason,
  type EquippedSlot,
} from "@modules/inventory/equip-rules";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import {
  INVENTORY_POSITION,
  InventoryRepository,
} from "@modules/inventory/inventory.repository";
import { parseItemEffects } from "@modules/inventory/item-effects";
import { ItemPresentationCacheService } from "@modules/inventory/item-presentation.cache";
import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { currentPods, maxPods } from "@modules/inventory/pods";
import { LifeRegenService } from "@modules/life-regen/life-regen.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { maxLifePoints } from "@modules/stats/stats.constants";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

const WEAPON_POSITION = 1;
const SHIELD_POSITION = 15;

/**
 * `item_effects` id: instant heal, the only "use" effect this pass covers.
 *
 * Verified against `itemstats.json`, not against
 * `packages/protocol/src/item-types.ts`'s `ItemEffectId.HEAL_HP` (108) —
 * that table turned out to be wrong here too (see `item-types.ts`'s
 * comment on `EquipmentPosition` for the first time it was caught). Every
 * real potion/bread ("Fiole de Soin", "Pain d'Amakna", "Potion de Mini
 * Soin") encodes its heal as hex `6e` = **110** ("+#1 à #2 en vie" in
 * `effects.json`); 108 is a *different* effect ("PDV rendus") that no
 * item in the imported set actually carries.
 */
const HEAL_EFFECT_ID = 110;

export type InventoryActionReason =
  | "not-found"
  | "not-usable"
  | "no-supported-effect"
  | "criteria-not-met"
  | EquipDenialReason;

export type InventoryActionResult =
  | { ok: true }
  | { ok: false; reason: InventoryActionReason };

/**
 * The single place an inventory is *mutated*. `InventoryRepository` and
 * `InventoryFramesService` know how to read/write a row and how to build
 * a frame; this is where the rules from `equip-rules.ts` and
 * `equip-criteria.ts` are actually enforced and where the writes that
 * must land together are wrapped in one transaction.
 *
 * `item-move.handler.ts` used to do two or three separate `UPDATE`s with
 * no transaction around them — an unequip could be committed without the
 * matching equip landing right after it. Every method here runs inside
 * `txHost.withTransaction`, the same pattern `fight.end.service.ts` uses
 * for its own multi-write outcome, so the merchant/exchange/bank work
 * that reuses this later inherits the same guarantee instead of having
 * to invent it again.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly inventory: InventoryRepository,
    private readonly templates: ItemTemplateCacheService,
    private readonly presentation: ItemPresentationCacheService,
    private readonly players: PlayersRepository,
    private readonly frames: InventoryFramesService,
    private readonly lifeRegen: LifeRegenService
  ) {}

  /**
   * Equip an item. Refuses on any rule in `equip-rules.ts`/
   * `equip-criteria.ts`; otherwise unequips whatever already occupies the
   * target slot (and, for a two-handed weapon replacing a one-handed one,
   * a worn shield too — see the comment on `canEquip`), then equips.
   */
  async equip(
    sessionId: string,
    playerId: string,
    itemId: string,
    position: number
  ): Promise<InventoryActionResult> {
    return this.txHost.withTransaction(async () => {
      const item = await this.inventory.findOwned(playerId, itemId);
      if (!item) {
        return { ok: false, reason: "not-found" as const };
      }

      const template = await this.templates.load(item.templateId);
      if (!template) {
        return { ok: false, reason: "not-found" as const };
      }

      const player = await this.players.findById(playerId);
      if (!player) {
        return { ok: false, reason: "not-found" as const };
      }

      const superType = await this.presentation.loadSuperType(
        template.superType
      );

      const allItems = await this.inventory.findByPlayer(playerId);
      const otherEquipped = allItems.filter(
        (row) => row.id !== item.id && row.position >= 0
      );

      const equippedSlots = await this.toEquippedSlots(otherEquipped);
      const totals = await this.computeEquipTotals(otherEquipped);
      const weightByTemplate = await this.weightByTemplate(allItems);

      const baseStats = await this.players.findStats(playerId);
      const criteriaCtx: CriteriaContext = {
        strength: (baseStats?.strength ?? 0) + totals.strength,
        intelligence: (baseStats?.intelligence ?? 0) + totals.intelligence,
        agility: (baseStats?.agility ?? 0) + totals.agility,
        vitality: (baseStats?.vitality ?? 0) + totals.vitality,
        chance: (baseStats?.chance ?? 0) + totals.chance,
        wisdom: (baseStats?.wisdom ?? 0) + totals.wisdom,
        level: player.level,
        sex: player.sex,
      };

      const rules = canEquip({
        candidate: {
          superTypePositions: superType?.positions ?? [],
          twoHanded: template.twoHanded,
          level: template.level,
        },
        position,
        playerLevel: player.level,
        equipped: equippedSlots,
        currentPods: currentPods(allItems, weightByTemplate),
        maxPods: maxPods(criteriaCtx.strength, totals.podsBonus),
      });
      if (!rules.ok) {
        return rules;
      }

      if (
        !evaluateCriteria(template.criteria, criteriaCtx, (code, expr) =>
          this.logger.warn(
            `template ${template.id} ("${template.name}") uses an ` +
              `unsupported criteria code "${code}" in "${expr}" — refusing ` +
              "to equip rather than guess at its rule"
          )
        )
      ) {
        return { ok: false, reason: "criteria-not-met" as const };
      }

      // The occupant of the target slot, if any, goes back to the bag.
      const occupant = otherEquipped.find((row) => row.position === position);
      if (occupant) {
        await this.inventory.moveItem(occupant.id, INVENTORY_POSITION);
        this.frames.sendMovement(sessionId, occupant.id, INVENTORY_POSITION);
      }

      // A two-handed weapon replacing whatever is in the weapon slot also
      // displaces a worn shield — see the comment on `canEquip`.
      if (position === WEAPON_POSITION && template.twoHanded) {
        const shield = otherEquipped.find(
          (row) => row.position === SHIELD_POSITION && row.id !== occupant?.id
        );
        if (shield) {
          await this.inventory.moveItem(shield.id, INVENTORY_POSITION);
          this.frames.sendMovement(sessionId, shield.id, INVENTORY_POSITION);
        }
      }

      await this.inventory.moveItem(item.id, position);
      this.frames.sendMovement(sessionId, item.id, position);

      return { ok: true };
    });
  }

  /** Unequip an item back to the bag. No rule ever blocks this. */
  async unequip(
    sessionId: string,
    playerId: string,
    itemId: string
  ): Promise<InventoryActionResult> {
    return this.txHost.withTransaction(async () => {
      const item = await this.inventory.findOwned(playerId, itemId);
      if (!item || item.position < 0) {
        return { ok: false, reason: "not-found" as const };
      }

      await this.inventory.moveItem(item.id, INVENTORY_POSITION);
      this.frames.sendMovement(sessionId, item.id, INVENTORY_POSITION);

      return { ok: true };
    });
  }

  /**
   * Use a consumable. Only the instant-heal effect (108) is understood in
   * this pass — anything else on a `usable` template is left alone
   * (`no-supported-effect`) rather than consumed for no visible result.
   */
  async use(
    sessionId: string,
    playerId: string,
    itemId: string
  ): Promise<InventoryActionResult> {
    return this.txHost.withTransaction(async () => {
      const item = await this.inventory.findOwned(playerId, itemId);
      if (!item) {
        return { ok: false, reason: "not-found" as const };
      }

      const template = await this.templates.load(item.templateId);
      if (!template || !template.usable) {
        return { ok: false, reason: "not-usable" as const };
      }

      let effects = parseItemEffects(item.effects);
      if (effects.length === 0) {
        effects = parseItemEffects(template.effects);
      }
      const heal = effects.find((e) => e.id === HEAL_EFFECT_ID);
      if (!heal) {
        return { ok: false, reason: "no-supported-effect" as const };
      }

      const player = await this.players.findById(playerId);
      if (!player) {
        return { ok: false, reason: "not-found" as const };
      }

      const allItems = await this.inventory.findByPlayer(playerId);
      const equipped = allItems.filter((row) => row.position >= 0);
      const totals = await this.computeEquipTotals(equipped);
      const baseStats = await this.players.findStats(playerId);
      const totalVitality = (baseStats?.vitality ?? 0) + totals.vitality;
      const maxHp = maxLifePoints(player.level, totalVitality);

      const currentLife = await this.lifeRegen.resolve(player, maxHp);
      const newLife = Math.min(maxHp, currentLife + heal.param1);
      await this.players.setLife(playerId, newLife, new Date());

      if (item.quantity > 1) {
        await this.inventory.updateQuantity(item.id, item.quantity - 1);
        this.frames.sendItemQuantity(sessionId, item.id, item.quantity - 1);
      } else {
        await this.inventory.deleteItem(item.id);
        this.frames.sendItemRemove(sessionId, item.id);
      }

      return { ok: true };
    });
  }

  /**
   * `EquippedSlot`s (position + two-handed) for the rule checker, one
   * template load per row — cheap, `equipped` never exceeds sixteen items.
   */
  private async toEquippedSlots(
    rows: readonly ItemRow[]
  ): Promise<EquippedSlot[]> {
    const out: EquippedSlot[] = [];
    for (const row of rows) {
      const template = await this.templates.load(row.templateId);
      out.push({
        position: row.position,
        twoHanded: template?.twoHanded ?? false,
      });
    }
    return out;
  }

  /**
   * Sums the equipment-effect fields `equip-criteria.ts` and `pods.ts`
   * need. A deliberately narrow copy of `StatsService.applyItemEffect`'s
   * mapping rather than a shared dependency on it: `StatsModule` already
   * imports `InventoryModule`, so the reverse import would cycle.
   */
  private async computeEquipTotals(rows: readonly ItemRow[]): Promise<{
    strength: number;
    intelligence: number;
    agility: number;
    vitality: number;
    chance: number;
    wisdom: number;
    podsBonus: number;
  }> {
    const totals = {
      strength: 0,
      intelligence: 0,
      agility: 0,
      vitality: 0,
      chance: 0,
      wisdom: 0,
      podsBonus: 0,
    };

    for (const row of rows) {
      let effects = parseItemEffects(row.effects);
      if (effects.length === 0) {
        const template = await this.templates.load(row.templateId);
        if (template) {
          effects = parseItemEffects(template.effects);
        }
      }

      for (const effect of effects) {
        if (effect.param1 === 0) {
          continue;
        }
        switch (effect.id) {
          case 118:
            totals.strength += effect.param1;
            break;
          case 126:
            totals.intelligence += effect.param1;
            break;
          case 119:
            totals.agility += effect.param1;
            break;
          case 125:
            totals.vitality += effect.param1;
            break;
          case 123:
            totals.chance += effect.param1;
            break;
          case 124:
            totals.wisdom += effect.param1;
            break;
          case 158:
            totals.podsBonus += effect.param1;
            break;
          case 159:
            totals.podsBonus -= effect.param1;
            break;
          default:
            break;
        }
      }
    }

    return totals;
  }

  private async weightByTemplate(
    rows: readonly ItemRow[]
  ): Promise<Map<number, number>> {
    const templateIds = [...new Set(rows.map((row) => row.templateId))];
    const templates = await Promise.all(
      templateIds.map((id) => this.templates.load(id))
    );

    const map = new Map<number, number>();
    templateIds.forEach((id, i) => {
      const template = templates[i];
      if (template) {
        map.set(id, template.weight);
      }
    });
    return map;
  }
}
