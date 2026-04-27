import type {
  EffectHandler,
  Scope,
} from "@modules/fight/effects/fight.effect-registry.types";
import { FightStateId } from "@modules/fight/fight.types";

export type {
  EffectHandler,
  Emitter,
  Scope,
} from "@modules/fight/effects/fight.effect-registry.types";

export function rollEffect(scope: Scope): number {
  const { min, max } = scope.effect;
  if (max <= min) {
    return min;
  }
  if (scope.caster.states.has(FightStateId.RollMinimize)) {
    return min;
  }
  if (scope.caster.states.has(FightStateId.RollMaximize)) {
    return max;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

export class EffectRegistry {
  private handlers = new Map<number, EffectHandler>();

  register(id: number, h: EffectHandler): void {
    this.handlers.set(id, h);
  }

  handler(id: number): EffectHandler | undefined {
    return this.handlers.get(id);
  }
}
