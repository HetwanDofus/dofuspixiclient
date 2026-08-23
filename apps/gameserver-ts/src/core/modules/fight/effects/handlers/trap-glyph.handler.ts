import type { SpellEffect } from "@modules/fight/cast/fight.spell.types";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import type { FightObject } from "@modules/fight/map/fight.object.types";
import {
  applyDamageToTarget,
  calculateDamage,
} from "@modules/fight/effects/fight.damage";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { effectIdToElement } from "@modules/fight/effects/fight.element-map";
import { Element, FightObjectKind } from "@modules/fight/fight.types";
import { cellsInArea } from "@modules/fight/map/fight.area";
import { Injectable } from "@nestjs/common";

/**
 * Traps (effect 400) and glyphs (effect 401).
 *
 * Both are *wrappers*: the effect the caster's spell carries has no
 * damage of its own. By 1.29 convention its `min` holds the id of a
 * separate **trigger spell**, which is what actually hurts whoever sets
 * the thing off, and its `areaKind`/`areaSize` describe the zone that
 * triggers it. The cast use-case pre-loads that spell into
 * `scope.triggerSpell`.
 *
 * Everything below flows from getting those two facts right. Reading the
 * wrapper's own `min`/`max` as a damage range means dealing a spell id
 * as neutral damage; testing the wrapper's centre cell instead of its
 * zone means a glyph almost never fires, since the centre is the cell an
 * enemy is least likely to stand on.
 */

const TRAP_COLOR = 0xff8000;
const NEUTRAL_GLYPH_COLOR = 0xc8c8c8;
const ELEMENT_COLORS: Record<number, number> = {
  [Element.Neutral]: NEUTRAL_GLYPH_COLOR,
  [Element.Earth]: 0x8b6f3a,
  [Element.Fire]: 0xff5520,
  [Element.Water]: 0x3a86ff,
  [Element.Air]: 0x4ecdc4,
};

interface Trigger {
  /**
   * The damage effect to resolve, from the trigger spell. Null when the
   * trigger spell could not be loaded or carries no elemental damage —
   * the object is then inert rather than dealing nonsense.
   */
  effect: SpellEffect | null;
  element: Element;
}

/**
 * Find what a trap or glyph actually does when it fires.
 *
 * Walks the trigger spell's own effects for the first elemental damage
 * line (96/97/98/99/100 → Water/Earth/Air/Fire/Neutral) and returns both
 * it and its element. This walk already existed — but only to pick a
 * tint. The information was loaded, used for the colour, and thrown away
 * for the damage, which is precisely the bug.
 *
 * Falls back to the glyph spell's own effects for older data that puts
 * the damage on the wrapper.
 */
function resolveTrigger(scope: Scope): Trigger {
  const sources = [scope.triggerSpell?.effects ?? [], scope.spell.effects];

  for (const effects of sources) {
    for (const effect of effects) {
      const element = effectIdToElement(effect.id);

      if (element !== null) {
        return { effect, element };
      }
    }
  }

  return { effect: null, element: Element.Neutral };
}

/**
 * The cells a deployed object covers.
 *
 * Computed once, at creation, from the same canonical `cellsInArea` the
 * display uses — so what is drawn and what hurts cannot drift apart. The
 * object never moves, so there is nothing to recompute.
 *
 * Do not be tempted to walk neighbours by hand here: on this grid the
 * adjacent cells are at ±width and ±(width−1), never ±1.
 */
function zoneOf(scope: Scope): Set<number> {
  return new Set(
    cellsInArea(
      scope.fight.fightMap,
      scope.caster.cell,
      scope.targetCell,
      scope.effect.areaKind,
      scope.effect.areaSize
    )
  );
}

@Injectable()
export class TrapGlyphEffectHandler {
  @EffectHandler(400)
  handleTrap(scope: Scope): void {
    const trigger = resolveTrigger(scope);
    const zone = zoneOf(scope);

    const trap: FightObject = {
      id: 0,
      kind: FightObjectKind.Trap,
      casterId: scope.caster.id,
      cell: scope.targetCell,
      size: scope.effect.areaSize,
      element: trigger.element,
      spellId: scope.spell.spellId,
      spellLevel: scope.spell.level,
      color: TRAP_COLOR,
      remaining: -1,
      // A trap fires when someone steps anywhere in its zone, not only
      // on its centre. `FightMap.fireArrivalTriggers` consults this.
      cellEligible: (cell) => zone.has(cell),
      onArrival: (fight, victim) => {
        if (victim.dead || trigger.effect === null) {
          return true;
        }

        damage(scope, trigger, victim);
        scope.emitter.emitTrapRemove(fight, scope.targetCell);
        fight.checkFightEnd();

        return true;
      },
    };

    scope.fight.fightMap.objects.add(trap);
    scope.emitter.emitTrapAdd(
      scope.fight,
      scope.caster.id,
      scope.targetCell,
      scope.effect.areaSize,
      TRAP_COLOR,
      scope.effect.areaKind
    );
  }

  @EffectHandler(401)
  handleGlyph(scope: Scope): void {
    const trigger = resolveTrigger(scope);
    const zone = zoneOf(scope);
    const glyphColor = ELEMENT_COLORS[trigger.element] ?? NEUTRAL_GLYPH_COLOR;

    const glyph: FightObject = {
      id: 0,
      kind: FightObjectKind.Glyph,
      casterId: scope.caster.id,
      cell: scope.targetCell,
      size: scope.effect.areaSize,
      element: trigger.element,
      spellId: scope.spell.spellId,
      spellLevel: scope.spell.level,
      color: glyphColor,
      remaining: scope.effect.duration,
      cellEligible: (cell) => zone.has(cell),
      // A glyph fires against the fighter whose turn is beginning, and
      // only that fighter. It used to scan the whole roster on every
      // single turn start, so one glyph hit every enemy standing on it
      // once per fighter per round.
      onTurnStart: (fight, owner) => {
        if (trigger.effect === null || owner.dead) {
          return;
        }

        if (!zone.has(owner.cell)) {
          return;
        }

        if (owner.team?.side === scope.caster.team?.side) {
          return;
        }

        scope.emitter.emitGlyphTrigger(
          fight,
          scope.caster.id,
          scope.targetCell,
          scope.spell.spellId
        );

        damage(scope, trigger, owner);
        fight.checkFightEnd();
      },
    };

    scope.fight.fightMap.objects.add(glyph);
    scope.emitter.emitGlyphAdd(
      scope.fight,
      scope.caster.id,
      scope.targetCell,
      scope.effect.areaSize,
      glyphColor,
      scope.effect.areaKind
    );
  }
}

/**
 * Deal the trigger spell's damage to one victim.
 *
 * The scope handed to the damage functions carries the **trigger's**
 * effect, not the wrapper's: `calculateDamage` rolls `scope.effect`'s
 * min/max, and on a wrapper those are the trigger spell's id and zero —
 * which `rollEffect` resolves to the id itself. That is how a glyph came
 * to deal damage equal to a spell number.
 */
function damage(
  scope: Scope,
  trigger: Trigger,
  victim: Parameters<NonNullable<FightObject["onTurnStart"]>>[1]
): void {
  if (trigger.effect === null) {
    return;
  }

  const damageScope: Scope = {
    ...scope,
    effect: trigger.effect,
    target: victim,
  };

  applyDamageToTarget(
    damageScope,
    calculateDamage(damageScope, trigger.element),
    trigger.element
  );
}
