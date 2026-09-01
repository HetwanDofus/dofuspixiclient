import type { DofusPathfinding } from "@dofus/grid";
import type { Sprite } from "pixi.js";
import { clampFightDirection } from "@dofus/grid";
import { ColorMatrixFilter, Container, Graphics, Ticker } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { MapScale } from "@/game/datacenter/map";
import type { PickingSystem } from "@/game/render/picking-system";
import type { Scene } from "@/game/scene/scene";
import {
  type CharacterSpriteLoader,
  getCharacterSpriteLoader,
} from "@/game/assets/character-sprite";
import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { playerZIndex } from "@/game/constants/z-index";
import { projectCellPosition } from "@/game/datacenter/map";
import { PlayerActor } from "@/game/scene/player/actor";
import {
  getAnimationBaseFromType,
  getCellPositionWithSlope,
  initFrameState,
  initMovementState,
  isOneShotAnimation,
  PlayerAnimation,
  type PlayerAnimationValue,
} from "@/game/scene/player/animation";
import {
  applyFighterCircleTeam,
  createFighterGroundCircle,
  drawPlayerPlaceholder,
  FighterOverheadPanel,
} from "@/game/scene/player/graphics";
import { PlayerMovement } from "@/game/scene/player/movement";
import { PlayerPerfMonitor } from "@/game/scene/player/perf";
import { PlayerSpriteController } from "@/game/scene/player/sprite-controller";
import {
  type ActivePlayer,
  type PlayerRendererConfig,
  type PlayerSpriteData,
  parseGfxId,
} from "@/game/scene/player/types";
import {
  bubbleLifetimeMs,
  clearChatBubbles,
  hideChatBubble,
  setChatBubble,
} from "@/hud/world/chat-bubble-store";
import {
  clearPlayerNameplates,
  hidePlayerNameplate,
  setPlayerNameplate,
} from "@/hud/world/player-nameplate-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerRenderer");

const GHOST_VIEW_ALPHA = 0.8;

/**
 * ColorMatrix mirroring the canonical Flash colour transform
 * `{ra:60, rb:102, ga:60, gb:102, ba:60, bb:102}` from
 * `ank.battlefield.mc.Sprite.select` (Sprite.as:93-105). Multiplies
 * each channel by 0.6 then adds 102/255 ≈ 0.4 — the warm yellowy
 * "highlighted sprite" wash the canonical client applies on
 * `selectSprite(true)`.
 *
 * In canonical 1.29 this filter fires on **roll-over**, NOT on the
 * active turn (active turn is conveyed by the timeline pointer +
 * StringCourse banner + cell highlight VFX, not a sprite tint).
 */
function buildHoverSelectFilter(): ColorMatrixFilter {
  const f = new ColorMatrixFilter();
  const offset = 102 / 255;
  // prettier-ignore
  f.matrix = [
    0.6,
    0,
    0,
    0,
    offset,
    0,
    0.6,
    0,
    0,
    offset,
    0,
    0,
    0.6,
    0,
    offset,
    0,
    0,
    0,
    1,
    0,
  ];
  return f;
}

/**
 * Canonical anchor offset above the sprite for the world-space
 * TextOverHead. Mirrors `dofus.Constants.DEFAULT_SPRITE_HEIGHT = 50`
 * — `addSpriteOverHeadItem` attaches the overhead clip at
 * `(0, -DEFAULT_SPRITE_HEIGHT)` in sprite-local space.
 */
const NAMEPLATE_OFFSET_Y = -50;

/**
 * Bubbles hang off the same overhead anchor as the nameplate — retail uses one
 * `BUBBLE_Y_OFFSET = 50` for both (ank/battlefield/Constants.as:37).
 */
const BUBBLE_OFFSET_Y = -50;

/**
 * Map-level coordinator that owns the player registry + the PIXI parent
 * container. Per-player concerns (sprite loading, animation, movement,
 * mount layers, HP, perf) live in focused collaborators that
 * receive an ActivePlayer reference to read/mutate.
 *
 * The world-space TextOverHead nameplate (out-of-fight name box) lives
 * in React DOM — `apps/electrobun/src/hud/world/PlayerNameplate.tsx`.
 * This class pushes show / hide / position-update events to the store;
 * the React component renders them.
 */
