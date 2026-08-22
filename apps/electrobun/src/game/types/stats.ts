export interface StatValue {
  base: number;
  items: number;
  boost: number;
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
  ap: number;
  mp: number;
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
  range: number;
  summonLimit: number;
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

export const STAT_COLORS: Record<number, number> = {
  [STAT_IDS.VITALITY]: 0xcc3333,
  [STAT_IDS.WISDOM]: 0xcccc33,
  [STAT_IDS.STRENGTH]: 0xcc6600,
  [STAT_IDS.CHANCE]: 0x3399cc,
  [STAT_IDS.AGILITY]: 0x33cc33,
  [STAT_IDS.INTELLIGENCE]: 0x9933cc,
};
