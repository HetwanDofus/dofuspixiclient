import type { DofusPathfinding } from "@dofus/grid";
import type { Sprite } from "pixi.js";
import { clampFightDirection } from "@dofus/grid";
import { Container, Graphics, Ticker } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { CrowdPlayerSnapshot } from "@/game/render/player-strip-renderer-v2";
import { CrowdRenderer } from "@/game/render/crowd-renderer";
import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerStripRenderer } from "@/game/render/player-strip-renderer";
import type { Scene } from "@/game/scene/scene";
import { parseLook } from "@/game/assets/look-parser";
import {
  type CharacterSpriteLoader,
  getCharacterSpriteLoader,
  isDirectionFlipped,
} from "@/game/assets/character-sprite";
import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/game/constants/battlefield";
import { playerZIndex } from "@/game/constants/z-index";
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
  clearPlayerNameplates,
  hidePlayerNameplate,
  setPlayerNameplate,
} from "@/hud/world/player-nameplate-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerRenderer");

const GHOST_VIEW_ALPHA = 0.6;

/**
 * Canonical anchor offset above the sprite for the world-space
 * TextOverHead. Mirrors `dofus.Constants.DEFAULT_SPRITE_HEIGHT = 50`
 * — `addSpriteOverHeadItem` attaches the overhead clip at
 * `(0, -DEFAULT_SPRITE_HEIGHT)` in sprite-local space.
 */
const NAMEPLATE_OFFSET_Y = -50;

/**
 * Map-level coordinator that owns the player registry + the PIXI parent
 * container. Per-player concerns (sprite loading, animation, movement,
 * mount layers, HP, perf) live in focused collaborators that
 * receive an ActivePlayer reference to read/mutate.
 *
 * Under the unified World layer, char rendering happens in
 * `WorldLayer` — this renderer maintains per-player animation state
 * + Pixi decorations (ground ring + overhead HP panel) and walks the
 * registry once per post-tick to upsert each player's
 * `CharWorldPlacement` into the layer.
 */
export class PlayerRenderer {
  private container: Container;
  private players: Map<number, ActivePlayer> = new Map();
  private playerActors: Map<number, PlayerActor> = new Map();
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;
  private pickingSystem: PickingSystem | null;
  private spriteLoader: CharacterSpriteLoader;
  private ghostView = false;
  private pathfinding: DofusPathfinding | null;
  private scene: Scene;
  private stripRenderer: PlayerStripRenderer;
  /**
   * Player ids whose char placement should render with the canonical
   * roll-over color tint (Sprite.as:93-105 — replaced by a Vello
   * per-fragment color transform in v2; for v1 this is a no-op
   * tracked here so a future M3.5 follow-up can wire it without
   * touching the call sites).
   */
  private readonly hoveredIds = new Set<number>();
  private fightMode = false;
  private activeTurnPlayerId: number | null = null;
  private unsubPreTick: () => void;
  private unsubPostTick: () => void;
  /**
   * Player ids whose React nameplate is currently visible. Tracked
   * here so the post-tick hook can refresh anchor positions for
   * exactly the visible set (no per-frame work for hidden ones).
   */
  private readonly visibleNameplateIds = new Set<number>();

  private readonly sprites: PlayerSpriteController;
  private readonly movement: PlayerMovement;
  private readonly perf = new PlayerPerfMonitor();

  /**
   * EXPERIMENTAL Vello-direct crowd path (see `crowd-renderer.ts`).
   * Default OFF — the per-player strip path stays the live renderer.
   * Toggle live via `window.__crowdRenderer.enable()/.disable()`.
   * When active the per-player main composite sprites are hidden each
   * tick and the whole crowd renders to one composited GPU texture.
   */
  private crowd: CrowdRenderer | null = null;
  /**
   * Crowd is now the DEFAULT body renderer (set true in the
   * constructor). Mounts stay on the strip path via `isCrowdManaged`.
   * The `window.__crowdRenderer` console toggle still flips this live.
   */
  private crowdEnabled = true;
  /** Player ids whose main composite sprite is currently suppressed
   *  (`renderable=false`) because the crowd renders them. Visibility +
   *  bounds stay intact so picking keeps working on these sprites. */
  private readonly crowdHiddenIds = new Set<number>();
  /** Defer crowd teardown to the next post-tick so the wasm `realCrowdFree`
   *  call never overlaps with the in-flight `realCrowdRenderBatched` —
   *  calling wasm directly from the toggle path triggers wasm-bindgen's
   *  "recursive use" panic and leaves the renderer permanently stuck. */
  private pendingCrowdDisable = false;
  /** Cache of `parseLook(player.look)` per id (look strings change rarely;
   *  parsing is cheap but doing it 250×/tick adds up). Invalidated when
   *  the look string changes. */
  private readonly parsedLookCache = new Map<
    number,
    { look: string; c1: number; c2: number; c3: number }
  >();
  /** Reused per-id crowd snapshot objects — mutated in place each tick to
   *  avoid allocating ~301 fresh objects (+ accessory arrays) per frame
   *  (the GC-hitch fix). Pruned in `cleanupPlayer`. */
  private readonly crowdSnapObjs = new Map<number, CrowdPlayerSnapshot>();
  /** Reused output array for `crowdSnapshot()` — its length is reset and
   *  the reused per-id objects are re-pushed each tick. */
  private readonly crowdSnapOut: CrowdPlayerSnapshot[] = [];