export class PlayerRenderer {
  private container: Container;
  private players: Map<number, ActivePlayer> = new Map();
  private playerActors: Map<number, PlayerActor> = new Map();
  private mapWidth: number;
  private groundLevel: number;
  /**
   * The `computeMapScale` transform the tile layers bake into every
   * sprite position. Identity in fight mode, which owns a container of
   * its own and carries the transform there via `setOffset`/`setScale`.
   * World actors share the object-layer-2 container with the tiles, so
   * theirs has to be applied per position instead.
   */
  private mapProjection: MapScale = { scale: 1, offsetX: 0, offsetY: 0 };
  private cellDataMap: Map<number, CellData>;
  private pickingSystem: PickingSystem | null;
  private spriteLoader: CharacterSpriteLoader;
  private ghostView = false;
  private pathfinding: DofusPathfinding | null;
  private scene: Scene;
  /**
   * When true, every existing + future player gets the team-colored
   * ground ring; toggled on enter/exit of fight mode by the
   * battlefield-scene. Roleplay has no team concept, so rings stay
   * hidden there.
   */
  private fightMode = false;
  /**
   * Fighter id whose turn is currently active — their ground ring
   * renders in the brighter "glow" variant. null while waiting for
   * the first TURN_START or outside of combat.
   */
  private activeTurnPlayerId: number | null = null;
  /**
   * Id allocator for linked child sprites (monster-group members, pets).
   *
   * Child ids used to be derived arithmetically from the parent's
   * (`parentId * 1000 + childIndex`), which collides: monster-group sprite
   * ids count down from -1 and are never reset, and the server's monster
   * *fighter* ids count down from -1_000_000, so the thousandth group of a
   * session produced children landing squarely in the fighter range —
   * `addPlayer` silently folds a duplicate id into the existing sprite. A
   * private counter below every id the server can mint removes the whole
   * class of problem.
   */
  private nextLinkedChildId = -1_000_000_000;
  private unsubPreTick: () => void;
  private unsubPostTick: () => void;
  /**
   * Player ids whose React nameplate is currently visible. Tracked
   * here so the post-tick hook can refresh anchor positions for
   * exactly the visible set (no per-frame work for hidden ones).
   */
  private readonly visibleNameplateIds = new Set<number>();
  /**
   * Player ids currently showing a speech bubble, with the moment each one
   * expires. Same reason as `visibleNameplateIds`: the post-tick hook only
   * touches the sprites that actually have something on screen.
   */
  private readonly visibleBubbles = new Map<
    number,
    { text: string; expiresAt: number }
  >();

  private readonly sprites: PlayerSpriteController;
  private readonly movement: PlayerMovement;
  private readonly perf = new PlayerPerfMonitor();

  constructor(parentContainer: Container, config: PlayerRendererConfig) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.pickingSystem = config.pickingSystem ?? null;
    this.spriteLoader = config.spriteLoader ?? getCharacterSpriteLoader();
    this.pathfinding = config.pathfinding ?? null;
    this.scene = config.scene;
    this.container = parentContainer;

    this.sprites = new PlayerSpriteController(
      this.spriteLoader,
      (id) => this.players.has(id),
      () => this.players.size
    );

    this.movement = new PlayerMovement({
      mapWidth: () => this.mapWidth,
      groundLevel: () => this.groundLevel,
      mapProjection: () => this.mapProjection,
      cellDataMap: () => this.cellDataMap,
      pathfinding: () => this.pathfinding,
      pickingSystem: () => this.pickingSystem,
      players: () => this.players,
      spriteController: () => this.sprites,
      calculateZIndex: (cellId) => this.calculateZIndex(cellId),
      isFight: () => this.fightMode,
    });

