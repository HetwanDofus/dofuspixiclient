/**
 * Path B shared cache for body bands + accessory strips + mount
 * transforms. Sits between `PlayerStripRenderer` and `vello-loader` so
 * 400 bots of the same class share one body strip per (band × dir ×
 * anim) instead of 400 unique strips.
 *
 * Cache keys:
 *   body band  → `bundle|export|bandIndex|applyBFix`
 *   accessory  → `accBundle|accExport|slot|animType|dir|side`
 *   mount xfm  → `bundle|export|start|count|applyBFix`
 *
 * Cross-bot sharing makes the body strip count grow with (class × dir
 * × anim × band) instead of (bot count). The whole point of Path B.
 *
 * Refcount semantics: each `PlayerStripRenderer` slot using a strip
 * holds one ref. On anim swap, drop the old ref + acquire the new.
 * When refcount hits 0 the strip stays in the cache (the next swap is
 * usually within ms) but is eligible for LRU eviction when total
 * cache bytes crosses the cap.
 *
 * Two-tick settle on eviction (mirrors `player-strip-renderer.ts`
 * `scheduleRetire`): the GPU texture is freed via `freeRenderTexture`
 * only after two Pixi ticks so in-flight samplers on the old texture
 * complete first. The patched-wgpu Drop is a no-op
 * (`feedback_pixi_wgpu_texture_lifetime`), so this is the ONLY place
 * GPU memory actually gets released.
 *
 * Bakes are dispatched through `getStripBakeQueue()` for adaptive
 * frame budgeting — cache misses don't stall the rAF callback.
 */

import {
  ImageSource,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
  type TextureSource,
  Ticker,
} from "pixi.js";

import {
  getPixiRenderer,
  renderSwfAccessoryStrip,
  renderSwfBodyAtlas,
  renderSwfMountTransforms,
  swfAccessoryCanonicalAnimType,
  swfBodyBandInfo,
  tickDeferredDestroys,
  uploadAndCloseBitmap,
  type VelloSwfAccessoryStripResult,
  type VelloSwfBodyAtlasResult,
  type VelloSwfBodyBandInfo,
} from "@/game/render/vello-loader";
import { getStripBakeQueue } from "@/game/render/strip-bake-queue";
import { createLogger } from "@/utils/logger";

const log = createLogger("CharacterCache");

/** Maximum accessory slot id Path B addresses (0..=4 = weapon, hat,
 *  cape, pet, shield). Matches the mount-transform layout in Rust. */
export const MAX_SLOT = 5;

/**
 * Default LRU cap in bytes.
 *
 * Sizing rule post-bridge-migration: cap is now a DIRECT cost on
 * process memory.
 *
 * The original 1.5 GB target was rationalized around the patched
 * fork's no-op `Drop for WebTexture`: a small cap caused eviction
 * churn → re-bakes → Vello-internal staging textures leaked forever
 * → total memory climbed even as the cache stayed small. So a big
 * cap minimised total memory.
 *
 * That model no longer applies. Two architectural changes broke it:
 *
 *   1. Selective Drop wiring (STEP_11_BRIDGE_NOTES.md C1 refinement)
 *      now queues every Vello-internal texture into `deferred_destroy`.
 *      `createdTex - destroyedTex ≈ liveTex` confirmed by real
 *      STRESS_JSON: 28 GB created, 28 GB destroyed, 12 MB live. The
 *      leak is gone; cache cap no longer compounds it.
 *
 *   2. Bridge migration uploads every cached source to Pixi's own
 *      GPUTexture. So each cache entry costs ~2× its byte size:
 *      once in our LRU accounting + once in Pixi's GPU memory.
 *      Lower cap → less Pixi GPU. Direct 1:1.
 *
 * Real-data working sets (200-bot stress with random looks),
 * post-color+zone-merge:
 *  - body atlases: ~500 entries × ~1.1 MB = ~550 MB (was ~1.2 GB
 *    pre-merge — 50 % smaller because zone packed into color's
 *    alpha LSBs)
 *  - accessories:  ~3800 × ~65 KB = ~250 MB
 *  - combined working set: ~800 MB
 *
 * Cap sizing trade-off observed in real stress runs at 200 bots:
 *
 *  - 800 MB cap: working set = cap → LRU thrashes on every
 *    accessory growth tick. 2381 evictions / 30 s, fps 60 → 30.
 *  - 1024 MB cap: looked stable for 41 s, then cap hit at t=46 s
 *    once both body (~650 MB) and acc (~376 MB) converged.
 *    Eviction sustained ~24/s afterward → fps degraded from 60
 *    to 36 over the following 15 s. The 10-min-stable target
 *    failed because the cap landed AT the working set ceiling.
 *  - 1500 MB cap: ~200 MB headroom above the observed
 *    equilibrium of ~1.3 GB (body 650 + acc growing toward
 *    520-650 once all unique combinations are sampled). Zero
 *    eviction churn under stress.
 *
 * Why the working set keeps growing past 56 s of stress:
 *   - Body atlases converge at ~569 entries (12 classes × 5
 *     dirs × 3 anims × 2 flipped = 360 nominal; bots' random
 *     looks generate variations).
 *   - Accessory entries grew 1053 → 5780 over 50 s with the
 *     rate still 6-10/s at the cap point — keyed by
 *     (bundle × export × slot × animType × dir). Equilibrium
 *     is closer to 8000-10000 unique combinations across
 *     200 random-look bots.
 *
 * Memory math at 1500 MB cap + color+zone merge:
 *  - LRU cache:        ~1.4 GB at equilibrium (stress)
 *  - Pixi GPU mirror:  ~1.4 GB (same entries, half-size per
 *                       atlas thanks to merge)
 *  - Pixi bitmap pool: ~120 MB (off-screen bots' uploads pending)
 *  - Rust wasm + buffers: ~780 MB
 *  - JS heap + browser overhead: ~1 GB
 *  - Process total:    ~4.5 GB
 *
 * Real gameplay (16-char fights) never approaches the cap —
 * working set sits at ~400 MB. The cap is purely a stress-
 * test ceiling.
 *
 * **2026-05-22 update**: bumped from 1500 MB → 2000 MB. The
 * canonical band-split fix made body atlases ~3× bigger (each
 * band gets its own strip in the atlas). After empty-band-skip
 * + hat-dedup the working set for 200-bot random-look stress
 * settled at ~410 entries × 3.4 MB ≈ 1.4 GB but kept thrashing
 * (`hitPct` plateaued at 65 %, ~260 evicts/sec). Bumping to
 * 2 GB lets ~590 entries fit — comfortably above the working
 * set with headroom for spikes. Memory cost: +500 MB GPU.
 */
