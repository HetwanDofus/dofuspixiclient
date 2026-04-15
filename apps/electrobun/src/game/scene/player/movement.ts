import type { DofusPathfinding } from "@dofus/grid";
import { getDirOffsets } from "@dofus/grid";

import type { CellData } from "@/game/datacenter/cell";
import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerSpriteController } from "@/game/scene/player/sprite-controller";
import type { ActivePlayer } from "@/game/scene/player/types";
import {
  advanceMovement,
  getCellPositionWithSlope,
  getClampedDeltaMs,
  getMovementOffset,
  PlayerAnimation,
  shouldUseRun,
  startMovementSegment,
} from "@/game/scene/player/animation";

const PET_FOLLOW_DELAY_MS = 200;

/** Maps linked-child index (0-7) to a base direction slot around the parent. */
const CHILD_INDEX_TO_DIR = [2, 6, 4, 0, 3, 5, 1, 7];

/**
 * Dependencies PlayerMovement reads at call time. The caller (PlayerRenderer)
 * is the source of truth for map geometry + the player map, so we read through
 * getters instead of caching snapshots.
 */
export interface PlayerMovementDeps {
  mapWidth(): number;
  groundLevel(): number;
  cellDataMap(): Map<number, CellData>;
  pathfinding(): DofusPathfinding | null;
  pickingSystem(): PickingSystem | null;
  players(): Map<number, ActivePlayer>;
  spriteController(): PlayerSpriteController;
  calculateZIndex(cellId: number): number;
}

/**
 * Owns cell-to-cell path interpolation, teleportation, and linked-child
 * (pet) follow-up movement for all players. Stateless across players —
 * per-player movement state lives on ActivePlayer.
 */
export class PlayerMovement {
  constructor(private readonly deps: PlayerMovementDeps) {}

  /** Kick off a path. Resolves when the last segment arrives. */
  start(player: ActivePlayer, path: number[]): Promise<void> {
    return new Promise((resolve) => {
      if (path.length < 2) {
        resolve();
        return;
      }

      // Mounted players always walk (mount speed); others pick walk/run by path length.
      const useRun = player.isMounting ? false : shouldUseRun(path.length);
      player.path = path;
      player.pathIndex = 0;
      player.useRun = useRun;
      player.moving = true;
      player.animation = useRun ? PlayerAnimation.RUN : PlayerAnimation.WALK;
      player.moveResolve = resolve;
      this.deps.pickingSystem()?.markDirty();

      this.startSegment(player);

      if (player.linkedChildren.length > 0) {
        const finalCell = path[path.length - 1];
        setTimeout(() => {
          for (const childId of player.linkedChildren) {
            this.moveLinkedChild(childId, finalCell, player.direction);
          }
        }, PET_FOLLOW_DELAY_MS);
      }
    });
  }

  teleport(player: ActivePlayer, cellId: number): void {
    player.cellId = cellId;
    const pos = this.cellPos(cellId);
    player.container.x = pos.x;
    player.container.y = pos.y;
    player.container.zIndex = this.deps.calculateZIndex(cellId);
  }

  /**
   * Advance a player's movement for `deltaMs`. No-op when not moving.
   * Cell crossings trigger z-index recomputation + picking dirty + segment swap.
   */
  advance(player: ActivePlayer, deltaMs: number): void {
    if (!player.moving || player.path.length === 0) {
      return;
    }

    const clampedMs = getClampedDeltaMs(deltaMs);
    const deltaPx = player.movePixelSpeed * clampedMs;

    const state = this.snapshotState(player);
    const result = advanceMovement(
      state,
      deltaPx,
      this.deps.mapWidth(),
      this.deps.groundLevel(),
      this.deps.cellDataMap()
    );

    player.pathIndex = state.pathIndex;
    player.moving = state.moving;

    if (result.complete) {
      this.finishPath(player);
      return;
    }

    if (result.nextCell !== undefined) {
      this.crossCell(player, result.nextCell);
      return;
    }

    const offset = getMovementOffset(state, deltaPx);
    player.container.x += offset.x;
    player.container.y += offset.y;
    player.moveDistance -= deltaPx;
  }

