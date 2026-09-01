import type { MonsterDropRow } from "@shared/db/schema";

import hunterMeatData from "../../../../data/hunter-meat-tiers.json";

/** The 1.29 job id of Chasseur. */
export const HUNTER_JOB_ID = 41;

/** `effects.json` 795 (`0x31b`), the flag carried by hunting weapons. */
export const HUNTING_WEAPON_EFFECT_ID = 795;

/** Item type 63 in the 1.29 bundle: raw meat. */
export const RAW_MEAT_ITEM_TYPE = 63;

/**
 * The dump gives every meat's base rate but no level scaling. The project
 * contract requires the chance to improve with mastery, so the named rule is:
 * half of the dump rate at the unlock level, +2.5 percentage points of that
 * rate per Hunter level, capped at the full dump rate after twenty levels.
 *
 * Keeping this isolated matters: it is a documented approximation, not a
 * value silently presented as StarLoco data.
 */
export const HUNTER_MASTERY_LEVELS = 20;

const MEAT_LEVELS = new Map(
  hunterMeatData.tiers.map((entry) => [entry.itemId, entry.minLevel])
);

export interface HunterDrop extends MonsterDropRow {
  itemType: number;
}

export interface HunterRollInput {
  hasHuntingWeapon: boolean;
  hunterLevel: number;
  /** Monster templates defeated, including duplicates in a multi-mob group. */
  monsterIds: readonly number[];
  drops: readonly HunterDrop[];
  prospection: number;
}

export interface HunterRoll {
  items: Array<{ templateId: number; quantity: number }>;
  experience: number;
}

/** The hand-curated 1.29 tier of one raw meat. */
export function hunterMeatLevel(itemTemplateId: number): number | null {
  return MEAT_LEVELS.get(itemTemplateId) ?? null;
}

/**
 * Profession XP paid by this project's combat-harvest contract.
 *
 * Retail 1.29 paid Chasseur XP while preserving meat at the bench, not while
 * looting it. The requested no-workbench loop deliberately pays here instead,
 * using the ordinary harvest schedule: 10 at tier 1, then +5 per ten levels.
 */
export function hunterExperienceAtTier(minLevel: number): number {
  return 10 + Math.floor(Math.max(0, minLevel) / 10) * 5;
}

/** Effective percentage after level mastery and ordinary prospection. */
export function hunterDropChance(
  baseRate: number,
  hunterLevel: number,
  minLevel: number,
  prospection: number
): number {
  if (hunterLevel < minLevel || baseRate <= 0) {
    return 0;
  }

  const gap = Math.min(HUNTER_MASTERY_LEVELS, hunterLevel - minLevel);
  const mastery = 0.5 + gap / (HUNTER_MASTERY_LEVELS * 2);

  return Math.min(100, baseRate * mastery * (Math.max(0, prospection) / 100));
}

/** Roll the raw-meat harvest of one winning hunter. */
export function rollHunterMeat(
  input: HunterRollInput,
  random: () => number = Math.random
): HunterRoll {
  if (!input.hasHuntingWeapon || input.hunterLevel <= 0) {
    return { items: [], experience: 0 };
  }

  const quantities = new Map<number, number>();
  let experience = 0;

  for (const monsterId of input.monsterIds) {
    for (const drop of input.drops) {
      if (
        drop.monsterId !== monsterId ||
        drop.itemType !== RAW_MEAT_ITEM_TYPE
      ) {
        continue;
      }

      const minLevel = hunterMeatLevel(drop.itemTemplateId);
      if (minLevel === null) {
        continue;
      }

      const chance = hunterDropChance(
        drop.rate,
        input.hunterLevel,
        minLevel,
        input.prospection
      );

      if (random() * 100 >= chance) {
        continue;
      }

      const quantity = rollQuantity(drop, random);
      quantities.set(
        drop.itemTemplateId,
        (quantities.get(drop.itemTemplateId) ?? 0) + quantity
      );
      experience += hunterExperienceAtTier(minLevel) * quantity;
    }
  }

  return {
    items: [...quantities].map(([templateId, quantity]) => ({
      templateId,
      quantity,
    })),
    experience,
  };
}

function rollQuantity(drop: MonsterDropRow, random: () => number): number {
  const min = Math.max(1, drop.minQuantity);
  const max = Math.max(min, drop.maxQuantity);

  return min === max ? min : min + Math.floor(random() * (max - min + 1));
}
