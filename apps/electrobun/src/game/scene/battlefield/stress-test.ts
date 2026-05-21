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

import type { CellData } from "@/game/datacenter/cell";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import { getRenderWatchdog } from "@/game/render/render-watchdog";
import { getCharacterCache } from "@/game/render/character-cache";
import { getStripBakeQueue } from "@/game/render/strip-bake-queue";
import {
  getDeferredDestroyStats,
  getLiveRenderTextureCount,
  getLiveRenderTextureIdCount,
  getLiveSpellInstanceCount,
  getLoadedSwfBundleCount,
  getPathCacheStats,
  getPixiRenderer,
  getRustTexturesCount,
  getWasmHeapBytes,
  swfBundleExports,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("StressTest");

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

/** Hard ceiling on concurrent test players. */
const HARD_CAP = 500;
/** Soft warning threshold — keeps the dev console honest about cost. */
const SOFT_WARN = 300;
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
let monitorLastSnapshotAt = 0;
let monitorLastCompletedAt = 0;
let monitorLastStartedAt = 0;
const MONITOR_INTERVAL_MS = 5000;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomColor(): number {
  return Math.floor(Math.random() * 0xffffff);
}

function buildRandomLook(): string {
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
  if (pools.weapons.length > 0 && Math.random() < 0.8) {
    slots[0] = `6_${pick(pools.weapons)}`;
  }
  if (pools.hats.length > 0 && Math.random() < 0.8) {
    slots[1] = `16_${pick(pools.hats)}`;
  }
  if (pools.capes.length > 0 && Math.random() < 0.8) {
    slots[2] = `17_${pick(pools.capes)}`;
  }
  // Pet (look[3], type 18) — no body-part mount in player SWFs; skipped.
  if (pools.shields.length > 0 && Math.random() < 0.8) {
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

function sleep(ms: number, cancelled: Promise<void>): Promise<void> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
    void cancelled.then(() => {
      if (handle !== null) clearTimeout(handle);
      resolve();
    });
  });
}

/**
 * Snapshot every 5s: render watchdog (FPS, frame timings, GPU resources),
 * Vello WASM (live textures, spell instances, bundles, path cache),
 * and stress-test internals (active bots, traversal rate, in-flight
 * walks). Stops itself once the last bot despawns.
 */
