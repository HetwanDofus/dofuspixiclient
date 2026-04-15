import { AnimatedSprite, Sprite, type Texture } from "pixi.js";

import type { MapScale } from "@/game/datacenter/map";
import type { AtlasLoader } from "@/game/render/atlas-loader";
import type { TileManifest } from "@/game/types";
import { tileZIndex } from "@/game/constants/z-index";
import { normalizeRotation } from "@/game/datacenter/sprite";

/**
 * Flash-era rotation scale magic numbers: non-axis-aligned rotations need to
 * compress along the iso axes to preserve cell dimensions. Derived from the
 * original client's Sprite.as (51.85% and 192.86%).
 */
const ROTATED_SCALE_X = 51.85 / 100;
const ROTATED_SCALE_Y = 192.86 / 100;

/**
 * Creates + positions tile sprites from an AtlasLoader. Stateless across calls
 * beyond a cached texture map (shared with TileLayerBuilder so both use the
 * same cache keys and texture instances).
 */
export class TileSpriteFactory {
  constructor(
    private readonly atlasLoader: AtlasLoader,
    private readonly textureCache: Map<string, Texture>
  ) {}

  /** Static tile — one frame, one texture. Null if not yet cached. */
  createStatic(tileKey: string, frameIndex: number): Sprite | null {
    const zoom = this.atlasLoader.getZoom();
    const cacheKey = `${tileKey}:${zoom}:frame${frameIndex}`;
    const cached = this.textureCache.get(cacheKey);

    if (cached) {
      const sprite = new Sprite(cached);
      sprite.anchor.set(0, 0);
      return sprite;
    }

    const texture = this.atlasLoader.loadFrameSync(tileKey, frameIndex, 1);

    if (!texture) {
      return null;
    }

    const sprite = new Sprite(texture);
    sprite.anchor.set(0, 0);
    this.textureCache.set(cacheKey, texture);
    return sprite;
  }

  /** Animated tile — multi-frame AnimatedSprite with autoplay/loop per manifest. */
  createAnimated(tileKey: string, tile: TileManifest): AnimatedSprite | null {
    const textures = this.atlasLoader.loadAnimationFramesSync(tileKey, 1);

    if (textures.length === 0) {
      return null;
    }

    const sprite = new AnimatedSprite(textures);
    sprite.anchor.set(0, 0);
    sprite.animationSpeed = 1;
    sprite.loop = tile.loop !== false;

    if (tile.autoplay !== false) {
      sprite.play();
    }

    return sprite;
  }

  /**
   * Position a tile sprite using pivot to match Flash's registration point.
   * Rotations 1/3 compress along iso axes (ROTATED_SCALE_X / ROTATED_SCALE_Y).
   */
  position(
    sprite: Sprite,
    tile: TileManifest | null,
    position: { x: number; y: number },
    rotation: number,
    flip: boolean,
    cellId: number,
    mapScale: MapScale,
    layer: number,
    frameIndex = 0
  ): void {
    if (!tile) {
      return;
    }

    const r = normalizeRotation(rotation);
    const frame = tile.frames[frameIndex];
    const trimX = frame?.ox ?? 0;
    const trimY = frame?.oy ?? 0;

    sprite.pivot.set(-(tile.offsetX + trimX), -(tile.offsetY + trimY));

    const globalScale = mapScale.scale;
    sprite.position.set(
      position.x * globalScale + mapScale.offsetX,
      position.y * globalScale + mapScale.offsetY
    );

    sprite.angle = r * 90;

    let scaleX = globalScale;
    let scaleY = globalScale;

    if (r === 1 || r === 3) {
      scaleX *= ROTATED_SCALE_X;
      scaleY *= ROTATED_SCALE_Y;
    }

    if (flip) {
      scaleX *= -1;
    }

    sprite.scale.set(scaleX, scaleY);
    sprite.zIndex = tileZIndex(cellId, layer);
  }
}

/**
 * Compute which frame index a multi-frame tile should show.
 *   - slope behavior: frame = groundSlope - 1 (or 0 if not sloped)
 *   - random behavior: cellId % frameCount (stable per cell, feels varied)
 *   - anything else: frame 0
 */
export function frameIndexForTile(
  tile: TileManifest | null,
  cellId: number,
  groundSlope: number
): number {
  if (!tile || (tile.frameCount ?? 0) <= 1) {
    return 0;
  }

  if (tile.behavior === "slope") {
    return groundSlope > 1 ? groundSlope - 1 : 0;
  }

  if (tile.behavior === "random") {
    return cellId % (tile.frameCount ?? 1);
  }

  return 0;
}
