import { describe, expect, test } from "bun:test";

import type {
  SpellEffect,
  SpellLevel,
} from "@modules/fight/cast/fight.spell.types";
import type { Scope } from "@modules/fight/effects/fight.effect-registry.types";
import { AreaKind } from "@dofus/grid";
import { Fight } from "@modules/fight/core/fight.entity";
import { Fighter } from "@modules/fight/core/fight.fighter";
import { TrapGlyphEffectHandler } from "@modules/fight/effects/handlers/trap-glyph.handler";
import { FighterKind, FightType, TeamSide } from "@modules/fight/fight.types";
import { cellsInArea } from "@modules/fight/map/fight.area";
import { FightMap } from "@modules/fight/map/fight.map";

// The glyph's centre. `cellsInArea` with a Circle of size 1 gives it and
// its ring; the grid's adjacency is ±width and ±(width−1), never ±1, so
// the ring cells are read back from the canonical helper rather than
// guessed at here.
const CENTRE = 200;
const WIDTH = 15;
const HEIGHT = 17;

function effect(over: Partial<SpellEffect> = {}): SpellEffect {
  return {
    id: 100,
    min: 0,
    max: 0,
    special: 0,
    duration: 0,
    probability: 100,
    areaKind: AreaKind.None,
    areaSize: 0,
    targetMask: 0,
    ...over,
  };
}

function spell(over: Partial<SpellLevel> = {}): SpellLevel {
  return {
    spellId: 1,
    level: 1,
    effects: [],
    criticalEffects: [],
    apCost: 3,
    rangeMin: 1,
    rangeMax: 5,
    criticalRate: 0,
    failureRate: 0,
    lineOfSight: true,
    emptyCell: false,
    modifiableRange: false,
    castPerTurn: 0,
    castPerTarget: 0,
    cooldown: 0,
    lineOnly: false,
    minPlayerLevel: 1,
    critFailureEndsTurn: false,
    visualGfxId: 0,
    ...over,
  } as SpellLevel;
}

interface Harness {
  scope: Scope;
  fight: Fight;
  caster: Fighter;
  ally: Fighter;
  enemy: Fighter;
  triggers: number[];
}

/**
 * A Féca-shaped fixture: one caster, one ally, one enemy, and a wrapper
 * effect (401 or 400) whose `min` names a Fire trigger spell dealing a
 * fixed 30.
 */
function harness(wrapper: SpellEffect): Harness {
  const fmap = new FightMap(WIDTH, HEIGHT, [], []);
  const fight = new Fight(FightType.PvM, 1, fmap, [
    { side: TeamSide.Side0, leaderId: 1 },
    { side: TeamSide.Side1, leaderId: 3 },
  ]);

  const caster = new Fighter(1, FighterKind.Player, "caster", 100, 6, 3, 3);
  const ally = new Fighter(2, FighterKind.Player, "ally", 100, 6, 3, 3);
  const enemy = new Fighter(3, FighterKind.Monster, "enemy", 100, 6, 3, 3);

  fight.teams[0].add(caster);
  fight.teams[0].add(ally);
  fight.teams[1].add(enemy);

  caster.cell = 300;
  const triggers: number[] = [];

  const scope: Scope = {
    fight,
    caster,
    target: null,
    targetCell: CENTRE,
    effect: wrapper,
    spell: spell({ spellId: 1, level: 1, effects: [wrapper] }),
    // 99 is the Fire damage effect id; a flat 30 keeps the assertions
    // about "did it hurt, and for how much" unambiguous.
    triggerSpell: spell({
      spellId: 99,
      effects: [effect({ id: 99, min: 30, max: 30 })],
    }),
    critical: false,
    emitter: {
      emitDamage() {},
      emitHeal() {},
      emitDeath() {},
      emitAPLoss() {},
      emitMPLoss() {},
      emitBuff() {},
      emitTeleport() {},
      emitTrapAdd() {},
      emitGlyphAdd() {},
      emitTrapRemove() {},
      emitGlyphRemove() {},
      emitGlyphTrigger(_f: unknown, _c: unknown, cell: number) {
        triggers.push(cell);
      },
    },
  } as unknown as Scope;

  return { scope, fight, caster, ally, enemy, triggers };
}

/** A cell on the glyph's ring, i.e. in the zone but not the centre. */
function ringCell(): number {
  const zone = cellsInArea(
    new FightMap(WIDTH, HEIGHT, [], []),
    300,
    CENTRE,
    AreaKind.Circle,
    1
  );
  const cell = zone.find((c) => c !== CENTRE);

  if (cell === undefined) {
    throw new Error("the fixture's area produced no ring cell");
  }

  return cell;
}

