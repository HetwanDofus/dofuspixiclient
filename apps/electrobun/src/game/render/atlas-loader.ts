import type { VelloRenderer } from "vello-wasm";
import { Rectangle, type Renderer, Texture } from "pixi.js";

import type { TileBehavior, TileManifest } from "@/game/types";
import { createLogger } from "@/utils/logger";

import {
  AtlasCache,
  type AtlasManifest,
  type CachedTileData,
  type SpritesheetManifest,
} from "./atlas-cache";
import { getLoadProgress } from "./load-progress";
import { convertToTileManifest } from "./tile-manifest-converter";
import { type TileSwfMeta, TileVelloRenderer } from "./tile-vello-renderer";
import type { ExternalSource } from "pixi.js";

import {
  freeRenderTexture,
  getVelloGpu,
  renderSwfBundleBatch,
  renderSwfStripRange,
  renderSwfTileDynamicStripRange,
  renderSwfTileStaticBase,
  swfAnimFrameCount,
  swfBundleFrameRate,
  swfExportHasFilters,
  swfTileAnimKind,
} from "./vello-loader";

const log = createLogger("AtlasLoader");

/**
 * Yield to the browser main thread between background tile renders so
 * input/paint/animation tickers stay responsive. Prefer the modern
 * `scheduler.yield()` (Chromium 129+, Safari 18+) which lets the
 * scheduler reorder our continuation behind any pending high-priority
 * work; fall back to `setTimeout(0)` everywhere else (which still
 * flushes a paint cycle, just with less scheduler integration).
 */
