/**
 * Stress test for the player + accessory rendering pipeline.
 *
 * Spawns N bots with random looks (random class, accessories, colors)
 * and runs a perpetual roleplay-style movement loop per bot:
 *   1. Pick a random walkable cell.
 *   2. Compute a path via `DofusPathfinding.findPath`.
 *   3. Call `renderer.movePlayer(id, path)` — animates the walk.
 *   4. Await arrival.
 *   5. Idle briefly, then go to step 1.
 *
 * Wired into `window.spawnTestPlayers` / `window.despawnTestPlayers` /
 * `window.__getTestPlayerCount` by `BattlefieldScene`. Also driven by
 * the in-game `<StressTestPanel>` React component.
 *
 * Validates that:
 *   - `PlayerStripRenderer` + accessory composition holds up under N
 *     concurrent characters cycling animations frequently.
 *   - `renderSwfStripRangeAccessorized` per-anim-swap cost is realistic
 *     (each path traversal triggers walkR/walkL/walkF/walkB swaps).
 *   - The render-watchdog auto-halts before GPU saturation, and the
 *     emergency-halt callback cleanly tears down all bots.
 *
 * SAFETY: HARD_CAP below is an absolute ceiling — every spawn call
 * clamps N to it. Per-player movement loops are independent so
 * dispatches scatter across the period rather than spiking on a
 * shared tick.
 */
import type { DofusPathfinding } from "@dofus/grid";
import { Ticker, UPDATE_PRIORITY } from "pixi.js";

import type { CellData } from "@/game/datacenter/cell";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import { getRenderWatchdog } from "@/game/render/render-watchdog";
import { getCharacterCache } from "@/game/render/character-cache";
import {
  getActivePlayerStripRendererAnimDiagnostics,
  getActivePlayerStripRendererStats,
} from "@/game/render/player-strip-renderer-v2";
import {
  type ProbeKey,
  readAndResetProbes,
} from "@/game/render/render-probes";
import { getStripBakeQueue } from "@/game/render/strip-bake-queue";
import {
  type BakeRecord,
  drainBakeTelemetry,
  getDeferredDestroyStats,
  getLiveRenderTextureCount,
  getLiveRenderTextureIdCount,
  getLiveSpellInstanceCount,
  getLoadedSwfBundleCount,
  getPathCacheStats,
  getPixiRenderer,
  getRustGpuByteStats,
  getRustGpuObjectCounts,
  getRustTexturesCount,
  getWasmHeapBytes,
  swfBundleExports,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("StressTest");

/** Byte cost per texel for the formats Pixi/Vello produce. Used by
 *  the stress-test memory accounting block to size each managed Pixi
 *  source. Conservative fallback to 4 bytes (the most common case)
 *  for any format string we don't recognise — better to over-count
 *  than to silently hide bytes in the unaccounted bucket. */
function bytesPerPixelOfFormat(format: string): number {
  switch (format) {
    case "r8unorm":
    case "r8snorm":
    case "r8uint":
    case "r8sint":
      return 1;
    case "rg8unorm":
    case "rg8snorm":
    case "rg8uint":
    case "rg8sint":
    case "r16uint":
    case "r16sint":
    case "r16float":
      return 2;
    case "rgba8unorm":
    case "rgba8unorm-srgb":
    case "rgba8snorm":
    case "rgba8uint":
    case "rgba8sint":
    case "bgra8unorm":
    case "bgra8unorm-srgb":
    case "rgba16float": // 8 actually — handled below
      return format === "rgba16float" ? 8 : 4;
    case "rgba16uint":
    case "rgba16sint":
      return 8;
    case "rgba32float":
    case "rgba32uint":
    case "rgba32sint":
      return 16;
    case "depth16unorm":
      return 2;
    case "depth24plus":
    case "depth24plus-stencil8":
    case "depth32float":
      return 4;
    default:
      return 4;
  }
}

/**
 * gfxIds known to render via the new SWF pipeline. The full vanilla
 * Dofus 1.29 set is `(class * 10) + gender` for class 1..12, gender 0/1
 * — i.e. 10/11, 20/21, …, 120/121 — but a few classes have asset gaps
 * in the public archive; this curated list is the safe subset.
 */
const KNOWN_GFX_IDS = [
  10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91, 100,
  101, 110, 111, 120, 121,
];

// Accessory bundles loaded by `accessory-resolver.ts`. The stress test
// enumerates every export in each bundle on first use and groups them
// by AS2 type code, so the picker draws from EVERY available
// accessory rather than a hand-curated subset. This mirrors how real
// players gear up — distribution stays representative as the asset
// pack grows.
const ACCESSORY_BUNDLE_NAMES = [
  "acc-a1", "acc-a2", "acc-a3", "acc-a4", "acc-a5",
  "acc-a6", "acc-a7", "acc-a8", "acc-default", "acc-autres",
] as const;

/** AS2 type codes for each slot — used to filter the per-bundle export list. */
const ACCESSORY_TYPES_BY_SLOT = {
  weapon: 6,  // look[0]
  hat: 16,    // look[1]
  cape: 17,   // look[2]
  shield: 82, // look[4]
} as const;

interface AccessoryPools {
  hats: number[];
  weapons: number[];
  capes: number[];
  shields: number[];
}

let cachedPools: AccessoryPools | null = null;

function buildAccessoryPools(): AccessoryPools {
  if (cachedPools) return cachedPools;
  const hats = new Set<number>();
  const weapons = new Set<number>();
  const capes = new Set<number>();
  const shields = new Set<number>();
  for (const bundle of ACCESSORY_BUNDLE_NAMES) {
    for (const exportName of swfBundleExports(bundle)) {
      // Export names follow `TYPE_GFXID` (e.g. `16_42`). Skip
      // anything that doesn't parse — accessory bundles also expose
      // helper symbols (textures, masks) we don't want to pick.
      const m = /^(\d+)_(\d+)$/.exec(exportName);
      if (!m) continue;
      const type = Number(m[1]);
      const gfx = Number(m[2]);
      if (!Number.isFinite(type) || !Number.isFinite(gfx)) continue;
      if (type === ACCESSORY_TYPES_BY_SLOT.weapon) weapons.add(gfx);
      else if (type === ACCESSORY_TYPES_BY_SLOT.hat) hats.add(gfx);
      else if (type === ACCESSORY_TYPES_BY_SLOT.cape) capes.add(gfx);
      else if (type === ACCESSORY_TYPES_BY_SLOT.shield) shields.add(gfx);
    }
  }
  cachedPools = {
    hats: [...hats].sort((a, b) => a - b),
    weapons: [...weapons].sort((a, b) => a - b),
    capes: [...capes].sort((a, b) => a - b),
    shields: [...shields].sort((a, b) => a - b),
  };
  log.info(
    `accessory pools (from real exports): ` +
      `weapons=${cachedPools.weapons.length} hats=${cachedPools.hats.length} ` +
      `capes=${cachedPools.capes.length} shields=${cachedPools.shields.length}`,
  );
  return cachedPools;
}

/**
 * Hard ceiling on concurrent test players. Set to Infinity so we
 * can probe arbitrary scale and watch the curve break.
 *
 * NOTE: the shared composition atlas
 * (`COMPOSITION_SLOT_SIZE × COMPOSITION_SLOT_SIZE` grid in a 4096²
 * RT) caps visible bots at **256 slots** today — bots beyond that
 * get a null slot from `atlas.acquireSlot()` and stay invisible,
 * but their movement + frame ticks still run (useful for measuring
 * CPU-side scaling). If you need >256 visibly rendered bots,
 * implement multi-page atlas allocation in
 * `composition-atlas.ts`.
 */
const HARD_CAP = Number.POSITIVE_INFINITY;
/** Soft warning threshold — keeps the dev console honest about
 *  cost. Bumped to the atlas slot ceiling so the warning fires
 *  exactly when bots stop being visible. */
const SOFT_WARN = 256;
/**
 * Min ms between consecutive spawns. Was 50ms back when `addPlayer`
 * blocked on a synchronous strip bake (~5ms each + GPU queue drain).
 * Now strip bakes go through the per-frame-budgeted queue
 * (`getStripBakeQueue`) so `addPlayer` returns nearly immediately;
 * spawn ramp is dominated by Pixi container construction (~1ms).
 * 5ms keeps the JS loop responsive between bots without artificially
 * gating throughput.
 */
const MIN_SPAWN_INTERVAL_MS = 5;
const TEST_PLAYER_ID_BASE = 9_000_000;
/** Idle pause at each destination before picking the next target. */
const MIN_DEST_IDLE_MS = 200;
const MAX_DEST_IDLE_MS = 1200;

export interface SpawnOptions {
  /** Per-spawn delay in ms — staggers GPU queue pressure during big batches. */
  delayMs?: number;
}

interface ActivePlayer {
  id: number;
  /** Resolved by `despawn` to interrupt any in-flight `movePlayer` await. */
  cancel: () => void;
  cancelled: Promise<void>;
}

const activePlayers = new Map<number, ActivePlayer>();
let watchdogUnsubscribe: (() => void) | null = null;

// ── Live monitor (5s console snapshot) ─────────────────────────────
//
// Counters are module-global because they're shared across all bots
// and the monitor reads them once per tick. Each `movePlayer` await
// completing increments `traversalsCompleted`; `traversalsInflight`
// is the count of bots whose movement loop is currently awaiting an
// arrival (vs. picking a target / idling at a destination).
let traversalsStarted = 0;
let traversalsCompleted = 0;
let traversalsInflight = 0;
let monitorHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Per-frame ticker-callback duration tracker. Goal: distinguish
 * "our code is getting slower" from "browser-side cost is growing"
 * when `frameMsAvg` degrades.
 *
 * Mechanism: register one callback at `INTERACTION` priority (runs
 * FIRST in each Ticker.shared tick) to capture the start timestamp,
 * and another at `UTILITY` priority (runs LAST) to compute the
 * delta. The delta is the total time spent in ALL Ticker.shared
 * callbacks for that frame — Pixi's render, our cache tick, the
 * deferred-destroy tick, plus anything else registered on the
 * shared ticker.
 *
 * Interpretation:
 *  - tickerMsAvg grows alongside frameMsAvg → slowdown is in our
 *    ticker-driven code (Pixi internals, our systems). Drill into
 *    individual callback timings next.
 *  - tickerMsAvg stays flat while frameMsAvg grows → slowdown is
 *    outside the ticker (browser GPU process, compositor, JS GC).
 *    Not fixable from app code without architectural change.
 */
let tickerFrameStart = 0;
let tickerSumMs = 0;
let tickerMaxMs = 0;
let tickerSamples = 0;
let tickerInstrumented = false;
function ensureTickerInstrumented(): void {
  if (tickerInstrumented) return;
  tickerInstrumented = true;
  Ticker.shared.add(
    () => {
      tickerFrameStart = performance.now();
    },
    null,
    UPDATE_PRIORITY.INTERACTION,
  );
  Ticker.shared.add(
    () => {
      if (tickerFrameStart > 0) {
        const dur = performance.now() - tickerFrameStart;
        tickerSumMs += dur;
        if (dur > tickerMaxMs) tickerMaxMs = dur;
        tickerSamples += 1;
      }
    },
    null,
    UPDATE_PRIORITY.UTILITY,
  );
}
function readAndResetTickerStats(): {
  avgMs: number;
  maxMs: number;
  samples: number;
} {
  const samples = tickerSamples;
  const out = {
    avgMs: samples > 0 ? tickerSumMs / samples : 0,
    maxMs: tickerMaxMs,
    samples,
  };
  tickerSumMs = 0;
  tickerMaxMs = 0;
  tickerSamples = 0;
  return out;
}
let monitorLastSnapshotAt = 0;
let monitorLastCompletedAt = 0;
let monitorLastStartedAt = 0;
const MONITOR_INTERVAL_MS = 5000;

// Deterministic look generation for cross-session cache validation.
// When `seededRng` is set (via spawnBurst's `seed` opt), every random
// draw comes from a seeded PRNG so two spawn batches with the same
// seed produce IDENTICAL rosters — mirroring "revisit the same map,
// same actors", which is when the persisted cache should fully hit.
// Cleared at the end of the seeded batch.
let seededRng: (() => number) | null = null;
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rnd(): number {
  return seededRng ? seededRng() : Math.random();
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)] as T;
}

