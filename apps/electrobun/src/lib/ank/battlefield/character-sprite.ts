import type { VelloRenderer } from "vello-wasm";
import {
  Assets,
  ExternalSource,
  Rectangle,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import type { VelloFrameResult } from "@/render/vello-loader";
import { Direction } from "@/ecs/components";
import { FrameAtlas } from "@/render/frame-atlas";
import { loadSvg } from "@/render/load-svg";

import { parseLook } from "./look-parser";

/**
 * Atlas JSON format for character sprite animations.
 */
interface SpriteAtlas {
  animation: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frames: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    /** For multi-page atlases: index into pages[]. Absent = page 0. */
    page?: number;
  }>;
  frameOrder: string[];
  duplicates: Record<string, string>;
  fps: number;
  /** Multi-page atlas: SVG files with their dimensions. Absent = single atlas.svg. */
  pages?: Array<{ file: string; width: number; height: number }>;
}

/**
 * Loaded character animation data.
 */
export interface CharacterAnimation {
  /** Frame textures in playback order (frameOrder resolved with duplicates) */
  textures: Texture[];
  /** Playback FPS */
  fps: number;
  /** World-space X offset for sprite placement */
  offsetX: number;
  /** World-space Y offset for sprite placement */
  offsetY: number;
  /** Width of a single frame */
  frameWidth: number;
  /** Height of a single frame */
  frameHeight: number;
  /** Real frame count (for atlas mode where textures.length=1 but animation has many frames) */
  frameCount?: number;
  /** Lazily render frame N on first access (Vello only). Returns the real texture. */
  resolveFrame?: (index: number) => Texture | null;
  /** Zone colors [color1, color2, color3] for GPU HSL replacement (Vello shared textures). */
  zoneColors?: number[];
  /** Per-frame zone mask textures (parallel to textures[], same frame rects). */
  zoneMaskTextures?: Texture[];
}

/**
 * Direction suffix mapping (from original ank.battlefield.mc.Sprite.setAnim).
 *
 * Maps the 8 game directions to sprite animation suffixes:
 * R = right, L = left, F = front (towards camera), B = back, S = south-east (default Dofus view)
 *
 * Directions 3 (SW), 4 (W), 7 (NE) reuse mirrored suffixes with horizontal flip.
 */
const DIRECTION_SUFFIX: Record<number, string> = {
  [Direction.EAST]: "S",
  [Direction.SOUTH_EAST]: "R",
  [Direction.SOUTH]: "F",
  [Direction.SOUTH_WEST]: "R", // flipped
  [Direction.WEST]: "S", // flipped
  [Direction.NORTH_WEST]: "L",
  [Direction.NORTH]: "B",
  [Direction.NORTH_EAST]: "L", // flipped
};

/**
 * Whether a direction requires horizontal flip (xscale = -100 in original).
 */
const DIRECTION_FLIP: Record<number, boolean> = {
  [Direction.EAST]: false,
  [Direction.SOUTH_EAST]: false,
  [Direction.SOUTH]: false,
  [Direction.SOUTH_WEST]: true,
  [Direction.WEST]: true,
  [Direction.NORTH_WEST]: false,
  [Direction.NORTH]: false,
  [Direction.NORTH_EAST]: true,
};

/**
 * Fallback chain when an animation+direction variant doesn't exist.
 * e.g., if "walkS" doesn't exist, try "walkR", then "walkF".
 */
const SUFFIX_FALLBACKS: Record<string, string[]> = {
  S: ["R", "F"],
  R: ["S", "F"],
  L: ["S", "F"],
  F: ["S", "R"],
  B: ["S", "L"],
};

const SPRITES_BASE_PATH = "/assets/spritesheets/sprites";
const CHEVAUCHORS_BASE_PATH = "/assets/spritesheets/chevauchors";
/** Offset added to chevauchor gfxIds to avoid collision with regular sprite IDs */
const CHEVAUCHOR_ID_OFFSET = 1_000_000;

/**
 * Get the animation name for a given base animation and direction.
 */
export function getAnimationName(baseAnim: string, direction: number): string {
  const suffix = DIRECTION_SUFFIX[direction] ?? "S";
  return `${baseAnim}${suffix}`;
}

/**
 * Get the direction suffix for a game direction value.
 */
export function getDirectionSuffix(direction: number): string {
  return DIRECTION_SUFFIX[direction] ?? "S";
}

