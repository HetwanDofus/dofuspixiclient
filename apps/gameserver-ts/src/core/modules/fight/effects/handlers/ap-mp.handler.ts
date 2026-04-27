import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ApMpEffectHandler {
  @EffectHandler(101)
  handleApLoss(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const loss = Math.min(rollEffect(scope), scope.target.ap);
    if (loss <= 0) {
      return;
    }
    scope.target.spendAp(loss);
    scope.emitter.emitAPLoss(
      scope.fight,
      scope.caster.id,
      scope.target.id,
      loss
    );
  }

  @EffectHandler(127)
  handleMpLoss(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const loss = Math.min(rollEffect(scope), scope.target.mp);
    if (loss <= 0) {
      return;
    }
    scope.target.spendMp(loss);
    scope.emitter.emitMPLoss(
      scope.fight,
      scope.caster.id,
      scope.target.id,
      loss
    );
  }

  @EffectHandler(84)
  handleApSteal(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const loss = Math.min(rollEffect(scope), scope.target.ap);
    if (loss <= 0) {
      return;
    }
    scope.target.spendAp(loss);
    scope.emitter.emitAPLoss(
      scope.fight,
      scope.caster.id,
      scope.target.id,
      loss
    );
    scope.caster.resetAp(scope.caster.ap + loss);
  }

  @EffectHandler(77)
  handleMpSteal(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const loss = Math.min(rollEffect(scope), scope.target.mp);
    if (loss <= 0) {
      return;
    }
    scope.target.spendMp(loss);
    scope.emitter.emitMPLoss(
      scope.fight,
      scope.caster.id,
      scope.target.id,
      loss
    );
    scope.caster.resetMp(scope.caster.mp + loss);
  }
}
