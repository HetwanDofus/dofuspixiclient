/**
 * TileSpriteRenderer — per-tile Pixi sprites for ground (layer 0) +
 * object1 (layer 1) tiles. Replaces `TileLayerRenderer`'s per-tick
 * Vello surface dispatch.
 *
 * Design (mirrors `apps/electrobun/src/window/mainview/stress-worker.ts:974-1003`):
 *   - Per visible tile placement, mount one Pixi `Sprite` in the
 *     destination layer container (groundLayer for layer=0,
 *     object1Layer for layer=1).
 *   - On placement add: `renderSwfFrame(bundle, exportName, frame,
 *     MAP_BG_ZOOM)` → wrap result GPUTexture as `ExternalSource` →
 *     point sprite.texture at it.
 *   - Animated tiles tick a per-tile accumulator; on advance,
 *     re-render the next frame and pair `oldSource.destroy()` with
 *     `freeRenderTexture(oldTextureId)` after a 2-tick settle.
 *   - Static tiles render once at `staticFrame` and never change.
 *
 * Animated-tile cardinality on a Dofus map is small (~10-30 unique
 * animated tiles per map), so per-tile per-frame on-demand keeps GPU
 * load bounded — the same reason the stress test uses this approach.
 */
import {
  ExternalSource,
  type Container,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { ROT_SCALE_X, ROT_SCALE_Y } from "@/game/constants/battlefield";
import {
  freeRenderTexture,
  renderSwfFrame,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

/**
 * One renderable tile occurrence. MapHandler emits one per (cell,
 * layer) entry with a non-zero tile id; TileSpriteRenderer creates
 * one Pixi sprite per placement and routes by `layer` into the
 * corresponding container.
 */
export interface TilePlacement {
  /** Stable id for diagnostics ("ground_42", etc.). */
  tileKey: string;
  bundle: string;
  exportName: string;
  /** Cell position in logical pixel space (output of `getCellPosition`). */
  cellX: number;
  cellY: number;
  /** 0/1/2/3 — multiplied by 90° at render. */
  rotation: number;
  flip: boolean;
  /** Total frames in the timeline (1 for static). */
  frameCount: number;
  /** True when the tile auto-loops on a per-frame timer. */
  isAnimated: boolean;
  /** Frames per second for animated tiles. */
  fps: number;
  /**
   * Frame to render for *non*-animated multi-frame tiles
   * (slope/random tiles where each cell picks a fixed frame index).
   * Ignored for animated tiles (they advance via `tick`).
   */
  staticFrame: number;
  /**
   * True for the single map-background placement. The background is
   * pinned at `BG_RESOLUTION` and never re-rasterized on zoom (its
   * texture is the widest tile we ever render and re-acquiring it at
   * higher density risks the WebGPU 8192 limit on a hot path). Set
   * by `MapHandler.buildPlacements` on the bg pushPlacementByKey
   * call.
   */
  isBackground?: boolean;
}

const log = createLogger("TileSpriteRenderer");

/**
 * Resolution pinned for background tiles. Backgrounds are the
 * widest single tile we ever render (a default Dofus map bg is
 * ~742×432 logical → 2968×1728 phys at 4×). At higher densities
 * the texture would creep toward the WebGPU `maxTextureDimension2d`
 * = 8192 limit and `wgpu::Device::create_texture` would panic. The
 * bg gets a single render at boot and is intentionally NOT re-
 * rasterized on subsequent zoom steps — the user's stand-still
 * background never benefits from oversampling enough to justify
 * the limit risk + the GPU memory churn.
 */
const BG_RESOLUTION = 4;
/** Starting density for non-background tiles. */
const DEFAULT_TILE_RESOLUTION = 4;
/**
 * Per-zoom-step rasterization cap for non-bg tiles. Smaller than
 * the bg cap because mid-size object2 tiles (big buildings ~500
 * logical px) stay under 8192 phys px at 8× density (= 4000 px).
 * The user zoom levels top out at 5×, so 8× density at zoom=5 still
 * gives 1.6× oversampling per screen pixel — far past the point
 * where additional density is visually distinguishable.
 */
const MAX_TILE_RESOLUTION = 8;
const TICK_INTERVAL_MS = 1000 / 60;
const RETIRE_DELAY_MS = 2 * TICK_INTERVAL_MS;

/**
 * Cache entry for a (bundle, export, frame) tuple — every Sprite that
 * needs the same tile frame reuses the same `ExternalSource` +
 * `Texture` instance. A 15×17 map has ~50 unique tile keys but ~480
 * cells × 3 layers = 1440 placements; without sharing, the watchdog's
 * `TEXTURE_COUNT_HALT = 1024` trips mid-render and the bottom of the
 * map silently stops drawing because `renderSwfFrame` returns null
 * once `isHalted()` flips. Mirrors stress-worker.ts:540 `tileCache`.
 */
interface CachedTileSource {
  source: ExternalSource;
  texture: Texture;
  textureId: number;
  anchorFracX: number;
  anchorFracY: number;
}

/**
 * Layer-tagged variant of `TilePlacement` — caller marks the
 * destination Pixi layer per tile. MapHandler emits this when
 * building placements: ground tiles → layer 0, object1 tiles → 1.
 */
export interface LayeredTilePlacement extends TilePlacement {
  layer: 0 | 1 | 2;
}

interface TileSpriteState {
  sprite: Sprite;
  layer: 0 | 1 | 2;
  // Re-render context — kept so on-demand frame advance reuses bundle/export.
  bundle: string;
  exportName: string;
  frameCount: number;
  fps: number;
  isAnimated: boolean;
  /**
   * True for the map background tile. Excluded from zoom-driven
   * re-rasterization so the widest tile never trips wgpu's
   * `maxTextureDimension2d` and the bg never visibly flickers on
   * the zoom path.
   */
  isBackground: boolean;
  currentFrame: number;
  accumMs: number;
  /**
   * Cache key into `TileSpriteRenderer.tileCache` for the current
   * frame. Sprites that share the same key reuse one GPU texture.
   * `removeSprite` decrements the cache's refcount via this key.
   */
  cacheKey: string;
  /**
   * Resolution this sprite is currently bound to — backgrounds stay
   * at `BG_RESOLUTION`, everything else tracks the dynamic
   * `tileResolution`. Used when re-acquiring on zoom + when
   * computing `sprite.scale = 1/resolution`.
   */
  resolution: number;
  // Cell context — for repositioning on map-scale change.
  cellX: number;
  cellY: number;
  rotation: number;
  flip: boolean;
  /** Anchor in (texture-pixel / texture-size) units, captured at create. */
  anchorFracX: number;
  anchorFracY: number;
}

function tileKey(p: LayeredTilePlacement): string {
  return `${p.layer}:${p.tileKey}@${p.cellX},${p.cellY},r${p.rotation},f${p.flip ? 1 : 0}`;
}

function applyMatrix(
  sprite: Sprite,
  cellX: number,
  cellY: number,
  rotation: number,
  flip: boolean,
  resolution: number
): void {
  // Position sprites in mapContainer-local logical pixels — exactly
  // what canonical `MapHandler.as` does (`mc._x = col * CELL_WIDTH +
  // parityOffset`). Players use the same convention so tiles + chars
  // share a coordinate space; mapContainer.scale = zoom propagates
  // the user zoom.
  sprite.x = cellX;
  sprite.y = cellY;

  // Texture is rasterized at `resolution` density. Base scale
  // 1/resolution brings texture pixels back to logical pixels;
  // rotated tiles get the canonical AS iso-projection fudge:
  //   `_xscale = 51.85, _yscale = 192.86` (Constants.as).
  // Flip mirrors the X axis (canonical `_xscale *= -1`).
  const rot = rotation & 3;
  const rotated = rot === 1 || rot === 3;
  const base = 1 / resolution;
  const sx = rotated ? base * ROT_SCALE_X : base;
  const sy = rotated ? base * ROT_SCALE_Y : base;
  sprite.scale.set(flip ? -sx : sx, sy);
  sprite.rotation = rot * (Math.PI / 2);
}

export class TileSpriteRenderer {
  private states = new Map<string, TileSpriteState>();
  private pixiRenderer: Renderer;
  private groundLayer: Container;
  private object1Layer: Container;
  private object2Layer: Container;
  /**
   * Shared GPU texture pool keyed by
   * `${bundle}:${exportName}:${frame}:${resolution}`. Including the
   * resolution in the cache key lets backgrounds (pinned at
   * `BG_RESOLUTION`) keep their entry across zoom changes while
   * non-bg tiles get fresh entries every time the user zooms.
   */
  private tileCache = new Map<string, CachedTileSource>();
  /** Refcount per cache key. When it hits 0 we retire the GPU texture. */
  private cacheRefs = new Map<string, number>();
  /**
   * Current rasterization density for non-bg tiles. Backgrounds
   * always use `BG_RESOLUTION` regardless of this value — see
   * `setTileResolution` for the zoom-driven re-render path.
   */
  private tileResolution = DEFAULT_TILE_RESOLUTION;

  constructor(
    pixiRenderer: Renderer,
    groundLayer: Container,
    object1Layer: Container,
    object2Layer: Container
  ) {
    this.pixiRenderer = pixiRenderer;
    this.groundLayer = groundLayer;
    this.object1Layer = object1Layer;
    this.object2Layer = object2Layer;
  }

  /**
   * Look up the cached GPU texture for `(bundle, exportName, frame)`
   * or render + cache it. Increments the cache refcount; pair with
   * `releaseCachedTile(cacheKey)` on sprite removal so the texture is
   * freed once the last sprite stops using it. Returns null when the
   * underlying `renderSwfFrame` fails (watchdog halt, missing export).
   */
  private acquireCachedTile(
    bundle: string,
    exportName: string,
    frame: number,
    resolution: number
  ): { cacheKey: string; entry: CachedTileSource } | null {
    const cacheKey = `${bundle}:${exportName}:${frame}:${resolution}`;
    let entry = this.tileCache.get(cacheKey);
    if (!entry) {
      const result = renderSwfFrame(bundle, exportName, frame, resolution);
      if (!result) {
        return null;
      }
      const source = new ExternalSource({
        resource: result.texture,
        renderer: this.pixiRenderer,
        width: result.width,
        height: result.height,
        label: `tile-${bundle}:${exportName}@${frame}@${resolution}`,
      });
      source.alphaMode = "no-premultiply-alpha";
      source.format = "rgba8unorm";
      source.scaleMode = "linear";
      source.autoGarbageCollect = false;
      const texture = new Texture({ source });
      const anchorFracX =
        result.width > 0 ? result.anchorX / result.width : 0;
      const anchorFracY =
        result.height > 0 ? result.anchorY / result.height : 0;
      entry = {
        source,
        texture,
        textureId: result.textureId,
        anchorFracX,
        anchorFracY,
      };
      this.tileCache.set(cacheKey, entry);
    }
    this.cacheRefs.set(cacheKey, (this.cacheRefs.get(cacheKey) ?? 0) + 1);
    return { cacheKey, entry };
  }

  /**
   * Drop a refcount against `cacheKey`. When it falls to 0 schedule
   * the source + GPU texture for retire after a settle delay so any
   * in-flight Pixi render pass that still references the source
   * finishes before its memory disappears.
   */
  private releaseCachedTile(cacheKey: string): void {
    const next = (this.cacheRefs.get(cacheKey) ?? 0) - 1;
    if (next > 0) {
      this.cacheRefs.set(cacheKey, next);
      return;
    }
    this.cacheRefs.delete(cacheKey);
    const entry = this.tileCache.get(cacheKey);
    if (!entry) return;
    this.tileCache.delete(cacheKey);
    const { source, textureId } = entry;
    setTimeout(() => {
      try {
        source.destroy();
      } catch {}
      freeRenderTexture(textureId);
    }, RETIRE_DELAY_MS);
  }

  /**
   * Diff the live sprite set against the new placement list — create
   * sprites for new entries, retire the ones that disappeared, leave
   * unchanged ones alone.
   */
  setPlacements(placements: ReadonlyArray<LayeredTilePlacement>): void {
    const nextKeys = new Set<string>();
    for (const p of placements) {
      const key = tileKey(p);
      nextKeys.add(key);
      if (this.states.has(key)) {
        continue;
      }
      this.createSprite(key, p);
    }
    for (const key of [...this.states.keys()]) {
      if (!nextKeys.has(key)) {
        this.removeSprite(key);
      }
    }
  }

  /**
   * Per-tick frame advance for animated tiles. Static tiles are no-ops
   * (their sprite was set up once and never changes).
   */
  tick(dtMs: number): void {
    for (const [, state] of this.states) {
      if (!state.isAnimated || state.fps <= 0 || state.frameCount <= 1) {
        continue;
      }
      state.accumMs += dtMs;
      const period = 1000 / state.fps;
      if (state.accumMs < period) {
        continue;
      }
      const steps = Math.floor(state.accumMs / period);
      state.accumMs -= steps * period;
      state.currentFrame = (state.currentFrame + steps) % state.frameCount;
      this.swapFrame(state);
    }
  }

  destroy(): void {
    for (const key of [...this.states.keys()]) {
      this.removeSprite(key);
    }
  }

  /**
   * Re-rasterize every non-background tile sprite at the new
   * density. Backgrounds keep their existing texture (pinned at
   * `BG_RESOLUTION`) — re-rendering them risks the wgpu 8192
   * texture limit and the bg never visibly benefits from
   * oversampling enough to justify the per-zoom GPU churn.
   *
   * Animation state is preserved across the swap: `currentFrame`
   * and `accumMs` are NOT reset, so an animated tile mid-cycle
   * (chimney smoke, water ripples) continues from where it left
   * off — the only thing that changes is the underlying GPU
   * texture's pixel density.
   *
   * The cache is keyed by `(bundle, export, frame, resolution)`,
   * so calls into `acquireCachedTile` at the new density hit fresh
   * entries while the old per-resolution entries naturally retire
   * via refcount-drop once every sprite has migrated.
   */
  setTileResolution(res: number): void {
    const clamped = Math.max(
      DEFAULT_TILE_RESOLUTION,
      Math.min(MAX_TILE_RESOLUTION, Math.ceil(res))
    );
    if (clamped === this.tileResolution) {
      return;
    }
    this.tileResolution = clamped;
    for (const state of this.states.values()) {
      if (state.isBackground) {
        continue;
      }
      const acquired = this.acquireCachedTile(
        state.bundle,
        state.exportName,
        state.currentFrame,
        clamped
      );
      if (!acquired) {
        // Out-of-budget or render failed — leave the sprite on its
        // existing (lower-density) texture rather than going blank.
        continue;
      }
      const { cacheKey, entry } = acquired;
      const oldCacheKey = state.cacheKey;
      state.sprite.anchor.set(entry.anchorFracX, entry.anchorFracY);
      state.sprite.texture = entry.texture;
      applyMatrix(
        state.sprite,
        state.cellX,
        state.cellY,
        state.rotation,
        state.flip,
        clamped
      );
      state.cacheKey = cacheKey;
      state.resolution = clamped;
      state.anchorFracX = entry.anchorFracX;
      state.anchorFracY = entry.anchorFracY;
      this.releaseCachedTile(oldCacheKey);
    }
  }

  private createSprite(key: string, p: LayeredTilePlacement): void {
    const initialFrame = p.isAnimated ? 0 : p.staticFrame;
    const isBackground = p.isBackground === true;
    const resolution = isBackground ? BG_RESOLUTION : this.tileResolution;
    const acquired = this.acquireCachedTile(
      p.bundle,
      p.exportName,
      initialFrame,
      resolution
    );
    if (!acquired) {
      return;
    }
    const { cacheKey, entry } = acquired;
    // NOTE: do NOT set `source.resolution`. Pixi interprets it as a
    // pixel-density multiplier that makes the texture render 1/N
    // times smaller; combined with our `sprite.scale = 1/resolution`
    // it produces 1/N² tiles. The native density compensation lives
    // entirely in `applyMatrix`'s `sprite.scale`.

    const sprite = new Sprite(entry.texture);
    sprite.anchor.set(entry.anchorFracX, entry.anchorFracY);
    applyMatrix(sprite, p.cellX, p.cellY, p.rotation, p.flip, resolution);
    // Painter's-order zIndex inside the layer: lower-cellY (back rows)
    // render first so higher-cellY (front rows) overlap correctly.
    // Mirrors canonical MapHandler depth convention.
    sprite.zIndex = Math.round(p.cellY * 100) + Math.round(p.cellX);

    const parent =
      p.layer === 0
        ? this.groundLayer
        : p.layer === 1
          ? this.object1Layer
          : this.object2Layer;
    parent.addChild(sprite);

    this.states.set(key, {
      sprite,
      layer: p.layer,
      bundle: p.bundle,
      exportName: p.exportName,
      frameCount: p.frameCount,
      fps: p.fps,
      isAnimated: p.isAnimated,
      isBackground,
      currentFrame: initialFrame,
      accumMs: 0,
      cacheKey,
      resolution,
      cellX: p.cellX,
      cellY: p.cellY,
      rotation: p.rotation,
      flip: p.flip,
      anchorFracX: entry.anchorFracX,
      anchorFracY: entry.anchorFracY,
    });
  }

  private removeSprite(key: string): void {
    const state = this.states.get(key);
    if (!state) {
      return;
    }
    try {
      state.sprite.parent?.removeChild(state.sprite);
      // Sprite owns no GPU resources — the texture is shared via
      // tileCache. `destroy({ texture: false })` keeps the shared
      // resource alive.
      state.sprite.destroy({ texture: false });
    } catch (e) {
      log.warn("removeSprite: destroy failed", e);
    }
    this.releaseCachedTile(state.cacheKey);
    this.states.delete(key);
  }

  private swapFrame(state: TileSpriteState): void {
    const acquired = this.acquireCachedTile(
      state.bundle,
      state.exportName,
      state.currentFrame,
      state.resolution
    );
    if (!acquired) {
      return;
    }
    const { cacheKey, entry } = acquired;
    const oldCacheKey = state.cacheKey;

    state.sprite.anchor.set(entry.anchorFracX, entry.anchorFracY);
    state.sprite.texture = entry.texture;
    state.cacheKey = cacheKey;
    state.anchorFracX = entry.anchorFracX;
    state.anchorFracY = entry.anchorFracY;

    if (oldCacheKey !== cacheKey) {
      this.releaseCachedTile(oldCacheKey);
    } else {
      // Same key → acquireCachedTile incremented refcount even
      // though the sprite still holds the previous reference. Drop
      // the spurious increment so the count stays correct.
      this.releaseCachedTile(cacheKey);
    }
  }
}
