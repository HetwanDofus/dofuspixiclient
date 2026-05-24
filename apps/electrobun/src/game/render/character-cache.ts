/**
 * Path B shared cache for class atlases + accessory strips + mount
 * transforms. Sits between `PlayerStripRendererV2` and `vello-loader` so
 * 400 bots of the same class share ONE GPU texture containing every
 * animation variant of that class.
 *
 * Cache keys:
 *   class atlas → `class|${bundle}|${resolutionQuantised}`
 *   accessory   → `acc|${accBundle}|${accExport}|${slot}|${animType}|${dir}|${side}|${resolution}`
 *   mount xfm   → `mnt|${bundle}|${export}|${start}|${count}|${applyBFix}`
 *
 * Variant lookup inside a class atlas is keyed by
 *   `${exportName}|${applyBFix(0/1)}|${hatEquipped(0/1)}`
 * with the `applyBFix` / `hatEquipped` dimensions collapsed to `0`
 * when the body doesn't actually use them — mirrors the legacy
 * `normalizeBFix` / `normalizeHatEquipped` heuristics. Variant
 * normalisation happens AT BAKE TIME (Rust enumerates only the
 * effective variants) and at LOOKUP TIME (JS uses `bFixUsed` /
 * `hasToggleSprite` from `swfBodyBandInfo` to collapse the query).
 *
 * Refcount semantics: each `PlayerStripRendererV2` slot using a class
 * atlas holds one ref. Anim swap to the same class is refcount-stable
 * (no acquire/release); anim swap to a different class drops the old
 * ref + acquires the new. Releasing to 0 makes the entry LRU-eligible.
 *
 * Two-tick settle on eviction (mirrors `scheduleRetire` semantics):
 * the GPU texture is destroyed only after two Pixi ticks so in-flight
 * samplers on the old texture complete first. The patched-wgpu Drop
 * is a no-op (`feedback_pixi_wgpu_texture_lifetime`), so this is the
 * ONLY place GPU memory actually gets released.
 *
 * Bakes are dispatched through `getStripBakeQueue()` for adaptive
 * frame budgeting — cache misses don't stall the rAF callback.
 */

import {
  ImageSource,
  Rectangle,
  Texture,
  Ticker,
} from "pixi.js";

import {
  bakeClassAtlasViaWorkerPool,
  isBakeWorkerPoolReady,
} from "./bake-worker-pool";
import {
  getPixiRenderer,
  renderSwfAccessoryStrip,
  renderSwfBodyAtlas,
  renderSwfClassAtlas,
  renderSwfMountTransforms,
  swfAccessoryCanonicalAnimType,
  swfBodyBandInfo,
  tickDeferredDestroys,
  uploadAndCloseBitmap,
  type VelloSwfAccessoryStripResult,
  type VelloSwfBodyAtlasResult,
  type VelloSwfBodyBandInfo,
  type VelloSwfClassAtlasResult,
} from "@/game/render/vello-loader";
import {
  getSharedInputAtlas,
  type InputAtlasSlot,
} from "@/game/render/shared-input-atlas";
import { getStripBakeQueue } from "@/game/render/strip-bake-queue";
import { createLogger } from "@/utils/logger";

const log = createLogger("CharacterCache");

/** Maximum accessory slot id Path B addresses (0..=4 = weapon, hat,
 *  cape, pet, shield). Matches the mount-transform layout in Rust. */
export const MAX_SLOT = 5;

/**
 * Default LRU cap in bytes.
 *
 * Class-atlas migration: each class entry is ONE GPU texture. At
 * resolution=3 typical class atlases sit at 4096 × N pixels where N
 * is determined by the bin-packer (roughly 200-1500 px tall per
 * class). 12 classes × ~6 MB = ~72 MB GPU for the body atlas
 * working set. The accessory cache still dominates: ~5-8 k unique
 * (bundle × export × slot × animType × dir) tuples at 200-bot
 * stress, ~65 KB each → ~330-520 MB.
 *
 * The 2 GB cap stays — the new working set is much smaller but the
 * cap is a stress-test ceiling; real gameplay (16-char fights) sits
 * at ~200-400 MB so the headroom is irrelevant.
 */
const DEFAULT_BYTES_CAP = 2000 * 1024 * 1024;

/** GPU pixels are 4 bytes (BGRA8/Rgba8Unorm). */
const BYTES_PER_PIXEL = 4;

/** Two ticks of settle before destroying the class texture. */
const RETIRE_TICKS = 2;

/**
 * Sub-rect describing where a single Z-ordered band lives inside a
 * variant's region of the class atlas. Absolute coordinates inside
 * the class atlas — the renderer feeds these directly to
 * `computeBandFrameUV` along with the class atlas's full dims.
 */
export interface VariantBand {
  readonly bandIndex: number;
  readonly atlasX: number;
  readonly atlasY: number;
}

/**
 * One animation variant inside a class atlas. `(exportName, applyBFix,
 * hatEquipped)` uniquely identifies a variant; the cache normalises
 * the latter two so lookups collapse onto the correct entry when the
 * body doesn't use them.
 *
 * `pageIndex` selects which class-atlas page hosts this variant's
 * pixels — most classes pack into page 0 only; high-frame classes
 * (e.g. characters with long death anims) spill onto additional
 * pages. Renderer must use `atlas.pages[variant.pageIndex]` to
 * bind shader resources and read atlas dims.
 */
export interface VariantInfo {
  readonly exportName: string;
  readonly applyBFix: boolean;
  readonly hatEquipped: boolean;
  readonly pageIndex: number;
  readonly stripWidth: number;
  readonly stripHeight: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly gridCols: number;
  readonly frameCount: number;
  readonly totalFrameCount: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly bandPadding: number;
  readonly bandCount: number;
  readonly slotCount: number;
  readonly bands: readonly VariantBand[];
  /**
   * Picking silhouette: byte alpha map of `frameWidth × frameHeight`
   * pixels, value > threshold ⇒ point is on the bot's body.
   * Computed at bake-time by UNIONing each band's cell-(0,0) alpha
   * sub-rect from the class atlas page bitmap. Extracted via
   * `OffscreenCanvas + getImageData` BEFORE the bitmap is uploaded
   * to Pixi (Pixi closes the bitmap on upload, and Pixi v8 doesn't
   * expose the post-upload GPUTexture in a way `PickingSystem`'s
   * extraction can read — its `source.resource` cast returns the
   * uploaded ImageBitmap, not a `GPUTexture`, so
   * `copyTextureToBuffer` validation fails silently). Doing it
   * ourselves at bake time gives pixel-perfect picking without
   * Pixi-internal hacks.
   *
   * `undefined` only between bake-completion and silhouette
   * extraction (a tight synchronous window inside `wrapClassAtlas`).
   * In practice always populated by the time any consumer reads it.
   */
  silhouette?: Uint8Array;
}

/** One page of a class atlas — a single GPU texture + its dims.
 *
 *  `inputAtlasSlot` is set when the page's `combinedTexture` is a
 *  sub-rect of a `SharedInputAtlas` super page (the post-Path-1
 *  per-variant routing — many variants share the same super page so
 *  `BodyBandBatch` keys collapse). When set, `combinedTexture` MUST
 *  NOT be destroyed on retire (it's shared). When unset, the page
 *  owns its texture and retire destroys it. */
