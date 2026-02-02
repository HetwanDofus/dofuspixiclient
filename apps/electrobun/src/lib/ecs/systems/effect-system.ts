import { type Entity, System, system } from "@lastolivegames/becsy";

import {
  ActiveEffect,
  CellPosition,
  CombatContext,
  CombatPhase,
  EffectType,
  Fighter,
  FighterStats,
} from "@/ecs/components";

/**
 * Effect application result.
 */
export interface EffectResult {
  targetId: number;
  effectType: number;
  value: number;
  cellId: number;
  critical: boolean;
}

/**
 * Effect system.
 * Processes and applies spell effects to fighters.
 */
@system
export class EffectSystem extends System {
  private combatContext = this.query((q) => q.current.with(CombatContext));

  private fighters = this.query(
    (q) => q.current.with(Fighter, FighterStats, CellPosition).write
  );

  private activeEffects = this.query((q) => q.current.with(ActiveEffect).write);

  private pendingEffects: PendingEffect[] = [];
  private effectResults: EffectResult[] = [];

  execute(): void {
    // Only process effects during fighting phase
    for (const entity of this.combatContext.current) {
      const ctx = entity.read(CombatContext);

      if (ctx.phase !== CombatPhase.FIGHTING) {
        return;
      }
    }

    // Process pending effects
    this.processPendingEffects();
  }

  /**
   * Queue an effect for processing.
   */
  queueEffect(effect: PendingEffect): void {
    this.pendingEffects.push(effect);
  }

  /**
   * Queue multiple effects.
   */
  queueEffects(effects: PendingEffect[]): void {
    this.pendingEffects.push(...effects);
  }

  /**
   * Get and clear effect results.
   */
  consumeResults(): EffectResult[] {
    const results = [...this.effectResults];
    this.effectResults = [];
    return results;
  }

  /**
   * Process all pending effects.
   */
  private processPendingEffects(): void {
    while (this.pendingEffects.length > 0) {
      const effect = this.pendingEffects.shift();

      if (effect) {
        this.applyEffect(effect);
      }
    }
  }

  /**
   * Apply a single effect.
   */
  private applyEffect(effect: PendingEffect): void {
    const target = this.findFighterById(effect.targetId);

    if (!target) {
      return;
    }

    const stats = target.write(FighterStats);
    const cellPos = target.read(CellPosition);
    let value = effect.value;

    switch (effect.effectType) {
      case EffectType.DAMAGE_NEUTRAL:
      case EffectType.DAMAGE_EARTH:
      case EffectType.DAMAGE_FIRE:
      case EffectType.DAMAGE_WATER:
      case EffectType.DAMAGE_AIR:
        value = this.applyDamage(stats, value, effect.critical);
        break;

      case EffectType.STEAL_HP_NEUTRAL:
      case EffectType.STEAL_HP_EARTH:
      case EffectType.STEAL_HP_FIRE:
      case EffectType.STEAL_HP_WATER:
      case EffectType.STEAL_HP_AIR:
        value = this.applyStealHP(
          stats,
          effect.sourceId,
          value,
          effect.critical
        );
        break;

      case EffectType.HEAL:
        value = this.applyHeal(stats, value, effect.critical);
        break;

      case EffectType.REMOVE_AP:
        value = this.applyAPChange(stats, -value);
        break;

      case EffectType.GIVE_AP:
        value = this.applyAPChange(stats, value);
        break;

      case EffectType.REMOVE_MP:
        value = this.applyMPChange(stats, -value);
        break;

      case EffectType.GIVE_MP:
        value = this.applyMPChange(stats, value);
        break;

      default:
        // Unknown effect type
        return;
    }

    // Record result for rendering
    this.effectResults.push({
      targetId: effect.targetId,
      effectType: effect.effectType,
      value,
      cellId: cellPos.cellId,
      critical: effect.critical,
    });
  }

  /**
   * Apply damage to a fighter.
   */
  private applyDamage(
    stats: FighterStats,
    baseDamage: number,
    critical: boolean
  ): number {
    let damage = baseDamage;

    if (critical) {
      damage = Math.floor(damage * 1.5);
    }

    // Ensure we don't go below 0
    const actualDamage = Math.min(stats.hp, damage);
    stats.hp -= actualDamage;

    return actualDamage;
  }

