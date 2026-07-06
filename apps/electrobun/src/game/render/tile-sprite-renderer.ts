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
  renderSwfTileInstancePart,
  renderSwfTileInstancePartStrip,
  renderSwfTileStaticSeeded,
  tickTileInstances,
  tileInstanceCreate,
  tileInstanceDynFrames,
  tileInstanceFree,
  type TileInstancePartInfo,
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
   * Cell this placement occupies — the deterministic seed for the
   * canonical per-instance semantics (executed `gotoAndStop(random)`
   * variants, per-cell loop phase, per-instance trigger schedules).
   */
  cellId?: number;
  /**
   * Loop fast path: per-cell phase seed
   * (`tile_behavior::seed_for_cell`). Canonically each placed clip
   * owns its playhead, so identical gfx on different cells must not
   * animate in lockstep — the seed offsets the starting frame and
   * sub-frame accumulator.
   */
  phaseSeed?: number;
  /**
   * True when classification found stop-parked / enterFrame-triggered
   * children — the tile routes through the per-instance scripted path
   * (`tileInstanceCreate` + `tickTileInstances`) instead of a strip.
   */
  scripted?: boolean;
  /**
   * Static tiles only: stable hash of the executed script's chosen
   * variant (frame + frozen-child pins). Cache key so cells whose
   * random draws matched share one seeded bake.
   */
  staticSig?: number;
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
/**
 * Per-sprite re-bake dimension cap (logical px x density must stay
 * under this). wgpu maxTextureDimension2d is 8192; leave headroom for
 * the 1-px AA pad + rounding.
 */
const SAFE_TEXTURE_DIM = 8000;
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
  /** Seeded static variant signature (see `TilePlacement.staticSig`). */
  staticSig?: number;
  /** Seed cell for seeded static re-bakes on resolution change. */
  cellId?: number;
}

/**
 * One paint-ordered slice of a live scripted tile. Runs bake once
 * (shared per `(export, partIdx, sig, resolution)`); dynamic child
 * parts hold a strip of the child's whole frame range so per-tick
 * animation is a texture swap; whole-scene fallbacks (masked
 * wrappers) re-bake on change into a privately-owned volatile source.
 */
interface ScriptedPartState {
  sprite: Sprite;
  info: TileInstancePartInfo;
  /** tileCache key for shared entries (runs + child strips). Null for
   *  volatile (re-baked-per-change) parts. */
  cacheKey: string | null;
  /** True when `cacheKey` points at a multi-frame strip entry. */
  isStrip: boolean;
  /** Privately-owned source for volatile parts (whole fallback, or a
   *  child whose strip exceeded GPU limits). Replaced on re-bake. */
  volatileSource: ImageSource | null;
}

/**
 * One scripted tile placement: a wasm-side instance id (per-cell
 * seeded AVM1 child playheads) plus stacked part sprites. Canonical
 * model: Flash gives every placed clip its own playhead and fires its
 * `onClipEvent(enterFrame)` per instance — see
 * rust/swf-spike/src/tile_script.rs.
 */
