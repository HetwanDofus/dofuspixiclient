import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import {
  applyDamageToTarget,
  calculateDamage,
  healTarget,
} from "@modules/fight/effects/fight.damage";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { Element } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";
import { match } from "ts-pattern";

@Injectable()
export class LifeStealEffectHandler {
  @EffectHandler(91, 92, 93, 94, 95)
  handle(scope: Scope): void {
    const element = match(scope.effect.id)
      .with(91, () => Element.Water)
      .with(92, () => Element.Earth)
      .with(93, () => Element.Air)
      .with(94, () => Element.Fire)
      .with(95, () => Element.Neutral)
      .otherwise(() => Element.Neutral);

    const damage = calculateDamage(scope, element);
    applyDamageToTarget(scope, damage, element);

    if (damage > 0 && !scope.caster.dead) {
      const heal = Math.floor(damage / 2);
      healTarget({ ...scope, target: scope.caster }, heal);
    }
  }
}
