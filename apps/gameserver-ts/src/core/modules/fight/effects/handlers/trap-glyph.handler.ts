import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import type { FightObject } from "@modules/fight/map/fight.object.types";
import {
  applyDamageToTarget,
  calculateDamage,
} from "@modules/fight/effects/fight.damage";
import { EffectHandler } from "@modules/fight/effects/fight.effect-handler.decorator";
import { effectIdToElement } from "@modules/fight/effects/fight.element-map";
import { Element, FightObjectKind } from "@modules/fight/fight.types";
import { Injectable } from "@nestjs/common";

/**
 * Element-keyed glyph/trap colors mirroring Dofus 1.29 visual
 * conventions. Traps universally render orange. Glyphs take their
 * trigger element's tint when we can derive it from the spell's
 * effects (`effectIdToElement`); otherwise fall back to neutral grey.
 *
 * TODO: glyph trigger spells (e.g. Sort Enflammé for Glyphe Enflammé)
 * are referenced by id in `effect.special`; loading their primary
 * damage effect would let us colourise glyphs by their actual trigger
 * element instead of the parent spell's first-effect element.
 */
const TRAP_COLOR = 0xff8000;
const ELEMENT_COLORS: Record<number, number> = {
  [Element.Neutral]: 0xc8c8c8,
  [Element.Earth]: 0x8b6f3a,
  [Element.Fire]: 0xff5520,
  [Element.Water]: 0x3a86ff,
  [Element.Air]: 0x4ecdc4,
};

function pickGlyphColor(scope: Scope): number {
  // Glyph spells (effect 401) only carry the wrapper effect — their
  // wrapper has no elemental damage of its own. The element comes from
  // the TRIGGER spell (`effect.min` = trigger spell id) which is
  // pre-loaded into `scope.triggerSpell` by the cast use-case. Walk
  // its damage effects (96/97/98/99/100 → Water/Earth/Air/Fire/
  // Neutral) and pick the first elemental match. Falls back to the
  // glyph spell's own effects (legacy) and finally a neutral grey.
  const sources = [
    scope.triggerSpell?.effects ?? [],
    scope.spell.effects,
  ];
  for (const effects of sources) {
    for (const eff of effects) {
      const el = effectIdToElement(eff.id);
      if (el !== null) {
        return ELEMENT_COLORS[el] ?? 0xc8c8c8;
      }
    }
  }
  return 0xc8c8c8;
}

@Injectable()
export class TrapGlyphEffectHandler {
  @EffectHandler(400)
  handleTrap(scope: Scope): void {
    const trap: FightObject = {
      id: 0,
      kind: FightObjectKind.Trap,
      casterId: scope.caster.id,
      cell: scope.targetCell,
      size: scope.effect.areaSize,
      element: Element.Neutral,
      spellId: scope.spell.spellId,
      spellLevel: scope.spell.level,
      color: TRAP_COLOR,
      remaining: -1,
      onArrival: (fight, victim) => {
        if (victim.dead) {
          return true;
        }
        const damage = calculateDamage(scope, Element.Neutral);
        applyDamageToTarget(
          { ...scope, target: victim },
          damage,
          Element.Neutral
        );
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
    const glyphColor = pickGlyphColor(scope);
    const glyph: FightObject = {
      id: 0,
      kind: FightObjectKind.Glyph,
      casterId: scope.caster.id,
      cell: scope.targetCell,
      size: scope.effect.areaSize,
      element: Element.Neutral,
      spellId: scope.spell.spellId,
      spellLevel: scope.spell.level,
      color: glyphColor,
      remaining: scope.effect.duration,
      onTurnStart: (fight, _owner) => {
        let triggered = false;
        for (const f of fight.fighters()) {
          if (
            f.dead ||
            f.cell !== scope.targetCell ||
            f.team?.side === scope.caster.team?.side
          ) {
            continue;
          }
          if (!triggered) {
            scope.emitter.emitGlyphTrigger(
              fight,
              scope.caster.id,
              scope.targetCell,
              scope.spell.spellId
            );
            triggered = true;
          }
          const damage = calculateDamage(scope, Element.Neutral);
          applyDamageToTarget({ ...scope, target: f }, damage, Element.Neutral);
        }
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
