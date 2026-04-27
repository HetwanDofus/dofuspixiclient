import type { SpellLevel } from "@modules/fight/cast/fight.spell.types";
import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";

export interface DamageContext {
  attacker: Fighter;
  defender: Fighter;
  element: number;
  amount: number;
  critical: boolean;
  indirect: boolean;
  absorbed: number;
  reflected: number;
}

export interface CastContext {
  caster: Fighter;
  target: Fighter | null;
  targetCell: number;
  spell: SpellLevel;
  critical: boolean;
}

export interface StatModifier {
  ap: number;
  mp: number;
  strength: number;
  intelligence: number;
  chance: number;
  agility: number;
  wisdom: number;
  vitality: number;
  power: number;
  range: number;
  damageBonus: number;
  damagePct: number;
  healBonus: number;
  reflectFlat: number;
  reflectPct: number;
  criticalHit: number;
  criticalResist: number;
  resistFlat: [number, number, number, number, number];
  resistPct: [number, number, number, number, number];
  armorFlat: number;
}

export function emptyStatModifier(): StatModifier {
  return {
    ap: 0,
    mp: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    wisdom: 0,
    vitality: 0,
    power: 0,
    range: 0,
    damageBonus: 0,
    damagePct: 0,
    healBonus: 0,
    reflectFlat: 0,
    reflectPct: 0,
    criticalHit: 0,
    criticalResist: 0,
    resistFlat: [0, 0, 0, 0, 0],
    resistPct: [0, 0, 0, 0, 0],
    armorFlat: 0,
  };
}

export interface Buff {
  id: number;
  effectId: number;
  casterId: number;
  targetId: number;
  remaining: number;
  value: number;
  statModifier: StatModifier;

  onApply?: (fight: Fight, target: Fighter) => void;
  onRemove?: (fight: Fight, target: Fighter) => void;
  onTurnStart?: (fight: Fight, target: Fighter) => void;
  onTurnEnd?: (fight: Fight, target: Fighter) => void;
  onCast?: (fight: Fight, ctx: CastContext) => void;
  onTargetedBy?: (fight: Fight, ctx: CastContext) => void;
  onDirectDamage?: (fight: Fight, ctx: DamageContext) => void;
  onIndirectDamage?: (fight: Fight, ctx: DamageContext) => void;
  onBlockDamage?: (fight: Fight, ctx: DamageContext) => void;
  onReflectDamage?: (fight: Fight, ctx: DamageContext) => void;
  preMeleeHit?: (fight: Fight, attacker: Fighter, target: Fighter) => boolean;
  resolveTarget?: (fight: Fight, original: Fighter) => Fighter | null;
  onDeath?: (fight: Fight, target: Fighter) => void;
}
