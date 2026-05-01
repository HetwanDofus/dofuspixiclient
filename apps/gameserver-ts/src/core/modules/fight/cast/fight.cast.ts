import type {
  CastResolution,
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
  CastResolution,
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

  /**
   * Phase 1 of a player cast — validate, roll critical/failure,
   * pre-resolve trigger spells. **Pure** with respect to the fight
   * state: no AP spent, no LP changed, no GAs emitted. Throws
   * CastError on validation failure (no fight, not your turn, no AP,
   * out of range, no LOS, on cooldown, blocked by module, unknown
   * spell). Returns a `CastResolution` snapshot the caller hands to
   * `apply()` once it has broadcast directionChange + spellLaunch.
   */
  async resolve(sessionId: string, params: string): Promise<CastResolution> {
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
    return this.resolveCast(fight, active, caster, spellId, targetCell, level);
  }

  /**
   * Same as `resolve()`, but for callers that already hold the fight
   * + caster references (Monster AI in fight.lifecycle.service.ts).
   */
  async resolveFor(
    fight: Fight,
    caster: Fighter,
    spellId: number,
    targetCell: number,
    level: number
  ): Promise<CastResolution> {
    if (fight.state.name !== StateName.Active) {
      throw new CastError("no_fight", "not in a fight");
    }
    const active = fight.state as ActiveState;
    return this.resolveCast(fight, active, caster, spellId, targetCell, level);
  }

  /**
   * Phase 2 — mutate fighter state and broadcast effect GAs (damage,
   * heal, status, summons, death). Must be called AFTER the caller
   * has broadcast `directionChange` + `spellLaunch`, otherwise the
   * client will receive the damage GA before its `onSpellCast` had a
   * chance to install the `spellSequencer` gate, and the popup fires
   * instantly instead of waiting for the spell visual.
   */
  apply(resolution: CastResolution): CastResult {
    return this.runApply(resolution);
  }

  /**
   * One-shot wrapper for callers that don't care about ordering
   * (tests, monster AI without visuals). Equivalent to resolve+apply
   * with no broadcasts in between — preserves the bad ordering on
   * purpose because the existing Monster AI path doesn't broadcast a
   * spellLaunch anyway.
   */
  async execute(sessionId: string, params: string): Promise<CastResult> {
    const resolution = await this.resolve(sessionId, params);
    return this.apply(resolution);
  }

  /**
   * One-shot wrapper for callers that already hold the fight + caster
   * references (Monster AI). Same caveat as `execute`: no broadcasts
   * between phases.
   */
  async castFor(
    fight: Fight,
    caster: Fighter,
    spellId: number,
    targetCell: number,
    level: number
  ): Promise<CastResult> {
    const resolution = await this.resolveFor(
      fight,
      caster,
      spellId,
      targetCell,
      level
    );
    return this.apply(resolution);
  }

  private async resolveCast(
    fight: Fight,
    active: ActiveState,
    caster: Fighter,
    spellId: number,
    targetCell: number,
    level: number
  ): Promise<CastResolution> {
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

    // Pre-resolve trigger spells for glyph/trap/summon effects. These
    // effects encode the trigger spell ID in `effect.min`; handlers
    // need its element to colour the deployed entity (e.g. fire glyphs
    // = orange, water glyphs = blue). Doing this before apply() keeps
    // the per-effect loop synchronous and lets us await spell loading
    // outside the broadcast-sensitive critical section.
    const effects = critical ? spell.criticalEffects : spell.effects;
    const triggerCache = new Map<number, SpellLevel>();
    for (const eff of effects) {
      const isSpawn = eff.id === 400 || eff.id === 401 || eff.id === 185;
      if (!isSpawn) {
        continue;
      }
      const triggerId = eff.min;
      if (triggerId <= 0 || triggerCache.has(triggerId)) {
        continue;
      }
      const lvl = await this.spells.spellLevel(triggerId, 1);
      if (lvl) {
        triggerCache.set(triggerId, lvl);
      }
    }

    return {
      fight,
      active,
      caster,
      spell,
      spellId,
      level,
      targetCell,
      critical,
      failure,
      triggerCache,
      castCtx,
    };
  }

  private runApply(resolution: CastResolution): CastResult {
    const {
      fight,
      active,
      caster,
      spell,
      spellId,
      level,
      targetCell,
      critical,
      failure,
      triggerCache,
      castCtx,
    } = resolution;

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
      if (!fighter.dead) {
        continue;
      }
      active.turnList.remove(fighter.id);
      // Free the corpse's cell. Without this the fightMap keeps the
      // dead fighter as an occupant, so subsequent
      // `hasLineOfSight(caster → target)` calls reject any ray that
      // crosses the corpse cell — the user perceives this as "the
      // server randomly refuses my cast even though I have a clear
      // shot". Canonical Dofus 1.29 lets spells fly over corpses.
      if (fighter.cell >= 0) {
        fight.fightMap.free(fighter.cell, fighter.id);
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
