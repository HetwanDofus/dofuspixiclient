import type { Buff } from "@modules/fight/effects/fight.buff.types";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { emptyStatModifier } from "@modules/fight/effects/fight.buff.types";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Characteristic } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";
import { match } from "ts-pattern";

@Injectable()
export class StatStealEffectHandler {
  @EffectHandler(266, 267, 268, 269, 270, 271, 320)
  handle(scope: Scope): void {
    const target = scope.target;
    if (!target || target.dead) {
      return;
    }

    const char = match(scope.effect.id)
      .with(266, () => Characteristic.Chance)
      .with(267, () => Characteristic.Vitality)
      .with(268, () => Characteristic.Agility)
      .with(269, () => Characteristic.Intelligence)
      .with(270, () => Characteristic.Wisdom)
      .with(271, () => Characteristic.Strength)
      .with(320, () => Characteristic.Range)
      .otherwise(() => Characteristic.Strength);

    const value = rollEffect(scope);

    // Debuff target
    target.stats.addBuff(char, -value);
    const debuff: Buff = {
      id: 0,
      effectId: scope.effect.id,
      casterId: scope.caster.id,
      targetId: target.id,
      remaining: scope.effect.duration,
      value: -value,
      statModifier: emptyStatModifier(),
      onRemove: (_fight, t) => {
        t.stats.removeBuff(char, -value);
      },
    };
    target.buffs.add(debuff);

    // Buff caster
    scope.caster.stats.addBuff(char, value);
    const boost: Buff = {
      id: 0,
      effectId: scope.effect.id,
      casterId: scope.caster.id,
      targetId: scope.caster.id,
      remaining: scope.effect.duration,
      value,
      statModifier: emptyStatModifier(),
      onRemove: (_fight, c) => {
        c.stats.removeBuff(char, value);
      },
    };
    scope.caster.buffs.add(boost);
    scope.emitter.emitBuff(scope.fight, scope.caster.id, target.id, debuff);
  }
}
