import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Characteristic, Element } from "@modules/fight/fight.types";
import { match } from "ts-pattern";

export function elementStat(element: number): Characteristic {
  return match(element)
    .with(Element.Earth, () => Characteristic.Strength)
    .with(Element.Water, () => Characteristic.Chance)
    .with(Element.Fire, () => Characteristic.Intelligence)
    .with(Element.Air, () => Characteristic.Agility)
    .otherwise(() => Characteristic.Strength);
}

export function elementResistFlat(element: number): Characteristic {
  return match(element)
    .with(Element.Neutral, () => Characteristic.ResistNeutral)
    .with(Element.Earth, () => Characteristic.ResistEarth)
    .with(Element.Water, () => Characteristic.ResistWater)
    .with(Element.Fire, () => Characteristic.ResistFire)
    .with(Element.Air, () => Characteristic.ResistAir)
    .otherwise(() => Characteristic.ResistNeutral);
}

export function elementResistPct(element: number): Characteristic {
  return match(element)
    .with(Element.Neutral, () => Characteristic.ResistNeutralPct)
    .with(Element.Earth, () => Characteristic.ResistEarthPct)
    .with(Element.Water, () => Characteristic.ResistWaterPct)
    .with(Element.Fire, () => Characteristic.ResistFirePct)
    .with(Element.Air, () => Characteristic.ResistAirPct)
    .otherwise(() => Characteristic.ResistNeutralPct);
}

export function calculateDamage(scope: Scope, element: number): number {
  const roll = rollEffect(scope);
  const { caster, target } = scope;
  if (!target) {
    return 0;
  }

  const stat = caster.stats.get(elementStat(element));
  const pctDmg = caster.stats.get(Characteristic.DamagePercent);
  const flatDmg = caster.stats.get(Characteristic.DamageBonus);

  const raw = Math.floor(roll * ((100 + stat + pctDmg) / 100)) + flatDmg;

  const flatRes = target.stats.get(elementResistFlat(element));
  let pctRes = target.stats.get(elementResistPct(element));
  if (target.player) {
    pctRes = Math.min(50, pctRes);
  }

  const afterFlat = raw - flatRes;
  return Math.max(0, Math.floor(afterFlat - (afterFlat * pctRes) / 100));
}

export function applyDamageToTarget(
  scope: Scope,
  damage: number,
  element: number
): void {
  const { target, caster, fight, emitter } = scope;
  if (!target || target.dead || damage <= 0) {
    return;
  }

  target.setLp(target.lp - damage);
  caster.damageDealt += damage;
  target.damageTaken += damage;
  emitter.emitDamage(fight, caster.id, target.id, damage, element);

  if (target.dead) {
    emitter.emitDeath(fight, target.id);
    fight.modules.fireFighterDied(fight, target);
  }
}

export function healTarget(scope: Scope, amount: number): void {
  const { target, caster, fight, emitter } = scope;
  if (!target || target.dead || amount <= 0) {
    return;
  }

  const actual = Math.min(amount, target.lpMax - target.lp);
  if (actual <= 0) {
    return;
  }

  target.setLp(target.lp + actual);
  emitter.emitHeal(fight, caster.id, target.id, actual);
}