export interface ClassAtlasPage {
  readonly combinedTexture: Texture;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly inputAtlasSlot?: InputAtlasSlot;
}

/**
 * Class atlas: one or more GPU textures carrying every animation
 * variant for a `(bundle, resolution)` tuple. Variants are looked up
 * via `getVariant(...)`; the class atlas owns the GPU texture refcount.
 */
export interface ClassAtlas {
  readonly key: string;
  readonly bundle: string;
  readonly resolution: number;
  readonly pages: readonly ClassAtlasPage[];
  /**
   * Variant map. Keys are `${exportName}|${applyBFix(0/1)}|${hatEquipped(0/1)}`.
   * `bFixUsed` / `hasToggleSprite` collapses mean a single VariantInfo
   * is shared across multiple keys (e.g. when bFix is unused, both
   * `walkR|0|0` and `walkR|1|0` point at the same VariantInfo).
   */
  readonly variants: Map<string, VariantInfo>;
  /** True if the bundle has ANY mount declaring `b_fix=true`. */
  readonly bFixUsed: boolean;
  /** True if the bundle has a multi-frame toggle sprite (canonical
   *  AS2 `mcToHide` pattern — only Iop's R_tete in vanilla 1.29). */
  readonly hasToggleSprite: boolean;
  refcount: number;
  lastReleasedAt: number;
  readonly bytesEst: number;
}

export interface AccessoryStrip {
  readonly key: string;
  readonly texture: Texture;
  readonly frames: Texture[];
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly anchorX: number;
  readonly anchorY: number;
  refcount: number;
  lastReleasedAt: number;
  readonly bytesEst: number;
}

export interface MountTransforms {
  readonly key: string;
  /** `count × MAX_SLOT × 6` floats — `(a, b, c, d, tx, ty)` in twip. */
  readonly data: Float32Array;
  /** `count × MAX_SLOT` bytes — 1 where the body's display list
   *  places a mount of that slot at that frame, 0 otherwise.
   *  Canonical signal for "draw the accessory this frame." */
  readonly presence: Uint8Array;
  readonly frameCount: number;
  /** Slot count (matches MAX_SLOT at extraction time). */
  readonly maxSlot: number;
}

export interface CharacterCacheStats {
  classAtlasEntries: number;
  classAtlasBytes: number;
  accEntries: number;
  accBytes: number;
  mountEntries: number;
  hits: number;
  misses: number;
  evicts: number;
  capBytes: number;
}

interface PendingClassAtlasBake {
  /** Enqueue wall-clock time — diff from the onReady invocation gives
   *  the full bake latency a bot sees (Rust render + bridge + bake-
   *  queue delay + JS wrap + Pixi upload). */
  enqueuedAt: number;
  callbacks: Array<{
    onReady: (atlas: ClassAtlas | null) => void;
    isWanted: () => boolean;
  }>;
}

interface PendingAccessoryBake {
  callbacks: Array<{
    onReady: (strip: AccessoryStrip | null) => void;
    isWanted: () => boolean;
  }>;
}

interface RetireQueueEntry {
  destroyTextures: Texture[];
  /**
   * Step 11 bridge: ImageBitmaps owned by an evicted class atlas.
   * Closing them releases the canvas drawing buffer's GPU resource
   * immediately rather than waiting for JS GC.
   */
  closeBitmaps: ImageBitmap[];
  ticksRemaining: number;
}

interface AccessoryKeyParts {
  bundle: string;
  exportName: string;
  slot: number;
  animType: number;
  dir: string;
  side: string;
  resolution: number;
}

interface MountKeyParts {
  bundle: string;
  exportName: string;
  start: number;
  count: number;
  applyBFix: boolean;
}

function classAtlasKey(bundle: string, resolution: number): string {
  return `class|${bundle}|${Math.round(resolution * 1000)}`;
}

function singleVariantAtlasKey(
  bundle: string,
  exportName: string,
  applyBFix: boolean,
  hatEquipped: boolean,
  resolution: number,
): string {
  return `var|${bundle}|${exportName}|${applyBFix ? 1 : 0}|${hatEquipped ? 1 : 0}|${Math.round(resolution * 1000)}`;
}

// `isCommonAnim` removed: previously routed static/walk/run to the
// shared class atlas (24 variants per call). Per-variant bake is now
// the primary path for every animation — see `acquireVariantAtlas`.

/** Key for variant lookup inside a class atlas. */
export function variantKey(
  exportName: string,
  applyBFix: boolean,
  hatEquipped: boolean,
): string {
  return `${exportName}|${applyBFix ? 1 : 0}|${hatEquipped ? 1 : 0}`;
}

function accessoryKey(p: AccessoryKeyParts): string {
  return `acc|${p.bundle}|${p.exportName}|${p.slot}|${p.animType}|${p.dir}|${p.side}|${p.resolution}`;
}

function mountKey(p: MountKeyParts): string {
  return `mnt|${p.bundle}|${p.exportName}|${p.start}|${p.count}|${p.applyBFix ? 1 : 0}`;
}

function estimateBytes(width: number, height: number): number {
  return width * height * BYTES_PER_PIXEL;
}

/**
 * Threshold above which a class-atlas-page alpha sample counts as
 * "on body" for picking purposes. Matches the value used in
 * `PickingSystem.checkAlpha`. Small enough to ignore feathering /
 * anti-aliased edges but well below any meaningfully opaque pixel.
 */
const SILHOUETTE_ALPHA_THRESHOLD = 10;

/**
 * Lift the alpha plane out of a class-atlas page bitmap before it's
 * uploaded to Pixi (which closes the bitmap on upload). Returns a
 * tightly packed `Uint8Array(width * height)` of the alpha channel,
 * or `null` if `OffscreenCanvas`/`getImageData` is unavailable in
 * the host (rare — main thread of every Chromium/Safari we ship
 * on).
 *
 * Doing this once per page (then aggregating per variant) is far
 * cheaper than a per-pick GPU readback, and avoids `PickingSystem`'s
 * Pixi-v8-incompatible `copyTextureToBuffer` extraction.
 */
function extractPageAlpha(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Uint8Array | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, width, height);
  const rgba = img.data;
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) {
    out[i] = rgba[j];
  }
  return out;
}

/**
 * Union all bands of a variant — projected to its cell-(0,0) frame
 * rect — into one `frameWidth × frameHeight` silhouette. Sampling
 * uses `>` against {@link SILHOUETTE_ALPHA_THRESHOLD} to ignore
 * AA fringe; the resulting bytes are 0/255 so the consumer can
 * fast-path with a single threshold comparison.
 *
 * Each variant strip layout: bands are stacked vertically in the
 * atlas with `bandPadding` margin; cell (0,0) at `(atlasX, atlasY)`
 * is the canonical first frame for this band. Hit-testing only
 * needs *any* opaque pixel across bands at the queried frame-local
 * coord — a transparent gap in band[0] but coverage in band[1] is
 * still a hit on the visible composite.
 */