const DEFAULT_BYTES_CAP = 2000 * 1024 * 1024;

/** GPU pixels are 4 bytes (BGRA8/Rgba8Unorm). */
const BYTES_PER_PIXEL = 4;

/** Two ticks of settle before `freeRenderTexture` runs. */
const RETIRE_TICKS = 2;

/**
 * Sub-rect describing where a single Z-ordered band lives inside the
 * shared colour + zone-id atlas. The mesh shader uses these to clamp
 * its UV range to the band's region — every band of the same body
 * shares the same `frameWidth`, `frameHeight`, anchor, and grid; only
 * `atlasX/atlasY` differs.
 */
export interface BodyAtlasBand {
  readonly bandIndex: number;
  readonly atlasX: number;
  readonly atlasY: number;
}

/**
 * One body atlas = one colour texture + one zone-id texture for ALL
 * bands of a single (bundle, export, anim) tuple. Per-bot meshes
 * sample sub-regions of this shared atlas at runtime; the atlas is
 * refcounted across every bot of the same class.
 */
/**
 * Per-class shared atlas page. Holds a 4096² `RenderTexture` into
 * which every variant (anim, dir, flip, hat) of the class blits its
 * baked sub-rect via Pixi's renderer. All `BodyAtlas` entries
 * pointing at this page share `combinedTexture.source.uid`, so the
 * `BodyBandBatch` registry (`composition-atlas.ts`) collapses from
 * ~1 batch per variant (~1156 at 500 random-look bots) to ~1 batch
 * per class × band (~60 max).
 *
 * Pages are allocated lazily on first variant bake completion for a
 * (bundle, resolution) tuple. When all variant entries pointing at
 * a page are evicted, the page is destroyed.
 *
 * The shelf packer fills variants left-to-right, advancing to the
 * next shelf on overflow. Variant sub-rects are never reclaimed
 * (no compaction); when the page is full, a new page is allocated
 * and subsequent variants land there.
 */
/**
 * 8192² pages — verified safe now that `GuillotinePacker`
 * (replaces the earlier `ShelfPacker`) supports `free`. Stress
 * verification at 4096² showed page count stabilising at 62 (no
 * leak). The previous catastrophic 15 GB leak at 8192² was
 * caused by `ShelfPacker.pack()` not reclaiming evicted
 * sub-rects, not by the page size itself.
 *
 * Memory: 8192² × 4 bytes = 256 MB GPU per page. At ~1-2 pages
 * per class × 12 classes = ~16-25 pages total = ~4-6 GB GPU.
 * Same order as 4096²'s 62 × 64 MB = 4 GB. Trading more page
 * area for fewer pages.
 *
 * Batch consolidation: classes likely fit in 1-2 pages each,
 * dropping `BodyBandBatch` count from ~540 (4096²) to ~120-150
 * (8192²). Compose pass cost scales linearly with batch count
 * so this directly reduces `composeBot.perFrameMs`.
 *
 * WebGPU spec minimum `maxTextureDimension2d = 8192`. M-series
 * Macs commonly report 16384. Should be safe everywhere we ship.
 */
const CLASS_ATLAS_PAGE_W = 8192;
const CLASS_ATLAS_PAGE_H = 8192;

/**
 * Free-list-supporting bin packer (guillotine-style splits, no
 * merging on free).
 *
 * Maintains a list of free rectangles. `alloc` finds the smallest
 * fitting rect (best-area-fit heuristic), removes it, places the
 * caller's rect at its top-left, and splits the remainder into 1-2
 * new free rects via a guillotine cut. `free` adds the released
 * rect back to the list.
 *
 * No merge step on free — keeps the implementation small and
 * predictable. In our workload (variants of similar dims per anim
 * type) fragmentation stays bounded because freed slots get reused
 * by same-anim-type variants nearby.
 *
 * Bug history: the earlier `ShelfPacker` had no `free`, so evicted
 * variants couldn't reuse their slots and pages filled
 * irreversibly. At 500-bot random-look stress this leaked 256 MB ×
 * ~60 pages = 15 GB GPU in 30 seconds and caused
 * "bots moving without animation" symptoms from
 * `RenderTexture.create` failing under GPU OOM.
 */
