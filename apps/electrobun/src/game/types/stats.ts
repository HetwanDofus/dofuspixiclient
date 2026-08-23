export interface StatValue {
  base: number;
  items: number;
  boost: number;
}

/** What a `StatValue` is actually worth: base plus every bonus. */
export function statTotal(v: StatValue): number {
  return v.base + v.items + v.boost;
}

/** The part of a `StatValue` that came from gear and buffs. */
export function statBonus(v: StatValue): number {
  return v.items + v.boost;
}

export interface CharacterStats {
  vitality: StatValue;
  wisdom: StatValue;
  strength: StatValue;
  chance: StatValue;
  agility: StatValue;
  intelligence: StatValue;
  hp: number;
  maxHp: number;
  /**
   * AP, MP, range and summon limit are `StatValue` rather than plain
   * numbers because equipment moves them: an Ocre Dofus is +1 AP, and
   * flattening to `.base` here made every such bonus invisible in the
   * characteristics window.
   */
  ap: StatValue;
  mp: StatValue;
  energy: number;
  maxEnergy: number;
  bonusPoints: number;
  bonusPointsSpell: number;
  xp: number;
  xpLow: number;
  xpHigh: number;
  level: number;
  kama: number;
  initiative: number;
  discernment: number;
  range: StatValue;
  summonLimit: StatValue;
  /**
   * Achievement points ("points de succès"), the trophy line in the
   * characteristics window header. 0 until the server grows an
   * achievement system.
   */
  successPoints: number;
  /**
   * Critical-hit bonus from gear ("Coups Critiques"). Subtracted from a
   * spell's 1/x critical rate to give the "CC actuels" the spell book
   * shows — see `effectiveCriticalRate` in the spells HUD.
   */
  criticalHit: number;
}

export const STAT_IDS = {
  VITALITY: 0,
  WISDOM: 1,
  STRENGTH: 2,
  CHANCE: 3,
  AGILITY: 4,
  INTELLIGENCE: 5,
} as const;

export const STAT_NAMES: Record<number, string> = {
  [STAT_IDS.VITALITY]: "Vitalité",
  [STAT_IDS.WISDOM]: "Sagesse",
  [STAT_IDS.STRENGTH]: "Force",
  [STAT_IDS.CHANCE]: "Chance",
  [STAT_IDS.AGILITY]: "Agilité",
  [STAT_IDS.INTELLIGENCE]: "Intelligence",
};

/**
 * `STAT_IDS` → the id `AccountUseBoost.stat_id` expects.
 *
 * The 1.29 wire numbers the six characteristics 10-15 (the same block
 * the server's fight engine uses for its `Characteristic` map), which
 * has nothing to do with the 0-5 the panel indexes its own tables by.
 * Convert here, on the way out, and nowhere else.
 */
export const BOOST_WIRE_STAT_IDS: Record<number, number> = {
  [STAT_IDS.STRENGTH]: 10,
  [STAT_IDS.VITALITY]: 11,
  [STAT_IDS.WISDOM]: 12,
  [STAT_IDS.CHANCE]: 13,
  [STAT_IDS.AGILITY]: 14,
  [STAT_IDS.INTELLIGENCE]: 15,
};

export const STAT_COLORS: Record<number, number> = {
  [STAT_IDS.VITALITY]: 0xcc3333,
  [STAT_IDS.WISDOM]: 0xcccc33,
  [STAT_IDS.STRENGTH]: 0xcc6600,
  [STAT_IDS.CHANCE]: 0x3399cc,
  [STAT_IDS.AGILITY]: 0x33cc33,
  [STAT_IDS.INTELLIGENCE]: 0x9933cc,
};