function buildVariantSilhouette(
  pageAlpha: Uint8Array,
  pageW: number,
  pageH: number,
  frameW: number,
  frameH: number,
  bands: readonly { atlasX: number; atlasY: number }[],
): Uint8Array {
  const out = new Uint8Array(frameW * frameH);
  for (const band of bands) {
    const baseX = band.atlasX;
    const baseY = band.atlasY;
    for (let y = 0; y < frameH; y++) {
      const py = baseY + y;
      if (py < 0 || py >= pageH) continue;
      const pageRow = py * pageW;
      const outRow = y * frameW;
      for (let x = 0; x < frameW; x++) {
        if (out[outRow + x]) continue;
        const px = baseX + x;
        if (px < 0 || px >= pageW) continue;
        if (pageAlpha[pageRow + px] > SILHOUETTE_ALPHA_THRESHOLD) {
          out[outRow + x] = 255;
        }
      }
    }
  }
  return out;
}

class CharacterCache {
  private classAtlasEntries = new Map<string, ClassAtlas>();
  private accEntries = new Map<string, AccessoryStrip>();
  private mountEntries = new Map<string, MountTransforms>();
  private classAtlasBakes = new Map<string, PendingClassAtlasBake>();
  private accBakes = new Map<string, PendingAccessoryBake>();
  private bandInfoCache = new Map<string, VelloSwfBodyBandInfo>();
  /**
   * Memo of the canonical animType per accessory tuple. See the
   * detailed reasoning in `acquireAccessory`. Without this memo,
   * the per-acquire wasm-boundary crossing dominates frame cost
   * once the cache is hit-heavy.
   */
  private accessoryCanonicalAnimTypeMemo = new Map<string, number>();
  private retireQueue: RetireQueueEntry[] = [];
  private tickerInstalled = false;
  private tickerCallback: (() => void) | null = null;

  private hits = 0;
  private misses = 0;
  private evicts = 0;
  private classAtlasBytes = 0;
  private accBytes = 0;
  private capBytes = DEFAULT_BYTES_CAP;

  // ── Acquire-lifecycle diagnostics ──────────────────────────────
  /** Total entries into `acquireSingleVariantAtlas`. */
  private diagAcqCalls = 0;
  /** Calls that hit an already-installed atlas (sync onReady with
   *  a non-null atlas). */
  private diagAcqHitDeliver = 0;
  /** Calls that piggybacked on an in-flight bake (no immediate
   *  delivery — onReady fires later in `finalizeSingleVariantBake`). */
  private diagAcqDedup = 0;
  /** Calls that started a fresh bake (no prior cache hit, no in-flight
   *  bake to dedup with). */
  private diagAcqDispatch = 0;
  /** `finalizeSingleVariantBake` deliveries with a non-null atlas. */
  private diagAcqFinalDeliver = 0;
  /** `finalizeSingleVariantBake` deliveries with `null` (bake failed
   *  OR — the bug we're hunting — bake succeeded but every
   *  registered callback's `isWanted` returned false at land time). */
  private diagAcqFinalNullDeliver = 0;
  /** `finalizeSingleVariantBake` callbacks dropped without invocation
   *  (the contract violation in the no-live-wants branch). MUST be 0
   *  once fixed. */
  private diagAcqDroppedCallbacks = 0;

  private ensureTickerInstalled(): void {
    if (this.tickerInstalled) return;
    this.tickerInstalled = true;
    this.tickerCallback = () => this.tick();
    Ticker.shared.add(this.tickerCallback);
  }

  setHardCapBytes(n: number): void {
    this.capBytes = Math.max(0, n);
    this.evictIfOverCap();
  }

  /**
   * Look up the body's slot/band metadata. Cached for the session —
   * SwfDoc structure is immutable per loaded bundle.
   */
  getBodyBandInfo(bundle: string, exportName: string): VelloSwfBodyBandInfo | null {
    const key = `${bundle}|${exportName}`;
    let info = this.bandInfoCache.get(key);
    if (info) return info;
    const fresh = swfBodyBandInfo(bundle, exportName);
    if (fresh) {
      info = fresh;
      this.bandInfoCache.set(key, info);
      return info;
    }
    return null;
  }

  /**
   * Acquire a refcount on a class atlas covering every animation
   * variant of `(bundle, resolution)`. Cache hit returns
   * synchronously; cache miss enqueues a SINGLE bake that produces
   * the whole class atlas in one Rust call.
   *
   * `isWanted` is honored by the bake queue: if every requester
   * moved on before the bake fires, the bake is skipped and the
   * `onReady` callbacks receive `null`.
   */
  /**
   * Acquire a `ClassAtlas` that contains the variant for `exportName`.
   *
   * Demand-driven: bakes exactly the one variant requested, even for
   * common anims (static/walk/run). The previous architecture batched
   * 24 variants per class into one shared atlas to amortize the per-
   * variant overhead, but that meant every zoom rebuild rasterized
   * ~30k sub-renders across the roster when bots actually display
   * 20–50 distinct (class, variant) tuples at any instant. Per-variant
   * + the existing cache dedup matches GPU work to on-screen demand
   * 1:1.
   *
   * `acquireSingleVariantAtlas` produces a 1-page, 1-variant ClassAtlas
   * via `renderSwfBodyAtlas`; the renderer is shape-agnostic and looks
   * up `getVariant` identically on either form.
   */
  acquireVariantAtlas(
    bundle: string,
    exportName: string,
    applyBFix: boolean,
    hatEquipped: boolean,
    frameCount: number,
    resolution: number,
    onReady: (atlas: ClassAtlas | null) => void,
    isWanted: () => boolean,
    priority: "high" | "low" = "high",
  ): void {
    this.acquireSingleVariantAtlas(
      bundle,
      exportName,
      applyBFix,
      hatEquipped,
      frameCount,
      resolution,
      onReady,
      isWanted,
      priority,
    );
  }

