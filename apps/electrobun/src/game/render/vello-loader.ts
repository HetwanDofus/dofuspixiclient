/**
 * Vello WASM renderer integration.
 *
 * Vello creates the shared `GPUDevice` (via the patched wgpu fork that
 * exposes the raw JS GPUDevice handle). Pixi adopts that same device
 * via `Application.init({ gpu: { adapter, device } })` so both
 * libraries render on ONE WebGPU device against ONE canvas. Vello
 * produces `GPUTexture` handles; Pixi wraps them as `Texture` via
 * `new ExternalSource({ resource: gpuTexture, renderer })` and uses
 * them on `Sprite`s like any other texture.
 *
 * Usage:
 *   const { renderer, gpu } = await initVello();
 *   await pixiApp.init({ gpu, preference: "webgpu" });
 *   const result = renderSwfFrame(bundle, exportName, frame, resolution);
 *   const tex = new Texture({
 *     source: new ExternalSource({ resource: result.texture, renderer: pixiApp.renderer }),
 *   });
 */

import type { Renderer as PixiRenderer } from "pixi.js";
import wasmInit, { VelloRenderer } from "vello-wasm";

import { recordProbe } from "./render-probes";
import { getRenderWatchdog } from "./render-watchdog";

/**
 * Opt-9: kick off bake-worker pool initialisation. Lazy-imports the
 * pool module to keep the worker chunk out of the main bundle until
 * we actually need it. Failure is non-fatal — pool stays unready and
 * `acquireClassAtlas` uses the main-thread fallback.
 */
/** Resolves once the bake-worker pool init has succeeded OR failed.
 *  Re-exported (`bake-worker-pool.whenBakeWorkerPoolInitDone`) for
 *  callers that should wait for the pool to settle before issuing the
 *  first class-atlas acquire — otherwise a race during init falls back
 *  to a main-thread bake that contends with Pixi's tickDeferredDestroys
 *  and produces a wasm-bindgen reentrancy panic. */
export async function whenBakeWorkerPoolInitDone(): Promise<void> {
  try {
    const mod = await import("./bake-worker-pool");
    await mod.whenBakeWorkerPoolInitDone();
  } catch {
    // ignore — module load failure leaves pool unready, callers fall
    // back to main-thread bake
  }
}

async function initBakeWorkerPool(wasmUrl?: string): Promise<void> {
  try {
    const mod = await import("./bake-worker-pool");
    // Pool size = 1. Each worker owns its own `VelloRenderer` and
    // thus its own `body_subscene_cache` (vello-wasm/src/lib.rs).
    // Round-robin dispatch (`bake-worker-pool.ts:92`) means a zoom-
    // induced rebake lands on a different worker than the original
    // bake → ~7/8 cache miss rate at pool=8. Capping to 1 keeps the
    // sub-scene cache effective across resolution changes: every
    // rebake hits the same worker's warm cache and the scene-build
    // step (~75 ms) collapses to a memcpy append (~5 ms).
    //
    // Trade-off: serial CPU encoding on the cold-spawn path. The
    // `prewarmCharacterClassAtlases` sweep called from the
    // battlefield bootstrap pays this cost upfront, behind the
    // loading screen, so steady-state play never sees it.
    // A/B knob for the render measurement sweep. Two equivalent
    // sources (precedence: localStorage > URL query > defaults):
    //
    //   localStorage:
    //     localStorage.setItem("bakePoolSize", "4");   // 1..16
    //     localStorage.setItem("bakeShard", "1");      // "1" to enable
    //
    //   URL query (browser-only; Electrobun loads from file:/// so
    //   localStorage is the only path that works there):
    //     ?bakePoolSize=N
    //     ?bakeShard=1
    //
    // Defaults preserve the prior pool=1 round-robin behavior. Setting
    // size>1 WITHOUT shard=1 is the cross-thrash regime (don't ship it,
    // useful only for A/B comparison).
    let size = 1;
    let shardByBundle = false;
    try {
      if (typeof localStorage !== "undefined") {
        const sizeStored = localStorage.getItem("bakePoolSize");
        if (sizeStored) {
          const n = Number(sizeStored);
          if (Number.isFinite(n) && n >= 1 && n <= 16) size = Math.floor(n);
        }
        if (localStorage.getItem("bakeShard") === "1") shardByBundle = true;
      }
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search ?? "");
        const sizeParam = params.get("bakePoolSize");
        if (sizeParam) {
          const n = Number(sizeParam);
          if (Number.isFinite(n) && n >= 1 && n <= 16) size = Math.floor(n);
        }
        if (params.get("bakeShard") === "1") shardByBundle = true;
      }
    } catch {
      // ignore — sandboxed contexts default to 1/false
    }
    console.log(
      `[vello-loader] bake-worker pool: size=${size} shardByBundle=${shardByBundle}`,
    );
    const ok = await mod.initBakeWorkerPool({ size, wasmUrl, shardByBundle });
    if (!ok) {
      console.warn(
        "[vello-loader] bake-worker pool init failed; using main-thread bakes",
      );
    }
  } catch (e) {
    console.warn("[vello-loader] bake-worker pool unavailable:", e);
  }
}

let renderer: VelloRenderer | null = null;
let maxTextureSize = 8192;
let pixiRenderer: PixiRenderer | null = null;
/**
 * Resolves the first time `initVello()` finishes wiring up `renderer`
 * + `velloGpu`. Consumers (HUD renderers, minimap, worldmap) `await
 * whenVelloReady()` before issuing the first WASM call instead of
 * checking `getVelloRenderer()` and crashing — the React component
 * tree mounts ahead of the Battlefield's `initVello()` so the gate
 * matters in practice.
 */
let velloReadyResolve: (() => void) | null = null;
const velloReadyPromise = new Promise<void>((res) => {
  velloReadyResolve = res;
});

/**
 * Resolves once `initVello()` has installed the Vello renderer + GPU
 * device on this module. Safe to call before, during, or after
 * `initVello()`: pre-init callers wait, post-init callers see an
 * already-resolved promise. Use this in any code path that touches
 * `loadSwfBundle`, `renderSwfFrame`, … from React (HUD asset
 * renderers, minimap, worldmap) — the React tree mounts ahead of the
 * Battlefield bootstrap.
 */
export function whenVelloReady(): Promise<void> {
  return velloReadyPromise;
}
/**
 * Captured at `initVello()` from the WASM init result. Pixi's
 * `Application.init({ gpu })` consumes this so both libraries share
 * ONE `GPUDevice`. Cleared only on full teardown (Vello has no
 * device-lost recovery path here yet).
 */
let velloGpu: { adapter: GPUAdapter; device: GPUDevice } | null = null;

/**
 * Set of textureIds we've handed out to JS callers that haven't called
 * `freeRenderTexture` yet. Used to keep the watchdog's active-texture
 * counter accurate even when the same id is returned across ticks (the
 * tile pass keeps a persistent target — registering on every render
 * would over-count). The set membership check makes the counter
 * monotonic per logical texture lifetime, not per render call.
 */
const liveRenderTextureIds = new Set<number>();
/**
 * Live AVM1 spell instance ids. Each `createSwfSpellInstance` allocates
 * its own GPU output texture inside the WASM; we track the id so the
 * watchdog can observe both classes of GPU memory uniformly.
 */
const liveSpellInstanceIds = new Set<number>();

/**
 * Initialize the Vello WASM renderer. Vello creates its own
 * `wgpu::Instance` + requests an `Adapter` + `GPUDevice` internally.
 * The patched wgpu fork (`rust/wgpu`) exposes those raw JS
 * `GPUAdapter` / `GPUDevice` handles back through wasm-bindgen so we
 * can hand them to Pixi's `Application.init({ gpu })`. Pixi then
 * renders on the SAME device — no cross-device textures, no DOM
 * compositing of separate canvases.
 *
 * Caller must call `initVello()` BEFORE `pixiApp.init()` so the
 * `{adapter, device}` are available to pass into Pixi.
 */
export async function initVello(wasmUrl?: string): Promise<{
  renderer: VelloRenderer;
  gpu: { adapter: GPUAdapter; device: GPUDevice };
}> {
  // Idempotent: a second call returns the same renderer + gpu. Vello
  // owns its `wgpu::Instance` inside the WASM module, and the loaded
  // bundle set on the JS side (`loadedSwfBundles`) is module-global —
  // re-initializing would create a fresh renderer with no bundles
  // while the JS bundle set still claims they're loaded, silently
  // dropping every subsequent render. Returning the existing handles
  // keeps the two sides in sync across React re-mounts and HMR.
  if (renderer && velloGpu) {
    return { renderer, gpu: velloGpu };
  }

  if (wasmUrl) {
    await wasmInit(wasmUrl);
  } else {
    await wasmInit();
  }

  const result = await VelloRenderer.init();

  renderer = result.renderer as VelloRenderer;
  maxTextureSize = (result.maxTextureSize as number) || 8192;
  velloGpu = {
    adapter: result.adapter as GPUAdapter,
    device: result.device as GPUDevice,
  };

  // Unblock any consumers that called `whenVelloReady()` before
  // initVello finished. Subsequent calls to `whenVelloReady()` see an
  // already-resolved promise (Promise resolution is idempotent).
  velloReadyResolve?.();
  velloReadyResolve = null;

  // Opt-9: spin up the bake-worker pool for parallel class atlas
  // bakes. Failure (no `navigator.gpu`, dev env without COOP/COEP,
  // single-CPU host) leaves the pool unready; `acquireClassAtlas`
  // falls back to the main-thread synchronous bake. Don't await —
  // pool-ready is opportunistic; the first few class atlas bakes may
  // still run on the main thread until workers signal ready.
  void initBakeWorkerPool(wasmUrl);

  // Device-loss notification still flows through the watchdog. Vello's
  // `init()` retains the JS GPUDevice on the renderer side; for now we
  // surface loss only when a render call returns false repeatedly. A
  // dedicated WASM hook for `device.lost` could be added later if a
  // sharper signal is needed.

  return { renderer, gpu: velloGpu };
}

/**
 * Get the Vello renderer instance.
 */
export function getVelloRenderer(): VelloRenderer | null {
  return renderer;
}

/**
 * The `{adapter, device}` Vello created — captured at `initVello()`
 * for Pixi to adopt via `Application.init({ gpu: getVelloGpu() })`.
 * Returns `null` if `initVello()` hasn't run yet.
 */
export function getVelloGpu(): {
  adapter: GPUAdapter;
  device: GPUDevice;
} | null {
  return velloGpu;
}

