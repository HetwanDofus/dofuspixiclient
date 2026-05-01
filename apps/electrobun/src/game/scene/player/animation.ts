import { getDirection } from "@dofus/grid";

import type { CellData } from "@/game/datacenter/cell";
import { getDirectionSuffix } from "@/game/assets/character-sprite";
import { getCellPosition, getSlopeYOffset } from "@/game/datacenter/cell";

/**
 * Player animation state.
 */
export const PlayerAnimation = {
  IDLE: "idle",
  WALK: "walk",
  RUN: "run",
  ATTACK: "attack",
  HIT: "hit",
  DEATH: "death",
  CAST: "cast",
  SIT: "sit",
} as const;

export type PlayerAnimationValue =
  (typeof PlayerAnimation)[keyof typeof PlayerAnimation];

/**
 * Map PlayerAnimation state to sprite animation base name.
 */
export const ANIM_TO_SPRITE_BASE: Record<string, string> = {
  [PlayerAnimation.IDLE]: "static",
  [PlayerAnimation.WALK]: "walk",
  [PlayerAnimation.RUN]: "run",
  [PlayerAnimation.ATTACK]: "anim0",
  [PlayerAnimation.HIT]: "hit",
  [PlayerAnimation.DEATH]: "die",
  [PlayerAnimation.CAST]: "anim1",
  [PlayerAnimation.SIT]: "emoteStatic1",
};

/**
 * One-shot animations play once and hold on the last frame instead of
 * looping back to frame 0. Mirrors AS2 `Sprite.setAnim(name, bLoop=false)`
 * — the original Flash MovieClip stops on its last frame for cast/hit/die.
 * Looping animations (idle, walk, run, sit) continue to wrap modulo textureCount.
 */
const ONE_SHOT_ANIMS: ReadonlySet<PlayerAnimationValue> = new Set([
  PlayerAnimation.CAST,
  PlayerAnimation.HIT,
  PlayerAnimation.DEATH,
  PlayerAnimation.ATTACK,
]);

export function isOneShotAnimation(anim: PlayerAnimationValue): boolean {
  return ONE_SHOT_ANIMS.has(anim);
}

/**
 * Per-direction movement speeds in px/ms (from ank.battlefield.mc.Sprite).
 */
const WALK_SPEEDS = [0.07, 0.06, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06];
const RUN_SPEEDS = [0.17, 0.15, 0.15, 0.15, 0.17, 0.15, 0.15, 0.15];
const MOUNT_SPEEDS = [0.23, 0.2, 0.2, 0.2, 0.23, 0.2, 0.2, 0.2];

/** Maximum frame delta in ms — matches original's cap in basicMove. */
const MAX_FRAME_MS = 125;

/** Per-step ±0.01 px/ms speed bias for level/slope transitions (mc/Sprite.as:306-324). */
const SLOPE_BIAS = 0.01;

/**
 * Animation frame state for a player.
 */
export interface FighterFrameState {
  frameIndex: number;
  frameTimer: number;
}

/**
 * Active movement segment state.
 */
export interface FighterMovementState {
  /** Full path of cell IDs for current movement. */
  path: number[];
  /** Index into path: currently moving FROM path[pathIndex] TO path[pathIndex+1]. */
  pathIndex: number;
  /** Remaining pixel distance to the target cell of the current segment. */
  moveDistance: number;
  /** Movement direction unit vector (x component). */
  moveCosRot: number;
  /** Movement direction unit vector (y component). */
  moveSinRot: number;
  /** Current segment pixel speed in px/ms. */
  movePixelSpeed: number;
  /** Whether the current movement uses run speed. */
  useRun: boolean;
  /** Whether the player is mounted (uses MOUNT_SPEEDS). */
  isMounting: boolean;
  /**
   * Per-character speed multiplier applied on top of WALK/RUN/MOUNT.
   * Mirrors AS2 mc/Sprite.as:305 `_loc14_ *= this._oData.speedModerator`.
   * Defaults to 1.0 — only future haste/slow effects should mutate it.
   */
  speedModerator: number;
  moving: boolean;
  moveResolve?: () => void;
}

/**
 * Resolve animation name from animation type and direction.
 */
export function getAnimationBaseFromType(
  animationType: PlayerAnimationValue
): string {
  return ANIM_TO_SPRITE_BASE[animationType] ?? "static";
}