  acquireClassAtlas(
    bundle: string,
    resolution: number,
    onReady: (atlas: ClassAtlas | null) => void,
    isWanted: () => boolean,
    /** `"high"` (default) for live applyAnimation calls — the bot
     *  is on screen waiting to render. `"low"` for background
     *  pre-warm sweeps that just want to populate the cache for
     *  future use; pre-warm bakes drain only after every live
     *  request has cleared. */
    priority: "high" | "low" = "high",
  ): void {
    this.ensureTickerInstalled();
    const key = classAtlasKey(bundle, resolution);
    const existing = this.classAtlasEntries.get(key);
    if (existing) {
      existing.refcount += 1;
      this.hits += 1;
      onReady(existing);
      return;
    }
    this.misses += 1;
    const pending = this.classAtlasBakes.get(key);
    if (pending) {
      // Already in flight: this caller piggybacks on the existing
      // bake's eventual `onReady` callback list. CRITICAL: do NOT
      // dispatch another bake — the worker pool path has no internal
      // dedup, so a second dispatch would queue a redundant Rust bake.
      // The strip-queue path also dedups by key, so this `return` is
      // safe regardless of which path the original bake took.
      pending.callbacks.push({ onReady, isWanted });
      return;
    }
    this.classAtlasBakes.set(key, {
      enqueuedAt: performance.now(),
      callbacks: [{ onReady, isWanted }],
    });
    // Opt-9: if the bake-worker pool is ready, dispatch the bake to
    // a worker thread instead of the main thread's WASM. The bake
    // queue's frame-rate budgeting doesn't matter for worker-bound
    // bakes — they don't block the main rAF — so we bypass the
    // queue entirely on this path.
    if (isBakeWorkerPoolReady()) {
      bakeClassAtlasViaWorkerPool(bundle, resolution).then(
        (raw) => {
          this.finalizeClassAtlasBake(key, bundle, resolution, raw);
        },
        (err) => {
          log.error(`worker bake for '${key}' failed; falling back:`, err);
          // Fallback: re-enqueue on the main-thread queue so the
          // caller still gets a result.
          getStripBakeQueue().enqueue(
            key,
            () => renderSwfClassAtlas(bundle, resolution),
            (raw) => {
              this.finalizeClassAtlasBake(
                key,
                bundle,
                resolution,
                raw as VelloSwfClassAtlasResult | null,
              );
            },
            () => {
              const bake = this.classAtlasBakes.get(key);
              if (!bake) return false;
              return bake.callbacks.some((c) => c.isWanted());
            },
            priority,
          );
        },
      );
      return;
    }

    getStripBakeQueue().enqueue(
      key,
      () => renderSwfClassAtlas(bundle, resolution),
      (raw) => {
        this.finalizeClassAtlasBake(
          key,
          bundle,
          resolution,
          raw as VelloSwfClassAtlasResult | null,
        );
      },
      () => {
        const bake = this.classAtlasBakes.get(key);
        if (!bake) return false;
        return bake.callbacks.some((c) => c.isWanted());
      },
      priority,
    );
  }

  /**
   * Look up a variant inside a class atlas with the normalisation
   * rules applied. Returns `null` when the variant isn't part of
   * the class atlas (e.g. an exotic anim name that didn't match
   * the Rust enumeration pattern).
   */
  getVariant(
    atlas: ClassAtlas,
    exportName: string,
    applyBFix: boolean,
    hatEquipped: boolean,
  ): VariantInfo | null {
    const normBFix = applyBFix && atlas.bFixUsed;
    const normHat = hatEquipped && atlas.hasToggleSprite;
    const key = variantKey(exportName, normBFix, normHat);
    return atlas.variants.get(key) ?? null;
  }

  /**
   * Per-variant fallback path. Bakes ONE animation variant via the
   * legacy `renderSwfBodyAtlas` Rust function and wraps it as a
   * `ClassAtlas` with a single page + single variant. The renderer
   * uses the result identically to a shared class atlas — same
   * `pages[]`, `variants` map, refcount semantics.
   *
   * Cache keyed per-variant; eviction joins the same LRU as the
   * shared class atlases.
   */
  private acquireSingleVariantAtlas(
    bundle: string,
    exportName: string,
    applyBFix: boolean,
    hatEquipped: boolean,
    frameCount: number,
    resolution: number,
    onReady: (atlas: ClassAtlas | null) => void,
    isWanted: () => boolean,
    priority: "high" | "low",
  ): void {
    this.ensureTickerInstalled();
    // Apply the same JS-side normalisations as the body-info path so
    // the cache key matches across bots whose bFix/hat dimensions
    // collapse for this body.
    const info = this.getBodyBandInfo(bundle, exportName);
    const normBFix = applyBFix && (info?.bFixUsed ?? true);
    const normHat = hatEquipped && (info?.hasToggleSprite ?? true);
    // Static is always 1 frame (canonical wrapper). Match the Rust
    // clamp so the cache key is stable across the wrapper's recurse-
    // depth ambiguity.
    const normalisedFrameCount = exportName.startsWith("static")
      ? 1
      : Math.max(1, frameCount);
    const key = singleVariantAtlasKey(
      bundle,
      exportName,
      normBFix,
      normHat,
      resolution,
    );
    this.diagAcqCalls += 1;
    const existing = this.classAtlasEntries.get(key);
    if (existing) {
      existing.refcount += 1;
      this.hits += 1;
      this.diagAcqHitDeliver += 1;
      onReady(existing);
      return;
    }
    this.misses += 1;
    const pending = this.classAtlasBakes.get(key);
    if (pending) {
      pending.callbacks.push({ onReady, isWanted });
      this.diagAcqDedup += 1;
      return;
    }
    this.diagAcqDispatch += 1;
    this.classAtlasBakes.set(key, {
      enqueuedAt: performance.now(),
      callbacks: [{ onReady, isWanted }],
    });
    getStripBakeQueue().enqueue(
      key,
      () =>
        renderSwfBodyAtlas(
          bundle,
          exportName,
          0,
          normalisedFrameCount,
          normalisedFrameCount,
          resolution,
          normBFix,
          normHat,
        ),
      (raw) => {
        this.finalizeSingleVariantBake(
          key,
          bundle,
          exportName,
          normBFix,
          normHat,
          normalisedFrameCount,
          resolution,
          raw as VelloSwfBodyAtlasResult | null,
        );
      },
      () => {
        const bake = this.classAtlasBakes.get(key);
        if (!bake) return false;
        return bake.callbacks.some((c) => c.isWanted());
      },
      priority,
    );
  }

  private finalizeSingleVariantBake(
    key: string,
    bundle: string,
    exportName: string,
    applyBFix: boolean,
    hatEquipped: boolean,
    frameCount: number,
    resolution: number,
    result: VelloSwfBodyAtlasResult | null,
  ): void {
    const pending = this.classAtlasBakes.get(key);
    this.classAtlasBakes.delete(key);
    if (!pending) return;
    const liveCbs = pending.callbacks.filter((c) => c.isWanted());
    if (!result) {
      this.diagAcqFinalNullDeliver += pending.callbacks.length;
      for (const cb of pending.callbacks) cb.onReady(null);
      return;
    }
    if (liveCbs.length === 0) {
      // CONTRACT-VIOLATION CANDIDATE (under investigation):
      // bake succeeded but every callback's isWanted() returned false
      // at land time. Counting dropped callbacks so we can confirm
      // this is the root cause of "moving without animations" bots
      // before patching to fire onReady(null) here.
      this.diagAcqDroppedCallbacks += pending.callbacks.length;
      try {
        result.combinedBitmap.close();
      } catch {}
      return;
    }
    const wrapStart = performance.now();
    const atlas = this.wrapSingleVariantAtlas(
      key,
      bundle,
      exportName,
      applyBFix,
      hatEquipped,
      frameCount,
      resolution,
      result,
    );
    const wrapMs = performance.now() - wrapStart;
    const totalWallMs = performance.now() - pending.enqueuedAt;
    log.info(
      `singleVariantWall bundle=${bundle} ${exportName} bFix=${applyBFix ? 1 : 0} hat=${hatEquipped ? 1 : 0} ` +
        `wall=${totalWallMs.toFixed(1)} wrap=${wrapMs.toFixed(1)} dims=${result.atlasWidth}x${result.atlasHeight}`,
    );
    this.classAtlasEntries.set(key, atlas);
    this.classAtlasBytes += atlas.bytesEst;
    this.diagAcqFinalDeliver += liveCbs.length;
    this.diagAcqFinalNullDeliver += pending.callbacks.length - liveCbs.length;
    for (const cb of liveCbs) {
      atlas.refcount += 1;
      cb.onReady(atlas);
    }
    for (const cb of pending.callbacks) {
      if (!liveCbs.includes(cb)) cb.onReady(null);
    }
    this.evictIfOverCap();
  }

