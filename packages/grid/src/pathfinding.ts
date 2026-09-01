import { cellToCoord, cellToRowCol } from "./cell.ts";
import { DIR_CHANGE_PENALTY, DIR_COSTS, getDirOffsets } from "./directions.ts";
import { isValidDirection } from "./neighbors.ts";

const MAX_PATH_LENGTH = 500;

interface PathNode {
  cellId: number;
  g: number;
  v: number;
  h: number;
  f: number;
  d: number;
  parent: PathNode | null;
}

/**
 * Unified A* pathfinding for the Dofus isometric grid.
 *
 * Faithfully replicates the original AS pathfinding:
 * - Diagonal (restricted) moves cost 1.0, cardinal (unrestricted) cost 1.5
 * - Direction changes incur a +0.5 penalty (smoother paths)
 * - Euclidean heuristic in isometric coordinates
 * - Virtual cost (v) used for f-score, actual distance (g) for max-length check
 * - Closed nodes can be reopened if a better virtual cost is found
 */
export class DofusPathfinding {
  private mapWidth: number;
  private totalRows: number;
  private dirOffsets: number[];
  private walkableSet: Set<number>;
  private occupiedCells: Set<number> = new Set();

  constructor(mapWidth: number, mapHeight: number, walkableCellIds: number[]) {
    this.mapWidth = mapWidth;
    this.totalRows = 2 * mapHeight - 1;
    this.dirOffsets = getDirOffsets(mapWidth);
    this.walkableSet = new Set(walkableCellIds);
  }

  get width(): number {
    return this.mapWidth;
  }

  addOccupied(cellId: number): void {
    this.occupiedCells.add(cellId);
  }

  removeOccupied(cellId: number): void {
    this.occupiedCells.delete(cellId);
  }

  clearOccupied(): void {
    this.occupiedCells.clear();
  }

  /**
   * Fight-mode A*. Same as findPath but restricts transitions to the
   * four cardinal-isometric directions (1=SE, 3=SW, 5=NW, 7=NE) — the
   * only ones valid on the Dofus 1.29 combat grid. The half-step
   * directions 0/2/4/6 are walkable in roleplay but illegal in fight
   * and would get rejected by the server's path validator.
   */
  findFightPath(startId: number, goalId: number): number[] | null {
    return this.findPath(startId, goalId, true);
  }

  findPath(
    startId: number,
    goalId: number,
    orthogonalOnly = false
  ): number[] | null {
    if (!this.walkableSet.has(startId) || !this.walkableSet.has(goalId)) {
      return null;
    }
    if (startId === goalId) {
      return [startId];
    }

    const openSet = new Map<number, PathNode>();
    const closedSet = new Map<number, number>();

    const startNode: PathNode = {
      cellId: startId,
      g: 0,
      v: 0,
      h: this.heuristic(startId, goalId),
      f: 0,
      d: -1,
      parent: null,
    };
    startNode.f = startNode.h;
    openSet.set(startId, startNode);

    while (openSet.size > 0) {
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

      if (current.cellId === goalId) {
        return this.reconstructPath(current);
      }

      openSet.delete(current.cellId);
      closedSet.set(current.cellId, current.v);

      const { row, col, isLong } = cellToRowCol(current.cellId, this.mapWidth);

      for (let dir = 0; dir < 8; dir++) {
        // Fight mode only uses the odd directions (1=SE, 3=SW, 5=NW,
        // 7=NE) — the ones that move a full cell visually. The
        // half-step directions (0/2/4/6) are roleplay-only and fail
        // server-side path validation in combat.
        if (orthogonalOnly && (dir & 1) === 0) {
          continue;
        }
        if (
          !isValidDirection(
            row,
            col,
            isLong,
            dir,
            this.mapWidth,
            this.totalRows
          )
        ) {
          continue;
        }

        const neighborId = current.cellId + (this.dirOffsets[dir] as number);
        if (!this.walkableSet.has(neighborId)) {
          continue;
        }
        if (neighborId !== goalId && this.occupiedCells.has(neighborId)) {
          continue;
        }

        const moveCost = DIR_COSTS[dir] as number;
        const dirChangeCost =
          current.d >= 0 && dir !== current.d ? DIR_CHANGE_PENALTY : 0;
        const tentativeG = current.g + moveCost;
        const tentativeV = current.v + moveCost + dirChangeCost;

        let existingV: number | null = null;
        const openNode = openSet.get(neighborId);
        if (openNode) {
          existingV = openNode.v;
        } else {
          const closedV = closedSet.get(neighborId);
          if (closedV !== undefined) {
            existingV = closedV;
          }
        }

        if (
          (existingV === null || existingV > tentativeV) &&
          tentativeG <= MAX_PATH_LENGTH
        ) {
          closedSet.delete(neighborId);

          const h = this.heuristic(neighborId, goalId);
          const node: PathNode = {
            cellId: neighborId,
            g: tentativeG,
            v: tentativeV,
            h,
            f: tentativeV + h,
            d: dir,
            parent: current,
          };
          openSet.set(neighborId, node);
        }
      }
    }

    return null;
  }

  /**
   * Find the shortest reachable path that stops beside `targetId`.
   *
   * Interactive resources occupy their own map cell visually; walking onto
   * that cell puts the character inside the tree/vein. Each reachable
   * neighbour is therefore tried as a destination and the shortest route is
   * returned. A character already beside the resource stays put.
   */
  findAdjacentPath(startId: number, targetId: number): number[] | null {
    let best: number[] | null = null;

    for (const neighbor of this.getNeighbors(targetId)) {
      if (!this.walkableSet.has(neighbor)) {
        continue;
      }
      if (neighbor !== startId && this.occupiedCells.has(neighbor)) {
        continue;
      }

      const path = this.findPath(startId, neighbor);
      if (path && (!best || path.length < best.length)) {
        best = path;
      }
    }

    return best;
  }

