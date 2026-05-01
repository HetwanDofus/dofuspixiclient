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
  getRunLimit,
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
  /**
   * Whether the renderer is currently in fight mode. Used to pick the
   * AS2 `runLimit` (3 in fight for everyone, 3 for Characters
   * elsewhere, 6 for non-Characters on the overworld).
   */
  isFight(): boolean;
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
      // Server broadcasts step-only paths (maps.path-codec.ts
      // decodePath returns { direction, cell } starting at step 1 —
      // the origin isn't on the wire). `startMovementSegment` reads
      // `path[pathIndex]` as the anchor though, so we need a path
      // that begins with the fighter's current cell. Prepend unless
      // the caller already included it (client-side pathfinder does).
      const normalized =
        path.length > 0 && path[0] !== player.cellId
          ? [player.cellId, ...path]
          : path;

      if (normalized.length < 2) {
        resolve();
        return;
      }

      // Mounted players always walk (mount speed); others pick walk/run
      // by path length using the AS2 per-context runLimit (3 for
      // Characters always, 6 for non-Characters on the overworld).
      const runLimit = getRunLimit({
        isCharacter: player.isCharacter,
        isFight: this.deps.isFight(),
      });
      const useRun = player.isMounting
        ? false
        : shouldUseRun(normalized.length, runLimit);
      player.path = normalized;
      player.pathIndex = 0;
      player.useRun = useRun;
      player.moving = true;
      player.animation = useRun ? PlayerAnimation.RUN : PlayerAnimation.WALK;
      player.moveResolve = resolve;
      this.deps.pickingSystem()?.markDirty();

      this.startSegment(player);

      if (player.linkedChildren.length > 0) {
        const finalCell = normalized[normalized.length - 1];
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
   *
   * Each frame's delta is carried across segment boundaries — a
   * single frame can legitimately consume multiple cells on a fast
   * run or after a framerate dip. Without carry-over the sprite
   * paused one frame at every cell cross and the walk stutter-
   * stepped from cell to cell.
   */
  advance(player: ActivePlayer, deltaMs: number): void {
    if (!player.moving || player.path.length === 0) {
      return;
    }

    let remaining = player.movePixelSpeed * getClampedDeltaMs(deltaMs);
    // Safety cap in case movement state wedges — a 60fps frame at a
    // realistic run speed traverses at most ~2 cells.
    let safety = 8;

    while (remaining > 0 && player.moving && safety-- > 0) {
      if (player.moveDistance > remaining) {
        // Mid-segment advance by remaining.
        const offset = getMovementOffset(this.snapshotState(player), remaining);
        player.container.x += offset.x;
        player.container.y += offset.y;
        player.moveDistance -= remaining;
        return;
      }

      // This tick reaches or overshoots the segment end. Apply the
      // exact remaining segment offset, then hand off to the state
      // machine to either cross into the next cell or finish.
      const used = player.moveDistance;
      const offset = getMovementOffset(this.snapshotState(player), used);
      player.container.x += offset.x;
      player.container.y += offset.y;
      remaining -= used;
      player.moveDistance = 0;

      const state = this.snapshotState(player);
      const result = advanceMovement(
        state,
        0,
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
        // crossCell → startSegment initializes moveDistance for the
        // new segment; the loop continues with whatever `remaining`
        // pixels are left, walking along the new direction.
      }
    }
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
    // Snap cellId + container to the final cell. `crossCell` only
    // runs for intermediate segments — the last segment hits
    // `advanceMovement`'s `complete` branch, which never calls
    // `crossCell`, so without this finisher `player.cellId` stays at
    // the penultimate cell (or the origin, for a 1-step move) even
    // though the container sits on the real final tile. Any
    // subsequent move would then compute its first segment's
    // direction vector from the stale cell id, making the sprite
    // slide diagonally off its real position.
    if (player.path.length > 0) {
      const finalCell = player.path[player.path.length - 1];
      if (typeof finalCell === "number") {
        const finalPos = this.cellPos(finalCell);
        player.cellId = finalCell;
        player.container.x = finalPos.x;
        player.container.y = finalPos.y;
        player.container.zIndex = this.deps.calculateZIndex(finalCell);
      }
    }

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
      speedModerator: player.speedModerator,
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