  private wrapSingleVariantAtlas(
    key: string,
    bundle: string,
    exportName: string,
    applyBFix: boolean,
    hatEquipped: boolean,
    frameCount: number,
    resolution: number,
    r: VelloSwfBodyAtlasResult,
  ): ClassAtlas {
    // Path 1: try to land into the SharedInputAtlas so this variant's
    // BodyBandBatch shares a source texture with other variants on
    // the same page. Collapses ~500 batches → ~25.
    //
    // Falls back to a dedicated per-variant texture if (a) the
    // variant is larger than a single super page or (b) we've hit
    // the page cap. In both cases the legacy retire path will
    // destroy the texture; in the super-atlas path we free the slot
    // instead (see `scheduleRetireClassAtlas`).
    const superAlloc = getSharedInputAtlas().allocSlot(
      r.atlasWidth,
      r.atlasHeight,
    );
    let combinedTexture: Texture;
    let pageAtlasWidth: number;
    let pageAtlasHeight: number;
    let slotOffsetX = 0;
    let slotOffsetY = 0;
    let pageInputSlot: InputAtlasSlot | undefined;
    if (superAlloc) {
      getSharedInputAtlas().blitBitmap(superAlloc, r.combinedBitmap);
      combinedTexture = superAlloc.texture;
      pageAtlasWidth = superAlloc.pageWidth;
      pageAtlasHeight = superAlloc.pageHeight;
      slotOffsetX = superAlloc.slot.x;
      slotOffsetY = superAlloc.slot.y;
      pageInputSlot = superAlloc.slot;
    } else {
      combinedTexture = this.buildPixiTextureFromBitmap(
        r.combinedBitmap,
        key,
      );
      pageAtlasWidth = r.atlasWidth;
      pageAtlasHeight = r.atlasHeight;
    }
    const pages: ClassAtlasPage[] = [
      {
        combinedTexture,
        atlasWidth: pageAtlasWidth,
        atlasHeight: pageAtlasHeight,
        inputAtlasSlot: pageInputSlot,
      },
    ];
    const variants = new Map<string, VariantInfo>();
    const info: VariantInfo = {
      exportName,
      applyBFix,
      hatEquipped,
      pageIndex: 0,
      stripWidth: r.stripWidth,
      stripHeight: r.stripHeight,
      frameWidth: r.frameWidth,
      frameHeight: r.frameHeight,
      gridCols: r.gridCols,
      frameCount: r.frameCount,
      totalFrameCount: frameCount,
      anchorX: r.anchorX,
      anchorY: r.anchorY,
      bandPadding: r.bandPadding,
      bandCount: r.bandCount,
      slotCount: r.slotCount,
      // Pre-offset band coords to super-page coordinate space when
      // we landed into the shared input atlas. `computeBandFrameUV`
      // normalises against `atlasDimsForVariant` which returns
      // `pageAtlasWidth/Height` — the page dims (super-page when
      // backed, variant-local when not), so this stays consistent.
      bands: r.bands.map((b) => ({
        bandIndex: b.bandIndex,
        atlasX: b.atlasX + slotOffsetX,
        atlasY: b.atlasY + slotOffsetY,
      })),
    };
    // Single-variant atlas exposes the requested variant under
    // every plausible (bFix, hat) key so the renderer's normalisation
    // collapses correctly — bFixUsed/hasToggleSprite flags reflect
    // what we ACTUALLY baked.
    variants.set(variantKey(exportName, applyBFix, hatEquipped), info);
    return {
      key,
      bundle,
      resolution,
      pages,
      variants,
      bFixUsed: applyBFix,
      hasToggleSprite: hatEquipped,
      refcount: 0,
      lastReleasedAt: 0,
      bytesEst: estimateBytes(r.atlasWidth, r.atlasHeight),
    };
  }

  /** Drop a previously-acquired class atlas. */
  releaseClassAtlas(atlas: ClassAtlas): void {
    if (atlas.refcount <= 0) {
      log.warn(`releaseClassAtlas underflow on '${atlas.key}'`);
      return;
    }
    atlas.refcount -= 1;
    if (atlas.refcount === 0) {
      atlas.lastReleasedAt = performance.now();
      this.evictIfOverCap();
    }
  }

  acquireAccessory(
    rawParts: AccessoryKeyParts,
    onReady: (strip: AccessoryStrip | null) => void,
    isWanted: () => boolean,
  ): void {
    this.ensureTickerInstalled();
    // Normalise animType to its canonical value, MEMOISED on the JS
    // side. The Rust call (`swfAccessoryCanonicalAnimType`) is
    // deterministic so we cache the result per unique input tuple.
    const memoKey = `${rawParts.bundle}|${rawParts.exportName}|${rawParts.slot}|${rawParts.dir}|${rawParts.side}|${rawParts.animType}`;
    let canonicalAnimType =
      this.accessoryCanonicalAnimTypeMemo.get(memoKey);
    if (canonicalAnimType === undefined) {
      canonicalAnimType = swfAccessoryCanonicalAnimType(
        rawParts.bundle,
        rawParts.exportName,
        rawParts.slot,
        rawParts.dir,
        rawParts.side,
        rawParts.animType,
      );
      this.accessoryCanonicalAnimTypeMemo.set(memoKey, canonicalAnimType);
    }
    const parts: AccessoryKeyParts =
      canonicalAnimType === rawParts.animType
        ? rawParts
        : { ...rawParts, animType: canonicalAnimType };
    const key = accessoryKey(parts);
    const existing = this.accEntries.get(key);
    if (existing) {
      existing.refcount += 1;
      this.hits += 1;
      onReady(existing);
      return;
    }
    this.misses += 1;
    const pending = this.accBakes.get(key);
    if (pending) {
      pending.callbacks.push({ onReady, isWanted });
    } else {
      this.accBakes.set(key, { callbacks: [{ onReady, isWanted }] });
    }
    getStripBakeQueue().enqueue(
      key,
      () =>
        renderSwfAccessoryStrip(
          parts.bundle,
          parts.exportName,
          parts.slot,
          parts.animType,
          parts.dir,
          parts.side,
          parts.resolution,
        ),
      (raw) => {
        this.finalizeAccessoryBake(key, raw as VelloSwfAccessoryStripResult | null);
      },
      () => {
        const bake = this.accBakes.get(key);
        if (!bake) return false;
        return bake.callbacks.some((c) => c.isWanted());
      },
    );
  }

  releaseAccessory(strip: AccessoryStrip): void {
    if (strip.refcount <= 0) {
      log.warn(`releaseAccessory underflow on '${strip.key}'`);
      return;
    }
    strip.refcount -= 1;
    if (strip.refcount === 0) {
      strip.lastReleasedAt = performance.now();
      this.evictIfOverCap();
    }
  }

