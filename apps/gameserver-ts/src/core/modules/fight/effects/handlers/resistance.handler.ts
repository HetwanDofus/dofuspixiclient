import type { Buff } from "@modules/fight/effects/fight.buff.types";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { emptyStatModifier } from "@modules/fight/effects/fight.buff.types";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Characteristic } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";
import { match } from "ts-pattern";

@Injectable()
export class ResistanceEffectHandler {
  @EffectHandler(183, 184, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219)
  handle(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }

    const { char, negate } = match(scope.effect.id)
      .with(183, () => ({ char: Characteristic.ResistWater, negate: false }))
      .with(184, () => ({ char: Characteristic.ResistNeutral, negate: false }))
      .with(210, () => ({ char: Characteristic.ResistEarthPct, negate: false }))
      .with(211, () => ({ char: Characteristic.ResistWaterPct, negate: false }))
      .with(212, () => ({ char: Characteristic.ResistAirPct, negate: false }))
      .with(213, () => ({ char: Characteristic.ResistFirePct, negate: false }))
      .with(214, () => ({
        char: Characteristic.ResistNeutralPct,
        negate: false,
      }))
      .with(215, () => ({ char: Characteristic.ResistEarthPct, negate: true }))
      .with(216, () => ({ char: Characteristic.ResistWaterPct, negate: true }))
      .with(217, () => ({ char: Characteristic.ResistAirPct, negate: true }))
      .with(218, () => ({ char: Characteristic.ResistFirePct, negate: true }))
      .with(219, () => ({
        char: Characteristic.ResistNeutralPct,
        negate: true,
      }))
      .otherwise(() => ({ char: Characteristic.ResistNeutral, negate: false }));

    const roll = rollEffect(scope);
    const value = negate ? -roll : roll;
    scope.target.stats.addBuff(char, value);
    const buff: Buff = {
      id: 0,
      effectId: scope.effect.id,
      casterId: scope.caster.id,
      targetId: scope.target.id,
      remaining: scope.effect.duration,
      value,
      statModifier: emptyStatModifier(),
      onRemove: (_fight, t) => {
        t.stats.removeBuff(char, value);
      },
    };
    scope.target.buffs.add(buff);
    scope.emitter.emitBuff(scope.fight, scope.caster.id, scope.target.id, buff);
  }
}