function randomColor(): number {
  return Math.floor(rnd() * 0xffffff);
}

/**
 * Test knob for appearance diversity. When `window.__stressLookPoolSize`
 * is > 0, every bot draws from a fixed pool of that many distinct
 * pre-generated looks instead of an individually-unique random look.
 *
 * Why: the default (fully-random 24-bit colours per bot) makes the
 * `(sig|frame)` look-cache working set scale with bot count without
 * bound, which conflates *render throughput* with *cache capacity* in a
 * scaling benchmark. A fixed pool models a realistic map — many players
 * share class + gear — and keeps the working set constant so a
 * bot-count sweep measures pure render cost. Default 0 = unchanged
 * fully-unique behaviour.
 */
let lookPool: string[] | null = null;
let lookPoolBuiltFor = -1;
function currentLookPoolSize(): number {
  const w = globalThis as unknown as { __stressLookPoolSize?: number };
  const n = w.__stressLookPoolSize ?? 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function buildRandomLook(): string {
  const poolSize = currentLookPoolSize();
  if (poolSize > 0) {
    if (!lookPool || lookPoolBuiltFor !== poolSize) {
      // Build the pool deterministically (fixed seed) so it's stable
      // across spawn calls within a run; restore the prior RNG after.
      const prev = seededRng;
      seededRng = mulberry32(0x57170000 ^ poolSize);
      lookPool = Array.from({ length: poolSize }, buildRandomLookRaw);
      seededRng = prev;
      lookPoolBuiltFor = poolSize;
    }
    return pick(lookPool);
  }
  return buildRandomLookRaw();
}

function buildRandomLookRaw(): string {
  const gfx = pick(KNOWN_GFX_IDS);
  const c1 = randomColor();
  const c2 = randomColor();
  const c3 = randomColor();
  const pools = buildAccessoryPools();
  // Each slot is "type_gfxId" or empty if no accessory for that slot.
  const slots: string[] = ["", "", "", "", ""];
  // 80% wear per slot — production-like distribution per
  // `RENDER_SCALING_PLAN.md` step 10. Each pool comes from the actual
  // loaded accessory bundles, so the picker stays in sync with the
  // asset pack without a hand-curated list.
  if (pools.weapons.length > 0 && rnd() < 0.8) {
    slots[0] = `6_${pick(pools.weapons)}`;
  }
  if (pools.hats.length > 0 && rnd() < 0.8) {
    slots[1] = `16_${pick(pools.hats)}`;
  }
  if (pools.capes.length > 0 && rnd() < 0.8) {
    slots[2] = `17_${pick(pools.capes)}`;
  }
  // Pet (look[3], type 18) — no body-part mount in player SWFs; skipped.
  if (pools.shields.length > 0 && rnd() < 0.8) {
    slots[4] = `82_${pick(pools.shields)}`;
  }
  return `${gfx}|${c1}|${c2}|${c3}|${slots.join(",")}`;
}

function isWalkable(cell: CellData): boolean {
  return (
    cell.active === true &&
    (cell.movement ?? 0) > 1 &&
    cell.lineOfSight !== false
  );
}

function pickRandomCell(cells: CellData[]): CellData | null {
  // Build the walkable subset once per call. With ~80 walkable cells per
  // typical map and N bots picking targets independently, this is fine.
  const active = cells.filter(isWalkable);
  if (active.length === 0) {
    return null;
  }
  return active[Math.floor(Math.random() * active.length)] ?? null;
}

/**
 * Per-bot scoped sleep helper. Attaches ONE `.then()` to `cancelled`
 * (vs the previous one-per-call sleep). At 200 bots × ~5 sleeps/sec
 * each, this cuts ~1000 attached-handler entries/sec off the
 * cancelled Promise's handler list — and the matching `.then()`-
 * returned Promise allocations that feed major-GC pressure (see
 * Phase B in RENDER_SCALING_PLAN.md).
 */
function makeBotSleep(cancelled: Promise<void>): (ms: number) => Promise<void> {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  let cancelledFired = false;
  void cancelled.then(() => {
    cancelledFired = true;
    for (const h of pending) clearTimeout(h);
    pending.clear();
  });
  return (ms: number) => {
    if (cancelledFired) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const h = setTimeout(() => {
        pending.delete(h);
        resolve();
      }, ms);
      pending.add(h);
    });
  };
}

/**
 * Snapshot every 5s: render watchdog (FPS, frame timings, GPU resources),
 * Vello WASM (live textures, spell instances, bundles, path cache),
 * and stress-test internals (active bots, traversal rate, in-flight
 * walks). Stops itself once the last bot despawns.
 */
/**
 * Aggregate per-bake records into per-kind buckets with p50/p95/p99
 * percentiles. Computed inline because there are at most ~10k records
 * per drain, and a single sort of total_ms per bucket suffices.
 *
 * Why percentiles instead of avg+max: zoom-rebake bursts have a long
 * tail (the last bakes serve big variants at the new zoom); p99 tells
 * us that tail explicitly while avg gets dragged toward the median.
 */
