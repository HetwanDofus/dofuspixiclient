import { System, system, type Entity, type World } from '@lastolivegames/becsy';
import {
  CellPosition,
  CombatContext,
  CombatPhase,
  Fighter,
  FighterStats,
  PlayerTurnState,
  TurnState,
} from '@/ecs/components';

/**
 * Combat state machine system.
 * Manages combat phase transitions and coordinates other combat systems.
 */
@system export class CombatManagerSystem extends System {
  private combatContext = this.query(
    (q) => q.current.with(CombatContext).write
  );

  private playerTurnState = this.query(
    (q) => q.current.with(PlayerTurnState).write
  );

  private fighters = this.query(
    (q) => q.current.with(Fighter, FighterStats, CellPosition)
  );

  execute(): void {
    for (const entity of this.combatContext.current) {
      const ctx = entity.read(CombatContext);

      switch (ctx.phase) {
        case CombatPhase.NONE:
          break;

        case CombatPhase.PLACEMENT:
          this.handlePlacementPhase();
          break;

        case CombatPhase.FIGHTING:
          this.handleFightingPhase(entity);
          break;

        case CombatPhase.ENDING:
          this.handleEndingPhase();
          break;
      }
    }
  }

  private handlePlacementPhase(): void {
    // Placement phase logic
    // Check if all fighters are ready
    // Emit placement cell highlights
  }

  private handleFightingPhase(entity: Entity): void {
    const ctx = entity.read(CombatContext);

    // Check turn timer expiry
    const elapsed = performance.now() - ctx.turnStartTime;
    const remaining = ctx.turnDuration * 1000 - elapsed;

    if (remaining <= 0) {
      // Turn timeout - would be handled by server
    }
  }

  private handleEndingPhase(): void {
    // Cleanup combat state
    // Results are shown via UI
  }

  /**
   * Start combat with initialization data.
   */
  startCombat(
    world: World,
    fightId: number,
    fightType: number,
    turnDuration: number
  ): void {
    world.createEntity(
      CombatContext, {
        fightId,
        fightType,
        phase: CombatPhase.PLACEMENT,
        round: 0,
        currentTurnFighterId: 0,
        turnStartTime: 0,
        turnDuration,
        turnSequence: [],
        spectatorMode: false,
      },
      PlayerTurnState, {
        state: TurnState.WAITING,
        ready: false,
        startCellId: 0,
      }
    );
  }

  /**
   * Transition from placement to fighting phase.
   */
  startFighting(turnSequence: number[]): void {
    for (const entity of this.combatContext.current) {
      const ctx = entity.write(CombatContext);
      ctx.phase = CombatPhase.FIGHTING;
      ctx.round = 1;
      ctx.turnSequence = turnSequence;

      if (turnSequence.length > 0) {
        ctx.currentTurnFighterId = turnSequence[0];
        ctx.turnStartTime = performance.now();
      }
    }
  }

  /**
   * Advance to next turn.
   */
  nextTurn(): void {
    for (const entity of this.combatContext.current) {
      const ctx = entity.write(CombatContext);
      const currentIndex = ctx.turnSequence.indexOf(ctx.currentTurnFighterId);
      const nextIndex = (currentIndex + 1) % ctx.turnSequence.length;

      // New round if wrapped around
      if (nextIndex === 0) {
        ctx.round++;
      }

      ctx.currentTurnFighterId = ctx.turnSequence[nextIndex];
      ctx.turnStartTime = performance.now();
    }

    // Update player turn state
    for (const entity of this.playerTurnState.current) {
      const playerState = entity.write(PlayerTurnState);
      playerState.state = TurnState.WAITING;
    }
  }

  /**
   * End the current combat.
   */
  endCombat(): void {
    for (const entity of this.combatContext.current) {
      const ctx = entity.write(CombatContext);
      ctx.phase = CombatPhase.ENDING;
    }
  }

  /**
   * Clean up combat state.
   */
  cleanup(): void {
    for (const entity of this.combatContext.current) {
      entity.delete();
    }

    for (const entity of this.playerTurnState.current) {
      entity.delete();
    }
  }

  /**
   * Check if it's the local player's turn.
   */
  isPlayerTurn(playerId: number): boolean {
    for (const entity of this.combatContext.current) {
      const ctx = entity.read(CombatContext);
      return ctx.currentTurnFighterId === playerId;
    }

    return false;
  }

  /**
   * Get current combat phase.
   */
  getCurrentPhase(): number {
    for (const entity of this.combatContext.current) {
      return entity.read(CombatContext).phase;
    }

    return CombatPhase.NONE;
  }

  /**
   * Get current round number.
   */
  getCurrentRound(): number {
    for (const entity of this.combatContext.current) {
      return entity.read(CombatContext).round;
    }

    return 0;
  }

  /**
   * Get remaining turn time in seconds.
   */
  getRemainingTurnTime(): number {
    for (const entity of this.combatContext.current) {
      const ctx = entity.read(CombatContext);
      const elapsed = (performance.now() - ctx.turnStartTime) / 1000;
      return Math.max(0, ctx.turnDuration - elapsed);
    }

    return 0;
  }

  /**
   * Get all fighters in combat.
   */
  getFighters(): Entity[] {
    return [...this.fighters.current];
  }
}