/**
 * Pixi `Renderer` is a process-wide singleton (one Pixi `Application`
 * sharing Vello's `GPUDevice`). Renderers — tile, spell, fighter — all
 * need it to wrap GPU textures as `ExternalSource`. The engine sets it
 * once right after `app.init()`; consumers retrieve it via the getter.
 */
export function setPixiRenderer(r: PixiRenderer): void {
  pixiRenderer = r;
}

export function getPixiRenderer(): PixiRenderer | null {
  return pixiRenderer;
}

export function getMaxTextureSize(): number {
  return maxTextureSize;
}

/**
 * True when the watchdog has tripped emergencyHalt (auto or manual). All
 * render entry points below check this and short-circuit to null when set,
 * so a stalled GPU stops accumulating queue work before the host driver
 * gives up. Callers already handle null gracefully.
 */
function isHalted(): boolean {
  try {
    return getRenderWatchdog().isHalted();
  } catch {
    return false;
  }
}


/** Public read-only view of in-flight Vello-allocated GPU textures. */
export function getLiveRenderTextureCount(): number {
  return liveRenderTextureIds.size + liveSpellInstanceIds.size;
}

/** Just the render-texture-id set size (renderSwfFrame / strips). */
export function getLiveRenderTextureIdCount(): number {
  return liveRenderTextureIds.size;
}

/** Just the AVM1 spell-instance id set size (createSwfSpellInstance). */
export function getLiveSpellInstanceCount(): number {
  return liveSpellInstanceIds.size;
}

/** Loaded SWF bundle names in WASM (per-bundle metadata, not per-texture). */
export function getLoadedSwfBundleCount(): number {
  return loadedSwfBundles.size;
}

/** SWF load queue diagnostics for the HUD. */
export function getSwfLoadStats(): {
  active: number;
  queued: number;
  loaded: number;
} {
  return {
    active: loadingNow,
    queued: loadWaiters.length,
    loaded: loadedSwfBundles.size,
  };
}

/**
 * Internal helper: ensure first-time observation of a textureId is
 * counted. Bridge migration: most renderSwf* paths no longer return
 * a textureId, so this is currently unused — kept for the spell-
 * instance and cool paths that still emit textureIds.
 */
// @ts-expect-error currently unused under bridge migration; kept for future re-wiring.
function trackRenderTexture(textureId: number, label: string): void {
  if (textureId === 0 || textureId === -1) return;
  if (!liveRenderTextureIds.has(textureId)) {
    liveRenderTextureIds.add(textureId);
    try {
      getRenderWatchdog().registerTextureCreated(label);
    } catch {
      // ignore
    }
  }
}

// ─── SWF bundle API ────────────────────────────────────────────────────────
// Tiles, sprites, spells, icons, and portraits render directly from .swf
// files via swf-spike. The dofasset path is gone — `loadAsset` /
// `renderFrame` / `getAnimationInfo` / `getAnimationMeta` / `freeTexture`
// / `freeAsset` were removed once all consumers migrated to the SWF API.

/** Pre-warmed gfx tile bundles. Loaded once at battlefield boot. */
export const GFX_BUNDLE_NAMES = [
  "g1",
  "g2",
  "o1",
  "o2",
  "o3",
  "o4",
  "o5",
  "o6",
  "o7",
  "o8",
  "o9",
  "o10",
  "o11",
  "o12",
  "cell",
  "tactic",
] as const;

export type GfxBundleName = (typeof GFX_BUNDLE_NAMES)[number];

export interface VelloSwfFrameResult {
  /**
   * Step 11 bridge: Vello-rendered pixels delivered to Pixi as a
   * GPU-resident `ImageBitmap` (via OffscreenCanvas
   * `transferToImageBitmap`). Pixi consumes via `ImageSource` and
   * may close the bitmap once it has been sampled.
   */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Position of SWF (0,0) origin within the rendered texture. */
  anchorX: number;
  /** Position of SWF (0,0) origin within the rendered texture. */
  anchorY: number;
}

const loadedSwfBundles = new Set<string>();
/**
 * Opt-9: retained SWF bundle bytes. Workers (in `bake-worker.ts`) need
 * their own copy of every SWF bundle to bake class atlases off-thread.
 * The main thread keeps a `Uint8Array` clone alongside the WASM-owned
 * bytes; `getRetainedSwfBundleBytes` returns it for posting to a worker.
 *
 * Memory cost: ~20–40 MB total across all sprite/accessory bundles for
 * a Dofus 1.29 character. Acceptable given the parallelism win.
 */
const retainedSwfBundleBytes = new Map<string, Uint8Array>();
export function getRetainedSwfBundleBytes(name: string): Uint8Array | null {
  return retainedSwfBundleBytes.get(name) ?? null;
}
/**
 * In-flight load promises by bundle name. Multiple call sites
 * (character-sprite-loader, accessory-resolver, spell-icon-renderer) can
 * race on the same bundle; without this dedup they'd all fetch + decode
 * in parallel and the WASM `loadSwfBundle` would race to insert into the
 * shared bundle map. Coalescing to one promise per name avoids the race
 * AND amortizes the network/decode cost.
 */
const inflightSwfLoads = new Map<string, Promise<boolean>>();

/**
 * Concurrency cap for SWF bundle loading. Boot path dispatches dozens of
 * loads in parallel (gfx prewarm + spell icons + sprite + accessories
 * for the active player). Without a cap, all of them race to fetch +
 * WASM-decode at once — the decode is GPU-adjacent (Vello pre-builds
 * SVG path data into GPU-ready buffers during load), so 30 parallel
 * decodes saturate the WebGPU command queue and trip the macOS
 * WindowServer watchdog (40s no-checkin → kernel-level kill, observed
 * crash 2026-05-06). Cap at 4 — empirically keeps frame times <16ms
 * during boot on M-series and still loads the full asset set in <2s.
 */
const LOAD_CONCURRENCY = 4;
let loadingNow = 0;
const loadWaiters: Array<() => void> = [];

function acquireLoadSlot(): Promise<void> {
  if (loadingNow < LOAD_CONCURRENCY) {
    loadingNow++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => loadWaiters.push(resolve));
}

function releaseLoadSlot(): void {
  loadingNow--;
  const next = loadWaiters.shift();
  if (next) {
    loadingNow++;
    // Give the event loop one tick before resuming the next loader so
    // a long burst doesn't starve other interactive work (input, HUD).
    queueMicrotask(next);
  }
}

/**
 * Track which bundles' subscene caches have been hydrated from IDB
 * to avoid redundant hydration on duplicate load calls. The renderer
 * doesn't crash on a second hydrate (`loadXSubsceneCache` is
 * idempotent — it overwrites existing entries) but the IDB roundtrip
 * is wasted work.
 */
const hydratedBundles = new Set<string>();

/**
 * Fire-and-forget hydration helper called after `loadSwfBundle`
 * succeeds. Hashes the bundle bytes, fetches body+tile+acc rows
 * from IDB, calls the wasm `loadXSubsceneCache` for each present.
 */
async function hydrateBundleOnLoad(
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  if (hydratedBundles.has(name)) return;
  hydratedBundles.add(name);
  try {
    // Dynamic import to avoid a hard cycle between vello-loader and
    // scene-cache-idb (the latter never reaches in here, but bundler
    // tree-shaking can be touchy with hot exports).
    const idb = await import("@/game/render/scene-cache-idb");
    const contentHash = await idb.hashBytes(bytes);
    await idb.hydrateBundleSubsceneCaches(name, contentHash, {
      loadBody: (b) => loadBodySubsceneCache(b),
      loadTile: (b) => loadTileSubsceneCache(b),
      loadAcc: (b) => loadAccessorySubsceneCache(b),
      loadBodyScene: (b) => loadBodySceneCache(b),
    });
  } catch (e) {
    // Hydration is best-effort; failure just means the first bake
    // for this bundle runs cold, which is still correct behavior.
    // Re-allow retry on the next load (e.g. after a hot reload).
    hydratedBundles.delete(name);
  }
}

/**
 * Persist all 3 sub-scene caches for a bundle to IDB. Called by the
 * periodic flush + on page unload. The bundle's content hash is
 * derived once per call (re-hashing the retained bytes); for a
 * 1 MB bundle that's <2 ms via SubtleCrypto.
 */
export async function persistBundleSceneCaches(name: string): Promise<void> {
  const bytes = retainedSwfBundleBytes.get(name);
  if (!bytes) return;
  try {
    const idb = await import("@/game/render/scene-cache-idb");
    const contentHash = await idb.hashBytes(bytes);
    await idb.persistBundleSubsceneCaches(name, contentHash, {
      serializeBody: () => serializeBodySubsceneCache(name),
      serializeTile: () => serializeTileSubsceneCache(name),
      serializeAcc: () => serializeAccessorySubsceneCache(name),
      serializeBodyScene: () => serializeBodySceneCache(name),
    });
  } catch (e) {
    // Best-effort; the next flush retries.
    void e;
  }
}

/**
 * Periodic flush: walk every loaded bundle and persist its non-empty
 * sub-scene caches to IDB. Suitable for a background interval timer
 * (every 30 s) and for an `unload` handler to capture last-session
 * deltas. Returns the count of bundles persisted.
 */
export async function persistAllSceneCaches(): Promise<number> {
  let count = 0;
  // Snapshot keys so a concurrent load doesn't trip iteration.
  const names = Array.from(loadedSwfBundles);
  for (const name of names) {
    await persistBundleSceneCaches(name);
    count += 1;
  }
  lastFullPersistAt = (typeof performance !== "undefined"
    ? performance.now()
    : Date.now());
  return count;
}

let lastFullPersistAt = 0;
/**
 * Throttled `persistAllSceneCaches` for event-driven triggers (e.g.
 * map-leave). Skips if a full persist ran within `minIntervalMs`, so
 * fast map-walking doesn't storm IDB with redundant writes — the
 * caches are bundle-keyed and accumulate across maps, so the periodic
 * 30 s flush (or the previous map-leave) already captured them.
 * Returns the bundles persisted, or -1 if skipped.
 */
export async function persistAllSceneCachesThrottled(
  minIntervalMs = 15000,
): Promise<number> {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastFullPersistAt < minIntervalMs) return -1;
  return persistAllSceneCaches();
}

/**
 * Load a SWF bundle by name. Default URL is `/swf/gfx/${name}.swf`; pass
 * `url` for non-gfx bundles (sprites, spells, items). Idempotent +
 * concurrency-capped. Multiple callers asking for the same bundle
 * simultaneously share one in-flight promise (no duplicate fetch).
 */
