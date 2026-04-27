import type {
  CastResult,
  FightRegistry,
  SpellPort,
} from "@modules/fight/cast/fight.cast.types";
import type { SpellLevel } from "@modules/fight/cast/fight.spell";
import type { ActiveState } from "@modules/fight/core/fight.active-state";
import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import type {
  EffectRegistry,
  Emitter,
  Scope,
} from "@modules/fight/effects/fight.effect-registry";
import { CastError } from "@modules/fight/cast/fight.cast.types";
import { isValidTarget } from "@modules/fight/effects/fight.target-mask";
import { StateName } from "@modules/fight/fight.types";
import {
  cellsInArea,
  distance,
  hasLineOfSight,
} from "@modules/fight/map/fight.area";

export type {
  CastResult,
  FightRegistry,
  SpellPort,
} from "@modules/fight/cast/fight.cast.types";
export type { TeamSide } from "@modules/fight/fight.types";
export { CastError } from "@modules/fight/cast/fight.cast.types";

export class CastSpellUseCase {
  constructor(
    private registry: FightRegistry,
    private spells: SpellPort,
    private effects: EffectRegistry,
    private emitter: Emitter
  ) {}

  async getSpellLevel(
    spellId: number,
    level: number
  ): Promise<SpellLevel | undefined> {
    return this.spells.spellLevel(spellId, level);
  }

  async execute(sessionId: string, params: string): Promise<CastResult> {
    const fight = this.registry.bySession(sessionId);
    if (!fight || fight.state.name !== StateName.Active) {
      throw new CastError("no_fight", "not in a fight");
    }
    const active = fight.state as ActiveState;
    const caster = fight.fighters().find((f) => f.sessionId === sessionId);
    if (!caster) {
      throw new CastError("no_fight", "not in a fight");
    }

    const current = active.turnList.current();
    if (!current || current.id !== caster.id) {
      throw new CastError("not_your_turn", "not your turn");
    }

    const { spellId, targetCell, level } = parseCastParams(params);
    return this.runCast(fight, active, caster, spellId, targetCell, level);
  }

  async castFor(
    fight: Fight,
    caster: Fighter,
    spellId: number,
    targetCell: number,
    level: number
  ): Promise<CastResult> {
    if (fight.state.name !== StateName.Active) {
      throw new CastError("no_fight", "not in a fight");
    }
    const active = fight.state as ActiveState;
    return this.runCast(fight, active, caster, spellId, targetCell, level);
  }

