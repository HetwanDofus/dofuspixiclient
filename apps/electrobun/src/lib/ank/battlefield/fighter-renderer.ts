import { Container, Graphics, Sprite, Text, TextStyle, Ticker } from "pixi.js";

import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/constants/battlefield";
import { FighterTeam } from "@/ecs/components";
import type { PickingSystem } from "@/render/picking-system";

import {
  type CharacterAnimation,
  getCharacterSpriteLoader,
  getDirectionSuffix,
  isDirectionFlipped,
} from "./character-sprite";
import { getCellPosition, getSlopeYOffset, type CellData } from "./datacenter/cell";
import { getDirection } from "./dofus-pathfinding";

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
} as const;

export type FighterAnimationValue =
  (typeof FighterAnimation)[keyof typeof FighterAnimation];

/**
 * Map FighterAnimation state to sprite animation base name.
 */
const ANIM_TO_SPRITE_BASE: Record<string, string> = {
  [FighterAnimation.IDLE]: "static",
  [FighterAnimation.WALK]: "walk",
  [FighterAnimation.RUN]: "run",
  [FighterAnimation.ATTACK]: "anim0",
  [FighterAnimation.HIT]: "hit",
  [FighterAnimation.DEATH]: "die",
  [FighterAnimation.CAST]: "anim1",
};

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
  moving: boolean;
  moveResolve?: () => void;
  spriteLoading: boolean;
  /** Queued animation request while spriteLoading is true. */
  pendingAnim: { baseAnim: string; direction: number } | null;
}

/**
 * Fighter renderer configuration.
 */
export interface FighterRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
  cellDataMap?: Map<number, CellData>;
  pickingSystem?: PickingSystem | null;
}

/**
 * Per-direction movement speeds in px/ms (from ank.battlefield.mc.Sprite).
 */
const WALK_SPEEDS = [0.07, 0.06, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06];
const RUN_SPEEDS = [0.17, 0.15, 0.15, 0.15, 0.17, 0.15, 0.15, 0.15];
/** Maximum frame delta in ms — matches original's cap in basicMove. */
const MAX_FRAME_MS = 125;
/** Paths with more steps than this use run animation (original: DEFAULT_RUNLINIT = 6, checked as path.length > 6). */
const RUN_THRESHOLD = 6;

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
export class FighterRenderer {
  private container: Container;
  private fighters: Map<number, ActiveFighter> = new Map();
  private mapWidth: number;
  private groundLevel: number;
  private cellDataMap: Map<number, CellData>;
  private tickerCallback: () => void;
  private pickingSystem: PickingSystem | null;

  constructor(parentContainer: Container, config: FighterRendererConfig = {}) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;
    this.cellDataMap = config.cellDataMap ?? new Map();
    this.pickingSystem = config.pickingSystem ?? null;

    this.container = new Container();
    this.container.label = "fighter-renderer";
    this.container.sortableChildren = true;

    parentContainer.addChild(this.container);

