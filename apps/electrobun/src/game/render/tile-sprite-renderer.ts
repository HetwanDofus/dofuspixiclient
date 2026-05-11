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
}

const log = createLogger("TileSpriteRenderer");

/**
 * Tile rasterization resolution.
 *
 * Was 10 to match stress-worker.ts:109 MAP_BG_ZOOM, but at 10×
 * density a single large foreground tile (e.g. a tall building
 * sprite ~700×900 logical) lands at 7000×9000 physical pixels,
 * exceeding the typical WebGPU `maxTextureDimension2d` of 8192 on
 * Apple Silicon / Chromium. `wgpu::Device::create_texture` panics
 * when that limit is breached, the WASM module aborts mid-frame,
 * every subsequent `renderSwfFrame` returns null, and tile
 * placements that hadn't been processed yet (i.e. cells further
 * down the map in cellId iteration order) silently fail to render
 * — the canonical "bottom of every map is black" symptom.
 *
 * 4× still gives crisp output at the maximum user zoom (4×
 * `ZOOM_LEVELS[ZOOM_LEVELS.length - 1]` = 5) and keeps the worst
 * tile at well under 4000 px per side.
 */
const MAP_BG_ZOOM = 4;
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
  currentFrame: number;
  accumMs: number;
  /**
   * Cache key into `TileSpriteRenderer.tileCache` for the current
   * frame. Sprites that share the same key reuse one GPU texture.
   * `removeSprite` decrements the cache's refcount via this key.
   */
  cacheKey: string;
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
  flip: boolean
): void {
  // Position sprites in mapContainer-local logical pixels — exactly
  // what canonical `MapHandler.as` does (`mc._x = col * CELL_WIDTH +
  // parityOffset`). Players use the same convention so tiles + chars
  // share a coordinate space; mapContainer.scale = zoom propagates
  // the user zoom.
  sprite.x = cellX;
  sprite.y = cellY;

  // Texture is rasterized at MAP_BG_ZOOM density. Base scale
  // 1/MAP_BG_ZOOM brings texture pixels back to logical pixels;
  // rotated tiles get the canonical AS iso-projection fudge:
  //   `_xscale = 51.85, _yscale = 192.86` (Constants.as).
  // Flip mirrors the X axis (canonical `_xscale *= -1`).
  const rot = rotation & 3;
  const rotated = rot === 1 || rot === 3;
  const base = 1 / MAP_BG_ZOOM;
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
   * Shared GPU texture pool keyed by `${bundle}:${exportName}:${frame}`.
   * Every cell that references the same tile frame reuses one
   * `ExternalSource` + `Texture` here. Critical: per-placement
   * textures would blow past the watchdog's TEXTURE_COUNT_HALT=1024
   * on any non-trivial map and silently halt mid-render — the
   * canonical "bottom of the map goes black" symptom.
   */
  private tileCache = new Map<string, CachedTileSource>();
  /** Refcount per cache key. When it hits 0 we retire the GPU texture. */
  private cacheRefs = new Map<string, number>();

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
    frame: number
  ): { cacheKey: string; entry: CachedTileSource } | null {
    const cacheKey = `${bundle}:${exportName}:${frame}`;
    let entry = this.tileCache.get(cacheKey);
    if (!entry) {
      const result = renderSwfFrame(bundle, exportName, frame, MAP_BG_ZOOM);
      if (!result) {
        return null;
      }
      const source = new ExternalSource({
        resource: result.texture,
        renderer: this.pixiRenderer,
        width: result.width,
        height: result.height,
        label: `tile-${bundle}:${exportName}@${frame}`,
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

  private createSprite(key: string, p: LayeredTilePlacement): void {
    const initialFrame = p.isAnimated ? 0 : p.staticFrame;
    const acquired = this.acquireCachedTile(
      p.bundle,
      p.exportName,
      initialFrame
    );
    if (!acquired) {
      return;
    }
    const { cacheKey, entry } = acquired;
    // NOTE: do NOT set `source.resolution = MAP_BG_ZOOM`. Pixi
    // interprets resolution as a pixel-density multiplier that makes
    // the texture render 1/N times smaller; combined with our
    // `sprite.scale = 1/MAP_BG_ZOOM` it produces 1/100× tiles ("tiny
    // + spread apart"). The native MAP_BG_ZOOM-density rasterization
    // is compensated entirely by `sprite.scale`.

    const sprite = new Sprite(entry.texture);
    sprite.anchor.set(entry.anchorFracX, entry.anchorFracY);
    applyMatrix(sprite, p.cellX, p.cellY, p.rotation, p.flip);
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
      currentFrame: initialFrame,
      accumMs: 0,
      cacheKey,
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
      state.currentFrame
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
