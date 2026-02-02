import { type Entity, System, system } from "@lastolivegames/becsy";

import {
  CellPosition,
  CombatContext,
  CombatPhase,
  Fighter,
  FighterStats,
  Spell,
  SpellCooldown,
  SpellCost,
  SpellZone,
  ZoneShape,
} from "@/ecs/components";

/**
 * Spell cast validation result.
 */
export interface SpellCastValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Spell cast result.
 */
export interface SpellCastResult {
  casterId: number;
  spellId: number;
  targetCellId: number;
  affectedCells: number[];
  apUsed: number;
  success: boolean;
}

/**
 * Spell cast system.
 * Validates and processes spell casting.
 */
@system
export class SpellCastSystem extends System {
  private combatContext = this.query((q) => q.current.with(CombatContext));

  private fighters = this.query(
    (q) => q.current.with(Fighter, FighterStats, CellPosition).write
  );

  private spells = this.query((q) =>
    q.current.with(Spell, SpellCost, SpellZone)
  );

  private cooldowns = this.query((q) => q.current.with(SpellCooldown).write);

  private mapWidth = 15;
  private pendingCasts: PendingCast[] = [];
  private castResults: SpellCastResult[] = [];

  execute(): void {
    // Only process during fighting phase
    for (const entity of this.combatContext.current) {
      const ctx = entity.read(CombatContext);

      if (ctx.phase !== CombatPhase.FIGHTING) {
        return;
      }
    }

    // Process pending casts
    this.processPendingCasts();
  }

  /**
   * Set map dimensions for range calculations.
   */
  setMapWidth(width: number): void {
    this.mapWidth = width;
  }

  /**
   * Request a spell cast.
   */
  requestCast(
    casterId: number,
    spellId: number,
    targetCellId: number
  ): SpellCastValidation {
    const caster = this.findFighterById(casterId);

    if (!caster) {
      return { valid: false, reason: "Caster not found" };
    }

    const spell = this.findSpellById(spellId);

    if (!spell) {
      return { valid: false, reason: "Spell not found" };
    }

    const validation = this.validateCast(caster, spell, targetCellId);

    if (!validation.valid) {
      return validation;
    }

    // Queue the cast
    this.pendingCasts.push({
      casterId,
      spellId,
      targetCellId,
    });

    return { valid: true };
  }

  /**
   * Get and clear cast results.
   */
  consumeResults(): SpellCastResult[] {
    const results = [...this.castResults];
    this.castResults = [];
    return results;
  }

  /**
   * Validate a spell cast.
   */
  validateCast(
    caster: Entity,
    spell: Entity,
    targetCellId: number
  ): SpellCastValidation {
    const casterStats = caster.read(FighterStats);
    const casterPos = caster.read(CellPosition);
    const spellData = spell.read(Spell);
    const spellCost = spell.read(SpellCost);

    // Check AP
    if (casterStats.ap < spellCost.apCost) {
      return { valid: false, reason: "Not enough AP" };
    }

    // Check cooldown
    if (this.isOnCooldown(spellData.id)) {
      return { valid: false, reason: "Spell on cooldown" };
    }

    // Check uses per turn
    if (!this.canUseThisTurn(spellData.id)) {
      return { valid: false, reason: "Max uses per turn reached" };
    }

    // Check range
    const distance = this.calculateDistance(casterPos.cellId, targetCellId);

    if (distance < spellCost.minRange || distance > spellCost.maxRange) {
      return { valid: false, reason: "Target out of range" };
    }

    // Check line of sight (if required)
    if (spellCost.lineOfSight) {
      if (!this.hasLineOfSight(casterPos.cellId, targetCellId)) {
        return { valid: false, reason: "No line of sight" };
      }
    }

    // Check linear only
    if (spellCost.linearOnly) {
      if (!this.isInLine(casterPos.cellId, targetCellId)) {
        return { valid: false, reason: "Must cast in a line" };
      }
    }

    return { valid: true };
  }

  /**
   * Process pending spell casts.
   */
  private processPendingCasts(): void {
    while (this.pendingCasts.length > 0) {
      const cast = this.pendingCasts.shift();

      if (cast) {
        this.executeCast(cast);
      }
    }
  }

