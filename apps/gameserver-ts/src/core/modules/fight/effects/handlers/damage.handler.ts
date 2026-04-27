import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import {
  applyDamageToTarget,
  calculateDamage,
} from "@modules/fight/effects/fight.damage";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { effectIdToElement } from "@modules/fight/effects/fight.element-map";
import { Element } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";

@Injectable()
export class DamageEffectHandler {
  @EffectHandler(96, 97, 98, 99, 100)
  handle(scope: Scope): void {
    const element = effectIdToElement(scope.effect.id) ?? Element.Neutral;

    const damage = calculateDamage(scope, element);
    applyDamageToTarget(scope, damage, element);
  }
}
