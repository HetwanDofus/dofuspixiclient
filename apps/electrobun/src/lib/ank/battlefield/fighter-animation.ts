import { getDirectionSuffix } from "./character-sprite";
import { getDirection } from "./dofus-pathfinding";
import type { CellData } from "./datacenter/cell";
import { getCellPosition, getSlopeYOffset } from "./datacenter/cell";

/**
 * Fighter animation state.
 */
export const FighterAnimation = {
  IDLE: "idle",
  WALK: "walk",
  RUN: "run",
  ATTACK: "attack",
  HIT: "hit",
  DEATH: "death",
  CAST: "cast",
  SIT: "sit",
} as const;

export type FighterAnimationValue =
  (typeof FighterAnimation)[keyof typeof FighterAnimation];

/**
 * Map FighterAnimation state to sprite animation base name.
 */
export const ANIM_TO_SPRITE_BASE: Record<string, string> = {
  [FighterAnimation.IDLE]: "static",
  [FighterAnimation.WALK]: "walk",
  [FighterAnimation.RUN]: "run",
  [FighterAnimation.ATTACK]: "anim0",
  [FighterAnimation.HIT]: "hit",
  [FighterAnimation.DEATH]: "die",
  [FighterAnimation.CAST]: "anim1",
  [FighterAnimation.SIT]: "emoteStatic1",
};

/**
 * Per-direction movement speeds in px/ms (from ank.battlefield.mc.Sprite).
 */
const WALK_SPEEDS = [0.07, 0.06, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06];
const RUN_SPEEDS = [0.17, 0.15, 0.15, 0.15, 0.17, 0.15, 0.15, 0.15];
const MOUNT_SPEEDS = [0.23, 0.20, 0.20, 0.20, 0.23, 0.20, 0.20, 0.20];

/** Maximum frame delta in ms — matches original's cap in basicMove. */
const MAX_FRAME_MS = 125;

/** Paths with more steps than this use run animation (original: DEFAULT_RUNLINIT = 6, checked as path.length > 6). */
export const RUN_THRESHOLD = 6;

/**
 * Animation frame state for a fighter.
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
  /** Whether the fighter is mounted (uses MOUNT_SPEEDS). */
  isMounting: boolean;
  moving: boolean;
  moveResolve?: () => void;
}

/**
 * Resolve animation name from animation type and direction.
 */
export function getAnimationBaseFromType(
  animationType: FighterAnimationValue
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

  // Speed in px/ms (matches original WALK_SPEEDS / RUN_SPEEDS / MOUNT_SPEEDS indexed by direction)
  movement.movePixelSpeed = movement.isMounting
    ? MOUNT_SPEEDS[dir]
    : movement.useRun
      ? RUN_SPEEDS[dir]
      : WALK_SPEEDS[dir];

  return dir;
}

/**
 * Update sprite frame animation based on elapsed time.
 * Modifies frame state in-place.
 */
export function updateFrameAnimation(
  frame: FighterFrameState,
  deltaS: number,
  textureCount: number,
  fps: number
): void {
  if (textureCount <= 1) return;

  frame.frameTimer += deltaS;

  const frameDuration = 1 / fps;
  if (frame.frameTimer >= frameDuration) {
    frame.frameTimer -= frameDuration;
    frame.frameIndex = (frame.frameIndex + 1) % textureCount;
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
 * Determine if a path should use run or walk animation.
 */
export function shouldUseRun(pathLength: number): boolean {
  return pathLength > RUN_THRESHOLD;
}
