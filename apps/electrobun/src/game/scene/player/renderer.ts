import type { DofusPathfinding } from "@dofus/grid";
import type { Sprite } from "pixi.js";
import { clampFightDirection } from "@dofus/grid";
import { Container, Graphics, Ticker } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerStripRenderer } from "@/game/render/player-strip-renderer";
import type { Scene } from "@/game/scene/scene";
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
      (player, animation, animName, flipped) => {
        const dir = animNameDir(animName);
        // Sprite-controller drives the `main` slot only; mount slots
        // are dispatched per-tick in `syncPlacement` based on the
        // mountLayers' separately-loaded animation refs.
        //
        // Path B "never frozen" gate: clear animReady the moment a
        // new anim is requested, then flip it back to true only when
        // the strip renderer's atomic commit lands. `PlayerMovement`
        // and any other action that depends on the bot animating
        // checks `player.animReady` per tick and holds physics until
        // it's true. Bots stay where they are (with their previous
        // committed anim still rendering) instead of moving with the
        // wrong/no animation.
        player.animReady = false;
        const playerId = player.id;
        void this.stripRenderer
          .applyAnimation(player, "main", animation, animName, dir, flipped)
          .then((committed) => {
            // The applyAnimation Promise may resolve after the
            // player was despawned or retargeted to a different
            // anim. Only honour the success path while the player
            // still exists AND the live anim is the one we just
            // requested.
            const live = this.players.get(playerId);
            if (!live) return;
            if (!committed) return;
            if (live.currentAnimName !== animName) return;
            live.animReady = true;
          });
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
  ): { sprite: Sprite; container: Container } | null {
    const f = this.players.get(id);
    if (!f) {
      return null;
    }
    const sprite = this.stripRenderer.getSlotSprite(id, "main");
    if (!sprite) {
      return null;
    }
    return { sprite, container: f.container };
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
          // advanced frameIndex. Zero-allocation on the hot path.
          this.stripRenderer.swapFrame(f);
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

    this.flushVisibleNameplates();

    this.perf.endFrame(Ticker.shared.deltaMS, this.players.size, null);
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