function yieldToMain(): Promise<void> {
  const scheduler = (
    globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler;
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Per-chunk frame budget for the DYNAMIC half of an animated tile's
 * strip. Static parts now render to a separate base texture (see
 * `renderSwfTileStaticBase`), so each cell of the dynamic strip only
 * carries the few placements that actually animate (e.g., the chimney
 * smoke on tile 343 — ~5 shapes per frame instead of the building's
 * ~50). With static eliminated from the dynamic strip, we can pack
 * many more frames per chunk without overflowing the encoder.
 *
 * 32 frames per chunk gives a comfortable safety margin (32 × 5 ≈ 160
 * shapes per scene) while keeping dispatch count low for long anims.
 */
const MAX_STRIP_FRAMES = 32;

/**
 * Map raw SWF query results to the legacy `SpritesheetManifest` shape that
 * `convertToTileManifest` consumes. Most fields collapse to defaults — the
 * SWF render path produces a uniform canvas per export and there is no
 * separate "atlas page" layout to describe.
 */
function buildSyntheticTileData(
  bundle: string,
  exportName: string,
  meta: TileSwfMeta
): CachedTileData {
  const fpsHint = swfBundleFrameRate(bundle) || undefined;
  const kind = swfTileAnimKind(bundle, exportName);
  const behavior: TileBehavior | undefined =
    kind === "animated" || kind === "random" || kind === "slope"
      ? kind
      : undefined;

  // `convertToTileManifest` only reads `atlas.frames.length`, `atlas.fps`,
  // `atlas.baseZOrder`, and `atlas.pages`. The SWF render path produces one
  // texture per (frame, zoom) pair on demand, so we synthesize empty
  // per-frame entries — geometry comes from `renderMeta` instead.
  const frames: AtlasManifest["frames"] = Array.from(
    { length: Math.max(1, meta.frameCount) },
    (_, i) => ({
      id: `${exportName}:${i}`,
      x: 0,
      y: 0,
      width: meta.width,
      height: meta.height,
      offsetX: 0,
      offsetY: 0,
    })
  );

  const atlas: AtlasManifest = {
    version: 1,
    animation: "tile",
    width: meta.width,
    height: meta.height,
    offsetX: 0,
    offsetY: 0,
    frames,
    frameOrder: frames.map((f) => f.id),
    duplicates: {},
    fps: fpsHint ?? 24,
    baseZOrder: undefined,
    pages: undefined,
  };

  const manifest: SpritesheetManifest = {
    version: 1,
    spriteId: exportName,
    behavior,
    fps_hint: fpsHint,
    autoplay: behavior === "animated",
    loop: behavior === "animated",
    animations: {
      tile: { ...atlas, file: `${bundle}/${exportName}` },
    },
  };

  return {
    manifest,
    atlas,
    renderMeta: {
      width: meta.width,
      height: meta.height,
      anchorX: meta.anchorX,
      anchorY: meta.anchorY,
    },
    baseTextures: new Map(),
  };
}

/** Animated tile waiting for its multi-frame strip to render in the background. */
interface PendingAnimation {
  tileKey: string;
  bundle: string;
  exportName: string;
  frameCount: number;
  /** Chunks already rendered (each chunk = MAX_STRIP_FRAMES frames). */
  chunksRendered: number;
}

export class AtlasLoader {
  private readonly cache = new AtlasCache();
  private currentZoom = 1;
  private readonly velloRenderer: TileVelloRenderer;
  /**
   * Animated tiles whose multi-frame strip hasn't been rendered yet.
   * Populated by `prefetchTiles` (frame 0 lands sync via the bundle
   * batch); drained by `finalizeAnimations` (chunk 0) + `ensureAnimationChunk`
   * (later chunks on demand).
   */
  private pendingAnimations: PendingAnimation[] = [];
  /**
   * Map from tileKey → its `PendingAnimation` record so per-tile
   * lookups during `ensureAnimationChunk` are O(1).
   */
  private animationsByKey = new Map<string, PendingAnimation>();
  /**
   * In-flight `ensureAnimationChunk` calls keyed by `tileKey:chunkIndex`
   * so concurrent triggers from multiple cells (or rapid frame-change
   * callbacks) collapse to one render.
   */
  private inFlightChunks = new Map<string, Promise<boolean>>();
  /**
   * Listeners notified per tileKey when a new chunk lands. Layer
   * builders subscribe so they can refresh `sprite.textures` for any
   * existing AnimatedSprite of that tile.
   */
  private animationListeners = new Set<(tileKey: string) => void>();
  /**
   * Listeners notified once per zoom change with the list of tile keys
   * whose cached textures (dynamic strip + static base) were invalidated
   * and re-queued for background re-render. Layer builders subscribe to
   * hide animated/static-base sprites until the new textures land —
   * otherwise Pixi keeps drawing the old physical bitmap interpreted at
   * the new resolution, producing the visible stretch+filter artifact.
   */
  private animationsInvalidatedListeners = new Set<(tileKeys: string[]) => void>();
  /**
   * Per-(tileKey, zoom) static-base texture cache. The static base is
   * the building/wall/etc. geometry that doesn't change frame-to-frame
   * — rendered ONCE per (tile, zoom) and reused for every cycle. Keyed
   * by tileKey alone (zoom-independent) since each entry's source
   * already encodes a specific zoom; on zoom change we drop the entry
   * and re-render. Layered UNDER the AnimatedSprite by `layer-builder`.
   */
  private staticBaseCache = new Map<string, { texture: Texture; zoom: number }>();
  /**
   * Every Vello-backed Pixi `ExternalSource` we ever wrapped, paired
   * with its WASM-side wgpu texture id. On zoom invalidation we move
   * the snapshot of these into `retiredSources` for deferred destroy.
   * Without that, both halves of the dual-ref leak: Pixi keeps the
   * GPUTexture handle alive (`autoGarbageCollect=false`) AND the WASM
   * `VelloRenderer.textures` HashMap holds the wgpu::Texture, so the
   * underlying GPU storage is never reclaimed across zoom changes.
   */
  private liveSources: { source: ExternalSource; textureId: number }[] = [];
  /** Sources that have been evicted but not yet destroyed (deferred to
   *  let in-flight `renderCell` paths drain). */
  private retiredSources: { source: ExternalSource; textureId: number }[] = [];
  private retireTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * High-water threshold for the retired-source bucket. Rapid zoom
   * storms (mouse-wheel spam: 5+ steps in <1 s) can queue every live
   * source per zoom step before the deferred destroy timer fires. With
   * each retire arming the same single-shot timer, those sources sit
   * for 250 ms + 2 rAFs (~280 ms) regardless of bucket depth — long
   * enough to back the wgpu command queue up by hundreds of textures
   * and stall the GPU driver. When the bucket grows past this mark we
   * flush the OVERFLOW immediately, keeping a safety margin of recent
   * retirees draining through the normal grace period.
   */
  private static readonly RETIRE_HIGH_WATER = 64;

  constructor(renderer: Renderer) {
    this.velloRenderer = new TileVelloRenderer(renderer);
  }

  private trackSource(source: ExternalSource, textureId: number): void {
    this.liveSources.push({ source, textureId });
  }

  /**
   * Move every live Pixi source into the retired bucket and arm the
   * deferred-flush timer. Idempotent within a zoom transition: rapid
   * sequential `setZoom` / `clearCache` calls coalesce because the
   * timer is single-shot.
   *
   * Also drains the per-frame sources created by `TileVelloRenderer`
   * (filter-tile path + per-tile fallbacks) so they're retired in the
   * same wave instead of leaking forever.
   */
  private retireAllSources(): void {
    for (const entry of this.velloRenderer.drainPendingSources()) {
      this.retiredSources.push(entry);
    }
    if (this.liveSources.length > 0) {
      for (const entry of this.liveSources) {
        this.retiredSources.push(entry);
      }
      this.liveSources.length = 0;
    }
    // Bypass the deferred grace period for everything past the
    // high-water mark. The most recent `RETIRE_HIGH_WATER` entries
    // still go through the normal timer so in-flight `renderCell`
    // sampling drains safely; older overflow gets destroyed
    // immediately to keep the wgpu command queue from backing up
    // during rapid zoom storms.
    if (this.retiredSources.length > AtlasLoader.RETIRE_HIGH_WATER) {
      const overflow = this.retiredSources.splice(
        0,
        this.retiredSources.length - AtlasLoader.RETIRE_HIGH_WATER
      );
      for (const { source, textureId } of overflow) {
        try {
          source.destroy();
        } catch {
          // already destroyed — fine.
        }
        freeRenderTexture(textureId);
      }
    }
    if (this.retiredSources.length > 0) {
      this.armRetireTimer();
    }
  }

  private armRetireTimer(): void {
    if (this.retireTimer !== null) {
      return;
    }
    // 250 ms gives the chunked tile prefetch + finalize passes enough
    // time to drop their references via `setTileData` overwriting the
    // cached entries before we destroy the underlying sources. Two
    // rAFs after that ensure paint has cycled; only then is it safe
    // to actually destroy.
    this.retireTimer = setTimeout(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
      this.retireTimer = null;
      this.flushRetiredSources();
    }, 250);
  }

  private flushRetiredSources(): void {
    if (this.retiredSources.length === 0) {
      return;
    }
    const list = this.retiredSources;
    this.retiredSources = [];
    for (const { source, textureId } of list) {
      try {
        source.destroy();
      } catch {
        // Already destroyed elsewhere — fine.
      }
      freeRenderTexture(textureId);
    }
  }

  /** Subscribe to per-tile "new chunk available" events. Returns unsub. */
  onAnimationFramesAvailable(cb: (tileKey: string) => void): () => void {
    this.animationListeners.add(cb);
    return () => {
      this.animationListeners.delete(cb);
    };
  }

  /** Subscribe to "animations invalidated by zoom change" events. Returns unsub. */
  onAnimationsInvalidated(cb: (tileKeys: string[]) => void): () => void {
    this.animationsInvalidatedListeners.add(cb);
    return () => {
      this.animationsInvalidatedListeners.delete(cb);
    };
  }

  /** Total number of frames a tile's animation has across all chunks. */
  getAnimationTotalFrameCount(tileKey: string): number {
    return this.animationsByKey.get(tileKey)?.frameCount ?? 0;
  }

  /** Frames already rendered + cached for a tile (always ≤ totalFrameCount). */
  getAnimationRenderedFrameCount(tileKey: string): number {
    const p = this.animationsByKey.get(tileKey);
    if (!p) {
      return 0;
    }
    return Math.min(p.frameCount, p.chunksRendered * MAX_STRIP_FRAMES);
  }

  /** Static-base texture for an animated tile, or null if not rendered yet. */
  getStaticBaseTexture(tileKey: string): Texture | null {
    const entry = this.staticBaseCache.get(tileKey);
    if (!entry) {
      return null;
    }
    if (Math.abs(entry.zoom - this.currentZoom) > 0.001) {
      // Stale zoom — drop so the next ensure-render path re-renders.
      this.staticBaseCache.delete(tileKey);
      return null;
    }
    return entry.texture;
  }

  private notifyAnimationFrames(tileKey: string): void {
    for (const cb of this.animationListeners) {
      cb(tileKey);
    }
  }

  private notifyAnimationsInvalidated(tileKeys: string[]): void {
    if (tileKeys.length === 0) return;
    for (const cb of this.animationsInvalidatedListeners) {
      cb(tileKeys);
    }
  }

  /**
   * Compatibility shim — tile rendering now reads the renderer from the
   * shared `vello-loader` singleton. Kept so existing call sites in
   * `wireVelloLoaders` don't have to change in this PR.
   */
  setVelloRenderer(_vello?: VelloRenderer): void {
    // intentionally empty
  }

  /** Current zoom determines Vello render resolution. */
  setZoom(zoom: number): void {
    if (Math.abs(this.currentZoom - zoom) < 0.001) {
      return;
    }
    this.currentZoom = zoom;
    // Resolution changed — every animated tile's per-frame textures
    // and static base were rendered at the OLD zoom and are no longer
    // valid at the new one. Drop the static-base cache, reset
    // `chunksRendered` so the chunked render path treats each tile as
    // fresh, and re-queue them in `pendingAnimations` so the next
    // `finalizeAnimations` call (fired by handler.updateTexturesForZoom
    // → handler.kickoff) renders them at the new zoom.
    //
    // Drop the frame-cache entries too: they wrap sub-rectangles of
    // the previous-zoom Pixi sources which we're about to retire.
    // Without flushing the frame cache we'd hand out Pixi Texture
    // refs whose underlying source has been destroyed — Pixi would
    // then panic on the next sample.
    this.staticBaseCache.clear();
    this.cache.clearFrameCache();
    this.retireAllSources();
    const reAdds: PendingAnimation[] = [];
    for (const p of this.animationsByKey.values()) {
      p.chunksRendered = 0;
      reAdds.push(p);
    }
    if (reAdds.length > 0) {
      this.pendingAnimations.push(...reAdds);
      // Fire invalidation BEFORE prefetch/finalize so subscribers can
      // hide the now-stale animated/static-base sprites for these tiles.
      // Pixi otherwise re-interprets the same physical bitmap at the new
      // resolution until the background re-render lands ~600–1000ms
      // later — visible as the "stretch + bilinear filter" artifact.
      this.notifyAnimationsInvalidated(reAdds.map((p) => p.tileKey));
    }
  }

  /**
   * Stable-partition `pendingAnimations` so any tile keys in `tileKeys`
   * are rendered first by the next `finalizeAnimations` pass. Used by
   * the zoom code path to render currently-visible animated tiles
   * before off-screen ones, so the "snap back to sharp" visual happens
   * within ~50ms instead of after the full strip pass.
   *
   * No-op when there are no pending animations or no priority hints.
   */
  prioritizeTiles(tileKeys: string[]): void {
    if (this.pendingAnimations.length === 0 || tileKeys.length === 0) {
      return;
    }
    const priority = new Set(tileKeys);
    const front: PendingAnimation[] = [];
    const back: PendingAnimation[] = [];
    for (const p of this.pendingAnimations) {
      if (priority.has(p.tileKey)) {
        front.push(p);
      } else {
        back.push(p);
      }
    }
    if (front.length === 0) return;
    this.pendingAnimations = front.concat(back);
  }

  getZoom(): number {
    return this.currentZoom;
  }

  /**
   * Resolve a tile + populate its meta cache. Renders frame 0 at the live
   * zoom once: the resulting Pixi Texture goes into the frame cache (so the
   * subsequent renderCell loop hits the cache instead of re-rendering), and
   * its dimensions populate the meta cache via `renderFrame`'s side
   * effect. Synchronous after bundles are pre-warmed; the async signature
   * is kept so existing call sites compose via `Promise.all`.
   */
  private async loadTileData(tileKey: string): Promise<CachedTileData | null> {
    const cached = this.cache.getTileData(tileKey);
    if (cached) {
      return cached;
    }

    const res = this.velloRenderer.resolveTile(tileKey);
    if (!res) {
      return null;
    }

    // First render kicks off the GPU dispatch, populates `getMeta`, and
    // produces a Pixi Texture we cache as the frame-0 entry at this zoom.
    const cacheKey = this.frameCacheKey(tileKey, 0);
    const cachedFrame = this.cache.getFromFrameCache(cacheKey);
    if (!cachedFrame) {
      const texture = this.velloRenderer.renderFrame(
        tileKey,
        0,
        this.currentZoom,
        cacheKey
      );
      if (!texture) {
        return null;
      }
      this.cache.addToFrameCache(cacheKey, texture);
    }

    const meta = this.velloRenderer.getMeta(tileKey);
    if (!meta) {
      log.warn(`Tile ${tileKey} SWF meta unavailable after render`);
      return null;
    }

    const data = buildSyntheticTileData(res.bundle, res.exportName, meta);
    this.cache.setTileData(tileKey, data);
    return data;
  }

  /** Rounded zoom key for cache bucketing (avoids excessive cache entries). */
  private zoomKey(): number {
    return Math.round(this.currentZoom * 100) / 100;
  }

  private frameCacheKey(tileKey: string, frameIndex: number): string {
    return `${tileKey}:${this.zoomKey()}:${frameIndex}`;
  }

  async loadTileManifest(tileKey: string): Promise<TileManifest | null> {
    const cached = this.cache.getTileManifest(tileKey);
    if (cached) {
      return cached;
    }

    const data = await this.loadTileData(tileKey);
    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = convertToTileManifest(
      data,
      type as "ground" | "objects" | "tactic" | "cell"
    );
    this.cache.setTileManifest(tileKey, tileManifest);
    return tileManifest;
  }

  async loadFrame(
    tileKey: string,
    frameIndex: number,
    _scale: number
  ): Promise<Texture | null> {
    const cacheKey = this.frameCacheKey(tileKey, frameIndex);
    const cachedTexture = this.cache.getFromFrameCache(cacheKey);
    if (cachedTexture) {
      return cachedTexture;
    }

    if (!this.velloRenderer.hasAsset(tileKey)) {
      return null;
    }

    const texture = this.velloRenderer.renderFrame(
      tileKey,
      frameIndex,
      this.currentZoom,
      cacheKey
    );

    if (!texture) {
      return null;
    }

    this.cache.addToFrameCache(cacheKey, texture);
    return texture;
  }

  async loadAnimationFrames(
    tileKey: string,
    scale: number
  ): Promise<Texture[]> {
    const tile = await this.loadTileManifest(tileKey);
    if (!tile) {
      return [];
    }

    const frames = await Promise.all(
      Array.from({ length: tile.frameCount }, (_, i) =>
        this.loadFrame(tileKey, i, scale)
      )
    );

    return frames.filter((t): t is Texture => t !== null);
  }

  getTileManifest(tileKey: string): TileManifest | undefined {
    return this.cache.getTileManifest(tileKey);
  }

  /** Sync manifest lookup; returns null if not cached (call prefetchTiles first). */
  getTileManifestSync(tileKey: string): TileManifest | null {
    const cached = this.cache.getTileManifest(tileKey);
    if (cached) {
      return cached;
    }

    const data = this.cache.getTileData(tileKey);
    if (!data) {
      return null;
    }

    const [type] = tileKey.split("_");
    const tileManifest = convertToTileManifest(
      data,
      type as "ground" | "objects" | "tactic" | "cell"
    );

    this.cache.setTileManifest(tileKey, tileManifest);
    return tileManifest;
  }

  /** Sync frame lookup; returns null if base texture not cached. */
  loadFrameSync(
    tileKey: string,
    frameIndex: number,
    _scale: number
  ): Texture | null {
    const cacheKey = this.frameCacheKey(tileKey, frameIndex);
    const cached = this.cache.getFromFrameCache(cacheKey);
    if (cached) {
      return cached;
    }

    if (!this.velloRenderer.hasAsset(tileKey)) {
      return null;
    }

    const texture = this.velloRenderer.renderFrame(
      tileKey,
      frameIndex,
      this.currentZoom,
      cacheKey
    );

    if (texture) {
      this.cache.addToFrameCache(cacheKey, texture);
      return texture;
    }

    return null;
  }

  /**
   * Read every contiguously-cached frame for `tileKey` from the frame
   * cache. Stops at the first missing frame — for animated tiles
   * rendered chunk-by-chunk this returns exactly the chunks rendered
   * so far (chunks 1+ render lazily as the AnimatedSprite plays past
   * their boundaries via `ensureAnimationChunk`).
   *
   * Crucially does NOT auto-render missing frames the way `loadFrameSync`
   * does — that path uses `renderSwfFrame` with tight per-frame bounds
   * and would silently force a 140-frame synchronous render storm at
   * the wrong bounds when called for a partially-cached animated tile.
   * If the caller actually needs a specific frame, they should go
   * through `loadFrameSync` directly.
   */
  loadAnimationFramesSync(tileKey: string, _scale: number): Texture[] {
    const manifest = this.getTileManifestSync(tileKey);
    if (!manifest) {
      return [];
    }
    const textures: Texture[] = [];
    for (let i = 0; i < manifest.frameCount; i++) {
      const cacheKey = this.frameCacheKey(tileKey, i);
      const cached = this.cache.getFromFrameCache(cacheKey);
      if (!cached) {
        break;
      }
      textures.push(cached);
    }
    return textures;
  }

  /**
   * Resolve every tile in the list against the pre-loaded SWF bundles +
   * populate the tile-data cache. After this returns, sync methods
   * (loadFrameSync, getTileManifestSync) are zero-cost.
   *
   * Tile data resolution kicks off one `renderSwfFrame` per tile (used by
   * `getMeta` to capture canvas size + anchor — there's no cheap "bbox
   * only" SWF API yet). Firing all of them in a single microtask burst
   * floods the WebGPU command queue and freezes paint until it drains;
   * we batch + yield via `setTimeout(0)` so the queue can drain and the
   * browser can paint between groups.
   */
  async prefetchTiles(tileKeys: string[], _scale: number): Promise<void> {
    const progress = getLoadProgress();
    const total = tileKeys.length;
    if (total === 0) {
      return;
    }
    const t0 = performance.now();
    const gpu = getVelloGpu();
    const zoom = this.currentZoom;

    // Step 1: resolve + classify. Frame 0 of *every* non-filter tile
    // (static, animated, random, slope) goes into the bundle batch so
    // the map paints synchronously with all tiles in their frame-0 pose.
    // Filter tiles still render individually (halo fallback would
    // overflow the bundle batch's tile encoder). Multi-frame strips for
    // animated tiles are queued for `finalizeAnimations` instead of
    // running here. Random/slope tiles need every frame at renderCell
    // time (each cell picks a specific index), so they DO render their
    // strip synchronously — typical counts are 4–8 frames so cost is
    // negligible.
    interface ResolvedTile {
      tileKey: string;
      bundle: string;
      exportName: string;
      frameCount: number;
      kind: "" | "animated" | "random" | "slope";
    }
    const bundleBatchByBundle = new Map<string, ResolvedTile[]>();
    const slopeRandomTiles: ResolvedTile[] = [];
    const animatedTiles: ResolvedTile[] = [];
    /** Filter-bearing tiles render individually — see step 4 below. */
    const filterTiles: ResolvedTile[] = [];

    for (const tileKey of tileKeys) {
      if (this.cache.getTileData(tileKey)) {
        continue;
      }
      const res = this.velloRenderer.resolveTile(tileKey);
      if (!res) {
        continue;
      }
      const fc = swfAnimFrameCount(res.bundle, res.exportName);
      const kind = swfTileAnimKind(res.bundle, res.exportName);
      const hasFilters = swfExportHasFilters(res.bundle, res.exportName);
      const frameCount = Math.max(1, fc);
      const resolved: ResolvedTile = {
        tileKey,
        bundle: res.bundle,
        exportName: res.exportName,
        frameCount,
        kind,
      };
      if (hasFilters) {
        filterTiles.push(resolved);
        continue;
      }
      if (frameCount > 1 && kind === "animated") {
        // Animated tiles fully deferred — strip + bounds prepass run
        // in `finalizeAnimations` (background). The layer builder
        // defers any cell that references this tileKey until chunk 0
        // lands, then drains the deferred closures.
        animatedTiles.push(resolved);
        continue;
      }
      if (frameCount > 1 && (kind === "random" || kind === "slope")) {
        // Random / slope tiles need every frame at renderCell time
        // (each cell picks a specific frame index). Render the strip
        // synchronously below — DO NOT bundle-batch their frame 0:
        // bundle batch uses tight per-frame-0 bounds while the strip
        // uses the full anim's union bounds, and mixing the two
        // leaves the manifest cache stuck on frame-0 bounds (the
        // strip render writes new tile-data but `getTileManifestSync`
        // returns the already-cached manifest from the bundle-batch
        // call). Result was every random/slope sprite getting a
        // frame-0-bounds pivot rendered against a strip-union texture
        // — the visible "broken tiles" symptom.
        slopeRandomTiles.push(resolved);
        continue;
      }
      // Static, single-frame → bundle batch.
      let group = bundleBatchByBundle.get(res.bundle);
      if (!group) {
        group = [];
        bundleBatchByBundle.set(res.bundle, group);
      }
      group.push(resolved);
    }

    // Step 2: bundle-batch frame 0 for every static (single-frame)
    // tile, one dispatch per bundle. We deliberately skip per-bundle
    // GPU drains — WebGPU's queue serializes work automatically, so a
    // fan-out of independent dispatches is much faster than
    // dispatch-drain-dispatch-drain. The single drain at the end of
    // prefetch covers the whole batch.
    let processed = 0;
    for (const [bundle, group] of bundleBatchByBundle) {
      const exports = group.map((g) => g.exportName);
      const result = renderSwfBundleBatch(bundle, exports, 0, zoom);
      if (!result) {
        log.warn(
          `prefetchTiles: bundle batch failed for ${bundle} (${exports.length} tiles), falling back per-tile`
        );
        for (const g of group) {
          const cacheKey = this.frameCacheKey(g.tileKey, 0);
          const tex = this.velloRenderer.renderFrame(
            g.tileKey,
            0,
            zoom,
            cacheKey
          );
          if (tex) {
            this.cache.addToFrameCache(cacheKey, tex);
            const meta = this.velloRenderer.getMeta(g.tileKey);
            if (meta) {
              this.cache.setTileData(
                g.tileKey,
                buildSyntheticTileData(g.bundle, g.exportName, meta)
              );
              this.getTileManifestSync(g.tileKey);
            }
          }
        }
        processed += group.length;
        continue;
      }

      const compositeSource = this.velloRenderer.wrapBatchSource(
        result.texture,
        result.width,
        result.height,
        zoom,
        `swf-batch:${bundle}`
      );
      this.trackSource(compositeSource, result.textureId);

      for (let i = 0; i < group.length; i++) {
        if (result.itemValid[i] !== 1) {
          continue;
        }
        const g = group[i];
        const x = result.itemX[i];
        const y = result.itemY[i];
        const w = result.itemW[i];
        const h = result.itemH[i];
        const anchorX = result.itemAnchorX[i];
        const anchorY = result.itemAnchorY[i];

        const tex = new Texture({
          source: compositeSource,
          frame: new Rectangle(x / zoom, y / zoom, w / zoom, h / zoom),
        });
        const cacheKey = this.frameCacheKey(g.tileKey, 0);
        this.cache.addToFrameCache(cacheKey, tex);

        // Tile data uses the *full* frameCount so renderCell builds an
        // AnimatedSprite (length=frameCount) for animated tiles. Only
        // frame 0 is in the cache right now — `loadAnimationFramesSync`
        // returns a 1-element array, AnimatedSprite plays as static
        // until `finalizeAnimations` lands chunk 0 and we notify the
        // layer-builder to refresh `sprite.textures`.
        const meta: TileSwfMeta = {
          width: w / zoom,
          height: h / zoom,
          anchorX: anchorX / zoom,
          anchorY: anchorY / zoom,
          frameCount: g.frameCount,
        };
        this.velloRenderer.setMeta(g.tileKey, meta);
        this.cache.setTileData(
          g.tileKey,
          buildSyntheticTileData(g.bundle, g.exportName, meta)
        );
        this.getTileManifestSync(g.tileKey);
      }

      processed += group.length;
      progress.report("map-tiles", processed, total);
    }

    // Step 3a: animated tiles are fully deferred. Rendering even ONE
    // frame synchronously means paying `cache_strip_bounds`' per-frame
    // tree walk (`O(totalFrameCount)`), and a single 200-frame tile
    // can burn ~200 ms of CPU on that prepass alone — which scales
    // linearly with the count of animated tiles on a map and was the
    // dominant remaining cost on long-animation maps. We push every
    // animated tile into `pendingAnimations` (below) and let
    // `finalizeAnimations` do the bounds + chunk-0 work in the
    // background. The layer builder defers any cell that references
    // an animated tileKey and retries via the
    // `onAnimationFramesAvailable` callback once chunk 0 lands.

    // Step 3b: random / slope tiles need every frame cached BEFORE
    // renderCell because each cell picks a specific frame index
    // (`frameIndexForTile`). They're typically 4–8 frames so this is
    // cheap; chunked rendering still applies for the rare long-cycle
    // case to keep Vello under its tile-encoder budget.
    for (const m of slopeRandomTiles) {
      this.renderStripChunks(m, zoom);
      processed++;
      progress.report("map-tiles", processed, total);
    }

    // Step 4: render filter-bearing tiles individually.
    for (const f of filterTiles) {
      const cacheKey = this.frameCacheKey(f.tileKey, 0);
      const tex = this.velloRenderer.renderFrame(f.tileKey, 0, zoom, cacheKey);
      if (!tex) {
        processed++;
        continue;
      }
      this.cache.addToFrameCache(cacheKey, tex);
      const meta = this.velloRenderer.getMeta(f.tileKey);
      if (meta) {
        this.cache.setTileData(
          f.tileKey,
          buildSyntheticTileData(f.bundle, f.exportName, meta)
        );
        this.getTileManifestSync(f.tileKey);
      }
      processed++;
    }

    // Single GPU drain at the end — ensures all dispatched work has
    // landed before renderCell starts sampling textures. Replaces the
    // multiple per-step drains, which were each a synchronous wait for
    // the GPU queue to finish (5–30 ms apiece, ~50–250 ms cumulative).
    if (gpu) {
      await gpu.device.queue.onSubmittedWorkDone();
    }

    // Queue animated tiles for background `finalizeAnimations`. Note we
    // record the FULL frameCount on the pending entry so lazy chunk
    // rendering (in `ensureAnimationChunk`) knows when to stop.
    for (const a of animatedTiles) {
      const pending: PendingAnimation = {
        tileKey: a.tileKey,
        bundle: a.bundle,
        exportName: a.exportName,
        frameCount: a.frameCount,
        chunksRendered: 0,
      };
      this.pendingAnimations.push(pending);
      this.animationsByKey.set(a.tileKey, pending);
    }

    log.info(
      `prefetchTiles done: ${total} keys (${bundleBatchByBundle.size} bundle-batches + ${slopeRandomTiles.length} slope/random strips + ${filterTiles.length} filter-isolated) in ${(performance.now() - t0).toFixed(0)}ms — ${animatedTiles.length} animated tiles fully deferred`
    );
  }

  /**
   * Background pass that materializes every queued animated tile's
   * full strip. Strategy:
   *   1. First pass — render chunk 0 for every pending tile, in order.
   *      Notify after each so the layer builder can drain its deferred
   *      cell-render closures and the AnimatedSprite can start playing
   *      the first 60 frames immediately (~150-300 ms after map paint
   *      depending on count).
   *   2. Second pass — render chunks 1+ for tiles that have more than
   *      one chunk's worth of frames. Sequential, with `yieldToMain`
   *      between each so input/paint stay responsive. After every
   *      chunk lands, notify so `refreshAnimatedSprites` extends
   *      `sprite.textures`.
   *
   * The earlier "lazy on demand via `onFrameChange`" design was
   * fragile: a single missed listener trigger (Pixi v8 ticker race
   * during the drain → refresh → re-attach sequence) would leave the
   * sprite stuck on its first 60 frames forever — the symptom users
   * saw as "tiles with >100 frames don't animate at all". Sequencing
   * everything from finalize means animation correctness no longer
   * depends on per-frame Pixi callbacks firing exactly once at the
   * right moment.
   */
  async finalizeAnimations(): Promise<void> {
    if (this.pendingAnimations.length === 0) {
      return;
    }
    const t0 = performance.now();
    const gpu = getVelloGpu();
    const pending = this.pendingAnimations;
    this.pendingAnimations = [];
    let renderedChunk0 = 0;
    let renderedExtra = 0;

    // Pass 1: chunk 0 for every tile, so something visible animates
    // ASAP for every cell that was deferred during sync renderCell.
    for (const p of pending) {
      const ok = await this.renderAnimationChunk(p, 0);
      if (ok) {
        renderedChunk0++;
        this.notifyAnimationFrames(p.tileKey);
      }
      await yieldToMain();
    }

    // Pass 2: chunks 1+ for any tile with more than one chunk. We
    // walk all tiles' chunks 1..N in a round-robin so a single very
    // long animation doesn't starve the others. Each chunk that
    // succeeds notifies so the AnimatedSprite picks up the new
    // textures immediately.
    let stillExtending = true;
    let chunkIndex = 1;
    while (stillExtending) {
      stillExtending = false;
      for (const p of pending) {
        const start = chunkIndex * MAX_STRIP_FRAMES;
        if (start >= p.frameCount) {
          continue; // this tile is done
        }
        if (chunkIndex < p.chunksRendered) {
          // Already rendered (e.g. via lazy `ensureAnimationChunk`).
          stillExtending = true;
          continue;
        }
        const ok = await this.renderAnimationChunk(p, chunkIndex);
        if (ok) {
          renderedExtra++;
          stillExtending = true;
          this.notifyAnimationFrames(p.tileKey);
        }
        await yieldToMain();
      }
      chunkIndex++;
    }

    if (gpu) {
      await gpu.device.queue.onSubmittedWorkDone();
    }
    log.info(
      `finalizeAnimations done: ${renderedChunk0} chunk-0 + ${renderedExtra} extra chunks across ${pending.length} tiles in ${(performance.now() - t0).toFixed(0)}ms`
    );
  }

  /**
   * Lazily render the next chunk of an animated tile if it hasn't been
   * rendered yet. Returns `true` when the requested chunk is now
   * cached, `false` if the chunk is out of range or the render failed.
   * Idempotent + safe to call concurrently — multiple calls collapse
   * to one render via `inFlightChunks`.
   */
  async ensureAnimationChunk(
    tileKey: string,
    chunkIndex: number
  ): Promise<boolean> {
    const pending = this.animationsByKey.get(tileKey);
    if (!pending) {
      return false;
    }
    if (chunkIndex < pending.chunksRendered) {
      return true; // already cached
    }
    const start = chunkIndex * MAX_STRIP_FRAMES;
    if (start >= pending.frameCount) {
      return false; // out of range
    }
    const inFlightKey = `${tileKey}:${chunkIndex}`;
    const existing = this.inFlightChunks.get(inFlightKey);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      // Ensure all earlier chunks are present (so frame indices are
      // contiguous in the cache). Typically a no-op since the
      // AnimatedSprite plays linearly through chunk N before reaching
      // chunk N+1.
      for (let c = pending.chunksRendered; c < chunkIndex; c++) {
        const earlier = await this.renderAnimationChunk(pending, c);
        if (!earlier) {
          return false;
        }
      }
      const ok = await this.renderAnimationChunk(pending, chunkIndex);
      if (ok) {
        this.notifyAnimationFrames(tileKey);
      }
      return ok;
    })();
    this.inFlightChunks.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlightChunks.delete(inFlightKey);
    }
  }

  /**
   * Ensure the static base texture for `p` is rendered + cached at the
   * current zoom. Idempotent. The static base contains every depth
   * whose placement is constant across the timeline AND whose placed
   * character has no multi-frame sub-tree — for tile 343 this is the
   * entire wooden building geometry, encoded once instead of 210 times.
   */
  private renderStaticBase(p: PendingAnimation): boolean {
    const zoom = this.currentZoom;
    const cached = this.staticBaseCache.get(p.tileKey);
    if (cached && Math.abs(cached.zoom - zoom) < 0.001) {
      return true;
    }
    const result = renderSwfTileStaticBase(
      p.bundle,
      p.exportName,
      p.frameCount,
      zoom
    );
    if (!result) {
      log.warn(
        `renderStaticBase: failed for ${p.tileKey} (${p.bundle}/${p.exportName})`
      );
      return false;
    }
    const source = this.velloRenderer.wrapBatchSource(
      result.texture,
      result.width,
      result.height,
      zoom,
      `swf-static:${p.bundle}/${p.exportName}`
    );
    this.trackSource(source, result.textureId);
    const tex = new Texture({
      source,
      frame: new Rectangle(0, 0, result.width / zoom, result.height / zoom),
    });
    this.staticBaseCache.set(p.tileKey, { texture: tex, zoom });
    return true;
  }

  /** Render one chunk of an animated tile's DYNAMIC strip + ensure
   *  the static base. The dynamic strip contains only the moving
   *  placements; the static base lives in `staticBaseCache` and is
   *  composited by the layer-builder as a separate Sprite below the
   *  AnimatedSprite. */
  private async renderAnimationChunk(
    p: PendingAnimation,
    chunkIndex: number
  ): Promise<boolean> {
    if (chunkIndex < p.chunksRendered) {
      return true;
    }
    const start = chunkIndex * MAX_STRIP_FRAMES;
    if (start >= p.frameCount) {
      return false;
    }
    const count = Math.min(MAX_STRIP_FRAMES, p.frameCount - start);
    const zoom = this.currentZoom;
    // Render the static base before the first chunk so meta + layer
    // builder can composite immediately.
    if (chunkIndex === 0 && !this.renderStaticBase(p)) {
      // Static base render failure shouldn't kill the dynamic strip —
      // worst case, the cell renders without the static parts visible.
      // Log + continue so animation still plays.
    }
    const strip = renderSwfTileDynamicStripRange(
      p.bundle,
      p.exportName,
      start,
      count,
      p.frameCount,
      zoom
    );
    if (!strip) {
      log.warn(
        `renderAnimationChunk: dynamic strip-range failed for ${p.tileKey} chunk ${chunkIndex} (${p.bundle}/${p.exportName})`
      );
      return false;
    }
    const stripSource = this.velloRenderer.wrapBatchSource(
      strip.texture,
      strip.width,
      strip.height,
      zoom,
      `swf-dyn:${p.bundle}/${p.exportName}#${chunkIndex}`
    );
    this.trackSource(stripSource, strip.textureId);
    const fw = strip.frameWidth / zoom;
    const fh = strip.frameHeight / zoom;
    for (let f = 0; f < strip.frameCount; f++) {
      const col = f % strip.gridCols;
      const row = Math.floor(f / strip.gridCols);
      const tex = new Texture({
        source: stripSource,
        frame: new Rectangle(col * fw, row * fh, fw, fh),
      });
      const globalIdx = start + f;
      this.cache.addToFrameCache(this.frameCacheKey(p.tileKey, globalIdx), tex);
    }
    p.chunksRendered = chunkIndex + 1;
    // On the first chunk we replace the tile's metadata: the bundle
    // batch sized frame 0 to its tight per-frame bounds, but the strip
    // sizes every frame to the FULL animation's bounds union (so
    // chunks 1+ render with consistent geometry). Without updating the
    // meta + manifest here, every AnimatedSprite for this tile would
    // keep its original bundle-batch pivot — when
    // `refreshAnimatedSprites` then swaps in the strip's larger
    // textures, the content shifts by `(strip_anchor - bundle_anchor)`
    // because the same authored content sits at different intrinsic
    // offsets in the two canvases. Layer-builder's
    // `refreshAnimatedSprites` reads the updated manifest right after
    // the notify and re-applies pivot.
    if (chunkIndex === 0) {
      const meta: TileSwfMeta = {
        width: fw,
        height: fh,
        anchorX: strip.anchorX / zoom,
        anchorY: strip.anchorY / zoom,
        frameCount: p.frameCount,
      };
      this.velloRenderer.setMeta(p.tileKey, meta);
      const newData = buildSyntheticTileData(p.bundle, p.exportName, meta);
      this.cache.setTileData(p.tileKey, newData);
      const [type] = p.tileKey.split("_");
      this.cache.setTileManifest(
        p.tileKey,
        convertToTileManifest(
          newData,
          type as "ground" | "objects" | "tactic" | "cell"
        )
      );
    }
    return true;
  }

  /**
   * Render every chunk of a multi-frame tile synchronously. Used for
   * random/slope tiles where each cell picks a specific frame index up
   * front, so we need the whole strip in cache before renderCell.
   */
  private renderStripChunks(
    m: {
      tileKey: string;
      bundle: string;
      exportName: string;
      frameCount: number;
    },
    zoom: number
  ): void {
    let summary: {
      anchorX: number;
      anchorY: number;
      frameWidth: number;
      frameHeight: number;
    } | null = null;
    let totalRendered = 0;
    let chunkIndex = 0;
    for (let start = 0; start < m.frameCount; start += MAX_STRIP_FRAMES) {
      const count = Math.min(MAX_STRIP_FRAMES, m.frameCount - start);
      const strip = renderSwfStripRange(
        m.bundle,
        m.exportName,
        start,
        count,
        m.frameCount,
        zoom
      );
      if (!strip) {
        log.warn(
          `renderStripChunks: chunk failed for ${m.tileKey}@${start}+${count}/${m.frameCount}`
        );
        break;
      }
      const stripSource = this.velloRenderer.wrapBatchSource(
        strip.texture,
        strip.width,
        strip.height,
        zoom,
        `swf-strip:${m.bundle}/${m.exportName}#${chunkIndex}`
      );
      this.trackSource(stripSource, strip.textureId);
      const fw = strip.frameWidth / zoom;
      const fh = strip.frameHeight / zoom;
      for (let f = 0; f < strip.frameCount; f++) {
        const col = f % strip.gridCols;
        const row = Math.floor(f / strip.gridCols);
        const tex = new Texture({
          source: stripSource,
          frame: new Rectangle(col * fw, row * fh, fw, fh),
        });
        const globalIdx = start + f;
        this.cache.addToFrameCache(this.frameCacheKey(m.tileKey, globalIdx), tex);
      }
      if (!summary) {
        summary = {
          anchorX: strip.anchorX / zoom,
          anchorY: strip.anchorY / zoom,
          frameWidth: fw,
          frameHeight: fh,
        };
      }
      totalRendered += strip.frameCount;
      chunkIndex++;
    }
    if (!summary) {
      return;
    }
    const meta: TileSwfMeta = {
      width: summary.frameWidth,
      height: summary.frameHeight,
      anchorX: summary.anchorX,
      anchorY: summary.anchorY,
      frameCount: totalRendered,
    };
    this.velloRenderer.setMeta(m.tileKey, meta);
    this.cache.setTileData(
      m.tileKey,
      buildSyntheticTileData(m.bundle, m.exportName, meta)
    );
    this.getTileManifestSync(m.tileKey);
  }

  clearFrameCache(): void {
    this.cache.clearFrameCache();
  }

  getFrameCacheMemoryBytes(): number {
    return this.cache.getFrameCacheMemoryBytes();
  }

  getFrameCacheEntryCount(): number {
    return this.cache.getFrameCacheEntryCount();
  }

  clearCache(): void {
    this.cache.clearAll();
    this.staticBaseCache.clear();
    this.retireAllSources();
  }

  /**
   * Clear only textures for a specific zoom level. Does NOT destroy textures —
   * lets GC handle cleanup to avoid GPU conflicts with in-flight draws.
   */
  clearZoomCache(zoom: number): void {
    this.cache.clearZoomLevel(zoom);
  }
}