const GLYPH = effect({
  id: 401,
  min: 99, // trigger spell id, per the 1.29 wrapper convention
  max: 0,
  duration: 3,
  areaKind: AreaKind.Circle,
  areaSize: 1,
});

describe("glyphs", () => {
  test("an enemy on the ring is hit, not just one on the centre", () => {
    const h = harness(GLYPH);
    new TrapGlyphEffectHandler().handleGlyph(h.scope);

    h.enemy.cell = ringCell();
    h.fight.fightMap.fireTurnStartTriggers(h.fight, h.enemy);

    // This is the whole of QA-061: the client drew the disc, the server
    // only ever tested the centre.
    expect(h.enemy.lp).toBeLessThan(100);
  });

  test("damage comes from the trigger spell, not the wrapper effect", () => {
    const h = harness(GLYPH);
    new TrapGlyphEffectHandler().handleGlyph(h.scope);

    h.enemy.cell = CENTRE;
    h.fight.fightMap.fireTurnStartTriggers(h.fight, h.enemy);

    // 30, the trigger's roll — not 99, the trigger spell's id, which is
    // what reading the wrapper's `min` used to deal.
    expect(h.enemy.lp).toBe(70);
  });

  test("an ally standing in the zone is spared", () => {
    const h = harness(GLYPH);
    new TrapGlyphEffectHandler().handleGlyph(h.scope);

    h.ally.cell = CENTRE;
    h.fight.fightMap.fireTurnStartTriggers(h.fight, h.ally);

    expect(h.ally.lp).toBe(100);
    expect(h.triggers).toEqual([]);
  });

  test("it fires for the fighter whose turn begins, and no one else", () => {
    const h = harness(GLYPH);
    new TrapGlyphEffectHandler().handleGlyph(h.scope);

    // Both stand on the glyph, but only the enemy's turn is starting.
    h.enemy.cell = CENTRE;
    h.ally.cell = ringCell();

    h.fight.fightMap.fireTurnStartTriggers(h.fight, h.ally);

    expect(h.enemy.lp).toBe(100);
    expect(h.ally.lp).toBe(100);

    h.fight.fightMap.fireTurnStartTriggers(h.fight, h.enemy);

    expect(h.enemy.lp).toBe(70);
  });

  test("a dead fighter is not hit again", () => {
    const h = harness(GLYPH);
    new TrapGlyphEffectHandler().handleGlyph(h.scope);

    h.enemy.cell = CENTRE;
    h.enemy.dead = true;
    h.fight.fightMap.fireTurnStartTriggers(h.fight, h.enemy);

    expect(h.enemy.lp).toBe(100);
  });

  test("the object's element is the trigger's, not neutral", () => {
    const h = harness(GLYPH);
    new TrapGlyphEffectHandler().handleGlyph(h.scope);

    const [glyph] = h.fight.fightMap.objects.snapshot();

    // 99 → Fire. Neutral would mean the target's fire resistance never
    // applied and the caster's fire bonus never counted.
    expect(glyph?.element).toBe(2);
  });
});

const TRAP = effect({
  id: 400,
  min: 99,
  max: 0,
  areaKind: AreaKind.Circle,
  areaSize: 1,
});

describe("traps", () => {
  test("stepping anywhere in the zone sets it off", () => {
    const h = harness(TRAP);
    new TrapGlyphEffectHandler().handleTrap(h.scope);

    h.enemy.cell = ringCell();
    h.fight.fightMap.fireArrivalTriggers(h.fight, h.enemy, h.enemy.cell);

    expect(h.enemy.lp).toBe(70);
  });

  test("it is consumed once it fires", () => {
    const h = harness(TRAP);
    new TrapGlyphEffectHandler().handleTrap(h.scope);

    h.enemy.cell = CENTRE;
    h.fight.fightMap.fireArrivalTriggers(h.fight, h.enemy, CENTRE);

    expect(h.fight.fightMap.objects.snapshot()).toEqual([]);
  });

  test("walking outside the zone leaves it armed", () => {
    const h = harness(TRAP);
    new TrapGlyphEffectHandler().handleTrap(h.scope);

    h.fight.fightMap.fireArrivalTriggers(h.fight, h.enemy, 1);

    expect(h.enemy.lp).toBe(100);
    expect(h.fight.fightMap.objects.snapshot()).toHaveLength(1);
  });
});