export async function loadSwfBundle(
  name: string,
  url?: string
): Promise<boolean> {
  if (!renderer) {
    throw new Error("Vello not initialized");
  }
  if (loadedSwfBundles.has(name)) {
    return true;
  }
  // Dedup: if another caller is already loading this exact bundle,
  // ride their promise. This is the typical case at boot (player
  // sprite + accessory resolver both want sprite-NN).
  const existing = inflightSwfLoads.get(name);
  if (existing) return existing;

  const promise = (async () => {
    await acquireLoadSlot();
    try {
      // Re-check halt AFTER acquiring the slot. The load queue can be
      // long during boot; the watchdog may have flipped halt while this
      // task was waiting. Skipping the actual fetch+decode under halt
      // is the whole point of the gate — no point spending CPU on
      // bundles whose subsequent renders will return null anyway.
      if (isHalted()) return false;
      const fetchUrl = url ?? `/swf/gfx/${name}.swf`;
      const response = await fetch(fetchUrl);
      if (!response.ok) return false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (isHalted()) return false;
      // Retain a clone for the bake-worker pool (Opt-9). `bytes` is
      // moved into WASM (the renderer takes ownership), so we slice
      // before handing it over.
      const retained = bytes.slice();
      const ok = renderer!.loadSwfBundle(name, bytes);
      if (ok) {
        loadedSwfBundles.add(name);
        retainedSwfBundleBytes.set(name, retained);
        // Fire-and-forget IDB hydration for body+tile+acc sub-scene
        // caches. On a returning session this skips the AS2 walk
        // for every cached entry — the first bake of a tile or
        // accessory after this hydrate becomes GPU-only. Failures
        // (missing row, parse error) just leave the in-memory
        // cache empty and the next bake falls back to fresh.
        //
        // Why fire-and-forget: hydration is independent of the
        // bundle being "loaded" from the caller's perspective.
        // Awaiting it here would block every SWF load behind an
        // IDB roundtrip. Bakes will re-check the cache when they
        // run anyway.
        void hydrateBundleOnLoad(name, retained);
      }
      return ok;
    } finally {
      inflightSwfLoads.delete(name);
      releaseLoadSlot();
    }
  })();

  inflightSwfLoads.set(name, promise);
  return promise;
}

export function isSwfBundleLoaded(name: string): boolean {
  return loadedSwfBundles.has(name);
}

/**
 * Enumerate every named export in a loaded SWF bundle. Empty array
 * when the bundle isn't loaded. Used by tools that want to build a
 * content pool from what actually shipped instead of a hand-curated
 * list (e.g. the stress test's accessory picker).
 */
export function swfBundleExports(name: string): string[] {
  if (!renderer) return [];
  if (!loadedSwfBundles.has(name)) return [];
  return renderer.swfBundleExports(name);
}

/**
 * List every SWF bundle currently loaded in WASM. Surfaces the WASM
 * truth (vs. JS-side `loadedSwfBundles` set, which is the same
 * information but doesn't survive a WASM hot-reload).
 */
export function listLoadedSwfBundles(): string[] {
  if (!renderer) return [];
  return (renderer as unknown as { listLoadedSwfBundles(): string[] })
    .listLoadedSwfBundles();
}

export interface SwfBundleInventoryRow {
  name: string;
  kind: "Sprite" | "Shape" | "MorphShape" | "Bitmap";
  totalFrames: number;
  isCharacterAnim: boolean;
}

/**
 * Dump every named export in a loaded SWF bundle with its kind +
 * total frame count + character-anim filter status. Used by the
 * render measurement sweep.
 */
export function dumpSwfBundleInventory(
  bundle: string
): SwfBundleInventoryRow[] {
  if (!renderer) return [];
  const result = (
    renderer as unknown as {
      dumpSwfBundleInventory(b: string): SwfBundleInventoryRow[] | null;
    }
  ).dumpSwfBundleInventory(bundle);
  return result ?? [];
}

export interface ClassEnumerationExportRow {
  exportName: string;
  totalFrameCount: number;
  hasToggle: boolean;
  exportBFix: boolean;
  slotCountLogical: number;
}

export interface ClassEnumerationDump {
  bundleBFixUsed: boolean;
  exports: ClassEnumerationExportRow[];
}

/** Dump the `ClassEnumeration` for one bundle without populating the
 *  cache (so the next class-atlas bake still pays its enumerate phase
 *  honestly). */
export function dumpClassEnumeration(
  bundle: string
): ClassEnumerationDump | null {
  if (!renderer) return null;
  const result = (
    renderer as unknown as {
      dumpClassEnumeration(b: string): ClassEnumerationDump | null;
    }
  ).dumpClassEnumeration(bundle);
  return result ?? null;
}

export interface SubsceneCacheBundleSize {
  entryCount: number;
  /** -1 if the encoder failed; otherwise the byte length of the IDB
   *  blob for this bundle's subscene entries. */
  serializedBytes: number;
}

/** Report the IDB blob size + entry count for one bundle's contribution
 *  to the body_subscene_cache. */
export function subsceneCacheBytesForBundle(
  bundle: string
): SubsceneCacheBundleSize {
  if (!renderer) return { entryCount: 0, serializedBytes: 0 };
  return (
    renderer as unknown as {
      subsceneCacheBytesForBundle(b: string): SubsceneCacheBundleSize;
    }
  ).subsceneCacheBytesForBundle(bundle);
}

export interface BodySceneCacheStats {
  /** Current entries in the composed-atlas LRU (≤ cap). */
  entries: number;
  /** Hard cap (BODY_SCENE_CACHE_CAP constant in Rust). */
  cap: number;
  /** Cumulative cache hits since renderer init. */
  hits: number;
  /** Cumulative cache misses since renderer init. */
  misses: number;
  /** Cumulative LRU evictions since renderer init. */
  evictions: number;
  /** hits / (hits + misses); 0.0 if no accesses. */
  hitRate: number;
}

/** Set the class-atlas bake mode: 0 = AUTO (per-page for ≤2 pages,
 *  per-variant for ≥3), 1 = force per-variant, 2 = force per-page. */
export function setClassAtlasBakeMode(mode: number): void {
  if (!renderer) return;
  (
    renderer as unknown as {
      setClassAtlasBakeMode(m: number): void;
    }
  ).setClassAtlasBakeMode(mode);
}

/** Legacy: `true` → force per-variant (mode 1); `false` → force
 *  per-page (mode 2). Prefer `setClassAtlasBakeMode(0)` for AUTO. */
export function setClassAtlasForcePerVariant(force: boolean): void {
  if (!renderer) return;
  (
    renderer as unknown as {
      setClassAtlasForcePerVariant(f: boolean): void;
    }
  ).setClassAtlasForcePerVariant(force);
}

/** Lifetime stats for `body_scene_cache` (the 1500-cap composed-atlas
 *  LRU consulted by `render_swf_body_atlas`). Used by the render
 *  measurement sweep to verify whether the LRU is thrashing under
 *  stress — v3's "delete body_scene_cache" instinct depends on this
 *  hit rate. */
export function bodySceneCacheStats(): BodySceneCacheStats {
  if (!renderer) {
    return {
      entries: 0,
      cap: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
      hitRate: 0,
    };
  }
  return (
    renderer as unknown as {
      bodySceneCacheStats(): BodySceneCacheStats;
    }
  ).bodySceneCacheStats();
}

/**
 * Render an exported symbol from a loaded SWF bundle. Returns the GPU
 * texture wrapped with anchor info, or null if the export is missing or the
 * renderer is not ready.
 */
export function renderSwfFrame(
  bundle: string,
  exportName: string,
  frame: number,
  resolution: number
): VelloSwfFrameResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfFrame(bundle, exportName, frame, resolution);
  return (result as VelloSwfFrameResult | null) ?? null;
}

/**
 * Render a SWF's ROOT timeline (the main movie stage) at the given frame.
 * Used for SWFs without named exports — `clips/artworks/big/{gfxId}.swf`
 * and `clips/spells/icons/up/{spellId}.swf` place their visible content
 * directly on the root stage rather than declaring named exports.
 * Honors `setSwfPlayerColors` for portraits with applyColor zones.
 */
export function renderSwfRoot(
  bundle: string,
  frame: number,
  resolution: number
): VelloSwfFrameResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfRoot(bundle, frame, resolution);
  return (result as VelloSwfFrameResult | null) ?? null;
}


export interface VelloSpellTickResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
  /** Pixel anchor inside the cast's stable output texture. */
  anchorX: number;
  anchorY: number;
  /** False once AS2 has called `stop()` on the root clip. */
  isPlaying: boolean;
  /** True once AS2 has called `_parent.removeMovieClip()` — JS should
   *  fire `onComplete` and stop ticking. */
  isRemoved: boolean;
  /** Wall-clock tick counter, useful for diagnostics. */
  frame: number;
}

/**
 * Allocate a live AVM1 cast instance for an already-loaded spell SWF
 * bundle. Subsequent host-var sets + `tickSpellFrame` calls reference
 * this id. Returns 0 on failure (bundle missing, degenerate bounds,
 * texture-size cap exceeded).
 */
export function createSwfSpellInstance(
  bundle: string,
  resolution: number
): number {
  if (!renderer || isHalted()) {
    return 0;
  }
  const id = renderer.createSwfSpellInstance(bundle, resolution);
  if (id !== 0 && !liveSpellInstanceIds.has(id)) {
    liveSpellInstanceIds.add(id);
    try {
      getRenderWatchdog().registerTextureCreated(`swfSpellInstance:${bundle}`);
    } catch {
      // ignore
    }
  }
  return id;
}

/** Inject `{x, y}` into the spell's AVM1 root vars (typically
 *  `cellFrom` / `cellTo`). Must be called before the first tick. */
export function setSwfSpellHostCell(
  instanceId: number,
  name: string,
  x: number,
  y: number
): void {
  renderer?.setSwfSpellHostCell(instanceId, name, x, y);
}

/** Inject a numeric host var (typically `level` / `angle`). */
export function setSwfSpellHostNumber(
  instanceId: number,
  name: string,
  value: number
): void {
  renderer?.setSwfSpellHostNumber(instanceId, name, value);
}

/**
 * Tick AVM1 by one frame, render the new state into the cast's
 * pre-allocated output texture. Returns null if the instance id is
 * unknown or rendering failed.
 */
export function tickSwfSpellFrame(
  instanceId: number
): VelloSpellTickResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.tickSwfSpellFrame(instanceId);
  return (result as VelloSpellTickResult | null) ?? null;
}

/** Free the AVM1 cast instance + its GPU texture. */
export function disposeSwfSpellInstance(instanceId: number): void {
  renderer?.disposeSwfSpellInstance(instanceId);
  if (liveSpellInstanceIds.delete(instanceId)) {
    try {
      getRenderWatchdog().registerTextureFreed("swfSpellInstance");
    } catch {
      // ignore
    }
  }
}

