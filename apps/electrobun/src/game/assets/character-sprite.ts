import type { VelloRenderer } from "vello-wasm";
import {
  ExternalSource,
  Rectangle,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { parseLook } from "@/game/assets/look-parser";
import { acquireStripSlot } from "@/game/assets/strip-throttle";
import { VelloAssetRegistry } from "@/game/assets/vello-asset-registry";
import { Direction } from "@/game/fight/types";
import { FrameAtlas } from "@/game/render/frame-atlas";

export interface CharacterAnimation {
  textures: Texture[];
  fps: number;
  offsetX: number;
  offsetY: number;
  frameWidth: number;
  frameHeight: number;
  frameCount?: number;
  resolveFrame?: (index: number) => Texture | null;
  zoneColors?: number[];
  zoneMaskTextures?: Texture[];
}

// R = right, L = left, F = front, B = back, S = south-east (default Dofus view).
// Directions 3 (SW), 4 (W), 7 (NE) reuse mirrored suffixes with horizontal flip.
const DIRECTION_SUFFIX: Record<number, string> = {
  [Direction.EAST]: "S",
  [Direction.SOUTH_EAST]: "R",
  [Direction.SOUTH]: "F",
  [Direction.SOUTH_WEST]: "R",
  [Direction.WEST]: "S",
  [Direction.NORTH_WEST]: "L",
  [Direction.NORTH]: "B",
  [Direction.NORTH_EAST]: "L",
};

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

// Fallback chain when an animation+direction variant doesn't exist.
const SUFFIX_FALLBACKS: Record<string, string[]> = {
  S: ["R", "F"],
  R: ["S", "F"],
  L: ["S", "F"],
  F: ["S", "R"],
  B: ["S", "L"],
};

export function getAnimationName(baseAnim: string, direction: number): string {
  const suffix = DIRECTION_SUFFIX[direction] ?? "S";
  return `${baseAnim}${suffix}`;
}

export function getDirectionSuffix(direction: number): string {
  return DIRECTION_SUFFIX[direction] ?? "S";
}

export function isDirectionFlipped(direction: number): boolean {
  return DIRECTION_FLIP[direction] ?? false;
}

interface VelloStripResult {
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
}

interface VelloAnimInfo {
  fps: number;
  frameCount: number;
  offsetX: number;
  offsetY: number;
  trimX: number;
  trimY: number;
  frameWidth: number;
  frameHeight: number;
}

export class CharacterSpriteLoader {
  private cache = new Map<string, CharacterAnimation>();
  private pending = new Map<string, Promise<CharacterAnimation | null>>();
  private currentZoom = 1;
  private vello: VelloRenderer | null = null;
  private pixiRenderer: Renderer | null = null;
  private atlas: FrameAtlas | null = null;
  private readonly assets = new VelloAssetRegistry();
  private maxTextureSize = 8192;

  setVelloRenderer(
    vello: VelloRenderer,
    pixiRenderer: Renderer,
    maxTextureSize?: number
  ): void {
    this.vello = vello;
    this.pixiRenderer = pixiRenderer;
    this.assets.setVelloRenderer(vello);

    if (maxTextureSize) {
      this.maxTextureSize = maxTextureSize;
    }

    const resolution = this.getResolution();
    this.atlas = new FrameAtlas(
      vello,
      pixiRenderer,
      resolution,
      this.maxTextureSize
    );

    if (!this.atlas.init()) {
      console.error("[CharacterSprite] FrameAtlas.init() FAILED");
      this.atlas = null;
    }
  }

  getAtlas(): FrameAtlas | null {
    return this.atlas;
  }

  /**
   * Clears the animation cache so new loads rasterize at the updated resolution.
   * Old textures are NOT destroyed — PixiJS GCs them once no sprite references them.
   */
  setZoom(zoom: number): void {
    if (Math.abs(zoom - this.currentZoom) < 0.001) {
      return;
    }

    this.currentZoom = zoom;
    this.cache.clear();
    this.pending.clear();

    if (this.vello && this.pixiRenderer) {
      const resolution = this.getResolution();
      this.atlas = new FrameAtlas(
        this.vello,
        this.pixiRenderer,
        resolution,
        this.maxTextureSize
      );
      this.atlas.init();
    }
  }

  private getResolution(): number {
    return Math.max(1, this.currentZoom);
  }

  async loadAnimation(
    gfxId: number,
    animName: string,
    look?: string
  ): Promise<CharacterAnimation | null> {
    const key = cacheKey(gfxId, animName, look);
    const cached = this.cache.get(key);

    if (cached) {
      return cached;
    }

    const pendingLoad = this.pending.get(key);

    if (pendingLoad) {
      return pendingLoad;
    }

    const promise = this.doLoadAnimation(gfxId, animName, look);
    this.pending.set(key, promise);

    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }

  /** Try the requested animation+direction, then direction fallbacks. */
  async loadAnimationWithFallback(
    gfxId: number,
    baseAnim: string,
    direction: number,
    look?: string
  ): Promise<{ animation: CharacterAnimation; animName: string } | null> {
    const suffix = getDirectionSuffix(direction);
    const primaryName = `${baseAnim}${suffix}`;

    const primary = await this.loadAnimation(gfxId, primaryName, look);

    if (primary) {
      return { animation: primary, animName: primaryName };
    }

    for (const fb of SUFFIX_FALLBACKS[suffix] ?? []) {
      const fbName = `${baseAnim}${fb}`;
      const result = await this.loadAnimation(gfxId, fbName, look);

      if (result) {
        return { animation: result, animName: fbName };
      }
    }

    return null;
  }

  getAnimationSync(
    gfxId: number,
    animName: string,
    look?: string
  ): CharacterAnimation | null {
    return this.cache.get(cacheKey(gfxId, animName, look)) ?? null;
  }

  private async doLoadAnimation(
    gfxId: number,
    animName: string,
    look?: string
  ): Promise<CharacterAnimation | null> {
    if (!this.vello || !this.pixiRenderer || !this.atlas) {
      return null;
    }

    const loaded = await this.assets.loadSprite(gfxId);
    const velloAssetId = this.assets.getSpriteAssetId(gfxId);

    if (!loaded || velloAssetId === undefined) {
      return null;
    }

    const animInfo = this.vello.getAnimationInfo(
      velloAssetId,
      animName
    ) as VelloAnimInfo | null;

    if (!animInfo || animInfo.frameCount <= 0) {
      return null;
    }

    const parsed = look ? parseLook(look) : null;
    const colorsArg = buildColorsArg(parsed);
    const accInfoArg = parsed?.accessories.length
      ? await this.assets
          .loadAccessoriesForLook(parsed.accessories)
          .then((a) => (a ? new Uint32Array(a) : undefined))
      : undefined;

    await acquireStripSlot();

    const stripResult = this.vello.renderAnimationStrip(
      velloAssetId,
      animName,
      this.getResolution(),
      colorsArg,
      accInfoArg
    ) as VelloStripResult | null;

    if (!stripResult) {
      return null;
    }

    const animation = this.buildAnimation(
      stripResult,
      animInfo,
      gfxId,
      animName
    );

    this.cache.set(cacheKey(gfxId, animName, look), animation);
    return animation;
  }

  private buildAnimation(
    strip: VelloStripResult,
    animInfo: VelloAnimInfo,
    gfxId: number,
    animName: string
  ): CharacterAnimation {
    const renderer = this.pixiRenderer;

    if (!renderer) {
      throw new Error("buildAnimation called without a Pixi renderer");
    }

    const res = this.getResolution();
    const stripSource = new ExternalSource({
      resource: strip.texture,
      renderer,
      width: strip.width,
      height: strip.height,
      label: `strip-${gfxId}-${animName}`,
    });
    stripSource.alphaMode = "no-premultiply-alpha";
    stripSource.format = "rgba8unorm";
    stripSource.resolution = res;
    stripSource.autoGarbageCollect = false;

    const fw = strip.frameWidth / res;
    const fh = strip.frameHeight / res;
    const cols = strip.gridCols || strip.frameCount;
    const frameTextures: Texture[] = [];

    for (let i = 0; i < strip.frameCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      frameTextures.push(
        new Texture({
          source: stripSource,
          frame: new Rectangle(col * fw, row * fh, fw, fh),
        })
      );
    }

    // Prefer the strip's pre-computed anchor (tight bounds); otherwise derive from offset + trim.
    const [offX, offY] =
      strip.anchorX != null && strip.anchorY != null
        ? [-(strip.anchorX / res), -(strip.anchorY / res)]
        : [
            animInfo.offsetX +
              animInfo.trimX -
              (strip.boundsOffsetX ?? 0) / res,
            animInfo.offsetY +
              animInfo.trimY -
              (strip.boundsOffsetY ?? 0) / res,
          ];

    return {
      textures: frameTextures,
      frameCount: strip.frameCount,
      fps: animInfo.fps || 25,
      offsetX: offX,
      offsetY: offY,
      frameWidth: animInfo.frameWidth,
      frameHeight: animInfo.frameHeight,
    };
  }

  /** Top-left anchored; offset positions feet at (0,0). */
  createSprite(animation: CharacterAnimation, frameIndex = 0): Sprite {
    const texture = animation.textures[frameIndex % animation.textures.length];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0);
    sprite.x = animation.offsetX;
    sprite.y = animation.offsetY;
    return sprite;
  }

  clear(): void {
    this.cache.clear();
    this.pending.clear();
    this.atlas?.clear();
    this.assets.clear();
  }
}

function cacheKey(gfxId: number, animName: string, look?: string): string {
  return look ? `${gfxId}:${animName}:${look}` : `${gfxId}:${animName}`;
}

function buildColorsArg(
  parsed: ReturnType<typeof parseLook> | null
): Uint32Array | undefined {
  if (
    !parsed ||
    (parsed.color1 < 0 && parsed.color2 < 0 && parsed.color3 < 0)
  ) {
    return undefined;
  }

  return new Uint32Array([
    parsed.color1 >= 0 ? parsed.color1 : 0,
    parsed.color2 >= 0 ? parsed.color2 : 0,
    parsed.color3 >= 0 ? parsed.color3 : 0,
  ]);
}

let globalLoader: CharacterSpriteLoader | null = null;

export function getCharacterSpriteLoader(): CharacterSpriteLoader {
  if (!globalLoader) {
    globalLoader = new CharacterSpriteLoader();
  }

  return globalLoader;
}

export function initCharacterSpriteLoader(): CharacterSpriteLoader {
  if (!globalLoader) {
    globalLoader = new CharacterSpriteLoader();
  }

  return globalLoader;
}