  /**
   * Mount transforms are CPU-only, small (~few KB per anim), and
   * stable for the session — no refcount, no LRU. Cached
   * indefinitely until `clearAll()`. Normalises the bFix dimension
   * via the band info exactly like the legacy path.
   */
  getMounts(parts: MountKeyParts): MountTransforms | null {
    const info = this.getBodyBandInfo(parts.bundle, parts.exportName);
    const normalized: MountKeyParts =
      parts.applyBFix && info && info.bFixUsed === false
        ? { ...parts, applyBFix: false }
        : parts;
    const key = mountKey(normalized);
    const existing = this.mountEntries.get(key);
    if (existing) return existing;
    const result = renderSwfMountTransforms(
      normalized.bundle,
      normalized.exportName,
      normalized.start,
      normalized.count,
      normalized.applyBFix,
      MAX_SLOT,
    );
    if (!result) return null;
    const entry: MountTransforms = {
      key,
      data: result.matrices,
      presence: result.presence,
      frameCount: normalized.count,
      maxSlot: MAX_SLOT,
    };
    this.mountEntries.set(key, entry);
    return entry;
  }

  /** Whether the body's display list places a mount for `slot` at
   *  `frameIdx`. */
  isMountPresent(
    mounts: MountTransforms,
    frameIdx: number,
    slot: number,
  ): boolean {
    if (slot < 0 || slot >= mounts.maxSlot) return false;
    if (frameIdx < 0 || frameIdx >= mounts.frameCount) return false;
    return mounts.presence[frameIdx * mounts.maxSlot + slot] !== 0;
  }

  /** Read the affine matrix for `(frame, slot)` into the 6-tuple
   *  output (a, b, c, d, tx, ty). */
  readMountMatrix(
    mounts: MountTransforms,
    frameIdx: number,
    slot: number,
    out: { a: number; b: number; c: number; d: number; tx: number; ty: number },
  ): void {
    const offset = (frameIdx * MAX_SLOT + slot) * 6;
    out.a = mounts.data[offset];
    out.b = mounts.data[offset + 1];
    out.c = mounts.data[offset + 2];
    out.d = mounts.data[offset + 3];
    out.tx = mounts.data[offset + 4];
    out.ty = mounts.data[offset + 5];
  }

  getStats(): CharacterCacheStats {
    return {
      classAtlasEntries: this.classAtlasEntries.size,
      classAtlasBytes: this.classAtlasBytes,
      accEntries: this.accEntries.size,
      accBytes: this.accBytes,
      mountEntries: this.mountEntries.size,
      hits: this.hits,
      misses: this.misses,
      evicts: this.evicts,
      capBytes: this.capBytes,
    };
  }

  /** Acquire-lifecycle counters — surface contract violations
   *  (`dropped > 0` ⇒ a bake completed but none of its callbacks were
   *  fired). Also exposes in-flight bake count so we can spot
   *  pipeline backpressure. */
  getAcquireStats(): {
    calls: number;
    hitDeliver: number;
    dedup: number;
    dispatch: number;
    finalDeliver: number;
    finalNullDeliver: number;
    droppedCallbacks: number;
    inflightBakes: number;
    inflightCallbacks: number;
  } {
    let inflightCallbacks = 0;
    for (const pending of this.classAtlasBakes.values()) {
      inflightCallbacks += pending.callbacks.length;
    }
    return {
      calls: this.diagAcqCalls,
      hitDeliver: this.diagAcqHitDeliver,
      dedup: this.diagAcqDedup,
      dispatch: this.diagAcqDispatch,
      finalDeliver: this.diagAcqFinalDeliver,
      finalNullDeliver: this.diagAcqFinalNullDeliver,
      droppedCallbacks: this.diagAcqDroppedCallbacks,
      inflightBakes: this.classAtlasBakes.size,
      inflightCallbacks,
    };
  }

  /**
   * Tick the retire queue + the patched-fork's deferred-destroy
   * queue. Call once per Pixi ticker tick.
   */
  tick(): void {
    try {
      tickDeferredDestroys(2, 256);
    } catch (e) {
      log.warn("tickDeferredDestroys threw", e);
    }
    if (this.retireQueue.length === 0) return;
    const remaining: RetireQueueEntry[] = [];
    for (const entry of this.retireQueue) {
      entry.ticksRemaining -= 1;
      if (entry.ticksRemaining > 0) {
        remaining.push(entry);
        continue;
      }
      for (const tex of entry.destroyTextures) {
        try {
          tex.destroy(true);
        } catch (e) {
          log.warn("Texture destroy threw", e);
        }
      }
      for (const bitmap of entry.closeBitmaps) {
        try {
          bitmap.close();
        } catch (e) {
          log.warn("ImageBitmap close threw", e);
        }
      }
    }
    this.retireQueue = remaining;
  }

  /** Drop everything. Used by hot-reload + test harness. */
  clearAll(): void {
    for (const entry of this.classAtlasEntries.values()) {
      this.scheduleRetireClassAtlas(entry);
    }
    for (const entry of this.accEntries.values()) {
      this.scheduleRetireAccessory(entry);
    }
    this.classAtlasEntries.clear();
    this.accEntries.clear();
    this.mountEntries.clear();
    this.classAtlasBytes = 0;
    this.accBytes = 0;
  }

  private finalizeClassAtlasBake(
    key: string,
    bundle: string,
    resolution: number,
    result: VelloSwfClassAtlasResult | null,
  ): void {
    const pending = this.classAtlasBakes.get(key);
    this.classAtlasBakes.delete(key);
    if (!pending) return;
    const liveCbs = pending.callbacks.filter((c) => c.isWanted());
    if (!result) {
      for (const cb of pending.callbacks) cb.onReady(null);
      return;
    }
    if (liveCbs.length === 0) {
      for (const p of result.pages) {
        try {
          p.combinedBitmap.close();
        } catch {}
      }
      return;
    }
    // The Rust path doesn't carry `hasToggleSprite` at the class
    // level — it's a per-export property. We use it here to know
    // whether the `hatEquipped` dimension was expanded for any
    // export. The simplest sound heuristic: read the per-export
    // info from `swfBodyBandInfo`. We use the FIRST export with a
    // toggle sprite as the cache-level flag; collisions with
    // exports that lack the toggle still work because the Rust
    // enumeration emits the right keys per export.
    let hasToggleSprite = false;
    for (const v of result.variants) {
      const info = this.getBodyBandInfo(bundle, v.exportName);
      if (info && info.hasToggleSprite) {
        hasToggleSprite = true;
        break;
      }
    }
    const wrapStart = performance.now();
    const atlas = this.wrapClassAtlas(
      key,
      bundle,
      resolution,
      hasToggleSprite,
      result,
    );
    const wrapMs = performance.now() - wrapStart;
    const totalWallMs = performance.now() - pending.enqueuedAt;
    // Path 2 instrumentation: dump per-phase timing so we can
    // attribute the hidden bake latency. `bake` = Rust render,
    // `pageAlpha` = OffscreenCanvas getImageData per page (GPU
    // readback), `silhouette` = per-variant JS iteration, `transit`
    // = worker→main postMessage incl. ImageBitmap+ArrayBuffer
    // structured-transfer, `wrap` = main-thread Pixi adoption,
    // `wall` = enqueue→delivery (includes time spent waiting in
    // the worker's FIFO queue behind earlier bakes).
    const wt = (
      result as unknown as {
        _workerTimings?: {
          bakeMs?: number;
          pageAlphaMs?: number;
          silhouetteMs?: number;
          transitMs?: number;
          variantCount?: number;
          pageSizes?: Array<{ w: number; h: number }>;
        };
      }
    )._workerTimings;
    if (wt) {
      const pageSizes = (wt.pageSizes ?? [])
        .map((s) => `${s.w}x${s.h}`)
        .join(",");
      log.info(
        `bakeTrace bundle=${bundle} ` +
          `bake=${(wt.bakeMs ?? 0).toFixed(1)} ` +
          `pageAlpha=${(wt.pageAlphaMs ?? 0).toFixed(1)} ` +
          `silhouette=${(wt.silhouetteMs ?? 0).toFixed(1)} ` +
          `transit=${(wt.transitMs ?? 0).toFixed(1)} ` +
          `wrap=${wrapMs.toFixed(1)} ` +
          `wall=${totalWallMs.toFixed(1)} ` +
          `vars=${wt.variantCount ?? "?"} pages=${pageSizes}`,
      );
    } else {
      log.info(
        `classAtlasWall bundle=${bundle} vars=${result.variants.length} pages=${result.pages.length} ` +
          `wall=${totalWallMs.toFixed(1)} wrap=${wrapMs.toFixed(1)} bytesEst=${(atlas.bytesEst / 1024 / 1024).toFixed(1)}MB`,
      );
    }
    this.classAtlasEntries.set(key, atlas);
    this.classAtlasBytes += atlas.bytesEst;
    for (const cb of liveCbs) {
      atlas.refcount += 1;
      cb.onReady(atlas);
    }
    for (const cb of pending.callbacks) {
      if (!liveCbs.includes(cb)) cb.onReady(null);
    }
    this.evictIfOverCap();
  }