export interface VelloSwfSpellStripResult {
  /** Bridge path — Vello pixels delivered as ImageBitmap. */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  gridCols: number;
  frameCount: number;
  anchorX: number;
  anchorY: number;
  fps: number;
}

/**
 * Run the AVM1 emulator across a spell SWF's main timeline (longest
 * `DefineSprite`) and pack every tick → render → advance frame into ONE
 * 2D-grid composite texture. Replaces the dofasset spell strip bake —
 * AS2 side-effects (`gotoAndStop`, `_alpha` fades, `_rotation += dx`)
 * drive the pixels at runtime instead of being captured at compile time.
 */
export function renderSwfSpellStrip(
  bundle: string,
  resolution: number
): VelloSwfSpellStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfSpellStrip(bundle, resolution);
  return (result as VelloSwfSpellStripResult | null) ?? null;
}

/**
 * Compose a spell hotbar icon by overlaying three flat-fill-tinted SWF
 * symbols (disc + frame + glyph) into ONE Vello dispatch. Mirrors the
 * legacy `tools/asset-pipeline/.../compileSpellIcons.ts` pipeline that
 * pre-baked the same composition into per-spell `.dofasset` files —
 * but applied at render time, no bake step needed.
 *
 * - `backBundle` must hold a SWF with `_spellBackground` + `_spellFrame`
 *   named exports (`/swf/spells/icons/back/<b>.swf`).
 * - `upBundle` is the SWF whose root timeline is the glyph
 *   (`/swf/spells/icons/up/<up>.swf`).
 * - Tints are `0xRRGGBB` packed; the WASM converts each into a flat-fill
 *   `OwnedColorTransform` (RGB ← target, alpha preserved).
 */
export function renderSwfSpellIcon(
  backBundle: string,
  upBundle: string,
  bcRgb: number,
  fcRgb: number,
  pcRgb: number,
  resolution: number
): VelloSwfFrameResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfSpellIcon(
    backBundle,
    upBundle,
    bcRgb,
    fcRgb,
    pcRgb,
    resolution
  );
  return (result as VelloSwfFrameResult | null) ?? null;
}

/**
 * Classify a multi-frame SWF tile sprite as "animated", "random", "slope",
 * or "" (static / unknown). See vello_wasm.d.ts for the underlying rule.
 */
export function swfTileAnimKind(
  bundle: string,
  exportName: string
): "" | "animated" | "random" | "slope" {
  if (!renderer) {
    return "";
  }
  const kind = renderer.swfTileAnimKind(bundle, exportName);
  if (kind === "animated" || kind === "random" || kind === "slope") {
    return kind;
  }
  return "";
}

/** Frames-per-second from the SWF header (12 / 40 / 60 typical). */
export function swfBundleFrameRate(bundle: string): number {
  if (!renderer) {
    return 0;
  }
  return renderer.swfBundleFrameRate(bundle);
}

/** Frame count of the deepest animation reachable from this export. */
export function swfAnimFrameCount(bundle: string, exportName: string): number {
  if (!renderer) {
    return 0;
  }
  return renderer.swfAnimFrameCount(bundle, exportName);
}

/**
 * True if any placement in the export's symbol tree carries a filter
 * (DropShadow / Glow / Blur / ColorMatrix). Filter-bearing exports must
 * skip `renderSwfBundleBatch` — the halo fallback emits many extra
 * renders per filter, and clustering them into one batch scene blows
 * Vello's tile encoder budget and silently drops strokes.
 */
export function swfExportHasFilters(
  bundle: string,
  exportName: string
): boolean {
  if (!renderer) {
    return false;
  }
  return renderer.swfExportHasFilters(bundle, exportName);
}

/**
 * Set the player's three zone colours used by `renderSwfFrame` for the next
 * render. Each value is `0xRRGGBB`; pass `0` to leave a zone untinted.
 */
export function setSwfPlayerColors(c1: number, c2: number, c3: number): void {
  renderer?.setSwfPlayerColors(c1, c2, c3);
}

export interface VelloSwfStripResult {
  /** Bridge: composite delivered to Pixi as ImageBitmap. */
  bitmap: ImageBitmap;
  /** Composite texture's full pixel dims. */
  width: number;
  height: number;
  /** Per-cell pixel dims (uniform across all frames). */
  frameWidth: number;
  frameHeight: number;
  /** Number of cells per row in the 2D grid. */
  gridCols: number;
  /** Number of valid frames (may be less than `requestedFrameCount`). */
  frameCount: number;
  /** Position of the SWF (0,0) origin within each cell — same for all frames. */
  anchorX: number;
  anchorY: number;
}

/**
 * Render `requestedFrameCount` consecutive frames of an export as a 2D-grid
 * strip in ONE Vello dispatch. Caller slices the composite into per-frame
 * Pixi sub-rectangles. Stops at the first degenerate frame.
 */
export function renderSwfStrip(
  bundle: string,
  exportName: string,
  requestedFrameCount: number,
  resolution: number
): VelloSwfStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfStrip(
    bundle,
    exportName,
    requestedFrameCount,
    resolution
  );
  return (result as VelloSwfStripResult | null) ?? null;
}

/**
 * Render a contiguous frame window `[start, start + count)` of an export as
 * a 2D-grid strip in ONE Vello dispatch, while keeping per-cell anchors
 * uniform with all other windows of the SAME `totalFrameCount`. Use to
 * split long animations (>~60 frames of typical tile geometry) into
 * multiple chunk textures so each Vello scene stays under the
 * tile-encoder budget — without this, long anims silently drop strokes
 * (per the `Vello tile-encoder overflows` memory note) and stall the
 * prefetch pass for several hundred ms.
 *
 * Pass the same `totalFrameCount` for every chunk of one animation; the
 * Rust side computes the bounds union over that full range so anchor +
 * frame_w/frame_h match across chunks. Per-frame Pixi Textures from
 * different chunks share neither texture nor source but DO land at the
 * exact same world-space anchor — frames at chunk seams animate
 * seamlessly.
 */
export function renderSwfStripRange(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number
): VelloSwfStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfStripRange(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution
  );
  return (result as VelloSwfStripResult | null) ?? null;
}


export interface AccessoryRenderEntry {
  /** AS2 mount slot id matching `applyAccessory(this, slot, side)`. */
  slot: number;
  /** Bundle name where the accessory SWF was loaded. */
  bundle: string;
  /** Export name within that bundle (typically `"<type>_<gfxId>"`). */
  exportName: string;
  /**
   * Animation classification for the character: 0=static, 1=walk,
   * 2=run. Selects which slot-specific direction fallback table the
   * renderer walks. Per-character-frame cycling within the chosen
   * direction is handled by the Rust side; the caller doesn't pick a
   * specific accessory frame.
   */
  animType: number;
}

/**
 * Same as `renderSwfStripRange` but composes accessory SWFs at the
 * base character's body part mount points. Each accessory entry has
 * its own (slot, bundle, exportName, animType). The Rust renderer
 * pulls mounts out of the loaded base bundle's `accessory_mounts`
 * cache (built from `applyAccessory` AS2 calls at SWF load time),
 * matches by slot, and resolves the accessory's frame per character
 * frame using the body part's mount-declared `side` plus the
 * canonical Dofus direction truth table.
 */
export function renderSwfStripRangeAccessorized(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number,
  accessories: AccessoryRenderEntry[],
  /**
   * Direction-suffix character ('R'|'L'|'S'|'F'|'B') the WASM uses
   * for slot-3 (pet) named-export resolution + accessory frame-label
   * lookup. Pulled from the export name's last char (`walkR` → 'R').
   */
  charDirSuffix: string,
  /**
   * True when the caller will follow this render with a JS-side
   * `sprite.scale.x = -1` (canonical Dofus directions 3/4/7 —
   * SW/W/NE). Triggers the bFix body-part X-mirror so accessories
   * with `b_fix=true` mounts (capes, shields) end up on the
   * canonical side after the JS flip is applied.
   */
  applyBFix: boolean
): VelloSwfStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const slots = new Uint32Array(accessories.length);
  const bundles: string[] = [];
  const exports: string[] = [];
  const animTypes = new Uint32Array(accessories.length);
  for (let i = 0; i < accessories.length; i++) {
    slots[i] = accessories[i].slot >>> 0;
    bundles.push(accessories[i].bundle);
    exports.push(accessories[i].exportName);
    animTypes[i] = accessories[i].animType >>> 0;
  }
  const result = renderer.renderSwfStripRangeAccessorized(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution,
    slots,
    bundles,
    exports,
    animTypes,
    charDirSuffix,
    applyBFix
  );
  return (result as VelloSwfStripResult | null) ?? null;
}

// ─── Path B body-band rasteriser ──────────────────────────────────────────
// Slices the body display list into Z-ordered bands at accessory-mount
// depths. Each band caches independently of player tint + accessory
// loadout — bots of the same class share the same body strips at steady
// state. See `RENDER_SCALING_PLAN.md`.

export interface VelloSwfBodyBandInfo {
  /** Number of (slot, depth) mounts in this export at frame 0. */
  slotCount: number;
  /** Total Z-ordered bands. Always `slotCount + 1`. Stack bands 0..N-1
   *  bottom-up; the slot at index i sits between band i and band i+1. */
  bandCount: number;
  /** Sorted by depth ascending. `side` is the canonical AS2
   *  `applyAccessory(this, slot, side)` argument — JS MUST use this
   *  string verbatim (not the bot's facing `dir`) when baking the
   *  accessory strip. `null` when the body's mount declaration
   *  omitted the side string. */
  slots: Array<{ slot: number; depth: number; side: string | null }>;
  /** True when at least one accessory mount declares `b_fix=true`.
   *  When false the body bake is pixel-identical regardless of the
   *  `applyBFix` flag — the cache layer collapses both variants into
   *  one entry, halving bake count on this class. */
  bFixUsed: boolean;
  /** True if this body's display tree contains a multi-frame sprite
   *  whose frames swap children (canonical AS2 `mcToHide` pattern,
   *  e.g. Iop's hair toggle). When false, `hatEquipped` doesn't
   *  affect the bake — the cache layer collapses both variants into
   *  one entry, halving body atlas footprint for non-toggle
   *  classes. */
  hasToggleSprite: boolean;
}

export function swfBodyBandInfo(
  bundle: string,
  exportName: string,
): VelloSwfBodyBandInfo | null {
  if (!renderer) return null;
  const result = renderer.swfBodyBandInfo(bundle, exportName);
  return (result as VelloSwfBodyBandInfo | null) ?? null;
}

