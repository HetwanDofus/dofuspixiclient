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
  Texture,
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
 */
const DEFAULT_BYTES_CAP = 1500 * 1024 * 1024;

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
  ): void {
    this.ensureTickerInstalled();
    // A1: when no accessory mount on this character declares bFix,
    // the Rust sprite walker's bFix path is a no-op — the bake is
    // pixel-identical regardless of applyBFix. Collapse both variants
    // to a single cache entry by forcing applyBFix=false in the key.
    const normalized = this.normalizeBFix(parts);
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
      this.bodyAtlasBakes.set(key, { callbacks: [{ onReady, isWanted }] });
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
    const atlas = this.wrapBodyAtlas(key, result);
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

  private wrapBodyAtlas(key: string, r: VelloSwfBodyAtlasResult): BodyAtlas {
    const combinedTexture = this.buildPixiTextureFromBitmap(
      r.combinedBitmap,
      key,
    );
    // The body-band shader binds this same source with TWO Pixi
    // sampler styles — one LINEAR (the default from
    // buildPixiTextureFromBitmap) for color+alpha sampling, one
    // NEAREST for zone-id sampling. We don't override scaleMode
    // here because the shader specifies its own samplers in its
    // bind group, separate from the source's default style.
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
    // Combined-bridge path: ONE Pixi `ImageSource` per atlas (was
    // two — color + zone). `Texture.destroy(true)` cascades into
    // the ImageSource and frees Pixi's uploaded GPUTexture. The
    // Rust-side temp textures were dropped at end of the bake call
    // and queued into `deferred_destroy` for VRAM release.
    this.retireQueue.push({
      destroyTextures: [entry.combinedTexture],
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