interface ScriptedTileState {
  instId: number;
  sig: number;
  layer: 0 | 1 | 2;
  bundle: string;
  exportName: string;
  cellId: number;
  resolution: number;
  parts: ScriptedPartState[];
  cellX: number;
  cellY: number;
  rotation: number;
  flip: boolean;
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
  /** Scripted tiles (per-instance AVM1 playheads), keyed like `states`. */
  private scriptedStates = new Map<string, ScriptedTileState>();
  /** Same states indexed by wasm instId for the tick fan-out. */
  private scriptedByInst = new Map<number, ScriptedTileState>();
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
    scriptedQueue: ScriptedTileState[];
    scriptedIdx: number;
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
    scripted: number;
    tileCache: number;
    cacheRefs: number;
  } {
    return {
      states: this.states.size,
      scripted: this.scriptedStates.size,
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
    resolution: number,
    staticSig?: number,
    cellId?: number
  ): { cacheKey: string; entry: CachedTileSource } | null {
    const useStrip =
      isAnimated && frameCount > 1 && frameCount <= STRIP_MAX_FRAMES;
    // Seeded static variant: the executed `gotoAndStop(random(...))`
    // result with per-cell frozen-child pins. Keyed by the variant
    // signature so cells whose draws matched share one bake.
    const useSeeded = !isAnimated && staticSig !== undefined && cellId !== undefined;
    const cacheKey = useStrip
      ? `strip|${bundle}:${exportName}:${resolution}`
      : useSeeded
        ? `seeded|${bundle}:${exportName}:${resolution}@${staticSig}`
        : `frame|${bundle}:${exportName}:${resolution}@${fixedFrame}`;
    return this.acquireByKey(cacheKey, () =>
      useStrip
        ? this.bakeStrip(bundle, exportName, frameCount, resolution)
        : useSeeded
          ? this.bakeSeededStatic(bundle, exportName, cellId, resolution)
          : this.bakeSingleFrame(bundle, exportName, fixedFrame, resolution)
    );
  }

  /**
   * Look up / bake a shared cache entry and take one refcount on it.
   * All shared tile GPU textures (strips, frames, seeded statics,
   * scripted-part runs + strips) flow through here so refcounting
   * stays uniform.
   */
  private acquireByKey(
    cacheKey: string,
    bake: () => CachedTileSource | null
  ): { cacheKey: string; entry: CachedTileSource } | null {
    let entry = this.tileCache.get(cacheKey);
    if (!entry) {
      const baked = bake();
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
    return this.wrapSingle(
      result,
      `tile-${bundle}:${exportName}@${frame}@${resolution}`
    );
  }

  /**
   * Bake the canonical STATIC variant chosen by the tile's executed
   * frame-1 script for this cell (frame + frozen-child pins applied
   * wasm-side) — canonical replacement for the old `cellId %
   * frameCount` heuristic.
   */
  private bakeSeededStatic(
    bundle: string,
    exportName: string,
    cellId: number,
    resolution: number
  ): CachedTileSource | null {
    const result = renderSwfTileStaticSeeded(
      bundle,
      exportName,
      cellId,
      resolution
    );
    if (!result) return null;
    return this.wrapSingle(
      result,
      `tile-seeded-${bundle}:${exportName}@${resolution}`
    );
  }

  /** Wrap a single-cell bake result into a one-frame cache entry. */
  private wrapSingle(
    result: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
      anchorX: number;
      anchorY: number;
    },
    label: string
  ): CachedTileSource {
    const source = new ImageSource({
      resource: result.bitmap,
      width: result.width,
      height: result.height,
      label,
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

  /** Wrap a strip bake result into a per-frame-sliced cache entry. */
  private wrapStrip(
    result: {
      bitmap: ImageBitmap;
      width: number;
      height: number;
      frameWidth: number;
      frameHeight: number;
      gridCols: number;
      frameCount: number;
      anchorX: number;
      anchorY: number;
    },
    label: string
  ): CachedTileSource {
    const source = new ImageSource({
      resource: result.bitmap,
      width: result.width,
      height: result.height,
      label,
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "linear",
      autoGarbageCollect: false,
    });
    uploadAndCloseBitmap(getPixiRenderer(), source, result.bitmap);
    const frames: Texture[] = new Array(result.frameCount);
    for (let i = 0; i < result.frameCount; i++) {
      const col = i % result.gridCols;
      const row = Math.floor(i / result.gridCols);
      const rect = new Rectangle(
        col * result.frameWidth,
        row * result.frameHeight,
        result.frameWidth,
        result.frameHeight
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
    // Slice the strip into per-frame Texture objects. Each cell is
    // (frameWidth × frameHeight); cells stack left-to-right then
    // wrap by `gridCols`. Anchor inside each cell is the SWF (0,0)
    // expressed as a fraction of cell dims — uniform across cells
    // by the Rust-side bounds-union construction.
    return this.wrapStrip(
      result,
      `tile-strip-${bundle}:${exportName}@${resolution}`
    );
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
      if (this.states.has(key) || this.scriptedStates.has(key)) {
        continue;
      }
      this.createSprite(key, p);
    }
    for (const key of [...this.states.keys()]) {
      if (!nextKeys.has(key)) {
        this.removeSprite(key);
      }
    }
    for (const key of [...this.scriptedStates.keys()]) {
      if (!nextKeys.has(key)) {
        this.removeScripted(key);
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
    // Scripted tiles: advance every wasm-side instance's AVM1
    // playheads at their bundles' authored fps in ONE call, then
    // fan the changed instances out to texture swaps (strip parts)
    // or re-bakes (whole fallback). Steady-state parked tiles report
    // nothing and cost ~0 (wc3 animate.rs model).
    if (this.scriptedByInst.size > 0) {
      const changed = tickTileInstances(dtMs);
      for (let c = 0; c < changed.length; c++) {
        const state = this.scriptedByInst.get(changed[c]);
        if (!state) continue;
        this.applyScriptedFrames(state);
      }
    }
    // Drain a budgeted slice of the density-upgrade queue. Keeping
    // this AFTER animation tick means a tile that swapped frame on
    // this same tick gets upgraded with its current frame index in
    // sync — animation continuity preserved across the upgrade.
    this.drainPendingUpgrade();
  }

  /**
   * Point each dynamic part of a scripted tile at its playhead's
   * current frame. Strip parts are a pure texture swap; volatile
   * parts (whole fallback / oversized strips) re-bake at the
   * instance's current composed state.
   */
  private applyScriptedFrames(state: ScriptedTileState): void {
    const pairs = tileInstanceDynFrames(state.instId);
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const part = state.parts[pairs[i]];
      if (!part) continue;
      const frame = pairs[i + 1];
      if (part.isStrip && part.cacheKey) {
        const entry = this.tileCache.get(part.cacheKey);
        if (entry && entry.frames.length > 0) {
          part.sprite.texture = entry.frames[frame % entry.frames.length];
        }
      } else {
        this.rebakeScriptedPart(state, pairs[i]);
      }
    }
    for (let i = 0; i < state.parts.length; i++) {
      if (state.parts[i].info.kind === "whole") {
        this.rebakeScriptedPart(state, i);
      }
    }
  }

  destroy(): void {
    for (const key of [...this.states.keys()]) {
      this.removeSprite(key);
    }
    for (const key of [...this.scriptedStates.keys()]) {
      this.removeScripted(key);
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
    // wc3 parity: bake density == display zoom EXACTLY (continuous
    // float, no ceil-quantization). Displaying a raster at any ratio
    // other than 1:1 bilinearly smears the twip-precise vector edges
    // (docs/WC3-PARITY-GAPS.md A.1). Clamped to MAX_TILE_RESOLUTION
    // for the wgpu texture-dimension limit; per-tile dimension safety
    // is applied in `upgradeSpriteResolution`.
    // Milli-quantized like wc3's `scale_milli` tile-cache key so
    // float jitter can't mint near-duplicate cache entries.
    const clamped =
      Math.round(Math.max(0.5, Math.min(MAX_TILE_RESOLUTION, res)) * 1000) /
      1000;
    if (Math.abs(clamped - this.tileResolution) < 1e-3) {
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
      // Backgrounds re-bake too (wc3 parity — a bg pinned at 4x
      // displays at zoom/4 forever, permanently soft). Their target
      // is dimension-clamped per sprite in `upgradeSpriteResolution`.
      if (Math.abs(state.resolution - clamped) < 1e-3) continue;
      queue.push(state);
    }
    const scriptedQueue: ScriptedTileState[] = [];
    for (const state of this.scriptedStates.values()) {
      if (Math.abs(state.resolution - clamped) < 1e-3) continue;
      scriptedQueue.push(state);
    }
    this.pendingUpgrade = queue.length > 0 || scriptedQueue.length > 0
      ? { targetRes: clamped, queue, idx: 0, scriptedQueue, scriptedIdx: 0 }
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
    // Per-sprite dimension safety: the tile's logical size is known
    // from its current texture (phys / current density). Cap the new
    // density so the re-bake stays under the wgpu texture limit —
    // this is what lets backgrounds (widest tiles) re-bake on zoom
    // instead of being pinned soft at BG_RESOLUTION.
    const tex = state.sprite.texture;
    const logicalW = tex.source.pixelWidth / state.resolution;
    const logicalH = tex.source.pixelHeight / state.resolution;
    const maxDim = Math.max(1, logicalW, logicalH);
    const safeTarget = Math.min(target, SAFE_TEXTURE_DIM / maxDim);
    if (Math.abs(safeTarget - state.resolution) < 1e-3) return true;
    const acquired = this.acquireCachedTile(
      state.bundle,
      state.exportName,
      state.currentFrame,
      state.frameCount,
      state.isAnimated,
      safeTarget,
      state.staticSig,
      state.cellId,
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
      safeTarget,
    );
    state.cacheKey = cacheKey;
    state.resolution = safeTarget;
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
      if (Math.abs(state.resolution - u.targetRes) < 1e-3) continue; // already done
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
    // Scripted tiles migrate after the plain sprites, same budget.
    if (u.idx >= u.queue.length) {
      while (u.scriptedIdx < u.scriptedQueue.length) {
        const state = u.scriptedQueue[u.scriptedIdx++];
        if (Math.abs(state.resolution - u.targetRes) < 1e-3) continue;
        if (!this.scriptedByInst.has(state.instId)) continue; // removed
        this.upgradeScriptedResolution(state, u.targetRes);
        if (performance.now() - start >= UPGRADE_BUDGET_MS) break;
      }
    }
    if (u.idx >= u.queue.length && u.scriptedIdx >= u.scriptedQueue.length) {
      this.pendingUpgrade = null;
    }
  }

  private createSprite(key: string, p: LayeredTilePlacement): void {
    // Scripted tiles (stop-parked / enterFrame-triggered children) go
    // through the per-instance path; on wasm refusal fall through to
    // the legacy sprite so the tile is never invisible.
    if (p.scripted && this.tryCreateScripted(key, p)) {
      return;
    }
    // Per-cell phase for loops: canonically every placed clip owns its
    // playhead, so identical gfx must not ripple in lockstep. The seed
    // offsets both the starting frame and the sub-frame accumulator.
    const phase = p.isAnimated ? (p.phaseSeed ?? 0) : 0;
    const initialFrame = p.isAnimated
      ? phase % Math.max(1, p.frameCount)
      : p.staticFrame;
    const isBackground = p.isBackground === true;
    const resolution = isBackground ? BG_RESOLUTION : this.tileResolution;
    const acquired = this.acquireCachedTile(
      p.bundle,
      p.exportName,
      initialFrame,
      p.frameCount,
      p.isAnimated,
      resolution,
      p.staticSig,
      p.cellId
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

    // Sub-frame phase: spread the first advance across the period so
    // same-cycle tiles don't all step on the same host tick.
    const period = p.fps > 0 ? 1000 / p.fps : 0;
    const accumMs = p.isAnimated
      ? (((phase >>> 8) & 0xffff) / 0x10000) * period
      : 0;
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
      accumMs,
      cacheKey,
      resolution,
      cellX: p.cellX,
      cellY: p.cellY,
      rotation: p.rotation,
      flip: p.flip,
      anchorFracX: entry.anchorFracX,
      anchorFracY: entry.anchorFracY,
      staticSig: p.staticSig,
      cellId: p.cellId,
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
   * Create the per-instance scripted-tile presentation: one wasm
   * instance (per-cell seeded AVM1 playheads) + stacked part sprites
   * (wc3 tile_parts model — static runs baked once, dynamic children
   * as per-frame strips, whole-scene fallback for masked wrappers).
   * Returns false when wasm refuses (caller falls back to the legacy
   * sprite path so the tile is never invisible).
   */
  private tryCreateScripted(key: string, p: LayeredTilePlacement): boolean {
    if (p.cellId === undefined) return false;
    const created = tileInstanceCreate(p.bundle, p.exportName, p.cellId);
    if (!created || !created.parts || created.parts.length === 0) {
      return false;
    }
    const resolution = this.tileResolution;
    const baseZ = Math.round(p.cellY * 100) + Math.round(p.cellX);
    const parent =
      p.layer === 0
        ? this.groundLayer
        : p.layer === 1
          ? this.object1Layer
          : this.object2Layer;
    const parts: ScriptedPartState[] = [];
    let anyContent = false;
    for (let i = 0; i < created.parts.length; i++) {
      const info = created.parts[i];
      let cacheKey: string | null = null;
      let isStrip = false;
      let volatileSource: ImageSource | null = null;
      let texture: Texture = Texture.EMPTY;
      let anchorFracX = 0;
      let anchorFracY = 0;
      const acq = this.acquireScriptedPart(
        created.instId,
        i,
        info,
        p.bundle,
        p.exportName,
        created.sig,
        resolution
      );
      if (acq) {
        cacheKey = acq.cacheKey;
        isStrip = acq.entry.frames.length > 1;
        texture =
          acq.entry.frames[(info.curFrame ?? 0) % acq.entry.frames.length];
        anchorFracX = acq.entry.anchorFracX;
        anchorFracY = acq.entry.anchorFracY;
        anyContent = true;
      } else {
        // Volatile path: whole fallback or a part whose shared bake
        // failed (e.g. strip over GPU limits) — bake the current
        // composed state, re-baked on change.
        const r = renderSwfTileInstancePart(created.instId, i, resolution);
        if (r) {
          const wrapped = this.wrapSingle(
            r,
            `tile-pvol-${p.bundle}:${p.exportName}:p${i}@${resolution}`
          );
          volatileSource = wrapped.source;
          texture = wrapped.frames[0];
          anchorFracX = wrapped.anchorFracX;
          anchorFracY = wrapped.anchorFracY;
          anyContent = true;
        }
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(anchorFracX, anchorFracY);
      applyMatrix(sprite, p.cellX, p.cellY, p.rotation, p.flip, resolution);
      // Paint order inside the tile = part order; the fractional
      // offset keeps parts stacked canonically without disturbing
      // inter-tile painter's ordering.
      sprite.zIndex = baseZ + i * 1e-3;
      parent.addChild(sprite);
      // Index in `parts` MUST match the wasm part index —
      // `tileInstanceDynFrames` pairs address parts positionally.
      parts.push({ sprite, info, cacheKey, isStrip, volatileSource });
    }
    if (!anyContent) {
      for (const part of parts) {
        part.sprite.parent?.removeChild(part.sprite);
        part.sprite.destroy({ texture: false });
      }
      tileInstanceFree(created.instId);
      return false;
    }
    const state: ScriptedTileState = {
      instId: created.instId,
      sig: created.sig,
      layer: p.layer,
      bundle: p.bundle,
      exportName: p.exportName,
      cellId: p.cellId,
      resolution,
      parts,
      cellX: p.cellX,
      cellY: p.cellY,
      rotation: p.rotation,
      flip: p.flip,
    };
    this.scriptedStates.set(key, state);
    this.scriptedByInst.set(created.instId, state);
    return true;
  }

  /**
   * Acquire the SHARED cache entry for one scripted part. Child parts
   * bake their whole frame range as a strip at the child's own union
   * bounds (per-tick animation = texture swap); run parts bake once
   * per `(export, partIdx, sig, resolution)` — instances whose random
   * draws matched share the texture. Whole parts return null (they're
   * volatile by design).
   */
  private acquireScriptedPart(
    instId: number,
    partIdx: number,
    info: TileInstancePartInfo,
    bundle: string,
    exportName: string,
    sig: number,
    resolution: number
  ): { cacheKey: string; entry: CachedTileSource } | null {
    if (info.kind === "child") {
      return this.acquireByKey(
        `tpstrip|${bundle}:${exportName}:p${partIdx}:${resolution}`,
        () => {
          const r = renderSwfTileInstancePartStrip(instId, partIdx, resolution);
          return r
            ? this.wrapStrip(
                r,
                `tile-pstrip-${bundle}:${exportName}:p${partIdx}@${resolution}`
              )
            : null;
        }
      );
    }
    if (info.kind === "run") {
      return this.acquireByKey(
        `tprun|${bundle}:${exportName}:p${partIdx}:${resolution}@${sig}`,
        () => {
          const r = renderSwfTileInstancePart(instId, partIdx, resolution);
          return r
            ? this.wrapSingle(
                r,
                `tile-prun-${bundle}:${exportName}:p${partIdx}@${resolution}`
              )
            : null;
        }
      );
    }
    return null;
  }

  /**
   * Re-bake a volatile scripted part at the instance's CURRENT
   * composed state (whole-scene fallback, or a child part whose strip
   * bake failed). Old source retires after the settle delay so an
   * in-flight Pixi pass never loses its texture mid-frame.
   */
  private rebakeScriptedPart(state: ScriptedTileState, partIdx: number): void {
    const part = state.parts[partIdx];
    if (!part) return;
    const r = renderSwfTileInstancePart(state.instId, partIdx, state.resolution);
    if (!r) return;
    const wrapped = this.wrapSingle(
      r,
      `tile-pvol-${state.bundle}:${state.exportName}:p${partIdx}@${state.resolution}`
    );
    const old = part.volatileSource;
    part.sprite.texture = wrapped.frames[0];
    part.sprite.anchor.set(wrapped.anchorFracX, wrapped.anchorFracY);
    part.volatileSource = wrapped.source;
    if (old) {
      setTimeout(() => {
        try {
          old.destroy();
        } catch {}
      }, RETIRE_DELAY_MS);
    }
  }

  /** Tear down one scripted tile: sprites, cache refs, wasm instance. */
  private removeScripted(key: string): void {
    const state = this.scriptedStates.get(key);
    if (!state) return;
    for (const part of state.parts) {
      try {
        part.sprite.parent?.removeChild(part.sprite);
        part.sprite.destroy({ texture: false });
      } catch (e) {
        log.warn("removeScripted: destroy failed", e);
      }
      if (part.cacheKey) {
        this.releaseCachedTile(part.cacheKey);
      }
      if (part.volatileSource) {
        const src = part.volatileSource;
        setTimeout(() => {
          try {
            src.destroy();
          } catch {}
        }, RETIRE_DELAY_MS);
      }
    }
    tileInstanceFree(state.instId);
    this.scriptedByInst.delete(state.instId);
    this.scriptedStates.delete(key);
  }

  /**
   * Re-rasterize every part of one scripted tile at the new density
   * (zoom-settle path). Shared entries migrate to fresh per-resolution
   * cache keys; volatile parts re-bake directly.
   */
  private upgradeScriptedResolution(
    state: ScriptedTileState,
    target: number
  ): void {
    if (Math.abs(state.resolution - target) < 1e-3) return;
    state.resolution = target;
    // Current playhead per dynamic part so strip swaps land on the
    // right frame after the migration.
    const pairs = tileInstanceDynFrames(state.instId);
    const dynFrame = new Map<number, number>();
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      dynFrame.set(pairs[i], pairs[i + 1]);
    }
    for (let i = 0; i < state.parts.length; i++) {
      const part = state.parts[i];
      if (part.cacheKey) {
        const acq = this.acquireScriptedPart(
          state.instId,
          i,
          part.info,
          state.bundle,
          state.exportName,
          state.sig,
          target
        );
        if (!acq) continue;
        const oldKey = part.cacheKey;
        part.cacheKey = acq.cacheKey;
        part.isStrip = acq.entry.frames.length > 1;
        const frame = dynFrame.get(i) ?? part.info.curFrame ?? 0;
        part.sprite.texture =
          acq.entry.frames[frame % acq.entry.frames.length];
        part.sprite.anchor.set(acq.entry.anchorFracX, acq.entry.anchorFracY);
        this.releaseCachedTile(oldKey);
      } else {
        this.rebakeScriptedPart(state, i);
      }
      applyMatrix(
        part.sprite,
        state.cellX,
        state.cellY,
        state.rotation,
        state.flip,
        target
      );
    }
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