  constructor(parentContainer: Container, config: PlayerRendererConfig) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.pickingSystem = config.pickingSystem ?? null;
    this.spriteLoader = config.spriteLoader ?? getCharacterSpriteLoader();
    this.pathfinding = config.pathfinding ?? null;
    this.scene = config.scene;
    this.stripRenderer = config.stripRenderer;
    this.container = parentContainer;

    this.sprites = new PlayerSpriteController(
      this.spriteLoader,
      (id) => this.players.has(id),
      (player, animation, animName, flipped, prevAnimName) => {
        const dir = animNameDir(animName);
        // Sprite-controller drives the `main` slot only; mount slots
        // are dispatched per-tick in `syncPlacement` based on the
        // mountLayers' separately-loaded animation refs.
        //
        // `animReady` is the "bot has SOMETHING committed to render"
        // flag. We set it to `false` only in the player factory
        // (initial spawn state); after the first commit lands we
        // flip it to `true` permanently for the bot's lifetime.
        //
        // Why NOT reset to false on every applyAnimation: cache hits
        // resolve `applyAnimation` synchronously, but the `.then()`
        // callback below is a MICROTASK — it fires after the current
        // Ticker tick's NORMAL-priority callbacks finish. If we reset
        // animReady=false here, the same tick's tickFrame (NORMAL
        // priority) already skipped, and animReady=true via microtask
        // happens too late. Bots stutter for 1 main-frame on EVERY
        // applyAnimation, including cache hits — visible as jitter at
        // 60 fps in any scene with frequent direction changes.
        //
        // Combined with the pre-warm sweep (sprite-controller's
        // `prewarmSweep`, which now covers static + walk + run for
        // every direction), all anim transitions for a loaded class
        // are cache hits → the strip renderer commits atomically →
        // bot transitions smoothly with no visible artifact.
        //
        // Deferred-commit (since fix for "bots freeze mid-anim"):
        // sprite-controller's `apply()` no longer installs
        // `currentAnimData` immediately. It stays pointing at the
        // OLD animation through the staging window so `tickFrame`
        // advances the cursor against the OLD anim's fc/fps —
        // keeping the visible OLD strip ALIVE until commit. Without
        // this, walk → static transitions froze the OLD walk strip
        // on frame 0 because the NEW anim's fc=1 caused `tickFrame`
        // to early-exit. Cursor reset is also deferred here so
        // one-shot anims (cast/attack/hit/die) still start at frame
        // 0, while cycle → static preserves the cursor (irrelevant
        // post-commit since static's fc=1 → frame=0 anyway).
        const playerId = player.id;
        // Crowd path: when the Vello-direct crowd renders this body, the
        // strip stays dormant for it — no per-anim atlas bake, no slot
        // allocation, no swapFrame work. Install the anim data
        // immediately (crowd reads it from `ActivePlayer` directly via
        // `crowdSnapshot()`); the strip is bypassed entirely for the
        // main slot.
        if (this.isCrowdManaged(player)) {
          this.installAnimAfterApply(playerId, animation, animName, prevAnimName);
          return;
        }
        void this.stripRenderer
          .applyAnimation(player, "main", animation, animName, dir, flipped)
          .then((committed) => {
            if (!committed) return;
            this.installAnimAfterApply(playerId, animation, animName, prevAnimName);
          });
      },
      // Pre-warm hook: first bot per gfxId triggers a background
      // sweep that bakes every (walk/run × R/L/F/B) atlas via the
      // bake queue. Routes through the SAME queue with the same
      // adaptive budget, so spawn-time bakes only fire during idle
      // frames. By the time the bot walks, every needed atlas is a
      // cache hit instead of a mid-frame Vello compute stall.
      (animation, animName, flipped) => {
        // Crowd path: no atlas prewarm needed (no body atlas exists for
        // crowd-managed bots; the crowd builds encoded vectors on demand).
        if (this.crowdEnabled) return;
        this.stripRenderer.prewarmAtlas(animation, animName, flipped);
      }
    );

