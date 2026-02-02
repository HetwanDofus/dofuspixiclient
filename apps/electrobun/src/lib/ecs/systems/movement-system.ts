import { type Entity, System, system } from "@lastolivegames/becsy";

import {
  CellPosition,
  CombatContext,
  CombatPhase,
  Fighter,
  FighterStats,
  ForcedMovement,
  MoveAnimation,
  MovementPath,
} from "@/ecs/components";

/**
 * Movement result.
 */
export interface MovementResult {
  fighterId: number;
  path: number[];
  mpUsed: number;
  success: boolean;
}

/**
 * Movement system.
 * Handles fighter movement during combat.
 */
@system
export class MovementSystem extends System {
  private combatContext = this.query((q) => q.current.with(CombatContext));

  private fighters = this.query(
    (q) => q.current.with(Fighter, FighterStats, CellPosition).write
  );

  private movingFighters = this.query(
    (q) => q.current.with(Fighter, MovementPath).write
  );

  private forcedMovements = this.query(
    (q) => q.current.with(Fighter, ForcedMovement, CellPosition).write
  );

  private pendingMovements: PendingMovement[] = [];
  private movementResults: MovementResult[] = [];
  private mapWidth = 15;

  execute(): void {
    // Only process during fighting phase
    for (const entity of this.combatContext.current) {
      const ctx = entity.read(CombatContext);

      if (ctx.phase !== CombatPhase.FIGHTING) {
        return;
      }
    }

    // Process pending movements
    this.processPendingMovements();

    // Update active movements (interpolation handled by renderer)
    this.updateActiveMovements();

    // Process forced movements (push/pull)
    this.processForcedMovements();
  }

  /**
   * Set map width for direction calculations.
   */
  setMapWidth(width: number): void {
    this.mapWidth = width;
  }

  /**
   * Request a movement for a fighter.
   */
  requestMovement(
    fighterId: number,
    path: number[],
    isCurrentTurn: boolean
  ): boolean {
    if (path.length < 2) {
      return false;
    }

    const fighter = this.findFighterById(fighterId);

    if (!fighter) {
      return false;
    }

    const stats = fighter.read(FighterStats);
    const cellPos = fighter.read(CellPosition);
    const mpCost = path.length - 1;

    // Validate movement
    if (!isCurrentTurn) {
      return false;
    }

    if (stats.mp < mpCost) {
      return false;
    }

    if (path[0] !== cellPos.cellId) {
      return false;
    }

    // Queue movement
    this.pendingMovements.push({
      fighterId,
      path,
      mpCost,
    });

    return true;
  }

  /**
   * Get and clear movement results.
   */
  consumeResults(): MovementResult[] {
    const results = [...this.movementResults];
    this.movementResults = [];
    return results;
  }

  /**
   * Process pending movements.
   */
  private processPendingMovements(): void {
    while (this.pendingMovements.length > 0) {
      const movement = this.pendingMovements.shift();

      if (movement) {
        this.startMovement(movement);
      }
    }
  }

  /**
   * Start a movement.
   */
  private startMovement(movement: PendingMovement): void {
    const fighter = this.findFighterById(movement.fighterId);

    if (!fighter) {
      this.movementResults.push({
        fighterId: movement.fighterId,
        path: movement.path,
        mpUsed: 0,
        success: false,
      });
      return;
    }

    // Deduct MP
    const stats = fighter.write(FighterStats);
    stats.mp -= movement.mpCost;

    // Determine animation type (run for longer paths)
    const animationType =
      movement.path.length > 3 ? MoveAnimation.RUN : MoveAnimation.WALK;

    // Add movement path component
    fighter.add(MovementPath, {
      path: movement.path,
      currentStep: 0,
      progress: 0,
      animationType,
    });

    this.movementResults.push({
      fighterId: movement.fighterId,
      path: movement.path,
      mpUsed: movement.mpCost,
      success: true,
    });
  }

  /**
   * Update active movements.
   */
  private updateActiveMovements(): void {
    for (const entity of this.movingFighters.current) {
      const movePath = entity.read(MovementPath);

      // Check if movement is complete
      if (movePath.currentStep >= movePath.path.length - 1) {
        // Update final position
        const cellPos = entity.write(CellPosition);
        cellPos.cellId = movePath.path[movePath.path.length - 1];

        // Remove movement component
        entity.remove(MovementPath);
      }
    }
  }