interface BakeAggBucket {
  count: number;
  totalMs: number;
  /** ms percentiles over `totalMs` field. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Sums over the bucket — divide by `count` for averages. */
  sumSceneMs: number;
  sumGpuMs: number;
  sumBridgeMs: number;
  sumPixelArea: number;
  subsceneHits: number;
  subsceneMisses: number;
}

interface BakeAggResult {
  drops: number;
  byKind: Map<string, BakeAggBucket>;
}

function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((sortedAsc.length - 1) * q)),
  );
  return sortedAsc[idx];
}

function aggregateBakeTelemetry(records: BakeRecord[]): BakeAggResult {
  const byKind = new Map<string, BakeAggBucket>();
  // Per-kind ms arrays for percentile computation. Built once, sorted
  // when computing percentiles.
  const totals = new Map<string, number[]>();
  for (const r of records) {
    let bucket = byKind.get(r.kind);
    if (!bucket) {
      bucket = {
        count: 0,
        totalMs: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        max: 0,
        sumSceneMs: 0,
        sumGpuMs: 0,
        sumBridgeMs: 0,
        sumPixelArea: 0,
        subsceneHits: 0,
        subsceneMisses: 0,
      };
      byKind.set(r.kind, bucket);
      totals.set(r.kind, []);
    }
    bucket.count += 1;
    bucket.totalMs += r.totalMs;
    bucket.max = Math.max(bucket.max, r.totalMs);
    bucket.sumSceneMs += r.sceneBuildMs;
    bucket.sumGpuMs += r.gpuRenderMs;
    bucket.sumBridgeMs += r.bridgeMs;
    bucket.sumPixelArea += r.pixelArea;
    bucket.subsceneHits += r.subsceneHits;
    bucket.subsceneMisses += r.subsceneMisses;
    totals.get(r.kind)!.push(r.totalMs);
  }
  for (const [kind, msList] of totals) {
    msList.sort((a, b) => a - b);
    const b = byKind.get(kind)!;
    b.p50 = percentile(msList, 0.5);
    b.p95 = percentile(msList, 0.95);
    b.p99 = percentile(msList, 0.99);
  }
  return { drops: 0, byKind };
}