export interface VelloSwfBodyAtlasBand {
  bandIndex: number;
  /** Top-left of this band's sub-rect inside the variant atlas. */
  atlasX: number;
  atlasY: number;
}

export interface VelloSwfBodyAtlasResult {
  /** Single combined RGBA8 bitmap for ONE variant of a body export.
   *  Used as a per-variant fallback when the class atlas doesn't
   *  cover the requested anim (rare anims like die/cast/hit). */
  combinedBitmap: ImageBitmap;
  atlasWidth: number;
  atlasHeight: number;
  stripWidth: number;
  stripHeight: number;
  frameWidth: number;
  frameHeight: number;
  gridCols: number;
  frameCount: number;
  anchorX: number;
  anchorY: number;
  bandCount: number;
  slotCount: number;
  bands: VelloSwfBodyAtlasBand[];
  bandPadding: number;
}

/**
 * Per-variant body atlas bake. Renders ONE animation variant into a
 * single combined Rgba8Unorm bitmap. Used as the on-demand fallback
 * for anims not covered by `renderSwfClassAtlas` (which only bakes
 * static/walk/run). Result shape matches the class atlas per-variant
 * sub-rect so the renderer treats both paths through the same
 * `ClassAtlas + VariantInfo` plumbing.
 */
export function renderSwfBodyAtlas(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number,
  applyBFix: boolean,
  hatEquipped: boolean,
): VelloSwfBodyAtlasResult | null {
  if (!renderer || isHalted()) return null;
  const result = renderer.renderSwfBodyAtlas(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution,
    applyBFix,
    hatEquipped,
  );
  const r = (result as Record<string, unknown> | null) ?? null;
  if (!r) return null;
  const rawBands = (r.bands as Array<Record<string, unknown>>) ?? [];
  const bands: VelloSwfBodyAtlasBand[] = rawBands.map((b) => ({
    bandIndex: Number(b.bandIndex),
    atlasX: Number(b.atlasX),
    atlasY: Number(b.atlasY),
  }));
  return {
    combinedBitmap: r.combinedBitmap as ImageBitmap,
    atlasWidth: Number(r.atlasWidth),
    atlasHeight: Number(r.atlasHeight),
    stripWidth: Number(r.stripWidth),
    stripHeight: Number(r.stripHeight),
    frameWidth: Number(r.frameWidth),
    frameHeight: Number(r.frameHeight),
    gridCols: Number(r.gridCols),
    frameCount: Number(r.frameCount),
    anchorX: Number(r.anchorX),
    anchorY: Number(r.anchorY),
    bandCount: Number(r.bandCount),
    slotCount: Number(r.slotCount),
    bands,
    bandPadding: Number(r.bandPadding),
  };
}

export interface VelloSwfClassAtlasBand {
  bandIndex: number;
  /** ABSOLUTE coordinates inside the class atlas (variant origin
   *  plus per-band intra-variant offset). The body-band shader's UV
   *  math uses these directly with the class atlas's full dims. */
  atlasX: number;
  atlasY: number;
}

export interface VelloSwfClassAtlasVariant {
  /** SWF export name carrying this variant's animation, e.g. `walkR`. */
  exportName: string;
  /** Whether the variant was baked with `applyBFix=true`. Classes
   *  whose mounts don't carry b_fix carry only the `false` baking;
   *  caller normalises lookups via the class-level `bFixUsed` flag. */
  applyBFix: boolean;
  /** Whether the variant was baked with `hatEquipped=true`. Same
   *  collapse rule as `applyBFix` — only classes with a toggle
   *  sprite (canonical 1.29: just Iop) carry the second dimension. */
  hatEquipped: boolean;
  /** Class atlas page index this variant lives on. Multi-page
   *  fallback when total variant area exceeds a single 8192². */
  pageIndex: number;
  /** Origin of the variant's sub-rect inside the page atlas. */
  atlasX: number;
  atlasY: number;
  /** Single-band strip dims (every band of this variant has the same
   *  width × height inside the variant sub-rect). */
  stripWidth: number;
  stripHeight: number;
  /** Per-cell dims inside a band. */
  frameWidth: number;
  frameHeight: number;
  gridCols: number;
  /** Number of valid anim frames in this variant. */
  frameCount: number;
  /** Total animation frame count (matches `swfAnimFrameCount`); JS
   *  uses this when building cache keys / for stale comparisons. */
  totalFrameCount: number;
  /** SWF (0,0) anchor inside each cell. Absolute coordinates inside
   *  the page atlas — caller's UV math uses the page's dims. */
  anchorX: number;
  anchorY: number;
  bandPadding: number;
  bandCount: number;
  slotCount: number;
  bands: VelloSwfClassAtlasBand[];
  /**
   * Pre-baked silhouette for pixel-perfect picking. Populated by the
   * bake worker (`bake-worker.ts:handleBake`) so the main thread
   * doesn't pay the ~30-40ms `OffscreenCanvas + getImageData` cost
   * per page. The main-thread direct path
   * (`renderSwfClassAtlas` here) leaves this undefined — wrapping
   * code (`character-cache.ts:wrapClassAtlas`) lazily extracts on
   * the main thread for that fallback.
   */
  silhouette?: Uint8Array;
}

export interface VelloSwfClassAtlasPage {
  /** One bitmap per page. RGB + packed alpha — same encoding the
   *  body-band shader expects (LINEAR sampler + NEAREST sampler). */
  combinedBitmap: ImageBitmap;
  atlasWidth: number;
  atlasHeight: number;
}

export interface VelloSwfClassAtlasResult {
  /** One page per logical chunk of the class atlas. Most classes
   *  fit in `pages.length === 1`; high-frame classes spill onto
   *  additional pages. Variant lookups carry `pageIndex` to pick the
   *  right page texture. */
  pages: VelloSwfClassAtlasPage[];
  /** True if the bundle has any mount declaring `b_fix=true`. */
  bFixUsed: boolean;
  variants: VelloSwfClassAtlasVariant[];
}

/**
 * One-shot class atlas bake: pack EVERY animation variant of a body
 * bundle into a single Rgba8Unorm texture bridged as one ImageBitmap.
 * Replaces the per-variant `renderSwfBodyAtlas` plus JS-side blit-
 * to-class-page composition. See `RENDER_CLASS_ATLAS_PLAN.md`.
 */
export function renderSwfClassAtlas(
  bundle: string,
  resolution: number,
): VelloSwfClassAtlasResult | null {
  if (!renderer || isHalted()) return null;
  const t0 = performance.now();
  const r = renderer.renderSwfClassAtlas(bundle, resolution);
  recordProbe("classAtlas", performance.now() - t0);
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const rawPages = (o.pages as Array<Record<string, unknown>>) ?? [];
  const pages: VelloSwfClassAtlasPage[] = rawPages.map((p) => ({
    combinedBitmap: p.combinedBitmap as ImageBitmap,
    atlasWidth: Number(p.atlasWidth),
    atlasHeight: Number(p.atlasHeight),
  }));
  const rawVariants = (o.variants as Array<Record<string, unknown>>) ?? [];
  const variants: VelloSwfClassAtlasVariant[] = rawVariants.map((v) => {
    const rawBands = (v.bands as Array<Record<string, unknown>>) ?? [];
    const bands: VelloSwfClassAtlasBand[] = rawBands.map((b) => ({
      bandIndex: Number(b.bandIndex),
      atlasX: Number(b.atlasX),
      atlasY: Number(b.atlasY),
    }));
    return {
      exportName: String(v.exportName),
      applyBFix: Boolean(v.applyBFix),
      hatEquipped: Boolean(v.hatEquipped),
      pageIndex: Number(v.pageIndex),
      atlasX: Number(v.atlasX),
      atlasY: Number(v.atlasY),
      stripWidth: Number(v.stripWidth),
      stripHeight: Number(v.stripHeight),
      frameWidth: Number(v.frameWidth),
      frameHeight: Number(v.frameHeight),
      gridCols: Number(v.gridCols),
      frameCount: Number(v.frameCount),
      totalFrameCount: Number(v.totalFrameCount),
      anchorX: Number(v.anchorX),
      anchorY: Number(v.anchorY),
      bandPadding: Number(v.bandPadding),
      bandCount: Number(v.bandCount),
      slotCount: Number(v.slotCount),
      bands,
    };
  });
  return {
    pages,
    bFixUsed: Boolean(o.bFixUsed),
    variants,
  };
}

export interface VelloSwfAccessoryStripResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Per sub-frame cell dimensions (uniform across all 3). */
  frameWidth: number;
  frameHeight: number;
  /** Always 3 — accessory cycles `char_frame % 3` per game tick. */
  frameCount: number;
  gridCols: number;
  /** Position of the accessory's (0,0) origin within each cell. */
  anchorX: number;
  anchorY: number;
}

/**
 * Bake an accessory's 3 directional sub-frames into a single
 * 3-wide × 1-tall strip at the accessory's OWN origin. The Pixi
 * compositor positions the sprite per-frame via the body's
 * mount-transform table. Cycle frame at runtime via
 * `frames[(char_frame % 3)]`.
 *
 * `side` defaults to `dir`; pass the body's mount-declared side
 * directly (e.g. `"WR"`) to opt into canonical labelled walking
 * frames for capes/shields.
 */
export function renderSwfAccessoryStrip(
  accBundle: string,
  accExport: string,
  slot: number,
  animType: number,
  dir: string,
  side: string,
  resolution: number,
): VelloSwfAccessoryStripResult | null {
  if (!renderer || isHalted()) return null;
  const t0 = performance.now();
  const result = renderer.renderSwfAccessoryStrip(
    accBundle,
    accExport,
    slot >>> 0,
    animType >>> 0,
    dir,
    side,
    resolution,
  );
  recordProbe("accessoryStrip", performance.now() - t0);
  return (result as VelloSwfAccessoryStripResult | null) ?? null;
}

export interface VelloSwfMountTransformsResult {
  /**
   * Affine matrix table, length `count * maxSlot * 6`. Layout per
   * (frame, slot): `[a, b, c, d, tx, ty]`. Translations in TWIP
   * space — multiply by `resolution / 20` for pixel space. Identity
   * matrix where the body has no mount at that frame; consult
   * `presence` to know whether the matrix entry is valid.
   */
  matrices: Float32Array;
  /**
   * Per-(frame, slot) presence bitmap, length `count * maxSlot`.
   * `1` = body's display list places a mount of that slot at that
   * frame, `0` = no mount (accessory must be hidden). This is the
   * canonical signal — JS MUST NOT infer presence from matrix
   * contents.
   */
  presence: Uint8Array;
}

