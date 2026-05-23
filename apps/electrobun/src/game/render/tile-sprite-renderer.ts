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
  type Container,
  ImageSource,
  Rectangle,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { ROT_SCALE_X, ROT_SCALE_Y } from "@/game/constants/battlefield";
import {
  getPixiRenderer,
  renderSwfFrame,
  renderSwfTileDynamicStripRange,
  uploadAndCloseBitmap,
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
 * Cache entry for a tile bake — either:
 *
 * - **Single-frame**: one `ExternalSource` with one `Texture`
 *   covering the whole source. Used for static tiles, AVM1
 *   Random-pick tiles (frozen at load), and slope tiles whose
 *   `gotoAndStop(slopeId)` lands on a fixed frame.
 *
 * - **Strip atlas** (B2): one `ExternalSource` holding ALL frames
 *   of an animated tile in a grid, plus a per-frame array of
 *   `Texture` objects (each pointing at one cell rect). Animation
 *   tick swaps `sprite.texture = frames[idx]` with zero Vello
 *   dispatch — the strip was baked once at first acquire.
 *
 * Cache key: `${bundle}:${export}:${resolution}` (NOT keyed by
 * frame — the strip covers every frame). The first sprite to
 * acquire a tile triggers the strip bake; subsequent sprites
 * (same map, same tile, same density) share the bake.
 */
interface CachedTileSource {
  source: ImageSource;
  /** Per-frame Texture instances; length = frameCount. For
   *  single-frame tiles, length 1 with `frames[0]` covering the
   *  whole source. */
  frames: Texture[];
  /** Anchor in (texel / cell_size) units. For strip atlases this
   *  refers to the SWF (0,0) inside ONE cell. Same for every
   *  frame, by Rust-side bounds-union construction. */
  anchorFracX: number;
  anchorFracY: number;
}

/**
 * Maximum frame count we attempt to fold into a single strip
 * atlas. Beyond this, a tile falls back to per-frame on-demand
 * rendering (see `acquireSingleFrame`) — keeps any one strip
 * texture under wgpu's 16384-pixel limit and bounds the worst-
 * case GPU memory commit per acquire. ~150 frames at 256×256 BGRA
 * fits in 39 MB which is safely below the strip-side cap.
 */
const STRIP_MAX_FRAMES = 150;

/**
 * Wall-clock budget for tile re-rasterization per frame. Drain
 * processes at least one tile (guaranteed progress) and then
 * continues until this many ms have elapsed inside the drain call.
 * Adapts to hardware: fast machines burst through many tiles per
 * frame, slow machines stretch the upgrade over more frames — same
 * code, same constant. 16.6ms is the 60fps frame budget; reserving
 * ~3ms for tile upgrades leaves the rest for Pixi render +
 * animation tick + other work.
 */
const UPGRADE_BUDGET_MS = 3;

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
  /**
   * In-flight density upgrade triggered by `setTileResolution`. The
   * queue is drained inside `tick()` at `UPGRADE_BUDGET_PER_FRAME`
   * sprites per frame so a zoom step never freezes the main thread.
   * Tiles not yet upgraded keep showing their prior (lower-density)
   * texture — visually they look slightly softer until their turn
   * comes up, never blank. A second `setTileResolution` call mid-
   * upgrade replaces the queue with a fresh one targeting the new
   * density (no compounding, no orphan upgrades).
   */
  private pendingUpgrade: {
    targetRes: number;
    queue: TileSpriteState[];
    idx: number;
  } | null = null;

  constructor(
    _pixiRenderer: Renderer,
    groundLayer: Container,
    object1Layer: Container,
    object2Layer: Container
  ) {
    // Bridge path: Pixi resource creation no longer needs the
    // renderer reference (ImageSource takes a bitmap directly).
    this.groundLayer = groundLayer;
    this.object1Layer = object1Layer;
    this.object2Layer = object2Layer;
  }

  getStats(): {
    states: number;
    tileCache: number;
    cacheRefs: number;
  } {
    return {
      states: this.states.size,
      tileCache: this.tileCache.size,
      cacheRefs: this.cacheRefs.size,
    };
  }

  /**
   * Acquire a cache entry covering every frame of an animated tile,
   * or the single fixed frame of a static / AVM1-frozen tile.
   *
   * Animated tile path (frameCount > 1 AND <= STRIP_MAX_FRAMES):
   * bake ALL frames as one strip atlas via
   * `renderSwfTileDynamicStripRange`. Slice into N per-frame
   * `Texture` objects sharing one `TextureSource`. The first
   * sprite acquire pays the bake cost; subsequent sprites (same
   * bundle/export/resolution) reuse it. **Zero per-frame Vello
   * dispatch after warmup.**
   *
   * Static + AVM1-frozen + outlier (> STRIP_MAX_FRAMES) path:
   * single-frame `renderSwfFrame` as before (one cell, one Texture).
   *
   * Cache key always omits `frame` for strips so the SAME entry
   * serves every animation tick. Single-frame tiles append `@F`
   * so multiple slope variants of the same tile coexist.
   */
  private acquireCachedTile(
    bundle: string,
    exportName: string,
    fixedFrame: number,
    frameCount: number,
    isAnimated: boolean,
    resolution: number
  ): { cacheKey: string; entry: CachedTileSource } | null {
    const useStrip =
      isAnimated && frameCount > 1 && frameCount <= STRIP_MAX_FRAMES;
    const cacheKey = useStrip
      ? `strip|${bundle}:${exportName}:${resolution}`
      : `frame|${bundle}:${exportName}:${resolution}@${fixedFrame}`;
    let entry = this.tileCache.get(cacheKey);
    if (!entry) {
      const baked = useStrip
        ? this.bakeStrip(bundle, exportName, frameCount, resolution)
        : this.bakeSingleFrame(bundle, exportName, fixedFrame, resolution);
      if (!baked) return null;
      entry = baked;
      this.tileCache.set(cacheKey, entry);
    }
    this.cacheRefs.set(cacheKey, (this.cacheRefs.get(cacheKey) ?? 0) + 1);
    return { cacheKey, entry };
  }

  /**
   * Bake one frame as a single-cell texture (static tiles, AVM1
   * Random-pick tiles, slope tiles at a fixed frame, outliers
   * exceeding `STRIP_MAX_FRAMES`).
   */
  private bakeSingleFrame(
    bundle: string,
    exportName: string,
    frame: number,
    resolution: number
  ): CachedTileSource | null {
    const result = renderSwfFrame(bundle, exportName, frame, resolution);
    if (!result) return null;
    const source = new ImageSource({
      resource: result.bitmap,
      width: result.width,
      height: result.height,
      label: `tile-${bundle}:${exportName}@${frame}@${resolution}`,
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "linear",
      autoGarbageCollect: false,
    });
    uploadAndCloseBitmap(getPixiRenderer(), source, result.bitmap);
    const texture = new Texture({ source });
    const anchorFracX = result.width > 0 ? result.anchorX / result.width : 0;
    const anchorFracY = result.height > 0 ? result.anchorY / result.height : 0;
    return {
      source,
      frames: [texture],
      anchorFracX,
      anchorFracY,
    };
  }

  /**
   * Bake all `frameCount` frames as ONE strip atlas in one Vello
   * dispatch via `renderSwfTileDynamicStripRange`. Slice into N
   * Pixi `Texture` objects sharing one `TextureSource`; each
   * `Texture` has a `frame` rect addressing its cell in the grid.
   *
   * **Path B for tiles**: zero per-frame Vello calls thereafter —
   * animation tick is `sprite.texture = frames[i]`.
   */
  private bakeStrip(
    bundle: string,
    exportName: string,
    frameCount: number,
    resolution: number
  ): CachedTileSource | null {
    const result = renderSwfTileDynamicStripRange(
      bundle,
      exportName,
      0,
      frameCount,
      frameCount,
      resolution,
    );
    if (!result) return null;
    const source = new ImageSource({
      resource: result.bitmap,
      width: result.width,
      height: result.height,
      label: `tile-strip-${bundle}:${exportName}@${resolution}`,
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "linear",
      autoGarbageCollect: false,
    });
    uploadAndCloseBitmap(getPixiRenderer(), source, result.bitmap);

    // Slice the strip into per-frame Texture objects. Each cell is
    // (frameWidth × frameHeight); cells stack left-to-right then
    // wrap by `gridCols`. Anchor inside each cell is the SWF (0,0)
    // expressed as a fraction of cell dims — uniform across cells
    // by the Rust-side bounds-union construction.
    const frames: Texture[] = new Array(result.frameCount);
    for (let i = 0; i < result.frameCount; i++) {
      const col = i % result.gridCols;
      const row = Math.floor(i / result.gridCols);
      const rect = new Rectangle(
        col * result.frameWidth,
        row * result.frameHeight,
        result.frameWidth,
        result.frameHeight,
      );
      frames[i] = new Texture({ source, frame: rect });
    }
    const anchorFracX =
      result.frameWidth > 0 ? result.anchorX / result.frameWidth : 0;
    const anchorFracY =
      result.frameHeight > 0 ? result.anchorY / result.frameHeight : 0;
    return {
      source,
      frames,
      anchorFracX,
      anchorFracY,
    };
  }

  /**
   * Drop a refcount against `cacheKey`. When it falls to 0 schedule
   * the source for retire after a settle delay so any in-flight
   * Pixi render pass that still references the source finishes
   * before its memory disappears.
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
    const { source } = entry;
    setTimeout(() => {
      // Bridge path: destroying the ImageSource cascades to its
      // uploaded Pixi GPUTexture. The Rust-side `wgpu::Texture`
      // already dropped at end of the bake and feeds deferred
      // destroy on its own — no `freeRenderTexture` plumbing.
      try {
        source.destroy();
      } catch {}
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
    // Drain a budgeted slice of the density-upgrade queue. Keeping
    // this AFTER animation tick means a tile that swapped frame on
    // this same tick gets upgraded with its current frame index in
    // sync — animation continuity preserved across the upgrade.
    this.drainPendingUpgrade();
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
    // Queue every non-bg sprite that isn't already at the target
    // density. The drain happens in `tick()` at
    // `UPGRADE_BUDGET_PER_FRAME` per frame. Filtering out
    // already-matching sprites lets a second `setTileResolution`
    // mid-upgrade (zoom-in-then-out) avoid redundant work for
    // tiles already upgraded to the new target.
    const queue: TileSpriteState[] = [];
    for (const state of this.states.values()) {
      if (state.isBackground) continue;
      if (state.resolution === clamped) continue;
      queue.push(state);
    }
    this.pendingUpgrade = queue.length > 0
      ? { targetRes: clamped, queue, idx: 0 }
      : null;
  }

  /**
   * Re-rasterize one tile sprite at the given density. Pulled out of
   * the old sync sweep so it can be invoked from the per-frame
   * upgrade drain. Returns true on success, false if the bake was
   * over-budget / failed (sprite then stays on its previous
   * texture — never blank).
   */
  private upgradeSpriteResolution(
    state: TileSpriteState,
    target: number,
  ): boolean {
    const acquired = this.acquireCachedTile(
      state.bundle,
      state.exportName,
      state.currentFrame,
      state.frameCount,
      state.isAnimated,
      target,
    );
    if (!acquired) return false;
    const { cacheKey, entry } = acquired;
    const oldCacheKey = state.cacheKey;
    const frameIdx = state.currentFrame % entry.frames.length;
    state.sprite.anchor.set(entry.anchorFracX, entry.anchorFracY);
    state.sprite.texture = entry.frames[frameIdx];
    applyMatrix(
      state.sprite,
      state.cellX,
      state.cellY,
      state.rotation,
      state.flip,
      target,
    );
    state.cacheKey = cacheKey;
    state.resolution = target;
    state.anchorFracX = entry.anchorFracX;
    state.anchorFracY = entry.anchorFracY;
    this.releaseCachedTile(oldCacheKey);
    return true;
  }

  /**
   * Drain the pending density-upgrade queue under a wall-clock
   * budget (`UPGRADE_BUDGET_MS`). Always processes at least one
   * sprite per call to guarantee forward progress; after that,
   * continues until the budget is exhausted. Skips sprites that no
   * longer match (e.g. removed by `setPlacements` mid-upgrade) or
   * that already reached the target (e.g. a second
   * `setTileResolution` call landed them on the same density via
   * a different code path).
   */
  private drainPendingUpgrade(): void {
    const u = this.pendingUpgrade;
    if (!u) return;
    const start = performance.now();
    while (u.idx < u.queue.length) {
      const state = u.queue[u.idx++];
      if (state.resolution === u.targetRes) continue; // already done elsewhere
      // Validate sprite still alive (not removed by setPlacements).
      // `state.sprite.parent` is null after `removeSprite` clears it.
      if (!state.sprite.parent) continue;
      this.upgradeSpriteResolution(state, u.targetRes);
      // Wall-clock budget check is AFTER the upgrade so each call
      // makes at least one unit of progress, regardless of how
      // long that one bake took on this hardware. Result: zero
      // hand-tuning across machines.
      if (performance.now() - start >= UPGRADE_BUDGET_MS) break;
    }
    if (u.idx >= u.queue.length) {
      this.pendingUpgrade = null;
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
      p.frameCount,
      p.isAnimated,
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

    const initialTexture = entry.frames[initialFrame % entry.frames.length];
    const sprite = new Sprite(initialTexture);
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

  /**
   * Advance an animated tile to `state.currentFrame`. Under B2, the
   * cache entry is a strip atlas covering every frame so this
   * collapses to swapping the sprite's `texture` reference — **no
   * Vello dispatch**. For outliers and oddly-keyed legacy entries
   * that turned out to be single-frame, we fall back to the old
   * "re-acquire per frame" path so behavior degrades gracefully
   * (a tile with >`STRIP_MAX_FRAMES` will still animate, just
   * through per-frame on-demand bakes like before).
   */
  private swapFrame(state: TileSpriteState): void {
    const entry = this.tileCache.get(state.cacheKey);
    if (entry && entry.frames.length > 1) {
      // Strip path: zero-dispatch UV swap.
      const idx = state.currentFrame % entry.frames.length;
      state.sprite.texture = entry.frames[idx];
      return;
    }
    // Outlier / fallback: re-acquire a single-frame texture for the
    // new frame index. Same lifecycle as pre-B2.
    const acquired = this.acquireCachedTile(
      state.bundle,
      state.exportName,
      state.currentFrame,
      state.frameCount,
      state.isAnimated,
      state.resolution
    );
    if (!acquired) {
      return;
    }
    const { cacheKey, entry: nextEntry } = acquired;
    const oldCacheKey = state.cacheKey;
    state.sprite.anchor.set(nextEntry.anchorFracX, nextEntry.anchorFracY);
    state.sprite.texture = nextEntry.frames[0];
    state.cacheKey = cacheKey;
    state.anchorFracX = nextEntry.anchorFracX;
    state.anchorFracY = nextEntry.anchorFracY;
    if (oldCacheKey !== cacheKey) {
      this.releaseCachedTile(oldCacheKey);
    } else {
      // Same key → acquire bumped refcount even though the previous
      // ref still applies. Drop the spurious increment.
      this.releaseCachedTile(cacheKey);
    }
  }
}