function logMonitorSnapshot(): void {
  const now = performance.now();
  const dt = (now - monitorLastSnapshotAt) / 1000;
  monitorLastSnapshotAt = now;

  const completedDelta = traversalsCompleted - monitorLastCompletedAt;
  const startedDelta = traversalsStarted - monitorLastStartedAt;
  monitorLastCompletedAt = traversalsCompleted;
  monitorLastStartedAt = traversalsStarted;
  // Drain ticker stats ONCE per snapshot; reuse for both JSON and
  // text output. Reading twice would reset the accumulator between
  // reads and the text monitor would see zeros.
  const tickerStats = readAndResetTickerStats();
  // Drain the render-pipeline probes (per-bake cost, per-drain cost,
  // per-composeBot cost) within the same window so all per-frame
  // averages share the same `tickerStats.samples` denominator.
  const probes = readAndResetProbes();
  // Drain Rust-side bake telemetry within the same snapshot window.
  // Each record covers one wasm-bindgen bake call (class atlas,
  // body atlas, accessory strip, tile frame, ...) with per-phase
  // ms, subscene hit/miss, and pixel area. We aggregate into
  // per-kind buckets so the monitor can show "where time goes"
  // without dumping the raw stream.
  const bakeTelemetry = drainBakeTelemetry();
  const bakeAgg = aggregateBakeTelemetry(bakeTelemetry.records);
  bakeAgg.drops = bakeTelemetry.drops;
  const frames = tickerStats.samples;
  /** Pack a counter for emission: ms/call + ms/frame (using the same
   *  frame count as `tickerMsAvg`). `perFrameMs` is what to compare
   *  against `tickerMsAvg` and the 16.67 ms frame budget. */
  const packProbe = (
    p: typeof probes[ProbeKey],
  ): { count: number; totalMs: number; maxMs: number; avgMs: number; perFrameMs: number } => ({
    count: p.count,
    totalMs: p.totalMs,
    maxMs: p.maxMs,
    avgMs: p.count > 0 ? p.totalMs / p.count : 0,
    perFrameMs: frames > 0 ? p.totalMs / frames : 0,
  });

  const wd = getRenderWatchdog();
  const snap = wd.getSnapshot();
  const pc = (() => {
    try {
      return getPathCacheStats();
    } catch {
      return null;
    }
  })();
  const bakeQueue = getStripBakeQueue().getStats();
  const charCache = getCharacterCache().getStats();
  const acquireStats = getCharacterCache().getAcquireStats();
  const stripStats = getActivePlayerStripRendererStats();
  const animDiag = getActivePlayerStripRendererAnimDiagnostics();
  const cacheTotal = charCache.classAtlasBytes + charCache.accBytes;
  const cacheReqs = charCache.hits + charCache.misses;
  const hitRate = cacheReqs > 0 ? (charCache.hits / cacheReqs) * 100 : 0;

  // Memory subsystem telemetry — gives us per-bucket attribution so
  // we can localise growth instead of just staring at Activity
  // Monitor's process total.
  const defStats = getDeferredDestroyStats();
  const rustTexCount = getRustTexturesCount();
  const wasmHeapBytes = getWasmHeapBytes();
  const rustBytes = getRustGpuByteStats();
  const rustObjs = getRustGpuObjectCounts();
  // Pixi-side managed-source counts + accounting (best effort —
  // depends on Pixi v8 internals being accessible). Each entry of
  // `_managedTextures.items` is a `TextureSource`; we sum its
  // estimated GPU bytes (pixelWidth × pixelHeight × bytesPerPixel)
  // and, when the underlying `resource` is still an `ImageBitmap`
  // (i.e. the bitmap hasn't been .close()'d), its CPU/browser bytes
  // too. Pixi keeps `source.resource = bitmap` alive forever unless
  // we close it ourselves, so every uncloced bitmap doubles the
  // working set of that source.
  let pixiManagedSources = -1;
  let pixiBindGroupHash = -1;
  let pixiGpuBytes = 0;
  let pixiBitmapBytes = 0;
  const pixiByLabel = new Map<
    string,
    { count: number; gpuBytes: number; bitmapBytes: number }
  >();
  try {
    const renderer = getPixiRenderer() as unknown as
      | {
          texture?: {
            _managedTextures?: { items?: Record<string, unknown> };
            _bindGroupHash?: Record<string, unknown>;
          };
        }
      | null;
    const sys = renderer?.texture;
    if (sys?._managedTextures?.items) {
      // `GCManagedHash.remove()` sets `items[uid] = null` rather
      // than deleting — so `Object.values(items)` returns a mix of
      // live sources and nulls. Filter the nulls before iterating;
      // count only live sources for `managedSources`. Without this
      // the iteration throws on the first null and the catch
      // swallows the rest, leaving most sources unaccounted for.
      const items = sys._managedTextures.items as Record<string, unknown>;
      const liveSources = Object.values(items).filter(
        (s): s is Record<string, unknown> => s !== null && s !== undefined,
      );
      pixiManagedSources = liveSources.length;
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
        const bpp = bytesPerPixelOfFormat(s.format ?? "rgba8unorm");
        const gpuBytes = w * h * bpp;
        pixiGpuBytes += gpuBytes;
        let bitmapBytes = 0;
        const resource = s.resource;
        if (
          resource &&
          typeof (resource as { close?: () => void }).close === "function" &&
          typeof (resource as { width?: number }).width === "number"
        ) {
          const bm = resource as { width: number; height: number };
          bitmapBytes = bm.width * bm.height * 4;
          pixiBitmapBytes += bitmapBytes;
        }
        const labelPrefix =
          (s.label ?? "(unlabeled)").split(/[:|@]/)[0] || "(other)";
        const bucket = pixiByLabel.get(labelPrefix) ?? {
          count: 0,
          gpuBytes: 0,
          bitmapBytes: 0,
        };
        bucket.count += 1;
        bucket.gpuBytes += gpuBytes;
        bucket.bitmapBytes += bitmapBytes;
        pixiByLabel.set(labelPrefix, bucket);
      }
    }
    if (sys?._bindGroupHash) {
      pixiBindGroupHash = Object.keys(sys._bindGroupHash).length;
    }
  } catch {
    // ignore — instrumentation is best-effort
  }

  const completedPerSec = dt > 0 ? completedDelta / dt : 0;
  const startedPerSec = dt > 0 ? startedDelta / dt : 0;

  const fmt = (n: number, digits = 1): string => n.toFixed(digits);
  const fmtPc = (n: number | null | undefined, digits = 0): string =>
    n == null ? "?" : `${n.toFixed(digits)}`;

  const wallClockIso = new Date().toISOString();

  // Build a structured snapshot once; the human-readable text block
  // and the machine-parseable JSON below both come from the same
  // source so the two never drift.
  const structured = {
    t: wallClockIso,
    bots: {
      active: activePlayers.size,
      inflight: traversalsInflight,
      started: traversalsStarted,
      startedDelta,
      startedPerSec,
      arrived: traversalsCompleted,
      arrivedDelta: completedDelta,
      arrivedPerSec: completedPerSec,
    },
    fps: {
      inst: snap.fpsInstant,
      avg1s: snap.fpsAvg1s,
      min10s: snap.fpsMin10s,
      frameMsAvg: snap.frameMsAvg,
      frameMsP99: snap.frameMsP99,
      frameMsLongest10s: snap.frameMsLongest10s,
      slow1s: snap.slowFrames1s,
      stall10s: snap.stalledFrames10s,
      halted: snap.emergencyHalt,
      // Total time spent in Ticker.shared callbacks per frame.
      // Compare against `frameMsAvg`:
      //   tickerMsAvg ≈ frameMsAvg → all per-frame cost is in our
      //     ticker callbacks (Pixi + our systems). Fixable from
      //     app code if we localise the hot listener.
      //   tickerMsAvg << frameMsAvg → cost is browser-side (GC,
      //     GPU process, compositor). Not fixable from app code.
      tickerMsAvg: tickerStats.avgMs,
      tickerMsMax: tickerStats.maxMs,
      tickerSamples: tickerStats.samples,
    },
    gpu: {
      textureCountActive: snap.textureCountActive,
      texturesCreatedTotal: snap.texturesCreatedTotal,
      texturesFreedTotal: snap.texturesFreedTotal,
      surfaceCountActive: snap.surfaceCountActive,
    },
    vello: {
      liveTex: getLiveRenderTextureCount(),
      renderIds: getLiveRenderTextureIdCount(),
      spells: getLiveSpellInstanceCount(),
      bundles: getLoadedSwfBundleCount(),
    },
    bake: {
      pending: bakeQueue.pending,
      enq: bakeQueue.totalEnqueued,
      done: bakeQueue.totalDispatched,
      dedup: bakeQueue.totalDedupCollapses,
      stale: bakeQueue.totalStaleSkipped,
      budgetMs: bakeQueue.budgetMs,
    },
    cache: {
      bodyEntries: charCache.classAtlasEntries,
      bodyMB: charCache.classAtlasBytes / 1024 / 1024,
      accEntries: charCache.accEntries,
      accMB: charCache.accBytes / 1024 / 1024,
      mntEntries: charCache.mountEntries,
      totalMB: cacheTotal / 1024 / 1024,
      hitPct: hitRate,
      hits: charCache.hits,
      misses: charCache.misses,
      evicts: charCache.evicts,
    },
    /**
     * Phase-0 instrumentation for `RENDER_BAKE_PLAN.md`. Reads:
     *   probes.bodyAtlas.avgMs        — per-bake cost. Drives Phase 1
     *     priority. If <1 ms, tessellation cache is unnecessary; if
     *     ≥5 ms, Phase 1 is the dominant fix.
     *   probes.bakeDrain.perFrameMs   — ms/frame spent in the bake
     *     queue's rAF drain. Compare to `fps.tickerMsAvg` — if it's
     *     ≥50 % of ticker time, bakes ARE the ticker bottleneck and
     *     off-thread bakes (Phase 4) help directly.
     *   probes.composeBot.perFrameMs  — ms/frame spent in per-bot RT
     *     composition. Compare against the warm-state ceiling
     *     hypothesis (~6 ms/frame at 200 bots). If <2 ms, Phase 5
     *     dies; if ~6 ms, Phase 5 is on the path.
     */
    probes: {
      classAtlas: packProbe(probes.classAtlas),
      accessoryStrip: packProbe(probes.accessoryStrip),
      mountTransforms: packProbe(probes.mountTransforms),
      bakeDrain: packProbe(probes.bakeDrain),
      composeBot: packProbe(probes.composeBot),
      composeFlush: packProbe(probes.composeFlush),
      composeRender: packProbe(probes.composeRender),
    },
    /**
     * Per-kind WASM bake telemetry digest. Source: bake_telemetry.rs
     * records drained this snapshot window. Each entry: count of
     * bakes, sum totalMs, percentile breakdown, per-phase ms sums
     * (divide by count for averages), subscene hit/miss tally, and
     * total pixel area baked. Stable schema (each kind reported
     * unconditionally with zeros when absent) keeps the JSON
     * grep-friendly across runs.
     */
    bakeTelemetry: {
      drops: bakeAgg.drops,
      byKind: Object.fromEntries(
        Array.from(bakeAgg.byKind.entries()).map(([kind, b]) => [
          kind,
          {
            count: b.count,
            totalMs: b.totalMs,
            avgMs: b.count > 0 ? b.totalMs / b.count : 0,
            p50Ms: b.p50,
            p95Ms: b.p95,
            p99Ms: b.p99,
            maxMs: b.max,
            sceneMsAvg: b.count > 0 ? b.sumSceneMs / b.count : 0,
            gpuMsAvg: b.count > 0 ? b.sumGpuMs / b.count : 0,
            bridgeMsAvg: b.count > 0 ? b.sumBridgeMs / b.count : 0,
            subsceneHits: b.subsceneHits,
            subsceneMisses: b.subsceneMisses,
            subsceneHitPct:
              b.subsceneHits + b.subsceneMisses > 0
                ? (100 * b.subsceneHits) /
                  (b.subsceneHits + b.subsceneMisses)
                : 0,
            pixelAreaAvg: b.count > 0 ? b.sumPixelArea / b.count : 0,
            pixelAreaTotal: b.sumPixelArea,
          },
        ]),
      ),
    },
    /**
     * Shared composition atlas pressure. After the Phase-5 refactor
     * (RENDER_SHARED_ATLAS_PLAN.md), every active bot occupies one
     * 256² slot in a 4096² shared atlas. `slotsUsed` near
     * `slotsCapacity` (256) means the atlas is nearly full —
     * additional bots will fail to attach (logged + invisible) until
     * we add a multi-page atlas.
     */
    atlas: stripStats
      ? {
          slotsUsed: stripStats.atlas.slotsUsed,
          slotsCapacity: stripStats.atlas.slotsCapacity,
          batchCount: stripStats.atlas.batchCount,
          pageCount: stripStats.atlas.pageCount,
        }
      : null,
    pathCache: pc
      ? {
          bundleCacheCount: pc.bundleCacheCount,
          sceneCacheCount: pc.sceneCacheCount,
          sceneKB: pc.sceneBytesEstimate / 1024,
          // Phase 1b: body-scene cache size. Soft cap is 1500.
          // Stays at cap once steady-state evicts kick in.
          bodySceneCacheCount: pc.bodySceneCacheCount ?? 0,
        }
      : null,
    rust: {
      textures: rustTexCount,
      wasmHeapMB: wasmHeapBytes / 1024 / 1024,
      // Byte-granularity GPU accounting from the patched-wgpu fork.
      // `liveTexMB` is the number we want to compare against the
      // Pixi-side `pixi.gpuMB`: between them they cover every GPU
      // texture allocation that touches our code paths.
      liveTexMB: rustBytes.liveTex / 1024 / 1024,
      liveBufMB: rustBytes.liveBuf / 1024 / 1024,
      createdTexMB: rustBytes.createdTex / 1024 / 1024,
      createdBufMB: rustBytes.createdBuf / 1024 / 1024,
      destroyedTexMB: rustBytes.destroyedTex / 1024 / 1024,
      destroyedBufMB: rustBytes.destroyedBuf / 1024 / 1024,
      pendingTexMB: rustBytes.pendingTex / 1024 / 1024,
      pendingBufMB: rustBytes.pendingBuf / 1024 / 1024,
      // Non-byte-sized GPU object counters. `live = created -
      // dropped`. Unbounded `live` growth = Rust state retaining
      // handles past their useful lifetime.
      liveBindGroups: rustObjs.liveBg,
      createdBindGroups: rustObjs.createdBg,
      droppedBindGroups: rustObjs.droppedBg,
      liveTextureViews: rustObjs.liveTv,
      createdTextureViews: rustObjs.createdTv,
      droppedTextureViews: rustObjs.droppedTv,
      liveSamplers: rustObjs.liveSa,
      createdSamplers: rustObjs.createdSa,
      droppedSamplers: rustObjs.droppedSa,
    },
    defer: {
      texturesDestroyedTotal: defStats.cumulativeTexturesDestroyed,
      buffersDestroyedTotal: defStats.cumulativeBuffersDestroyed,
      texturesPending: defStats.texturesPending,
      buffersPending: defStats.buffersPending,
    },
    pixi: {
      managedSources: pixiManagedSources,
      bindGroups: pixiBindGroupHash,
      // GPU-side bytes for every Pixi-uploaded TextureSource.
      gpuMB: pixiGpuBytes / 1024 / 1024,
      // CPU/browser-side ImageBitmap bytes still held alive via
      // `source.resource`. If we never call `.close()` on the
      // bitmap after Pixi uploads it, the browser keeps the backing
      // buffer alive → doubles the working set of each source.
      bitmapMB: pixiBitmapBytes / 1024 / 1024,
      // Per-label-prefix breakdown so we can see where the bytes
      // actually live (body-color vs body-zone vs accessory vs
      // tile-strip vs worldmap chunks, etc.).
      byLabel: Object.fromEntries(
        Array.from(pixiByLabel.entries())
          .sort((a, b) => b[1].gpuBytes - a[1].gpuBytes)
          .map(([k, v]) => [
            k,
            {
              count: v.count,
              gpuMB: v.gpuBytes / 1024 / 1024,
              bitmapMB: v.bitmapBytes / 1024 / 1024,
            },
          ]),
      ),
    },
    jsHeap: {
      usedMB: snap.jsHeapUsedMB ?? null,
      limitMB: snap.jsHeapLimitMB ?? null,
    },
  };

  // Multi-line human-readable block.
  const textBlock = [
    "── stress monitor ──",
    `  t: ${wallClockIso}`,
    `  bots: active=${activePlayers.size}  inflight=${traversalsInflight}  started=${traversalsStarted}(+${startedDelta} = ${fmt(startedPerSec)}/s)  arrived=${traversalsCompleted}(+${completedDelta} = ${fmt(completedPerSec)}/s)`,
    `  fps:  inst=${fmt(snap.fpsInstant)}  avg1s=${fmt(snap.fpsAvg1s)}  min10s=${fmt(snap.fpsMin10s)}  frameMs avg=${fmt(snap.frameMsAvg, 2)} p99=${fmt(snap.frameMsP99, 2)} longest10s=${fmt(snap.frameMsLongest10s, 1)}  ticker avg=${fmt(tickerStats.avgMs, 2)}ms max=${fmt(tickerStats.maxMs, 2)}ms`,
    `  slow: slow1s=${snap.slowFrames1s}  stall10s=${snap.stalledFrames10s}  halted=${snap.emergencyHalt}`,
    `  gpu:  textures(active=${snap.textureCountActive} created=${snap.texturesCreatedTotal} freed=${snap.texturesFreedTotal})  surfaces=${snap.surfaceCountActive}`,
    `  vello: liveTex=${getLiveRenderTextureCount()} (renderIds=${getLiveRenderTextureIdCount()} spells=${getLiveSpellInstanceCount()})  bundles=${getLoadedSwfBundleCount()}`,
    `  bake: pending=${bakeQueue.pending}  enq=${bakeQueue.totalEnqueued}  done=${bakeQueue.totalDispatched}  dedup=${bakeQueue.totalDedupCollapses}  stale=${bakeQueue.totalStaleSkipped}  budget=${bakeQueue.budgetMs}ms`,
    // Phase-0 cost split. `body avg=` is the per-bake wall time we
    // hypothesised at ~5 ms; `drain /f` and `compose /f` are
    // ms-per-frame so they can be compared directly with the 16.67 ms
    // frame budget + `ticker avg`. See `RENDER_BAKE_PLAN.md`.
    `  bakeCost: class=${probes.classAtlas.count}×avg=${fmt(probes.classAtlas.count > 0 ? probes.classAtlas.totalMs / probes.classAtlas.count : 0, 2)}ms max=${fmt(probes.classAtlas.maxMs, 2)}ms  acc=${probes.accessoryStrip.count}×avg=${fmt(probes.accessoryStrip.count > 0 ? probes.accessoryStrip.totalMs / probes.accessoryStrip.count : 0, 2)}ms  mnt=${probes.mountTransforms.count}×avg=${fmt(probes.mountTransforms.count > 0 ? probes.mountTransforms.totalMs / probes.mountTransforms.count : 0, 2)}ms`,
    // Per-kind WASM-bindgen bake telemetry digest. Sourced from
    // bake_telemetry.rs records drained this window. Subscene hit
    // rate exposes whether the L3 cache is actually paying off.
    // pxAvg flags GPU-bound bakes (large area → big gpu_render_ms)
    // vs CPU-bound (small area → big scene_build_ms).
    ...(bakeAgg.byKind.size === 0
      ? []
      : [
          `  bakeTel${bakeAgg.drops > 0 ? `[drops=${bakeAgg.drops}]` : ""}: ${Array.from(
            bakeAgg.byKind.entries(),
          )
            .sort((a, b) => b[1].totalMs - a[1].totalMs)
            .map(([kind, b]) => {
              const hitRate =
                b.subsceneHits + b.subsceneMisses > 0
                  ? (100 * b.subsceneHits) /
                    (b.subsceneHits + b.subsceneMisses)
                  : 0;
              const pxAvgK = b.count > 0 ? b.sumPixelArea / b.count / 1024 : 0;
              return `${kind}=${b.count}×${fmt(b.totalMs / b.count, 1)}ms(p99=${fmt(b.p99, 1)} max=${fmt(b.max, 1)} scene=${fmt(b.sumSceneMs / b.count, 1)} gpu=${fmt(b.sumGpuMs / b.count, 1)} bridge=${fmt(b.sumBridgeMs / b.count, 1)} hit%=${fmt(hitRate, 0)} pxK=${fmt(pxAvgK, 0)})`;
            })
            .join(" ")}`,
        ]),
    `  frameCost: drain ${probes.bakeDrain.count}× ${fmt(frames > 0 ? probes.bakeDrain.totalMs / frames : 0, 2)}ms/f (max=${fmt(probes.bakeDrain.maxMs, 2)}ms)  compose ${probes.composeBot.count}× ${fmt(frames > 0 ? probes.composeBot.totalMs / frames : 0, 2)}ms/f (max=${fmt(probes.composeBot.maxMs, 2)}ms) [flush ${fmt(frames > 0 ? probes.composeFlush.totalMs / frames : 0, 2)}ms/f / render ${fmt(frames > 0 ? probes.composeRender.totalMs / frames : 0, 2)}ms/f]`,
    `  atlas: ${stripStats ? `${stripStats.atlas.slotsUsed}/${stripStats.atlas.slotsCapacity} slots, ${stripStats.atlas.batchCount} batches, ${stripStats.atlas.pageCount} pages` : "(no renderer)"}`,
    `  anim: ${animDiag ? `slots=${animDiag.totalSlots} stuck=${animDiag.frameStuckCount} variantMissing=${animDiag.variantMissingCount}` : "(no renderer)"}`,
    ...(animDiag && animDiag.frameStuckSamples.length > 0
      ? animDiag.frameStuckSamples.map(
          (s) =>
            `    stuck.${s.playerId}.${s.slotKey}: anim=${s.animKey} fc=${s.fc} stuckTicks=${s.stuckTicks} animReady=${s.animReady} moving=${s.moving} frameIdx=${s.frameIndex} frameTimer=${s.frameTimer.toFixed(3)}`,
        )
      : []),
    ...(animDiag && animDiag.variantMissingSamples.length > 0
      ? animDiag.variantMissingSamples.map(
          (s) =>
            `    missVariant.${s.playerId}.${s.slotKey}: anim=${s.animKey} missingTicks=${s.missingTicks}`,
        )
      : []),
    `  acq: calls=${acquireStats.calls} hitDeliver=${acquireStats.hitDeliver} dedup=${acquireStats.dedup} dispatch=${acquireStats.dispatch} finalDeliver=${acquireStats.finalDeliver} finalNull=${acquireStats.finalNullDeliver} DROPPED=${acquireStats.droppedCallbacks} inflight=${acquireStats.inflightBakes}(${acquireStats.inflightCallbacks}cb)`,
    `  char: class=${charCache.classAtlasEntries}(${fmt(charCache.classAtlasBytes / 1024 / 1024, 1)}MB) acc=${charCache.accEntries}(${fmt(charCache.accBytes / 1024 / 1024, 1)}MB) mnt=${charCache.mountEntries} total=${fmt(cacheTotal / 1024 / 1024, 1)}MB hit%=${fmt(hitRate, 1)} (hits=${charCache.hits} miss=${charCache.misses} evict=${charCache.evicts})`,
    `  path: bundleCache=${fmtPc(pc?.bundleCacheCount)} sceneCache=${fmtPc(pc?.sceneCacheCount)} bodyScene=${fmtPc(pc?.bodySceneCacheCount)}/1500 sceneBytes≈${fmtPc(pc?.sceneBytesEstimate ? pc.sceneBytesEstimate / 1024 : null, 0)}KB`,
    `  rust: textures=${rustTexCount}  wasm.heap=${fmt(wasmHeapBytes / 1024 / 1024, 1)}MB  liveTex=${fmt(rustBytes.liveTex / 1024 / 1024, 1)}MB  liveBuf=${fmt(rustBytes.liveBuf / 1024 / 1024, 1)}MB  createdTex=${fmt(rustBytes.createdTex / 1024 / 1024, 1)}MB  destroyedTex=${fmt(rustBytes.destroyedTex / 1024 / 1024, 1)}MB`,
    `  defer: txDestroyed=${defStats.cumulativeTexturesDestroyed} bufDestroyed=${defStats.cumulativeBuffersDestroyed} txPending=${defStats.texturesPending} bufPending=${defStats.buffersPending} pendTexMB=${fmt(rustBytes.pendingTex / 1024 / 1024, 1)} pendBufMB=${fmt(rustBytes.pendingBuf / 1024 / 1024, 1)}`,
    `  objs: bg=${rustObjs.liveBg}(±${rustObjs.createdBg - rustObjs.droppedBg}) tv=${rustObjs.liveTv}(±${rustObjs.createdTv - rustObjs.droppedTv}) sa=${rustObjs.liveSa}(±${rustObjs.createdSa - rustObjs.droppedSa})  bg.created=${rustObjs.createdBg} bg.dropped=${rustObjs.droppedBg}`,
    `  pixi: managedSources=${pixiManagedSources} bindGroups=${pixiBindGroupHash} gpu=${fmt(pixiGpuBytes / 1024 / 1024, 1)}MB bitmap=${fmt(pixiBitmapBytes / 1024 / 1024, 1)}MB`,
    ...Array.from(pixiByLabel.entries())
      .sort((a, b) => b[1].gpuBytes - a[1].gpuBytes)
      .slice(0, 8)
      .map(
        ([k, v]) =>
          `    pixi.${k}: ${v.count}× gpu=${fmt(v.gpuBytes / 1024 / 1024, 1)}MB bmap=${fmt(v.bitmapBytes / 1024 / 1024, 1)}MB`,
      ),
    `  heap: ${snap.jsHeapUsedMB ?? "?"}MB / ${snap.jsHeapLimitMB ?? "?"}MB`,
  ].join("\n");

  // Cache the latest for copy/download buttons + window-callable
  // accessors. Append to the rolling tail so the user can grab a
  // history of snapshots, not just the most recent one.
  latestStressText = textBlock;
  latestStressJson = structured;
  stressHistory.push(structured);
  if (stressHistory.length > STRESS_HISTORY_MAX) {
    stressHistory.shift();
  }

  // Tag-prefixed single-line JSON line for terminal redirection
  // (`bun run dev | grep STRESS_JSON >> stress.log`). Printed via
  // console.log directly so it skips the logger's pretty prefix
  // — easier to grep against.
  // eslint-disable-next-line no-console
  console.log(`STRESS_JSON ${JSON.stringify(structured)}`);

  log.info(textBlock);
}