  /**
   * Return every walkable cell reachable from `start` in at most
   * `maxSteps` orthogonal/diagonal hops via a breadth-first flood fill.
   * Used to render the cyan MP-range tint on the player's turn so the
   * client can show the same set of cells the server will accept for
   * a fight movement request.
   *
   * The starting cell is excluded from the result. Cells held by other
   * fighters (in `occupiedCells`) are walkable as transit but never
   * appear as a destination — same rule the server uses.
   */
  reachable(start: number, maxSteps: number, orthogonalOnly = false): number[] {
    if (maxSteps <= 0 || !this.walkableSet.has(start)) {
      return [];
    }
    const visited = new Map<number, number>();
    visited.set(start, 0);
    const queue: number[] = [start];
    const out: number[] = [];
    while (queue.length > 0) {
      const cell = queue.shift() as number;
      const depth = visited.get(cell) ?? 0;
      if (depth >= maxSteps) {
        continue;
      }
      const neighbors = orthogonalOnly
        ? this.getFightNeighbors(cell)
        : this.getNeighbors(cell);
      for (const n of neighbors) {
        if (!this.walkableSet.has(n) || visited.has(n)) {
          continue;
        }
        visited.set(n, depth + 1);
        if (!this.occupiedCells.has(n)) {
          out.push(n);
        }
        queue.push(n);
      }
    }
    return out;
  }

  /**
   * Fight-grid neighbors: the four cardinal-isometric cells (SE, SW,
   * NW, NE). Excludes the half-step directions that are legal in
   * roleplay but illegal in combat.
   */
  getFightNeighbors(cellId: number): number[] {
    const { row, col, isLong } = cellToRowCol(cellId, this.mapWidth);
    const out: number[] = [];
    for (const dir of [1, 3, 5, 7]) {
      if (
        isValidDirection(row, col, isLong, dir, this.mapWidth, this.totalRows)
      ) {
        out.push(cellId + (this.dirOffsets[dir] as number));
      }
    }
    return out;
  }

  /**
   * Return every cell within [minRange, maxRange] hops of `center`,
   * used to preview spell-cast targeting. Ignores walkability so the
   * tint covers holes / void too — the consumer is responsible for
   * trimming by line-of-sight if needed.
   */
  cellsInRange(
    center: number,
    minRange: number,
    maxRange: number,
    orthogonalOnly = false
  ): number[] {
    if (maxRange < minRange) {
      return [];
    }
    const depth = new Map<number, number>();
    depth.set(center, 0);
    const queue: number[] = [center];
    const out: number[] = [];
    while (queue.length > 0) {
      const cell = queue.shift() as number;
      const d = depth.get(cell) ?? 0;
      // Self-cast spells (rangeMin = 0) need the caster's own cell in
      // the preview ring so the user can click themselves to confirm
      // the cast — Armure Incandescente, Tactique, etc. all have
      // rangeMin = rangeMax = 0 and previously got an empty array.
      if (d >= minRange) {
        out.push(cell);
      }
      if (d >= maxRange) {
        continue;
      }
      const neighbors = orthogonalOnly
        ? this.getFightNeighbors(cell)
        : this.getNeighbors(cell);
      for (const n of neighbors) {
        if (depth.has(n)) {
          continue;
        }
        depth.set(n, d + 1);
        queue.push(n);
      }
    }
    return out;
  }

  /**
   * Get valid neighbor cell IDs for a given cell.
   */
  getNeighbors(cellId: number): number[] {
    const { row, col, isLong } = cellToRowCol(cellId, this.mapWidth);
    const neighbors: number[] = [];
    for (let dir = 0; dir < 8; dir++) {
      if (
        isValidDirection(row, col, isLong, dir, this.mapWidth, this.totalRows)
      ) {
        neighbors.push(cellId + (this.dirOffsets[dir] as number));
      }
    }
    return neighbors;
  }

  /**
   * Validate that a path is walkable and connected.
   */
  validatePath(path: number[], currentCellId: number): boolean {
    if (path.length < 2) {
      return false;
    }
    if (path[0] !== currentCellId) {
      return false;
    }

    for (let i = 0; i < path.length; i++) {
      if (!this.walkableSet.has(path[i] as number)) {
        return false;
      }
    }

    for (let i = 0; i < path.length - 1; i++) {
      const neighbors = this.getNeighbors(path[i] as number);
      if (!neighbors.includes(path[i + 1] as number)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get direction (0-7) between two cells (instance method).
   */
  getDirection(fromId: number, toId: number): number {
    const diff = toId - fromId;

    for (let dir = 7; dir >= 0; dir--) {
      if (this.dirOffsets[dir] === diff) {
        return dir;
      }
    }

    const from = cellToCoord(fromId, this.mapWidth);
    const to = cellToCoord(toId, this.mapWidth);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    if (dx === 0) {
      return dy > 0 ? 3 : 7;
    }
    return dx > 0 ? 1 : 5;
  }

  private heuristic(fromId: number, toId: number): number {
    const a = cellToCoord(fromId, this.mapWidth);
    const b = cellToCoord(toId, this.mapWidth);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return Math.sqrt(dx * dx + dy * dy);
  }

  private reconstructPath(node: PathNode): number[] {
    const path: number[] = [];
    let current: PathNode | null = node;
    while (current) {
      path.unshift(current.cellId);
      current = current.parent;
    }
    return path;
  }
}