    this.unsubPreTick = this.scene.onPreTick(() => this.onPreTick());
    this.unsubPostTick = this.scene.onPostTick(() => this.onPostTick());
  }

  // ── Player lifecycle ───────────────────────────────────────────────

  addPlayer(data: PlayerSpriteData): Promise<void> {
    if (this.players.has(data.id)) {
      this.updatePlayer(data.id, data);
      return Promise.resolve();
    }

    const player = this.buildActivePlayer(data);
    this.players.set(data.id, player);
    this.registerPlayerActor(data.id, player);

    if (data.linkedChildren && data.linkedChildren.length > 0) {
      return this.loadWithLinkedChildren(data, player);
    }

    return this.sprites.boot(player, data.direction);
  }

  removePlayer(id: number): void {
    if (!this.players.has(id)) {
      return;
    }

    log.debug(`removePlayer ${id}`);

    const actor = this.playerActors.get(id);

    if (actor) {
      this.scene.remove(actor.id);
    } else {
      this.cleanupPlayer(id);
    }
  }

  updatePlayer(id: number, data: Partial<PlayerSpriteData>): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    if (
      data.cellId !== undefined &&
      data.cellId !== player.cellId &&
      !player.moving
    ) {
      this.teleportPlayer(id, data.cellId);
    }

    if (data.direction !== undefined && data.direction !== player.direction) {
      const finalDir = this.fightMode
        ? clampFightDirection(data.direction)
        : data.direction;
      player.direction = finalDir;

      if (player.sprite) {
        const baseAnim = getAnimationBaseFromType(player.animation);
        this.sprites.switch(player, baseAnim, finalDir);
      } else if (player.placeholderGraphics) {
        drawPlayerPlaceholder(
          player.placeholderGraphics,
          player.team,
          player.direction
        );
      }
    }

    if (data.hp !== undefined || data.maxHp !== undefined) {
      player.hp = data.hp ?? player.hp;
      player.maxHp = data.maxHp ?? player.maxHp;

      // Always update the overhead panel — visibility is hover-gated,
      // so the panel just stays in sync without triggering re-render
      // on hidden fighters.
      player.overhead.setHp(player.hp, player.maxHp);
    }

    // A look change is an equip/unequip: the sprite has to be rebuilt
    // from the new accessory set (see `PlayerSpriteController.reload`).
    // Compared as a whole string — it carries the gfx, the three colour
    // zones and the five accessory slots, and any of them moving is a
    // different sprite.
    if (data.look !== undefined && data.look !== player.look) {
      player.look = data.look;
      player.gfxId = parseGfxId(data.look);
      this.sprites.reload(player);
    }

    if (data.name !== undefined) {
      player.displayName = data.name;
      player.overhead.setName(data.name);
      // If the nameplate is currently shown, refresh its text in the
      // store so a name update mid-hover lands without waiting for
      // the next show/hide cycle.
      if (this.visibleNameplateIds.has(id)) {
        const anchor = this.computeNameplateAnchor(player);
        setPlayerNameplate({
          id,
          name: data.name,
          anchorX: anchor.x,
          anchorY: anchor.y,
        });
      }
    }
  }

  // ── Movement ────────────────────────────────────────────────────────

  movePlayer(id: number, path: number[]): Promise<void> {
    const player = this.players.get(id);

    if (!player) {
      return Promise.resolve();
    }

    return this.movement.start(player, path);
  }

  /**
   * Stop a walking player on the cell it is entering and drop the rest
   * of its path. Returns that cell, or `null` if it was not walking.
   *
   * The move promise `movePlayer` returned still resolves — one cell
   * early — so every caller that chains on arrival keeps working.
   */
  interruptPlayer(id: number): number | null {
    const player = this.players.get(id);

    return player ? this.movement.interrupt(player) : null;
  }

  teleportPlayer(id: number, cellId: number): void {
    const player = this.players.get(id);

    if (player) {
      this.movement.teleport(player, cellId);
    }
  }

  setAnimation(
    id: number,
    animation: PlayerAnimationValue,
    options?: {
      revertTo?: PlayerAnimationValue;
      /**
       * Fires at the canonical `applyEnd` frame (mid-anim, the spell-LAUNCH
       * hook in `GlobalSpriteHandler.applyEnd → sequencer.onActionEnd()`).
       * Used to start the spell visual once the windup peaks — mirrors
       * `SpriteHandler.as:782 addAction(18, blocking=true, setAnim)`
       * before `addAction(20, addEffect)`.
       */
      onComplete?: () => void;
      /**
       * Fires when the one-shot animation reaches its actual last frame.
       * This is the HIT moment — for close-combat punch the fist
       * contacts; for ranged casts the windup is fully resolved and any
       * spell-visual would be in flight. Damage popups / recoil pose
       * canonical fire at this point (GA;100 actions queue AFTER the
       * cast/visual sequence on the same per-sprite Sequencer).
       */
      onLastFrame?: () => void;
    }
  ): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    player.animation = animation;
    // Any new explicit setAnimation call cancels a pending revert
    // — e.g. server-driven HIT mid-cast must not be overridden by the
    // queued cast→idle revert.
    player.revertTo = null;
    player.onAnimComplete = null;
    player.onAnimLastFrame = null;
    player.animDataAtRequest = null;
    if (options?.revertTo && isOneShotAnimation(animation)) {
      player.revertTo = options.revertTo;
      // Reset the frame counter so the one-shot anim plays from frame 0
      // and our completion check (last-frame) fires reliably.
      player.frameIndex = 0;
      player.frameTimer = 0;
    }
    if (options?.onComplete && isOneShotAnimation(animation)) {
      player.onAnimComplete = options.onComplete;
    }
    if (options?.onLastFrame && isOneShotAnimation(animation)) {
      player.onAnimLastFrame = options.onLastFrame;
    }
    const baseAnim = getAnimationBaseFromType(animation);
    // Snapshot the current animation data BEFORE delegating to
    // sprite-controller. The lifecycle gate fires hooks only after the
    // controller's `apply()` has swapped `currentAnimData` to a new
    // reference, which guarantees the requested animation has actually
    // been installed (regardless of any fallback the loader picked
    // through MONSTER_ANIM_FALLBACKS or SUFFIX_FALLBACKS). For the
    // sync-cached case `apply()` runs inline below, so the snapshot is
    // immediately stale and the gate opens on the next tick.
    if (
      isOneShotAnimation(animation) &&
      (options?.revertTo || options?.onComplete || options?.onLastFrame)
    ) {
      player.animDataAtRequest = player.currentAnimData;
    }
    this.sprites.switch(player, baseAnim, player.direction);
  }

  /**
   * Called once per tick after the sprite frame has advanced.
   *
   * Two independent signals fire on a one-shot animation:
   *
   *   1. `onAnimComplete` (the spell-launch hook) fires at the canonical
   *      `applyEnd` frame from the player class metadata.json. Mirrors
   *      `GlobalSpriteHandler.applyEnd(mc)` → `sequencer.onActionEnd()`
   *      which only advances the sequencer (so the next blocking action,
   *      e.g. addEffect at SpriteHandler.as:791, runs). It does NOT
   *      stop the animation — the MovieClip keeps playing on its own.
   *
   *   2. `revertTo` (the idle-restore) fires when the animation actually
   *      reaches its last frame. Canonical AS doesn't auto-restore at
   *      all (the inner timeline has a `stop()` on its last frame and
   *      the sprite holds that pose until another `setAnim` lands), but
   *      for our UX we flip back to IDLE so the sprite doesn't appear
   *      frozen between actions. If applyEnd metadata is missing for
   *      this anim, fall back to firing both signals at the last frame.
   */
  private checkAnimRevert(player: ActivePlayer): void {
    if (
      (!player.revertTo && !player.onAnimComplete && !player.onAnimLastFrame) ||
      !player.currentAnimData
    ) {
      return;
    }
    if (!isOneShotAnimation(player.animation)) {
      // Should not happen (revertTo only set when one-shot), but guard
      // in case animation changed via switch() without going through
      // setAnimation.
      player.revertTo = null;
      player.onAnimComplete = null;
      player.onAnimLastFrame = null;
      player.animDataAtRequest = null;
      return;
    }
    // Wait for sprite-controller's apply() to swap currentAnimData to
    // the new animation. Until then, `frameIndex >= lastFrame` would
    // be true on tick zero against the OLD animation's small frame
    // count (often a 1-frame idle), firing all the lifecycle hooks
    // before the requested anim has even started — that's the bug
    // showing up as "hit triggers at the wrong time", and it gets
    // worse on monsters because their loader falls through
    // MONSTER_ANIM_FALLBACKS (anim0 → anim1) and SUFFIX_FALLBACKS
    // (R → S → L) before settling on what's actually shipped, so the
    // load takes longer and the bogus early fire is more visible.
    // Reference equality on `currentAnimData` is fallback-agnostic:
    // any apply() swaps the reference, regardless of what name the
    // loader landed on.
    if (
      player.animDataAtRequest !== null &&
      player.animDataAtRequest === player.currentAnimData
    ) {
      return;
    }
    const total =
      player.currentAnimData.frameCount ??
      player.currentAnimData.textures.length;
    const lastFrame = Math.max(0, total - 1);
    const applyEnd = this.spriteLoader.getApplyEndFrame(
      player.gfxId,
      player.currentAnimName
    );
    // applyEnd >= lastFrame: collapse to one signal at the last frame
    // (matches the missing-metadata fallback below).
    const launchFrame =
      applyEnd !== null ? Math.min(applyEnd, lastFrame) : lastFrame;

    // Fire the spell-launch hook at applyEnd — animation continues.
    if (player.onAnimComplete && player.frameIndex >= launchFrame) {
      const onComplete = player.onAnimComplete;
      player.onAnimComplete = null;
      onComplete();
    }
    // Fire the hit hook at the actual last frame — this is the moment
    // the canonical Sequencer treats the cast/melee sequence as
    // "completed" (the inner timeline's stop() lands on the last
    // frame), so any subsequent action queued behind the spell can
    // run. Damage popups + recoil pose hang off this signal.
    if (player.onAnimLastFrame && player.frameIndex >= lastFrame) {
      const onLastFrame = player.onAnimLastFrame;
      player.onAnimLastFrame = null;
      onLastFrame();
    }
    // Revert only when the animation has actually finished playing.
    if (player.revertTo && player.frameIndex >= lastFrame) {
      const next = player.revertTo;
      player.revertTo = null;
      player.animDataAtRequest = null;
      this.setAnimation(player.id, next);
    }
  }

  setDirection(id: number, direction: number): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    // In combat the grid only supports four facings; a stale
    // roleplay direction (E/S/W/N) would animate with the "S" or "F"
    // suffix fallbacks which don't match what the original client
    // ever shows during a fight.
    const finalDir = this.fightMode
      ? clampFightDirection(direction)
      : direction;

    player.direction = finalDir;
    const baseAnim = getAnimationBaseFromType(player.animation);
    this.sprites.switch(player, baseAnim, finalDir);
  }

  // ── Accessors ───────────────────────────────────────────────────────

  getPlayerCell(id: number): number | undefined {
    return this.players.get(id)?.cellId;
  }

  getPlayerIds(): number[] {
    return Array.from(this.players.keys());
  }

  hasPlayer(id: number): boolean {
    return this.players.has(id);
  }

  getContainer(): Container {
    return this.container;
  }

  getPlayerName(id: number): string | null {
    return this.players.get(id)?.displayName ?? null;
  }

  /** True while the player renderer is in fight mode. Read by picking. */
  isFightMode(): boolean {
    return this.fightMode;
  }

  /**
   * Look string the player was registered with (`gfx|c1|c2|c3|acc1,..`).
   * The StringCourse turn-change banner needs this to re-rasterise the
   * fighter's portrait via Vello with the correct color zones +
   * accessory composition — same input format CharacterSpriteLoader
   * accepts.
   */
  getPlayerLook(id: number): string | null {
    return this.players.get(id)?.look ?? null;
  }

  getPlayerPickingData(
    id: number
  ): { sprite: Sprite; container: Container } | null {
    const f = this.players.get(id);

    if (!f?.sprite) {
      return null;
    }

    return { sprite: f.sprite, container: f.container };
  }

  get lastUpdateMs(): number {
    return this.perf.lastUpdateMs;
  }

  // ── Nameplate ───────────────────────────────────────────────────────

  showName(id: number): void {
    const f = this.players.get(id);
    if (!f) {
      return;
    }
    // Canonical TextOverHead is suppressed during fights — the
    // HealthBarOverHead replaces it (`DofusBattlefield.as:889/910`
    // sets `_loc10_ = ""` so the `if(_loc10_ != "")` branch at line
    // 1058 skips). The picking layer also gates this, but enforcing
    // it here too means a stray showName() call from anywhere can't
    // accidentally double-overlay during combat.
    if (this.fightMode) {
      return;
    }
    this.visibleNameplateIds.add(id);
    const anchor = this.computeNameplateAnchor(f);
    setPlayerNameplate({
      id,
      name: f.displayName,
      anchorX: anchor.x,
      anchorY: anchor.y,
    });
  }

  hideName(id: number): void {
    if (!this.visibleNameplateIds.delete(id)) {
      return;
    }
    hidePlayerNameplate(id);
  }

  /**
   * Where a HUD overlay for this sprite should sit, in the same
   * canvas-relative pixels the nameplate uses.
   *
   * Exposed for the harvest gauge, which needs the same anchor and has no
   * business reaching into `players` to compute it.
   */
  getSpriteAnchor(id: number): { x: number; y: number } | null {
    const player = this.players.get(id);

    return player ? this.computeNameplateAnchor(player) : null;
  }

  private computeNameplateAnchor(player: ActivePlayer): {
    x: number;
    y: number;
  } {
    // `getGlobalPosition` walks every parent transform (zoom + pan
    // included), returning the canvas-stage position in CSS pixels —
    // exactly the coord space `HudOverlay`'s wrapper uses.
    const global = player.container.toGlobal({ x: 0, y: NAMEPLATE_OFFSET_Y });
    return { x: global.x, y: global.y };
  }

  /**
   * Refresh anchor positions for every visible nameplate. Called
   * once per post-tick so the React panels follow movement and
   * camera pans without round-tripping through rAF.
   */
  private flushVisibleNameplates(): void {
    if (this.visibleNameplateIds.size === 0) {
      return;
    }
    for (const id of this.visibleNameplateIds) {
      const player = this.players.get(id);
      if (!player) {
        // Player got cleaned up while still in the visible set —
        // tidy up so we don't keep firing setState for a ghost.
        this.visibleNameplateIds.delete(id);
        hidePlayerNameplate(id);
        continue;
      }
      const anchor = this.computeNameplateAnchor(player);
      setPlayerNameplate({
        id,
        name: player.displayName,
        anchorX: anchor.x,
        anchorY: anchor.y,
      });
    }
  }

  // ── Speech bubble ───────────────────────────────────────────────────

  /**
   * Put a line over a sprite's head. Retail keeps one bubble per sprite, the
   * new one replacing the old (`TextHandler.addBubble` calls `removeBubble`
   * first), and suppresses bubbles during fights — in combat the overhead slot
   * belongs to the health bar.
   */
  showBubble(id: number, text: string): void {
    const player = this.players.get(id);

    if (!player || this.fightMode || text.length === 0) {
      return;
    }

    const anchor = this.computeBubbleAnchor(player);
    const expiresAt = Date.now() + bubbleLifetimeMs(text);

    this.visibleBubbles.set(id, { text, expiresAt });
    setChatBubble({
      id,
      text,
      anchorX: anchor.x,
      anchorY: anchor.y,
      expiresAt,
    });
  }

  hideBubble(id: number): void {
    if (!this.visibleBubbles.delete(id)) {
      return;
    }
    hideChatBubble(id);
  }

  private computeBubbleAnchor(player: ActivePlayer): { x: number; y: number } {
    const global = player.container.toGlobal({ x: 0, y: BUBBLE_OFFSET_Y });
    return { x: global.x, y: global.y };
  }

  /**
   * Follow moving speakers and drop expired bubbles. Runs in the same post-tick
   * pass as the nameplates, so a bubble tracks its sprite through walks, camera
   * pans and zoom changes without its own rAF loop.
   */
  private flushVisibleBubbles(): void {
    if (this.visibleBubbles.size === 0) {
      return;
    }
    const now = Date.now();
    for (const [id, bubble] of this.visibleBubbles) {
      const player = this.players.get(id);
      // Expired, or the speaker left the map while still talking.
      if (!player || bubble.expiresAt <= now) {
        this.visibleBubbles.delete(id);
        hideChatBubble(id);
        continue;
      }
      const anchor = this.computeBubbleAnchor(player);
      setChatBubble({
        id,
        text: bubble.text,
        anchorX: anchor.x,
        anchorY: anchor.y,
        expiresAt: bubble.expiresAt,
      });
    }
  }

  // ── Camera / map sync ───────────────────────────────────────────────

  setGhostView(enabled: boolean): void {
    this.ghostView = enabled;

    for (const player of this.players.values()) {
      player.container.zIndex = this.calculateZIndex(player.cellId);
      player.container.alpha = enabled ? GHOST_VIEW_ALPHA : 1;
    }
  }

  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  /**
   * Set the map-fitting transform applied to every actor position.
   * Use this — not `setOffset`/`setScale` — whenever the renderer draws
   * into a container it shares with the terrain.
   */
  setMapProjection(projection: MapScale): void {
    this.mapProjection = projection;
  }

  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  onResize(event: { zoom: number }): void {
    // mapContainer is already scaled to the zoom level — don't scale this one.
    const res = Math.max(2, Math.ceil(event.zoom));

    for (const player of this.players.values()) {
      player.overhead.setResolution(res);
    }

    this.spriteLoader.setZoom(event.zoom);
    this.sprites.reloadAll(this.players.values());
    this.pickingSystem?.markDirty();
    // Camera-zoom change moves canvas-relative anchor coords for every
    // visible nameplate. Push the new positions immediately so the
    // panels don't lag behind the canvas until the next tick.
    this.flushVisibleNameplates();
    this.flushVisibleBubbles();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  clear(): void {
    log.debug(`clear() — removing ${this.players.size} players`);

    for (const actor of Array.from(this.playerActors.values())) {
      this.scene.remove(actor.id);
    }
    this.visibleNameplateIds.clear();
    clearPlayerNameplates();
    this.visibleBubbles.clear();
    clearChatBubbles();
  }

  destroy(): void {
    this.unsubPreTick();
    this.unsubPostTick();
    this.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private buildActivePlayer(data: PlayerSpriteData): ActivePlayer {
    const display = this.createPlayerContainer(data);
    const frame = initFrameState();
    const move = initMovementState();

    const direction = this.fightMode
      ? clampFightDirection(data.direction)
      : data.direction;

    return {
      id: data.id,
      container: display.container,
      sprite: null,
      placeholderGraphics: display.placeholderGraphics,
      groundCircle: display.groundCircle,
      overhead: display.overhead,
      displayName: data.name,
      cellId: data.cellId,
      direction,
      team: data.team,
      hp: data.hp,
      maxHp: data.maxHp,
      gfxId: parseGfxId(data.look),
      animation: PlayerAnimation.IDLE,
      currentAnimName: "",
      currentAnimData: null,
      frameIndex: frame.frameIndex,
      frameTimer: frame.frameTimer,
      path: move.path,
      pathIndex: move.pathIndex,
      moveDistance: move.moveDistance,
      moveCosRot: move.moveCosRot,
      moveSinRot: move.moveSinRot,
      movePixelSpeed: move.movePixelSpeed,
      useRun: move.useRun,
      isMounting: !!data.mount,
      isCharacter: data.isCharacter ?? data.isPlayer,
      speedModerator: move.speedModerator,
      moving: move.moving,
      spriteLoading: false,
      pendingAnim: null,
      revertTo: null,
      onAnimComplete: null,
      onAnimLastFrame: null,
      animDataAtRequest: null,
      look: data.look,
      linkedChildren: [],
      mount: data.mount,
      mountLayers: null,
    };
  }

  /** Build the PIXI container + its decorations; does not load sprite textures. */
  private createPlayerContainer(data: PlayerSpriteData): {
    container: Container;
    placeholderGraphics: Graphics;
    groundCircle: Sprite | null;
    overhead: FighterOverheadPanel;
  } {
    const container = new Container();
    container.label = `player-${data.id}`;
    container.sortableChildren = true;
    // Hide container until sprite loads to avoid placeholder flash.
    container.visible = false;

    // Team-colored under-foot ring, drawn BELOW the sprite via a
    // negative zIndex on the sortable container. Always created so a
    // mid-game fight-mode toggle doesn't need to mutate the display
    // list; visibility is gated on `fightMode` so roleplay stays clean.
    //
    // Backed by the canonical circle.swf vector (encoded inline as an
    // SVG data URL in `graphics.ts`); pixi raster-tints it per team —
    // the previous Graphics.ellipse + 2px stroke aliased noticeably at
    // common zoom levels.
    const groundCircle = createFighterGroundCircle(data.team);
    groundCircle.zIndex = -10;
    groundCircle.visible = this.fightMode;
    container.addChild(groundCircle);

    const placeholderGraphics = new Graphics();
    drawPlayerPlaceholder(placeholderGraphics, data.team, data.direction);
    container.addChild(placeholderGraphics);

    // Canonical Dofus 1.29 HealthBarOverHead — rounded black panel
    // with name + red HP bar (with LP value text on it). Hidden by
    // default; the picking layer toggles visibility on hover during
    // fights (mirrors DofusBattlefield.onSpriteRollOver/Out).
    //
    // The roleplay TextOverHead (compact name) lives in React DOM —
    // see `apps/electrobun/src/hud/world/PlayerNameplate.tsx`. We
    // don't add a PIXI nameplate child anymore.
    const overhead = new FighterOverheadPanel(data.name);
    overhead.container.zIndex = 10;
    overhead.setHp(data.hp, data.maxHp);
    overhead.setVisible(false);
    container.addChild(overhead.container);

    const pos = projectCellPosition(
      getCellPositionWithSlope(
        data.cellId,
        this.mapWidth,
        this.groundLevel,
        this.cellDataMap
      ),
      this.mapProjection
    );
    // `pixelOffset` lets monster-group siblings spread around the
    // leader's cell so all members are visible as individual sprites.
    // The z-index is bumped by the offset's y so a sibling drawn
    // slightly back stays behind the leader instead of clipping in
    // front when a slope places them on the same scanline.
    const ox = data.pixelOffset?.x ?? 0;
    const oy = data.pixelOffset?.y ?? 0;
    container.x = pos.x + ox;
    container.y = pos.y + oy;
    container.zIndex = this.calculateZIndex(data.cellId) + Math.round(oy);

    // Per-actor scale (NPCs drawn larger or smaller than their artwork).
    // On the container, never on `player.sprite`: the sprite's `scale.x`
    // is the ±1 direction flip and gets rewritten on every turn
    // (`sprite-controller.updateFlip`), which would wipe this out.
    if (data.scale !== undefined && data.scale > 0 && data.scale !== 1) {
      container.scale.set(data.scale);
    }

    this.container.addChild(container);

    return {
      container,
      placeholderGraphics,
      groundCircle,
      overhead,
    };
  }

  /**
   * Toggle fight-mode decorations (team-colored ground rings) on every
   * existing player and seed the flag for future ones. Called by the
   * battlefield-scene in response to fightActor transitions. Also
   * re-clamps every current direction: combat only allows the four
   * isometric-cardinal directions (1=SE, 3=SW, 5=NW, 7=NE), so any
   * lingering roleplay direction (E/S/W/N) is snapped to the nearest
   * valid one.
   */
  setFightMode(enabled: boolean): void {
    this.fightMode = enabled;
    if (enabled) {
      // Canonical onSpriteRollOver in fights uses HealthBarOverHead
      // (the panel) and skips the TextOverHead branch (`_loc10_=""`,
      // `if(_loc10_ != "")` at DofusBattlefield.as:1058). Drop any
      // roleplay-side nameplate that survived the transition so we
      // don't double-overlay above the fighter.
      this.visibleNameplateIds.clear();
      clearPlayerNameplates();
    }
    for (const player of this.players.values()) {
      if (player.groundCircle) {
        player.groundCircle.visible = enabled;
      }
      // Overhead panel is hover-only (canonical Dofus 1.29: the
      // HealthBarOverHead appears on `onSpriteRollOver` and is
      // removed on `onSpriteRollOut`). When fight mode ends, force-
      // hide so a stale panel doesn't linger into roleplay.
      if (!enabled) {
        player.overhead.setVisible(false);
      } else {
        // Pre-render at current values so the panel is correct the
        // moment the hover hook flips it on.
        player.overhead.setHp(player.hp, player.maxHp);
        const clamped = clampFightDirection(player.direction);
        if (clamped !== player.direction) {
          this.setDirection(player.id, clamped);
        }
      }
    }
  }

  /**
   * Show / hide the overhead panel above a single fighter. Wired to
   * the picking layer's hover callback so the panel follows the cursor.
   */
  setHpBarVisible(id: number, visible: boolean): void {
    const player = this.players.get(id);
    if (!player) return;
    if (visible) {
      player.overhead.setHp(player.hp, player.maxHp);
    }
    player.overhead.setVisible(visible && this.fightMode);
  }

  /**
   * Update a player's team (used when a fight begins and the server
   * authoritatively tells us which side each sprite belongs to). The
   * ring is re-drawn immediately; callers don't need to toggle
   * fight-mode off/on.
   */
  updatePlayerTeam(id: number, team: number): void {
    const player = this.players.get(id);
    if (!player || player.team === team) {
      return;
    }
    player.team = team;
    if (player.groundCircle) {
      applyFighterCircleTeam(player.groundCircle, team);
    }
  }

  /**
   * Mark one fighter as the current turn actor — applies the same
   * color transform `{ra:60, rb:102, ga:60, gb:102, ba:60, bb:102}`
   * the original client uses to brighten a selected sprite
   * (Sprite.as:93-105). Pass `null` to clear.
   *
   * Intentionally does NOT alter the ground circle; the 1.29 client
   * paints every fighter's ring identically (GameIn.as:1298) and has
   * no battlefield-level "active turn" indicator — only the sprite
   * brightness.
   */
  /**
   * Track which fighter currently has the turn baton. Canonical 1.29
   * does NOT tint the active fighter — that's a roll-over-only effect
   * (see `setHoverHighlight`). Active turn is communicated through
   * the timeline pointer + StringCourse banner + on-cell highlight
   * VFX. Kept as a hook so other systems (timeline tint, banner
   * chrono) can react to the change without re-deriving it.
   */
  setActiveTurnPlayer(id: number | null): void {
    if (this.activeTurnPlayerId === id) {
      return;
    }
    this.activeTurnPlayerId = id;
  }

  /**
   * Apply the canonical Sprite.select colour transform on hover, and
   * remove it on un-hover. Mirrors `Sprite.select(bool)` in
   * `ank/battlefield/mc/Sprite.as`. Wired from BattlefieldPicking's
   * onHover callback so every fighter (player or monster) gets the
   * same yellowy wash that 1.29 uses to communicate "this sprite is
   * selected".
   */
  setHoverHighlight(id: number, hovered: boolean): void {
    const player = this.players.get(id);
    if (!player?.sprite) {
      return;
    }
    player.sprite.filters = hovered ? [buildHoverSelectFilter()] : [];
  }

  private registerPlayerActor(
    playerId: number,
    player: ActivePlayer
  ): PlayerActor {
    const actor = new PlayerActor(
      playerId,
      player,
      (dt) => {
        const f = this.players.get(playerId);

        if (f) {
          this.sprites.tickFrame(f, dt / 1000);
          this.checkAnimRevert(f);
          this.movement.advance(f, dt);
        }
      },
      () => this.cleanupPlayer(playerId)
    );

    this.playerActors.set(playerId, actor);
    this.scene.add(actor);

    return actor;
  }

  /**
   * Ids of the linked child sprites currently attached to `parentId`.
   *
   * The ids are allocated internally, so callers that need to reach the
   * children — the picking layer registering every member of a monster
   * group as one hoverable unit — have to ask rather than recompute.
   */
  getLinkedChildIds(parentId: number): number[] {
    return [...(this.players.get(parentId)?.linkedChildren ?? [])];
  }

  /** Load parent + each linked child, then wait on all of them. */
  private async loadWithLinkedChildren(
    data: PlayerSpriteData,
    player: ActivePlayer
  ): Promise<void> {
    const children = data.linkedChildren ?? [];
    const childPromises: Promise<void>[] = [];

    for (const child of children) {
      const childId = this.nextLinkedChildId--;
      const childCellId = this.movement.aroundCell(
        data.cellId,
        data.direction,
        child.childIndex
      );
      // Children carry their own colours: a monster group's members are
      // often the same artwork under different palettes (the six pious are
      // one drawing), so dropping the colour triple made every member look
      // like the leader.
      const childLook =
        child.color1 === undefined
          ? `${child.gfxId}`
          : `${child.gfxId}|${child.color1}|${child.color2 ?? -1}|${child.color3 ?? -1}`;

      childPromises.push(
        this.addPlayer({
          id: childId,
          name: "",
          team: data.team,
          cellId: childCellId,
          direction: data.direction,
          look: childLook,
          hp: 100,
          maxHp: 100,
          isPlayer: false,
          isCharacter: false,
          // No nameplate, no HP bar: hover and click belong to the parent.
          decorative: true,
          ...(data.scale !== undefined ? { scale: data.scale } : {}),
        })
      );

      const childFighter = this.players.get(childId);

      if (childFighter) {
        childFighter.linkedParentId = data.id;
        childFighter.childIndex = child.childIndex;
        player.linkedChildren.push(childId);
      }
    }

    const basePromise =
      player.gfxId > 0
        ? this.sprites.loadForParent(player, "static", data.direction)
        : Promise.resolve();

    await Promise.all([basePromise, ...childPromises]);
  }

  private cleanupPlayer(id: number): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    for (const childId of player.linkedChildren) {
      this.removePlayer(childId);
    }

    if (this.visibleNameplateIds.delete(id)) {
      hidePlayerNameplate(id);
    }
    this.container.removeChild(player.container);
    player.container.destroy({ children: true });
    this.players.delete(id);
    this.playerActors.delete(id);
  }

  private calculateZIndex(cellId: number): number {
    return playerZIndex(cellId, this.ghostView);
  }

  private onPreTick(): void {
    this.perf.beginFrame();
    this.spriteLoader.getAtlas()?.tick();
  }

  private onPostTick(): void {
    this.perf.endAnim();

    const flushT0 = performance.now();
    this.spriteLoader.getAtlas()?.flush();
    this.perf.recordFlush(flushT0);

    // Push fresh canvas-relative anchors to the React nameplate
    // store so the panels follow movement + camera pans without a
    // dedicated DOM-side rAF loop. No-op when nothing is visible.
    this.flushVisibleNameplates();
    this.flushVisibleBubbles();

    this.perf.endFrame(
      Ticker.shared.deltaMS,
      this.players.size,
      this.spriteLoader.getAtlas()
    );
  }
}

export type {
  PlayerRendererConfig,
  PlayerSpriteData,
} from "@/game/scene/player/types";
export { PlayerAnimation };
export type { PlayerAnimationValue };
