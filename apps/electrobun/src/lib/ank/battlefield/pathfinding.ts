/**
 * Cell data for pathfinding.
 */
export interface PathfindingCell {
  id: number;
  walkable: boolean;
  lineOfSight: boolean;
  groundLevel: number;
}

/**
 * Pathfinding configuration.
 */
export interface PathfindingConfig {
  mapWidth: number;
  mapHeight: number;
  cells: PathfindingCell[];
  occupiedCells?: Set<number>;
}

/**
 * Pathfinding node for A*.
 */
interface PathNode {
  cellId: number;
  g: number; // Cost from start
  h: number; // Heuristic to goal
  f: number; // Total cost
  parent: PathNode | null;
}

/**
 * Combat pathfinding.
 * Calculates movement paths on the isometric grid.
 */
export class CombatPathfinding {
  private mapWidth: number;
  private mapHeight: number;
  private cells: Map<number, PathfindingCell>;
  private occupiedCells: Set<number>;

  constructor(config: PathfindingConfig) {
    this.mapWidth = config.mapWidth;
    this.mapHeight = config.mapHeight;
    this.cells = new Map();
    this.occupiedCells = config.occupiedCells ?? new Set();

    for (const cell of config.cells) {
      this.cells.set(cell.id, cell);
    }
  }

  /**
   * Update occupied cells.
   */
  setOccupiedCells(occupied: Set<number>): void {
    this.occupiedCells = occupied;
  }

  /**
   * Add an occupied cell.
   */
  addOccupied(cellId: number): void {
    this.occupiedCells.add(cellId);
  }

  /**
   * Remove an occupied cell.
   */
  removeOccupied(cellId: number): void {
    this.occupiedCells.delete(cellId);
  }

  /**
   * Find path from start to goal.
   */
  findPath(startId: number, goalId: number): number[] | null {
    if (!this.isWalkable(startId) || !this.isWalkable(goalId)) {
      return null;
    }

    const openSet = new Map<number, PathNode>();
    const closedSet = new Set<number>();

    const startNode: PathNode = {
      cellId: startId,
      g: 0,
      h: this.heuristic(startId, goalId),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.g + startNode.h;
    openSet.set(startId, startNode);

    while (openSet.size > 0) {
      // Get node with lowest f score
      let current: PathNode | null = null;
      let lowestF = Infinity;

      for (const node of openSet.values()) {
        if (node.f < lowestF) {
          lowestF = node.f;
          current = node;
        }
      }

      if (!current) {
        break;
      }

      // Found goal
      if (current.cellId === goalId) {
        return this.reconstructPath(current);
      }

      openSet.delete(current.cellId);
      closedSet.add(current.cellId);

      // Check neighbors
      const neighbors = this.getNeighbors(current.cellId);

      for (const neighborId of neighbors) {
        if (closedSet.has(neighborId)) {
          continue;
        }

        if (!this.isWalkable(neighborId)) {
          continue;
        }

        // Can't walk through occupied cells (except goal)
        if (neighborId !== goalId && this.occupiedCells.has(neighborId)) {
          continue;
        }

        const tentativeG = current.g + 1;
        const existing = openSet.get(neighborId);

        if (!existing || tentativeG < existing.g) {
          const node: PathNode = {
            cellId: neighborId,
            g: tentativeG,
            h: this.heuristic(neighborId, goalId),
            f: 0,
            parent: current,
          };
          node.f = node.g + node.h;
          openSet.set(neighborId, node);
        }
      }
    }

    return null; // No path found
  }

  /**
   * Find all reachable cells within movement range.
   */
  findReachableCells(startId: number, maxMP: number): number[] {
    const reachable: number[] = [];
    const visited = new Map<number, number>(); // cellId -> cost
    const queue: Array<{ cellId: number; cost: number }> = [];

    queue.push({ cellId: startId, cost: 0 });
    visited.set(startId, 0);

    while (queue.length > 0) {
      const current = queue.shift();

      if (!current) {
        break;
      }

      if (current.cost > 0) {
        reachable.push(current.cellId);
      }

      if (current.cost >= maxMP) {
        continue;
      }

      const neighbors = this.getNeighbors(current.cellId);

      for (const neighborId of neighbors) {
        if (!this.isWalkable(neighborId)) {
          continue;
        }

        if (this.occupiedCells.has(neighborId)) {
          continue;
        }

        const newCost = current.cost + 1;
        const existingCost = visited.get(neighborId);

        if (existingCost === undefined || newCost < existingCost) {
          visited.set(neighborId, newCost);
          queue.push({ cellId: neighborId, cost: newCost });
        }
      }
    }

    return reachable;
  }

  /**
   * Find path with limited MP.
   */
  findPathWithMP(
    startId: number,
    goalId: number,
    maxMP: number
  ): number[] | null {
    const path = this.findPath(startId, goalId);

    if (!path) {
      return null;
    }

    // Path includes start cell, so actual movement is path.length - 1
    if (path.length - 1 > maxMP) {
      // Return partial path
      return path.slice(0, maxMP + 1);
    }

    return path;
  }

  /**
   * Get cells in line of sight from a cell.
   */
  getCellsInLineOfSight(fromId: number, maxRange: number): number[] {
    const cells: number[] = [];
    const fromCoords = this.cellToCoords(fromId);

    for (let dx = -maxRange; dx <= maxRange; dx++) {
      for (let dy = -maxRange; dy <= maxRange; dy++) {
        const distance = Math.abs(dx) + Math.abs(dy);

        if (distance === 0 || distance > maxRange) {
          continue;
        }

        const targetId = this.coordsToCell(
          fromCoords.x + dx,
          fromCoords.y + dy
        );

        if (targetId < 0) {
          continue;
        }

        if (this.hasLineOfSight(fromId, targetId)) {
          cells.push(targetId);
        }
      }
    }

    return cells;
  }

  /**
   * Check if there's line of sight between two cells.
   */
  hasLineOfSight(fromId: number, toId: number): boolean {
    const fromCoords = this.cellToCoords(fromId);
    const toCoords = this.cellToCoords(toId);

    const dx = toCoords.x - fromCoords.x;
    const dy = toCoords.y - fromCoords.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));