function logMonitorSnapshot(): void {
  const now = performance.now();
  const dt = (now - monitorLastSnapshotAt) / 1000;
  monitorLastSnapshotAt = now;

  const completedDelta = traversalsCompleted - monitorLastCompletedAt;
  const startedDelta = traversalsStarted - monitorLastStartedAt;
  monitorLastCompletedAt = traversalsCompleted;
  monitorLastStartedAt = traversalsStarted;

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
  const cacheTotal = charCache.bodyBytes + charCache.accBytes;
  const cacheReqs = charCache.hits + charCache.misses;
  const hitRate = cacheReqs > 0 ? (charCache.hits / cacheReqs) * 100 : 0;

  // Memory subsystem telemetry — gives us per-bucket attribution so
  // we can localise growth instead of just staring at Activity
  // Monitor's process total.
  const defStats = getDeferredDestroyStats();
  const rustTexCount = getRustTexturesCount();
  const wasmHeapBytes = getWasmHeapBytes();
  // Pixi-side managed-source counts (best effort — depends on Pixi
  // v8 internals being accessible).
  let pixiManagedSources = -1;
  let pixiBindGroupHash = -1;
  try {
    const renderer = getPixiRenderer() as unknown as
      | { texture?: { _managedTextures?: { items?: Record<string, unknown> }; _bindGroupHash?: Record<string, unknown> } }
      | null;
    const sys = renderer?.texture;
    if (sys?._managedTextures?.items) {
      pixiManagedSources = Object.keys(sys._managedTextures.items).length;
    }
    if (sys?._bindGroupHash) {
      pixiBindGroupHash = Object.keys(sys._bindGroupHash).length;
    }
  } catch {
    // ignore
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
      bodyEntries: charCache.bodyEntries,
      bodyMB: charCache.bodyBytes / 1024 / 1024,
      accEntries: charCache.accEntries,
      accMB: charCache.accBytes / 1024 / 1024,
      mntEntries: charCache.mountEntries,
      totalMB: cacheTotal / 1024 / 1024,
      hitPct: hitRate,
      hits: charCache.hits,
      misses: charCache.misses,
      evicts: charCache.evicts,
    },
    pathCache: pc
      ? {
          bundleCacheCount: pc.bundleCacheCount,
          sceneCacheCount: pc.sceneCacheCount,
          sceneKB: pc.sceneBytesEstimate / 1024,
        }
      : null,
    rust: {
      textures: rustTexCount,
      wasmHeapMB: wasmHeapBytes / 1024 / 1024,
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
    `  fps:  inst=${fmt(snap.fpsInstant)}  avg1s=${fmt(snap.fpsAvg1s)}  min10s=${fmt(snap.fpsMin10s)}  frameMs avg=${fmt(snap.frameMsAvg, 2)} p99=${fmt(snap.frameMsP99, 2)} longest10s=${fmt(snap.frameMsLongest10s, 1)}`,
    `  slow: slow1s=${snap.slowFrames1s}  stall10s=${snap.stalledFrames10s}  halted=${snap.emergencyHalt}`,
    `  gpu:  textures(active=${snap.textureCountActive} created=${snap.texturesCreatedTotal} freed=${snap.texturesFreedTotal})  surfaces=${snap.surfaceCountActive}`,
    `  vello: liveTex=${getLiveRenderTextureCount()} (renderIds=${getLiveRenderTextureIdCount()} spells=${getLiveSpellInstanceCount()})  bundles=${getLoadedSwfBundleCount()}`,
    `  bake: pending=${bakeQueue.pending}  enq=${bakeQueue.totalEnqueued}  done=${bakeQueue.totalDispatched}  dedup=${bakeQueue.totalDedupCollapses}  stale=${bakeQueue.totalStaleSkipped}  budget=${bakeQueue.budgetMs}ms`,
    `  char: body=${charCache.bodyEntries}(${fmt(charCache.bodyBytes / 1024 / 1024, 1)}MB) acc=${charCache.accEntries}(${fmt(charCache.accBytes / 1024 / 1024, 1)}MB) mnt=${charCache.mountEntries} total=${fmt(cacheTotal / 1024 / 1024, 1)}MB hit%=${fmt(hitRate, 1)} (hits=${charCache.hits} miss=${charCache.misses} evict=${charCache.evicts})`,
    `  path: bundleCache=${fmtPc(pc?.bundleCacheCount)} sceneCache=${fmtPc(pc?.sceneCacheCount)} sceneBytes≈${fmtPc(pc?.sceneBytesEstimate ? pc.sceneBytesEstimate / 1024 : null, 0)}KB`,
    `  rust: textures=${rustTexCount}  wasm.heap=${fmt(wasmHeapBytes / 1024 / 1024, 1)}MB`,
    `  defer: txDestroyed=${defStats.cumulativeTexturesDestroyed} bufDestroyed=${defStats.cumulativeBuffersDestroyed} txPending=${defStats.texturesPending} bufPending=${defStats.buffersPending}`,
    `  pixi: managedSources=${pixiManagedSources} bindGroups=${pixiBindGroupHash}`,
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
    fps: { inst: 0, avg1s: 0, min10s: 0, frameMsAvg: 0, frameMsP99: 0, frameMsLongest10s: 0, slow1s: 0, stall10s: 0, halted: false },
    gpu: { textureCountActive: 0, texturesCreatedTotal: 0, texturesFreedTotal: 0, surfaceCountActive: 0 },
    vello: { liveTex: 0, renderIds: 0, spells: 0, bundles: 0 },
    bake: { pending: 0, enq: 0, done: 0, dedup: 0, stale: 0, budgetMs: 0 },
    cache: { bodyEntries: 0, bodyMB: 0, accEntries: 0, accMB: 0, mntEntries: 0, totalMB: 0, hitPct: 0, hits: 0, misses: 0, evicts: 0 },
    pathCache: null as { bundleCacheCount: number; sceneCacheCount: number; sceneKB: number } | null,
    rust: { textures: 0, wasmHeapMB: 0 },
    defer: { texturesDestroyedTotal: 0, buffersDestroyedTotal: 0, texturesPending: 0, buffersPending: 0 },
    pixi: { managedSources: 0, bindGroups: 0 },
    jsHeap: { usedMB: null as number | null, limitMB: null as number | null },
  };
}
let latestStressJson: StressSnapshotJson = buildEmptySnapshot();
const stressHistory: StressSnapshotJson[] = [];
const STRESS_HISTORY_MAX = 200;

function startMonitorIfNeeded(): void {
  if (monitorHandle !== null) return;
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
 * Each iteration picks a fresh walkable target, computes a path, and
 * awaits arrival. The `Promise.race` against `cancelled` is what lets
 * `despawn` interrupt a long walk so the loop doesn't leak.
 */
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
  const raceCancel = <T>(p: Promise<T>): Promise<T | "cancel"> =>
    Promise.race([p, cancelled.then(() => "cancel" as const)]);

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
    await sleep(50, cancelled);
  }

  while (activePlayers.has(id)) {
    if (getRenderWatchdog().isHalted()) {
      await sleep(500, cancelled);
      continue;
    }
    const currentCell = renderer.getPlayerCell(id);
    if (currentCell === undefined) {
      // Bot was removed under us — exit cleanly.
      return;
    }
    const target = pickRandomCell(cells);
    if (!target || target.id === currentCell) {
      await sleep(200, cancelled);
      continue;
    }
    const path = pathfinding.findPath(currentCell, target.id);
    if (!path || path.length < 2) {
      await sleep(200, cancelled);
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
    await sleep(idleMs, cancelled);
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