let warnedOldMountTransformShape = false;

/**
 * CPU-only mount-transform extraction. Returns both the matrix
 * table and the per-frame presence bitmap. See
 * `VelloSwfMountTransformsResult` for layout.
 *
 * Detects the OLD wasm shape (bare `Float32Array`) and emits a loud
 * one-shot console error — without the presence array we have no
 * way to do canonical accessory rendering, so this path returns
 * null which surfaces visually as "accessories don't move." If you
 * see that error: run `just wasm` to rebuild the Rust bindings.
 */
export function renderSwfMountTransforms(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  applyBFix: boolean,
  maxSlot: number,
): VelloSwfMountTransformsResult | null {
  if (!renderer) return null;
  const t0 = performance.now();
  const raw = renderer.renderSwfMountTransforms(
    bundle,
    exportName,
    start >>> 0,
    count >>> 0,
    applyBFix,
    maxSlot >>> 0,
  );
  recordProbe("mountTransforms", performance.now() - t0);
  if (!raw) return null;
  // Stale wasm: detect the legacy Float32Array shape so the failure
  // mode is obvious (accessories appearing static/disconnected). The
  // ArrayBuffer view check is robust against being marshaled across
  // a wasm-bindgen boundary.
  if (raw instanceof Float32Array || ArrayBuffer.isView(raw)) {
    if (!warnedOldMountTransformShape) {
      warnedOldMountTransformShape = true;
      console.error(
        "[vello-loader] renderSwfMountTransforms returned the legacy " +
          "Float32Array shape. Your wasm bundle is older than the Rust " +
          "source. Rebuild with: `just wasm` (or `cd rust/vello-wasm && " +
          "wasm-pack build --target web --release`). Accessories will " +
          "render static + disconnected until you do.",
      );
    }
    return null;
  }
  if (typeof raw !== "object") return null;
  const r = raw as {
    matrices?: Float32Array;
    presence?: Uint8Array;
  };
  if (!r.matrices || !r.presence || r.matrices.length === 0) return null;
  return { matrices: r.matrices, presence: r.presence };
}

export interface VelloSwfStaticBaseResult {
  /** Bridge: Vello pixels delivered as ImageBitmap. */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

/**
 * Bridged tile dynamic strip — returned by
 * `renderSwfTileDynamicStripRange`. Differs from `VelloSwfStripResult`
 * (the still-direct-GPU character strip path) in that pixels arrive as
 * an `ImageBitmap` instead of a `GPUTexture`.
 */
export interface VelloSwfTileStripResult {
  bitmap: ImageBitmap;
  /** Composite texture's full pixel dims. */
  width: number;
  height: number;
  /** Per-cell pixel dims (uniform across all frames). */
  frameWidth: number;
  frameHeight: number;
  /** Number of cells per row in the 2D grid. */
  gridCols: number;
  /** Number of valid frames (may be less than `requestedFrameCount`). */
  frameCount: number;
  /** SWF (0,0) origin position within each cell. */
  anchorX: number;
  anchorY: number;
}

/**
 * Render the STATIC parts of a multi-frame tile export at the FULL
 * animation's union bounds. Returns one texture sized identically to a
 * `renderSwfTileDynamicStripRange` cell, so the two compose
 * pixel-perfectly when stacked at the same anchor. Encodes only depths
 * whose placement data is constant across the timeline AND whose placed
 * character has no multi-frame sub-tree.
 */
export function renderSwfTileStaticBase(
  bundle: string,
  exportName: string,
  totalFrameCount: number,
  resolution: number
): VelloSwfStaticBaseResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfTileStaticBase(
    bundle,
    exportName,
    totalFrameCount,
    resolution
  );
  return (result as VelloSwfStaticBaseResult | null) ?? null;
}

/**
 * Render the DYNAMIC parts of a multi-frame tile across a contiguous
 * frame range. Output is a strip texture at the FULL animation's union
 * bounds (same canvas size as `renderSwfTileStaticBase`). Each cell
 * contains ONLY the placements whose data varies across frames OR whose
 * placed character has multi-frame sub-trees — static placements are
 * skipped because they already live on the static base.
 */
export function renderSwfTileDynamicStripRange(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number
): VelloSwfTileStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfTileDynamicStripRange(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution
  );
  return (result as VelloSwfTileStripResult | null) ?? null;
}

export interface VelloSwfBundleBatchResult {
  /** Bridge: composite delivered to Pixi as ImageBitmap. */
  bitmap: ImageBitmap;
  /** Composite texture's full pixel dims. */
  width: number;
  height: number;
  /** Per-item parallel arrays — index by export position passed in. */
  itemX: Uint32Array;
  itemY: Uint32Array;
  itemW: Uint32Array;
  itemH: Uint32Array;
  itemAnchorX: Float64Array;
  itemAnchorY: Float64Array;
  /** 1 = rendered, 0 = export missing or degenerate bounds. */
  itemValid: Uint8Array;
}

/**
 * Render multiple exports of one bundle at the same frame as a shelf-packed
 * composite in ONE Vello dispatch. Caller groups tiles by bundle and slices
 * the composite into per-tile sub-rectangles using the parallel `item*`
 * arrays.
 */
export function renderSwfBundleBatch(
  bundle: string,
  exports: string[],
  frame: number,
  resolution: number
): VelloSwfBundleBatchResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfBundleBatch(
    bundle,
    exports,
    frame,
    resolution
  );
  return (result as VelloSwfBundleBatchResult | null) ?? null;
}


/**
 * Drop the GPU storage backing a previously-allocated tile-pass texture.
 * Pixi may still hold a reference to the GPUTexture handle until its
 * frame upload finishes, so the GPU storage is released by the wgpu side
 * dropping its `wgpu::Texture` (the JS GPUTexture handle remains valid
 * for the rest of the current Pixi frame).
 */
export function freeRenderTexture(textureId: number): void {
  if (!renderer) {
    return;
  }
  renderer.freeRenderTexture(textureId);
  if (liveRenderTextureIds.delete(textureId)) {
    try {
      getRenderWatchdog().registerTextureFreed("renderTexture");
    } catch {
      // ignore
    }
  }
}

/**
 * Step-11 deferred-destroy tick. Calls into the patched wgpu fork's
 * pending-destroy queue: advances its frame counter and calls
 * `GPUTexture.destroy()` / `GPUBuffer.destroy()` on every Rust-side
 * wgpu resource that was dropped at least `minAgeFrames` ticks ago
 * (past WebGPU's submission completion window).
 *
 * Returns `[texturesDestroyed, buffersDestroyed, texturesPending,
 * buffersPending]` so callers can log queue health.
 *
 * `maxDestroysPerTick` caps the per-tick destroy count to avoid
 * stalling a single rAF when a burst (anim transition / cache
 * eviction) leaves the queue deep.
 */
export interface DeferredDestroyStats {
  texturesDestroyed: number;
  buffersDestroyed: number;
  texturesPending: number;
  buffersPending: number;
}

/**
 * Session-wide cumulative destroy counters. Each `tickDeferredDestroys`
 * call adds its per-tick destroys here so the monitor can report
 * totals + rates over the whole stress run.
 */
let cumulativeTexturesDestroyed = 0;
let cumulativeBuffersDestroyed = 0;
let lastTickTexturesPending = 0;
let lastTickBuffersPending = 0;

export function tickDeferredDestroys(
  minAgeFrames = 2,
  maxDestroysPerTick = 256,
): DeferredDestroyStats | null {
  if (!renderer) return null;
  const r = renderer as unknown as {
    tickDeferredDestroys(min: number, max: number): Uint32Array;
  };
  const out = r.tickDeferredDestroys(minAgeFrames, maxDestroysPerTick);
  const td = out[0] ?? 0;
  const bd = out[1] ?? 0;
  const tp = out[2] ?? 0;
  const bp = out[3] ?? 0;
  cumulativeTexturesDestroyed += td;
  cumulativeBuffersDestroyed += bd;
  lastTickTexturesPending = tp;
  lastTickBuffersPending = bp;
  return {
    texturesDestroyed: td,
    buffersDestroyed: bd,
    texturesPending: tp,
    buffersPending: bp,
  };
}

/**
 * Aggregate deferred-destroy stats for the monitor log. Returns
 * cumulative destroyed counts since renderer init plus the latest
 * pending queue depths.
 */
export function getDeferredDestroyStats(): {
  cumulativeTexturesDestroyed: number;
  cumulativeBuffersDestroyed: number;
  texturesPending: number;
  buffersPending: number;
} {
  return {
    cumulativeTexturesDestroyed,
    cumulativeBuffersDestroyed,
    texturesPending: lastTickTexturesPending,
    buffersPending: lastTickBuffersPending,
  };
}

/**
 * Byte-granularity GPU memory accounting from the patched-wgpu fork.
 *
 * - `liveTex` / `liveBuf`: GPU bytes currently allocated and not yet
 *   destroyed. Closest match to "what the GPU process still holds for
 *   Rust-allocated resources".
 * - `createdTex` / `createdBuf`: cumulative bytes ever created.
 * - `destroyedTex` / `destroyedBuf`: cumulative bytes destroyed (via
 *   `destroy()` from either an explicit path or the deferred queue).
 * - `pendingTex` / `pendingBuf`: bytes currently sitting in the
 *   deferred-destroy queue waiting for their 2-tick settle.
 *
 * Used by the stress monitor to compute `live = created - destroyed`
 * and identify whether the unaccounted-for process memory comes from
 * Rust-side wgpu objects or somewhere else (Pixi, JS heap, browser
 * overhead).
 */
/**
 * Schedule `bitmap.close()` for after Pixi has uploaded the source
 * to its own GPUTexture (or until the source is destroyed by cache
 * eviction, whichever happens first).
 *
 * Hard constraint discovered through real stress runs: NEVER
 * force-close on a timeout. Pixi uploads sources lazily — only on
 * the first draw that samples them. The mesh that uses the source
 * may be off-screen, culled, or attached to the scene graph in a
 * tick that follows Pixi's render in the same rAF window. Any
 * timer-driven close races those cases and produces:
 *   `Failed to execute 'copyExternalImageToTexture': External
 *    Image has been detached` on the eventual upload.
 *
 * Two-signal close protocol:
 *
 *   1. **Poll `source._gpuData`** every rAF. Pixi sets
 *      `_gpuData[renderer.uid] = new GPUTextureGpuData(gpuTexture)`
 *      synchronously inside `_initSource` (immediately before
 *      `onSourceUpdate` runs the actual upload). Any populated key
 *      = upload has happened, bitmap is safe to close.
 *
 *   2. **`source.once("destroy", ...)`** — listens for the cache's
 *      retire path (`Texture.destroy(true)` cascades into
 *      `source.destroy()` which emits "destroy"). If the source
 *      gets evicted before Pixi ever rendered it, we still need to
 *      release the bitmap buffer.
 *
 * Polling cap: 60 rAFs. After that we STOP polling but do NOT
 * close — the destroy handler picks it up at eviction time. This
 * avoids the timeout-race crash AND avoids polling forever on
 * orphaned sources.
 *
 * Worst case (source never rendered, never destroyed): the bitmap
 * stays alive until something explicitly closes it. In practice
 * every cached source is eventually evicted, so the destroy
 * handler always fires. The pre-eviction window holds the bitmap
 * memory but the typical lifecycle is sub-second.
 */