// Module-level cache for the in-app copy/download buttons +
// window-callable accessors below.
let latestStressText = "";
type StressSnapshotJson = ReturnType<typeof buildEmptySnapshot>;
function buildEmptySnapshot() {
  return {
    t: new Date(0).toISOString(),
    bots: { active: 0, inflight: 0, started: 0, startedDelta: 0, startedPerSec: 0, arrived: 0, arrivedDelta: 0, arrivedPerSec: 0 },
    fps: { inst: 0, avg1s: 0, min10s: 0, frameMsAvg: 0, frameMsP99: 0, frameMsLongest10s: 0, slow1s: 0, stall10s: 0, halted: false, tickerMsAvg: 0, tickerMsMax: 0, tickerSamples: 0 },
    gpu: { textureCountActive: 0, texturesCreatedTotal: 0, texturesFreedTotal: 0, surfaceCountActive: 0 },
    vello: { liveTex: 0, renderIds: 0, spells: 0, bundles: 0 },
    bake: { pending: 0, enq: 0, done: 0, dedup: 0, stale: 0, budgetMs: 0 },
    cache: { bodyEntries: 0, bodyMB: 0, accEntries: 0, accMB: 0, mntEntries: 0, totalMB: 0, hitPct: 0, hits: 0, misses: 0, evicts: 0 },
    probes: {
      classAtlas: { count: 0, totalMs: 0, maxMs: 0, avgMs: 0, perFrameMs: 0 },
      accessoryStrip: { count: 0, totalMs: 0, maxMs: 0, avgMs: 0, perFrameMs: 0 },
      mountTransforms: { count: 0, totalMs: 0, maxMs: 0, avgMs: 0, perFrameMs: 0 },
      bakeDrain: { count: 0, totalMs: 0, maxMs: 0, avgMs: 0, perFrameMs: 0 },
      composeBot: { count: 0, totalMs: 0, maxMs: 0, avgMs: 0, perFrameMs: 0 },
      composeFlush: { count: 0, totalMs: 0, maxMs: 0, avgMs: 0, perFrameMs: 0 },
      composeRender: { count: 0, totalMs: 0, maxMs: 0, avgMs: 0, perFrameMs: 0 },
    },
    atlas: null as {
      slotsUsed: number;
      slotsCapacity: number;
      batchCount: number;
      pageCount: number;
    } | null,
    pathCache: null as { bundleCacheCount: number; sceneCacheCount: number; sceneKB: number; bodySceneCacheCount: number } | null,
    rust: {
      textures: 0,
      wasmHeapMB: 0,
      liveTexMB: 0,
      liveBufMB: 0,
      createdTexMB: 0,
      createdBufMB: 0,
      destroyedTexMB: 0,
      destroyedBufMB: 0,
      pendingTexMB: 0,
      pendingBufMB: 0,
      liveBindGroups: 0,
      createdBindGroups: 0,
      droppedBindGroups: 0,
      liveTextureViews: 0,
      createdTextureViews: 0,
      droppedTextureViews: 0,
      liveSamplers: 0,
      createdSamplers: 0,
      droppedSamplers: 0,
    },
    defer: { texturesDestroyedTotal: 0, buffersDestroyedTotal: 0, texturesPending: 0, buffersPending: 0 },
    pixi: {
      managedSources: 0,
      bindGroups: 0,
      gpuMB: 0,
      bitmapMB: 0,
      byLabel: {} as Record<
        string,
        { count: number; gpuMB: number; bitmapMB: number }
      >,
    },
    jsHeap: { usedMB: null as number | null, limitMB: null as number | null },
  };
}
let latestStressJson: StressSnapshotJson = buildEmptySnapshot();
const stressHistory: StressSnapshotJson[] = [];
const STRESS_HISTORY_MAX = 200;