    this.tickerCallback = () => this.update();
    Ticker.shared.add(this.tickerCallback);
  }

  /**
   * Get cell position using per-cell ground data when available.
   */
  private getCellPos(cellId: number): { x: number; y: number } {
    const cell = this.cellDataMap.get(cellId);
    const level = cell?.groundLevel ?? this.groundLevel;
    const slope = cell?.groundSlope ?? 1;
    const pos = getCellPosition(cellId, this.mapWidth, level);
    return { x: pos.x, y: pos.y + getSlopeYOffset(slope) };
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
    fighterContainer.addChild(nameBg);

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
    fighterContainer.addChild(nameText);

    // HP bar (hidden for world actors in roleplay mode)
    const hpBar = new Graphics();
    hpBar.visible = false;
    fighterContainer.addChild(hpBar);

    // Position at cell
    const pos = this.getCellPos(data.cellId);
    fighterContainer.x = pos.x;
    fighterContainer.y = pos.y;
    fighterContainer.zIndex = this.calculateZIndex(data.cellId);

    this.container.addChild(fighterContainer);

    const gfxId = parseGfxId(data.look);

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
      frameIndex: 0,
      frameTimer: 0,
      path: [],
      pathIndex: 0,
      moveDistance: 0,
      moveCosRot: 0,
      moveSinRot: 0,
      movePixelSpeed: 0,
      useRun: false,
      moving: false,
      spriteLoading: false,
      pendingAnim: null,
    };

    this.fighters.set(data.id, fighter);

    // Try to apply sprite synchronously from cache first (avoids flicker on map change)
    if (gfxId > 0) {
      const loader = getCharacterSpriteLoader();
      const suffix = getDirectionSuffix(data.direction);
      const cached = loader.getAnimationSync(gfxId, `static${suffix}`);

      // Kick off preloading ALL common animations (static/walk/run × all directions)
      const preloadDone = this.preloadCommonAnimations(loader, gfxId);

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
  private preloadCommonAnimations(
    loader: ReturnType<typeof getCharacterSpriteLoader>,
    gfxId: number,
  ): Promise<void> {
    const promises: Promise<unknown>[] = [];
    for (const s of ["S", "R", "F", "L", "B"]) {
      promises.push(loader.loadAnimation(gfxId, `static${s}`));
      promises.push(loader.loadAnimation(gfxId, `walk${s}`));
      promises.push(loader.loadAnimation(gfxId, `run${s}`));
    }
    return Promise.allSettled(promises).then(() => {});
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

    const loader = getCharacterSpriteLoader();
    const result = await loader.loadAnimationWithFallback(
      fighter.gfxId,
      baseAnim,
      direction
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
      sprite.anchor.set(0, 1);
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

    // Update name position above sprite
    this.updateNamePosition(fighter, animation);
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
    const loader = getCharacterSpriteLoader();
    const cached = loader.getAnimationSync(fighter.gfxId, animName);

    if (cached) {
      this.applyAnimation(fighter, cached, animName);
    } else {
      // Load asynchronously — the old animation keeps showing until this completes
      console.warn(`[FighterRenderer] Animation "${animName}" not cached for gfx ${fighter.gfxId}, loading async`);
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

    console.log("[FighterRenderer] removeFighter", id);
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
        const baseAnim = ANIM_TO_SPRITE_BASE[fighter.animation] ?? "static";
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

      // Choose walk or run based on path length (original: path.length > DEFAULT_RUNLINIT)
      const useRun = path.length > RUN_THRESHOLD;
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
    const fromCell = fighter.path[fighter.pathIndex];
    const toCell = fighter.path[fighter.pathIndex + 1];

    // Compute direction
    const dir = getDirection(fromCell, toCell, this.mapWidth);
    fighter.direction = dir;

    // Get pixel positions
    const fromPos = this.getCellPos(fromCell);
    const toPos = this.getCellPos(toCell);

    // Pixel distance (matches original: Math.sqrt(dx^2 + dy^2))
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    fighter.moveDistance = Math.sqrt(dx * dx + dy * dy);

    // Direction unit vector (matches original: atan2 → cos/sin)
    const angle = Math.atan2(dy, dx);
    fighter.moveCosRot = Math.cos(angle);
    fighter.moveSinRot = Math.sin(angle);

    // Speed in px/ms (matches original WALK_SPEEDS / RUN_SPEEDS indexed by direction)
    fighter.movePixelSpeed = fighter.useRun
      ? RUN_SPEEDS[dir]
      : WALK_SPEEDS[dir];

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
    const baseAnim = ANIM_TO_SPRITE_BASE[animation] ?? "static";
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
    const baseAnim = ANIM_TO_SPRITE_BASE[fighter.animation] ?? "static";
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
  private update(): void {
    const deltaMs = Ticker.shared.deltaMS;
    const deltaS = deltaMs / 1000;
    const clampedMs = Math.min(deltaMs, MAX_FRAME_MS);
    let anyMoved = false;

    for (const fighter of this.fighters.values()) {
      // Animate sprite frames
      this.updateSpriteAnimation(fighter, deltaS);

      // Handle path movement (pixel-based, matching original basicMove)
      if (!fighter.moving || fighter.path.length === 0) {
        continue;
      }

      anyMoved = true;
      const deltaPx = fighter.movePixelSpeed * clampedMs;

      if (fighter.moveDistance <= deltaPx) {
        // Segment complete — snap to destination cell and advance
        const toCell = fighter.path[fighter.pathIndex + 1];
        const toPos = this.getCellPos(toCell);
        fighter.container.x = toPos.x;
        fighter.container.y = toPos.y;
        fighter.cellId = toCell;
        fighter.container.zIndex = this.calculateZIndex(toCell);

        fighter.pathIndex++;

        if (fighter.pathIndex >= fighter.path.length - 1) {
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
        } else {
          // Start next segment
          this.startMoveSegment(fighter);
        }
      } else {
        // Mid-segment: advance position by deltaPx along direction vector
        fighter.container.x += deltaPx * fighter.moveCosRot;
        fighter.container.y += deltaPx * fighter.moveSinRot;
        fighter.moveDistance -= deltaPx;
      }
    }

    if (anyMoved) {
      this.pickingSystem?.markDirty();
    }
  }

  /**
   * Update sprite frame animation for a fighter.
   */
  private updateSpriteAnimation(fighter: ActiveFighter, deltaS: number): void {
    if (!fighter.sprite || !fighter.currentAnimData) return;

    const anim = fighter.currentAnimData;
    if (anim.textures.length <= 1) return;

    fighter.frameTimer += deltaS;

    const frameDuration = 1 / anim.fps;
    if (fighter.frameTimer >= frameDuration) {
      fighter.frameTimer -= frameDuration;
      fighter.frameIndex = (fighter.frameIndex + 1) % anim.textures.length;
      fighter.sprite.texture = anim.textures[fighter.frameIndex];
    }
  }

  /**
   * Calculate z-index from cell position.
   */
  private calculateZIndex(cellId: number): number {
    return cellId * 100 + 30;
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
    const loader = getCharacterSpriteLoader();
    loader.setZoom(event.zoom);
    this.reloadAllSprites();

    this.pickingSystem?.markDirty();
  }

  /**
   * Reload all fighter sprites at the current zoom resolution.
   * Cache was cleared by setZoom, so loadAnimation will re-rasterize SVGs.
   * Old textures are left for GC — no explicit unload needed.
   */
  private reloadAllSprites(): void {
    const loader = getCharacterSpriteLoader();

    for (const fighter of this.fighters.values()) {
      if (fighter.gfxId > 0 && fighter.currentAnimName) {
        const animName = fighter.currentAnimName;
        // Force cache miss so applyAnimation accepts the new data
        fighter.currentAnimName = "";
        loader.loadAnimation(fighter.gfxId, animName).then((anim) => {
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
    f.nameText.visible = true;
    this.updateNameBg(f);
    f.nameBg.visible = true;
  }

  /**
   * Hide name tooltip for a fighter.
   */
  hideName(id: number): void {
    const f = this.fighters.get(id);
    if (!f) return;
    f.nameText.visible = false;
    f.nameBg.visible = false;
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
   */
  private updateNamePosition(
    f: ActiveFighter,
    animation: CharacterAnimation,
  ): void {
    const margin = 5;
    // Top of sprite is at offsetY - frameHeight, place name center above it
    const spriteTop = animation.offsetY - animation.frameHeight;
    f.nameText.y = spriteTop - margin - f.nameText.height / 2;
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
    console.log("[FighterRenderer] clear() — removing", this.fighters.size, "fighters");
    for (const fighter of this.fighters.values()) {
      fighter.container.destroy({ children: true });
    }

    this.fighters.clear();
    this.container.removeChildren();
  }

  /**
   * Destroy the renderer.
   */
  destroy(): void {
    Ticker.shared.remove(this.tickerCallback);
    this.clear();
    this.container.destroy();
  }
}