  private async runCast(
    fight: Fight,
    active: ActiveState,
    caster: Fighter,
    spellId: number,
    targetCell: number,
    level: number
  ): Promise<CastResult> {
    const spell = await this.spells.spellLevel(spellId, level);
    if (!spell) {
      throw new CastError("no_spell", "spell not learned / unknown");
    }

    // Verify player knows this spell
    if (caster.player && this.spells.playerHasSpell) {
      const knows = await this.spells.playerHasSpell(
        String(caster.player.id),
        spellId
      );
      if (!knows) {
        throw new CastError("no_spell", "spell not learned");
      }
    }

    if (caster.ap < spell.apCost) {
      throw new CastError("no_ap", "not enough AP");
    }

    const dist = distance(fight.fightMap, caster.cell, targetCell);
    if (dist < spell.rangeMin || dist > spell.rangeMax) {
      throw new CastError("out_of_range", "target out of range");
    }
    if (
      spell.lineOfSight &&
      !hasLineOfSight(fight.fightMap, caster.cell, targetCell)
    ) {
      throw new CastError("no_los", "target not in line of sight");
    }

    if (spell.castPerTurn > 0 || spell.castPerTarget > 0) {
      const targetFighter = fight
        .fighters()
        .find((f) => !f.dead && f.cell === targetCell);
      const targetId = targetFighter?.id ?? 0;
      if (
        !fight.spellUsage.canCast(
          caster.id,
          spellId,
          targetId,
          spell.castPerTurn,
          spell.castPerTarget
        )
      ) {
        throw new CastError("cooldown", "spell cast limit reached");
      }
    }

    const castCtx: CastContext = {
      caster,
      target: null,
      targetCell,
      spell,
      critical: false,
    };
    if (!fight.modules.fireCastPre(fight, castCtx)) {
      throw new CastError("no_spell", "spell blocked by module");
    }

    const critical =
      spell.criticalRate > 0 &&
      Math.floor(Math.random() * spell.criticalRate) === 0;
    const failure =
      spell.failureRate > 0 &&
      Math.floor(Math.random() * spell.failureRate) === 0;
    castCtx.critical = critical;

    caster.spendAp(spell.apCost);

    const result: CastResult = {
      fight,
      caster,
      spellId,
      level,
      targetCell,
      critical,
      failure,
      affectedCells: [],
    };

    if (failure) {
      return result;
    }

    const effects = critical ? spell.criticalEffects : spell.effects;
    const seen = new Set<number>();

    // Pre-resolve trigger spells for glyph/trap/summon effects. These
    // effects encode the trigger spell ID in `effect.min`; handlers
    // need its element to colour the deployed entity (e.g. fire glyphs
    // = orange, water glyphs = blue). Doing this before the per-effect
    // loop keeps the EffectHandler signature synchronous.
    const triggerCache = new Map<number, SpellLevel>();
    for (const eff of effects) {
      const isSpawn = eff.id === 400 || eff.id === 401 || eff.id === 185;
      if (!isSpawn) continue;
      const triggerId = eff.min;
      if (triggerId <= 0 || triggerCache.has(triggerId)) continue;
      const lvl = await this.spells.spellLevel(triggerId, 1);
      if (lvl) {
        triggerCache.set(triggerId, lvl);
      }
    }

    for (const eff of effects) {
      if (
        eff.probability > 0 &&
        Math.floor(Math.random() * 100) >= eff.probability
      ) {
        continue;
      }

      // Effects that place a persistent ground entity (trap, glyph) or
      // a creature (summon) read `areaKind`/`areaSize` as the spawned
      // object's trigger / aura zone, NOT as a cast-time AOE. They
      // must run exactly once at the click target — iterating the
      // declared zone would create one entity per cell of the trigger
      // shape (a Cb radius-2 glyph would deploy 13 glyph objects).
      const isSingleTargetSpawn =
        eff.id === 400 || eff.id === 401 || eff.id === 185;
      const cells = isSingleTargetSpawn
        ? [targetCell]
        : cellsInArea(
            fight.fightMap,
            caster.cell,
            targetCell,
            eff.areaKind,
            eff.areaSize
          );
      for (const cell of cells) {
        if (!seen.has(cell)) {
          seen.add(cell);
          result.affectedCells.push(cell);
        }

        const handler = this.effects.handler(eff.id);
        if (!handler) {
          continue;
        }

        let targetFighter = lookupFighterAt(fight, cell);

        // Honor the per-effect target mask (decoded from FT= param +
        // per-effect-id defaults). Mask 0 = no filter declared → permissive.
        if (!isValidTarget(eff.targetMask, caster, targetFighter)) {
          continue;
        }

        if (targetFighter) {
          const current = targetFighter;
          current.buffs.each((b) => {
            if (!b.resolveTarget) {
              return;
            }
            const redirect = b.resolveTarget(fight, current);
            if (redirect) {
              targetFighter = redirect;
            }
          });
        }

        if (targetFighter && spell.rangeMax === 1) {
          let skipHit = false;
          const meleeTarget = targetFighter;
          meleeTarget.buffs.each((b) => {
            if (skipHit || !b.preMeleeHit) {
              return;
            }
            if (b.preMeleeHit(fight, caster, meleeTarget)) {
              skipHit = true;
            }
          });
          if (skipHit) {
            continue;
          }
        }

        const trigger = triggerCache.get(eff.min);
        const scope: Scope = {
          fight,
          caster,
          target: targetFighter,
          targetCell: cell,
          effect: eff,
          spell,
          critical,
          emitter: this.emitter,
          ...(trigger ? { triggerSpell: trigger } : {}),
        };
        handler(scope);
      }
    }

    const targetFighter = fight
      .fighters()
      .find((f) => !f.dead && f.cell === targetCell);
    const targetId = targetFighter?.id ?? 0;
    fight.spellUsage.recordCast(caster.id, spellId, targetId);

    for (const fighter of fight.fighters()) {
      if (fighter.dead) {
        active.turnList.remove(fighter.id);
      }
    }

    fight.modules.fireCastApplied(fight, castCtx);

    return result;
  }
}

function lookupFighterAt(f: Fight, cell: number): Fighter | null {
  for (const fighter of f.fighters()) {
    if (!fighter.dead && fighter.cell === cell) {
      return fighter;
    }
  }
  return null;
}

function parseCastParams(params: string): {
  spellId: number;
  targetCell: number;
  level: number;
} {
  const parts = params.split(";");
  if (parts.length < 2) {
    throw new CastError("bad_params", "malformed params");
  }
  const spellId = Number.parseInt(parts[0] ?? "", 10);
  const targetCell = Number.parseInt(parts[1] ?? "", 10);
  if (Number.isNaN(spellId) || Number.isNaN(targetCell)) {
    throw new CastError("bad_params", "malformed params");
  }
  let level = 1;
  if (parts.length >= 3) {
    const lvl = Number.parseInt(parts[2] ?? "", 10);
    if (!Number.isNaN(lvl) && lvl > 0) {
      level = lvl;
    }
  }
  return { spellId, targetCell, level };
}