    if (steps === 0) {
      return true;
    }

    const stepX = dx / steps;
    const stepY = dy / steps;

    for (let i = 1; i < steps; i++) {
      const x = Math.round(fromCoords.x + stepX * i);
      const y = Math.round(fromCoords.y + stepY * i);
      const cellId = this.coordsToCell(x, y);

      if (cellId < 0) {
        continue;
      }

      const cell = this.cells.get(cellId);

      if (cell && !cell.lineOfSight) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate distance between two cells.
   */
  getDistance(fromId: number, toId: number): number {
    const fromCoords = this.cellToCoords(fromId);
    const toCoords = this.cellToCoords(toId);

    return (
      Math.abs(fromCoords.x - toCoords.x) + Math.abs(fromCoords.y - toCoords.y)
    );
  }

  /**
   * Check if cells are in a straight line.
   */
  isInLine(fromId: number, toId: number): boolean {
    const fromCoords = this.cellToCoords(fromId);
    const toCoords = this.cellToCoords(toId);

    return fromCoords.x === toCoords.x || fromCoords.y === toCoords.y;
  }

  /**
   * Get direction from one cell to another.
   */
  getDirection(fromId: number, toId: number): number {
    const fromCoords = this.cellToCoords(fromId);
    const toCoords = this.cellToCoords(toId);

    const dx = toCoords.x - fromCoords.x;
    const dy = toCoords.y - fromCoords.y;

    // 8 directions
    if (dx > 0 && dy === 0) return 2; // East
    if (dx > 0 && dy > 0) return 3; // South-East
    if (dx === 0 && dy > 0) return 4; // South
    if (dx < 0 && dy > 0) return 5; // South-West
    if (dx < 0 && dy === 0) return 6; // West
    if (dx < 0 && dy < 0) return 7; // North-West
    if (dx === 0 && dy < 0) return 0; // North
    return 1; // North-East
  }

  /**
   * Get cells adjacent to a cell.
   */
  getAdjacentCells(cellId: number): number[] {
    return this.getNeighbors(cellId);
  }

  /**
   * Check if cell is walkable.
   */
  private isWalkable(cellId: number): boolean {
    const cell = this.cells.get(cellId);
    return cell?.walkable ?? false;
  }

  /**
   * Get neighboring cells (4-directional for isometric grid).
   */
  private getNeighbors(cellId: number): number[] {
    const neighbors: number[] = [];
    const coords = this.cellToCoords(cellId);

    // 4 cardinal directions on isometric grid
    const offsets = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (const offset of offsets) {
      const nx = coords.x + offset.dx;
      const ny = coords.y + offset.dy;
      const neighborId = this.coordsToCell(nx, ny);

      if (neighborId >= 0 && this.cells.has(neighborId)) {
        neighbors.push(neighborId);
      }
    }

    return neighbors;
  }

  /**
   * Heuristic for A* (Manhattan distance).
   */
  private heuristic(fromId: number, toId: number): number {
    return this.getDistance(fromId, toId);
  }

  /**
   * Reconstruct path from goal node.
   */
  private reconstructPath(node: PathNode): number[] {
    const path: number[] = [];
    let current: PathNode | null = node;

    while (current) {
      path.unshift(current.cellId);
      current = current.parent;
    }

    return path;
  }

  /**
   * Convert cell ID to coordinates.
   */
  private cellToCoords(cellId: number): { x: number; y: number } {
    // Isometric grid cell layout
    const row = Math.floor(cellId / this.mapWidth);
    const col = cellId % this.mapWidth;

    return { x: col, y: row };
  }

  /**
   * Convert coordinates to cell ID.
   */
  private coordsToCell(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) {
      return -1;
    }

    return y * this.mapWidth + x;
  }
}

/**
 * Create pathfinding from map data.
 */
export function createPathfindingFromMap(
  mapWidth: number,
  mapHeight: number,
  walkableCells: number[],
  losBlockingCells: number[] = []
): CombatPathfinding {
  const cells: PathfindingCell[] = [];
  const walkableSet = new Set(walkableCells);
  const losBlockingSet = new Set(losBlockingCells);
  const totalCells = mapWidth * mapHeight;

  for (let i = 0; i < totalCells; i++) {
    cells.push({
      id: i,
      walkable: walkableSet.has(i),
      lineOfSight: !losBlockingSet.has(i),
      groundLevel: 0,
    });
  }

  return new CombatPathfinding({
    mapWidth,
    mapHeight,
    cells,
  });
}