function startMonitorIfNeeded(): void {
  if (monitorHandle !== null) return;
  ensureTickerInstrumented();
  monitorLastSnapshotAt = performance.now();
  monitorLastCompletedAt = traversalsCompleted;
  monitorLastStartedAt = traversalsStarted;
  // Quick first snapshot so the user sees baseline immediately, then
  // tick every 5s.
  setTimeout(logMonitorSnapshot, 500);
  monitorHandle = setInterval(logMonitorSnapshot, MONITOR_INTERVAL_MS);
}

function stopMonitorIfIdle(): void {
  if (activePlayers.size > 0) return;
  if (monitorHandle !== null) {
    clearInterval(monitorHandle);
    monitorHandle = null;
    log.info("monitor stopped (no active bots)");
  }
}

function ensureWatchdogWiring(renderer: PlayerRenderer): void {
  if (watchdogUnsubscribe) {
    return;
  }
  watchdogUnsubscribe = getRenderWatchdog().onEmergencyHalt(() => {
    if (activePlayers.size === 0) return;
    log.warn(
      `Emergency halt — despawning ${activePlayers.size} test players to relieve GPU pressure.`,
    );
    despawnTestPlayers(renderer);
  });
}

/**
 * Per-player movement loop. Runs until either:
 *   - the bot is despawned (`activePlayers.delete(id)` + `cancel()`), OR
 *   - the render watchdog halts (loop pauses and resumes via the
 *     halt-state poll; the watchdog handler will despawn us if needed).
 *
 * Each iteration picks a PRE-COMPUTED path from the bot's current cell and
 * awaits arrival. The `Promise.race` against `cancelled` is what lets
 * `despawn` interrupt a long walk so the loop doesn't leak.
 */