/**
 * Check if a direction requires horizontal flipping.
 */
export function isDirectionFlipped(direction: number): boolean {
  return DIRECTION_FLIP[direction] ?? false;
}

/**
 * Character sprite loader.
 * Loads and caches SVG atlas sprite animations for character rendering.
 */
export class CharacterSpriteLoader {
  /** Cache: "gfxId:animName" → animation data */
  private cache = new Map<string, CharacterAnimation>();
  /** Pending loads for deduplication */
  private pending = new Map<string, Promise<CharacterAnimation | null>>();
  /** Track loaded SVG asset aliases for cleanup */
  private loadedAssets = new Set<string>();
  /** Manifest cache: gfxId → available animation names */
  private manifestCache = new Map<number, Set<string>>();
  /** Pending manifest loads */
  private pendingManifests = new Map<number, Promise<Set<string> | null>>();
  /** Current zoom level for SVG rasterization */
  private currentZoom = 1;
  /** Vello WASM renderer (null = SVG fallback) */
  private _vello: VelloRenderer | null = null;
  /** Pixi.js renderer for ExternalSource */
  private _pixiRenderer: Renderer | null = null;
  /** Dynamic atlas — all character frames packed into ONE GPU texture */
  private _atlas: FrameAtlas | null = null;
  /** Vello asset IDs loaded, keyed by gfxId */
  private velloAssetIds = new Map<number, number>();
  /** Pending .dofasset loads */
  private pendingDofassetLoads = new Map<number, Promise<boolean>>();
  /** Auto-incrementing Vello asset ID */
  private nextVelloAssetId = 100000; // high range to avoid tile ID conflicts
  /** Track Vello texture IDs for cleanup */
  private velloTextureIds: number[] = [];
  /** Loaded accessory .dofasset asset IDs, keyed by "type:gfxId" → vello asset ID (or -1 if failed) */
  private accessoryAssetIds = new Map<string, number>();
  /** Pending accessory .dofasset loads */
  private pendingAccessoryLoads = new Map<string, Promise<number | null>>();

  /** Max GPU texture dimension — set from Vello init */
  private _maxTextureSize = 8192;