/**
 * Build full animation name from base animation and direction.
 */
export function buildAnimationName(
  baseAnim: string,
  direction: number
): string {
  const suffix = getDirectionSuffix(direction);
  return `${baseAnim}${suffix}`;
}

/**
 * Initialize movement state.
 */
export function initMovementState(): FighterMovementState {
  return {
    path: [],
    pathIndex: 0,
    moveDistance: 0,
    moveCosRot: 0,
    moveSinRot: 0,
    movePixelSpeed: 0,
    useRun: false,
    isMounting: false,
    speedModerator: 1,
    moving: false,
    moveResolve: undefined,
  };
}

/**
 * Initialize frame animation state.
 */
export function initFrameState(): FighterFrameState {
  return {
    frameIndex: 0,
    frameTimer: 0,
  };
}

/**
 * Calculate cell position with ground level and slope.
 */
export function getCellPositionWithSlope(
  cellId: number,
  mapWidth: number,
  groundLevel: number,
  cellDataMap: Map<number, CellData>
): { x: number; y: number } {
  const cell = cellDataMap.get(cellId);
  const level = cell?.groundLevel ?? groundLevel;
  const slope = cell?.groundSlope ?? 1;
  const pos = getCellPosition(cellId, mapWidth, level);
  return { x: pos.x, y: pos.y + getSlopeYOffset(slope) };
}

/**
 * Begin a new cell-to-cell movement segment (matches original moveToCell).
 * Returns the direction and updates movement state.
 */
export function startMovementSegment(
  movement: FighterMovementState,
  mapWidth: number,
  groundLevel: number,
  cellDataMap: Map<number, CellData>
): number {
  const fromCell = movement.path[movement.pathIndex];
  const toCell = movement.path[movement.pathIndex + 1];

  // Compute direction
  const dir = getDirection(fromCell, toCell, mapWidth);

  // Get pixel positions
  const fromPos = getCellPositionWithSlope(
    fromCell,
    mapWidth,
    groundLevel,
    cellDataMap
  );
  const toPos = getCellPositionWithSlope(
    toCell,
    mapWidth,
    groundLevel,
    cellDataMap
  );

  // Pixel distance (matches original: Math.sqrt(dx^2 + dy^2))
  const dx = toPos.x - fromPos.x;
  const dy = toPos.y - fromPos.y;
  movement.moveDistance = Math.sqrt(dx * dx + dy * dy);

  // Direction unit vector (matches original: atan2 → cos/sin)
  const angle = Math.atan2(dy, dx);
  movement.moveCosRot = Math.cos(angle);
  movement.moveSinRot = Math.sin(angle);

  // Base speed in px/ms (matches original WALK_SPEEDS / RUN_SPEEDS / MOUNT_SPEEDS indexed by direction)
  let speed = movement.isMounting
    ? MOUNT_SPEEDS[dir]
    : movement.useRun
      ? RUN_SPEEDS[dir]
      : WALK_SPEEDS[dir];

  // Slope / ground-level bias (mc/Sprite.as:306-324) — descend faster,
  // climb slower, and hop a half-bias on plain↔slope transitions.
  // AS2 uses 1 as the "no slope" sentinel; we default undefined to 1
  // so cells without an explicit slope behave like flat ground.
  const fromCellData = cellDataMap.get(fromCell);
  const toCellData = cellDataMap.get(toCell);
  if (fromCellData && toCellData) {
    const fromSlope = fromCellData.groundSlope ?? 1;
    const toSlope = toCellData.groundSlope ?? 1;
    if (toCellData.groundLevel < fromCellData.groundLevel) {
      speed += SLOPE_BIAS;
    } else if (toCellData.groundLevel > fromCellData.groundLevel) {
      speed -= SLOPE_BIAS;
    } else if (fromSlope !== toSlope) {
      if (toSlope === 1) {
        speed += SLOPE_BIAS;
      } else if (fromSlope === 1) {
        speed -= SLOPE_BIAS;
      }
    }
  }

  // Per-character multiplier (mc/Sprite.as:305) — default 1.0.
  speed *= movement.speedModerator;

  movement.movePixelSpeed = speed;

  return dir;
}