  /**
   * Execute a spell cast.
   */
  private executeCast(cast: PendingCast): void {
    const caster = this.findFighterById(cast.casterId);
    const spell = this.findSpellById(cast.spellId);

    if (!caster || !spell) {
      this.castResults.push({
        casterId: cast.casterId,
        spellId: cast.spellId,
        targetCellId: cast.targetCellId,
        affectedCells: [],
        apUsed: 0,
        success: false,
      });
      return;
    }

    const spellCost = spell.read(SpellCost);
    const spellZone = spell.read(SpellZone);
    const spellData = spell.read(Spell);

    // Deduct AP
    const casterStats = caster.write(FighterStats);
    casterStats.ap -= spellCost.apCost;

    // Calculate affected cells
    const affectedCells = this.calculateAffectedCells(
      cast.targetCellId,
      spellZone.shape,
      spellZone.maxSize
    );

    // Update cooldown
    this.updateSpellCooldown(spellData.id);

    this.castResults.push({
      casterId: cast.casterId,
      spellId: cast.spellId,
      targetCellId: cast.targetCellId,
      affectedCells,
      apUsed: spellCost.apCost,
      success: true,
    });
  }

  /**
   * Calculate cells in spell range.
   */
  calculateRangeCells(
    casterCellId: number,
    minRange: number,
    maxRange: number,
    lineOfSight: boolean,
    linearOnly: boolean
  ): number[] {
    const cells: number[] = [];
    const totalCells = this.mapWidth * (this.mapWidth * 2 - 1);

    for (let cellId = 0; cellId < totalCells; cellId++) {
      const distance = this.calculateDistance(casterCellId, cellId);

      if (distance < minRange || distance > maxRange) {
        continue;
      }

      if (linearOnly && !this.isInLine(casterCellId, cellId)) {
        continue;
      }

      if (lineOfSight && !this.hasLineOfSight(casterCellId, cellId)) {
        continue;
      }

      cells.push(cellId);
    }

    return cells;
  }

  /**
   * Calculate affected cells from zone shape.
   */
  calculateAffectedCells(
    centerCell: number,
    shape: number,
    size: number
  ): number[] {
    switch (shape) {
      case ZoneShape.SINGLE:
        return [centerCell];

      case ZoneShape.CROSS:
        return this.getCrossCells(centerCell, size);

      case ZoneShape.CIRCLE:
        return this.getCircleCells(centerCell, size);

      case ZoneShape.LINE:
        return this.getLineCells(centerCell, size);

      case ZoneShape.RING:
        return this.getRingCells(centerCell, size);

      case ZoneShape.SQUARE:
        return this.getSquareCells(centerCell, size);

      case ZoneShape.DIAGONAL:
        return this.getDiagonalCells(centerCell, size);

      case ZoneShape.CONE:
        return this.getConeCells(centerCell, size);

      default:
        return [centerCell];
    }
  }

  /**
   * Calculate distance between two cells.
   */
  private calculateDistance(from: number, to: number): number {
    const fromCoords = this.cellToCoords(from);
    const toCoords = this.cellToCoords(to);

    // Manhattan distance in isometric grid
    return (
      Math.abs(fromCoords.x - toCoords.x) + Math.abs(fromCoords.y - toCoords.y)
    );
  }

  /**
   * Check if cells are in a line.
   */
  private isInLine(from: number, to: number): boolean {
    const fromCoords = this.cellToCoords(from);
    const toCoords = this.cellToCoords(to);

    return fromCoords.x === toCoords.x || fromCoords.y === toCoords.y;
  }

  /**
   * Check line of sight (simplified).
   */
  private hasLineOfSight(_from: number, _to: number): boolean {
    // Simplified - would need map data for proper LOS check
    return true;
  }

  /**
   * Convert cell ID to coordinates.
   */
  private cellToCoords(cellId: number): { x: number; y: number } {
    const row = Math.floor(cellId / this.mapWidth);
    const col = cellId % this.mapWidth;

    return { x: col, y: row };
  }

  /**
   * Convert coordinates to cell ID.
   */
  private coordsToCell(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.mapWidth) {
      return -1;
    }