  /**
   * Apply HP steal (damage + heal source).
   */
  private applyStealHP(
    targetStats: FighterStats,
    sourceId: number,
    baseDamage: number,
    critical: boolean
  ): number {
    const damage = this.applyDamage(targetStats, baseDamage, critical);

    // Heal the source
    const source = this.findFighterById(sourceId);

    if (source) {
      const sourceStats = source.write(FighterStats);
      const healAmount = Math.floor(damage * 0.5);
      this.applyHeal(sourceStats, healAmount, false);
    }

    return damage;
  }

  /**
   * Apply healing to a fighter.
   */
  private applyHeal(
    stats: FighterStats,
    baseHeal: number,
    critical: boolean
  ): number {
    let heal = baseHeal;

    if (critical) {
      heal = Math.floor(heal * 1.5);
    }

    // Don't exceed max HP
    const actualHeal = Math.min(stats.maxHp - stats.hp, heal);
    stats.hp += actualHeal;

    return actualHeal;
  }

  /**
   * Apply AP change.
   */
  private applyAPChange(stats: FighterStats, change: number): number {
    const oldAP = stats.ap;

    if (change > 0) {
      // Gain AP - can exceed max temporarily in some cases
      stats.ap = Math.min(stats.ap + change, stats.maxAp);
    } else {
      // Lose AP - can't go below 0
      stats.ap = Math.max(0, stats.ap + change);
    }

    return Math.abs(stats.ap - oldAP);
  }

  /**
   * Apply MP change.
   */
  private applyMPChange(stats: FighterStats, change: number): number {
    const oldMP = stats.mp;

    if (change > 0) {
      stats.mp = Math.min(stats.mp + change, stats.maxMp);
    } else {
      stats.mp = Math.max(0, stats.mp + change);
    }

    return Math.abs(stats.mp - oldMP);
  }

  /**
   * Find a fighter entity by ID.
   */
  private findFighterById(id: number): Entity | null {
    for (const entity of this.fighters.current) {
      if (entity.read(Fighter).id === id) {
        return entity;
      }
    }

    return null;
  }

  /**
   * Process end-of-turn effects.
   * Called when a turn ends to tick down durations.
   */
  processTurnEnd(fighterId: number): void {
    for (const entity of this.activeEffects.current) {
      const effect = entity.write(ActiveEffect);

      // Only process effects on the fighter whose turn ended
      if (effect.sourceId !== fighterId) {
        continue;
      }

      effect.turnsRemaining--;

      if (effect.turnsRemaining <= 0) {
        entity.delete();
      }
    }
  }

  /**
   * Add an active effect (buff/debuff) to a fighter.
   */
  addActiveEffect(
    targetId: number,
    effectType: number,
    value: number,
    duration: number,
    sourceId: number,
    dispellable: boolean
  ): void {
    const target = this.findFighterById(targetId);

    if (!target) {
      return;
    }

    // Check for existing effect of same type to stack/replace
    // For now, just add new effect
    this.createEntity(ActiveEffect, {
      type: effectType,
      value,
      turnsRemaining: duration,
      dispellable,
      sourceId,
    });
  }

  /**
   * Remove all dispellable effects from a fighter.
   */
  dispelEffects(targetId: number): number {
    let dispelled = 0;

    for (const entity of this.activeEffects.current) {
      const effect = entity.read(ActiveEffect);

      if (effect.sourceId === targetId && effect.dispellable) {
        entity.delete();
        dispelled++;
      }
    }

    return dispelled;
  }

  /**
   * Check if a fighter is alive.
   */
  isFighterAlive(fighterId: number): boolean {
    const fighter = this.findFighterById(fighterId);

    if (!fighter) {
      return false;
    }

    return fighter.read(FighterStats).hp > 0;
  }

  /**
   * Get fighter stats by ID.
   */
  getFighterStats(fighterId: number): FighterStats | null {
    const fighter = this.findFighterById(fighterId);

    if (!fighter) {
      return null;
    }

    return fighter.read(FighterStats);
  }
}

/**
 * Pending effect to be applied.
 */
export interface PendingEffect {
  sourceId: number;
  targetId: number;
  effectType: number;
  value: number;
  critical: boolean;
}
