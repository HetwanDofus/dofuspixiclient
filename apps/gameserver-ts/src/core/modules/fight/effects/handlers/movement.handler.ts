import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { rollEffect } from "@modules/fight/effects/fight.effect-registry";
import { Injectable } from "@nestjs/common";
import { match } from "ts-pattern";

@Injectable()
export class MovementEffectHandler {
  @EffectHandler(4)
  handleTeleport(scope: Scope): void {
    const { caster } = scope;
    const fromCell = caster.cell;
    const toCell = scope.targetCell;
    scope.fight.fightMap.free(fromCell, caster.id);
    caster.cell = toCell;
    scope.fight.fightMap.occupy(toCell, caster.id);
    scope.emitter.emitTeleport(scope.fight, caster.id, fromCell, toCell);
  }

  @EffectHandler(5)
  handlePush(scope: Scope): void {
    const target = scope.target;
    if (!target || target.dead) {
      return;
    }
    const steps = rollEffect(scope);
    this.moveAway(scope, target, scope.caster.cell, steps);
  }

  @EffectHandler(6)
  handlePull(scope: Scope): void {
    const target = scope.target;
    if (!target || target.dead) {
      return;
    }
    const steps = rollEffect(scope);
    this.moveToward(scope, target, scope.caster.cell, steps);
  }

  @EffectHandler(8)
  handleSwap(scope: Scope): void {
    const target = scope.target;
    if (!target || target.dead) {
      return;
    }
    const { caster } = scope;
    const fmap = scope.fight.fightMap;
    const cCell = caster.cell;
    const tCell = target.cell;
    fmap.free(cCell, caster.id);
    fmap.free(tCell, target.id);
    caster.cell = tCell;
    target.cell = cCell;
    fmap.occupy(tCell, caster.id);
    fmap.occupy(cCell, target.id);
    scope.emitter.emitTeleport(scope.fight, caster.id, cCell, tCell);
    scope.emitter.emitTeleport(scope.fight, target.id, tCell, cCell);
  }

  private moveAway(
    scope: Scope,
    target: Fighter,
    fromCell: number,
    steps: number
  ): void {
    const fmap = scope.fight.fightMap;
    const delta = target.cell - fromCell;
    if (delta === 0) {
      return;
    }
    const dir = this.inferDirection(fmap.width, delta);
    const origCell = target.cell;
    let cell = target.cell;
    const total = fmap.width * fmap.height * 2;
    for (let i = 0; i < steps; i++) {
      const next = cell + dir;
      if (next < 0 || next >= total || !fmap.isFree(next)) {
        break;
      }
      cell = next;
    }
    if (cell !== origCell) {
      fmap.free(origCell, target.id);
      target.cell = cell;
      fmap.occupy(cell, target.id);
      scope.emitter.emitTeleport(scope.fight, target.id, origCell, cell);
    }
  }

  private moveToward(
    scope: Scope,
    target: Fighter,
    towardCell: number,
    steps: number
  ): void {
    const fmap = scope.fight.fightMap;
    const delta = towardCell - target.cell;
    if (delta === 0) {
      return;
    }
    const dir = this.inferDirection(fmap.width, delta);
    const origCell = target.cell;
    let cell = target.cell;
    const total = fmap.width * fmap.height * 2;
    for (let i = 0; i < steps; i++) {
      const next = cell + dir;
      if (
        next < 0 ||
        next >= total ||
        !fmap.isFree(next) ||
        next === towardCell
      ) {
        break;
      }
      cell = next;
    }
    if (cell !== origCell) {
      fmap.free(origCell, target.id);
      target.cell = cell;
      fmap.occupy(cell, target.id);
      scope.emitter.emitTeleport(scope.fight, target.id, origCell, cell);
    }
  }

  private inferDirection(width: number, delta: number): number {
    const stride = 2 * width - 1;
    const absDelta = Math.abs(delta);
    const sign = delta > 0 ? 1 : -1;
    return match(absDelta)
      .with(1, () => sign)
      .with(width, () => sign * width)
      .with(stride, () => sign * stride)
      .with(width - 1, () => sign * (width - 1))
      .otherwise(() => sign);
  }
}