/**
 * Pre-computed path pool — the stress harness's spawn freeze was hundreds of
 * simultaneous live `findPath` (A*) calls when bots start moving (real gameplay
 * is server-driven, so this is purely a test artifact). Instead, build ~1000
 * valid paths ONCE per map and have bots replay them. Indexed by START cell so a
 * bot chains end → next-start with neither a teleport nor a runtime A*.
 */
const PRECOMPUTED_PATH_TARGET = 1000;
let precomputedPaths: {
  signature: string;
  byStart: Map<number, number[][]>;
} | null = null;

function precomputeSignature(cells: CellData[]): string {
  const walkable = cells.filter(isWalkable);
  return `${cells.length}:${walkable.length}:${walkable[0]?.id ?? -1}:${
    walkable[walkable.length - 1]?.id ?? -1
  }`;
}

/**
 * Build (once per map, cached by cell-set signature) ~1000 valid paths between
 * walkable cells, indexed by start cell. Starts are round-robined over every
 * walkable cell so each has outgoing paths, and targets are walkable too — so a
 * path's END is always a valid next START and bots chain forever with zero
 * runtime `findPath`. Yields periodically so the one-time build never blocks a
 * frame (and it's reused across spawns / despawns on the same map).
 */
async function ensurePrecomputedPaths(
  cells: CellData[],
  pathfinding: DofusPathfinding,
): Promise<Map<number, number[][]>> {
  const signature = precomputeSignature(cells);
  if (precomputedPaths && precomputedPaths.signature === signature) {
    return precomputedPaths.byStart;
  }
  const walkable = cells.filter(isWalkable);
  const byStart = new Map<number, number[][]>();
  if (walkable.length >= 2) {
    let batchStart = performance.now();
    for (let i = 0; i < PRECOMPUTED_PATH_TARGET; i++) {
      const start = walkable[i % walkable.length];
      const target = walkable[Math.floor(rnd() * walkable.length)];
      if (target.id !== start.id) {
        const path = pathfinding.findPath(start.id, target.id);
        if (path && path.length >= 2) {
          let arr = byStart.get(start.id);
          if (!arr) {
            arr = [];
            byStart.set(start.id, arr);
          }
          arr.push(path);
        }
      }
      // Time-box: keep each synchronous batch under ~6ms so the one-time
      // build (≈1000 A* calls) never drops a frame, regardless of per-path
      // A* cost. Reused across spawns on the same map (signature cache).
      if (performance.now() - batchStart > 6) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        batchStart = performance.now();
      }
    }
  }
  precomputedPaths = { signature, byStart };
  const total = [...byStart.values()].reduce((s, a) => s + a.length, 0);
  log.info(
    `stress: precomputed ${total} paths over ${byStart.size} start cells`,
  );
  return byStart;
}

async function runMovementLoop(
  id: number,
  renderer: PlayerRenderer,
  cells: CellData[],
  pathfinding: DofusPathfinding,
): Promise<void> {
  const entry = activePlayers.get(id);
  if (!entry) return;
  const cancelled = entry.cancelled;

  // Race helper so an in-flight `movePlayer` can be torn down on
  // despawn even though `movement.start` doesn't expose cancellation.
  // The orphan move promise resolves later when arrival hits (or
  // never if the player was removed) — its resolution goes nowhere
  // and is GC'd alongside the player state.
  //
  // The cancel-promise is built ONCE per bot. Previously each
  // raceCancel call attached a new `.then()` handler to `cancelled`,
  // accumulating O(iterations) handlers per bot. At 200 bots × ~5
  // movement loops/sec this added thousands of attached callbacks
  // and equivalent Promise allocations per sec, feeding GC pressure.
  const cancelAsCancel: Promise<"cancel"> = cancelled.then(
    () => "cancel" as const,
  );
  const raceCancel = <T>(p: Promise<T>): Promise<T | "cancel"> =>
    Promise.race([p, cancelAsCancel]);
  // Per-bot sleep with a single attached cancel handler — see makeBotSleep.
  const botSleep = makeBotSleep(cancelled);

  // Defer first movement until the bot's initial strip has landed —
  // otherwise bots that spawn while the bake queue is deep slide
  // cell-to-cell with no animation (the "moving without animating"
  // bug). Poll every 50ms with a 10s safety timeout.
  const readyDeadline = performance.now() + 10000;
  while (
    activePlayers.has(id) &&
    !renderer.isStripReady(id) &&
    performance.now() < readyDeadline
  ) {
    await botSleep(50);
  }

  while (activePlayers.has(id)) {
    if (getRenderWatchdog().isHalted()) {
      await botSleep(500);
      continue;
    }
    const currentCell = renderer.getPlayerCell(id);
    if (currentCell === undefined) {
      // Bot was removed under us — exit cleanly.
      return;
    }
    // Pick a PRE-COMPUTED path from the current cell — no runtime A*. Cloned
    // so a shared pool entry can't be mutated by the movement system. Falls
    // back to a live `findPath` only if this cell has no precomputed paths,
    // which shouldn't happen (every walkable cell is round-robined as a start).
    let path: number[] | null = null;
    const pool = precomputedPaths?.byStart.get(currentCell);
    if (pool && pool.length > 0) {
      path = pool[Math.floor(Math.random() * pool.length)].slice();
    } else {
      const target = pickRandomCell(cells);
      if (!target || target.id === currentCell) {
        await botSleep(200);
        continue;
      }
      path = pathfinding.findPath(currentCell, target.id);
    }
    if (!path || path.length < 2) {
      await botSleep(200);
      continue;
    }

    traversalsStarted += 1;
    traversalsInflight += 1;
    const winner = await raceCancel(renderer.movePlayer(id, path));
    traversalsInflight -= 1;
    if (winner === "cancel") return;
    traversalsCompleted += 1;

    // Brief idle at destination so accessory + idle anim swap fires
    // (the visual exercise we're testing).
    const idleMs =
      MIN_DEST_IDLE_MS +
      Math.random() * (MAX_DEST_IDLE_MS - MIN_DEST_IDLE_MS);
    await botSleep(idleMs);
  }
}

/** Spawn `n` random bots with pathfinding-driven movement loops. */
export async function spawnTestPlayers(
  n: number,
  renderer: PlayerRenderer,
  cells: CellData[],
  pathfinding: DofusPathfinding,
  opts: SpawnOptions = {},
): Promise<number[]> {
  ensureWatchdogWiring(renderer);
  if (getRenderWatchdog().isHalted()) {
    log.warn(
      "spawnTestPlayers refused: watchdog is halted. Call __renderResume() to clear, then retry.",
    );
    return [];
  }

  // Build the pre-computed path pool BEFORE spawning so movement loops never
  // run a live A* (the spawn freeze). One-time per map, yields between batches.
  await ensurePrecomputedPaths(cells, pathfinding);

  const requested = n;
  const headroom = Math.max(0, HARD_CAP - activePlayers.size);
  if (n > headroom) {
    log.warn(
      `spawnTestPlayers: clamping N=${n} → ${headroom} (HARD_CAP=${HARD_CAP}, already active=${activePlayers.size}).`,
    );
    n = headroom;
  }
  if (n + activePlayers.size > SOFT_WARN) {
    log.warn(
      `spawnTestPlayers: heading to ${n + activePlayers.size} concurrent bots; expect frame-time spikes during accessorized strip builds.`,
    );
  }
  if (n <= 0) return [];

  const spawnDelay = Math.max(opts.delayMs ?? 0, MIN_SPAWN_INTERVAL_MS);
  const ids: number[] = [];

  // SEQUENTIAL SPAWN — await each addPlayer before starting the next.
  // Parallel spawn lets the wgpu command queue accumulate 200+ pending
  // texture allocations and stalls the rAF callback when they drain.
  for (let i = 0; i < n; i++) {
    if (getRenderWatchdog().isHalted()) {
      log.warn(
        `spawnTestPlayers: watchdog halted mid-batch at ${i}/${requested}; aborting.`,
      );
      break;
    }
    const cell = pickRandomCell(cells);
    if (!cell) {
      log.warn(
        `spawnTestPlayers: no walkable cell available, stopping at ${i}/${n}`,
      );
      break;
    }
    const id = TEST_PLAYER_ID_BASE + activePlayers.size + i;
    ids.push(id);

    let resolveCancel!: () => void;
    const cancelled = new Promise<void>((res) => {
      resolveCancel = res;
    });
    activePlayers.set(id, {
      id,
      cancel: resolveCancel,
      cancelled,
    });

    await renderer.addPlayer({
      id,
      name: `Bot${i}`,
      team: i % 2,
      cellId: cell.id,
      direction: Math.floor(Math.random() * 8),
      look: buildRandomLook(),
      hp: 100,
      maxHp: 100,
      isPlayer: false,
      // Bots model OTHER PLAYERS' avatars — AS2 `instanceof Character`
      // (canonical run threshold 3+, and they count toward + are
      // eligible for the CreaturesMode crowd swap, GameIn.as:1267 /
      // SpriteHandler.as:614).
      isCharacter: true,
      decorative: true,
    });
    if (spawnDelay > 0) {
      await new Promise((r) => setTimeout(r, spawnDelay));
    }
  }
  log.info(`spawned ${ids.length} test players (requested=${requested})`);

  // Kick the movement loops AFTER spawn ramp completes so the GPU queue
  // is empty by the time bots start dispatching path-driven anim swaps.
  for (const id of ids) {
    void runMovementLoop(id, renderer, cells, pathfinding);
  }
  // First spawn batch arms the 5s monitor. Re-spawning while bots are
  // still active is idempotent (the monitor is still running).
  startMonitorIfNeeded();
  return ids;
}

