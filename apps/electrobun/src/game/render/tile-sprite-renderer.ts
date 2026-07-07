/**
 * TileSpriteRenderer — unified-atlas tile pipeline (Step 2,
 * docs/ARCHITECTURE-UNIFIED-ATLAS.md).
 *
 * One render contract: Vello rasterizes UNIQUE tile art into shared
 * ATLAS PAGES — exactly once per unique (art, frame/variant,
 * resolution) — and every placement is an ordinary Pixi `Sprite`
 * sampling a cell rect of a page. Pixi batches all sprites sharing a
 * page into ~1 draw. Pages are ZERO-COPY: the Vello-rendered
 * GPUTexture is adopted directly as a Pixi `ExternalSource` on the
 * shared GPUDevice (crowd-renderer pattern — no per-bake
 * `transferToImageBitmap` sync point) and released via
 * `freeRenderTexture(textureId)` when its generation retires.
 *
 * Lifecycle (the map-revisit fix): pages belong to a MAP GENERATION —
 * `(mapKey, scale_milli)`. Map change or zoom change builds a NEW
 * generation (pages baked in one Vello dispatch per bundle per page,
 * yielding to rAF between dispatches), swaps every sprite onto the new
 * pages, then retires the old generation WHOLESALE after a 2-tick
 * settle. There is NO per-tile refcounting and NO per-cell reuse — the
 * acquire/release race that left layers missing on map A→B→A revisits
 * is gone by construction. Same-generation placement changes (tactic
 * toggles) append pages for the missing specs only.
 *
 * Animation:
 *  - simple-loop tiles: their frames are consecutive cells of a page
 *    block; the per-instance phase/accumulator swaps `sprite.texture`
 *    between cell rects — zero Vello dispatch (STRIP_MAX_FRAMES
 *    preserved; longer timelines fall back to live re-bake below).
 *  - very long timelines (> STRIP_MAX_FRAMES): per-advance live
 *    re-bake into a sprite-owned volatile texture (same dispatch cost
 *    as the previous model — these are rare outliers).
 *  - scripted tiles (per-cell AVM1 playheads, wc3 tile_parts model):
 *    static runs + dynamic-child strips are baked once per generation
 *    (shared per (export, part, sig)); whole-scene fallbacks re-bake
 *    into part-owned volatile textures. Part textures retire with the
 *    generation.
 */
import {
  type Container,
  ExternalSource,
  ImageSource,
  Rectangle,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { ROT_SCALE_X, ROT_SCALE_Y } from "@/game/constants/battlefield";
import {
  freeRenderTexture,
  getPixiRenderer,
  renderSwfFrame,
  renderSwfTileAtlasPage,
  renderSwfTileInstancePart,
  renderSwfTileInstancePartStrip,
  renderSwfTileInstancePartTexture,
  rerenderSwfTileInstancePartTexture,
  tickTileInstances,
  tileInstanceCreate,
  tileInstanceDynFrames,
  tileInstanceFree,
  type TileInstancePartInfo,
  type VelloSwfStaticBaseResult,
  type VelloSwfTileStripResult,
  uploadAndCloseBitmap,
} from "@/game/render/vello-loader";
import {
  type TileBehaviorPlan,
  type TileExecutor,
  tileExecutorFor,
} from "@/game/render/tile-routing";
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
  /** Bundle-authored frames per second (loop advance rate). */
  fps: number;
  /**
   * Cell this placement occupies — the deterministic seed for the
   * canonical per-instance semantics (executed `gotoAndStop(random)`
   * variants, per-cell loop phase, per-instance trigger schedules).
   */
  cellId: number;
  /**
   * THE routing decision, made once in `placements.ts` (canonical
   * pre-engine override, or the wasm classifier's result verbatim).
   * The renderer derives its executor mechanically via
   * `tileExecutorFor` — no classification logic lives here.
   */
  plan: TileBehaviorPlan;
  /**
   * True for the single map-background placement. The background is
   * the widest art we render; its atlas item self-clamps its bake
   * resolution inside `renderSwfTileAtlasPage` so its page never
   * trips the wgpu texture limit (the sprite scale compensates via
   * the per-item `itemResMilli`).
   */
  isBackground?: boolean;
}

const log = createLogger("TileSpriteRenderer");

/**
 * Page dimension cap. 4096² BGRA = 64 MB worst case per page — big
 * enough that a typical map's unique tile set fits in 1-2 pages per
 * bundle, small enough to stay far from the wgpu 8192 texture limit
 * and to keep one page's Vello scene under the tile-encoder budget.
 */
const PAGE_MAX_DIM = 4096;
/** Starting density until the host pushes the real zoom. */
const DEFAULT_TILE_RESOLUTION = 4;
/** Upper density clamp (matches the previous pipeline). */
const MAX_TILE_RESOLUTION = 8;
const TICK_INTERVAL_MS = 1000 / 60;
/** Settle delay before destroying retired GPU sources (2 ticks). */
const RETIRE_DELAY_MS = 2 * TICK_INTERVAL_MS;

/**
 * Maximum frame count folded into an atlas strip block. Beyond this a
 * tile falls back to per-advance live re-bakes — bounds the page area
 * any single animation can claim.
 */
const STRIP_MAX_FRAMES = 150;