  /** Throttle strip rendering: max N per frame, yield between batches */
  private static _stripQueue: (() => void)[] = [];
  private static _stripActive = 0;
  private static readonly STRIPS_PER_FRAME = 10;
  private static _stripThrottle(): Promise<void> {
    if (
      CharacterSpriteLoader._stripActive <
      CharacterSpriteLoader.STRIPS_PER_FRAME
    ) {
      CharacterSpriteLoader._stripActive++;
      // Schedule reset at end of current microtask batch
      if (CharacterSpriteLoader._stripActive === 1) {
        requestAnimationFrame(() => {
          CharacterSpriteLoader._stripActive = 0;
          CharacterSpriteLoader._drainStripQueue();
        });
      }
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      CharacterSpriteLoader._stripQueue.push(resolve);
    });
  }
  private static _drainStripQueue(): void {
    const batch = CharacterSpriteLoader._stripQueue.splice(
      0,
      CharacterSpriteLoader.STRIPS_PER_FRAME
    );
    if (batch.length > 0) {
      CharacterSpriteLoader._stripActive = batch.length;
      for (const resolve of batch) resolve();
      requestAnimationFrame(() => {
        CharacterSpriteLoader._stripActive = 0;
        CharacterSpriteLoader._drainStripQueue();
      });
    }
  }

  setVelloRenderer(
    vello: VelloRenderer,
    pixiRenderer: Renderer,
    maxTextureSize?: number
  ): void {
    this._vello = vello;
    this._pixiRenderer = pixiRenderer;
    if (maxTextureSize) this._maxTextureSize = maxTextureSize;
    const resolution = this.getResolution();
    this._atlas = new FrameAtlas(
      vello,
      pixiRenderer,
      resolution,
      this._maxTextureSize
    );
    const ok = this._atlas.init();
    if (!ok) {
      console.error(
        "[CharacterSprite] FrameAtlas.init() FAILED — falling back to SVG"
      );
      this._atlas = null;
    } else {
      console.log(
        `[CharacterSprite] FrameAtlas ready (resolution=${resolution.toFixed(2)})`
      );
    }
  }

  /** Get the frame atlas (for tick advancement from the render loop) */
  getAtlas(): FrameAtlas | null {
    return this._atlas;
  }

  /**
   * Set zoom level. Clears the animation cache so new loads rasterize at the
   * updated resolution. Old textures are NOT destroyed — PixiJS will GC them
   * once no sprite references them. We only need to bust the PixiJS Assets
   * alias cache so the next `loadSvg` call re-rasterizes the SVG.
   */
  setZoom(zoom: number): void {
    if (Math.abs(zoom - this.currentZoom) < 0.001) return;
    this.currentZoom = zoom;
    this.cache.clear();
    this.pending.clear();
    // Recreate atlas at new resolution — cached frames are stale
    if (this._vello && this._pixiRenderer) {
      const resolution = this.getResolution();
      this._atlas = new FrameAtlas(
        this._vello,
        this._pixiRenderer,
        resolution,
        this._maxTextureSize
      );
      this._atlas.init();
    }
    // Bust the Assets alias cache so re-fetches produce new textures at the
    // new resolution.  We do NOT call Assets.unload (which destroys the
    // TextureSource) because existing sprites still reference those textures
    // until reloadAllSprites swaps them.
    this.loadedAssets.clear();
  }

  private getResolution(): number {
    // Render at zoom * devicePixelRatio for crisp sprites at any zoom level.
    // Frames are arranged in a 2D grid to stay within GPU texture limits.
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return Math.max(1, this.currentZoom * dpr);
  }

  /**
   * Load a character animation.
   * Returns cached data if available, otherwise fetches atlas.json + atlas.svg.
   * If `look` is provided, the middleware composes the SVG with accessories and colors.
   */
  async loadAnimation(
    gfxId: number,
    animName: string,
    look?: string
  ): Promise<CharacterAnimation | null> {
    const key = look ? `${gfxId}:${animName}:${look}` : `${gfxId}:${animName}`;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const pendingLoad = this.pending.get(key);
    if (pendingLoad) return pendingLoad;

    const promise = this.doLoadAnimation(gfxId, animName, look);
    this.pending.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * Load animation with direction fallbacks.
   * Tries the requested animation+direction, then falls back to alternative directions.
   */
  async loadAnimationWithFallback(
    gfxId: number,
    baseAnim: string,
    direction: number,
    look?: string
  ): Promise<{ animation: CharacterAnimation; animName: string } | null> {
    const suffix = getDirectionSuffix(direction);
    const primaryName = `${baseAnim}${suffix}`;

    // Try primary
    const primary = await this.loadAnimation(gfxId, primaryName, look);
    if (primary) return { animation: primary, animName: primaryName };

    // Try fallbacks
    const fallbacks = SUFFIX_FALLBACKS[suffix] ?? [];
    for (const fb of fallbacks) {
      const fbName = `${baseAnim}${fb}`;
      const result = await this.loadAnimation(gfxId, fbName, look);
      if (result) return { animation: result, animName: fbName };
    }

    return null;
  }

  /**
   * Get cached animation synchronously. Returns null if not loaded.
   */
  getAnimationSync(
    gfxId: number,
    animName: string,
    look?: string
  ): CharacterAnimation | null {
    const key = look ? `${gfxId}:${animName}:${look}` : `${gfxId}:${animName}`;
    return this.cache.get(key) ?? null;
  }

  /**
   * Load the sprite manifest to know which animations are available.
   */
  async loadManifest(gfxId: number): Promise<Set<string> | null> {
    const cached = this.manifestCache.get(gfxId);
    if (cached) return cached;

    const pendingLoad = this.pendingManifests.get(gfxId);
    if (pendingLoad) return pendingLoad;

    const promise = this.doLoadManifest(gfxId);
    this.pendingManifests.set(gfxId, promise);

    try {
      return await promise;
    } finally {
      this.pendingManifests.delete(gfxId);
    }
  }

  private async doLoadManifest(gfxId: number): Promise<Set<string> | null> {
    try {
      const res = await fetch(`${SPRITES_BASE_PATH}/${gfxId}/manifest.json`);
      if (!res.ok) return null;
      const data = await res.json();
      const names = new Set<string>(Object.keys(data.animations ?? {}));
      this.manifestCache.set(gfxId, names);
      return names;
    } catch {
      return null;
    }
  }

  /** Load .dofasset for a sprite into Vello */
  private async loadDofasset(gfxId: number): Promise<boolean> {
    if (this.velloAssetIds.has(gfxId)) return true;
    if (this.pendingDofassetLoads.has(gfxId))
      return this.pendingDofassetLoads.get(gfxId)!;

    const isChevauchor = gfxId >= CHEVAUCHOR_ID_OFFSET;
    const realId = isChevauchor ? gfxId - CHEVAUCHOR_ID_OFFSET : gfxId;
    const basePath = isChevauchor ? CHEVAUCHORS_BASE_PATH : SPRITES_BASE_PATH;

    const promise = (async () => {
      try {
        const res = await fetch(`${basePath}/${realId}.dofasset`);
        if (!res.ok) return false;
        const data = new Uint8Array(await res.arrayBuffer());
        const id = this.nextVelloAssetId++;
        this._vello!.loadAsset(id, data);
        this.velloAssetIds.set(gfxId, id);
        return true;
      } catch {
        return false;
      }
    })();

    this.pendingDofassetLoads.set(gfxId, promise);
    try {
      return await promise;
    } finally {
      this.pendingDofassetLoads.delete(gfxId);
    }
  }

  /**
   * Load an accessory .dofasset into Vello. Returns the Vello asset ID.
   * Accessories are compiled from /accessories/{type}_{gfxId}/ SVG frames
   * and stored as acc_{type}_{gfxId}.dofasset in the sprites directory.
   * Their animations are named by direction suffix (R, L, F, B, S).
   */
  private async loadAccessoryAsset(
    type: number,
    gfxId: number
  ): Promise<number | null> {
    if (!this._vello || gfxId === 0) return null;

    const key = `${type}:${gfxId}`;
    const cached = this.accessoryAssetIds.get(key);
    if (cached !== undefined) return cached === -1 ? null : cached;

    const pending = this.pendingAccessoryLoads.get(key);
    if (pending) return pending;

    const promise = (async (): Promise<number | null> => {
      try {
        // Load accessory-specific .dofasset (compiled from /accessories/{type}_{gfxId}/)
        const res = await fetch(
          `${SPRITES_BASE_PATH}/acc_${type}_${gfxId}.dofasset`
        );
        if (!res.ok) {
          this.accessoryAssetIds.set(key, -1); // Cache failure
          return null;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        const id = this.nextVelloAssetId++;
        const ok = this._vello!.loadAsset(id, data);
        if (!ok) {
          this.accessoryAssetIds.set(key, -1); // Cache failure
          return null;
        }
        this.accessoryAssetIds.set(key, id);
        return id;
      } catch {
        this.accessoryAssetIds.set(key, -1); // Cache failure
        return null;
      }
    })();

    this.pendingAccessoryLoads.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingAccessoryLoads.delete(key);
    }
  }

  /**
   * Load all accessories from a parsed look and return flat acc_info array
   * for the WASM renderFrame API: [asset_id, slot_id, asset_id, slot_id, ...]
   */
  private async loadAccessories(
    accessories: import("./look-parser").AccessoryInfo[]
  ): Promise<number[] | undefined> {
    const accInfo: number[] = [];
    const promises = accessories.map(async (acc, index) => {
      if (acc.gfxId === 0) return;
      const assetId = await this.loadAccessoryAsset(acc.type, acc.gfxId);
      if (assetId != null) {
        // slot_id = array index (0-4), matching .dofasset AccessorySlot.slotId (0-indexed)
        accInfo.push(assetId, index);
      }
    });
    await Promise.all(promises);
    return accInfo.length > 0 ? accInfo : undefined;
  }

  private async doLoadAnimation(
    gfxId: number,
    animName: string,
    look?: string
  ): Promise<CharacterAnimation | null> {
    // Vello path: per-frame caching in shared atlas texture.
    // Each unique visual state (sprite+anim+frame+colors+acc) gets one slot.
    // Multiple characters share slots → after warmup, zero Vello renders.
    if (this._vello && this._pixiRenderer && this._atlas) {
      const parsed = look ? parseLook(look) : null;
      const loaded = await this.loadDofasset(gfxId);
      if (loaded) {
        const velloAssetId = this.velloAssetIds.get(gfxId)!;
        const animInfo = this._vello.getAnimationInfo(
          velloAssetId,
          animName
        ) as {
          fps: number;
          frameCount: number;
          offsetX: number;
          offsetY: number;
          trimX: number;
          trimY: number;
          frameWidth: number;
          frameHeight: number;
        } | null;
        if (animInfo && animInfo.frameCount > 0) {
          const colors: [number, number, number] | null =
            parsed &&
            (parsed.color1 >= 0 || parsed.color2 >= 0 || parsed.color3 >= 0)
              ? [
                  parsed.color1 >= 0 ? parsed.color1 : 0,
                  parsed.color2 >= 0 ? parsed.color2 : 0,
                  parsed.color3 >= 0 ? parsed.color3 : 0,
                ]
              : null;

          // Load accessories from parsed look data
          const accInfo: number[] | undefined = parsed?.accessories.length
            ? await this.loadAccessories(parsed.accessories)
            : undefined;

          // Render ALL frames as a strip texture. Throttle to avoid frame drops
          // when many characters load simultaneously (stress test).
          await CharacterSpriteLoader._stripThrottle();
          const colorsArg = colors
            ? [colors[0], colors[1], colors[2]]
            : undefined;
          const stripResult = this._vello.renderAnimationStrip(
            velloAssetId,
            animName,
            this.getResolution(),
            colorsArg,
            accInfo
          ) as {
            texture: GPUTexture;
            textureId: number;
            width: number;
            height: number;
            frameWidth: number;
            frameHeight: number;
            frameCount: number;
            gridCols?: number;
            boundsOffsetX?: number;
            boundsOffsetY?: number;
            anchorX?: number;
            anchorY?: number;
          } | null;

          if (stripResult) {
            const res = this.getResolution();
            const stripSource = new ExternalSource({
              resource: stripResult.texture,
              renderer: this._pixiRenderer!,
              width: stripResult.width,
              height: stripResult.height,
              label: `strip-${gfxId}-${animName}`,
            });
            stripSource.alphaMode = "no-premultiply-alpha";
            stripSource.format = "rgba8unorm";
            stripSource.resolution = res;
            stripSource.autoGarbageCollect = false;

            const fw = stripResult.frameWidth / res;
            const fh = stripResult.frameHeight / res;
            const cols = stripResult.gridCols || stripResult.frameCount;
            const frameTextures: Texture[] = [];
            for (let i = 0; i < stripResult.frameCount; i++) {
              const col = i % cols;
              const row = Math.floor(i / cols);
              frameTextures.push(
                new Texture({
                  source: stripSource,
                  frame: new Rectangle(col * fw, row * fh, fw, fh),
                })
              );
            }

            // Use the strip's pre-computed anchor when available (tight bounds).
            // Falls back to the old offset computation for compatibility.
            let offX: number;
            let offY: number;
            if (stripResult.anchorX != null && stripResult.anchorY != null) {
              offX = -(stripResult.anchorX / res);
              offY = -(stripResult.anchorY / res);
            } else {
              const bOffX = (stripResult.boundsOffsetX ?? 0) / res;
              const bOffY = (stripResult.boundsOffsetY ?? 0) / res;
              offX = animInfo.offsetX + animInfo.trimX - bOffX;
              offY = animInfo.offsetY + animInfo.trimY - bOffY;
            }

            const animation: CharacterAnimation = {
              textures: frameTextures,
              frameCount: stripResult.frameCount,
              fps: animInfo.fps || 25,
              offsetX: offX,
              offsetY: offY,
              frameWidth: animInfo.frameWidth,
              frameHeight: animInfo.frameHeight,
            };

            const cacheKey = look
              ? `${gfxId}:${animName}:${look}`
              : `${gfxId}:${animName}`;
            this.cache.set(cacheKey, animation);
            return animation;
          }
        }
      }
      // Fall through to SVG if Vello fails
    }

    // SVG path (fallback)
    const atlasPath = `${SPRITES_BASE_PATH}/${gfxId}/${animName}/atlas.json`;

    try {
      const res = await fetch(atlasPath);
      if (!res.ok) return null;
      const atlas: SpriteAtlas = await res.json();

      // SVG rendering path
      const resolution = this.getResolution();
      const baseSvgPath = `${SPRITES_BASE_PATH}/${gfxId}/${animName}`;
      const lookSuffix = look ? `:${look}` : "";

      let pageTextures: Texture[];

      try {
        if (atlas.pages && atlas.pages.length > 1) {
          pageTextures = await Promise.all(
            atlas.pages.map(async (page, i) => {
              const alias = `char:${gfxId}:${animName}:${i}:${resolution}${lookSuffix}`;
              const texture = await loadSvg(
                `${baseSvgPath}/${page.file}`,
                resolution,
                alias,
                look
              );
              this.loadedAssets.add(alias);
              return texture;
            })
          );
        } else {
          const alias = `char:${gfxId}:${animName}:${resolution}${lookSuffix}`;
          const texture = await loadSvg(
            `${baseSvgPath}/atlas.svg`,
            resolution,
            alias,
            look
          );
          this.loadedAssets.add(alias);
          pageTextures = [texture];
        }
      } catch (e) {
        console.error("[CharacterSprite] SVG load failed for", animName, e);
        return null;
      }

      if (pageTextures.length === 0 || !pageTextures[0]?.source) return null;

      const frameLookup = new Map<string, (typeof atlas.frames)[0]>();
      for (const frame of atlas.frames) {
        frameLookup.set(frame.id, frame);
      }

      const pageScales: number[] = pageTextures.map((tex, i) => {
        const pageWidth = atlas.pages?.[i]?.width ?? atlas.width;
        return tex.source.width / pageWidth;
      });

      const textures: Texture[] = [];
      for (const frameId of atlas.frameOrder) {
        const resolvedId = atlas.duplicates[frameId] ?? frameId;
        const frame = frameLookup.get(resolvedId);
        if (!frame) continue;

        const pageIndex = frame.page ?? 0;
        const pageTex = pageTextures[pageIndex];
        if (!pageTex?.source) continue;

        const actualScale = pageScales[pageIndex];
        const fx = Math.round(frame.x * actualScale);
        const fy = Math.round(frame.y * actualScale);
        const fw = Math.round(frame.width * actualScale);
        const fh = Math.round(frame.height * actualScale);

        if (fw <= 0 || fh <= 0) continue;

        const texture = new Texture({
          source: pageTex.source,
          frame: new Rectangle(fx, fy, fw, fh),
        });
        textures.push(texture);
      }

      if (textures.length === 0) return null;

      const firstFrame = atlas.frames[0];
      const trimX = firstFrame?.offsetX ?? 0;
      const trimY = firstFrame?.offsetY ?? 0;
      const animation: CharacterAnimation = {
        textures,
        fps: atlas.fps || 30,
        offsetX: (atlas.offsetX ?? 0) + trimX,
        offsetY: (atlas.offsetY ?? 0) + trimY,
        frameWidth: firstFrame?.width ?? 0,
        frameHeight: firstFrame?.height ?? 0,
      };

      const key = look
        ? `${gfxId}:${animName}:${look}`
        : `${gfxId}:${animName}`;
      this.cache.set(key, animation);
      return animation;
    } catch {
      return null;
    }
  }

  /**
   * Create a PixiJS Sprite configured for a character animation frame.
   * Anchored at bottom-left so that the sprite's feet align with position.
   */
  createSprite(animation: CharacterAnimation, frameIndex = 0): Sprite {
    const texture = animation.textures[frameIndex % animation.textures.length];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0); // Top-left anchor; offset positions feet at (0,0)
    sprite.x = animation.offsetX;
    sprite.y = animation.offsetY;
    return sprite;
  }

  /**
   * Clear all cached data.
   */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
    this.manifestCache.clear();
    this._atlas?.clear();
    this.accessoryAssetIds.clear();

    for (const alias of this.loadedAssets) {
      Assets.unload(alias);
    }
    this.loadedAssets.clear();
  }
}

/**
 * Legacy global singleton instance for backward compatibility.
 * Deprecated: pass CharacterSpriteLoader as a dependency instead.
 */
let globalLoader: CharacterSpriteLoader | null = null;

export function getCharacterSpriteLoader(): CharacterSpriteLoader {
  if (!globalLoader) {
    globalLoader = new CharacterSpriteLoader();
  }
  return globalLoader;
}

/**
 * Initialize the global sprite loader instance.
 * Call this once during app initialization.
 */
export function initCharacterSpriteLoader(): CharacterSpriteLoader {
  if (!globalLoader) {
    globalLoader = new CharacterSpriteLoader();
  }
  return globalLoader;
}
