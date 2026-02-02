import { system, System } from '@lastolivegames/becsy';
import {
  CombatContext,
  CombatPhase,
  PlayerTurnState,
  TurnState,
  Fighter,
  FighterStats,
  ActiveEffect,
  SpellCooldown,
} from '@/ecs/components';

/**
 * Turn management system.
 * Handles turn timing, AP/MP reset, and end-of-turn processing.
 */
@system export class TurnSystem extends System {
  private combatContext = this.query(
    (q) => q.current.with(CombatContext).write
  );

  private playerTurnState = this.query(
    (q) => q.current.with(PlayerTurnState).write
  );

  private fighters = this.query(
    (q) => q.current.with(Fighter, FighterStats).write
  );

  private effects = this.query(
    (q) => q.current.with(ActiveEffect).write
  );

  private cooldowns = this.query(
    (q) => q.current.with(SpellCooldown).write
  );

  execute(): void {
    // Turn system runs passively
    // Active turn management is triggered by network messages
  }

  /**
   * Start a new turn for a fighter.
   */
  startTurn(fighterId: number, duration: number): void {
    // Update combat context
    for (const entity of this.combatContext.current) {
      const ctx = entity.write(CombatContext);

      if (ctx.phase !== CombatPhase.FIGHTING) {
        continue;
      }

      ctx.currentTurnFighterId = fighterId;
      ctx.turnStartTime = performance.now();
      ctx.turnDuration = duration;
    }

    // Reset fighter AP/MP to max
    for (const entity of this.fighters.current) {
      const fighter = entity.read(Fighter);

      if (fighter.id !== fighterId) {
        continue;
      }

      const stats = entity.write(FighterStats);
      stats.ap = stats.maxAp;
      stats.mp = stats.maxMp;
    }

    // Reset spell uses this turn
    this.resetSpellUsesThisTurn(fighterId);

    // Update player turn state if it's the local player
    this.updatePlayerTurnState(fighterId);
  }

  /**
   * End the current turn.
   */
  endTurn(fighterId: number): void {
    // Process end-of-turn effects
    this.processEndOfTurnEffects(fighterId);

    // Decrement spell cooldowns
    this.decrementCooldowns(fighterId);

    // Update player turn state
    for (const entity of this.playerTurnState.current) {
      const playerState = entity.write(PlayerTurnState);
      playerState.state = TurnState.WAITING;
    }
  }

  /**
   * Set player turn state to active.
   */
  private updatePlayerTurnState(fighterId: number): void {
    // This would check if fighterId matches the local player
    // For now, we update the state assuming it's the player's turn
    for (const entity of this.playerTurnState.current) {
      const playerState = entity.write(PlayerTurnState);
      playerState.state = TurnState.ACTIVE;
    }
  }

  /**
   * Reset spell uses for the new turn.
   */
  private resetSpellUsesThisTurn(fighterId: number): void {
    for (const entity of this.cooldowns.current) {
      const cooldown = entity.write(SpellCooldown);
      cooldown.usesThisTurn = 0;
    }
  }

  /**
   * Process effects that trigger at end of turn.
   */
  private processEndOfTurnEffects(fighterId: number): void {
    for (const entity of this.effects.current) {
      const effect = entity.write(ActiveEffect);

      // Decrement duration
      if (effect.turnsRemaining > 0) {
        effect.turnsRemaining--;

        // Remove expired effects
        if (effect.turnsRemaining === 0) {
          entity.delete();
        }
      }
    }
  }

  /**
   * Decrement spell cooldowns at end of turn.
   */
  private decrementCooldowns(fighterId: number): void {
    for (const entity of this.cooldowns.current) {
      const cooldown = entity.write(SpellCooldown);

      if (cooldown.turnsRemaining > 0) {
        cooldown.turnsRemaining--;
      }
    }
  }

  /**
   * Set player state to transmitting (sending action to server).
   */
  setTransmitting(): void {
    for (const entity of this.playerTurnState.current) {
      const playerState = entity.write(PlayerTurnState);
      playerState.state = TurnState.TRANSMITTING;
    }
  }

  /**
   * Set player state to animating (playing action animation).
   */
  setAnimating(): void {
    for (const entity of this.playerTurnState.current) {
      const playerState = entity.write(PlayerTurnState);
      playerState.state = TurnState.ANIMATING;
    }
  }

  /**
   * Set player state back to active (ready for next action).
   */
  setActive(): void {
    for (const entity of this.playerTurnState.current) {
      const playerState = entity.write(PlayerTurnState);
      playerState.state = TurnState.ACTIVE;
    }
  }

  /**
   * Check if player can perform actions.
   */
  canAct(): boolean {
    for (const entity of this.playerTurnState.current) {
      const playerState = entity.read(PlayerTurnState);
      return playerState.state === TurnState.ACTIVE;
    }

    return false;
  }

  /**
   * Get current turn fighter ID.
   */
  getCurrentTurnFighterId(): number {
    for (const entity of this.combatContext.current) {
      return entity.read(CombatContext).currentTurnFighterId;
    }

    return 0;
  }

  /**
   * Get turn elapsed time in milliseconds.
   */
  getTurnElapsedTime(): number {
    for (const entity of this.combatContext.current) {
      const ctx = entity.read(CombatContext);
      return performance.now() - ctx.turnStartTime;
    }

    return 0;
  }
}