/**
 * Layer-tagged variant of `TilePlacement` — caller marks the
 * destination Pixi layer per tile. MapHandler emits this when
 * building placements: ground tiles → layer 0, object1 tiles → 1.
 */
export interface LayeredTilePlacement extends TilePlacement {
  layer: 0 | 1 | 2;
}

/** One unique bake request (atlas cell / strip block) for a generation. */
interface TileBakeSpec {
  key: string;
  bundle: string;
  exportName: string;
  /** 0 = fixed frame, 1 = seeded static, 2 = loop strip. */
  kind: 0 | 1 | 2;
  /** kind 0: frame; kind 1: representative cellId; kind 2: frameCount. */
  param: number;
}

/** One baked atlas entry: per-frame cell textures over a page source. */
interface AtlasEntry {
  /** Per-frame Texture instances (length 1 for single-cell items). */
  frames: Texture[];
  /** SWF (0,0) anchor inside ONE cell, as a fraction of cell dims. */
  anchorFracX: number;
  anchorFracY: number;
  /** ACTUAL bake density (post dimension-clamp — see the bg doc). */
  resolution: number;
}

/**
 * One zero-copy atlas page: the Pixi `ExternalSource` adopting the
 * Vello-rendered GPUTexture (shared GPUDevice) + the wasm-side id that
 * releases the underlying storage (`freeRenderTexture`).
 */
interface AtlasPage {
  source: ExternalSource;
  textureId: number;
  bytes: number;
}

/**
 * One map generation: the atlas pages + entry map for a
 * (mapKey, resolution) pair. Retired WHOLESALE — pages and shared
 * scripted-part textures are destroyed together after the settle
 * delay, never per-entry.
 */
interface TileGeneration {
  id: number;
  resMilli: number;
  mapKey: string | null;
  pages: AtlasPage[];
  pageBytes: number;
  /** specKey → entry; `null` = known-unbakeable (don't retry). */
  entries: Map<string, AtlasEntry | null>;
  /** Scripted-part shared bakes (runs + child strips), lazily added. */
  scriptedShared: Map<string, { source: ImageSource; entry: AtlasEntry }>;
}

interface TileSpriteState {
  sprite: Sprite;
  layer: 0 | 1 | 2;
  bundle: string;
  exportName: string;
  frameCount: number;
  fps: number;
  isAnimated: boolean;
  currentFrame: number;
  accumMs: number;
  /** Spec key into the live generation's `entries`. */
  specKey: string;
  /** Actual bake density of the current textures. */
  resolution: number;
  /** Current generation entry's frame textures (never destroyed here —
   *  they belong to the generation). */
  frames: Texture[];
  /** Live re-bake ownership for long-timeline outliers. */
  volatileSource: ImageSource | null;
  // Cell context — for re-applying the matrix on retexture.
  cellX: number;
  cellY: number;
  rotation: number;
  flip: boolean;
}

/**
 * One paint-ordered slice of a live scripted tile. Shared parts (runs
 * + child strips) reference generation-owned textures; whole-scene
 * fallbacks re-bake IN PLACE into a part-owned persistent GPU texture;
 * child parts whose strip bake failed re-bake into a volatile source.
 */
interface ScriptedPartState {
  sprite: Sprite;
  info: TileInstancePartInfo;
  /** Generation-owned frame textures (null for volatile parts). */
  frames: Texture[] | null;
  /** Privately-owned source for volatile parts. Replaced on re-bake. */
  volatileSource: ImageSource | null;
  /**
   * Whole-scene fallback parts only: the part-owned PERSISTENT render
   * target. Re-bakes render into the same GPU storage
   * (`rerenderSwfTileInstancePartTexture`) so per-tick animation of a
   * masked wrapper allocates NOTHING — the bitmap-per-re-bake model
   * churned ~3.9 GB/120 ticks through the deferred-destroy GC on
   * map 951. Reallocated only when dims change (resolution swap).
   */
  persistent: { source: ExternalSource; textureId: number } | null;
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

/** Initial frame for an executor (loop phase seed / fixed pick). */
function initialFrameFor(exec: TileExecutor): number {
  return exec.mode === "strip"
    ? exec.phaseSeed % Math.max(1, exec.cycle)
    : 0;
}

/**
 * The unique bake spec an executor samples, or null for instance
 * (scripted) tiles — their parts bake per-instance at create time.
 * Pure raster packaging over `tileExecutorFor`'s result; the ONLY
 * routing decision here is the STRIP_MAX_FRAMES page-area bound
 * (over-long loops fall back to per-advance live re-bakes from a
 * single fixed cell — they still animate).
 */
function specForExecutor(
  p: LayeredTilePlacement,
  exec: TileExecutor
): TileBakeSpec | null {
  if (exec.mode === "instance") return null;
  if (exec.mode === "strip") {
    if (exec.cycle <= STRIP_MAX_FRAMES) {
      return {
        key: `strip|${p.bundle}:${p.exportName}:${exec.cycle}`,
        bundle: p.bundle,
        exportName: p.exportName,
        kind: 2,
        param: exec.cycle,
      };
    }
    const frame = initialFrameFor(exec);
    return {
      key: `frame|${p.bundle}:${p.exportName}@${frame}`,
      bundle: p.bundle,
      exportName: p.exportName,
      kind: 0,
      param: frame,
    };
  }
  if (exec.mode === "seeded") {
    return {
      // Keyed by the variant SIGNATURE (frame + frozen-child pins) so
      // cells whose random draws matched share one cell; the param is
      // a representative cellId — any cell with this sig reproduces
      // the identical bake.
      key: `seeded|${p.bundle}:${p.exportName}@${exec.sig}`,
      bundle: p.bundle,
      exportName: p.exportName,
      kind: 1,
      param: p.cellId,
    };
  }
  return {
    key: `frame|${p.bundle}:${p.exportName}@${exec.frame}`,
    bundle: p.bundle,
    exportName: p.exportName,
    kind: 0,
    param: exec.frame,
  };
}

function specForPlacement(p: LayeredTilePlacement): TileBakeSpec | null {
  return specForExecutor(p, tileExecutorFor(p.plan));
}

/**
 * Yield until the next animation frame so the deferred-destroy queue
 * and Pixi upload machinery get their turn between page dispatches
 * (synchronous multi-bake sweeps have OOM'd hosts before). Raced with
 * a timeout so a hidden tab can't stall a map build forever.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
    }
    setTimeout(finish, 50);
  });
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

  /** Live atlas generation (null until the first sync completes). */
  private generation: TileGeneration | null = null;
  private genSeq = 0;

