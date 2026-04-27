import type { Buff } from "@modules/fight/effects/fight.buff.types";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { emptyStatModifier } from "@modules/fight/effects/fight.buff.types";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { FightStateId } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";

@Injectable()
export class StateEffectHandler {
  @EffectHandler(140)
  handleSkipTurn(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    scope.target.states.set(FightStateId.SkipTurn, 1);
  }

  @EffectHandler(150)
  handleInvisibility(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    scope.target.states.set(FightStateId.Stealth, scope.effect.duration);
    const buff: Buff = {
      id: 0,
      effectId: 150,
      casterId: scope.caster.id,
      targetId: scope.target.id,
      remaining: scope.effect.duration,
      value: 0,
      statModifier: emptyStatModifier(),
      onRemove: (_fight, t) => {
        t.states.clear(FightStateId.Stealth);
      },
    };
    scope.target.buffs.add(buff);
    scope.emitter.emitBuff(scope.fight, scope.caster.id, scope.target.id, buff);
  }

  @EffectHandler(781)
  handleMinimize(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    scope.target.states.set(FightStateId.RollMinimize, scope.effect.duration);
  }

  @EffectHandler(782)
  handleMaximize(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    scope.target.states.set(FightStateId.RollMaximize, scope.effect.duration);
  }

  @EffectHandler(950)
  handleSetState(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    scope.target.states.set(
      scope.effect.special as FightStateId,
      scope.effect.duration
    );
  }

  @EffectHandler(951)
  handleRemoveState(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    scope.target.states.clear(scope.effect.special as FightStateId);
  }
}
