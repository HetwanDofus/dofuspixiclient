/**
 * One-shot render-budget measurement sweep.
 *
 * Fires once per session after the map has loaded + warmup completed.
 * Iterates every loaded SWF bundle × every zoom level, captures real
 * pixel area, page count, bake wall, and IDB blob size for class
 * atlases; picks a handful of representative fight anims and captures
 * single-variant bakes at every zoom too. Sums everything into one
 * markdown report dumped via `console.log` between clearly-marked
 * delimiters.
 *
 * The intent: give the architecture decision a measured table to sit
 * on instead of envelope math. See `RENDER_STATE.md` for the rationale.
 *
 * Run by setting `localStorage.setItem("RENDER_MEASUREMENT_SWEEP", "1")`
 * (or the URL query `?measureRender=1`) before navigating to a map.
 * The flag is consumed once — the next session reset re-enables.
 */
import { ZOOM_LEVELS } from "@/game/constants/battlefield";
import { triggerActiveStripRebake } from "@/game/render/player-strip-renderer-v2";
import {
  clearBodySceneCache,
  loadBodySceneCache,
  persistAllSceneCaches,
  serializeBodySceneCache,
} from "@/game/render/vello-loader";
import {
  bakeClassAtlasViaWorkerPool,
  getBakeWorkerPoolConfig,
  isBakeWorkerPoolReady,
} from "@/game/render/bake-worker-pool";
import {
  bodySceneCacheStats,
  dumpClassEnumeration,
  dumpSwfBundleInventory,
  freeRenderTexture,
  getPixiRenderer,
  getRetainedSwfBundleBytes,
  isSwfBundleLoaded,
  listLoadedSwfBundles,
  loadAccessorySubsceneCache,
  renderSwfBodyAtlas,
  renderSwfClassAtlas,
  serializeAccessorySubsceneCache,
  setClassAtlasBakeMode,
  setClassAtlasForcePerVariant,
  subsceneCacheBytesForBundle,
  swfAnimFrameCount,
  type BodySceneCacheStats,
  type ClassEnumerationDump,
  type SwfBundleInventoryRow,
  type VelloSwfBodyAtlasResult,
  type VelloSwfClassAtlasResult,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("MeasurementSweep");

/**
 * Console-driven A/B for one class atlas bundle: per-variant vs
 * per-page bake. Installed as `window.__classAtlasAB`. Runs each mode
 * `reps` times at each requested zoom, reports median wall + page
 * dims + a pixel checksum so we can confirm the two paths produce
 * identical output. Disposes every result's ImageBitmaps so it
 * doesn't leak GPU memory.
 *
 * Usage from devtools:
 *   await __classAtlasAB("sprite-10", [3], 3)
 *   await __classAtlasAB("sprite-100", [1,3,5], 2)
 *
 * Single-bundle by design — avoids the full 120-bake sweep that risks
 * GPU OOM while the per-page path is still being validated.
 */
async function classAtlasAB(
  bundle: string,
  zooms: number[] = [3],
  reps = 3,
): Promise<unknown> {
  if (!isSwfBundleLoaded(bundle)) {
    return { error: `bundle ${bundle} not loaded` };
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const bakeOnce = (
    zoom: number,
  ): { wallMs: number; pages: number; pageDims: string; bytesEst: number } => {
    const t0 = performance.now();
    const r = renderSwfClassAtlas(bundle, zoom);
    const wallMs = performance.now() - t0;
    if (!r) return { wallMs, pages: 0, pageDims: "(null)", bytesEst: 0 };
    let bytesEst = 0;
    const dims = r.pages
      .map((p) => {
        bytesEst += p.atlasWidth * p.atlasHeight * 4;
        return `${p.atlasWidth}x${p.atlasHeight}`;
      })
      .join(",");
    for (const p of r.pages) {
      try {
        p.combinedBitmap.close();
      } catch {
        // ignore
      }
    }
    return { wallMs, pages: r.pages.length, pageDims: dims, bytesEst };
  };
  const out: Record<string, unknown> = { bundle, reps };
  for (const zoom of zooms) {
    // Per-variant arm
    setClassAtlasForcePerVariant(true);
    const pv: number[] = [];
    let pvMeta = { pages: 0, pageDims: "", bytesEst: 0 };
    for (let i = 0; i < reps; i++) {
      const b = bakeOnce(zoom);
      pv.push(b.wallMs);
      pvMeta = { pages: b.pages, pageDims: b.pageDims, bytesEst: b.bytesEst };
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    // Per-page arm
    setClassAtlasForcePerVariant(false);
    const pp: number[] = [];
    let ppMeta = { pages: 0, pageDims: "", bytesEst: 0 };
    for (let i = 0; i < reps; i++) {
      const b = bakeOnce(zoom);
      pp.push(b.wallMs);
      ppMeta = { pages: b.pages, pageDims: b.pageDims, bytesEst: b.bytesEst };
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    setClassAtlasForcePerVariant(true); // restore safe default
    const pvMed = median(pv);
    const ppMed = median(pp);
    out[`zoom${zoom}`] = {
      perVariantMedianMs: Number(pvMed.toFixed(1)),
      perPageMedianMs: Number(ppMed.toFixed(1)),
      speedup: Number((pvMed / Math.max(ppMed, 0.01)).toFixed(2)),
      perVariant: { ...pvMeta, allMs: pv.map((x) => Number(x.toFixed(1))) },
      perPage: { ...ppMeta, allMs: pp.map((x) => Number(x.toFixed(1))) },
      bytesMatch: pvMeta.bytesEst === ppMeta.bytesEst,
      dimsMatch: pvMeta.pageDims === ppMeta.pageDims,
    };
  }
  return out;
}

try {
  (globalThis as { __classAtlasAB?: typeof classAtlasAB }).__classAtlasAB =
    classAtlasAB;
} catch {
  // ignore
}

/**
 * Simulate a full zoom-step rebake: bake EVERY loaded class bundle at
 * one zoom, single-threaded, through the configured bake mode. This
 * is the architecture-critical number — a zoom change re-bakes every
 * visible class. `bakeMode`: 0 = AUTO (per-page ≤2 pages, per-variant
 * ≥3), 1 = force per-variant, 2 = force per-page. Disposes every
 * result. Installed as `window.__zoomStepBench`.
 *
 *   await __zoomStepBench(5)        // AUTO at zoom 5
 *   await __zoomStepBench(5, 1)     // force per-variant (old behaviour)
 */
async function zoomStepBench(
  zoom: number,
  bakeMode = 0,
): Promise<unknown> {
  setClassAtlasBakeMode(bakeMode);
  const sprites = listLoadedSwfBundles()
    .filter((b) => b.startsWith("sprite-"))
    .sort();
  // Yield to rAF between EVERY bundle so the main thread never blocks
  // for more than one bake, and so Pixi's ticker drains the
  // deferred-destroy queue (per-variant temps free between bundles).
  // `sumBakeMs` accumulates only the bake time (excludes the rAF
  // gaps) so the figure reflects pure single-threaded bake cost — the
  // wall a real zoom-step would pay if it ran the bakes back-to-back
  // off the render thread (e.g. in the bake queue's budget).
  const run = async (): Promise<{
    sumBakeMs: number;
    rows: Array<{ b: string; ms: number; pages: number }>;
  }> => {
    const rows: Array<{ b: string; ms: number; pages: number }> = [];
    let sumBakeMs = 0;
    for (const b of sprites) {
      const tb = performance.now();
      const r = renderSwfClassAtlas(b, zoom);
      const ms = performance.now() - tb;
      sumBakeMs += ms;
      let pages = 0;
      if (r) {
        pages = r.pages.length;
        for (const p of r.pages) {
          try {
            p.combinedBitmap.close();
          } catch {
            // ignore
          }
        }
      }
      rows.push({ b, ms: Number(ms.toFixed(1)), pages });
      await new Promise((res) => requestAnimationFrame(() => res(null)));
    }
    return { sumBakeMs: Number(sumBakeMs.toFixed(0)), rows };
  };
  await run(); // prime (first-touch warm)
  const measured = await run();
  setClassAtlasBakeMode(0); // restore AUTO
  const slowest = [...measured.rows].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const pageHist: Record<number, number> = {};
  for (const r of measured.rows) {
    pageHist[r.pages] = (pageHist[r.pages] ?? 0) + 1;
  }
  return {
    zoom,
    bakeMode,
    bundleCount: sprites.length,
    sumBakeMs: measured.sumBakeMs,
    pageHistogram: pageHist,
    slowest,
  };
}

try {
  (globalThis as { __zoomStepBench?: typeof zoomStepBench }).__zoomStepBench =
    zoomStepBench;
} catch {
  // ignore
}

/**
 * Decompose the per-page bake cost into fixed per-dispatch overhead vs
 * irreducible raster compute. This is the architecture-deciding probe:
 * it answers "is cross-bundle mega-batching worth pursuing, or is
 * per-page already near the compute floor?"
 *
 * Method: for each bundle, time both the per-variant bake (Nvariants
 * dispatches) and the per-page bake (Npages dispatches) over the SAME
 * total raster content. Modelling each as:
 *
 *     wall ≈ dispatches · overhead + rasterCompute
 *
 * the two equations subtract to isolate overhead:
 *
 *     overhead ≈ (perVariantMs − perPageMs) / (Nvariants − Npages)
 *
 * and back-substitution gives rasterCompute. Aggregated across the
 * roster, `estComputeFraction` is the verdict:
 *   - ≥ ~0.85  → compute-bound; batching can shave ≤15%, blocked by the
 *                Vello scene-overflow wall anyway → per-page IS the floor.
 *   - < ~0.6   → overhead-bound; cross-bundle batching has real room.
 *
 * `projectedMegaBatchMs` projects collapsing all per-page dispatches
 * into `megaDispatches` (default 6 — a generous count given the 8192
 * texture-dim + scene-overflow limits) so we can read the *best case*
 * batching win directly.
 *
 *   await __dispatchOverheadProbe([3, 5], 3)
 */
async function dispatchOverheadProbe(
  zooms: number[] = [3, 5],
  reps = 3,
  megaDispatches = 6,
): Promise<unknown> {
  const sprites = listLoadedSwfBundles()
    .filter((b) => b.startsWith("sprite-"))
    .sort();
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const yieldRaf = () =>
    new Promise<void>((res) => requestAnimationFrame(() => res()));
  const out: Record<string, unknown> = { zooms, reps, megaDispatches };
  for (const zoom of zooms) {
    const rows: Array<{
      bundle: string;
      variants: number;
      pages: number;
      pvMed: number;
      ppMed: number;
      overheadMs: number;
    }> = [];
    let sumPerPage = 0;
    let sumPerVariant = 0;
    let sumPages = 0;
    let sumVariants = 0;
    for (const bundle of sprites) {
      // per-variant arm: Nvariants dispatches
      setClassAtlasForcePerVariant(true);
      const pv: number[] = [];
      let variants = 0;
      let pages = 0;
      for (let i = 0; i < reps; i++) {
        const t0 = performance.now();
        const r = renderSwfClassAtlas(bundle, zoom);
        pv.push(performance.now() - t0);
        if (r) {
          variants = r.variants.length;
          pages = r.pages.length;
          for (const p of r.pages) {
            try {
              p.combinedBitmap.close();
            } catch {
              // ignore
            }
          }
        }
        await yieldRaf();
      }
      // per-page arm: Npages dispatches
      setClassAtlasForcePerVariant(false);
      const pp: number[] = [];
      for (let i = 0; i < reps; i++) {
        const t0 = performance.now();
        const r = renderSwfClassAtlas(bundle, zoom);
        pp.push(performance.now() - t0);
        if (r) {
          for (const p of r.pages) {
            try {
              p.combinedBitmap.close();
            } catch {
              // ignore
            }
          }
        }
        await yieldRaf();
      }
      const pvMed = median(pv);
      const ppMed = median(pp);
      const dispatchDelta = Math.max(1, variants - pages);
      const overheadMs = (pvMed - ppMed) / dispatchDelta;
      rows.push({
        bundle,
        variants,
        pages,
        pvMed: Number(pvMed.toFixed(1)),
        ppMed: Number(ppMed.toFixed(1)),
        overheadMs: Number(overheadMs.toFixed(2)),
      });
      sumPerPage += ppMed;
      sumPerVariant += pvMed;
      sumPages += pages;
      sumVariants += variants;
    }
    // Robust per-dispatch overhead = median across bundles (ignores the
    // occasional negative/degenerate delta from a 1-variant bundle).
    const overheads = rows
      .map((r) => r.overheadMs)
      .filter((x) => Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b);
    const medOverhead = overheads[Math.floor(overheads.length / 2)] ?? 0;
    const estComputeTotal = Math.max(0, sumPerPage - sumPages * medOverhead);
    const projectedSavings = Math.max(
      0,
      (sumPages - megaDispatches) * medOverhead,
    );
    out[`zoom${zoom}`] = {
      bundles: sprites.length,
      sumPerPageMs: Number(sumPerPage.toFixed(0)),
      sumPerVariantMs: Number(sumPerVariant.toFixed(0)),
      sumPages,
      sumVariants,
      medOverheadPerDispatchMs: Number(medOverhead.toFixed(2)),
      estRasterComputeMs: Number(estComputeTotal.toFixed(0)),
      estComputeFraction:
        sumPerPage > 0
          ? Number((estComputeTotal / sumPerPage).toFixed(2))
          : 0,
      projectedMegaBatchMs: Number((sumPerPage - projectedSavings).toFixed(0)),
      projectedSavingsMs: Number(projectedSavings.toFixed(0)),
      rows,
    };
  }
  setClassAtlasBakeMode(0); // restore AUTO
  return out;
}

try {
  (
    globalThis as { __dispatchOverheadProbe?: typeof dispatchOverheadProbe }
  ).__dispatchOverheadProbe = dispatchOverheadProbe;
} catch {
  // ignore
}

/**
 * Trigger the real character-resolution rebake (the heavy path a
 * settled zoom fires) and return the live slot count re-dispatched.
 * Registered here (not battlefield-scene) so HMR re-runs the
 * top-level registration without a scene re-init.
 *
 *   __triggerCharRebake(5)   // re-bake all live bots at resolution 5
 */
function triggerCharRebake(res: number): number | null {
  return triggerActiveStripRebake(res);
}

try {
  (
    globalThis as { __triggerCharRebake?: typeof triggerCharRebake }
  ).__triggerCharRebake = triggerCharRebake;
} catch {
  // ignore
}

// body_scene_cache (composed per-variant) persist/clear/load — the
// cache the spawn path actually reads. Exposed for the
// persist→clear→load→spawn-warm validation before wiring into warmup.
try {
  const g = globalThis as {
    __serializeBodySceneCache?: (b?: string) => Uint8Array | null;
    __loadBodySceneCache?: (b: Uint8Array) => number;
    __clearBodySceneCache?: () => number;
  };
  g.__serializeBodySceneCache = (b?: string) => serializeBodySceneCache(b);
  g.__loadBodySceneCache = (b: Uint8Array) => loadBodySceneCache(b);
  g.__clearBodySceneCache = () => clearBodySceneCache();
} catch {
  // ignore
}

/**
 * Persist BOTH spawn-path caches (body_scene_cache + acc_subscenes)
 * to IDB for every loaded sprite bundle. These are the caches the
 * per-variant spawn actually reads — persisting them is what warms a
 * cold map entry across sessions (the existing warmup persists
 * body_subscene_cache, a different cache the spawn never reads).
 * Validation helper; the production path wires this into the periodic
 * flush + map-leave.
 */
async function persistSpawnCaches(): Promise<unknown> {
  const idb = await import("@/game/render/scene-cache-idb");
  const all = listLoadedSwfBundles();
  // body_scene_cache is keyed by SPRITE bundle; acc_subscenes is keyed
  // by the ACCESSORY bundle (acc-*). Persist each kind against its own
  // bundle set.
  const spriteBundles = all.filter((b) => b.startsWith("sprite-"));
  const accBundles = all.filter((b) => b.startsWith("acc"));
  let bodyOk = 0;
  let accOk = 0;
  for (const b of spriteBundles) {
    const bytes = getRetainedSwfBundleBytes(b);
    if (!bytes) continue;
    const hash = await idb.hashBytes(bytes);
    const bodyScene = serializeBodySceneCache(b);
    if (bodyScene) {
      await idb.putSubsceneBlob(b, hash, bodyScene, "bodyscene");
      bodyOk++;
    }
  }
  for (const b of accBundles) {
    const bytes = getRetainedSwfBundleBytes(b);
    if (!bytes) continue;
    const hash = await idb.hashBytes(bytes);
    const acc = serializeAccessorySubsceneCache(b);
    if (acc) {
      await idb.putSubsceneBlob(b, hash, acc, "acc");
      accOk++;
    }
  }
  return {
    spriteBundles: spriteBundles.length,
    accBundles: accBundles.length,
    bodyScenePersisted: bodyOk,
    accPersisted: accOk,
  };
}

/** Hydrate BOTH spawn-path caches from IDB for every loaded sprite
 *  bundle. Mirrors what the warmup must do (but currently doesn't). */
async function hydrateSpawnCaches(): Promise<unknown> {
  const idb = await import("@/game/render/scene-cache-idb");
  const all = listLoadedSwfBundles();
  const spriteBundles = all.filter((b) => b.startsWith("sprite-"));
  const accBundles = all.filter((b) => b.startsWith("acc"));
  let bodyLoaded = 0;
  let accLoaded = 0;
  let bodyHits = 0;
  let accHits = 0;
  for (const b of spriteBundles) {
    const bytes = getRetainedSwfBundleBytes(b);
    if (!bytes) continue;
    const hash = await idb.hashBytes(bytes);
    const bodyBlob = await idb.getSubsceneBlob(b, hash, "bodyscene");
    if (bodyBlob) {
      bodyHits++;
      bodyLoaded += loadBodySceneCache(bodyBlob);
    }
  }
  for (const b of accBundles) {
    const bytes = getRetainedSwfBundleBytes(b);
    if (!bytes) continue;
    const hash = await idb.hashBytes(bytes);
    const accBlob = await idb.getSubsceneBlob(b, hash, "acc");
    if (accBlob) {
      accHits++;
      accLoaded += loadAccessorySubsceneCache(accBlob);
    }
  }
  return {
    spriteBundles: spriteBundles.length,
    accBundles: accBundles.length,
    bodyHits,
    bodyLoaded,
    accHits,
    accLoaded,
  };
}

try {
  const g = globalThis as {
    __persistSpawnCaches?: () => Promise<unknown>;
    __hydrateSpawnCaches?: () => Promise<unknown>;
  };
  g.__persistSpawnCaches = persistSpawnCaches;
  g.__hydrateSpawnCaches = hydrateSpawnCaches;
} catch {
  // ignore
}

// Production persist path (periodic-flush equivalent) — persists every
// loaded bundle's caches incl. the now-wired `bodyscene`. Exposed to
// validate the real warmup-auto-hydrate + flush-persist path end to end.
try {
  (
    globalThis as { __persistAllSceneCaches?: () => Promise<number> }
  ).__persistAllSceneCaches = () => persistAllSceneCaches();
} catch {
  // ignore
}

const STORAGE_KEY = "RENDER_MEASUREMENT_SWEEP";
/** Page-session guard. Set on the first invocation; subsequent map
 *  entries within the same tab no-op so the sweep doesn't fire on
 *  every map transition. Cleared by a page reload. */
let sweepFiredThisSession = false;
/** Module-level disable: set
 *  `localStorage.setItem("RENDER_MEASUREMENT_SWEEP", "0")` to opt out
 *  of the auto-sweep entirely once the user has captured their data. */
const DISABLE_FLAG_VALUE = "0";

interface ClassAtlasMeasurement {
  bundle: string;
  zoom: number;
  variants: number;
  pages: number;
  pageDims: string;
  totalPixels: number;
  bytesEst: number;
  wallMs: number;
  /** Sum over variants of (gridCols·rows·frame_w·frame_h·bandCount) =
   *  the actual painted pixel area. Compare against `totalPixels` to
   *  derive packing efficiency. */
  paintedPixels: number;
}

interface PixiLabelSnapshot {
  label: string;
  count: number;
  gpuBytes: number;
  bitmapBytes: number;
}

interface PoolDispatchMeasurement {
  zoom: number;
  bundleCount: number;
  /** Sum of per-bake walls (= serial cost if pool=1). */
  serialBakeMs: number;
  /** Wall from first dispatch to Promise.all resolution (= parallel
   *  cost = serial / parallelism if pool>1 and GPU parallelizes). */
  parallelWallMs: number;
  /** Bytes summed across all per-bundle results (sanity vs Section 3). */
  totalBytes: number;
  /** Count of bundles whose pool dispatch returned null (pool down or
   *  bake error). */
  failed: number;
}

interface SingleVariantMeasurement {
  bundle: string;
  exportName: string;
  zoom: number;
  applyBFix: boolean;
  hatEquipped: boolean;
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  atlasWidth: number;
  atlasHeight: number;
  bytesEst: number;
  wallMs: number;
}

interface BundleSubsceneMeasurement {
  bundle: string;
  entryCountStart: number;
  serializedBytesStart: number;
  entryCountEnd: number;
  serializedBytesEnd: number;
}

interface InventoryRollup {
  bundle: string;
  allExports: number;
  sprites: number;
  shapes: number;
  morphShapes: number;
  bitmaps: number;
  characterAnims: number;
  fightAnims: number;
  fightAnimSamples: string[];
  totalFramesSum: number;
  maxFrames: number;
}

/** Pick fight-anim names to single-variant-bake. We take a few
 *  representative names per bundle: the first 5 sprites whose name
 *  ends in a direction suffix AND is not in the class-atlas filter.
 *  Sorted alphabetically so the same bundles always sample the same
 *  exports across runs (deterministic). */
function pickFightAnimSamples(
  inventory: SwfBundleInventoryRow[],
  count: number,
): SwfBundleInventoryRow[] {
  const candidates = inventory.filter(
    (row) =>
      row.kind === "Sprite" &&
      !row.isCharacterAnim &&
      row.totalFrames > 0 &&
      /[RLFBS]$/.test(row.name),
  );
  // Prefer names that look like fight anims (start with anim0/anim1/
  // hit/die/cast/dance/sit/emote). Falls back to alphabetical if the
  // bundle doesn't have any.
  const preferredPrefixes = [
    "anim0",
    "anim1",
    "anim2",
    "hit",
    "die",
    "cast",
    "dance",
    "sit",
    "emote",
  ];
  const preferred: SwfBundleInventoryRow[] = [];
  for (const prefix of preferredPrefixes) {
    for (const row of candidates) {
      if (row.name.startsWith(prefix) && !preferred.includes(row)) {
        preferred.push(row);
        if (preferred.length >= count) return preferred;
      }
    }
  }
  // Fill with arbitrary remaining candidates if we still want more.
  for (const row of candidates) {
    if (!preferred.includes(row)) {
      preferred.push(row);
      if (preferred.length >= count) break;
    }
  }
  return preferred;
}

function bytesEstFromDims(width: number, height: number): number {
  return width * height * 4;
}

function formatBytes(n: number): string {
  if (n < 0) return "ERR";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function disposeClassAtlas(result: VelloSwfClassAtlasResult | null): void {
  if (!result) return;
  for (const page of result.pages) {
    try {
      page.combinedBitmap.close();
    } catch {
      // ignore
    }
  }
}

function disposeBodyAtlas(result: VelloSwfBodyAtlasResult | null): void {
  if (!result) return;
  try {
    result.combinedBitmap.close();
  } catch {
    // ignore
  }
}

/** Yield to the event loop so the host browser tab stays responsive
 *  between bakes. Each bake call is sync from JS's perspective; this
 *  rAF break gives the OS a chance to update the UI / process the
 *  bakeTel drain. */
/** Walk Pixi's managed-source registry and bucket GPU bytes by label
 *  prefix (`class:|var:|acc:|...`). Mirrors `stress-test.ts:574-632`
 *  so the sweep report shows actual GPU footprint per bake-kind, not
 *  just the per-bake bytesEst projection. */
function snapshotPixiByLabel(): PixiLabelSnapshot[] {
  const buckets = new Map<string, PixiLabelSnapshot>();
  try {
    const renderer = getPixiRenderer() as unknown as
      | {
          texture?: {
            _managedTextures?: { items?: Record<string, unknown> };
          };
        }
      | null;
    const sys = renderer?.texture;
    const items = sys?._managedTextures?.items;
    if (!items) return [];
    const liveSources = Object.values(items).filter(
      (s): s is Record<string, unknown> => s !== null && s !== undefined,
    );
    for (const src of liveSources) {
      const s = src as {
        pixelWidth?: number;
        pixelHeight?: number;
        format?: string;
        label?: string;
        resource?: unknown;
      };
      const w = s.pixelWidth ?? 0;
      const h = s.pixelHeight ?? 0;
      // Pixi formats this sweep cares about are RGBA8 ⇒ 4 B/px. Other
      // formats (e.g. r8unorm for masks) are rare here; if we hit one,
      // 4 is an upper bound.
      const gpuBytes = w * h * 4;
      let bitmapBytes = 0;
      const resource = s.resource;
      if (
        resource &&
        typeof (resource as { close?: () => void }).close === "function" &&
        typeof (resource as { width?: number }).width === "number"
      ) {
        const bm = resource as { width: number; height: number };
        bitmapBytes = bm.width * bm.height * 4;
      }
      const label =
        (s.label ?? "(unlabeled)").split(/[:|@#]/)[0] || "(other)";
      const bucket = buckets.get(label) ?? {
        label,
        count: 0,
        gpuBytes: 0,
        bitmapBytes: 0,
      };
      bucket.count += 1;
      bucket.gpuBytes += gpuBytes;
      bucket.bitmapBytes += bitmapBytes;
      buckets.set(label, bucket);
    }
  } catch (e) {
    log.warn("snapshotPixiByLabel failed", e);
  }
  return Array.from(buckets.values()).sort((a, b) => b.gpuBytes - a.gpuBytes);
}

function yieldToHost(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function shouldRunSweep(): boolean {
  if (sweepFiredThisSession) return false;
  try {
    if (typeof localStorage !== "undefined") {
      // User-opt-out: explicit "0" disables the auto-sweep entirely.
      // Any other value (including unset) leaves it auto-on so the
      // first map entry per page session produces the measurement.
      if (localStorage.getItem(STORAGE_KEY) === DISABLE_FLAG_VALUE) {
        return false;
      }
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search ?? "");
      if (params.get("measureRender") === "0") return false;
    }
  } catch {
    // ignore — sandboxed contexts without localStorage just default
    // to running.
  }
  return true;
}

/** Public entrypoint. Auto-fires on the first call per page session
 *  unless `localStorage.RENDER_MEASUREMENT_SWEEP === "0"` (the
 *  opt-out flag). Subsequent calls in the same tab no-op. Catches all
 *  errors so a sweep failure can't break battlefield boot. */
export async function maybeRunMeasurementSweep(): Promise<void> {
  if (!shouldRunSweep()) return;
  sweepFiredThisSession = true;
  try {
    await runMeasurementSweep();
  } catch (e) {
    log.error("measurement sweep threw", e);
    // Still emit a marker so the user knows it tried.
    console.log("=== RENDER_MEASUREMENT_SWEEP: FAILED ===");
    console.log(String(e));
    console.log("=== END RENDER_MEASUREMENT_SWEEP ===");
  }
}

async function runMeasurementSweep(): Promise<void> {
  const sweepT0 = performance.now();
  const bundles = listLoadedSwfBundles();
  log.info(
    `starting sweep over ${bundles.length} loaded bundles × ${ZOOM_LEVELS.length} zooms`,
  );
  console.log("=== RENDER_MEASUREMENT_SWEEP: START ===");

  // --- Phase 1: inventory + class enumeration --------------------------
  const inventoryRollups: InventoryRollup[] = [];
  const inventoriesByBundle = new Map<string, SwfBundleInventoryRow[]>();
  const classEnumerations = new Map<string, ClassEnumerationDump | null>();
  for (const bundle of bundles) {
    const inv = dumpSwfBundleInventory(bundle);
    inventoriesByBundle.set(bundle, inv);
    const enumeration = dumpClassEnumeration(bundle);
    classEnumerations.set(bundle, enumeration);
    const fightSamples = pickFightAnimSamples(inv, 5);
    let sprites = 0;
    let shapes = 0;
    let morphShapes = 0;
    let bitmaps = 0;
    let characterAnims = 0;
    let fightAnims = 0;
    let totalFramesSum = 0;
    let maxFrames = 0;
    for (const row of inv) {
      if (row.kind === "Sprite") sprites++;
      else if (row.kind === "Shape") shapes++;
      else if (row.kind === "MorphShape") morphShapes++;
      else if (row.kind === "Bitmap") bitmaps++;
      if (row.isCharacterAnim) characterAnims++;
      if (
        row.kind === "Sprite" &&
        !row.isCharacterAnim &&
        /[RLFBS]$/.test(row.name)
      ) {
        fightAnims++;
      }
      totalFramesSum += row.totalFrames;
      if (row.totalFrames > maxFrames) maxFrames = row.totalFrames;
    }
    inventoryRollups.push({
      bundle,
      allExports: inv.length,
      sprites,
      shapes,
      morphShapes,
      bitmaps,
      characterAnims,
      fightAnims,
      fightAnimSamples: fightSamples.map((r) => r.name),
      totalFramesSum,
      maxFrames,
    });
  }

  // Snapshot subscene bytes BEFORE the sweep so we can show the delta
  // from the warmup baseline.
  const subsceneStart = new Map<
    string,
    { entryCount: number; serializedBytes: number }
  >();
  for (const bundle of bundles) {
    subsceneStart.set(bundle, subsceneCacheBytesForBundle(bundle));
  }

  // body_scene_cache stats baseline. The class-atlas sweep runs ONLY
  // single-variant bakes (renderSwfBodyAtlas via the fight-anim path),
  // so deltas attribute to that path. Used to verify whether the
  // 1500-cap LRU thrashes under the sweep workload (proxy for stress).
  const bodySceneStart = bodySceneCacheStats();

  // Tile/world/accessory bundles don't have character anims; calling
  // `renderSwfClassAtlas` against them just returns null and spams the
  // log. Restrict bakes to bundles whose enumeration actually has
  // exports. Section 1 still inventories every loaded bundle.
  const characterBundles = bundles.filter((b) => {
    const e = classEnumerations.get(b);
    return e !== null && e !== undefined && e.exports.length > 0;
  });
  log.info(
    `bake phase: ${characterBundles.length}/${bundles.length} bundles have character anims`,
  );

  // --- Phase 2: class atlas bake per (bundle, zoom) --------------------
  const classMeasurements: ClassAtlasMeasurement[] = [];
  let classBakeIdx = 0;
  const classBakeTotal = characterBundles.length * ZOOM_LEVELS.length;
  for (const bundle of characterBundles) {
    for (const zoom of ZOOM_LEVELS) {
      classBakeIdx++;
      const t0 = performance.now();
      let result: VelloSwfClassAtlasResult | null = null;
      try {
        result = renderSwfClassAtlas(bundle, zoom);
      } catch (e) {
        log.warn(`classAtlas bake failed for ${bundle}@${zoom}`, e);
      }
      const wall = performance.now() - t0;
      if (result) {
        let totalPixels = 0;
        for (const p of result.pages) {
          totalPixels += p.atlasWidth * p.atlasHeight;
        }
        // Painted-pixel calc: per-variant cell grid = gridCols × rows
        // × frame_w × frame_h × bandCount. The packer's leftover space
        // is wasted (transparent padding). Ratio = painted / totalPixels
        // tells us how much atlas memory is actual content vs slack.
        let paintedPixels = 0;
        for (const v of result.variants) {
          const cells = v.frameCount * v.bandCount;
          paintedPixels += cells * v.frameWidth * v.frameHeight;
        }
        classMeasurements.push({
          bundle,
          zoom,
          variants: result.variants.length,
          pages: result.pages.length,
          pageDims: result.pages
            .map((p) => `${p.atlasWidth}x${p.atlasHeight}`)
            .join(","),
          totalPixels,
          bytesEst: totalPixels * 4,
          wallMs: wall,
          paintedPixels,
        });
        disposeClassAtlas(result);
      } else {
        classMeasurements.push({
          bundle,
          zoom,
          variants: 0,
          pages: 0,
          pageDims: "",
          totalPixels: 0,
          bytesEst: 0,
          wallMs: wall,
          paintedPixels: 0,
        });
      }
      if (classBakeIdx % 8 === 0) {
        log.info(
          `classAtlas progress: ${classBakeIdx}/${classBakeTotal} (${bundle}@${zoom} ${wall.toFixed(0)}ms)`,
        );
        await yieldToHost();
      }
    }
  }

  // --- Phase 3: single-variant bake (fight anims) per (bundle, anim, zoom)
  const singleMeasurements: SingleVariantMeasurement[] = [];
  let singleBakeIdx = 0;
  const fightSamplesPerBundle = new Map<
    string,
    Array<{ name: string; totalFrames: number }>
  >();
  // Only sample fight anims from character bundles — sampling from
  // tile/world bundles would bake non-existent character variants
  // and clutter the report.
  for (const bundle of characterBundles) {
    const inv = inventoriesByBundle.get(bundle) ?? [];
    const samples = pickFightAnimSamples(inv, 5).map((r) => ({
      name: r.name,
      totalFrames: r.totalFrames,
    }));
    fightSamplesPerBundle.set(bundle, samples);
  }
  let singleBakeTotal = 0;
  for (const samples of fightSamplesPerBundle.values()) {
    singleBakeTotal += samples.length * ZOOM_LEVELS.length;
  }
  for (const [bundle, samples] of fightSamplesPerBundle) {
    const enumeration = classEnumerations.get(bundle) ?? null;
    const bFixUsed = enumeration?.bundleBFixUsed ?? false;
    for (const sample of samples) {
      const frameCount = Math.max(
        1,
        sample.totalFrames || swfAnimFrameCount(bundle, sample.name) || 1,
      );
      for (const zoom of ZOOM_LEVELS) {
        singleBakeIdx++;
        const t0 = performance.now();
        let result: VelloSwfBodyAtlasResult | null = null;
        try {
          result = renderSwfBodyAtlas(
            bundle,
            sample.name,
            0,
            frameCount,
            frameCount,
            zoom,
            bFixUsed,
            false,
          );
        } catch (e) {
          log.warn(
            `singleVariant bake failed for ${bundle}/${sample.name}@${zoom}`,
            e,
          );
        }
        const wall = performance.now() - t0;
        if (result) {
          singleMeasurements.push({
            bundle,
            exportName: sample.name,
            zoom,
            applyBFix: bFixUsed,
            hatEquipped: false,
            frameCount: result.frameCount,
            frameWidth: result.frameWidth,
            frameHeight: result.frameHeight,
            atlasWidth: result.atlasWidth,
            atlasHeight: result.atlasHeight,
            bytesEst: bytesEstFromDims(result.atlasWidth, result.atlasHeight),
            wallMs: wall,
          });
          disposeBodyAtlas(result);
        } else {
          singleMeasurements.push({
            bundle,
            exportName: sample.name,
            zoom,
            applyBFix: bFixUsed,
            hatEquipped: false,
            frameCount,
            frameWidth: 0,
            frameHeight: 0,
            atlasWidth: 0,
            atlasHeight: 0,
            bytesEst: 0,
            wallMs: wall,
          });
        }
        if (singleBakeIdx % 12 === 0) {
          log.info(
            `singleVariant progress: ${singleBakeIdx}/${singleBakeTotal}`,
          );
          await yieldToHost();
        }
      }
    }
  }

  // --- Phase 4: subscene IDB blob size (delta vs start) ----------------
  const subsceneMeasurements: BundleSubsceneMeasurement[] = [];
  for (const bundle of bundles) {
    const start = subsceneStart.get(bundle) ?? {
      entryCount: 0,
      serializedBytes: 0,
    };
    const end = subsceneCacheBytesForBundle(bundle);
    subsceneMeasurements.push({
      bundle,
      entryCountStart: start.entryCount,
      serializedBytesStart: start.serializedBytes,
      entryCountEnd: end.entryCount,
      serializedBytesEnd: end.serializedBytes,
    });
  }

  // --- Phase 4aa: worker-pool parallel-dispatch A/B ---------------------
  // For each zoom, dispatch all character-bundle bakes through the
  // configured worker pool in parallel, await Promise.all, time the
  // wall. With pool=1 this serializes (≈ Section 3a's per-zoom sum);
  // with pool=N+shard, completion = max-bundle-per-worker × per-bake
  // ms IF the underlying GPU pipelines. If serialized at driver
  // level, the wall stays close to pool=1.
  //
  // CRUCIAL: this phase MUST come AFTER the main-thread sweep (Phase
  // 2). The Phase 2 bakes populate the MAIN-THREAD subscene cache,
  // not the worker pool's. The worker pool was warmed at app start by
  // warmupCharacterSceneCache. Its workers' caches should already be
  // warm IF those bakes went through the pool — they did because
  // `acquireClassAtlas` routes via the pool when ready.
  //
  // Per-bake timeout: if a worker hangs (GPU contention, init failure),
  // the whole phase wouldn't return without one. 30s cap per (bundle,
  // zoom) bake is generous — even the worst observed wall is ~150ms.
  const POOL_BAKE_TIMEOUT_MS = 30_000;
  const withTimeout = <T>(p: Promise<T>, label: string): Promise<T | null> =>
    new Promise<T | null>((resolve) => {
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        log.warn(`pool bake timeout (>${POOL_BAKE_TIMEOUT_MS}ms): ${label}`);
        resolve(null);
      }, POOL_BAKE_TIMEOUT_MS);
      p.then(
        (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          log.warn(`pool bake rejected: ${label}`, e);
          resolve(null);
        },
      );
    });
  const poolDispatchMeasurements: PoolDispatchMeasurement[] = [];
  if (isBakeWorkerPoolReady()) {
    log.info("phase 4aa: parallel-dispatch A/B via worker pool");
    for (const zoom of ZOOM_LEVELS) {
      const t0 = performance.now();
      const perBakeStart: number[] = new Array(characterBundles.length);
      const perBakeWall: number[] = new Array(characterBundles.length);
      const promises = characterBundles.map((bundle, i) => {
        perBakeStart[i] = performance.now();
        return withTimeout(
          bakeClassAtlasViaWorkerPool(bundle, zoom),
          `${bundle}@${zoom}`,
        ).then((r) => {
          perBakeWall[i] = performance.now() - perBakeStart[i];
          return r;
        });
      });
      const results = await Promise.all(promises);
      const parallelWall = performance.now() - t0;
      let serialSum = 0;
      let totalBytes = 0;
      let failed = 0;
      for (let i = 0; i < results.length; i++) {
        serialSum += perBakeWall[i] ?? 0;
        const r = results[i];
        if (!r) {
          failed += 1;
        } else {
          for (const p of r.pages) {
            totalBytes += p.atlasWidth * p.atlasHeight * 4;
          }
          // Close bitmaps to release the JS-side resource. Pool path
          // doesn't auto-upload to Pixi like the main-thread path; we
          // just dispose to avoid leaking the ImageBitmaps.
          for (const p of r.pages) {
            try {
              p.combinedBitmap.close();
            } catch {}
          }
        }
      }
      poolDispatchMeasurements.push({
        zoom,
        bundleCount: characterBundles.length,
        serialBakeMs: serialSum,
        parallelWallMs: parallelWall,
        totalBytes,
        failed,
      });
      log.info(
        `phase 4aa zoom${zoom}: parallel=${parallelWall.toFixed(0)}ms serialSum=${serialSum.toFixed(0)}ms ratio=${(serialSum / Math.max(parallelWall, 1)).toFixed(2)}× failed=${failed}`,
      );
      await yieldToHost();
    }
  } else {
    log.warn("phase 4aa: worker pool not ready, skipping parallel-dispatch A/B");
  }

  // --- Phase 4b: body_scene_cache stats (delta vs start) ---------------
  const bodySceneEnd = bodySceneCacheStats();

  // --- Phase 4c: Pixi byLabel snapshot ---------------------------------
  // Walk Pixi's managed-source registry and bucket GPU bytes by label
  // prefix (same algorithm as stress-test.ts:570-631). Tells us actual
  // GPU footprint per bake-kind (class:/var:/acc:/...) instead of the
  // per-bake bytesEst projection.
  const pixiLabels = snapshotPixiByLabel();

  // Bake-worker pool config — credit results to the right A/B arm.
  const poolConfig = getBakeWorkerPoolConfig();

  // --- Phase 5: emit the report ----------------------------------------
  const totalWall = performance.now() - sweepT0;
  const sections = buildReportSections({
    bundles,
    inventoryRollups,
    classEnumerations,
    classMeasurements,
    singleMeasurements,
    subsceneMeasurements,
    bodySceneStart,
    bodySceneEnd,
    pixiLabels,
    poolConfig,
    poolDispatchMeasurements,
    totalWallMs: totalWall,
  });
  // Emit each section as its own console.log. Tables are pre-chunked
  // so no individual emit hits DevTools' per-call truncation limit.
  // Each emit is prefixed with `chunk N/TOTAL` so the user (or me) can
  // verify nothing's missing when pasting the console back.
  const total = sections.length;
  for (let i = 0; i < total; i++) {
    console.log(`[chunk ${i + 1}/${total}]\n${sections[i]}`);
  }
  // Silent fallbacks for completeness — neither needs user attention:
  // - `window.__renderMeasurementReport` carries the full stitched
  //   report for anyone who DOES want to `copy(...)` it from the
  //   console.
  // - Auto-download writes a `.md` to the browser's download folder.
  //   Electron-based hosts usually accept this without a user gesture.
  const full = sections.join("\n");
  try {
    (globalThis as { __renderMeasurementReport?: string }).__renderMeasurementReport =
      full;
  } catch {
    // ignore
  }
  try {
    if (typeof document !== "undefined" && typeof URL !== "undefined") {
      const blob = new Blob([full], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `render-measurement-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } catch (e) {
    log.warn("auto-download failed", e);
  }
  // A/B switcher hint — paste one of these lines in DevTools console
  // then refresh the page to capture the next arm of the experiment.
  const isShard = poolConfig.shardByBundle;
  const isParallel = poolConfig.size > 1;
  const switcherLines: string[] = [
    "──────────────────────────────────────────────────",
    "RENDER_MEASUREMENT_SWEEP — A/B switcher (Electrobun: paste one line into DevTools console, then reload)",
    "──────────────────────────────────────────────────",
  ];
  if (!isParallel) {
    switcherLines.push(
      "  Test parallel-shard pool (4 workers, hash-by-bundle):",
      `    localStorage.setItem('bakePoolSize','4'); localStorage.setItem('bakeShard','1'); location.reload();`,
    );
  }
  if (isParallel && !isShard) {
    switcherLines.push(
      "  Test shard mode (your current pool=4 without shard = expected cache-thrash baseline):",
      `    localStorage.setItem('bakeShard','1'); location.reload();`,
    );
  }
  if (isParallel) {
    switcherLines.push(
      "  Revert to baseline (pool=1, default):",
      `    localStorage.removeItem('bakePoolSize'); localStorage.removeItem('bakeShard'); location.reload();`,
    );
  }
  if (!isParallel || !isShard) {
    switcherLines.push(
      "  Test cross-thrash regime (pool=4, round-robin, no shard — bad on purpose):",
      `    localStorage.setItem('bakePoolSize','4'); localStorage.removeItem('bakeShard'); location.reload();`,
    );
  }
  switcherLines.push(
    "──────────────────────────────────────────────────",
  );
  console.log(switcherLines.join("\n"));

  log.info(`sweep complete in ${totalWall.toFixed(0)}ms (${total} console chunks emitted)`);
}

interface ReportInput {
  bundles: string[];
  inventoryRollups: InventoryRollup[];
  classEnumerations: Map<string, ClassEnumerationDump | null>;
  classMeasurements: ClassAtlasMeasurement[];
  singleMeasurements: SingleVariantMeasurement[];
  subsceneMeasurements: BundleSubsceneMeasurement[];
  bodySceneStart: BodySceneCacheStats;
  bodySceneEnd: BodySceneCacheStats;
  pixiLabels: PixiLabelSnapshot[];
  poolConfig: { size: number; shardByBundle: boolean; ready: boolean };
  poolDispatchMeasurements: PoolDispatchMeasurement[];
  totalWallMs: number;
}

/** Build the report as an ordered list of sections (one string per
 *  section). Splitting lets the caller `console.log` each section
 *  separately so DevTools doesn't truncate any individual emit. */
function buildReportSections(input: ReportInput): string[] {
  const sections: string[] = [];

  // Header
  {
    const lines: string[] = [];
    lines.push("=== RENDER_MEASUREMENT_SWEEP: REPORT START ===");
    lines.push(`generatedAt=${new Date().toISOString()}`);
    lines.push(`totalWallMs=${input.totalWallMs.toFixed(0)}`);
    lines.push(`bundles=${input.bundles.length}`);
    lines.push(`zoomLevels=${ZOOM_LEVELS.join(",")}`);
    // Pool config attributes wall-time numbers to the right A/B arm.
    lines.push(
      `bakeWorkerPool size=${input.poolConfig.size} shardByBundle=${input.poolConfig.shardByBundle} ready=${input.poolConfig.ready}`,
    );
    sections.push(lines.join("\n"));
  }

  // 1. Bundle inventory rollup
  {
    const lines: string[] = [];
    lines.push("## 1. Bundle inventory rollup");
    lines.push("");
    lines.push(
      "| bundle | exports | sprites | shapes | morphs | bitmaps | charAnims | fightAnims | maxFrames | framesSum |",
    );
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const r of input.inventoryRollups) {
      lines.push(
        `| ${r.bundle} | ${r.allExports} | ${r.sprites} | ${r.shapes} | ${r.morphShapes} | ${r.bitmaps} | ${r.characterAnims} | ${r.fightAnims} | ${r.maxFrames} | ${r.totalFramesSum} |`,
      );
    }
    sections.push(lines.join("\n"));
  }

  // 2. Class enumeration
  {
    const lines: string[] = [];
    lines.push(
      "## 2. Class enumeration (`is_character_anim_name` filter pass-through)",
    );
    lines.push("");
    lines.push("| bundle | bFixUsed | exports | variantCount* | exportNames |");
    lines.push("|---|:--:|---:|---:|---|");
    for (const bundle of input.bundles) {
      const e = input.classEnumerations.get(bundle) ?? null;
      if (!e) {
        lines.push(`| ${bundle} | – | 0 | 0 | (none) |`);
        continue;
      }
      let variantCount = 0;
      for (const exp of e.exports) {
        const bFix = exp.exportBFix ? 2 : 1;
        const hat = exp.hasToggle ? 2 : 1;
        variantCount += bFix * hat;
      }
      const names = e.exports.map((x) => x.exportName).join(",");
      lines.push(
        `| ${bundle} | ${e.bundleBFixUsed ? "y" : "n"} | ${e.exports.length} | ${variantCount} | ${names} |`,
      );
    }
    lines.push(
      "*variantCount = sum over exports of (1+exportBFix?1:0)·(1+hasToggle?1:0)",
    );
    sections.push(lines.join("\n"));
  }

  // 3. Class atlas bake measurements (bundle × zoom)
  // Split into one chunk per zoom level so each console.log emit stays
  // small (~24 rows) and survives DevTools' per-emit truncation limit.
  const perZoomBytes = new Map<number, number>();
  const perZoomWall = new Map<number, number>();
  for (const m of input.classMeasurements) {
    perZoomBytes.set(m.zoom, (perZoomBytes.get(m.zoom) ?? 0) + m.bytesEst);
    perZoomWall.set(m.zoom, (perZoomWall.get(m.zoom) ?? 0) + m.wallMs);
  }
  {
    const header: string[] = [];
    header.push("## 3. Class atlas bake (one row per bundle × zoom)");
    header.push("");
    header.push(
      "*Split into one chunk per zoom level. Tables share the same column layout; concatenate the rows together for the full table.*",
    );
    sections.push(header.join("\n"));
  }
  for (const zoom of ZOOM_LEVELS) {
    const lines: string[] = [];
    const rows = input.classMeasurements.filter((m) => m.zoom === zoom);
    lines.push(`### 3.zoom${zoom} — class atlas bakes at zoom ${zoom} (${rows.length} bundles)`);
    lines.push("");
    lines.push(
      "| bundle | zoom | vars | pages | bytesEst | painted | pack% | wallMs | pageDims |",
    );
    lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
    for (const m of rows) {
      // pack% = painted / totalPixels — how much of the atlas is
      // actual content vs transparent padding/slack from the packer.
      const packPct =
        m.totalPixels > 0 ? (100 * m.paintedPixels) / m.totalPixels : 0;
      const paintedBytes = m.paintedPixels * 4;
      lines.push(
        `| ${m.bundle} | ${m.zoom} | ${m.variants} | ${m.pages} | ${formatBytes(m.bytesEst)} | ${formatBytes(paintedBytes)} | ${packPct.toFixed(0)}% | ${m.wallMs.toFixed(1)} | ${m.pageDims || "(failed)"} |`,
      );
    }
    sections.push(lines.join("\n"));
  }
  const grandTotalClassBytes = Array.from(perZoomBytes.values()).reduce(
    (a, b) => a + b,
    0,
  );
  const grandTotalClassWall = Array.from(perZoomWall.values()).reduce(
    (a, b) => a + b,
    0,
  );

  // 3a. Class atlas per-zoom totals
  {
    const lines: string[] = [];
    lines.push("### 3a. Class atlas per-zoom totals (sum across bundles)");
    lines.push("");
    lines.push("| zoom | totalBytes | totalWallMs |");
    lines.push("|---:|---:|---:|");
    for (const zoom of ZOOM_LEVELS) {
      lines.push(
        `| ${zoom} | ${formatBytes(perZoomBytes.get(zoom) ?? 0)} | ${(perZoomWall.get(zoom) ?? 0).toFixed(0)} |`,
      );
    }
    lines.push(
      `| ALL | ${formatBytes(grandTotalClassBytes)} | ${grandTotalClassWall.toFixed(0)} |`,
    );
    sections.push(lines.join("\n"));
  }

  // 4. Single-variant fight anim bakes
  // ~600 rows total (24 bundles × 5 anims × 5 zooms). Chunk one
  // console.log per bundle (~25 rows each) — well under DevTools'
  // per-emit truncation. Previous "one big section.push" got truncated
  // mid-row at ~half-table.
  const perZoomSingleBytes = new Map<number, number>();
  const perZoomSingleWall = new Map<number, number>();
  for (const m of input.singleMeasurements) {
    perZoomSingleBytes.set(
      m.zoom,
      (perZoomSingleBytes.get(m.zoom) ?? 0) + m.bytesEst,
    );
    perZoomSingleWall.set(
      m.zoom,
      (perZoomSingleWall.get(m.zoom) ?? 0) + m.wallMs,
    );
  }
  {
    const header: string[] = [];
    header.push("## 4. Single-variant bakes (sampled fight anims)");
    header.push("");
    header.push(
      "*Split into one chunk per bundle. Tables share the same column layout; concatenate the rows together for the full table.*",
    );
    sections.push(header.join("\n"));
  }
  // Group rows by bundle (ordered by first occurrence).
  const rowsByBundle = new Map<string, SingleVariantMeasurement[]>();
  for (const m of input.singleMeasurements) {
    let bucket = rowsByBundle.get(m.bundle);
    if (!bucket) {
      bucket = [];
      rowsByBundle.set(m.bundle, bucket);
    }
    bucket.push(m);
  }
  for (const [bundle, rows] of rowsByBundle) {
    const lines: string[] = [];
    lines.push(`### 4.${bundle} — single-variant bakes for ${bundle} (${rows.length} rows)`);
    lines.push("");
    lines.push(
      "| bundle | export | zoom | bFix | hat | frames | atlasDims | bytesEst | wallMs |",
    );
    lines.push("|---|---|---:|:--:|:--:|---:|---|---:|---:|");
    for (const m of rows) {
      const dims =
        m.atlasWidth && m.atlasHeight
          ? `${m.atlasWidth}x${m.atlasHeight}`
          : "(failed)";
      lines.push(
        `| ${m.bundle} | ${m.exportName} | ${m.zoom} | ${m.applyBFix ? "y" : "n"} | ${m.hatEquipped ? "y" : "n"} | ${m.frameCount} | ${dims} | ${formatBytes(m.bytesEst)} | ${m.wallMs.toFixed(1)} |`,
      );
    }
    sections.push(lines.join("\n"));
  }

  // 4a. Single-variant per-zoom totals
  {
    const lines: string[] = [];
    lines.push(
      "### 4a. Single-variant per-zoom totals (sum over sampled anims × bundles)",
    );
    lines.push("");
    lines.push("| zoom | totalBytes | totalWallMs |");
    lines.push("|---:|---:|---:|");
    for (const zoom of ZOOM_LEVELS) {
      lines.push(
        `| ${zoom} | ${formatBytes(perZoomSingleBytes.get(zoom) ?? 0)} | ${(perZoomSingleWall.get(zoom) ?? 0).toFixed(0)} |`,
      );
    }
    sections.push(lines.join("\n"));
  }

  // 5. Subscene cache size per bundle (IDB blob)
  let totalSubsceneEnd = 0;
  {
    const lines: string[] = [];
    lines.push("## 5. Subscene cache size per bundle (IDB blob)");
    lines.push("");
    lines.push(
      "| bundle | entriesStart | entriesEnd | bytesStart | bytesEnd | delta |",
    );
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const m of input.subsceneMeasurements) {
      const delta = m.serializedBytesEnd - m.serializedBytesStart;
      totalSubsceneEnd += Math.max(0, m.serializedBytesEnd);
      lines.push(
        `| ${m.bundle} | ${m.entryCountStart} | ${m.entryCountEnd} | ${formatBytes(m.serializedBytesStart)} | ${formatBytes(m.serializedBytesEnd)} | ${formatBytes(delta)} |`,
      );
    }
    lines.push(`| ALL | – | – | – | ${formatBytes(totalSubsceneEnd)} | – |`);
    sections.push(lines.join("\n"));
  }

  // 7. body_scene_cache stats (delta vs sweep start)
  {
    const lines: string[] = [];
    lines.push("## 7. body_scene_cache stats (composed-atlas LRU)");
    lines.push("");
    lines.push(
      "*Cap=1500. Hits/misses/evictions are cumulative since renderer init. Deltas = (end - start) attribute the sweep's contribution. v3 hypothesised the LRU thrashes under stress; this measures it.*",
    );
    lines.push("");
    const hitsDelta = input.bodySceneEnd.hits - input.bodySceneStart.hits;
    const missesDelta =
      input.bodySceneEnd.misses - input.bodySceneStart.misses;
    const evictsDelta =
      input.bodySceneEnd.evictions - input.bodySceneStart.evictions;
    const deltaAccesses = hitsDelta + missesDelta;
    const deltaHitRate =
      deltaAccesses > 0 ? (100 * hitsDelta) / deltaAccesses : 0;
    lines.push("| metric | start | end | delta |");
    lines.push("|---|---:|---:|---:|");
    lines.push(
      `| entries | ${input.bodySceneStart.entries} | ${input.bodySceneEnd.entries} | ${input.bodySceneEnd.entries - input.bodySceneStart.entries} |`,
    );
    lines.push(
      `| hits | ${input.bodySceneStart.hits} | ${input.bodySceneEnd.hits} | ${hitsDelta} |`,
    );
    lines.push(
      `| misses | ${input.bodySceneStart.misses} | ${input.bodySceneEnd.misses} | ${missesDelta} |`,
    );
    lines.push(
      `| evictions | ${input.bodySceneStart.evictions} | ${input.bodySceneEnd.evictions} | ${evictsDelta} |`,
    );
    lines.push(
      `| hitRate (sweep delta) | – | – | ${deltaHitRate.toFixed(1)}% |`,
    );
    lines.push(
      `| cap | ${input.bodySceneEnd.cap} | ${input.bodySceneEnd.cap} | – |`,
    );
    sections.push(lines.join("\n"));
  }

  // 8. Pixi byLabel snapshot — actual GPU bytes per bake-kind
  {
    const lines: string[] = [];
    lines.push("## 8. Pixi managed sources by label prefix");
    lines.push("");
    lines.push(
      "*Snapshot taken at sweep end. Label prefix is the first segment before `:|@#`. Useful labels: `class` (class atlas pages), `var` (single-variant fight-anim atlases), `acc` (accessory strips). GPU bytes = pixelWidth × pixelHeight × 4 per live source.*",
    );
    lines.push("");
    lines.push("| labelPrefix | count | gpuBytes | bitmapBytes |");
    lines.push("|---|---:|---:|---:|");
    let totalGpu = 0;
    let totalBitmap = 0;
    for (const row of input.pixiLabels) {
      totalGpu += row.gpuBytes;
      totalBitmap += row.bitmapBytes;
      lines.push(
        `| ${row.label} | ${row.count} | ${formatBytes(row.gpuBytes)} | ${formatBytes(row.bitmapBytes)} |`,
      );
    }
    lines.push(
      `| ALL | – | ${formatBytes(totalGpu)} | ${formatBytes(totalBitmap)} |`,
    );
    sections.push(lines.join("\n"));
  }

  // 9. Worker-pool parallel-dispatch A/B
  {
    const lines: string[] = [];
    lines.push(
      `## 9. Worker-pool parallel-dispatch (pool size=${input.poolConfig.size}, shardByBundle=${input.poolConfig.shardByBundle})`,
    );
    lines.push("");
    lines.push(
      "*All character bundles dispatched in parallel via bake-worker-pool's `Promise.all`. `parallelWallMs` is the wall from first dispatch to last completion. `serialBakeMs` is the sum of per-bake walls (= what pool=1 would take). `speedup = serialBakeMs / parallelWallMs`. With pool=1 speedup ≈ 1.0; with pool=N+shard, speedup approaches N if the GPU pipelines, stays ≈ 1.0 if the driver serializes.*",
    );
    lines.push("");
    if (input.poolDispatchMeasurements.length === 0) {
      lines.push("_(worker pool not ready — phase skipped)_");
    } else {
      lines.push("| zoom | bundles | serialSum | parallelWall | speedup | failed |");
      lines.push("|---:|---:|---:|---:|---:|---:|");
      for (const m of input.poolDispatchMeasurements) {
        const speedup =
          m.parallelWallMs > 0 ? m.serialBakeMs / m.parallelWallMs : 0;
        lines.push(
          `| ${m.zoom} | ${m.bundleCount} | ${m.serialBakeMs.toFixed(0)}ms | ${m.parallelWallMs.toFixed(0)}ms | ${speedup.toFixed(2)}× | ${m.failed} |`,
        );
      }
    }
    sections.push(lines.join("\n"));
  }

  // 6. Summary numbers
  {
    const lines: string[] = [];
    lines.push("## 6. Summary numbers");
    lines.push("");
    const classBytesPerBundleSumAcrossZooms = new Map<string, number>();
    for (const m of input.classMeasurements) {
      classBytesPerBundleSumAcrossZooms.set(
        m.bundle,
        (classBytesPerBundleSumAcrossZooms.get(m.bundle) ?? 0) + m.bytesEst,
      );
    }
    let totalClassBytesAllZooms = 0;
    for (const v of classBytesPerBundleSumAcrossZooms.values())
      totalClassBytesAllZooms += v;
    const avgClassBytesPerBundle =
      classBytesPerBundleSumAcrossZooms.size > 0
        ? totalClassBytesAllZooms / classBytesPerBundleSumAcrossZooms.size
        : 0;

    let totalSingleBytesAllZooms = 0;
    for (const m of input.singleMeasurements)
      totalSingleBytesAllZooms += m.bytesEst;

    let maxClassWallSingleZoom = 0;
    for (const wall of perZoomWall.values()) {
      if (wall > maxClassWallSingleZoom) maxClassWallSingleZoom = wall;
    }

    // Per-zoom GPU memory if every loaded bundle's class atlas at THAT zoom
    // were live at once — the "how big is one zoom's body footprint?"
    // answer.
    const perZoomGpu: string[] = [];
    for (const zoom of ZOOM_LEVELS) {
      perZoomGpu.push(
        `zoom${zoom}=${formatBytes(perZoomBytes.get(zoom) ?? 0)}`,
      );
    }

    lines.push(`bundleCount=${input.bundles.length}`);
    lines.push(`zoomLevelCount=${ZOOM_LEVELS.length}`);
    lines.push(
      `classAtlasBytesPerZoomIfAllVisible=${perZoomGpu.join(" ")}`,
    );
    lines.push(
      `totalClassAtlasBytesAllZooms=${formatBytes(totalClassBytesAllZooms)}`,
    );
    lines.push(
      `avgClassAtlasBytesPerBundleAllZooms=${formatBytes(avgClassBytesPerBundle)}`,
    );
    lines.push(
      `totalClassAtlasWallAllZooms=${grandTotalClassWall.toFixed(0)}ms`,
    );
    lines.push(
      `maxClassAtlasWallSingleZoom=${maxClassWallSingleZoom.toFixed(0)}ms (= sum across bundles for the slowest zoom level)`,
    );
    lines.push(
      `totalSampledFightAnimBytesAllZooms=${formatBytes(totalSingleBytesAllZooms)}`,
    );
    lines.push(
      `totalSubsceneSerializedBytes=${formatBytes(totalSubsceneEnd)} (IDB blob size for all bundles' subscenes)`,
    );
    lines.push(`sweepWallMs=${input.totalWallMs.toFixed(0)}`);
    lines.push("");
    lines.push("=== RENDER_MEASUREMENT_SWEEP: REPORT END ===");
    sections.push(lines.join("\n"));
  }

  return sections;
}
