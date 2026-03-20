import { Assets, Rectangle, Sprite, Texture } from "pixi.js";

import { Direction } from "@/ecs/components";
import { loadSvg } from "@/render/load-svg";

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
  }>;
  frameOrder: string[];
  duplicates: Record<string, string>;
  fps: number;
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
    // Bust the Assets alias cache so re-fetches produce new textures at the
    // new resolution.  We do NOT call Assets.unload (which destroys the
    // TextureSource) because existing sprites still reference those textures
    // until reloadAllSprites swaps them.
    this.loadedAssets.clear();
  }

  private getResolution(): number {
    const dpr = window.devicePixelRatio ?? 1;
    return Math.max(2, Math.ceil(this.currentZoom * dpr));
  }

  /**
   * Load a character animation.
   * Returns cached data if available, otherwise fetches atlas.json + atlas.svg.
   */
  async loadAnimation(
    gfxId: number,
    animName: string
  ): Promise<CharacterAnimation | null> {
    const key = `${gfxId}:${animName}`;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const pendingLoad = this.pending.get(key);
    if (pendingLoad) return pendingLoad;

    const promise = this.doLoadAnimation(gfxId, animName);
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
    direction: number
  ): Promise<{ animation: CharacterAnimation; animName: string } | null> {
    const suffix = getDirectionSuffix(direction);
    const primaryName = `${baseAnim}${suffix}`;

    // Try primary
    const primary = await this.loadAnimation(gfxId, primaryName);
    if (primary) return { animation: primary, animName: primaryName };

    // Try fallbacks
    const fallbacks = SUFFIX_FALLBACKS[suffix] ?? [];
    for (const fb of fallbacks) {
      const fbName = `${baseAnim}${fb}`;
      const result = await this.loadAnimation(gfxId, fbName);
      if (result) return { animation: result, animName: fbName };
    }

    return null;
  }

  /**
   * Get cached animation synchronously. Returns null if not loaded.
   */
  getAnimationSync(gfxId: number, animName: string): CharacterAnimation | null {
    return this.cache.get(`${gfxId}:${animName}`) ?? null;
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

  private async doLoadAnimation(
    gfxId: number,
    animName: string
  ): Promise<CharacterAnimation | null> {
    const atlasPath = `${SPRITES_BASE_PATH}/${gfxId}/${animName}/atlas.json`;

    try {
      const res = await fetch(atlasPath);
      if (!res.ok) return null;

      const atlas: SpriteAtlas = await res.json();

      // Load SVG at zoom-aware resolution for crisp rendering
      const resolution = this.getResolution();
      const alias = `char:${gfxId}:${animName}:${resolution}`;

      let baseTexture: Texture;

      try {
        baseTexture = await loadSvg(
          `${SPRITES_BASE_PATH}/${gfxId}/${animName}/atlas.svg`,
          resolution,
          alias,
        );

        this.loadedAssets.add(alias);
      } catch {
        return null;
      }

      if (!baseTexture?.source) return null;

      // Build frame lookup: frameId → frame data
      const frameLookup = new Map<string, (typeof atlas.frames)[0]>();
      for (const frame of atlas.frames) {
        frameLookup.set(frame.id, frame);
      }

      // Resolve actual scale from loaded texture
      const sourceWidth = baseTexture.source.width;
      const actualScale = sourceWidth / atlas.width;

      // Build texture array following frameOrder with duplicate resolution
      const textures: Texture[] = [];
      for (const frameId of atlas.frameOrder) {
        const resolvedId = atlas.duplicates[frameId] ?? frameId;
        const frame = frameLookup.get(resolvedId);
        if (!frame) continue;

        const fx = Math.round(frame.x * actualScale);
        const fy = Math.round(frame.y * actualScale);
        const fw = Math.round(frame.width * actualScale);
        const fh = Math.round(frame.height * actualScale);

        if (fw <= 0 || fh <= 0) continue;

        const texture = new Texture({
          source: baseTexture.source,
          frame: new Rectangle(fx, fy, fw, fh),
        });
        textures.push(texture);
      }

      if (textures.length === 0) return null;

      const firstFrame = atlas.frames[0];
      // Account for frame trim offset: the atlas-level offset is relative to SVG origin,
      // but the frame texture starts at (frame.offsetX, frame.offsetY) in SVG space.
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

      const key = `${gfxId}:${animName}`;
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
    sprite.anchor.set(0, 1); // Bottom-left anchor (feet at position)
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

    for (const alias of this.loadedAssets) {
      Assets.unload(alias);
    }
    this.loadedAssets.clear();
  }
}

/**
 * Global singleton instance.
 */
let globalLoader: CharacterSpriteLoader | null = null;

export function getCharacterSpriteLoader(): CharacterSpriteLoader {
  if (!globalLoader) {
    globalLoader = new CharacterSpriteLoader();
  }
  return globalLoader;
}