    return y * this.mapWidth + x;
  }

  /**
   * Get cells in a cross pattern.
   */
  private getCrossCells(center: number, size: number): number[] {
    const cells: number[] = [center];
    const coords = this.cellToCoords(center);

    for (let i = 1; i <= size; i++) {
      // Up
      const up = this.coordsToCell(coords.x, coords.y - i);
      if (up >= 0) cells.push(up);

      // Down
      const down = this.coordsToCell(coords.x, coords.y + i);
      if (down >= 0) cells.push(down);

      // Left
      const left = this.coordsToCell(coords.x - i, coords.y);
      if (left >= 0) cells.push(left);

      // Right
      const right = this.coordsToCell(coords.x + i, coords.y);
      if (right >= 0) cells.push(right);
    }

    return cells;
  }

  /**
   * Get cells in a circle pattern.
   */
  private getCircleCells(center: number, radius: number): number[] {
    const cells: number[] = [];
    const coords = this.cellToCoords(center);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= radius) {
          const cell = this.coordsToCell(coords.x + dx, coords.y + dy);

          if (cell >= 0) {
            cells.push(cell);
          }
        }
      }
    }

    return cells;
  }

  /**
   * Get cells in a line pattern.
   */
  private getLineCells(center: number, length: number): number[] {
    // Line from center in the last cast direction
    // Simplified - just returns center + horizontal cells
    const cells: number[] = [center];
    const coords = this.cellToCoords(center);

    for (let i = 1; i <= length; i++) {
      const right = this.coordsToCell(coords.x + i, coords.y);
      if (right >= 0) cells.push(right);
    }

    return cells;
  }

  /**
   * Get cells in a ring pattern.
   */
  private getRingCells(center: number, radius: number): number[] {
    const cells: number[] = [];
    const coords = this.cellToCoords(center);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const distance = Math.abs(dx) + Math.abs(dy);

        if (distance === radius) {
          const cell = this.coordsToCell(coords.x + dx, coords.y + dy);

          if (cell >= 0) {
            cells.push(cell);
          }
        }
      }
    }

    return cells;
  }

  /**
   * Get cells in a square pattern.
   */
  private getSquareCells(center: number, size: number): number[] {
    const cells: number[] = [];
    const coords = this.cellToCoords(center);

    for (let dx = -size; dx <= size; dx++) {
      for (let dy = -size; dy <= size; dy++) {
        const cell = this.coordsToCell(coords.x + dx, coords.y + dy);

        if (cell >= 0) {
          cells.push(cell);
        }
      }
    }

    return cells;
  }

  /**
   * Get cells in a diagonal pattern.
   */
  private getDiagonalCells(center: number, size: number): number[] {
    const cells: number[] = [center];
    const coords = this.cellToCoords(center);

    for (let i = 1; i <= size; i++) {
      // Diagonals
      const upLeft = this.coordsToCell(coords.x - i, coords.y - i);
      const upRight = this.coordsToCell(coords.x + i, coords.y - i);
      const downLeft = this.coordsToCell(coords.x - i, coords.y + i);
      const downRight = this.coordsToCell(coords.x + i, coords.y + i);

      if (upLeft >= 0) cells.push(upLeft);
      if (upRight >= 0) cells.push(upRight);
      if (downLeft >= 0) cells.push(downLeft);
      if (downRight >= 0) cells.push(downRight);
    }

    return cells;
  }

  /**
   * Get cells in a cone pattern.
   */
  private getConeCells(center: number, size: number): number[] {
    // Simplified cone - expands in one direction
    const cells: number[] = [center];
    const coords = this.cellToCoords(center);

    for (let i = 1; i <= size; i++) {
      for (let w = -i; w <= i; w++) {
        const cell = this.coordsToCell(coords.x + w, coords.y + i);

        if (cell >= 0) {
          cells.push(cell);
        }
      }
    }

    return cells;
  }

  /**
   * Find fighter by ID.
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
   * Find spell by ID.
   */
  private findSpellById(id: number): Entity | null {
    for (const entity of this.spells.current) {
      if (entity.read(Spell).id === id) {
        return entity;
      }
    }

    return null;
  }

  /**
   * Check if spell is on cooldown.
   */
  private isOnCooldown(spellId: number): boolean {
    for (const entity of this.cooldowns.current) {
      const cooldown = entity.read(SpellCooldown);

      if (cooldown.spellId === spellId && cooldown.turnsRemaining > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if spell can be used this turn.
   */
  private canUseThisTurn(spellId: number): boolean {
    for (const entity of this.cooldowns.current) {
      const cooldown = entity.read(SpellCooldown);

      if (cooldown.spellId === spellId) {
        if (
          cooldown.maxUsesPerTurn > 0 &&
          cooldown.usesThisTurn >= cooldown.maxUsesPerTurn
        ) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Update spell cooldown after cast.
   */
  private updateSpellCooldown(spellId: number): void {
    for (const entity of this.cooldowns.current) {
      const cooldown = entity.write(SpellCooldown);

      if (cooldown.spellId === spellId) {
        cooldown.usesThisTurn++;

        if (cooldown.globalCooldown > 0) {
          cooldown.turnsRemaining = cooldown.globalCooldown;
        }

        return;
      }
    }
  }

  /**
   * Reset turn-based cooldowns (call at turn start).
   */
  resetTurnCooldowns(): void {
    for (const entity of this.cooldowns.current) {
      const cooldown = entity.write(SpellCooldown);
      cooldown.usesThisTurn = 0;

      if (cooldown.turnsRemaining > 0) {
        cooldown.turnsRemaining--;
      }
    }
  }
}

/**
 * Pending spell cast.
 */
interface PendingCast {
  casterId: number;
  spellId: number;
  targetCellId: number;
}