/**
 * Synchronously upload `source` to `renderer`'s GPUTexture, then
 * close the bitmap. Deterministic, race-free.
 *
 * Why the renderer must be passed explicitly:
 *
 *   Pixi v8 tracks per-renderer state in `source._gpuData[renderer.uid]`.
 *   A source attached to a battlefield mesh is uploaded only when
 *   the BATTLEFIELD renderer first draws it; a source attached to
 *   a minimap sprite is uploaded only by the MINIMAP renderer; etc.
 *
 *   Previous polling/heuristic attempts watched `_gpuData` for ANY
 *   populated key as "uploaded; safe to close". That assumption is
 *   wrong on two axes:
 *     - Multi-renderer apps: source uploaded by renderer A doesn't
 *       mean it's been uploaded by renderer B.
 *     - Pixi's `GCManagedHash.remove(source)` (triggered by source
 *       "unload" event, internal Pixi cleanup, or context-loss
 *       recovery) sets `_gpuData[uid] = null`. The next draw of
 *       that source falls back into `_initSource` → upload →
 *       `copyExternalImageToTexture(source.resource)` → bitmap was
 *       closed → "External Image has been detached" crash.
 *
 *   Real stress test: deferred polling produced this crash after
 *   ~50s of stable runtime. Force-upload makes the close window
 *   the same synchronous tick as the upload — no race with later
 *   re-init.
 *
 * The cost: each bake finalisation now does one synchronous
 * `device.queue.copyExternalImageToTexture` call instead of letting
 * Pixi lazy-upload during its first draw of the source. At steady
 * state (3-10 bakes/sec post-acc-dedup) this is trivially cheap.
 * At warmup peak (~40 bakes/sec) it's ~40 GPU API calls/sec —
 * negligible compared to the bake's Vello compute work.
 *
 * Additional win: the previous pending-bitmap-close Set was being
 * walked every rAF. As source count grew over time, per-frame
 * poll cost grew linearly — likely contributor to the
 * "fps degrades over time" symptom even at stable cache size.
 * Force-upload removes that per-frame cost entirely.
 */
export function uploadAndCloseBitmap(
  renderer: object | null | undefined,
  source: object,
  bitmap: ImageBitmap | null | undefined,
): void {
  if (!bitmap) return;
  // CRITICAL: Pixi 8.17's `ImageSource` constructor hardcodes
  // `this.autoGarbageCollect = true` AFTER `super(options)`, silently
  // discarding the `autoGarbageCollect: false` every caller passes.
  // That makes these cache-managed sources eligible for Pixi's
  // `GCSystem`, which unloads (destroys the GPUTexture for) a source
  // that hasn't rendered within `gcMaxUnusedTime`. When a bot despawns
  // or switches variant, its body-atlas source goes idle, the GC tears
  // down its GPUTexture, and the next draw re-uploads from `resource` —
  // but we eagerly `.close()` the bitmap below, so the re-upload reads a
  // DETACHED ImageBitmap and throws `copyExternalImageToTexture ...
  // External Image has been detached`, which fails the ENTIRE
  // composition page render (screen-wide flash + per-frame warn storm).
  // Re-assert the intended flag so the cache LRU — not Pixi's GC — owns
  // these sources' lifetime; then the closed bitmap is never re-read.
  try {
    (source as { autoGarbageCollect?: boolean }).autoGarbageCollect = false;
  } catch {
    // Frozen/incompatible source — fall through; close path below still
    // defers to destroy if the eager upload doesn't take.
  }
  let uploaded = false;
  if (renderer) {
    try {
      const sys = (renderer as {
        texture?: { initSource?: (s: unknown) => unknown };
      }).texture;
      if (sys && typeof sys.initSource === "function") {
        // Synchronous: by the time this returns Pixi has called
        // `copyExternalImageToTexture` against the bitmap. The
        // GPUTexture is populated and `_gpuData[renderer.uid]` is
        // set, so subsequent draws of this source hit the cached
        // GPUTexture path and never re-read `source.resource`.
        sys.initSource(source);
        uploaded = true;
      }
    } catch {
      // Renderer not ready, version mismatch, etc. — fall through.
    }
  }
  if (uploaded) {
    try {
      bitmap.close();
    } catch {
      // Already closed or platform-not-supported — fine.
    }
    return;
  }
  // Fallback path: caller didn't pass a renderer (e.g. worker
  // context, or renderer not yet initialised). Defer close to the
  // source's destroy event — bitmap stays alive until cache
  // eviction destroys the source. Conservative but safe; the
  // bitmap memory regression is bounded by the LRU cap.
  const evt = source as {
    once?: (event: string, handler: () => void) => void;
  };
  if (typeof evt.once === "function") {
    try {
      evt.once("destroy", () => {
        try {
          bitmap.close();
        } catch {}
      });
    } catch {
      // Best effort — bitmap will be GC'd when its source is.
    }
  }
}

export function getRustGpuByteStats(): {
  liveTex: number;
  liveBuf: number;
  createdTex: number;
  createdBuf: number;
  destroyedTex: number;
  destroyedBuf: number;
  pendingTex: number;
  pendingBuf: number;
} {
  if (!renderer) {
    return {
      liveTex: 0,
      liveBuf: 0,
      createdTex: 0,
      createdBuf: 0,
      destroyedTex: 0,
      destroyedBuf: 0,
      pendingTex: 0,
      pendingBuf: 0,
    };
  }
  const r = renderer as unknown as { rustGpuByteStats(): Float64Array };
  let out: Float64Array;
  try {
    out = r.rustGpuByteStats();
  } catch {
    return {
      liveTex: 0,
      liveBuf: 0,
      createdTex: 0,
      createdBuf: 0,
      destroyedTex: 0,
      destroyedBuf: 0,
      pendingTex: 0,
      pendingBuf: 0,
    };
  }
  return {
    liveTex: out[0] ?? 0,
    liveBuf: out[1] ?? 0,
    createdTex: out[2] ?? 0,
    createdBuf: out[3] ?? 0,
    destroyedTex: out[4] ?? 0,
    destroyedBuf: out[5] ?? 0,
    pendingTex: out[6] ?? 0,
    pendingBuf: out[7] ?? 0,
  };
}

/**
 * Diagnostic counters for non-byte-sized GPU objects. These do not
 * have an explicit `destroy()` on the JS side — the resource is
 * freed when the JsValue ref drops via Rust's automatic field-drop.
 * `live = created - dropped`; unbounded growth in `live` indicates
 * the wgpu Rust state is retaining handles past their useful
 * lifetime.
 */
export function getRustGpuObjectCounts(): {
  liveBg: number;
  createdBg: number;
  droppedBg: number;
  liveTv: number;
  createdTv: number;
  droppedTv: number;
  liveSa: number;
  createdSa: number;
  droppedSa: number;
} {
  const empty = {
    liveBg: 0,
    createdBg: 0,
    droppedBg: 0,
    liveTv: 0,
    createdTv: 0,
    droppedTv: 0,
    liveSa: 0,
    createdSa: 0,
    droppedSa: 0,
  };
  if (!renderer) return empty;
  const r = renderer as unknown as {
    rustGpuObjectCounts?: () => Float64Array;
  };
  if (typeof r.rustGpuObjectCounts !== "function") return empty;
  let out: Float64Array;
  try {
    out = r.rustGpuObjectCounts();
  } catch {
    return empty;
  }
  return {
    liveBg: out[0] ?? 0,
    createdBg: out[1] ?? 0,
    droppedBg: out[2] ?? 0,
    liveTv: out[3] ?? 0,
    createdTv: out[4] ?? 0,
    droppedTv: out[5] ?? 0,
    liveSa: out[6] ?? 0,
    createdSa: out[7] ?? 0,
    droppedSa: out[8] ?? 0,
  };
}

/**
 * Returns the smallest `animType` whose rendered frame sequence is
 * identical to the queried one for the given accessory. Lets the
 * cache de-duplicate non-animating accessories that would otherwise
 * occupy 3 cache slots (one per animType value 0/1/2) for the same
 * pixel output.
 *
 * Falls back to the input `animType` if the renderer isn't loaded
 * yet, or the bundle/export isn't loaded — caller still gets a
 * usable cache key, just no dedup until WASM is ready.
 */
export function swfAccessoryCanonicalAnimType(
  bundle: string,
  exportName: string,
  slot: number,
  dir: string,
  side: string,
  animType: number,
): number {
  if (!renderer) return animType;
  const r = renderer as unknown as {
    swfAccessoryCanonicalAnimType?: (
      bundle: string,
      exportName: string,
      slot: number,
      dir: string,
      side: string,
      animType: number,
    ) => number;
  };
  if (typeof r.swfAccessoryCanonicalAnimType !== "function") return animType;
  try {
    return r.swfAccessoryCanonicalAnimType(
      bundle,
      exportName,
      slot,
      dir,
      side,
      animType,
    );
  } catch {
    return animType;
  }
}

/**
 * Number of `wgpu::Texture` instances Vello currently holds in its
 * Rust-side HashMap. Useful for cross-checking with
 * `liveRenderTextureIds` — if the JS set has N entries but the Rust
 * map has M ≠ N entries, something's mistracked.
 */
export function getRustTexturesCount(): number {
  if (!renderer) return 0;
  const r = renderer as unknown as { rustTexturesCount(): number };
  try {
    return r.rustTexturesCount();
  } catch {
    return 0;
  }
}

/** WASM linear-memory bytes (Rust side allocations, not GPU). */
export function getWasmHeapBytes(): number {
  if (!renderer) return 0;
  const r = renderer as unknown as { wasmHeapBytes(): number };
  try {
    return r.wasmHeapBytes();
  } catch {
    return 0;
  }
}


/**
 * Path-cache observability.
 * Returns counts + estimated cached bytes for the WASM-side path
 * caches (`tile_render_caches` per-bundle + `tile_subscenes` per
 * `(bundle, export, frame)`). Returns null when the renderer hasn't
 * initialized yet.
 */