  /**
   * Process forced movements (push/pull).
   */
  private processForcedMovements(): void {
    for (const entity of this.forcedMovements.current) {
      const forced = entity.read(ForcedMovement);
      const cellPos = entity.write(CellPosition);

      if (forced.isPush) {
        this.applyPush(entity, cellPos, forced);
      } else {
        this.applyPull(entity, cellPos, forced);
      }

      // Remove the forced movement component after processing
      entity.remove(ForcedMovement);
    }
  }

  /**
   * Apply push movement.
   */
  private applyPush(
    fighter: Entity,
    cellPos: CellPosition,
    forced: ForcedMovement
  ): void {
    const path = this.calculateDirectionalPath(
      cellPos.cellId,
      forced.direction,
      forced.distance
    );

    if (path.length > 0) {
      const startCell = cellPos.cellId;
      cellPos.cellId = path[path.length - 1];

      // Add movement for animation
      fighter.add(MovementPath, {
        path: [startCell, ...path],
        currentStep: 0,
        progress: 0,
        animationType: MoveAnimation.SLIDE,
      });
    }
  }

  /**
   * Apply pull movement.
   */
  private applyPull(
    fighter: Entity,
    cellPos: CellPosition,
    forced: ForcedMovement
  ): void {
    // For pull, we move in opposite direction
    const oppositeDirection = (forced.direction + 4) % 8;
    const path = this.calculateDirectionalPath(
      cellPos.cellId,
      oppositeDirection,
      forced.distance
    );

    if (path.length > 0) {
      const startCell = cellPos.cellId;
      cellPos.cellId = path[path.length - 1];

      fighter.add(MovementPath, {
        path: [startCell, ...path],
        currentStep: 0,
        progress: 0,
        animationType: MoveAnimation.SLIDE,
      });
    }
  }

  /**
   * Calculate path in a direction.
   */
  private calculateDirectionalPath(
    fromCell: number,
    direction: number,
    distance: number
  ): number[] {
    const path: number[] = [];
    let currentCell = fromCell;

    for (let i = 0; i < distance; i++) {
      const nextCell = this.getNeighborInDirection(currentCell, direction);

      if (nextCell === -1) {
        break; // Hit obstacle or map edge
      }

      path.push(nextCell);
      currentCell = nextCell;
    }

    return path;
  }

  /**
   * Get neighbor cell in a direction.
   * Direction: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
   */
  private getNeighborInDirection(cellId: number, direction: number): number {
    const row = Math.floor(cellId / this.mapWidth);
    const col = cellId % this.mapWidth;

    // Direction offsets for isometric grid
    const offsets: Record<number, { dx: number; dy: number }> = {
      0: { dx: 0, dy: -1 }, // North
      1: { dx: 1, dy: -1 }, // North-East
      2: { dx: 1, dy: 0 }, // East
      3: { dx: 1, dy: 1 }, // South-East
      4: { dx: 0, dy: 1 }, // South
      5: { dx: -1, dy: 1 }, // South-West
      6: { dx: -1, dy: 0 }, // West
      7: { dx: -1, dy: -1 }, // North-West
    };

    const offset = offsets[direction];

    if (!offset) {
      return -1;
    }

    const newCol = col + offset.dx;
    const newRow = row + offset.dy;

    if (newCol < 0 || newRow < 0 || newCol >= this.mapWidth) {
      return -1;
    }

    return newRow * this.mapWidth + newCol;
  }

  /**
   * Find a fighter by ID.
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
   * Get fighter's current cell.
   */
  getFighterCell(fighterId: number): number | null {
    const fighter = this.findFighterById(fighterId);

    if (!fighter) {
      return null;
    }

    return fighter.read(CellPosition).cellId;
  }

  /**
   * Check if a cell is occupied by a fighter.
   */
  isCellOccupied(cellId: number): boolean {
    for (const entity of this.fighters.current) {
      if (entity.read(CellPosition).cellId === cellId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get fighter at a cell.
   */
  getFighterAtCell(cellId: number): number | null {
    for (const entity of this.fighters.current) {
      if (entity.read(CellPosition).cellId === cellId) {
        return entity.read(Fighter).id;
      }
    }

    return null;
  }

  /**
   * Add a forced movement to a fighter.
   */
  queueForcedMovement(
    fighterId: number,
    targetCellId: number,
    direction: number,
    distance: number,
    isPush: boolean
  ): void {
    const fighter = this.findFighterById(fighterId);

    if (!fighter) {
      return;
    }

    fighter.add(ForcedMovement, {
      targetCellId,
      distance,
      direction,
      isPush,
    });
  }
}

/**
 * Pending movement request.
 */
interface PendingMovement {
  fighterId: number;
  path: number[];
  mpCost: number;
}
