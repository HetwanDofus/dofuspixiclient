import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { healTarget } from "@modules/fight/effects/fight.damage";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Characteristic } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";

@Injectable()
export class HealEffectHandler {
  @EffectHandler(81, 108, 143)
  handle(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const roll = rollEffect(scope);
    const intel = scope.caster.stats.get(Characteristic.Intelligence);
    const healBonus = scope.caster.stats.get(Characteristic.HealBonus);
    const amount = Math.floor(roll * ((100 + intel) / 100)) + healBonus;
    healTarget(scope, amount);
  }
}
