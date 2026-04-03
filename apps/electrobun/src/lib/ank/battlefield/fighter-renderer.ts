import { Container, Graphics, Sprite, Text, TextStyle, Ticker } from "pixi.js";
import { createLogger } from "@/utils/logger";

const log = createLogger("FighterRenderer");

import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/constants/battlefield";
import { FighterTeam } from "@/ecs/components";
import type { PickingSystem } from "@/render/picking-system";

import {
  FighterAnimation,
  type FighterAnimationValue,
  advanceMovement,
  getAnimationBaseFromType,
  getClampedDeltaMs,
  getMovementOffset,
  getCellPositionWithSlope,
  initFrameState,
  initMovementState,
  shouldUseRun,
  startMovementSegment,
  updateFrameAnimation,
} from "./fighter-animation";
import {
  type CharacterAnimation,
  type CharacterSpriteLoader,
  getCharacterSpriteLoader,
  getDirectionSuffix,
  isDirectionFlipped,
} from "./character-sprite";
import type { CellData } from "./datacenter/cell";

/**
 * Fighter sprite data.
 */
export interface FighterSpriteData {
  id: number;
  name: string;
  team: number;
  cellId: number;
  direction: number;
  look: string;
  hp: number;
  maxHp: number;
  isPlayer: boolean;
}

/**
 * Active fighter sprite.
 */
interface ActiveFighter {
  id: number;
  container: Container;
  sprite: Sprite | null;
  placeholderGraphics: Graphics | null;
  nameText: Text;
  nameBg: Graphics;
  hpBar: Graphics;
  cellId: number;
  direction: number;
  team: number;
  hp: number;
  maxHp: number;
  gfxId: number;
  animation: FighterAnimationValue;
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
  moving: boolean;
  moveResolve?: () => void;
  spriteLoading: boolean;
  /** Queued animation request while spriteLoading is true. */
  pendingAnim: { baseAnim: string; direction: number } | null;
  /** Player look string for composed atlas loading */
  look: string;
}

/**
 * Fighter renderer configuration.
 */
export interface FighterRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  cellDataMap?: Map<number, CellData>;
  pickingSystem?: PickingSystem | null;
  spriteLoader?: CharacterSpriteLoader;
}

/**
 * Parse gfxId from the look string (format: "gfx|color1|color2|color3").
 */
function parseGfxId(look: string): number {
  if (!look) return 0;
  const parts = look.split("|");
  return parseInt(parts[0], 10) || 0;
}

/**
 * Fighter renderer.
 * Manages fighter sprites on the battlefield using character sprite atlases.
 */
// Ghost view offset: added to zIndex to push fighters above all Object2 tiles
const GHOST_VIEW_ZINDEX_OFFSET = 100000;
const GHOST_VIEW_ALPHA = 0.8;

export class FighterRenderer {
  private container: Container;
  private fighters: Map<number, ActiveFighter> = new Map();
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;
  private tickerCallback: () => void;
  private pickingSystem: PickingSystem | null;
  private spriteLoader: CharacterSpriteLoader;
  private ghostView = false;

  constructor(parentContainer: Container, config: FighterRendererConfig = {}) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.pickingSystem = config.pickingSystem ?? null;
    this.spriteLoader = config.spriteLoader ?? getCharacterSpriteLoader();

    // Add fighters directly to the parent container (typically objectLayer2)
    // so they interleave with Object2 tiles by zIndex
    this.container = parentContainer;