    this.movement = new PlayerMovement({
      mapWidth: () => this.mapWidth,
      groundLevel: () => this.groundLevel,
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

    // Live toggle for the experimental Vello-direct crowd renderer.
    (
      window as unknown as { __crowdRenderer?: Record<string, unknown> }
    ).__crowdRenderer = {
      enable: () => this.setCrowdEnabled(true),
      disable: () => this.setCrowdEnabled(false),
      isEnabled: () => this.crowdEnabled,
      setResolution: (res: number) => this.crowd?.setResolution(res),
      lastRenderMs: () => this.crowd?.getLastRenderMs() ?? 0,
      // TEMP DIAG: sample a few crowd bots' anim state to see whether the
      // frame cursor cycles and the anim/dir is correct.
      debugBots: () =>
        this.crowdSnapshot()
          .slice(0, 4)
          .map((p) => {
            const live = this.players.get(p.id);
            return {
              id: p.id,
              export: p.export,
              frame: p.frame,
              dir: p.dir,
              flipped: p.flipped,
              animation: live?.animation,
              currentAnimName: live?.currentAnimName,
              animReady: live?.animReady,
              moving: live?.moving,
              fc: live?.currentAnimData?.frameCount,
            };
          }),
    };
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
    // Mount the strip-rendered Pixi sprite as a child of the player's
    // container; sprite-controller's onApplied callback will hand it
    // texture frames as soon as the first animation lands.
    this.stripRenderer.attach(player);

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

      if (player.spriteReady) {
        const baseAnim = getAnimationBaseFromType(player.animation);
        this.sprites.switch(player, baseAnim, finalDir);
        // Update sprite flip eagerly — `switch()` early-returns when the
        // direction-flipped variant maps to the same anim export, so
        // the strip renderer's flip state would otherwise lag a tick.
        this.stripRenderer.updateFlip(player, isDirectionFlipped(finalDir));
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
      player.overhead.setHp(player.hp, player.maxHp);
    }

    if (data.name !== undefined) {
      player.displayName = data.name;
      player.overhead.setName(data.name);
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
      onComplete?: () => void;
      onLastFrame?: () => void;
    }
  ): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    player.animation = animation;
    player.revertTo = null;
    player.onAnimComplete = null;
    player.onAnimLastFrame = null;
    player.animDataAtRequest = null;
    if (options?.revertTo && isOneShotAnimation(animation)) {
      player.revertTo = options.revertTo;
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
   *      `applyEnd` frame from the player class metadata.
   *   2. `revertTo` (the idle-restore) fires when the animation actually
   *      reaches its last frame.
   */
  private checkAnimRevert(player: ActivePlayer): void {
    if (
      (!player.revertTo && !player.onAnimComplete && !player.onAnimLastFrame) ||
      !player.currentAnimData
    ) {
      return;
    }
    if (!isOneShotAnimation(player.animation)) {
      player.revertTo = null;
      player.onAnimComplete = null;
      player.onAnimLastFrame = null;
      player.animDataAtRequest = null;
      return;
    }
    if (
      player.animDataAtRequest !== null &&
      player.animDataAtRequest === player.currentAnimData
    ) {
      return;
    }
    const total = player.currentAnimData.frameCount;
    const lastFrame = Math.max(0, total - 1);
    const applyEnd = this.spriteLoader.getApplyEndFrame(
      player.gfxId,
      player.currentAnimName
    );
    const defaultLaunchFrame = lastFrame > 1 ? 1 : lastFrame;
    const launchFrame =
      applyEnd !== null ? Math.min(applyEnd, lastFrame) : defaultLaunchFrame;

    if (player.onAnimComplete && player.frameIndex >= launchFrame) {
      const onComplete = player.onAnimComplete;
      player.onAnimComplete = null;
      onComplete();
    }
    if (player.onAnimLastFrame && player.frameIndex >= lastFrame) {
      const onLastFrame = player.onAnimLastFrame;
      player.onAnimLastFrame = null;
      onLastFrame();
    }
    if (player.revertTo && player.frameIndex >= lastFrame) {
      const next = player.revertTo;
      player.revertTo = null;
      player.animDataAtRequest = null;
      // Snap the cursor to frame 0 so the placement re-dispatches at
      // the start of the revert anim while the loader is in flight.
      player.frameIndex = 0;
      player.frameTimer = 0;
      this.setAnimation(player.id, next);
    }
  }

  setDirection(id: number, direction: number): void {
    const player = this.players.get(id);

    if (!player) {
      return;
    }

    const finalDir = this.fightMode
      ? clampFightDirection(direction)
      : direction;

    player.direction = finalDir;
    const baseAnim = getAnimationBaseFromType(player.animation);
    this.sprites.switch(player, baseAnim, finalDir);
    this.stripRenderer.updateFlip(player, isDirectionFlipped(finalDir));
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

  /**
   * True once the player's main slot has its first strip installed.
   * Used by the stress test to defer movement-loop kickoff per bot —
   * a bot that hasn't received its initial bake stays at its spawn
   * cell with whatever placeholder graphic the renderer uses, rather
   * than sliding around with no animation.
   */
  isStripReady(id: number): boolean {
    return this.stripRenderer.isSlotReady(id);
  }

  getContainer(): Container {
    return this.container;
  }

  getPlayerName(id: number): string | null {
    return this.players.get(id)?.displayName ?? null;
  }

  isFightMode(): boolean {
    return this.fightMode;
  }

  getPlayerLook(id: number): string | null {
    return this.players.get(id)?.look ?? null;
  }

  /**
   * Returns the player's main slot sprite + container for the picking
   * layer. Picking uses `sprite.toLocal()` on screen coords and then
   * tests the texture's alpha bitmap; without a sprite, hover/click
   * on chars silently fall through to the ground-click handler (the
   * canonical "clicks on the player do nothing, hovers don't tint
   * the sprite" regression). Returns null when the player isn't
   * registered or the strip renderer hasn't mounted its main slot
   * yet (e.g. during the initial async character-asset load).
   */
  getPlayerPickingData(
    id: number
  ):
    | {
        sprite: Sprite;
        container: Container;
        alphaTest?: import("@/game/types").PickableObject["alphaTest"];
      }
    | { crowd: true; container: Container; playerId: number }
    | null {
    const f = this.players.get(id);
    if (!f) {
      return null;
    }
    // Crowd-managed bodies have no baked strip sprite — they're picked
    // by the wasm point-in-path hit-test (`CrowdRenderer.hitTest`),
    // wired into the picking system as a crowd pickable. Return the
    // crowd descriptor so `BattlefieldPicking.registerPlayer` takes the
    // sprite-less registration path.
    if (this.isCrowdManaged(f)) {
      return { crowd: true, container: f.container, playerId: id };
    }
    const sprite = this.stripRenderer.getSlotSprite(id, "main");
    if (!sprite) {
      return null;
    }
    // V2 ships a multi-band alphaTest because its picking surface is
    // a composition-atlas RenderTexture whose alpha can't be
    // extracted (Pixi v8 doesn't expose RenderTexture GPUTextures
    // via `source.resource`). The custom test re-routes the alpha
    // lookup to the class atlas page (uploaded → extractable) and
    // unions the N band rects to recover the silhouette.
    type AlphaTestFactory = {
      getSlotAlphaTest?: (
        id: number,
        slot: "main",
      ) => import("@/game/types").PickableObject["alphaTest"];
    };
    const factory = this.stripRenderer as unknown as AlphaTestFactory;
    const alphaTest = factory.getSlotAlphaTest
      ? factory.getSlotAlphaTest(id, "main") ?? undefined
      : undefined;
    return { sprite, container: f.container, alphaTest };
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

  private computeNameplateAnchor(player: ActivePlayer): {
    x: number;
    y: number;
  } {
    const global = player.container.toGlobal({ x: 0, y: NAMEPLATE_OFFSET_Y });
    return { x: global.x, y: global.y };
  }

  private flushVisibleNameplates(): void {
    if (this.visibleNameplateIds.size === 0) {
      return;
    }
    for (const id of this.visibleNameplateIds) {
      const player = this.players.get(id);
      if (!player) {
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

  // ── Camera / map sync ───────────────────────────────────────────────

  setGhostView(enabled: boolean): void {
    this.ghostView = enabled;

    for (const player of this.players.values()) {
      // Ground ring + overhead panel still ride the player container,
      // so the ghost-view alpha modulates them visually too. The char
      // placement boost happens via the `syncPlacement` walker reading
      // `this.ghostView`.
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

  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  onResize(event: { zoom: number }): void {
    const res = Math.max(2, Math.ceil(event.zoom));

    for (const player of this.players.values()) {
      player.overhead.setResolution(res);
    }

    this.spriteLoader.setZoom(event.zoom);
    this.sprites.reloadAll(this.players.values());
    // Re-render every live char strip at the new resolution so
    // chars stay crisp on zoom (Vello rasterizes from vectors, so
    // bumping density on demand is the canonical "infinite zoom"
    // path). Skipped automatically when res didn't actually change.
    this.stripRenderer.setResolutionAndRerender(res);
    this.pickingSystem?.markDirty();
    this.flushVisibleNameplates();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  clear(): void {
    log.debug(`clear() — removing ${this.players.size} players`);

    for (const actor of Array.from(this.playerActors.values())) {
      this.scene.remove(actor.id);
    }
    this.visibleNameplateIds.clear();
    clearPlayerNameplates();
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
      placementId: `char-${data.id}`,
      spriteReady: false,
      animReady: false,
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

  /** Build the PIXI container + its decorations; does not load char metadata. */
  private createPlayerContainer(data: PlayerSpriteData): {
    container: Container;
    placeholderGraphics: Graphics;
    groundCircle: Sprite | null;
    overhead: FighterOverheadPanel;
  } {
    const container = new Container();
    container.label = `player-${data.id}`;
    container.sortableChildren = true;
    container.visible = false;

    const groundCircle = createFighterGroundCircle(data.team);
    groundCircle.zIndex = -10;
    groundCircle.visible = this.fightMode;
    container.addChild(groundCircle);

    const placeholderGraphics = new Graphics();
    drawPlayerPlaceholder(placeholderGraphics, data.team, data.direction);
    container.addChild(placeholderGraphics);

    const overhead = new FighterOverheadPanel(data.name);
    overhead.container.zIndex = 10;
    overhead.setHp(data.hp, data.maxHp);
    overhead.setVisible(false);
    container.addChild(overhead.container);

    const pos = getCellPositionWithSlope(
      data.cellId,
      this.mapWidth,
      this.groundLevel,
      this.cellDataMap
    );
    const ox = data.pixelOffset?.x ?? 0;
    const oy = data.pixelOffset?.y ?? 0;
    container.x = pos.x + ox;
    container.y = pos.y + oy;
    container.zIndex = this.calculateZIndex(data.cellId) + Math.round(oy);

    this.container.addChild(container);

    return {
      container,
      placeholderGraphics,
      groundCircle,
      overhead,
    };
  }

  setFightMode(enabled: boolean): void {
    this.fightMode = enabled;
    if (enabled) {
      this.visibleNameplateIds.clear();
      clearPlayerNameplates();
    }
    for (const player of this.players.values()) {
      if (player.groundCircle) {
        player.groundCircle.visible = enabled;
      }
      if (!enabled) {
        player.overhead.setVisible(false);
      } else {
        player.overhead.setHp(player.hp, player.maxHp);
        const clamped = clampFightDirection(player.direction);
        if (clamped !== player.direction) {
          this.setDirection(player.id, clamped);
        }
      }
    }
  }

  setHpBarVisible(id: number, visible: boolean): void {
    const player = this.players.get(id);
    if (!player) return;
    if (visible) {
      player.overhead.setHp(player.hp, player.maxHp);
    }
    player.overhead.setVisible(visible && this.fightMode);
  }

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

  setActiveTurnPlayer(id: number | null): void {
    if (this.activeTurnPlayerId === id) {
      return;
    }
    this.activeTurnPlayerId = id;
  }

  /**
   * Hover-tint hook — canonical Sprite.select(true) wash. Under the
   * unified World layer the wash needs to travel through the Vello
   * encoder as a per-fragment color transform; that work is a v2
   * cut documented in `CHARACTER_RENDERER_AUDIT.md` §8.5. Tracked
   * here as a no-op set-membership so call sites stay stable; the
   * `syncPlacement` walker reads `this.hoveredIds` and (once the
   * Vello transform lands) will encode the tint per placement.
   */
  setHoverHighlight(id: number, hovered: boolean): void {
    if (hovered) {
      this.hoveredIds.add(id);
    } else {
      this.hoveredIds.delete(id);
    }
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
          // Pointer-swap the strip texture to match the freshly
          // advanced frameIndex. Skipped for crowd-managed bots — the
          // crowd reads `f.frameIndex` directly each tick.
          if (!this.isCrowdManaged(f)) {
            this.stripRenderer.swapFrame(f);
          }
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

  /** Load parent + each linked child, then wait on all of them. */
  private async loadWithLinkedChildren(
    data: PlayerSpriteData,
    player: ActivePlayer
  ): Promise<void> {
    const children = data.linkedChildren ?? [];
    const childPromises: Promise<void>[] = [];

    for (const child of children) {
      const childId = data.id * 1000 + child.childIndex;
      const childCellId = this.movement.aroundCell(
        data.cellId,
        data.direction,
        child.childIndex
      );

      childPromises.push(
        this.addPlayer({
          id: childId,
          name: "",
          team: data.team,
          cellId: childCellId,
          direction: data.direction,
          look: `${child.gfxId}`,
          hp: 100,
          maxHp: 100,
          isPlayer: false,
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
    // Retire all per-player slots (main + mount-back/rider/front) +
    // their wgpu textures (2-tick settle handled inside `detach`).
    this.stripRenderer.detach(player);
    this.hoveredIds.delete(id);
    this.crowdHiddenIds.delete(id);
    this.parsedLookCache.delete(id);
    this.crowdSnapObjs.delete(id);
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
  }

  private onPostTick(): void {
    this.perf.endAnim();

    // Sync every active player's placement into the unified World
    // layer. Ground circles + overhead panels remain Pixi children
    // of `player.container`; this walker only touches the char +
    // mount-layer placements that render through Vello.
    for (const player of this.players.values()) {
      this.syncPlacement(player);
    }

    if (this.pendingCrowdDisable) {
      // Deferred cleanup (avoids the wasm-bindgen "recursive use" panic
      // that fires when disable() calls realCrowdFree from a JS task
      // that interleaves with the in-flight crowd render).
      this.crowd?.setEnabled(false);
      this.stripRenderer.setComposeSuppressed(false);
      for (const id of this.crowdHiddenIds) this.setMainRenderable(id, true);
      this.crowdHiddenIds.clear();
      // The strip was bypassed for every crowd-managed bot — it has NO
      // body atlas state for them. Force re-apply each player's current
      // animation so the strip bakes + renders them. Without this,
      // crowd-disable leaves non-mounted bots invisible until their
      // next anim change.
      for (const player of this.players.values()) {
        if (player.mountLayers) continue;
        if (!player.currentAnimData || !player.currentAnimName) continue;
        const dir = animNameDir(player.currentAnimName);
        const flipped = isDirectionFlipped(player.direction);
        void this.stripRenderer.applyAnimation(
          player,
          "main",
          player.currentAnimData,
          player.currentAnimName,
          dir,
          flipped
        );
      }
      this.pendingCrowdDisable = false;
    } else if (this.crowdEnabled) {
      this.syncCrowd();
    }

    this.flushVisibleNameplates();

    this.perf.endFrame(Ticker.shared.deltaMS, this.players.size, null);
  }

  /**
   * Drive the Vello-direct crowd directly from `ActivePlayer` state (no
   * strip dependency). Hides the per-player main composite sprites the
   * crowd now draws. Mount layers + ground/overhead/picking stay on the
   * per-player containers. No-op once `crowdEnabled` flips off — the
   * deferred cleanup in `onPostTick` restores per-player sprites.
   */
  private syncCrowd(): void {
    if (!this.crowd) {
      this.crowd = new CrowdRenderer(
        this.container,
        this.stripRenderer.getResolution(),
      );
      // Route crowd picking through the wasm point-in-path hit-test.
      // Idempotent — the crowd is created once, so this installs the
      // resolver a single time. `pick()` gates the resolved id by
      // z-order against the sprite candidates.
      this.pickingSystem?.setCrowdResolver((gx, gy) =>
        this.crowd?.hitTest(gx, gy) ?? null
      );
    }
    this.crowd.sync(this.crowdSnapshot());

    // Suppress the per-player main composite sprites the crowd now draws
    // (renderable=false keeps bounds + visibility so picking still works),
    // and restore any that left the crowd this tick.
    // While the crowd is drawing bodies, stop the strip's per-bot atlas
    // compose (pure waste) — the real FPS win of the cutover.
    this.stripRenderer.setComposeSuppressed(this.crowd.isActive());

    const rendered = new Set(this.crowd.isActive() ? this.crowd.getRenderedIds() : []);
    for (const id of this.crowdHiddenIds) {
      if (!rendered.has(id)) {
        this.setMainRenderable(id, true);
        this.crowdHiddenIds.delete(id);
      }
    }
    for (const id of rendered) {
      if (!this.crowdHiddenIds.has(id)) {
        this.setMainRenderable(id, false);
        this.crowdHiddenIds.add(id);
      }
      // The crowd draws this bot's CURRENT anim every frame, so the
      // strip-commit "never frozen" gate in `PlayerMovement.advance`
      // (`if (!animReady) return`) must not hold its physics — the strip
      // is suppressed and will never flip the flag. A crowd-rendered bot
      // is on screen by definition, which is exactly what that gate waits
      // for, so mark it ready. Without this, enabling the crowd freezes
      // every bot mid-walk (movePlayer never resolves).
      const p = this.players.get(id);
      if (p && !p.animReady) p.animReady = true;
    }
  }

  /** Set the player's main composite sprite renderable flag (suppresses
   *  drawing without dropping bounds/visibility — picking keeps working). */
  private setMainRenderable(id: number, on: boolean): void {
    const sprite = this.stripRenderer.getSlotSprite(id, "main");
    if (sprite) sprite.renderable = on;
  }

  /**
   * True when this player's body is being rendered by the Vello-direct
   * crowd (and therefore the strip's main-slot work for it must be skipped
   * entirely). Mounted players stay on the strip path.
   */
  private isCrowdManaged(player: ActivePlayer): boolean {
    return this.crowdEnabled && !player.mountLayers;
  }

  /**
   * Snapshot the LIVE per-player render state for the crowd renderer —
   * reads `ActivePlayer` directly, NOT through the strip. The strip is
   * dormant for crowd-managed bots, so its `crowdSnapshot()` would be
   * empty; this is the authoritative source.
   */
  crowdSnapshot(): CrowdPlayerSnapshot[] {
    // Reuse the output array + per-id snapshot objects across frames — at
    // 300 crowd actors a fresh array of objects (each with a fresh `.map()`-ed
    // accessory array) was ~4MB of garbage per tick → GC hitches. We mutate
    // the retained objects in place; the consumer (`CrowdRenderer.sync`)
    // reads them synchronously this tick and retains nothing across frames.
    this.crowdSnapOut.length = 0;
    for (const [id, p] of this.players) {
      if (!p.spriteReady || !p.currentAnimData) continue;
      const a = p.currentAnimData;
      // Look colors — cached per look string (rarely changes).
      let cached = this.parsedLookCache.get(id);
      if (!cached || cached.look !== p.look) {
        const parsed = parseLook(p.look);
        cached = {
          look: p.look,
          c1: parsed.color1 > 0 ? parsed.color1 : 0,
          c2: parsed.color2 > 0 ? parsed.color2 : 0,
          c3: parsed.color3 > 0 ? parsed.color3 : 0,
        };
        this.parsedLookCache.set(id, cached);
      }

      // Get-or-create the retained per-id object (with its own `acc` array).
      let row = this.crowdSnapObjs.get(id);
      if (!row) {
        row = {
          id,
          committed: true,
          mounted: false,
          bundle: a.bundle,
          export: a.exportName,
          frame: 0,
          frameCount: 0,
          fps: 0,
          dir: "S",
          flipped: false,
          c1: 0,
          c2: 0,
          c3: 0,
          x: 0,
          y: 0,
          acc: [],
        };
        this.crowdSnapObjs.set(id, row);
      }

      row.id = id;
      row.committed = true;
      row.mounted = !!p.mountLayers;
      row.bundle = a.bundle;
      row.export = a.exportName;
      row.frame = p.frameIndex;
      row.frameCount = a.frameCount;
      row.fps = a.fps;
      row.dir = animNameDir(p.currentAnimName);
      row.flipped = isDirectionFlipped(p.direction);
      row.c1 = cached.c1;
      row.c2 = cached.c2;
      row.c3 = cached.c3;
      row.x = (p.container as { x: number }).x;
      row.y = (p.container as { y: number }).y;

      // Reuse the existing `acc` array + its entries in place — only the
      // count change resizes; entry objects are mutated, not reallocated.
      const acc = row.acc;
      acc.length = a.accessories.length;
      for (let i = 0; i < a.accessories.length; i++) {
        const ac = a.accessories[i];
        let entry = acc[i];
        if (!entry) {
          entry = { bundle: ac.bundle, export: ac.exportName, slot: ac.slot, animType: ac.animType };
          acc[i] = entry;
        } else {
          entry.bundle = ac.bundle;
          entry.export = ac.exportName;
          entry.slot = ac.slot;
          entry.animType = ac.animType;
        }
      }

      this.crowdSnapOut.push(row);
    }
    return this.crowdSnapOut;
  }

  /**
   * Install the freshly-applied animation onto `ActivePlayer` — the body
   * the strip's `applyAnimation().then(...)` used to run, factored out so
   * the crowd-bypass path can call it immediately (no async strip bake).
   * Phase-preservation across direction flips + one-shot reset rules are
   * preserved verbatim from the original inline implementation.
   */
  private installAnimAfterApply(
    playerId: number,
    animation: NonNullable<ActivePlayer["currentAnimData"]>,
    animName: string,
    prevAnimName: string
  ): void {
    const live = this.players.get(playerId);
    if (!live) return;
    if (live.currentAnimName !== animName) return;
    // Mounted players have currentAnimData already installed by
    // `applyMount` (it overwrites with the "_Back" half); skip install,
    // just flip animReady.
    if (!live.isMounting) {
      const prevBase = prevAnimName.replace(/[SRFLB]$/, "");
      const nextBase = animName.replace(/[SRFLB]$/, "");
      const sameCycle = prevBase === nextBase && prevBase !== "";
      const nextFrameCount = animation.frameCount;
      if (sameCycle) {
        // Preserve phase across direction flips so chars don't "hop".
        live.frameIndex = live.frameIndex % Math.max(1, nextFrameCount);
      } else if (nextBase !== "static") {
        // Cross-cycle / one-shot entry — fresh start at frame 0.
        live.frameIndex = 0;
        live.frameTimer = 0;
      }
      live.currentAnimData = animation;
    }
    live.animReady = true;
  }

  /**
   * Toggle the Vello-direct crowd renderer at runtime. OFF defers the
   * teardown to the next post-tick (the crowd's wasm `realCrowdFree`
   * would race the in-flight render otherwise, triggering wasm-bindgen's
   * "recursive use" panic).
   */
  setCrowdEnabled(on: boolean): void {
    this.crowdEnabled = on;
    if (!on) {
      this.pendingCrowdDisable = true;
    }
  }

  /**
   * Sync mount sub-layer slots through the strip renderer. When a
   * mount is active, the main char body is hidden (the body's
   * `_Back` half replaces it visually) and the strip renderer mounts
   * three additional Pixi sprites in `player.container`:
   *
   *   mount-back   z=-2  body's `_Back` half
   *   mount-rider  z=-1  chevauchor sprite
   *   mount-front  z=+1  body's `_Front` half
   *
   * Pixi `sortableChildren` honors zIndex so the painter's order
   * matches canonical Dofus 1.29's `MOUNT_DEPTH_*` sub-offsets. No
   * worldLayer dispatch — every char sprite (including mount layers)
   * renders through Pixi on the shared GPU device.
   */
  private syncPlacement(player: ActivePlayer): void {
    if (!player.spriteReady || !player.currentAnimData) {
      return;
    }

    const flipped = isDirectionFlipped(player.direction);
    const dirChar = animNameDir(player.currentAnimName);

    if (player.mountLayers) {
      // Body is hidden — the `_Back` half is what the user sees.
      this.stripRenderer.setSlotVisible(player, "main", false);
      const ml = player.mountLayers;

      if (ml.backAnim) {
        this.stripRenderer.ensureSlot(player, "mount-back");
        this.stripRenderer.applyAnimation(
          player,
          "mount-back",
          ml.backAnim,
          ml.backAnim.exportName,
          dirChar,
          flipped
        );
      } else {
        this.stripRenderer.removeSlot(player, "mount-back");
      }

      if (ml.chevauchorAnim) {
        this.stripRenderer.ensureSlot(player, "mount-rider");
        this.stripRenderer.applyAnimation(
          player,
          "mount-rider",
          ml.chevauchorAnim,
          ml.chevauchorAnim.exportName,
          dirChar,
          flipped
        );
      } else {
        this.stripRenderer.removeSlot(player, "mount-rider");
      }

      if (ml.mountFrontAnim) {
        this.stripRenderer.ensureSlot(player, "mount-front");
        this.stripRenderer.applyAnimation(
          player,
          "mount-front",
          ml.mountFrontAnim,
          ml.mountFrontAnim.exportName,
          dirChar,
          flipped
        );
      } else {
        this.stripRenderer.removeSlot(player, "mount-front");
      }
    } else {
      // Not mounted — body visible, no mount slots.
      // Crowd path: skip the strip entirely (it stays dormant for this bot;
      // the crowd renders the body and there are no mount slots to manage).
      if (this.crowdEnabled) return;
      this.stripRenderer.setSlotVisible(player, "main", true);
      this.stripRenderer.removeSlot(player, "mount-back");
      this.stripRenderer.removeSlot(player, "mount-rider");
      this.stripRenderer.removeSlot(player, "mount-front");
    }
  }
}

/**
 * Pull the canonical direction suffix (R/L/F/B/S) from the resolved
 * animation name. Falls back to 'R' for malformed names so a stray
 * animation still picks something deterministic.
 */
function animNameDir(animName: string): "R" | "L" | "F" | "B" | "S" {
  const last = animName[animName.length - 1];
  switch (last) {
    case "R":
    case "L":
    case "F":
    case "B":
    case "S":
      return last;
    default:
      return "R";
  }
}

export type {
  PlayerRendererConfig,
  PlayerSpriteData,
} from "@/game/scene/player/types";
export { PlayerAnimation };
export type { PlayerAnimationValue };