interface PackedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

class GuillotinePacker {
  private freeRects: PackedRect[];

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    this.freeRects = [{ x: 0, y: 0, w: width, h: height }];
  }

  /**
   * Try to place a w×h rect. Returns the allocated rect (caller's
   * w/h, plus x/y) or null when no free space fits.
   *
   * Best-area-fit: pick the SMALLEST free rect that still fits the
   * request. Reduces fragmentation more than first-fit because
   * large free rects stay available for the next big variant.
   */
  alloc(w: number, h: number): PackedRect | null {
    if (w <= 0 || h <= 0) return null;
    if (w > this.width || h > this.height) return null;
    let bestIdx = -1;
    let bestArea = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.freeRects.length; i++) {
      const r = this.freeRects[i];
      if (r.w >= w && r.h >= h) {
        const area = r.w * r.h;
        if (area < bestArea) {
          bestArea = area;
          bestIdx = i;
        }
      }
    }
    if (bestIdx < 0) return null;

    const chosen = this.freeRects[bestIdx];
    const placed: PackedRect = { x: chosen.x, y: chosen.y, w, h };
    // Remove the chosen free rect; re-add the unused remainder
    // as 1-2 new free rects via guillotine cut.
    this.freeRects.splice(bestIdx, 1);
    const dw = chosen.w - w;
    const dh = chosen.h - h;
    if (dw > 0 && dh > 0) {
      // Split direction: cut along the LONGER unused axis first so
      // the bigger remaining piece stays whole and accommodates
      // future large variants. Matches "guillotine split along the
      // shorter axis" heuristic for fragmentation control.
      if (dw > dh) {
        // Vertical cut: right piece is full-height; bottom piece is
        // only as wide as the placed rect.
        this.freeRects.push({ x: chosen.x + w, y: chosen.y, w: dw, h: chosen.h });
        this.freeRects.push({ x: chosen.x, y: chosen.y + h, w, h: dh });
      } else {
        // Horizontal cut.
        this.freeRects.push({ x: chosen.x, y: chosen.y + h, w: chosen.w, h: dh });
        this.freeRects.push({ x: chosen.x + w, y: chosen.y, w: dw, h });
      }
    } else if (dw > 0) {
      this.freeRects.push({ x: chosen.x + w, y: chosen.y, w: dw, h: chosen.h });
    } else if (dh > 0) {
      this.freeRects.push({ x: chosen.x, y: chosen.y + h, w: chosen.w, h: dh });
    }
    return placed;
  }

  /**
   * Release an allocated rect back to the free list. No merge with
   * adjacent free rects — accepts some fragmentation in exchange
   * for O(1) free. Same-anim-type variants have similar dims, so
   * a freed walkR slot is happily reused by walkL, etc.
   */
  free(rect: PackedRect): void {
    this.freeRects.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  }

  /** Diagnostic: total unallocated area. */
  totalFreeArea(): number {
    let area = 0;
    for (const r of this.freeRects) area += r.w * r.h;
    return area;
  }
}

interface ClassAtlasPage {
  readonly key: string;            // `${bundle}|${resolutionQuantised}#${pageIdx}`
  readonly bundle: string;
  readonly resolution: number;
  readonly renderTexture: RenderTexture;
  readonly source: TextureSource;
  readonly packer: GuillotinePacker;
  /** Number of live `BodyAtlas` entries pointing at this page.
   *  Page is destroyed once this hits 0 (after the retire-tick
   *  settle window). */
  refcount: number;
}

export interface BodyAtlas {
  readonly key: string;
  /**
   * Combined-bridge `Texture`: a single Pixi `ImageSource` wrapping
   * the merged RGBA8 atlas where RGB = body color and the alpha
   * channel encodes `(body_alpha & 0xFC) | zone_id`.
   *
   * The body-band shader binds this texture twice — once with a
   * LINEAR sampler (for color + AA-smoothed body alpha) and once
   * with a NEAREST sampler (for pixel-perfect zone-id decode from
   * the low 2 bits of the alpha byte). One source instead of two
   * halves the Pixi GPU working set per atlas.
   */
  readonly combinedTexture: Texture;
  /** Atlas pixel dimensions (sub-region origin uses these as denom). */
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  /** Single-band strip dims inside the atlas (every band identical). */
  readonly stripWidth: number;
  readonly stripHeight: number;
  /** Per-anim-frame cell dims inside a band. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Number of cells per row inside a band. */
  readonly gridCols: number;
  /** Valid anim frame count (cells per band). */
  readonly frameCount: number;
  /** SWF (0,0) anchor inside each cell — same for all bands. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Per-band sub-rect metadata. `bands.length === bandCount`. */
  readonly bands: BodyAtlasBand[];
  readonly bandCount: number;
  readonly slotCount: number;
  readonly bandPadding: number;
  /** Internal — managed by the cache. */
  refcount: number;
  lastReleasedAt: number;
  readonly bytesEst: number;
  /**
   * Internal — set when this BodyAtlas's `combinedTexture` samples
   * a sub-rect of a shared class atlas page. `undefined` for
   * legacy per-variant atlases that own their own GPU texture
   * (fallback path when the class page is exhausted or the variant
   * is too large to pack).
   *
   * When set, `combinedTexture.destroy(false)` on retire only drops
   * the `Texture` wrapper — the underlying source is owned by the
   * page and stays alive until every variant on the page retires.
   * `classPageRect` is the sub-rect we allocated; on retire we
   * `packer.free(classPageRect)` so subsequent allocations can
   * reuse the slot. WITHOUT this free, pages fill irreversibly
   * (the bug that caused 15 GB GPU leak at 500-bot stress).
   */
  classPage?: ClassAtlasPage;
  classPageRect?: PackedRect;
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
  bodyEntries: number;
  bodyBytes: number;
  accEntries: number;
  accBytes: number;
  mountEntries: number;
  hits: number;
  misses: number;
  evicts: number;
  capBytes: number;
}