    this.tickerCallback = () => this.update();
    Ticker.shared.add(this.tickerCallback);
  }

  /**
   * Get cell position using per-cell ground data when available.
   */
  private getCellPos(cellId: number): { x: number; y: number } {
    return getCellPositionWithSlope(
      cellId,
      this.mapWidth,
      this.groundLevel,
      this.cellDataMap
    );
  }

  /**
   * Add a fighter to the battlefield.
   */
  addFighter(data: FighterSpriteData): Promise<void> {
    if (this.fighters.has(data.id)) {
      this.updateFighter(data.id, data);
      return Promise.resolve();
    }

    const fighterContainer = new Container();
    fighterContainer.label = `fighter-${data.id}`;
    fighterContainer.sortableChildren = true;

    // Hide container until sprite is loaded to avoid placeholder flash
    fighterContainer.visible = false;

    // Start with placeholder graphics while sprite loads
    const placeholderGraphics = new Graphics();
    this.drawFighterPlaceholder(placeholderGraphics, data.team, data.direction);
    fighterContainer.addChild(placeholderGraphics);

    // Name background (semi-transparent black rounded rect)
    const nameBg = new Graphics();
    nameBg.visible = false;

    // Name text (white, hidden by default — shown on hover)
    const nameStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 10,
      fontWeight: "bold",
      fill: 0xffffff,
      align: "center",
    });

    const nameText = new Text({ text: data.name, style: nameStyle });
    nameText.resolution = 2;
    nameText.anchor.set(0.5, 0.5);
    nameText.y = -50;
    nameText.visible = false;

    // HP bar (hidden for world actors in roleplay mode)
    const hpBar = new Graphics();
    hpBar.visible = false;

    // Position at cell
    const pos = this.getCellPos(data.cellId);
    fighterContainer.x = pos.x;
    fighterContainer.y = pos.y;
    fighterContainer.zIndex = this.calculateZIndex(data.cellId);

    this.container.addChild(fighterContainer);

    const gfxId = parseGfxId(data.look);

    const frameState = initFrameState();
    const movementState = initMovementState();

    const fighter: ActiveFighter = {
      id: data.id,
      container: fighterContainer,
      sprite: null,
      placeholderGraphics,
      nameText,
      nameBg,
      hpBar,
      cellId: data.cellId,
      direction: data.direction,
      team: data.team,
      hp: data.hp,
      maxHp: data.maxHp,
      gfxId,
      animation: FighterAnimation.IDLE,
      currentAnimName: "",
      currentAnimData: null,
      frameIndex: frameState.frameIndex,
      frameTimer: frameState.frameTimer,
      path: movementState.path,
      pathIndex: movementState.pathIndex,
      moveDistance: movementState.moveDistance,
      moveCosRot: movementState.moveCosRot,
      moveSinRot: movementState.moveSinRot,
      movePixelSpeed: movementState.movePixelSpeed,
      useRun: movementState.useRun,
      moving: movementState.moving,
      spriteLoading: false,
      pendingAnim: null,
      look: data.look,
    };

    this.fighters.set(data.id, fighter);

    // Try to apply sprite synchronously from cache first (avoids flicker on map change)
    if (gfxId > 0) {
      const suffix = getDirectionSuffix(data.direction);
      const cached = this.spriteLoader.getAnimationSync(gfxId, `static${suffix}`, data.look);

      // Kick off preloading ALL common animations (static/walk/run × all directions)
      const preloadDone = this.preloadCommonAnimations(gfxId, data.look);

      if (cached) {
        // Sprite already in cache — apply immediately, no flicker
        this.applyAnimation(fighter, cached, `static${suffix}`);
        fighterContainer.visible = true;
        // Return the preload promise so MAP_ACTORS can wait for all animations
        return preloadDone;
      }

      // Not in cache — load initial static, then show, then wait for all preloads
      return this.loadFighterSprite(fighter, "static", data.direction).then(() => {
        fighterContainer.visible = true;
        if (!this.fighters.has(data.id)) return;
        return preloadDone;
      });
    }

    fighterContainer.visible = true;
    return Promise.resolve();
  }

  /**
   * Preload common animations in background so direction/animation switches are instant.
   * Loads static + walk + run for ALL direction suffixes.
   * Returns a promise that resolves when all preloads complete.
   */
  private async preloadCommonAnimations(gfxId: number, look?: string): Promise<void> {
    // Only preload the current direction's static animation.
    // Walk/run animations are loaded on demand when the actor starts moving.
    // This reduces initial load from 15 strip renders to 1 per actor.
    // For non-stress scenarios (few actors), preload everything.
    const actorCount = this.fighters.size;
    if (actorCount > 30) {
      // Stress mode: minimal preload
      return;
    }
    // Normal gameplay: preload all directions sequentially
    for (const s of ["S", "R", "F", "L", "B"]) {
      await this.spriteLoader.loadAnimation(gfxId, `static${s}`, look);
      await this.spriteLoader.loadAnimation(gfxId, `walk${s}`, look);
      await this.spriteLoader.loadAnimation(gfxId, `run${s}`, look);
    }
  }

  /**
   * Load and apply a character sprite animation for a fighter.
   * If already loading, queues the request so the latest animation is applied after.
   */
  private async loadFighterSprite(
    fighter: ActiveFighter,
    baseAnim: string,
    direction: number
  ): Promise<void> {
    if (fighter.spriteLoading) {
      // Queue the latest request — only the most recent matters
      fighter.pendingAnim = { baseAnim, direction };
      return;
    }
    fighter.spriteLoading = true;
    fighter.pendingAnim = null;

    const result = await this.spriteLoader.loadAnimationWithFallback(
      fighter.gfxId,
      baseAnim,
      direction,
      fighter.look
    );

    fighter.spriteLoading = false;

    // Fighter may have been removed while loading
    if (!this.fighters.has(fighter.id)) return;

    if (result) {
      const { animation, animName } = result;
      this.applyAnimation(fighter, animation, animName);
    }

    // Process queued animation request if any
    if (fighter.pendingAnim) {
      const { baseAnim: nextAnim, direction: nextDir } = fighter.pendingAnim;
      fighter.pendingAnim = null;
      this.switchAnimation(fighter, nextAnim, nextDir);
    }
  }

  /**
   * Apply a loaded animation to a fighter, replacing placeholder or previous sprite.
   */
  private applyAnimation(
    fighter: ActiveFighter,
    animation: CharacterAnimation,
    animName: string
  ): void {
    // Don't re-apply same animation
    if (fighter.currentAnimName === animName && fighter.sprite) return;

    fighter.currentAnimData = animation;
    fighter.currentAnimName = animName;
    fighter.frameIndex = 0;
    fighter.frameTimer = 0;

    // Remove placeholder if present
    if (fighter.placeholderGraphics) {
      fighter.container.removeChild(fighter.placeholderGraphics);
      fighter.placeholderGraphics.destroy();
      fighter.placeholderGraphics = null;
    }

    // Apply horizontal flip for mirrored directions (SW, W, NE)
    const flipped = isDirectionFlipped(fighter.direction);

    // Create or update sprite
    if (!fighter.sprite) {
      const sprite = new Sprite(animation.textures[0]);
      sprite.anchor.set(0, 0);
      sprite.scale.x = flipped ? -1 : 1;
      sprite.x = flipped ? -animation.offsetX : animation.offsetX;
      sprite.y = animation.offsetY;
      sprite.zIndex = 0;
      fighter.container.addChild(sprite);
      fighter.sprite = sprite;
    } else {
      fighter.sprite.texture = animation.textures[0];
      fighter.sprite.scale.x = flipped ? -1 : 1;
      fighter.sprite.x = flipped ? -animation.offsetX : animation.offsetX;
      fighter.sprite.y = animation.offsetY;
    }

    fighter.sprite.filters = [];

    // Update name position above sprite
    this.updateNamePosition(fighter);
  }

  /**
   * Switch a fighter's animation (e.g., idle → walk).
   */
  private switchAnimation(
    fighter: ActiveFighter,
    baseAnim: string,
    direction: number
  ): void {
    const suffix = getDirectionSuffix(direction);
    const animName = `${baseAnim}${suffix}`;

    // Same animation name but direction may have changed flip state
    // (e.g., SE uses "R" un-flipped, SW uses "R" flipped)
    if (fighter.currentAnimName === animName && fighter.sprite) {
      this.updateFlip(fighter);
      return;
    }

    // Check if cached
    const cached = this.spriteLoader.getAnimationSync(fighter.gfxId, animName, fighter.look);

    if (cached) {
      this.applyAnimation(fighter, cached, animName);
    } else {
      // Load asynchronously — the old animation keeps showing until this completes
      this.loadFighterSprite(fighter, baseAnim, direction);
    }
  }

  /**
   * Update sprite flip based on current direction (without changing animation).
   */
  private updateFlip(fighter: ActiveFighter): void {
    if (!fighter.sprite || !fighter.currentAnimData) return;
    const flipped = isDirectionFlipped(fighter.direction);
    fighter.sprite.scale.x = flipped ? -1 : 1;
    fighter.sprite.x = flipped
      ? -fighter.currentAnimData.offsetX
      : fighter.currentAnimData.offsetX;
  }

  /**
   * Remove a fighter from the battlefield.
   */
  removeFighter(id: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    log.debug(`removeFighter ${id}`);
    this.container.removeChild(fighter.container);
    fighter.container.destroy({ children: true });
    this.fighters.delete(id);
  }

  /**
   * Update fighter data.
   */
  updateFighter(id: number, data: Partial<FighterSpriteData>): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    if (
      data.cellId !== undefined &&
      data.cellId !== fighter.cellId &&
      !fighter.moving
    ) {
      this.teleportFighter(id, data.cellId);
    }

    if (data.direction !== undefined && data.direction !== fighter.direction) {
      fighter.direction = data.direction;
      if (fighter.sprite) {
        const baseAnim = getAnimationBaseFromType(fighter.animation);
        this.switchAnimation(fighter, baseAnim, data.direction);
      } else if (fighter.placeholderGraphics) {
        this.drawFighterPlaceholder(
          fighter.placeholderGraphics,
          fighter.team,
          fighter.direction
        );
      }
    }

    if (data.hp !== undefined || data.maxHp !== undefined) {
      fighter.hp = data.hp ?? fighter.hp;
      fighter.maxHp = data.maxHp ?? fighter.maxHp;
      if (fighter.hpBar.visible) {
        this.drawHPBar(fighter.hpBar, fighter.hp, fighter.maxHp, fighter.team);
      }
    }

    if (data.name !== undefined) {
      fighter.nameText.text = data.name;
    }
  }

  /**
   * Move fighter along a path.
   */
  moveFighter(id: number, path: number[]): Promise<void> {
    return new Promise((resolve) => {
      const fighter = this.fighters.get(id);

      if (!fighter || path.length < 2) {
        resolve();
        return;
      }

      // Choose walk or run based on path length
      const useRun = shouldUseRun(path.length);
      fighter.path = path;
      fighter.pathIndex = 0;
      fighter.useRun = useRun;
      fighter.moving = true;
      fighter.animation = useRun ? FighterAnimation.RUN : FighterAnimation.WALK;
      fighter.moveResolve = resolve;

      // Start the first segment
      this.startMoveSegment(fighter);
    });
  }

  /**
   * Begin a new cell-to-cell movement segment (matches original moveToCell).
   * Computes pixel distance, direction vector, and speed for the current segment.
   */
  private startMoveSegment(fighter: ActiveFighter): void {
    const movementState = {
      path: fighter.path,
      pathIndex: fighter.pathIndex,
      moveDistance: fighter.moveDistance,
      moveCosRot: fighter.moveCosRot,
      moveSinRot: fighter.moveSinRot,
      movePixelSpeed: fighter.movePixelSpeed,
      useRun: fighter.useRun,
      moving: fighter.moving,
    };

    const dir = startMovementSegment(
      movementState,
      this.mapWidth,
      this.groundLevel,
      this.cellDataMap
    );

    fighter.direction = dir;
    fighter.moveDistance = movementState.moveDistance;
    fighter.moveCosRot = movementState.moveCosRot;
    fighter.moveSinRot = movementState.moveSinRot;
    fighter.movePixelSpeed = movementState.movePixelSpeed;

    // Switch animation for this segment's direction
    const baseAnim = fighter.useRun ? "run" : "walk";
    this.switchAnimation(fighter, baseAnim, dir);
  }

  /**
   * Teleport fighter to a cell instantly.
   */
  teleportFighter(id: number, cellId: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.cellId = cellId;
    const pos = this.getCellPos(cellId);
    fighter.container.x = pos.x;
    fighter.container.y = pos.y;
    fighter.container.zIndex = this.calculateZIndex(cellId);
  }

  /**
   * Set fighter animation.
   */
  setAnimation(id: number, animation: FighterAnimationValue): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.animation = animation;
    const baseAnim = getAnimationBaseFromType(animation);
    this.switchAnimation(fighter, baseAnim, fighter.direction);
  }

  /**
   * Set fighter direction.
   */
  setDirection(id: number, direction: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.direction = direction;
    const baseAnim = getAnimationBaseFromType(fighter.animation);
    this.switchAnimation(fighter, baseAnim, direction);
  }

  /**
   * Get fighter cell position.
   */
  getFighterCell(id: number): number | undefined {
    return this.fighters.get(id)?.cellId;
  }

  /**
   * Get all fighter IDs.
   */
  getFighterIds(): number[] {
    return Array.from(this.fighters.keys());
  }

  /**
   * Check if fighter exists.
   */
  hasFighter(id: number): boolean {
    return this.fighters.has(id);
  }

  /**
   * Update animation tick — handles movement interpolation and sprite frame animation.
   * Movement matches original basicMove: deltaPx = speed * min(deltaMs, 125).
   */
  /** Last update() duration in ms — exposed for debug overlay */
  lastUpdateMs = 0;

  // --- Performance diagnostics ---
  private _prevFrameStart = 0;
  private _perfFrameTimes: number[] = [];
  private _perfUpdateTimes: number[] = [];
  private _perfAnimTimes: number[] = [];
  private _perfFlushTimes: number[] = [];
  private _perfLogTimer = 0;

  private update(): void {
    const _t0 = performance.now();

    // Track frame-to-frame time (total frame cost including Pixi.js render + GPU)
    if (this._prevFrameStart > 0) {
      this._perfFrameTimes.push(_t0 - this._prevFrameStart);
    }
    this._prevFrameStart = _t0;

    // Advance atlas tick (resets per-tick render budget)
    this.spriteLoader.getAtlas()?.tick();

    const deltaMs = Ticker.shared.deltaMS;
    const deltaS = deltaMs / 1000;
    const clampedMs = getClampedDeltaMs(deltaMs);
    let anyMoved = false;

    const _tAnim0 = performance.now();
    for (const fighter of this.fighters.values()) {
      // Animate sprite frames
      this.updateSpriteAnimation(fighter, deltaS);

      // Handle path movement (pixel-based, matching original basicMove)
      if (!fighter.moving || fighter.path.length === 0) {
        continue;
      }

      anyMoved = true;
      const deltaPx = fighter.movePixelSpeed * clampedMs;

      const movementState = {
        path: fighter.path,
        pathIndex: fighter.pathIndex,
        moveDistance: fighter.moveDistance,
        moveCosRot: fighter.moveCosRot,
        moveSinRot: fighter.moveSinRot,
        movePixelSpeed: fighter.movePixelSpeed,
        useRun: fighter.useRun,
        moving: fighter.moving,
      };

      const result = advanceMovement(
        movementState,
        deltaPx,
        this.mapWidth,
        this.groundLevel,
        this.cellDataMap
      );

      // Update fighter state from movement result
      fighter.pathIndex = movementState.pathIndex;
      fighter.moving = movementState.moving;

      if (result.complete) {
        // Entire path complete — stop and return to idle
        fighter.path = [];
        fighter.pathIndex = 0;
        fighter.moveDistance = 0;
        fighter.moving = false;
        fighter.animation = FighterAnimation.IDLE;

        this.switchAnimation(fighter, "static", fighter.direction);

        if (fighter.moveResolve) {
          const resolve = fighter.moveResolve;
          fighter.moveResolve = undefined;
          resolve();
        }
      } else if (result.nextCell !== undefined) {
        // Segment complete — snap to destination cell and start next
        const toPos = this.getCellPos(result.nextCell);
        fighter.container.x = toPos.x;
        fighter.container.y = toPos.y;
        fighter.cellId = result.nextCell;
        fighter.container.zIndex = this.calculateZIndex(result.nextCell);

        // Start next segment
        this.startMoveSegment(fighter);
      } else {
        // Mid-segment: advance position by deltaPx along direction vector
        const offset = getMovementOffset(movementState, deltaPx);
        fighter.container.x += offset.x;
        fighter.container.y += offset.y;
        fighter.moveDistance -= deltaPx;
      }
    }
    const _tAnimEnd = performance.now();
    this._perfAnimTimes.push(_tAnimEnd - _tAnim0);

    // Flush all batched atlas renders in ONE Vello dispatch + ONE copy
    const _tFlush0 = performance.now();
    this.spriteLoader.getAtlas()?.flush();
    this._perfFlushTimes.push(performance.now() - _tFlush0);

    if (anyMoved) {
      this.pickingSystem?.markDirty();
    }
    this.lastUpdateMs = performance.now() - _t0;
    this._perfUpdateTimes.push(this.lastUpdateMs);

    // Log performance every ~1 second
    this._perfLogTimer += deltaMs;
    if (this._perfLogTimer >= 1000 && this._perfFrameTimes.length > 0) {
      this._perfLogTimer = 0;
      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const frameMs = avg(this._perfFrameTimes);
      const updateMs = avg(this._perfUpdateTimes);
      const animMs = avg(this._perfAnimTimes);
      const flushMs = avg(this._perfFlushTimes);
      const pixiMs = frameMs - updateMs; // time NOT in our update = Pixi.js render + GPU + browser
      const atlas = this.spriteLoader.getAtlas();
      const s = atlas?.stats;
      const n = this.fighters.size;
      console.log(
        `[PERF] ${(1000 / frameMs).toFixed(0)}fps ` +
        `frame:${frameMs.toFixed(1)}ms ` +
        `upd:${updateMs.toFixed(1)}ms ` +
        `(anim+move:${animMs.toFixed(1)}ms flush:${flushMs.toFixed(1)}ms) ` +
        `pixi+gpu:${pixiMs.toFixed(1)}ms ` +
        `| ${n}fighters ` +
        (s ? `slots:${s.slots}/${s.maxSlots} r:${s.lastRenders} ` +
             `q:${s.lastQueueMs.toFixed(1)}ms fl:${s.lastFlushMs.toFixed(1)}ms ` +
             `h:${s.lastHits}` : 'no atlas')
      );
      this._perfFrameTimes = [];
      this._perfUpdateTimes = [];
      this._perfAnimTimes = [];
      this._perfFlushTimes = [];
    }
  }

  /**
   * Update sprite frame animation for a fighter.
   */
  private updateSpriteAnimation(fighter: ActiveFighter, deltaS: number): void {
    if (!fighter.sprite || !fighter.currentAnimData) return;

    const anim = fighter.currentAnimData;
    // Use frameCount if available (atlas mode: textures.length=1 but real frame count is higher)
    const realFrameCount = anim.frameCount ?? anim.textures.length;
    const frameState = {
      frameIndex: fighter.frameIndex,
      frameTimer: fighter.frameTimer,
    };

    updateFrameAnimation(frameState, deltaS, realFrameCount, anim.fps);

    fighter.frameIndex = frameState.frameIndex;
    fighter.frameTimer = frameState.frameTimer;
    if (anim.resolveFrame) {
      const tex = anim.resolveFrame(fighter.frameIndex);
      if (tex) {
        fighter.sprite.texture = tex;
      }
    } else {
      fighter.sprite.texture = anim.textures[fighter.frameIndex % anim.textures.length];
    }

  }

  /**
   * Calculate z-index from cell position.
   * In ghost view, offset pushes fighters above all Object2 tiles.
   */
  private calculateZIndex(cellId: number): number {
    return cellId * 100 + 30 + (this.ghostView ? GHOST_VIEW_ZINDEX_OFFSET : 0);
  }

  /**
   * Toggle ghost/transparency view.
   * When enabled, fighters render above Object2 at reduced alpha.
   */
  setGhostView(enabled: boolean): void {
    this.ghostView = enabled;
    for (const fighter of this.fighters.values()) {
      fighter.container.zIndex = this.calculateZIndex(fighter.cellId);
      fighter.container.alpha = enabled ? GHOST_VIEW_ALPHA : 1;
    }
  }

  /**
   * Draw placeholder fighter graphic (used while sprite loads).
   */
  private drawFighterPlaceholder(
    graphics: Graphics,
    team: number,
    direction: number
  ): void {
    graphics.clear();

    const color = team === FighterTeam.RED ? 0xff4444 : 0x4444ff;

    // Body circle
    graphics.circle(0, -10, 12);
    graphics.fill({ color, alpha: 0.8 });
    graphics.stroke({ color: 0x000000, width: 2 });

    // Head circle
    graphics.circle(0, -25, 8);
    graphics.fill({ color, alpha: 0.9 });
    graphics.stroke({ color: 0x000000, width: 2 });

    // Direction indicator
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    const angle = (angles[direction] * Math.PI) / 180;
    const indicatorX = Math.cos(angle) * 15;
    const indicatorY = Math.sin(angle) * 8 - 10;

    graphics.circle(indicatorX, indicatorY, 4);
    graphics.fill({ color: 0xffff00 });
  }

  /**
   * Draw HP bar.
   */
  private drawHPBar(
    graphics: Graphics,
    hp: number,
    maxHp: number,
    team: number
  ): void {
    graphics.clear();

    const width = 30;
    const height = 4;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));

    // Background
    graphics.rect(-width / 2, 0, width, height);
    graphics.fill({ color: 0x333333 });

    // HP fill
    const hpColor = team === FighterTeam.RED ? 0xff4444 : 0x4444ff;
    graphics.rect(-width / 2, 0, width * ratio, height);
    graphics.fill({ color: hpColor });

    // Border
    graphics.rect(-width / 2, 0, width, height);
    graphics.stroke({ color: 0x000000, width: 1 });
  }

  /**
   * Set map dimensions.
   */
  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  /**
   * Update container position.
   */
  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  /**
   * Set container scale.
   */
  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  /**
   * Handle resize/zoom changes.
   */
  onResize(event: { zoom: number }): void {
    // NOTE: do NOT scale the container here — it lives inside mapContainer
    // which is already scaled to the zoom level.

    // Update text resolution so names render crisply at the current zoom
    const res = Math.max(2, Math.ceil(event.zoom * window.devicePixelRatio));
    for (const fighter of this.fighters.values()) {
      fighter.nameText.resolution = res;
    }

    // Re-rasterize character SVGs at the new zoom level
    this.spriteLoader.setZoom(event.zoom);
    this.reloadAllSprites();

    this.pickingSystem?.markDirty();
  }

  /**
   * Reload all fighter sprites at the current zoom resolution.
   * Cache was cleared by setZoom, so loadAnimation will re-rasterize SVGs.
   * Old textures are left for GC — no explicit unload needed.
   */
  private reloadAllSprites(): void {
    for (const fighter of this.fighters.values()) {
      if (fighter.gfxId > 0 && fighter.currentAnimName) {
        const animName = fighter.currentAnimName;
        // Force cache miss so applyAnimation accepts the new data
        fighter.currentAnimName = "";
        this.spriteLoader.loadAnimation(fighter.gfxId, animName, fighter.look).then((anim) => {
          if (anim && this.fighters.has(fighter.id)) {
            this.applyAnimation(fighter, anim, animName);
          }
        });
      }
    }
  }

  getContainer(): Container {
    return this.container;
  }

  /**
   * Show name tooltip for a fighter.
   */
  showName(id: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    this.updateNameBg(f);
    if (!f.nameBg.parent) f.container.addChild(f.nameBg);
    f.nameBg.visible = true;
    if (!f.nameText.parent) f.container.addChild(f.nameText);
    f.nameText.visible = true;
  }

  /**
   * Hide name tooltip for a fighter.
   */
  hideName(id: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    f.nameText.visible = false;
    if (f.nameText.parent) f.container.removeChild(f.nameText);
    f.nameBg.visible = false;
    if (f.nameBg.parent) f.container.removeChild(f.nameBg);
  }

  /**
   * Get fighter sprite and container for picking registration.
   */
  getFighterPickingData(
    id: number,
  ): { sprite: Sprite; container: Container } | null {
    const f = this.fighters.get(id);
    if (!f?.sprite) return null;
    return { sprite: f.sprite, container: f.container };
  }

  /**
   * Update the name label Y position above the sprite.
   * Uses a fixed offset matching the original Dofus client (DEFAULT_SPRITE_HEIGHT = 50).
   * This prevents jiggle when switching between animations with different frame heights.
   */
  private updateNamePosition(f: ActiveFighter): void {
    const SPRITE_HEIGHT = 50;
    const margin = 5;
    f.nameText.y = -SPRITE_HEIGHT - margin - f.nameText.height / 2;
  }

  /**
   * Redraw the name background to fit the current text.
   */
  private updateNameBg(f: ActiveFighter): void {
    const padX = 6;
    const padY = 3;
    const w = f.nameText.width + padX * 2;
    const h = f.nameText.height + padY * 2;
    f.nameBg.clear();
    f.nameBg.roundRect(-w / 2, f.nameText.y - h / 2, w, h, 4);
    f.nameBg.fill({ color: 0x000000, alpha: 0.5 });
  }

  /**
   * Clear all fighters.
   */
  clear(): void {
    log.debug(`clear() — removing ${this.fighters.size} fighters`);
    for (const fighter of this.fighters.values()) {
      this.container.removeChild(fighter.container);
      fighter.container.destroy({ children: true });
    }
    this.fighters.clear();
  }

  /**
   * Destroy the renderer.
   */
  destroy(): void {
    Ticker.shared.remove(this.tickerCallback);
    this.clear();
  }
}

// Re-export animation constants and types for backward compatibility
export type { FighterAnimationValue };
export { FighterAnimation };