  private finalizeAccessoryBake(
    key: string,
    result: VelloSwfAccessoryStripResult | null,
  ): void {
    const pending = this.accBakes.get(key);
    this.accBakes.delete(key);
    if (!pending) return;
    const liveCbs = pending.callbacks.filter((c) => c.isWanted());
    if (!result) {
      for (const cb of pending.callbacks) cb.onReady(null);
      return;
    }
    if (liveCbs.length === 0) {
      try {
        result.bitmap.close();
      } catch {}
      return;
    }
    const strip = this.wrapAccessory(key, result);
    this.accEntries.set(key, strip);
    this.accBytes += strip.bytesEst;
    for (const cb of liveCbs) {
      strip.refcount += 1;
      cb.onReady(strip);
    }
    for (const cb of pending.callbacks) {
      if (!liveCbs.includes(cb)) cb.onReady(null);
    }
    this.evictIfOverCap();
  }

  private wrapClassAtlas(
    key: string,
    bundle: string,
    resolution: number,
    hasToggleSprite: boolean,
    r: VelloSwfClassAtlasResult,
  ): ClassAtlas {
    let pageUploadMs = 0;
    // Silhouette extraction is normally done in the bake worker (see
    // `bake-worker.ts:handleBake`) — each variant arrives with
    // `silhouette` already populated as a `Uint8Array`. Skipping the
    // main-thread `OffscreenCanvas + getImageData` work eliminates
    // ~30-40ms blocking per page (×N pages × N classes on a zoom
    // sweep). When the worker path isn't available (sync fallback
    // through `getStripBakeQueue`) we lazily extract per-page alpha
    // the first time a variant on that page needs it.
    const allVariantsHaveSilhouette = (r.variants as Array<{
      silhouette?: Uint8Array;
    }>).every((v) => v.silhouette instanceof Uint8Array);
    const pageAlphaCache: (Uint8Array | null | undefined)[] = new Array(
      r.pages.length,
    );
    const getPageAlpha = (pageIndex: number): Uint8Array | null => {
      if (pageAlphaCache[pageIndex] !== undefined) {
        return pageAlphaCache[pageIndex] ?? null;
      }
      const p = r.pages[pageIndex];
      if (!p) {
        pageAlphaCache[pageIndex] = null;
        return null;
      }
      const alpha = extractPageAlpha(
        p.combinedBitmap,
        p.atlasWidth,
        p.atlasHeight,
      );
      pageAlphaCache[pageIndex] = alpha;
      return alpha;
    };
    // Path 2: when worker-side silhouettes are disabled (the new
    // default — see `bake-worker.ts` `EXTRACT_SILHOUETTES`), DO NOT
    // fall back to main-thread `getPageAlpha` here. The fallback
    // existed for legacy compatibility but performs the same 256MB
    // GPU→CPU `getImageData` readback that motivated skipping
    // silhouettes in the first place; doing it on the main thread
    // blocks the render loop instead of the worker, which is worse.
    //
    // Picking degrades to AABB via `player-strip-renderer-v2.ts:735`
    // until the hover-poll GPU picker lands. Re-enable this block
    // (and the worker-side equivalent) once an on-demand
    // alpha-readback path is wired into `PickingSystem`.
    const EAGER_SILHOUETTE_FALLBACK = false;
    if (EAGER_SILHOUETTE_FALLBACK && !allVariantsHaveSilhouette) {
      for (let i = 0; i < r.pages.length; i++) {
        getPageAlpha(i);
      }
    }
    const pages: ClassAtlasPage[] = r.pages.map((p, idx) => {
      const upStart = performance.now();
      const combinedTexture = this.buildPixiTextureFromBitmap(
        p.combinedBitmap,
        `${key}#p${idx}`,
      );
      pageUploadMs += performance.now() - upStart;
      return {
        combinedTexture,
        atlasWidth: p.atlasWidth,
        atlasHeight: p.atlasHeight,
      };
    });
    let bytesEst = 0;
    for (const p of pages) {
      bytesEst += estimateBytes(p.atlasWidth, p.atlasHeight);
    }
    if (pageUploadMs > 0.5) {
      log.info(
        `wrapClassAtlas pages=${pages.length} pixiUpload=${pageUploadMs.toFixed(1)}ms ` +
          `silhouettes=${allVariantsHaveSilhouette ? "worker" : "main"}`,
      );
    }
    const variants = new Map<string, VariantInfo>();
    for (const v of r.variants) {
      const page = r.pages[v.pageIndex];
      // Path 2: silhouette is only present if the worker pre-baked it
      // (worker-side `EXTRACT_SILHOUETTES` flag). The lazy fallback
      // through `getPageAlpha` is gated by `EAGER_SILHOUETTE_FALLBACK`
      // above; when off, leave silhouette undefined and let the picker
      // use AABB. Avoids touching the bitmap on this path so its
      // Pixi adoption stays cheap.
      const preBakedSil = (v as unknown as { silhouette?: Uint8Array })
        .silhouette;
      let silhouette: Uint8Array | undefined;
      if (preBakedSil instanceof Uint8Array) {
        silhouette = preBakedSil;
      } else if (EAGER_SILHOUETTE_FALLBACK && page) {
        const pageAlpha = getPageAlpha(v.pageIndex);
        silhouette = pageAlpha
          ? buildVariantSilhouette(
              pageAlpha,
              page.atlasWidth,
              page.atlasHeight,
              v.frameWidth,
              v.frameHeight,
              v.bands,
            )
          : undefined;
      }
      const info: VariantInfo = {
        exportName: v.exportName,
        applyBFix: v.applyBFix,
        hatEquipped: v.hatEquipped,
        pageIndex: v.pageIndex,
        stripWidth: v.stripWidth,
        stripHeight: v.stripHeight,
        frameWidth: v.frameWidth,
        frameHeight: v.frameHeight,
        gridCols: v.gridCols,
        frameCount: v.frameCount,
        totalFrameCount: v.totalFrameCount,
        anchorX: v.anchorX,
        anchorY: v.anchorY,
        bandPadding: v.bandPadding,
        bandCount: v.bandCount,
        slotCount: v.slotCount,
        bands: v.bands.map((b) => ({
          bandIndex: b.bandIndex,
          atlasX: b.atlasX,
          atlasY: b.atlasY,
        })),
        silhouette,
      };
      variants.set(
        variantKey(info.exportName, info.applyBFix, info.hatEquipped),
        info,
      );
      if (!r.bFixUsed && !v.applyBFix) {
        variants.set(
          variantKey(info.exportName, true, info.hatEquipped),
          info,
        );
      }
      if (!hasToggleSprite && !v.hatEquipped) {
        variants.set(
          variantKey(info.exportName, info.applyBFix, true),
          info,
        );
      }
      if (!r.bFixUsed && !hasToggleSprite) {
        variants.set(variantKey(info.exportName, true, true), info);
      }
    }
    return {
      key,
      bundle,
      resolution,
      pages,
      variants,
      bFixUsed: r.bFixUsed,
      hasToggleSprite,
      refcount: 0,
      lastReleasedAt: 0,
      bytesEst,
    };
  }

