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
import type { FighterOverheadPanel } from "@/game/scene/player/graphics";
import type { PlayerMountLayers } from "@/game/scene/player/mount-layers";
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
  /**
   * Mirrors AS2 `instanceof dofus.datacenter.Character`. True for any
   * player avatar (local + other PCs); false for monsters, NPCs, pets,
   * and decorative siblings. Drives the run-vs-walk threshold in
   * `getRunLimit` (Characters run on 3+ steps, non-Characters on 7+
   * outside fights). When omitted, defaults to `isPlayer` — correct
   * for the local-hero path; explicit `false` is required for non-PC
   * actors going through the same renderer.
   */
  isCharacter?: boolean;
  linkedChildren?: Array<{
    gfxId: number;
    /** 0-7, a slot in the ring of cells around the parent. */
    childIndex: number;
    /** 1.29 colour triple; -1 leaves that zone at the artwork's palette. */
    color1?: number;
    color2?: number;
    color3?: number;
  }>;
  mount?: MountDisplay;
  /**
   * Optional pixel offset applied to the container after `getCellPosition`
   * places it on its cell. Used by `BattlefieldWorldActors` to spread the
   * decorative non-leader members of a monster group around the cell so
   * the player can see all the monsters that will become individual
   * fighters once combat starts. Canonical Dofus 1.29 only renders the
   * leader, but the user expects the group composition to be visible.
   */
  pixelOffset?: { x: number; y: number };
  /**
   * Decorative-only flag: when true the actor still renders + animates
   * but is excluded from picking and never paints a nameplate / HP bar.
   * Used by the monster-group sprite stack so click / hover routes to
   * the leader and the screen isn't littered with redundant labels.
   */
  decorative?: boolean;
  /**
   * Per-actor sprite scale as a multiplier — 1 is life size. Mirrors the
   * canonical `scaleX/scaleY` a `-4` GM entry carries and that
   * `CharactersManager.createNonPlayableCharacter` writes onto the sprite;
   * a handful of NPCs are deliberately drawn larger or smaller than their
   * artwork. Applied to the actor's container, not its sprite: `sprite
   * .scale.x` already carries the ±1 direction flip and is rewritten on
   * every direction change.
   */
  scale?: number;
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
  /**
   * Team-colored under-foot ring shown during fights (ally = blue,
   * enemy = red per Dofus 1.29's absolute TEAMS_COLOR mapping). Null
   * for world-actor players where it shouldn't render.
   */
  groundCircle: Sprite | null;
  /**
   * Canonical Dofus 1.29 HealthBarOverHead — rounded panel with the
   * fighter name and a red HP bar (with the LP value rendered on it).
   * Visibility is hover-gated in fight mode.
   *
   * Out-of-fight TextOverHead lives in React DOM (see
   * `apps/electrobun/src/hud/world/PlayerNameplate.tsx`) — anchored
   * by the store at the player's projected canvas position. No PIXI
   * text rendering means the metrics match Flash 1:1.
   */
  overhead: FighterOverheadPanel;
  /** Cached display name; pushed to the nameplate store on hover. */
  displayName: string;
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
  /**
   * Mirrors AS2 instanceof Character. Drives the run threshold —
   * Characters run on 3+ steps, NPCs/monsters on 7+ outside fights.
   */
  isCharacter: boolean;
  /**
   * Per-character speed multiplier (AS2 mc/Sprite.as:305). Default 1.0;
   * future haste/slow effects can mutate it without touching the base
   * WALK/RUN/MOUNT arrays.
   */
  speedModerator: number;
  moving: boolean;
  moveResolve?: () => void;
  spriteLoading: boolean;
  /** Queued animation request while spriteLoading is true. */
  pendingAnim: { baseAnim: string; direction: number } | null;
  /**
   * When set, the renderer flips the player back to this animation as
   * soon as the current one-shot animation reaches its last frame.
   * Mirrors AS2 `setAnimTimer(anim, false, …, defaultAnimation)` —
   * the cast pose plays once, then the sprite returns to idle without
   * the spell-visual layer needing to coordinate the revert.
   */
  revertTo: PlayerAnimationValue | null;
  /**
   * Spell-launch hook. Fires once at the canonical applyEnd frame
   * (mid-anim) to advance the per-sprite Sequencer past the blocking
   * setAnim action — that's where SpriteHandler.as:782 chains
   * `addAction(20, addEffect)` after `addAction(18, blocking=true,
   * setAnim)`. The MovieClip continues animating after this hook.
   */
  onAnimComplete: (() => void) | null;
  /**
   * Hit-resolution hook. Fires once at the actual last frame of a
   * one-shot animation, BEFORE the revertTo flip. Used for canonical
   * GA;100 (damage) ordering: the damage popup + recoil pose queue
   * AFTER the cast/melee animation's last frame on the same per-sprite
   * Sequencer, so the floating number lands at fist-contact (close
   * combat) or windup-end (ranged casts), never mid-animation.
   */
  onAnimLastFrame: (() => void) | null;
  /**
   * Per-cycle hook for a *looping* animation, fired at the same
   * applyEnd frame `onAnimComplete` uses — the frame the tool lands
   * its blow. It is how a harvest sounds once per swing rather than
   * once per action: the animation the server asked for is the clock,
   * so the axe is heard when it is seen to bite.
   *
   * Unlike the one-shot hooks it is not cleared when it fires; the
   * timer that ends the action clears it, and so does any explicit
   * `setAnimation` (walking away stops the sound).
   */
  onAnimCycle: (() => void) | null;
  /**
   * False while `onAnimCycle` waits for the animation to come back
   * round below its trigger frame, so one cycle rings exactly once.
   */
  animCycleArmed: boolean;
  /**
   * Snapshot of `currentAnimData` taken when the most recent
   * `setAnimation` call was made. The lifecycle gate fires hooks only
   * after `currentAnimData` has been swapped to a different reference
   * by sprite-controller's `apply()` — guaranteeing the animation we
   * asked for has actually been installed. Survives:
   *
   *   - Async loads (load returns later → apply swaps the ref).
   *   - Monster anim fallbacks (`anim0` requested → loader returns
   *     `anim1` via MONSTER_ANIM_FALLBACKS → apply still swaps the
   *     ref). Name-prefix gates miss this case and stall the hooks
   *     until the 1500 ms cap, which is exactly the "hit doesn't
   *     trigger at the right time" the user reports for monsters.
   *   - Direction fallbacks (R suffix missing → loader picks L → ref
   *     still swaps).
   *
   * The only edge case where the ref doesn't change is "same anim
   * requested twice without revert in between" — which never happens
   * in normal play because every cast / hit / death has revertTo:IDLE
   * and the IDLE pose is a different animation than the one-shot.
   */
  animDataAtRequest: ActivePlayer["currentAnimData"] | null;
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