  // Desired state — the sync loop converges the scene onto this.
  private desiredPlacements: LayeredTilePlacement[] = [];
  private desiredMapKey: string | null = null;
  private desiredResMilli = DEFAULT_TILE_RESOLUTION * 1000;
  private dirty = false;
  private syncing = false;
  private destroyed = false;
  /** Resolvers parked by `whenConverged()` — flushed every time the
   *  convergence loop drains (and on destroy, so callers never hang). */
  private convergedWaiters: Array<() => void> = [];
  /** Throttle for missing-entry warnings (one per spec key). */
  private warnedSpecs = new Set<string>();

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
    pages: number;
    pageBytes: number;
    entries: number;
    scriptedTextures: number;
  } {
    return {
      states: this.states.size,
      scripted: this.scriptedStates.size,
      pages: this.generation?.pages.length ?? 0,
      pageBytes: this.generation?.pageBytes ?? 0,
      entries: this.generation?.entries.size ?? 0,
      scriptedTextures: this.generation?.scriptedShared.size ?? 0,
    };
  }

  /**
   * Declare the desired placement set. `mapKey` identifies the map —
   * a DIFFERENT key forces a fresh atlas generation (whole-page
   * eviction of the previous map's art after the swap); the SAME key
   * (tactic toggles, incremental rebuilds) appends pages for missing
   * specs only. The scene converges asynchronously: existing sprites
   * stay visible until the new generation's pages are baked.
   */
  setPlacements(
    placements: ReadonlyArray<LayeredTilePlacement>,
    mapKey: string | null = null
  ): void {
    this.desiredPlacements = [...placements];
    this.desiredMapKey = mapKey;
    this.requestSync();
  }

  /**
   * Declare the desired rasterization density (wc3 parity: bake
   * density == display zoom, milli-quantized like wc3's `scale_milli`
   * cache key). A change starts a NEW generation at the new density;
   * sprites keep their animation state (`currentFrame`, `accumMs`)
   * and swap onto the new pages when the bake lands.
   */
  setTileResolution(res: number): void {
    const clamped = Math.round(
      Math.max(0.5, Math.min(MAX_TILE_RESOLUTION, res)) * 1000
    );
    if (clamped === this.desiredResMilli) {
      return;
    }
    this.desiredResMilli = clamped;
    this.requestSync();
  }

  private requestSync(): void {
    if (this.destroyed) return;
    this.dirty = true;
    if (!this.syncing) {
      void this.runSync();
    }
  }

  /**
   * Resolves once the convergence loop has fully applied the LATEST
   * desired state — every atlas page baked and every sprite
   * reconciled onto the live generation. Resolves immediately when
   * already converged (or destroyed). Never rejects. Used by the
   * map-reveal gate (unified-atlas Step 4) as the "tiles ready" half
   * of the reveal condition — the wc3 analogue is
   * `gate_map_reveal`'s tiles_ready check
   * (dofuswebclient3/rust/client render_tiles/reveal.rs:90-94).
   */
  whenConverged(): Promise<void> {
    if (this.destroyed || (!this.dirty && !this.syncing)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.convergedWaiters.push(resolve));
  }

  private flushConvergedWaiters(): void {
    if (this.convergedWaiters.length === 0) return;
    const waiters = this.convergedWaiters;
    this.convergedWaiters = [];
    for (const w of waiters) w();
  }

  /**
   * Single-flight convergence loop. Snapshots the desired state,
   * bakes whatever pages it needs (yielding to rAF between page
   * dispatches), then reconciles sprites. If the desired state moved
   * while baking, loops again — a fresh-but-stale generation is
   * retired immediately (its textures were never displayed).
   */
  private async runSync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      while (this.dirty && !this.destroyed) {
        this.dirty = false;
        const placements = this.desiredPlacements;
        const mapKey = this.desiredMapKey;
        const resMilli = this.desiredResMilli;
        const specs = this.collectSpecs(placements);
        const cur = this.generation;
        const needFresh =
          !cur || cur.resMilli !== resMilli || cur.mapKey !== mapKey;
        if (needFresh) {
          const next: TileGeneration = {
            id: ++this.genSeq,
            resMilli,
            mapKey,
            pages: [],
            pageBytes: 0,
            entries: new Map(),
            scriptedShared: new Map(),
          };
          await this.bakeSpecs(next, specs);
          if (this.destroyed || this.dirty) {
            // Stale before it ever displayed — drop it now.
            this.retireGeneration(next, 0);
            continue;
          }
          const old = this.generation;
          this.generation = next;
          this.reconcile(placements, true);
          if (old) {
            this.retireGeneration(old, RETIRE_DELAY_MS);
          }
        } else {
          const missing = specs.filter((s) => !cur.entries.has(s.key));
          if (missing.length > 0) {
            await this.bakeSpecs(cur, missing);
            if (this.destroyed || this.dirty) {
              // Pages already belong to the live generation — keep
              // them and re-run with the fresh desired state.
              continue;
            }
          }
          this.reconcile(placements, false);
        }
      }
    } finally {
      this.syncing = false;
      // The loop only exits with `dirty === false` (or destroyed) —
      // either way the latest desired state is as-applied-as-it-will-
      // ever-be, so parked reveal-gate waiters can proceed.
      this.flushConvergedWaiters();
    }
  }

  /** Unique bake specs for a placement list (scripted tiles excluded). */
  private collectSpecs(
    placements: ReadonlyArray<LayeredTilePlacement>
  ): TileBakeSpec[] {
    const byKey = new Map<string, TileBakeSpec>();
    for (const p of placements) {
      const spec = specForPlacement(p);
      if (spec && !byKey.has(spec.key)) {
        byKey.set(spec.key, spec);
      }
    }
    return [...byKey.values()];
  }

  /**
   * Bake `specs` into `gen`'s pages: group by bundle, then request
   * pages until every spec is placed or marked unbakeable. ONE Vello
   * dispatch per page; a rAF yield between dispatches keeps the
   * deferred-destroy queue draining and the main thread responsive.
   */
  private async bakeSpecs(
    gen: TileGeneration,
    specs: ReadonlyArray<TileBakeSpec>
  ): Promise<void> {
    const byBundle = new Map<string, TileBakeSpec[]>();
    for (const s of specs) {
      if (gen.entries.has(s.key)) continue;
      const list = byBundle.get(s.bundle);
      if (list) list.push(s);
      else byBundle.set(s.bundle, [s]);
    }
    let firstDispatch = true;
    for (const [bundle, list] of byBundle) {
      let remaining = list;
      while (remaining.length > 0) {
        if (this.destroyed) return;
        if (!firstDispatch) {
          await nextFrame();
          if (this.destroyed) return;
        }
        firstDispatch = false;
        const kinds = new Uint32Array(remaining.length);
        const params = new Uint32Array(remaining.length);
        for (let i = 0; i < remaining.length; i++) {
          kinds[i] = remaining[i].kind;
          params[i] = remaining[i].param >>> 0;
        }
        const pixiRenderer = getPixiRenderer();
        const res = pixiRenderer
          ? renderSwfTileAtlasPage(
              bundle,
              remaining.map((s) => s.exportName),
              kinds,
              params,
              gen.resMilli / 1000,
              PAGE_MAX_DIM
            )
          : null;
        if (!res) {
          // Bundle missing / renderer halted / all-degenerate — mark
          // every remaining spec unbakeable so we never spin.
          for (const s of remaining) gen.entries.set(s.key, null);
          break;
        }
        // Zero-copy adoption of the Vello page texture on the shared
        // GPUDevice (crowd-renderer pattern) — no bitmap roundtrip.
        const source = new ExternalSource({
          resource: res.texture,
          renderer: pixiRenderer!,
          width: res.width,
          height: res.height,
          label: `tile-page-g${gen.id}-${gen.pages.length}-${bundle}`,
        });
        source.alphaMode = "no-premultiply-alpha";
        source.scaleMode = "linear";
        source.format = "rgba8unorm";
        source.autoGarbageCollect = false;
        gen.pages.push({
          source,
          textureId: res.textureId,
          bytes: res.width * res.height * 4,
        });
        gen.pageBytes += res.width * res.height * 4;

        const next: TileBakeSpec[] = [];
        let progressed = false;
        for (let i = 0; i < remaining.length; i++) {
          const s = remaining[i];
          if (!res.itemValid[i]) {
            gen.entries.set(s.key, null);
            progressed = true;
            continue;
          }
          if (!res.itemPlaced[i]) {
            next.push(s);
            continue;
          }
          progressed = true;
          const fw = res.itemFrameW[i];
          const fh = res.itemFrameH[i];
          const count = Math.max(1, res.itemFrameCount[i]);
          const cols = Math.max(1, res.itemGridCols[i]);
          const frames: Texture[] = new Array(count);
          for (let f = 0; f < count; f++) {
            const cx = res.itemX[i] + (f % cols) * fw;
            const cy = res.itemY[i] + Math.floor(f / cols) * fh;
            frames[f] = new Texture({
              source,
              frame: new Rectangle(cx, cy, fw, fh),
            });
          }
          gen.entries.set(s.key, {
            frames,
            anchorFracX: fw > 0 ? res.itemAnchorX[i] / fw : 0,
            anchorFracY: fh > 0 ? res.itemAnchorY[i] / fh : 0,
            resolution: Math.max(0.001, res.itemResMilli[i] / 1000),
          });
        }
        if (!progressed) {
          // Defensive: a page that placed nothing new would loop
          // forever. Mark the stragglers unbakeable and move on.
          for (const s of next) gen.entries.set(s.key, null);
          break;
        }
        remaining = next;
      }
    }
  }

  /**
   * Converge live sprites onto `placements` against the CURRENT
   * generation. `retexture` re-points surviving sprites at the new
   * generation's textures (zoom / map-revisit swap) while preserving
   * their animation state.
   */
  private reconcile(
    placements: ReadonlyArray<LayeredTilePlacement>,
    retexture: boolean
  ): void {
    const gen = this.generation;
    if (!gen) return;
    const nextKeys = new Set<string>();
    for (const p of placements) {
      const key = tileKey(p);
      nextKeys.add(key);
      const existing = this.states.get(key);
      if (existing) {
        if (retexture) this.retextureState(existing, gen);
        continue;
      }
      const scripted = this.scriptedStates.get(key);
      if (scripted) {
        if (retexture) this.retextureScripted(scripted, gen);
        continue;
      }
      this.createSprite(key, p, gen);
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
   * Per-tick frame advance for animated tiles + scripted-instance
   * fan-out. Static tiles are no-ops (their sprite was set up once
   * and never changes).
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
  }

  /**
   * Advance an animated tile to `state.currentFrame`. Strip entries
   * collapse to swapping the sprite's `texture` between page cell
   * rects — **no Vello dispatch**. Long-timeline outliers (single-cell
   * entries with frameCount > 1) live re-bake the new frame into a
   * sprite-owned volatile texture, exactly like the previous model.
   */
  private swapFrame(state: TileSpriteState): void {
    if (state.frames.length > 1) {
      state.sprite.texture =
        state.frames[state.currentFrame % state.frames.length];
      return;
    }
    // Outlier live re-bake path.
    const r = renderSwfFrame(
      state.bundle,
      state.exportName,
      state.currentFrame,
      state.resolution
    );
    if (!r) return;
    const wrapped = this.wrapSingle(
      r,
      `tile-vol-${state.bundle}:${state.exportName}@${state.currentFrame}`,
      state.resolution
    );
    const old = state.volatileSource;
    state.sprite.texture = wrapped.entry.frames[0];
    state.sprite.anchor.set(
      wrapped.entry.anchorFracX,
      wrapped.entry.anchorFracY
    );
    state.volatileSource = wrapped.source;
    if (old) {
      this.destroySourceLater(old);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.flushConvergedWaiters();
    for (const key of [...this.states.keys()]) {
      this.removeSprite(key);
    }
    for (const key of [...this.scriptedStates.keys()]) {
      this.removeScripted(key);
    }
    if (this.generation) {
      this.retireGeneration(this.generation, RETIRE_DELAY_MS);
      this.generation = null;
    }
    this.desiredPlacements = [];
  }

  /** Destroy one retired GPU source after the 2-tick settle. */
  private destroySourceLater(source: ImageSource): void {
    setTimeout(() => {
      try {
        source.destroy();
      } catch {
        // already destroyed
      }
    }, RETIRE_DELAY_MS);
  }

  /**
   * Retire a whole generation: destroy every page source (and release
   * its wasm-side wgpu texture via `freeRenderTexture` — the patched
   * fork's Drop is a no-op, see `feedback_pixi_wgpu_texture_lifetime`)
   * plus every shared scripted-part source after `delayMs` (0 for
   * never-displayed generations). Whole-page eviction ONLY — no
   * per-cell reuse, per RENDER_AUDIT findings.
   */
  private retireGeneration(gen: TileGeneration, delayMs: number): void {
    const doRetire = () => {
      for (const page of gen.pages) {
        try {
          page.source.destroy();
        } catch {
          // already destroyed
        }
        freeRenderTexture(page.textureId);
      }
      for (const shared of gen.scriptedShared.values()) {
        try {
          shared.source.destroy();
        } catch {
          // already destroyed
        }
      }
      gen.pages = [];
      gen.pageBytes = 0;
      gen.entries.clear();
      gen.scriptedShared.clear();
    };
    if (delayMs <= 0) {
      doRetire();
    } else {
      setTimeout(doRetire, delayMs);
    }
  }

  private createSprite(
    key: string,
    p: LayeredTilePlacement,
    gen: TileGeneration
  ): void {
    const exec = tileExecutorFor(p.plan);
    // Instance (scripted) tiles — stop-parked / enterFrame-triggered
    // children — go through the per-instance path; they bake no atlas
    // spec, so a wasm refusal leaves the placement unrendered (error
    // path, matches the classifier-refusal contract).
    if (exec.mode === "instance") {
      this.tryCreateScripted(key, p, gen);
      return;
    }
    const spec = specForExecutor(p, exec);
    if (!spec) return;
    const entry = gen.entries.get(spec.key);
    if (!entry) {
      if (!this.warnedSpecs.has(spec.key)) {
        this.warnedSpecs.add(spec.key);
        log.warn(`createSprite: no atlas entry for ${spec.key}`);
      }
      return;
    }
    const isAnimated = exec.mode === "strip";
    const frameCount = isAnimated ? Math.max(1, exec.cycle) : 1;
    const initialFrame = initialFrameFor(exec);
    const sprite = new Sprite(entry.frames[initialFrame % entry.frames.length]);
    sprite.anchor.set(entry.anchorFracX, entry.anchorFracY);
    applyMatrix(sprite, p.cellX, p.cellY, p.rotation, p.flip, entry.resolution);
    // Painter's-order zIndex inside the layer: lower-cellY (back rows)
    // render first so higher-cellY (front rows) overlap correctly.
    // Mirrors canonical MapHandler depth convention.
    sprite.zIndex = Math.round(p.cellY * 100) + Math.round(p.cellX);
    this.layerFor(p.layer).addChild(sprite);

    // Sub-frame phase: spread the first advance across the period so
    // same-cycle tiles don't all step on the same host tick.
    const phase = exec.mode === "strip" ? exec.phaseSeed : 0;
    const period = p.fps > 0 ? 1000 / p.fps : 0;
    const accumMs = isAnimated
      ? (((phase >>> 8) & 0xffff) / 0x10000) * period
      : 0;
    this.states.set(key, {
      sprite,
      layer: p.layer,
      bundle: p.bundle,
      exportName: p.exportName,
      frameCount,
      fps: p.fps,
      isAnimated,
      currentFrame: initialFrame,
      accumMs,
      specKey: spec.key,
      resolution: entry.resolution,
      frames: entry.frames,
      volatileSource: null,
      cellX: p.cellX,
      cellY: p.cellY,
      rotation: p.rotation,
      flip: p.flip,
    });
  }

  private layerFor(layer: 0 | 1 | 2): Container {
    return layer === 0
      ? this.groundLayer
      : layer === 1
        ? this.object1Layer
        : this.object2Layer;
  }

  /**
   * Re-point one surviving sprite at the (new) generation's textures,
   * preserving its animation playhead. A spec that failed at the new
   * density blanks the sprite (old texture is retiring) — logged, and
   * self-heals on the next generation.
   */
  private retextureState(state: TileSpriteState, gen: TileGeneration): void {
    const entry = gen.entries.get(state.specKey);
    if (!entry) {
      if (!this.warnedSpecs.has(state.specKey)) {
        this.warnedSpecs.add(state.specKey);
        log.warn(`retexture: no atlas entry for ${state.specKey}`);
      }
      state.sprite.texture = Texture.EMPTY;
      state.frames = [];
      return;
    }
    state.frames = entry.frames;
    state.resolution = entry.resolution;
    state.sprite.anchor.set(entry.anchorFracX, entry.anchorFracY);
    state.sprite.texture =
      entry.frames[state.currentFrame % entry.frames.length];
    applyMatrix(
      state.sprite,
      state.cellX,
      state.cellY,
      state.rotation,
      state.flip,
      entry.resolution
    );
    // The outlier volatile texture (if any) was baked at the old
    // density; drop it — the next advance re-bakes at the new one.
    if (state.volatileSource) {
      this.destroySourceLater(state.volatileSource);
      state.volatileSource = null;
    }
  }

  private removeSprite(key: string): void {
    const state = this.states.get(key);
    if (!state) {
      return;
    }
    try {
      state.sprite.parent?.removeChild(state.sprite);
      // The sprite's texture belongs to the generation (or the
      // volatile source below) — never destroy it here.
      state.sprite.destroy({ texture: false });
    } catch (e) {
      log.warn("removeSprite: destroy failed", e);
    }
    if (state.volatileSource) {
      this.destroySourceLater(state.volatileSource);
      state.volatileSource = null;
    }
    this.states.delete(key);
  }

  // ── Scripted tiles (per-instance AVM1 playheads) ──────────────────

  /**
   * Create the per-instance scripted-tile presentation: one wasm
   * instance (per-cell seeded AVM1 playheads) + stacked part sprites
   * (wc3 tile_parts model — static runs baked once per generation,
   * dynamic children as per-frame strips, whole-scene fallback for
   * masked wrappers). Returns false when wasm refuses (caller falls
   * back to the plain sprite path so the tile is never invisible).
   */
  private tryCreateScripted(
    key: string,
    p: LayeredTilePlacement,
    gen: TileGeneration
  ): boolean {
    const created = tileInstanceCreate(p.bundle, p.exportName, p.cellId);
    if (!created || !created.parts || created.parts.length === 0) {
      return false;
    }
    const resolution = gen.resMilli / 1000;
    const baseZ = Math.round(p.cellY * 100) + Math.round(p.cellX);
    const parent = this.layerFor(p.layer);
    const parts: ScriptedPartState[] = [];
    let anyContent = false;
    for (let i = 0; i < created.parts.length; i++) {
      const info = created.parts[i];
      const sprite = new Sprite(Texture.EMPTY);
      const part: ScriptedPartState = {
        sprite,
        info,
        frames: null,
        volatileSource: null,
        persistent: null,
      };
      const shared = this.acquireScriptedPart(
        gen,
        created.instId,
        i,
        info,
        p.bundle,
        p.exportName,
        created.sig
      );
      if (shared) {
        part.frames = shared.frames;
        sprite.texture =
          shared.frames[(info.curFrame ?? 0) % shared.frames.length];
        sprite.anchor.set(shared.anchorFracX, shared.anchorFracY);
        anyContent = true;
      } else if (info.kind === "whole") {
        // Whole-scene fallback (masked wrapper): part-owned PERSISTENT
        // texture; per-change re-bakes render into the same storage.
        if (this.bakeWholePartPersistent(created.instId, i, part, resolution)) {
          anyContent = true;
        }
      } else {
        // Volatile path: a child part whose shared strip bake failed
        // (e.g. over GPU limits) — bake the current composed state,
        // re-baked on change.
        const r = renderSwfTileInstancePart(created.instId, i, resolution);
        if (r) {
          const wrapped = this.wrapSingle(
            r,
            `tile-pvol-${p.bundle}:${p.exportName}:p${i}@g${gen.id}`,
            resolution
          );
          part.volatileSource = wrapped.source;
          sprite.texture = wrapped.entry.frames[0];
          sprite.anchor.set(
            wrapped.entry.anchorFracX,
            wrapped.entry.anchorFracY
          );
          anyContent = true;
        }
      }
      applyMatrix(sprite, p.cellX, p.cellY, p.rotation, p.flip, resolution);
      // Paint order inside the tile = part order; the fractional
      // offset keeps parts stacked canonically without disturbing
      // inter-tile painter's ordering.
      sprite.zIndex = baseZ + i * 1e-3;
      parent.addChild(sprite);
      // Index in `parts` MUST match the wasm part index —
      // `tileInstanceDynFrames` pairs address parts positionally.
      parts.push(part);
    }
    if (!anyContent) {
      for (const part of parts) {
        part.sprite.parent?.removeChild(part.sprite);
        part.sprite.destroy({ texture: false });
        if (part.persistent) {
          this.destroyPersistentLater(part.persistent);
          part.persistent = null;
        }
        if (part.volatileSource) {
          this.destroySourceLater(part.volatileSource);
          part.volatileSource = null;
        }
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
   * Acquire the generation-shared bake for one scripted part. Child
   * parts bake their whole frame range as a strip at the child's own
   * union bounds (per-tick animation = texture swap); run parts bake
   * once per `(export, partIdx, sig)` — instances whose random draws
   * matched share the texture. Whole parts return null (volatile by
   * design). Shared sources retire WITH the generation.
   */
  private acquireScriptedPart(
    gen: TileGeneration,
    instId: number,
    partIdx: number,
    info: TileInstancePartInfo,
    bundle: string,
    exportName: string,
    sig: number
  ): AtlasEntry | null {
    if (info.kind === "whole") return null;
    const key =
      info.kind === "child"
        ? `tpstrip|${bundle}:${exportName}:p${partIdx}`
        : `tprun|${bundle}:${exportName}:p${partIdx}@${sig}`;
    const hit = gen.scriptedShared.get(key);
    if (hit) return hit.entry;
    const resolution = gen.resMilli / 1000;
    let wrapped: { source: ImageSource; entry: AtlasEntry } | null = null;
    if (info.kind === "child") {
      const r = renderSwfTileInstancePartStrip(instId, partIdx, resolution);
      if (r) {
        wrapped = this.wrapStrip(
          r,
          `tile-pstrip-${bundle}:${exportName}:p${partIdx}@g${gen.id}`,
          resolution
        );
      }
    } else {
      const r = renderSwfTileInstancePart(instId, partIdx, resolution);
      if (r) {
        wrapped = this.wrapSingle(
          r,
          `tile-prun-${bundle}:${exportName}:p${partIdx}@g${gen.id}`,
          resolution
        );
      }
    }
    if (!wrapped) return null;
    gen.scriptedShared.set(key, wrapped);
    return wrapped.entry;
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
      if (part.frames && part.frames.length > 0) {
        part.sprite.texture = part.frames[frame % part.frames.length];
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

  /**
   * Re-bake a volatile scripted part at the instance's CURRENT
   * composed state. Whole-scene fallbacks (masked wrappers — wc3's
   * `plan_tile_parts` refuses them identically,
   * dofuswebclient3/rust/swf-spike/src/render/tile_parts.rs:82) render
   * IN PLACE into the part's persistent texture: they re-bake at
   * bundle fps, and the previous create-bitmap/destroy-source cycle
   * pushed ~3.9 GB/120 ticks of allocation churn through the
   * deferred-destroy GC on map 951 (the historical crash class).
   * Child parts whose strip bake failed keep the volatile-source model
   * (rare, and their dims vary per frame); the old source retires
   * after the settle delay so an in-flight Pixi pass never loses its
   * texture mid-frame.
   */
  private rebakeScriptedPart(state: ScriptedTileState, partIdx: number): void {
    const part = state.parts[partIdx];
    if (!part) return;
    if (part.info.kind === "whole") {
      this.bakeWholePartPersistent(
        state.instId,
        partIdx,
        part,
        state.resolution
      );
      return;
    }
    const r = renderSwfTileInstancePart(state.instId, partIdx, state.resolution);
    if (!r) return;
    const wrapped = this.wrapSingle(
      r,
      `tile-pvol-${state.bundle}:${state.exportName}:p${partIdx}`,
      state.resolution
    );
    const old = part.volatileSource;
    part.sprite.texture = wrapped.entry.frames[0];
    part.sprite.anchor.set(wrapped.entry.anchorFracX, wrapped.entry.anchorFracY);
    part.volatileSource = wrapped.source;
    if (old) {
      this.destroySourceLater(old);
    }
  }

  /**
   * (Re-)bake a whole-scene fallback part into its part-owned
   * PERSISTENT texture. Fast path: the part already has a persistent
   * target and its dims still match (whole parts size against the
   * memoized full-anim union, so this holds until a resolution swap) —
   * Vello re-renders into the SAME GPU storage and the sprite's
   * texture binding is untouched. Zero allocation, nothing enters the
   * deferred-destroy queue. Slow path (first bake / resolution swap):
   * allocate a new persistent texture, adopt it zero-copy as an
   * `ExternalSource` on the shared device, retire the old one after
   * the 2-tick settle (`freeRenderTexture`,
   * `feedback_pixi_wgpu_texture_lifetime`). Returns true when the
   * sprite has renderable content.
   */
  private bakeWholePartPersistent(
    instId: number,
    partIdx: number,
    part: ScriptedPartState,
    resolution: number
  ): boolean {
    if (
      part.persistent &&
      rerenderSwfTileInstancePartTexture(
        instId,
        partIdx,
        resolution,
        part.persistent.textureId
      )
    ) {
      return true;
    }
    const r = renderSwfTileInstancePartTexture(instId, partIdx, resolution);
    if (!r) return part.persistent !== null;
    const pixiRenderer = getPixiRenderer();
    if (!pixiRenderer) {
      // Never displayed — release the storage immediately.
      freeRenderTexture(r.textureId);
      return part.persistent !== null;
    }
    const source = new ExternalSource({
      resource: r.texture,
      renderer: pixiRenderer,
      width: r.width,
      height: r.height,
      label: `tile-pwhole-${instId}:p${partIdx}`,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.scaleMode = "linear";
    source.format = "rgba8unorm";
    source.autoGarbageCollect = false;
    const old = part.persistent;
    part.sprite.texture = new Texture({ source });
    part.sprite.anchor.set(
      r.width > 0 ? r.anchorX / r.width : 0,
      r.height > 0 ? r.anchorY / r.height : 0
    );
    part.persistent = { source, textureId: r.textureId };
    if (old) {
      this.destroyPersistentLater(old);
    }
    return true;
  }

  /**
   * Destroy a retired persistent part target after the 2-tick settle:
   * the Pixi source AND the wasm-side wgpu texture (the patched
   * fork's Drop is a no-op — `freeRenderTexture` is the only release,
   * see `feedback_pixi_wgpu_texture_lifetime`).
   */
  private destroyPersistentLater(p: {
    source: ExternalSource;
    textureId: number;
  }): void {
    setTimeout(() => {
      try {
        p.source.destroy();
      } catch {
        // already destroyed
      }
      freeRenderTexture(p.textureId);
    }, RETIRE_DELAY_MS);
  }

  /**
   * Re-acquire every part of one surviving scripted tile from the new
   * generation (zoom / revisit swap). The wasm instance — and with it
   * every child playhead — persists; only the textures migrate.
   */
  private retextureScripted(
    state: ScriptedTileState,
    gen: TileGeneration
  ): void {
    const target = gen.resMilli / 1000;
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
      if (part.info.kind === "whole") {
        this.rebakeScriptedPart(state, i);
      } else {
        const shared = this.acquireScriptedPart(
          gen,
          state.instId,
          i,
          part.info,
          state.bundle,
          state.exportName,
          state.sig
        );
        if (shared) {
          part.frames = shared.frames;
          const frame = dynFrame.get(i) ?? part.info.curFrame ?? 0;
          part.sprite.texture = shared.frames[frame % shared.frames.length];
          part.sprite.anchor.set(shared.anchorFracX, shared.anchorFracY);
          if (part.volatileSource) {
            this.destroySourceLater(part.volatileSource);
            part.volatileSource = null;
          }
        } else {
          part.frames = null;
          this.rebakeScriptedPart(state, i);
        }
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

  /** Tear down one scripted tile: sprites, volatile sources, wasm instance. */
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
      if (part.volatileSource) {
        this.destroySourceLater(part.volatileSource);
        part.volatileSource = null;
      }
      // Shared part textures belong to the generation — retired
      // wholesale with it, never here.
    }
    tileInstanceFree(state.instId);
    this.scriptedByInst.delete(state.instId);
    this.scriptedStates.delete(key);
  }

  // ── Bitmap wrapping helpers (volatile / scripted-part bakes) ──────

  /** Wrap a single-cell bake result into a one-frame entry. */
  private wrapSingle(
    result: VelloSwfStaticBaseResult,
    label: string,
    resolution: number
  ): { source: ImageSource; entry: AtlasEntry } {
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
    return {
      source,
      entry: {
        frames: [texture],
        anchorFracX: result.width > 0 ? result.anchorX / result.width : 0,
        anchorFracY: result.height > 0 ? result.anchorY / result.height : 0,
        resolution,
      },
    };
  }

  /** Wrap a strip bake result into a per-frame-sliced entry. */
  private wrapStrip(
    result: VelloSwfTileStripResult,
    label: string,
    resolution: number
  ): { source: ImageSource; entry: AtlasEntry } {
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
      frames[i] = new Texture({
        source,
        frame: new Rectangle(
          col * result.frameWidth,
          row * result.frameHeight,
          result.frameWidth,
          result.frameHeight
        ),
      });
    }
    return {
      source,
      entry: {
        frames,
        anchorFracX:
          result.frameWidth > 0 ? result.anchorX / result.frameWidth : 0,
        anchorFracY:
          result.frameHeight > 0 ? result.anchorY / result.frameHeight : 0,
        resolution,
      },
    };
  }
}
