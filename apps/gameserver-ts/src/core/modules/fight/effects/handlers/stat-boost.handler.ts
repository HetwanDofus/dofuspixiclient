import type { Buff } from "@modules/fight/effects/fight.buff.types";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { emptyStatModifier } from "@modules/fight/effects/fight.buff.types";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Characteristic } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";
import { match } from "ts-pattern";

function resolveCharacteristic(effectId: number): {
  char: Characteristic;
  negate: boolean;
} {
  return match(effectId)
    .with(78, 128, () => ({
      char: Characteristic.MovementPoints,
      negate: false,
    }))
    .with(111, 120, () => ({
      char: Characteristic.ActionPoints,
      negate: false,
    }))
    .with(112, 121, () => ({ char: Characteristic.DamageBonus, negate: false }))
    .with(115, () => ({ char: Characteristic.CriticalHit, negate: false }))
    .with(117, () => ({ char: Characteristic.Range, negate: false }))
    .with(118, () => ({ char: Characteristic.Strength, negate: false }))
    .with(119, () => ({ char: Characteristic.Agility, negate: false }))
    .with(123, () => ({ char: Characteristic.Chance, negate: false }))
    .with(124, () => ({ char: Characteristic.Wisdom, negate: false }))
    .with(125, () => ({ char: Characteristic.Vitality, negate: false }))
    .with(126, () => ({ char: Characteristic.Intelligence, negate: false }))
    .with(138, () => ({ char: Characteristic.DamagePercent, negate: false }))
    .with(145, () => ({ char: Characteristic.DamageBonus, negate: true }))
    .with(152, () => ({ char: Characteristic.Chance, negate: true }))
    .with(153, () => ({ char: Characteristic.Vitality, negate: true }))
    .with(154, () => ({ char: Characteristic.Agility, negate: true }))
    .with(155, () => ({ char: Characteristic.Intelligence, negate: true }))
    .with(157, () => ({ char: Characteristic.Strength, negate: true }))
    .otherwise(() => ({ char: Characteristic.Strength, negate: false }));
}

@Injectable()
export class StatBoostEffectHandler {
  @EffectHandler(
    78,
    111,
    112,
    115,
    117,
    118,
    119,
    120,
    121,
    123,
    124,
    125,
    126,
    128,
    138,
    145,
    152,
    153,
    154,
    155,
    157
  )
  handle(scope: Scope): void {
    const target = scope.target;
    if (!target || target.dead) {
      return;
    }
    const { char, negate } = resolveCharacteristic(scope.effect.id);
    const roll = rollEffect(scope);
    const value = negate ? -roll : roll;

    target.stats.addBuff(char, value);

    const buff: Buff = {
      id: 0,
      effectId: scope.effect.id,
      casterId: scope.caster.id,
      targetId: target.id,
      remaining: scope.effect.duration,
      value,
      statModifier: emptyStatModifier(),
      onRemove: (_fight, t) => {
        t.stats.removeBuff(char, value);
      },
    };
    target.buffs.add(buff);
    scope.emitter.emitBuff(scope.fight, scope.caster.id, target.id, buff);
  }
}
