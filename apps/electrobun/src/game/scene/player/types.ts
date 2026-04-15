import type { DofusPathfinding } from "@dofus/grid";
import type { MountDisplay } from "@dofus/proto";
import type { Container, Graphics, Sprite } from "pixi.js";

import type {
  CharacterAnimation,
  CharacterSpriteLoader,
} from "@/game/assets/character-sprite";
import type { CellData } from "@/game/datacenter/cell";
import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerAnimationValue } from "@/game/scene/player/animation";
import type { PlayerMountLayers } from "@/game/scene/player/mount-layers";
import type { PlayerNameplate } from "@/game/scene/player/nameplate";
import type { Scene } from "@/game/scene/scene";

/** Public input describing a player placed in the world. */
export interface PlayerSpriteData {
  id: number;
  name: string;
  team: number;
  cellId: number;
  direction: number;
  look: string;
  hp: number;
  maxHp: number;
  isPlayer: boolean;
  linkedChildren?: Array<{ gfxId: number; childIndex: number }>;
  mount?: MountDisplay;
}

/**
 * Per-player state owned by PlayerRenderer. Composed of:
 *   - identity (id, gfxId, team, look, linked family)
 *   - PIXI display (container + placeholder/nameplate/hpBar)
 *   - animation state (current anim name + data, frame index/timer)
 *   - movement state (path, segment vectors, speed, moving flag)
 *   - mount state (mountLayers is null when not mounted)
 */
export interface ActivePlayer {
  id: number;
  container: Container;
  sprite: Sprite | null;
  placeholderGraphics: Graphics | null;
  nameplate: PlayerNameplate;
  hpBar: Graphics;
  cellId: number;
  direction: number;
  team: number;
  hp: number;
  maxHp: number;
  gfxId: number;
  animation: PlayerAnimationValue;
  currentAnimName: string;
  currentAnimData: CharacterAnimation | null;
  frameIndex: number;
  frameTimer: number;
  path: number[];
  pathIndex: number;
  moveDistance: number;
  moveCosRot: number;
  moveSinRot: number;
  movePixelSpeed: number;
  useRun: boolean;
  isMounting: boolean;
  moving: boolean;
  moveResolve?: () => void;
  spriteLoading: boolean;
  /** Queued animation request while spriteLoading is true. */
  pendingAnim: { baseAnim: string; direction: number } | null;
  look: string;
  linkedParentId?: number;
  linkedChildren: number[];
  childIndex?: number;
  mount?: MountDisplay;
  mountLayers: PlayerMountLayers | null;
}

export interface PlayerRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  cellDataMap?: Map<number, CellData>;
  pickingSystem?: PickingSystem | null;
  spriteLoader?: CharacterSpriteLoader;
  pathfinding?: DofusPathfinding | null;
  scene: Scene;
}

/** Parse gfxId from the look string (format: "gfx|color1|color2|color3"). */
export function parseGfxId(look: string): number {
  if (!look) {
    return 0;
  }

  const parts = look.split("|");
  return parseInt(parts[0], 10) || 0;
}
