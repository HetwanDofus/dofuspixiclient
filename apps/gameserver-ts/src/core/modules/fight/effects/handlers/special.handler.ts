import type { Buff } from "@modules/fight/effects/fight.buff.types";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { emptyStatModifier } from "@modules/fight/effects/fight.buff.types";
import {
  applyDamageToTarget,
  healTarget,
} from "@modules/fight/effects/fight.damage";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Characteristic, Element } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";

@Injectable()
export class SpecialEffectHandler {
  @EffectHandler(82)
  handleFixedLifeSteal(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const damage = Math.max(0, rollEffect(scope));
    applyDamageToTarget(scope, damage, Element.Neutral);
    if (damage > 0 && !scope.caster.dead) {
      healTarget({ ...scope, target: scope.caster }, damage);
    }
  }

  @EffectHandler(105, 265)
  handleDamageReduction(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const value = rollEffect(scope);
    const modifier = emptyStatModifier();
    modifier.armorFlat = value;
    const buff: Buff = {
      id: 0,
      effectId: scope.effect.id,
      casterId: scope.caster.id,
      targetId: scope.target.id,
      remaining: scope.effect.duration,
      value,
      statModifier: modifier,
      onRemove: () => {},
    };
    scope.target.buffs.add(buff);
    scope.emitter.emitBuff(scope.fight, scope.caster.id, scope.target.id, buff);
  }

  @EffectHandler(107)
  handleDamageReflect(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const value = rollEffect(scope);
    scope.target.stats.addBuff(Characteristic.ReflectFlat, value);
    const buff: Buff = {
      id: 0,
      effectId: 107,
      casterId: scope.caster.id,
      targetId: scope.target.id,
      remaining: scope.effect.duration,
      value,
      statModifier: emptyStatModifier(),
      onRemove: (_fight, t) => {
        t.stats.removeBuff(Characteristic.ReflectFlat, value);
      },
    };
    scope.target.buffs.add(buff);
    scope.emitter.emitBuff(scope.fight, scope.caster.id, scope.target.id, buff);
  }

  @EffectHandler(109)
  handleSelfDamage(scope: Scope): void {
    if (scope.caster.dead) {
      return;
    }
    const damage = Math.max(0, rollEffect(scope));
    applyDamageToTarget(
      { ...scope, target: scope.caster },
      damage,
      Element.Neutral
    );
  }

  @EffectHandler(110)
  handleMaxLifeBonus(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const value = rollEffect(scope);
    scope.target.lpMax += value;
    scope.target.setLp(scope.target.lp + value);
    const buff: Buff = {
      id: 0,
      effectId: 110,
      casterId: scope.caster.id,
      targetId: scope.target.id,
      remaining: scope.effect.duration,
      value,
      statModifier: emptyStatModifier(),
      onRemove: (_fight, t) => {
        t.lpMax = Math.max(1, t.lpMax - value);
        if (t.lp > t.lpMax) {
          t.setLp(t.lpMax);
        }
      },
    };
    scope.target.buffs.add(buff);
    scope.emitter.emitBuff(scope.fight, scope.caster.id, scope.target.id, buff);
  }

  @EffectHandler(132)
  handleDispel(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const dispelTarget = scope.target;
    dispelTarget.buffs.each((b) => {
      b.onRemove?.(scope.fight, dispelTarget);
    });
    scope.target.buffs.clear();
    scope.target.states.clearAll();
  }

  @EffectHandler(141)
  handleInstantDeath(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    scope.target.setLp(0);
    scope.emitter.emitDeath(scope.fight, scope.target.id);
    scope.fight.modules.fireFighterDied(scope.fight, scope.target);
  }

  @EffectHandler(142, 144)
  handleFixedDamage(scope: Scope): void {
    if (!scope.target || scope.target.dead) {
      return;
    }
    const damage = Math.max(0, rollEffect(scope));
    applyDamageToTarget(scope, damage, Element.Neutral);
  }

  @EffectHandler(780)
  handleRevive(scope: Scope): void {
    if (!scope.target) {
      return;
    }
    const hp = rollEffect(scope);
    scope.target.revive(hp);
  }
}