export interface PathCacheStats {
  bundleCacheCount: number;
  sceneCacheCount: number;
  sceneBytesEstimate: number;
  /** Phase 1b body-scene cache size (soft-capped at 1500 in wasm). */
  bodySceneCacheCount?: number;
}

export function getPathCacheStats(): PathCacheStats | null {
  if (!renderer) {
    return null;
  }
  return (
    renderer as unknown as { pathCacheStats(): PathCacheStats }
  ).pathCacheStats();
}

/**
 * Drop both long-lived path caches (per-bundle render cache + scene
 * cache). Use for memory-pressure recovery, or after unloading a
 * bundle whose symbol IDs are about to be reused. Does NOT affect
 * spell instances, the static tile scene, or in-flight GPU textures.
 */
export function clearPathCache(): void {
  if (!renderer) {
    return;
  }
  (renderer as unknown as { clearPathCache(): void }).clearPathCache();
}

/**
 * Serialize `body_subscene_cache` to a binary blob suitable for IDB.
 * Resolution-independent (twip identity scenes) — same bytes work at
 * any render scale. Filter to one bundle for atomic per-bundle writes;
 * pass `null`/undefined to dump the entire cache.
 *
 * Returns null on serialization error or unavailable renderer (cache
 * just won't get persisted for this session — non-fatal).
 */
export function serializeBodySubsceneCache(
  bundleFilter?: string,
): Uint8Array | null {
  if (!renderer) {
    return null;
  }
  const bytes = (
    renderer as unknown as {
      serializeBodySubsceneCache(b?: string | null): Uint8Array | undefined;
    }
  ).serializeBodySubsceneCache(bundleFilter ?? null);
  return bytes ?? null;
}

/**
 * Install entries from a previously-persisted scene blob into the
 * in-memory subscene cache. Returns the count of entries loaded.
 * Idempotent: re-installing the same blob overwrites existing entries
 * (in-memory cache and on-disk version stay in lockstep).
 *
 * On parse error (bad magic / version mismatch / unsupported variant),
 * the Rust side logs and returns 0 — the caller falls back to fresh
 * bakes and the cache hydrates on-demand.
 */
export function loadBodySubsceneCache(bytes: Uint8Array): number {
  if (!renderer) {
    return 0;
  }
  return (
    renderer as unknown as {
      loadBodySubsceneCache(b: Uint8Array): number;
    }
  ).loadBodySubsceneCache(bytes);
}

/**
 * Serialize `body_scene_cache` — the COMPOSED per-variant body atlas
 * scenes the spawn path (`render_swf_body_atlas`) actually reads. This
 * is the cache that warms a cold 250-actor map entry; the subscene
 * cache above is a different one the spawn never touches. Scenes are
 * scale-baked, so the blob is per-resolution (key IDB rows by res).
 */
export function serializeBodySceneCache(
  bundleFilter?: string,
): Uint8Array | null {
  if (!renderer) return null;
  const bytes = (
    renderer as unknown as {
      serializeBodySceneCache(b?: string | null): Uint8Array | undefined;
    }
  ).serializeBodySceneCache(bundleFilter ?? null);
  return bytes ?? null;
}

/** Install entries from a `serializeBodySceneCache` blob into
 *  `body_scene_cache`. Returns count loaded (0 on error). */
export function loadBodySceneCache(bytes: Uint8Array): number {
  if (!renderer) return 0;
  return (
    renderer as unknown as {
      loadBodySceneCache(b: Uint8Array): number;
    }
  ).loadBodySceneCache(bytes);
}

/** Drop every `body_scene_cache` entry (test/diagnostic). Returns the
 *  number cleared. */
export function clearBodySceneCache(): number {
  if (!renderer) return 0;
  return (
    renderer as unknown as { clearBodySceneCache(): number }
  ).clearBodySceneCache();
}

/**
 * Count entries in `body_subscene_cache`, optionally filtered to one
 * bundle. Used by the loader-scene progress UI to surface "X/Y warm"
 * during the warmup phase.
 */
export function bodySubsceneCacheCountFor(bundleFilter?: string): number {
  if (!renderer) {
    return 0;
  }
  return (
    renderer as unknown as {
      bodySubsceneCacheCountFor(b?: string | null): number;
    }
  ).bodySubsceneCacheCountFor(bundleFilter ?? null);
}

/** Serialize the tile sub-scene cache to a VSC2 blob suitable for
 *  IDB persistence. Same wire format as the body cache, tagged with
 *  `CacheId::Tile`. Returns null on encode error (currently only
 *  fires when an entry contains `Patch::Image` — bitmap fill tiles
 *  skip persistent caching). */
export function serializeTileSubsceneCache(
  bundleFilter?: string,
): Uint8Array | null {
  if (!renderer) return null;
  const bytes = (
    renderer as unknown as {
      serializeTileSubsceneCache(b?: string | null): Uint8Array | undefined;
    }
  ).serializeTileSubsceneCache(bundleFilter ?? null);
  return bytes ?? null;
}

export function loadTileSubsceneCache(bytes: Uint8Array): number {
  if (!renderer) return 0;
  return (
    renderer as unknown as { loadTileSubsceneCache(b: Uint8Array): number }
  ).loadTileSubsceneCache(bytes);
}

export function tileSubsceneCacheCountFor(bundleFilter?: string): number {
  if (!renderer) return 0;
  return (
    renderer as unknown as {
      tileSubsceneCacheCountFor(b?: string | null): number;
    }
  ).tileSubsceneCacheCountFor(bundleFilter ?? null);
}

/** Same as `serializeTileSubsceneCache` but for the accessory cache.
 *  Accessory bakes used to redo 3 fresh AS2 walks per
 *  `renderSwfAccessoryStrip` call regardless of zoom; the cache makes
 *  that one walk per cycle per accessory across the session. */
export function serializeAccessorySubsceneCache(
  bundleFilter?: string,
): Uint8Array | null {
  if (!renderer) return null;
  const bytes = (
    renderer as unknown as {
      serializeAccessorySubsceneCache(
        b?: string | null,
      ): Uint8Array | undefined;
    }
  ).serializeAccessorySubsceneCache(bundleFilter ?? null);
  return bytes ?? null;
}

export function loadAccessorySubsceneCache(bytes: Uint8Array): number {
  if (!renderer) return 0;
  return (
    renderer as unknown as {
      loadAccessorySubsceneCache(b: Uint8Array): number;
    }
  ).loadAccessorySubsceneCache(bytes);
}

export function accessorySubsceneCacheCountFor(
  bundleFilter?: string,
): number {
  if (!renderer) return 0;
  return (
    renderer as unknown as {
      accessorySubsceneCacheCountFor(b?: string | null): number;
    }
  ).accessorySubsceneCacheCountFor(bundleFilter ?? null);
}

export interface BakeRecord {
  /** Kind classifier from `BakeKind` in `bake_telemetry.rs`. One of
   *  "ClassAtlas" | "BodyAtlas" | "BodyBandAtlas" | "TileFrame" |
   *  "AccessoryStrip" | "Strip" | "SpellComposition". */
  kind: string;
  bundle: string;
  sceneBuildMs: number;
  gpuRenderMs: number;
  bridgeMs: number;
  enumerateMs: number;
  combineCopyMs: number;
  totalMs: number;
  subsceneHits: number;
  subsceneMisses: number;
  pixelArea: number;
  subCount: number;
  /** `Date.now()` snapshot at record commit time. */
  tsRecorded: number;
}

export interface BakeTelemetryDrain {
  /** Records that hit the 10k buffer cap and were dropped silently —
   *  if non-zero, drain more often or grow the cap. */
  drops: number;
  records: BakeRecord[];
}

/**
 * Drain accumulated bake telemetry records. Returns raw measurements;
 * the caller aggregates into per-window histograms.
 *
 * The Rust side buffers up to 10k records. Drain every monitor tick
 * (or more often during stress) to keep `drops` at 0.
 */
export function drainBakeTelemetry(): BakeTelemetryDrain {
  if (!renderer) {
    return { drops: 0, records: [] };
  }
  const raw = (
    renderer as unknown as { drainBakeTelemetry(): BakeTelemetryDrain }
  ).drainBakeTelemetry();
  return raw ?? { drops: 0, records: [] };
}


/**
 * Pure-bounds probe for the spell-icon composition. Returns the natural
 * pixel rectangle `{width, height}` at resolution 1 without touching
 * the GPU. Replaces the throwaway-render natural-size discovery — a
 * `symbol_bounds` walk is microseconds vs. the milliseconds of an
 * attach-render-detach roundtrip. Returns null on missing bundle,
 * missing required layers, or degenerate root bounds.
 */
export function swfSpellIconNaturalSize(
  backBundle: string,
  upBundle: string,
): { width: number; height: number } | null {
  if (!renderer) {
    return null;
  }
  const result = renderer.swfSpellIconNaturalSize(backBundle, upBundle);
  return (result as { width: number; height: number } | null) ?? null;
}

/**
 * Pure-bounds probe for a named SWF export across `totalFrameCount`
 * frames. Returns the union bounding box in twips (1/20 px), plus the
 * deepest reachable animation end frame. CPU-only walk in WASM. Pass
 * `totalFrameCount: 1` for single-frame banner-view exports
 * (`UI_BannerClockBack`, `UI_BannerCompassArrow`, …) — the result's
 * twip extents give the natural pixel size after `/ 20`.
 */
export function swfStripBounds(
  bundle: string,
  exportName: string,
  totalFrameCount: number,
): {
  minXTwip: number;
  minYTwip: number;
  maxXTwip: number;
  maxYTwip: number;
  animEnd: number;
} | null {
  if (!renderer) {
    return null;
  }
  const result = renderer.swfStripBounds(bundle, exportName, totalFrameCount);
  return (
    (result as {
      minXTwip: number;
      minYTwip: number;
      maxXTwip: number;
      maxYTwip: number;
      animEnd: number;
    } | null) ?? null
  );
}

/**
 * Pure-bounds probe for an SWF root timeline. Returns `{width, height}`
 * at resolution 1 without touching the GPU. Used by the fighter
 * portrait renderer to size its slot canvas before allocating a Vello
 * paint. Returns null on missing bundle or degenerate bounds.
 */
export function swfRootNaturalSize(
  bundle: string,
  frame: number,
): { width: number; height: number } | null {
  if (!renderer) {
    return null;
  }
  const result = renderer.swfRootNaturalSize(bundle, frame >>> 0);
  return (result as { width: number; height: number } | null) ?? null;
}