interface PendingBodyAtlasBake {
  /** Bundle + resolution captured at enqueue time so
   *  `finalizeBodyAtlasBake` can route the result to the right
   *  class atlas page even though the bake `key` includes the
   *  applyBFix / hatEquipped dimensions that the page doesn't care
   *  about. */
  bundle: string;
  resolution: number;
  callbacks: Array<{
    onReady: (atlas: BodyAtlas | null) => void;
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
   * Step 11 bridge: ImageBitmaps owned by an evicted body atlas.
   * Closing them releases the canvas drawing buffer's GPU resource
   * immediately rather than waiting for JS GC. `Texture.destroy(true)`
   * destroys the wrapping `ImageSource` but doesn't auto-`close` the
   * bitmap — that's our responsibility.
   */
  closeBitmaps: ImageBitmap[];
  ticksRemaining: number;
  /** Class-atlas page retire path: invoked after the settle window
   *  to drop the variant's `Texture` wrapper (not the shared
   *  source) and decrement the page's refcount. */
  onSettled?: () => void;
}

interface BodyAtlasKeyParts {
  bundle: string;
  exportName: string;
  start: number;
  count: number;
  totalFrameCount: number;
  resolution: number;
  applyBFix: boolean;
  /** True if the bot has a hat (slot 1) equipped. Canonical AS2's
   *  `mcToHide` semantic: hair-toggle sprites pin to the "short
   *  hair" frame when this is true, "full hair" frame otherwise. */
  hatEquipped: boolean;
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

/**
 * Construct cache keys. Keys are intentionally stable strings (not
 * tuples) so the bake-queue dedup hits — the queue's key is the
 * cache key by design.
 */
function bodyAtlasKey(p: BodyAtlasKeyParts): string {
  return `body|${p.bundle}|${p.exportName}|${p.start}|${p.count}|${p.totalFrameCount}|${p.resolution}|${p.applyBFix ? 1 : 0}|${p.hatEquipped ? 1 : 0}`;
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

class CharacterCache {
  private bodyAtlasEntries = new Map<string, BodyAtlas>();
  private accEntries = new Map<string, AccessoryStrip>();
  private mountEntries = new Map<string, MountTransforms>();
  private bodyAtlasBakes = new Map<string, PendingBodyAtlasBake>();
  private accBakes = new Map<string, PendingAccessoryBake>();
  private bandInfoCache = new Map<string, VelloSwfBodyBandInfo>();
  /**
   * Memo of the canonical animType per accessory tuple. See the
   * detailed reasoning in `acquireAccessory`. Without this memo,
   * the per-acquire wasm-boundary crossing dominates frame cost
   * once the cache is hit-heavy (every cache hit still calls the
   * Rust helper to normalise animType, even though the answer
   * never changes for given inputs).
   */
  private accessoryCanonicalAnimTypeMemo = new Map<string, number>();
  private retireQueue: RetireQueueEntry[] = [];
  private tickerInstalled = false;
  private tickerCallback: (() => void) | null = null;

  private hits = 0;
  private misses = 0;
  private evicts = 0;
  private bodyBytes = 0;
  private accBytes = 0;
  private capBytes = DEFAULT_BYTES_CAP;

  /**
   * Per-class atlas pages. Key = `${bundle}|${resolution × 1000}`
   * (resolution quantised so cache hits survive floating-point
   * resolution values from `setResolutionAndRerender`).
   *
   * Each entry is an array because a class may overflow one 4096²
   * page and roll onto a new one.
   */
  private classAtlasPages = new Map<string, ClassAtlasPage[]>();

  /**
   * Lazy-install the retire-queue drain on Pixi's shared ticker the
   * first time a strip is acquired. Self-driving means callers don't
   * have to wire a tick into every scene loop. Cheap — `tick()` is a
   * no-op when the queue is empty, which is the steady state.
   */
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
   * Acquire a refcount on a body atlas (covering every band of a
   * single (bundle, export, anim)). Cache hit returns synchronously;
   * cache miss enqueues a single bake that produces the full atlas
   * pair (colour + zone) plus per-band sub-rects in one call.
   *
   * `isWanted` is honored by the bake queue: if every requester
   * moved on before the bake fires, the bake is skipped and the
   * `onReady` callbacks receive `null`.
   */
  acquireBodyAtlas(
    parts: BodyAtlasKeyParts,
    onReady: (atlas: BodyAtlas | null) => void,
    isWanted: () => boolean,
    /** `"high"` (default) for live applyAnimation calls — the bot
     *  is on screen waiting to render. `"low"` for background
     *  pre-warm sweeps that just want to populate the cache for
     *  future use; pre-warm bakes drain only after every live
     *  request has cleared. Cuts spawn-ramp latency from ~3-4 s
     *  to <100 ms under 200+ bot bursts. */
    priority: "high" | "low" = "high",
  ): void {
    this.ensureTickerInstalled();
    // A1: when no accessory mount on this character declares bFix,
    // the Rust sprite walker's bFix path is a no-op — the bake is
    // pixel-identical regardless of applyBFix. Collapse both variants
    // to a single cache entry by forcing applyBFix=false in the key.
    // A2: same trick for hatEquipped — only bodies with toggle
    // sprites (canonical: just Iop) bake different pixels per hat
    // state. Other classes dedupe.
    const normalized = this.normalizeHatEquipped(this.normalizeBFix(parts));
    const key = bodyAtlasKey(normalized);
    const existing = this.bodyAtlasEntries.get(key);
    if (existing) {
      existing.refcount += 1;
      this.hits += 1;
      onReady(existing);
      return;
    }
    this.misses += 1;
    const pending = this.bodyAtlasBakes.get(key);
    if (pending) {
      pending.callbacks.push({ onReady, isWanted });
    } else {
      this.bodyAtlasBakes.set(key, {
        bundle: normalized.bundle,
        resolution: normalized.resolution,
        callbacks: [{ onReady, isWanted }],
      });
    }
    getStripBakeQueue().enqueue(
      key,
      () =>
        renderSwfBodyAtlas(
          normalized.bundle,
          normalized.exportName,
          normalized.start,
          normalized.count,
          normalized.totalFrameCount,
          normalized.resolution,
          normalized.applyBFix,
          normalized.hatEquipped,
        ),
      (raw) => {
        this.finalizeBodyAtlasBake(key, raw as VelloSwfBodyAtlasResult | null);
      },
      () => {
        const bake = this.bodyAtlasBakes.get(key);
        if (!bake) return false;
        return bake.callbacks.some((c) => c.isWanted());
      },
      priority,
    );
  }

  /**
   * Returns a copy of `parts` with `applyBFix` forced to `false` when
   * the character has no bFix-active accessory mount — in that case
   * the Rust bake produces the same pixels either way. Cuts the bake
   * key dimension in half for cape/shieldless classes.
   *
   * Applied to both body-atlas and mount-transform key construction.
   */
  private normalizeBFix<T extends { bundle: string; exportName: string; applyBFix: boolean }>(
    parts: T,
  ): T {
    if (!parts.applyBFix) return parts;
    const info = this.getBodyBandInfo(parts.bundle, parts.exportName);
    if (info && info.bFixUsed === false) {
      return { ...parts, applyBFix: false };
    }
    return parts;
  }

  /**
   * Returns a copy of `parts` with `hatEquipped` forced to `false`
   * when the body has no accessory-toggle sprite. In that case the
   * Rust bake produces pixel-identical output regardless of hat
   * state — caching both variants wastes ~50 % of cache footprint.
   *
   * For canonical Dofus 1.29 only Iop has a toggle sprite, so this
   * collapses the variant dimension for the other 11 classes.
   */
  private normalizeHatEquipped<
    T extends { bundle: string; exportName: string; hatEquipped: boolean },
  >(parts: T): T {
    if (!parts.hatEquipped) return parts;
    const info = this.getBodyBandInfo(parts.bundle, parts.exportName);
    if (info && info.hasToggleSprite === false) {
      return { ...parts, hatEquipped: false };
    }
    return parts;
  }

  /** Drop a previously-acquired body atlas. */
  releaseBodyAtlas(atlas: BodyAtlas): void {
    if (atlas.refcount <= 0) {
      log.warn(`releaseBodyAtlas underflow on '${atlas.key}'`);
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
    // deterministic — same inputs always produce the same canonical
    // value — so we cache the result per unique input tuple. Before
    // memoisation, this wasm-boundary crossing fired on EVERY
    // accessory acquire (~10 k crossings/sec at 200-bot stress),
    // each one allocating UTF-8 strings for `bundle`/`exportName`/
    // `dir`/`side` and running up to 9 frame-pick walks Rust-side.
    // Observable cost: ~75 ms/sec of CPU once the cache went hit-
    // heavy, sufficient to push fps from 60 to ~55 sustained.
    //
    // Memoised cost: one wasm crossing + one Map entry per unique
    // (bundle, export, slot, dir, side, rawAnimType) tuple. With
    // ~10 k unique tuples observed in stress, memo size is ~1 MB.
    // Subsequent calls for the same tuple are a Map lookup (~50 ns)
    // and avoid the wasm crossing entirely.
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
   * indefinitely until `clearAll()`.
   */
  getMounts(parts: MountKeyParts): MountTransforms | null {
    // A1: dedup the bFix dimension when the character has no
    // bFix-active mount — the mount-transform bake produces the same
    // affine matrices either way.
    const normalized = this.normalizeBFix(parts);
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
   *  `frameIdx`. JS uses this as the authoritative "render the
   *  accessory?" signal — see `mount_transforms.rs`. */
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
      bodyEntries: this.bodyAtlasEntries.size,
      bodyBytes: this.bodyBytes,
      accEntries: this.accEntries.size,
      accBytes: this.accBytes,
      mountEntries: this.mountEntries.size,
      hits: this.hits,
      misses: this.misses,
      evicts: this.evicts,
      capBytes: this.capBytes,
    };
  }

  /**
   * Tick the retire queue + the patched-fork's deferred-destroy
   * queue. Call once per Pixi ticker tick.
   *
   * The deferred-destroy tick is what actually releases VRAM from
   * Vello-internal staging textures/buffers that get dropped during
   * a Vello render. Without it, those handles leak forever via the
   * patched fork's no-op Drop. We bound the per-tick destroy work to
   * 256 to avoid stalling a single rAF when a burst of drops needs
   * processing.
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
          // destroy(true) cascades to the underlying ImageSource +
          // its uploaded GPU texture. Releases all VRAM owned by
          // this body atlas / accessory entry.
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
      if (entry.onSettled) {
        try {
          entry.onSettled();
        } catch (e) {
          log.warn("retire onSettled threw", e);
        }
      }
    }
    this.retireQueue = remaining;
  }

  /** Drop everything. Used by hot-reload + test harness. */
  clearAll(): void {
    for (const entry of this.bodyAtlasEntries.values()) {
      this.scheduleRetireBodyAtlas(entry);
    }
    for (const entry of this.accEntries.values()) {
      this.scheduleRetireAccessory(entry);
    }
    this.bodyAtlasEntries.clear();
    this.accEntries.clear();
    this.mountEntries.clear();
    this.bodyBytes = 0;
    this.accBytes = 0;
  }

  private finalizeBodyAtlasBake(
    key: string,
    result: VelloSwfBodyAtlasResult | null,
  ): void {
    const pending = this.bodyAtlasBakes.get(key);
    this.bodyAtlasBakes.delete(key);
    if (!pending) return;
    const liveCbs = pending.callbacks.filter((c) => c.isWanted());
    if (!result) {
      for (const cb of pending.callbacks) cb.onReady(null);
      return;
    }
    if (liveCbs.length === 0) {
      // Stale bake — close the combined bitmap immediately so its
      // canvas-drawing buffer is released. Rust-side temps already
      // dropped and are in deferred_destroy.
      try {
        result.combinedBitmap.close();
      } catch {}
      return;
    }
    const atlas = this.wrapBodyAtlas(
      key,
      pending.bundle,
      pending.resolution,
      result,
    );
    this.bodyAtlasEntries.set(key, atlas);
    this.bodyBytes += atlas.bytesEst;
    for (const cb of liveCbs) {
      atlas.refcount += 1;
      cb.onReady(atlas);
    }
    // Stale callbacks notified — they shouldn't increment refcount.
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

  private wrapBodyAtlas(
    key: string,
    bundle: string,
    resolution: number,
    r: VelloSwfBodyAtlasResult,
  ): BodyAtlas {
    // Try to blit this variant's bitmap into a shared class-atlas
    // page. All variants of the same class share
    // `combinedTexture.source.uid` so `BodyBandBatch` consolidates
    // batches from ~1 per variant to ~1 per class. With
    // `GuillotinePacker` (replaces the broken `ShelfPacker`),
    // evicted variants release their sub-rect back to the page so
    // the next variant of similar size reuses it — no leak.
    //
    // Fallback (per-variant texture) on:
    //   - Variant atlas dims > page dims (8192²).
    //   - GPU allocation failure (true OOM).
    //   - Blit failure (renderer not ready, etc.).
    const classWrap = this.tryWrapIntoClassPage(key, bundle, resolution, r);
    if (classWrap) return classWrap;
    return this.wrapBodyAtlasLegacy(key, r);
  }

  /**
   * Class-atlas path: bin-pack the variant into a per-class page,
   * blit its bitmap, return a BodyAtlas sampling the shared page.
   * Returns `null` to signal "couldn't pack; use legacy fallback".
   */
  private tryWrapIntoClassPage(
    key: string,
    bundle: string,
    resolution: number,
    r: VelloSwfBodyAtlasResult,
  ): BodyAtlas | null {
    if (
      r.atlasWidth <= 0 ||
      r.atlasHeight <= 0 ||
      r.atlasWidth > CLASS_ATLAS_PAGE_W ||
      r.atlasHeight > CLASS_ATLAS_PAGE_H
    ) {
      return null;
    }
    const pageAndRect = this.allocOnClassPage(
      bundle,
      resolution,
      r.atlasWidth,
      r.atlasHeight,
    );
    if (!pageAndRect) return null;
    const { page, rect: pos } = pageAndRect;

    // Upload bitmap as a transient ImageSource with NEAREST sampling
    // so the zone-id LSBs in the alpha channel are preserved across
    // the blit (LINEAR would smear adjacent zone IDs and corrupt
    // the recolor path).
    let tempSource: ImageSource;
    try {
      tempSource = new ImageSource({
        resource: r.combinedBitmap,
        width: r.atlasWidth,
        height: r.atlasHeight,
        label: `${key}-blit`,
        alphaMode: "premultiply-alpha-on-upload",
        scaleMode: "nearest",
        autoGarbageCollect: false,
      });
      uploadAndCloseBitmap(getPixiRenderer(), tempSource, r.combinedBitmap);
    } catch (e) {
      log.warn(`tryWrapIntoClassPage: failed to upload bitmap for ${key}`, e);
      return null;
    }

    const renderer = getPixiRenderer();
    let blitOk = false;
    if (renderer) {
      try {
        const tempTexture = new Texture({ source: tempSource });
        const sprite = new Sprite({ texture: tempTexture });
        sprite.position.set(pos.x, pos.y);
        (renderer as unknown as {
          render: (o: {
            container: unknown;
            target: RenderTexture;
            clear: boolean;
          }) => void;
        }).render({
          container: sprite,
          target: page.renderTexture,
          clear: false,
        });
        try {
          sprite.destroy({ children: false });
        } catch {}
        try {
          tempTexture.destroy(false);
        } catch {}
        blitOk = true;
      } catch (e) {
        log.warn(`tryWrapIntoClassPage: blit failed for ${key}`, e);
      }
    }
    try {
      tempSource.unload();
    } catch {}
    try {
      tempSource.destroy();
    } catch {}
    if (!blitOk) return null;

    page.refcount += 1;
    const bytesEst = estimateBytes(r.atlasWidth, r.atlasHeight);
    const combinedTexture = new Texture({
      source: page.source,
      // No `frame` restriction — the body-band shader uses
      // per-instance `aAtlasUV` derived from `atlasWidth/Height`
      // (page dims) and the bands' absolute positions. Frame would
      // be redundant.
    });
    return {
      key,
      combinedTexture,
      atlasWidth: CLASS_ATLAS_PAGE_W,
      atlasHeight: CLASS_ATLAS_PAGE_H,
      stripWidth: r.stripWidth,
      stripHeight: r.stripHeight,
      frameWidth: r.frameWidth,
      frameHeight: r.frameHeight,
      gridCols: r.gridCols,
      frameCount: r.frameCount,
      anchorX: r.anchorX,
      anchorY: r.anchorY,
      // Translate per-variant band sub-rects into absolute
      // positions inside the class atlas page.
      bands: r.bands.map((b) => ({
        bandIndex: b.bandIndex,
        atlasX: pos.x + b.atlasX,
        atlasY: pos.y + b.atlasY,
      })),
      bandCount: r.bandCount,
      slotCount: r.slotCount,
      bandPadding: r.bandPadding,
      refcount: 0,
      lastReleasedAt: 0,
      bytesEst,
      classPage: page,
      // Remember the rect we got back from the guillotine packer
      // so the retire path can `page.packer.free(rect)` and let
      // the next variant of similar dims reuse the slot. WITHOUT
      // freeing, pages fill irreversibly under stress (the bug
      // that caused 15 GB GPU leak at 500-bot stress).
      classPageRect: pos,
    };
  }

  /**
   * Legacy per-variant atlas — used as fallback when the class
   * page can't accommodate the variant. The BodyAtlas owns its
   * own Pixi texture; `BodyBandBatch` keys on this unique source
   * uid so it gets its own batch (back to the pre-Phase-C path
   * for this one variant).
   */
  private wrapBodyAtlasLegacy(key: string, r: VelloSwfBodyAtlasResult): BodyAtlas {
    const combinedTexture = this.buildPixiTextureFromBitmap(
      r.combinedBitmap,
      key,
    );
    const bytesEst = estimateBytes(r.atlasWidth, r.atlasHeight);
    return {
      key,
      combinedTexture,
      atlasWidth: r.atlasWidth,
      atlasHeight: r.atlasHeight,
      stripWidth: r.stripWidth,
      stripHeight: r.stripHeight,
      frameWidth: r.frameWidth,
      frameHeight: r.frameHeight,
      gridCols: r.gridCols,
      frameCount: r.frameCount,
      anchorX: r.anchorX,
      anchorY: r.anchorY,
      bands: r.bands,
      bandCount: r.bandCount,
      slotCount: r.slotCount,
      bandPadding: r.bandPadding,
      refcount: 0,
      lastReleasedAt: 0,
      bytesEst,
    };
  }

  /**
   * Allocate a sub-rect for the variant on a `(bundle, resolution)`
   * class page. Tries every existing page first via the guillotine
   * packer's `alloc`; only when ALL existing pages are too
   * fragmented to fit does it create a new page.
   *
   * Returns `{ page, rect }` or `null` on true GPU OOM
   * (`RenderTexture.create` fails).
   *
   * Single-step alloc (no peek-then-commit two-phase) — the
   * guillotine packer's `alloc` directly returns the placed rect
   * or null, so we get atomic allocation per call.
   */
  private allocOnClassPage(
    bundle: string,
    resolution: number,
    needW: number,
    needH: number,
  ): { page: ClassAtlasPage; rect: PackedRect } | null {
    const key = `${bundle}|${Math.round(resolution * 1000)}`;
    let pages = this.classAtlasPages.get(key);
    if (!pages) {
      pages = [];
      this.classAtlasPages.set(key, pages);
    }
    // Try existing pages. Best-fit is per-page; an outer "try every
    // page" loop picks the first page with room.
    for (const p of pages) {
      const rect = p.packer.alloc(needW, needH);
      if (rect) return { page: p, rect };
    }
    // No existing page fits — allocate a new one.
    let rt: RenderTexture;
    try {
      rt = RenderTexture.create({
        width: CLASS_ATLAS_PAGE_W,
        height: CLASS_ATLAS_PAGE_H,
      });
    } catch (e) {
      log.warn(`allocOnClassPage: RT create failed for ${key}`, e);
      return null;
    }
    const pageKey = `${key}#${pages.length}`;
    rt.label = `class-atlas|${pageKey}`;
    const source = rt.source;
    if (source && typeof source === "object") {
      (source as { label?: string }).label = `class-atlas|${pageKey}`;
    }
    const page: ClassAtlasPage = {
      key: pageKey,
      bundle,
      resolution,
      renderTexture: rt,
      source,
      packer: new GuillotinePacker(CLASS_ATLAS_PAGE_W, CLASS_ATLAS_PAGE_H),
      refcount: 0,
    };
    pages.push(page);
    const rect = page.packer.alloc(needW, needH);
    if (!rect) {
      // Should never happen — fresh page can fit any rect ≤ page dims.
      log.warn(
        `allocOnClassPage: fresh page rejected ${needW}×${needH} (page ${CLASS_ATLAS_PAGE_W}×${CLASS_ATLAS_PAGE_H})`,
      );
      return null;
    }
    return { page, rect };
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
   * on first sample; we leave `autoGarbageCollect = false` so the
   * cache LRU controls retire, not Pixi's GC heuristics. We do NOT
   * close the bitmap immediately — Pixi may keep a reference for
   * the lifetime of the source; closing happens via the cache's
   * retire path when the entry is evicted.
   *
   * Vello emits straight alpha (fine.wgsl un-premultiplies before
   * textureStore). The bridge's Bgra8Unorm canvas preserves that
   * straightness. Pixi's NPM blend mode is the correct composite
   * formula — set `alphaMode = "premultiply-alpha-on-upload"`.
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
    // ImageBitmap's CPU/browser backing buffer. Without this every
    // body atlas + accessory strip keeps its bitmap alive forever
    // through `source.resource`, doubling the working set
    // (`pixi.bitmapMB ≈ pixi.gpuMB` per real STRESS_JSON data).
    // Battlefield renderer: every body atlas / accessory strip
    // source is sampled by battlefield BodyBandMeshes and Sprites.
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
    const total = this.bodyBytes + this.accBytes;
    if (total <= this.capBytes) return;
    // Collect candidates: refcount==0 entries sorted by lastReleasedAt
    // ascending (LRU). Then drop until under the cap.
    type Candidate = { kind: "body" | "acc"; key: string; bytes: number; t: number };
    const candidates: Candidate[] = [];
    for (const [key, entry] of this.bodyAtlasEntries) {
      if (entry.refcount === 0) {
        candidates.push({
          kind: "body",
          key,
          bytes: entry.bytesEst,
          t: entry.lastReleasedAt,
        });
      }
    }
    for (const [key, entry] of this.accEntries) {
      if (entry.refcount === 0) {
        candidates.push({
          kind: "acc",
          key,
          bytes: entry.bytesEst,
          t: entry.lastReleasedAt,
        });
      }
    }
    candidates.sort((a, b) => a.t - b.t);
    let used = total;
    for (const c of candidates) {
      if (used <= this.capBytes) break;
      if (c.kind === "body") {
        const entry = this.bodyAtlasEntries.get(c.key);
        if (!entry) continue;
        this.bodyAtlasEntries.delete(c.key);
        this.bodyBytes -= entry.bytesEst;
        this.scheduleRetireBodyAtlas(entry);
      } else {
        const entry = this.accEntries.get(c.key);
        if (!entry) continue;
        this.accEntries.delete(c.key);
        this.accBytes -= entry.bytesEst;
        this.scheduleRetireAccessory(entry);
      }
      this.evicts += 1;
      used -= c.bytes;
    }
  }

  private scheduleRetireBodyAtlas(entry: BodyAtlas): void {
    if (entry.classPage) {
      // Class-atlas-backed path: the `combinedTexture` is a thin
      // wrapper around the page's shared source. On retire:
      //   1. Drop the `Texture` wrapper (not the source).
      //   2. `packer.free(rect)` — releases the sub-rect back to
      //      the guillotine packer's free-list so a future variant
      //      of similar dims can reuse the slot. This is the
      //      CRITICAL fix for the page-fill leak: without freeing,
      //      pages stay full forever and new variants spill onto
      //      fresh pages, accumulating GPU memory unboundedly.
      //   3. Decrement page refcount; when no variants remain
      //      pointing at the page, destroy its RT.
      const page = entry.classPage;
      const rect = entry.classPageRect;
      this.retireQueue.push({
        destroyTextures: [],
        closeBitmaps: [],
        ticksRemaining: RETIRE_TICKS,
        onSettled: () => {
          try {
            entry.combinedTexture.destroy(false);
          } catch {}
          if (rect) {
            try {
              page.packer.free(rect);
            } catch (e) {
              log.warn("packer.free threw", e);
            }
          }
          page.refcount -= 1;
          if (page.refcount <= 0) {
            this.destroyClassAtlasPage(page);
          }
        },
      });
      return;
    }
    // Legacy per-variant path: ONE Pixi `ImageSource` per atlas
    // (was two — color + zone). `Texture.destroy(true)` cascades
    // into the ImageSource and frees Pixi's uploaded GPUTexture.
    // The Rust-side temp textures were dropped at end of the bake
    // call and queued into `deferred_destroy` for VRAM release.
    this.retireQueue.push({
      destroyTextures: [entry.combinedTexture],
      closeBitmaps: [],
      ticksRemaining: RETIRE_TICKS,
    });
  }

  /** Free a class atlas page's GPU texture + remove from the
   *  registry. Caller must ensure `page.refcount === 0`. */
  private destroyClassAtlasPage(page: ClassAtlasPage): void {
    try {
      page.renderTexture.destroy(true);
    } catch {}
    const bucketKey = `${page.bundle}|${Math.round(page.resolution * 1000)}`;
    const bucket = this.classAtlasPages.get(bucketKey);
    if (!bucket) return;
    const idx = bucket.indexOf(page);
    if (idx >= 0) bucket.splice(idx, 1);
    if (bucket.length === 0) this.classAtlasPages.delete(bucketKey);
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
