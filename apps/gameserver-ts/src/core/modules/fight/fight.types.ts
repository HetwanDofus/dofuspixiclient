export const Characteristic = {
  Strength: 10,
  Vitality: 11,
  Wisdom: 12,
  Chance: 13,
  Agility: 14,
  Intelligence: 15,
  ActionPoints: 20,
  MovementPoints: 21,
  MaxSummons: 30,
  Initiative: 31,
  Discernment: 32,
  Range: 33,
  DamageBonus: 40,
  DamagePercent: 41,
  DamageNeutral: 42,
  DamageEarth: 43,
  DamageFire: 44,
  DamageWater: 45,
  DamageAir: 46,
  DamagePhysical: 47,
  DamageMagic: 48,
  HealBonus: 49,
  DamageTrap: 50,
  DamageTrapPercent: 51,
  Power: 52,
  CriticalDamage: 53,
  CriticalHit: 54,
  CriticalResist: 55,
  ReflectFlat: 56,
  ReflectPercent: 57,
  PushDamage: 58,
  PushResist: 59,
  ResistNeutral: 60,
  ResistNeutralPct: 61,
  ResistEarth: 62,
  ResistEarthPct: 63,
  ResistWater: 64,
  ResistWaterPct: 65,
  ResistAir: 66,
  ResistAirPct: 67,
  ResistFire: 68,
  ResistFirePct: 69,
  DodgeAP: 70,
  DodgeMP: 71,
  APLossResist: 72,
  MPLossResist: 73,
  Prospection: 74,
} as const;
export type Characteristic =
  (typeof Characteristic)[keyof typeof Characteristic];

export const Element = {
  Neutral: 0,
  Earth: 1,
  Fire: 2,
  Water: 3,
  Air: 4,
} as const;
export type Element = (typeof Element)[keyof typeof Element];

export function elementIndex(e: Element): number {
  return e;
}

export const FighterKind = {
  Player: 1,
  Monster: 2,
  Invocation: 3,
  Static: 4,
  Double: 5,
  Perceptor: 6,
} as const;
export type FighterKind = (typeof FighterKind)[keyof typeof FighterKind];

export const FightType = {
  Challenge: 0,
  PvM: 1,
  PvT: 2,
  PvMPvP: 3,
  Aggro: 4,
  Aggression: 5,
  Event: 6,
} as const;
export type FightType = (typeof FightType)[keyof typeof FightType];

export function fightTypeHasRewards(t: FightType): boolean {
  return t === FightType.PvM || t === FightType.PvT || t === FightType.Aggro;
}

export type { AreaKind as AreaKindValue } from "@dofus/grid";
// Re-exported from @dofus/grid — canonical definition lives in
// packages/grid/src/area.ts so client and server share identical values
// and type shape.
export { AreaKind } from "@dofus/grid";

export const FightStateId = {
  Rooted: 6,
  Pacified: 7,
  Weapon: 9,
  Stealth: 10,
  Slow: 11,
  Sleeping: 12,
  Carrying: 13,
  Carried: 14,
  Web: 15,
  SoulEater: 19,
  OnGlyph: 34,
  Suicide: 50,
  Free: 75,
  Revealed: 77,
  AlignmentLock: 100,
  SkipTurn: 101,
  RollMinimize: 102,
  RollMaximize: 103,
} as const;
export type FightStateId = (typeof FightStateId)[keyof typeof FightStateId];

export const StateName = {
  Null: 0,
  Initialise: 1,
  Placement: 2,
  Active: 3,
} as const;
export type StateName = (typeof StateName)[keyof typeof StateName];

export const TeamSide = { Side0: 0, Side1: 1 } as const;
export type TeamSide = (typeof TeamSide)[keyof typeof TeamSide];

export const FightObjectKind = {
  Trap: 1,
  Glyph: 2,
} as const;
export type FightObjectKind =
  (typeof FightObjectKind)[keyof typeof FightObjectKind];