  /**
   * Compute the cell where a linked child should stand relative to its parent
   * (childIndex 0 = directly behind parent, rotating clockwise).
   */
  aroundCell(
    parentCellId: number,
    parentDirection: number,
    childIndex: number
  ): number {
    const pathfinding = this.deps.pathfinding();

    if (!pathfinding) {
      return parentCellId;
    }

    const dirOffsets = getDirOffsets(this.deps.mapWidth());
    const baseDir = CHILD_INDEX_TO_DIR[childIndex % 8];
    const finalDir = (baseDir + parentDirection) % 8;
    const targetCell = parentCellId + dirOffsets[finalDir];

    return pathfinding.getNeighbors(parentCellId).includes(targetCell)
      ? targetCell
      : parentCellId;
  }

  private moveLinkedChild(
    childId: number,
    parentFinalCell: number,
    parentFinalDirection: number
  ): void {
    const child = this.deps.players().get(childId);
    const pathfinding = this.deps.pathfinding();

    if (!child || !pathfinding) {
      return;
    }

    const targetCell = this.aroundCell(
      parentFinalCell,
      parentFinalDirection,
      child.childIndex ?? 0
    );
    const path = pathfinding.findPath(child.cellId, targetCell);

    if (path && path.length > 1) {
      void this.start(child, path);
    }
  }

  /**
   * Begin a new cell-to-cell segment — computes pixel distance, direction
   * vector, and speed. Mirrors the original Dofus mc/Sprite.as moveToCell:
   *   moving forward (higher cellId): apply destination depth immediately.
   *   moving backward (lower cellId): keep current depth until arrival.
   * Either way the sprite holds the max of origin/destination depth mid-move.
   */
  private startSegment(player: ActivePlayer): void {
    const prevCellId = player.cellId;
    const state = this.snapshotState(player);

    const dir = startMovementSegment(
      state,
      this.deps.mapWidth(),
      this.deps.groundLevel(),
      this.deps.cellDataMap()
    );

    player.direction = dir;
    player.moveDistance = state.moveDistance;
    player.moveCosRot = state.moveCosRot;
    player.moveSinRot = state.moveSinRot;
    player.movePixelSpeed = state.movePixelSpeed;

    const nextCellId = player.path[player.pathIndex + 1];

    if (nextCellId !== undefined && nextCellId > prevCellId) {
      player.container.zIndex = this.deps.calculateZIndex(nextCellId);
    }

    const baseAnim = player.useRun ? "run" : "walk";
    this.deps.spriteController().switch(player, baseAnim, dir);
  }

  private crossCell(player: ActivePlayer, nextCell: number): void {
    const prevCellId = player.cellId;
    const toPos = this.cellPos(nextCell);
    player.container.x = toPos.x;
    player.container.y = toPos.y;
    player.cellId = nextCell;

    if (nextCell <= prevCellId) {
      player.container.zIndex = this.deps.calculateZIndex(nextCell);
    }

    this.deps.pickingSystem()?.markDirty();
    this.startSegment(player);
  }

  private finishPath(player: ActivePlayer): void {
    player.path = [];
    player.pathIndex = 0;
    player.moveDistance = 0;
    player.moving = false;
    player.animation = PlayerAnimation.IDLE;
    this.deps.pickingSystem()?.markDirty();

    this.deps.spriteController().switch(player, "static", player.direction);

    if (player.moveResolve) {
      const resolve = player.moveResolve;
      player.moveResolve = undefined;
      resolve();
    }
  }

  private snapshotState(player: ActivePlayer) {
    return {
      path: player.path,
      pathIndex: player.pathIndex,
      moveDistance: player.moveDistance,
      moveCosRot: player.moveCosRot,
      moveSinRot: player.moveSinRot,
      movePixelSpeed: player.movePixelSpeed,
      useRun: player.useRun,
      isMounting: player.isMounting,
      moving: player.moving,
    };
  }

  private cellPos(cellId: number): { x: number; y: number } {
    return getCellPositionWithSlope(
      cellId,
      this.deps.mapWidth(),
      this.deps.groundLevel(),
      this.deps.cellDataMap()
    );
  }
}
