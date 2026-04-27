import type { DofusPathfinding } from "@dofus/grid";
import type { Sprite } from "pixi.js";
import { ColorMatrixFilter, Container, Graphics, Ticker } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
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
  drawFighterGroundCircle,
  drawHPBar,
  drawPlayerPlaceholder,
} from "@/game/scene/player/graphics";
import { PlayerMovement } from "@/game/scene/player/movement";
import { PlayerNameplate } from "@/game/scene/player/nameplate";
import { PlayerPerfMonitor } from "@/game/scene/player/perf";
import { PlayerSpriteController } from "@/game/scene/player/sprite-controller";
import {
  type ActivePlayer,
  type PlayerRendererConfig,
  type PlayerSpriteData,
  parseGfxId,
} from "@/game/scene/player/types";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerRenderer");

const GHOST_VIEW_ALPHA = 0.8;

/**
 * ColorMatrix that mirrors the Flash color transform
 * `{ra:60, rb:102, ga:60, gb:102, ba:60, bb:102}` from
 * Sprite.as:98 (the original 1.29 "selected sprite" look). Each
 * channel is multiplied by 0.6 then offset by 102/255 ≈ 0.4, which
 * brightens shadows without blowing out highlights — the washed-out
 * pop the client uses on the active fighter.
 */
function buildActiveTurnFilter(): ColorMatrixFilter {
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
 * Combat only recognises the four isometric-cardinal facings
 * (1=SE, 3=SW, 5=NW, 7=NE). An even direction coming from roleplay
 * (E/S/W/N — cells that aren't reachable in a fight) gets snapped to
 * the nearest odd that keeps the sprite's left/right orientation:
 *   0 (E — right-facing) → 1 (SE)    —— Dofus's canonical "front"
 *   2 (S — front)        → 1 (SE)    —— same default front pose
 *   4 (W — left-facing)  → 3 (SW)    —— mirror of the E case
 *   6 (N — back)         → 5 (NW)    —— mirror of the S case
 */
function clampFightDirection(dir: number): number {
  if ((dir & 1) === 1) {
    return dir;
  }
  switch (dir) {
    case 0:
    case 2:
      return 1;
    case 4:
      return 3;
    case 6:
      return 5;
    default:
      return 1;
  }
}

/**
 * Map-level coordinator that owns the player registry + the PIXI parent
 * container. Per-player concerns (sprite loading, animation, movement,
 * nameplate, mount layers, HP, perf) live in focused collaborators that
 * receive an ActivePlayer reference to read/mutate.
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
  private unsubPreTick: () => void;
  private unsubPostTick: () => void;

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
      cellDataMap: () => this.cellDataMap,
      pathfinding: () => this.pathfinding,
      pickingSystem: () => this.pickingSystem,
      players: () => this.players,
      spriteController: () => this.sprites,
      calculateZIndex: (cellId) => this.calculateZIndex(cellId),
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

      if (player.hpBar.visible) {
        drawHPBar(player.hpBar, player.hp, player.maxHp, player.team);
      }
    }

    if (data.name !== undefined) {
      player.nameplate.setName(data.name);
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
      /**
       * Fires once when a one-shot animation reaches its last frame.
       * Used for canonical sequencer-blocking semantics — e.g. cast
       * pose completes → THEN spell visual launches (mirrors
       * SpriteHandler.as:782 `addAction(18, true=blocking, setAnim)`
       * before `addAction(20, addEffect)`).
       */
      onComplete?: () => void;
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
    const baseAnim = getAnimationBaseFromType(animation);
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
    if ((!player.revertTo && !player.onAnimComplete) || !player.currentAnimData) {
      return;
    }
    if (!isOneShotAnimation(player.animation)) {
      // Should not happen (revertTo only set when one-shot), but guard
      // in case animation changed via switch() without going through
      // setAnimation.
      player.revertTo = null;
      player.onAnimComplete = null;
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
    // Revert only when the animation has actually finished playing.
    if (player.revertTo && player.frameIndex >= lastFrame) {
      const next = player.revertTo;
      player.revertTo = null;
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
    return this.players.get(id)?.nameplate.getName() ?? null;
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
    f?.nameplate.show(f.container);
  }

  hideName(id: number): void {
    const f = this.players.get(id);
    f?.nameplate.hide(f.container);
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
      player.nameplate.setResolution(res);
    }

    this.spriteLoader.setZoom(event.zoom);
    this.sprites.reloadAll(this.players.values());
    this.pickingSystem?.markDirty();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  clear(): void {
    log.debug(`clear() — removing ${this.players.size} players`);

    for (const actor of Array.from(this.playerActors.values())) {
      this.scene.remove(actor.id);
    }
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
      nameplate: display.nameplate,
      hpBar: display.hpBar,
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
      moving: move.moving,
      spriteLoading: false,
      pendingAnim: null,
      revertTo: null,
      onAnimComplete: null,
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
    groundCircle: Graphics | null;
    nameplate: PlayerNameplate;
    hpBar: Graphics;
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
    const groundCircle = new Graphics();
    drawFighterGroundCircle(groundCircle, data.team);
    groundCircle.zIndex = -10;
    groundCircle.visible = this.fightMode;
    container.addChild(groundCircle);

    const placeholderGraphics = new Graphics();
    drawPlayerPlaceholder(placeholderGraphics, data.team, data.direction);
    container.addChild(placeholderGraphics);

    const nameplate = new PlayerNameplate(data.name);

    // HP bar hidden for world actors in roleplay mode; shown by fight UI.
    const hpBar = new Graphics();
    hpBar.visible = false;

    const pos = getCellPositionWithSlope(
      data.cellId,
      this.mapWidth,
      this.groundLevel,
      this.cellDataMap
    );
    container.x = pos.x;
    container.y = pos.y;
    container.zIndex = this.calculateZIndex(data.cellId);

    this.container.addChild(container);

    return { container, placeholderGraphics, groundCircle, nameplate, hpBar };
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
    for (const player of this.players.values()) {
      if (player.groundCircle) {
        player.groundCircle.visible = enabled;
      }
      if (enabled) {
        const clamped = clampFightDirection(player.direction);
        if (clamped !== player.direction) {
          this.setDirection(player.id, clamped);
        }
      }
    }
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
      drawFighterGroundCircle(player.groundCircle, team);
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
  setActiveTurnPlayer(id: number | null): void {
    if (this.activeTurnPlayerId === id) {
      return;
    }
    const prev = this.activeTurnPlayerId;
    this.activeTurnPlayerId = id;
    if (prev !== null) {
      const p = this.players.get(prev);
      if (p?.sprite) {
        p.sprite.filters = [];
      }
    }
    if (id !== null) {
      const p = this.players.get(id);
      if (p?.sprite) {
        p.sprite.filters = [buildActiveTurnFilter()];
      }
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