  private wrapAccessory(
    key: string,
    r: VelloSwfAccessoryStripResult,
  ): AccessoryStrip {
    const texture = this.buildPixiTextureFromBitmap(r.bitmap, key);
    const frames = this.buildFrameTextures(texture, r);
    const bytesEst = estimateBytes(r.width, r.height);
    return {
      key,
      texture,
      frames,
      frameWidth: r.frameWidth,
      frameHeight: r.frameHeight,
      frameCount: r.frameCount,
      anchorX: r.anchorX,
      anchorY: r.anchorY,
      refcount: 0,
      lastReleasedAt: 0,
      bytesEst,
    };
  }

  /**
   * Wrap a Vello-produced `ImageBitmap` as a Pixi `Texture` via
   * `ImageSource`. Pixi uploads the bitmap to its own GPUTexture
   * on first sample; `autoGarbageCollect = false` so the cache LRU
   * controls retire, not Pixi's GC heuristics.
   */
  private buildPixiTextureFromBitmap(
    bitmap: ImageBitmap,
    label: string,
  ): Texture {
    const source = new ImageSource({
      resource: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      label,
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "linear",
      autoGarbageCollect: false,
    });
    // Force-upload to Pixi's GPUTexture now and release the
    // ImageBitmap's CPU/browser backing buffer.
    uploadAndCloseBitmap(getPixiRenderer(), source, bitmap);
    return new Texture({ source });
  }

  private buildFrameTextures(
    base: Texture,
    r: { frameWidth: number; frameHeight: number; frameCount: number; gridCols: number },
  ): Texture[] {
    const out: Texture[] = new Array(r.frameCount);
    for (let i = 0; i < r.frameCount; i++) {
      const col = i % r.gridCols;
      const row = Math.floor(i / r.gridCols);
      const frame = new Texture({
        source: base.source,
        frame: new Rectangle(
          col * r.frameWidth,
          row * r.frameHeight,
          r.frameWidth,
          r.frameHeight,
        ),
      });
      out[i] = frame;
    }
    return out;
  }

  private evictIfOverCap(): void {
    // Cap applies to ACCESSORIES ONLY. Combining classAtlasBytes
    // into the cap check was wrong after Opt-4: class atlases are
    // pinned (no eviction), so `classAtlasBytes` never shrinks. At
    // 1000 bots with full-zoom class atlases (~3.3 GB classes),
    // `total > capBytes` was true on every tick regardless of
    // accessory size — the eviction loop's `used <= capBytes` exit
    // condition could never be met, so EVERY refcount=0 accessory
    // got evicted every tick (21k+ evictions in 15s observed).
    // That eviction storm destroyed accessory Textures fast enough
    // that Pixi's internal batch bind-group cache kept stale
    // refs → `textureSource1=null` crashes resurfaced even with
    // my Texture.EMPTY rebind on the renderer side.
    //
    // The right invariant: class atlas count is self-limiting
    // (~24-30 unique character classes max) and they're pinned for
    // a reason (no re-bake cost). Accessories are the high-churn
    // pool that needs cap pressure. Check only `accBytes`.
    if (this.accBytes <= this.capBytes) return;
    type Candidate = { key: string; bytes: number; t: number };
    const candidates: Candidate[] = [];
    for (const [key, entry] of this.accEntries) {
      if (entry.refcount === 0) {
        candidates.push({
          key,
          bytes: entry.bytesEst,
          t: entry.lastReleasedAt,
        });
      }
    }
    candidates.sort((a, b) => a.t - b.t);
    let used = this.accBytes;
    for (const c of candidates) {
      if (used <= this.capBytes) break;
      const entry = this.accEntries.get(c.key);
      if (!entry) continue;
      this.accEntries.delete(c.key);
      this.accBytes -= entry.bytesEst;
      this.scheduleRetireAccessory(entry);
      this.evicts += 1;
      used -= c.bytes;
    }
  }

  private scheduleRetireClassAtlas(entry: ClassAtlas): void {
    // Two retire paths depending on whether the page is backed by
    // the SharedInputAtlas (Path 1 batch-merging).
    //
    //  - Super-atlas-backed page: `combinedTexture` is a shared
    //    super-page RT. We MUST NOT destroy it — other variants on
    //    the same page would lose their backing. Instead free the
    //    slot back to the super atlas so its tracker decrements.
    //
    //  - Standalone page (fallback when super alloc failed or the
    //    legacy class-atlas wrap path is used): `combinedTexture` is
    //    a dedicated per-page texture. Destroy it as before.
    //
    // Rust-side temp textures are dropped at end of the bake call and
    // queued into the wgpu deferred_destroy queue for VRAM release.
    const superAtlas = getSharedInputAtlas();
    const destroyTextures: Texture[] = [];
    for (const page of entry.pages) {
      if (page.inputAtlasSlot) {
        superAtlas.freeSlot(page.inputAtlasSlot);
      } else {
        destroyTextures.push(page.combinedTexture);
      }
    }
    this.retireQueue.push({
      destroyTextures,
      closeBitmaps: [],
      ticksRemaining: RETIRE_TICKS,
    });
  }

  private scheduleRetireAccessory(entry: AccessoryStrip): void {
    this.retireQueue.push({
      destroyTextures: [...entry.frames, entry.texture],
      closeBitmaps: [],
      ticksRemaining: RETIRE_TICKS,
    });
  }
}

let instance: CharacterCache | null = null;

export function getCharacterCache(): CharacterCache {
  if (!instance) instance = new CharacterCache();
  return instance;
}

export type { CharacterCache };
