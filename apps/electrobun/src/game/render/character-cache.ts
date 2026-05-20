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
  ExternalSource,
  Rectangle,
  Texture,
  Ticker,
  type Renderer as PixiRenderer,
} from "pixi.js";

import {
  freeRenderTexture,
  getPixiRenderer,
  renderSwfAccessoryStrip,
  renderSwfBodyAtlas,
  renderSwfMountTransforms,
  swfBodyBandInfo,
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
 * Atlas-packed working set at stress-test scale (~25 classes × 5
 * dirs × 3 anim types = ~375 unique body atlases × ~3.5 MB) is
 * ~1.3 GB for bodies + ~325 MB for accessories ≈ 1.6 GB total. A
 * cap below that forces constant LRU eviction; under the patched
 * wgpu fork's no-op Drop + browser-deferred GPUTexture reclaim, each
 * eviction drips into zombie GPU memory the compositor releases
 * slowly. Net effect: a *smaller* cap paradoxically INFLATES total
 * memory because it manufactures churn — the bigger the cap, the
 * less churn, the lower the total. Steady state at 1.5 GB:
 * hit% → 95%+, bake queue drains to ~0, evicts plateau, deferred-
 * reclaim pressure stops, total GPU memory settles around ~2 GB
 * (cap + Pixi/Vello runtime overhead) instead of climbing past 4 GB.
 *
 * Bounding memory BELOW this needs the full Step-11 bridge migration
 * (separate Pixi GPUDevice + ImageBitmap handoff) — with upstream
 * wgpu, Drop actually releases VRAM and the cap can shrink safely.
 */
const DEFAULT_BYTES_CAP = 1.5 * 1024 * 1024 * 1024;

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
  /** Shared atlas — wraps the Vello-allocated colour `GPUTexture`. */
  readonly colorTexture: Texture;
  readonly colorTextureId: number;
  /** Shared atlas — zone-id (R channel encodes zone × 60). */
  readonly zoneTexture: Texture;
  readonly zoneTextureId: number;
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
  readonly textureId: number;
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
  readonly frameCount: number;
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
  textureIds: number[];
  destroyTextures: Texture[];
  externalSources: ExternalSource[];
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
  return `body|${p.bundle}|${p.exportName}|${p.start}|${p.count}|${p.totalFrameCount}|${p.resolution}|${p.applyBFix ? 1 : 0}`;
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
    const key = bodyAtlasKey(parts);
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
          parts.bundle,
          parts.exportName,
          parts.start,
          parts.count,
          parts.totalFrameCount,
          parts.resolution,
          parts.applyBFix,
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
    parts: AccessoryKeyParts,
    onReady: (strip: AccessoryStrip | null) => void,
    isWanted: () => boolean,
  ): void {
    this.ensureTickerInstalled();
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
    const key = mountKey(parts);
    const existing = this.mountEntries.get(key);
    if (existing) return existing;
    const data = renderSwfMountTransforms(
      parts.bundle,
      parts.exportName,
      parts.start,
      parts.count,
      parts.applyBFix,
      MAX_SLOT,
    );
    if (!data) return null;
    const entry: MountTransforms = {
      key,
      data,
      frameCount: parts.count,
    };
    this.mountEntries.set(key, entry);
    return entry;
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

  /** Tick the retire queue. Call once per Pixi ticker tick. */
  tick(): void {
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
          tex.destroy(false);
        } catch (e) {
          log.warn("Texture destroy threw", e);
        }
      }
      for (const src of entry.externalSources) {
        try {
          src.destroy();
        } catch (e) {
          log.warn("ExternalSource destroy threw", e);
        }
      }
      for (const id of entry.textureIds) {
        try {
          freeRenderTexture(id);
        } catch (e) {
          log.warn(`freeRenderTexture(${id}) threw`, e);
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
      // Whole bake went stale between enqueue + finalize.
      try {
        freeRenderTexture(result.colorTextureId);
        freeRenderTexture(result.zoneTextureId);
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
        freeRenderTexture(result.textureId);
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
    const pixi = getPixiRenderer();
    if (!pixi) {
      throw new Error("CharacterCache.wrapBodyAtlas: Pixi renderer not set");
    }
    const colorTexture = this.buildPixiTexture(
      pixi,
      r.colorTexture,
      r.atlasWidth,
      r.atlasHeight,
      `${key}|color`,
    );
    const zoneTexture = this.buildPixiTexture(
      pixi,
      r.zoneTexture,
      r.atlasWidth,
      r.atlasHeight,
      `${key}|zone`,
    );
    // Zone-id sampling must be NEAREST — otherwise linear filtering
    // at zone boundaries smears the marker R channel into invalid
    // ids (e.g. between 60 and 120 it produces 90, mapping to no
    // zone). Per-bot AA fidelity still comes from the colour
    // texture which keeps LINEAR.
    zoneTexture.source.scaleMode = "nearest";
    const bytesEst = estimateBytes(r.atlasWidth, r.atlasHeight) * 2;
    return {
      key,
      colorTexture,
      colorTextureId: r.colorTextureId,
      zoneTexture,
      zoneTextureId: r.zoneTextureId,
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
    const pixi = getPixiRenderer();
    if (!pixi) {
      throw new Error("CharacterCache.wrapAccessory: Pixi renderer not set");
    }
    const texture = this.buildPixiTexture(pixi, r.texture, r.width, r.height, key);
    const frames = this.buildFrameTextures(texture, r);
    const bytesEst = estimateBytes(r.width, r.height);
    return {
      key,
      texture,
      textureId: r.textureId,
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

  private buildPixiTexture(
    pixi: PixiRenderer,
    gpu: GPUTexture,
    width: number,
    height: number,
    label: string,
  ): Texture {
    const source = new ExternalSource({
      resource: gpu,
      renderer: pixi,
      width,
      height,
      label,
    });
    // Mirror `player-strip-renderer.ts` — Vello emits straight-alpha
    // RGBA, Pixi must NOT pre-multiply on upload.
    source.alphaMode = "no-premultiply-alpha";
    source.format = "rgba8unorm";
    source.scaleMode = "linear";
    source.autoGarbageCollect = false;
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
    this.retireQueue.push({
      textureIds: [entry.colorTextureId, entry.zoneTextureId],
      destroyTextures: [entry.colorTexture, entry.zoneTexture],
      externalSources: [
        entry.colorTexture.source as ExternalSource,
        entry.zoneTexture.source as ExternalSource,
      ],
      ticksRemaining: RETIRE_TICKS,
    });
  }

  private scheduleRetireAccessory(entry: AccessoryStrip): void {
    this.retireQueue.push({
      textureIds: [entry.textureId],
      destroyTextures: [...entry.frames, entry.texture],
      externalSources: [entry.texture.source as ExternalSource],
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