/**
 * Update sprite frame animation based on elapsed time.
 * Modifies frame state in-place.
 *
 * `loop=true` (default) wraps back to frame 0 once the last frame plays
 * — correct for idle/walk/run.
 * `loop=false` holds at the last frame index — matches AS2's
 * `bLoop=false` behavior for cast/hit/die (the MovieClip stops on its
 * final frame and stays there until something else calls `setAnim`).
 *
 * One frame max per tick. A `while`-style catch-up across hitches
 * burst-advances multiple frames in a single render and visibly
 * staggers fast-cycling animations (run is 30 frames at 60fps — a
 * 2-frame burst is ~7 % of the cycle and obvious to the eye). The
 * `frameTimer` bank is clamped to `2 × frameDuration` so a long pause
 * (tab backgrounded, GC, big hitch) can't accumulate work we'd later
 * have to spend in one render. The trade-off is a bounded ≤1-frame
 * phase lag after a hitch — invisible in standalone playback because
 * subsequent ticks still resume at the intended fps from the new
 * banked offset.
 */
export function updateFrameAnimation(
  frame: FighterFrameState,
  deltaS: number,
  textureCount: number,
  fps: number,
  loop = true
): void {
  if (textureCount <= 1) {
    return;
  }

  frame.frameTimer += deltaS;

  const frameDuration = 1 / fps;
  const maxBank = frameDuration * 2;

  if (frame.frameTimer > maxBank) {
    frame.frameTimer = maxBank;
  }

  if (frame.frameTimer >= frameDuration) {
    frame.frameTimer -= frameDuration;
    if (loop) {
      frame.frameIndex = (frame.frameIndex + 1) % textureCount;
    } else if (frame.frameIndex < textureCount - 1) {
      frame.frameIndex += 1;
    }
    // When loop=false and we're already at the last frame, hold (no-op).
  }
}

/**
 * Advance movement along a path segment by pixel distance.
 * Returns { complete: boolean, nextCell?: number } when segment completes.
 */
export function advanceMovement(
  movement: FighterMovementState,
  deltaPx: number,
  _mapWidth: number,
  _groundLevel: number,
  _cellDataMap: Map<number, CellData>
): { complete: boolean; nextCell?: number } {
  if (movement.moveDistance <= deltaPx) {
    // Segment complete — snap to destination cell and advance
    const toCell = movement.path[movement.pathIndex + 1];
    movement.pathIndex++;

    if (movement.pathIndex >= movement.path.length - 1) {
      // Entire path complete
      movement.path = [];
      movement.pathIndex = 0;
      movement.moveDistance = 0;
      movement.moving = false;
      return { complete: true };
    }

    // Return next cell so caller can update position
    return { complete: false, nextCell: toCell };
  }

  // Mid-segment: advance position by deltaPx
  return { complete: false };
}

/**
 * Get the pixel position to advance to during movement interpolation.
 */
export function getMovementOffset(
  movement: FighterMovementState,
  deltaPx: number
): { x: number; y: number } {
  return {
    x: deltaPx * movement.moveCosRot,
    y: deltaPx * movement.moveSinRot,
  };
}

/**
 * Get clamped frame delta in milliseconds (caps at MAX_FRAME_MS like original).
 */
export function getClampedDeltaMs(deltaMs: number): number {
  return Math.min(deltaMs, MAX_FRAME_MS);
}

/**
 * Run-vs-walk path-length cutoff. Mirrors dofus.aks.extend.GameActionsEx
 * (assets/sources/client-code/dofus/aks/extend/GameActionsEx.as:160) which
 * overrides the documented `SpriteHandler.DEFAULT_RUNLINIT = 6` per context:
 *
 *   - Character sprite (player / other PCs): always 3 (overworld + fight)
 *   - Non-Character (NPC / monster) on overworld: 6
 *   - Non-Character in fight: 3
 *
 * Compared as `path.length > runLimit` where `path` includes the origin —
 * so for a Character, 3+ movement steps trigger run.
 */
export function getRunLimit(opts: {
  isCharacter: boolean;
  isFight: boolean;
}): number {
  if (opts.isFight) {
    return 3;
  }
  return opts.isCharacter ? 3 : 6;
}

/**
 * Determine if a path should use run or walk animation, given the
 * `runLimit` from `getRunLimit` for the sprite's current context.
 */
export function shouldUseRun(pathLength: number, runLimit: number): boolean {
  return pathLength > runLimit;
}