/**
 * Burst-spawn N bots with NO inter-spawn delay — models a map entry
 * where the server pushes a whole roster in one frame. Unlike
 * `spawnTestPlayers` (5ms stagger + auto-movement), this is the
 * faithful "250 actors land at once" measurement primitive: the
 * caller brackets it with a frame-pacing recorder and polls
 * `__getStressSnapshot().bake.pending` to find time-to-all-committed.
 *
 * `move` defaults to false so the measurement captures pure spawn
 * cost (Pixi create + atlas acquire + accessory bake + compose)
 * without steady-state walk churn muddying the numbers. Sequential
 * await is kept (parallel addPlayer floods the wgpu queue), but with
 * zero delay it runs as fast as the pipeline allows.
 */
export async function spawnBurst(
  n: number,
  renderer: PlayerRenderer,
  cells: CellData[],
  pathfinding: DofusPathfinding,
  opts: { move?: boolean; seed?: number } = {},
): Promise<number[]> {
  ensureWatchdogWiring(renderer);
  if (getRenderWatchdog().isHalted()) {
    log.warn("spawnBurst refused: watchdog halted. __renderResume() then retry.");
    return [];
  }
  // Pre-compute the path pool up front (one-time per map) so the moving variant
  // never runs a live A* per bot.
  if (opts.move !== false) {
    await ensurePrecomputedPaths(cells, pathfinding);
  }
  // Seeded looks: same seed → identical roster across sessions, so a
  // persisted cache fully hits (mirrors revisiting the same map).
  if (typeof opts.seed === "number") {
    seededRng = mulberry32(opts.seed);
  }
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    if (getRenderWatchdog().isHalted()) {
      log.warn(`spawnBurst: watchdog halted mid-batch at ${i}/${n}; aborting.`);
      break;
    }
    const cell = pickRandomCell(cells);
    if (!cell) {
      log.warn(`spawnBurst: no walkable cell at ${i}/${n}`);
      break;
    }
    const id = TEST_PLAYER_ID_BASE + activePlayers.size + i;
    ids.push(id);
    let resolveCancel!: () => void;
    const cancelled = new Promise<void>((res) => {
      resolveCancel = res;
    });
    activePlayers.set(id, { id, cancel: resolveCancel, cancelled });
    await renderer.addPlayer({
      id,
      name: `Bot${i}`,
      team: i % 2,
      cellId: cell.id,
      direction: Math.floor(rnd() * 8),
      look: buildRandomLook(),
      hp: 100,
      maxHp: 100,
      isPlayer: false,
      // Player-avatar semantics — see spawnTestPlayers.
      isCharacter: true,
      decorative: true,
    });
  }
  seededRng = null; // restore non-deterministic for any later spawns
  log.info(`spawnBurst: issued ${ids.length} adds (move=${opts.move ?? false})`);
  if (opts.move) {
    for (const id of ids) {
      void runMovementLoop(id, renderer, cells, pathfinding);
    }
  }
  startMonitorIfNeeded();
  return ids;
}

/** Remove every test-spawned bot. Resolves once cleanup queued; per-bot
 *  `movePlayer` promises may still be in-flight but their loops won't
 *  observe arrival because `cancelled` already fired. */
export function despawnTestPlayers(renderer: PlayerRenderer): number {
  const n = activePlayers.size;
  for (const entry of activePlayers.values()) {
    try {
      entry.cancel();
    } catch {
      /* unreachable — Promise.resolve never throws */
    }
    try {
      renderer.removePlayer(entry.id);
    } catch (e) {
      // Swallow per-bot removal errors so one bad id doesn't strand
      // the rest. This path runs from the emergency-halt handler too —
      // it MUST always drain the map.
      log.warn(`despawnTestPlayers: removePlayer(${entry.id}) threw:`, e);
    }
  }
  activePlayers.clear();
  log.info(`despawned ${n} test players`);
  // Reset traversal counters so a subsequent spawn batch starts clean.
  traversalsStarted = 0;
  traversalsCompleted = 0;
  traversalsInflight = 0;
  stopMonitorIfIdle();
  return n;
}

/** Diagnostic: how many test players are currently spawned. */
export function getTestPlayerCount(): number {
  return activePlayers.size;
}

/**
 * Most recent stress monitor snapshot in human-readable form. Useful
 * for a "Copy" button in the dev panel. Returns an empty string if
 * no snapshot has been logged yet.
 */
export function getLatestStressMonitorText(): string {
  return latestStressText;
}

/**
 * Most recent snapshot as a structured object. Best for piping to
 * logs / dashboards. The fields mirror the textual format.
 */
export function getLatestStressMonitorJson(): StressSnapshotJson {
  return latestStressJson;
}

/**
 * Full rolling history of snapshots (most recent last). Capped at
 * {@link STRESS_HISTORY_MAX} entries to bound memory.
 */
export function getStressMonitorHistory(): readonly StressSnapshotJson[] {
  return stressHistory;
}

/**
 * Build a textual dump of the entire snapshot history. Drop into
 * `await navigator.clipboard.writeText(...)` or a Blob download.
 */
export function buildStressHistoryDump(): string {
  const head = [
    "# Stress monitor dump",
    `# Generated: ${new Date().toISOString()}`,
    `# Snapshots: ${stressHistory.length}`,
    "",
  ].join("\n");
  // Pretty-print each entry as JSON on one line per snapshot so the
  // file can be parsed line-by-line by external tooling.
  const body = stressHistory
    .map((snap, i) => `# ─── snapshot ${i + 1} / ${stressHistory.length} ───\n${JSON.stringify(snap, null, 2)}`)
    .join("\n\n");
  return `${head}${body}\n`;
}

/**
 * Reset the history buffer. Call before a fresh stress run to get a
 * clean dump.
 */
export function resetStressMonitorHistory(): void {
  stressHistory.length = 0;
  latestStressText = "";
  latestStressJson = buildEmptySnapshot();
}

// Install convenience window globals so the in-game StressTestPanel
// (and devtools console) can copy / download snapshots without
// dragging the React tree into business logic.
declare global {
  interface Window {
    __copyStressSnapshot?: () => Promise<boolean>;
    __copyStressHistory?: () => Promise<boolean>;
    __downloadStressHistory?: () => void;
    __getStressSnapshot?: () => StressSnapshotJson;
    __getStressSnapshotText?: () => string;
    __resetStressHistory?: () => void;
  }
}

(function installStressWindowGlobals() {
  if (typeof window === "undefined") return;
  window.__getStressSnapshot = () => latestStressJson;
  window.__getStressSnapshotText = () => latestStressText;
  window.__resetStressHistory = () => {
    resetStressMonitorHistory();
  };
  window.__copyStressSnapshot = async () => {
    try {
      await navigator.clipboard.writeText(latestStressText);
      return true;
    } catch (e) {
      log.warn("copyStressSnapshot failed", e);
      return false;
    }
  };
  window.__copyStressHistory = async () => {
    try {
      await navigator.clipboard.writeText(buildStressHistoryDump());
      return true;
    } catch (e) {
      log.warn("copyStressHistory failed", e);
      return false;
    }
  };
  window.__downloadStressHistory = () => {
    try {
      const blob = new Blob([buildStressHistoryDump()], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stress-monitor-${Date.now()}.log`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the
      // download.
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (e) {
      log.warn("downloadStressHistory failed", e);
    }
  };
})();
