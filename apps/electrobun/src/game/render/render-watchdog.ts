/**
 * RenderWatchdog — central safety net for the GPU rendering pipeline.
 *
 * Background: a previous session crashed the host PC. The most likely root
 * causes all share a pattern: a tight loop on the JS side keeps submitting
 * GPU work faster than the driver can drain it, until the WindowServer hangs.
 * The watchdog's job is to (1) make those conditions OBSERVABLE — frame-time
 * spikes, texture-count growth, device loss — and (2) provide a single
 * emergency-halt that pulls every known throttle simultaneously.
 *
 * Architecture:
 *   - Singleton (`getRenderWatchdog()`).
 *   - Pixi `Ticker` calls `recordFrame(dtMs)` every tick.
 *   - The shared `vello-loader` increments/decrements texture counters as
 *     various render entry points allocate, and `freeRenderTexture` /
 *     `disposeSwfSpellInstance` release.
 *   - The `RenderDebugOverlay` React component subscribes via
 *     `subscribe(listener)` and reads `getSnapshot()` from
 *     `useSyncExternalStore`. Snapshots are cached + invalidated only when
 *     state changes (so React doesn't infinite-loop on identity churn).
 *   - Frame budget is enforced cooperatively: when the watchdog goes into
 *     emergency halt, `vello-loader.isHalted()` returns true and every
 *     render entry point early-returns null. Callers handle null gracefully.
 *
 * Public API is small on purpose: `recordFrame`, the texture
 * register/unregister pair, `setDeviceLost`, `setStatsProvider`, and
 * `emergencyHalt` / `resume`. Everything else is read-only state.
 */

import { createLogger } from "@/utils/logger";

const log = createLogger("RenderWatchdog");

/** Number of recent frames kept for percentile + histogram views. */
const FRAME_HISTORY = 600; // 10s at 60fps
/** Above this frame time the frame is considered "slow" (below 30fps). */
const SLOW_FRAME_MS = 33.4;
/** Above this frame time the frame is considered "stalled" (below 10fps). */
const STALL_FRAME_MS = 100;
/**
 * Consecutive stalled frames before auto-halt fires.
 *
 * Bumped from 3 → 30: under the Step 11 bridge migration,
 * `transferToImageBitmap` is a synchronous GPU sync point per bake
 * (~5-15ms each) and a burst at battlefield/character first-load can
 * legitimately exceed 100 ms for several frames in a row while the
 * cache warms. Auto-halting in that window leaves the player + tiles
 * invisible until manual resume. 30 ticks (~500ms at 60fps when not
 * stalling, longer when stalling) is enough headroom for warmup
 * while still catching a real runaway-stall scenario.
 */
const AUTO_HALT_STALL_RUN = 30;
/** Texture count above this triggers a warning. */
const TEXTURE_COUNT_WARN = 2048;
/**
 * Texture count above this trips the auto-halt (probable leak storm).
 *
 * Raised from 1024 → 16384: the previous threshold was tuned for the
 * old per-player ExternalSource pattern, but TileSpriteRenderer's
 * per-placement texture allocations (now cached but historically
 * leaky) plus multi-frame anim strips for tiles routinely peaked
 * around 1.5–3k textures on standard maps with NPCs. Hitting the
 * halt mid-render is the well-known "bottom of the map silently
 * stops rendering after some Y" symptom: once `isHalted()` flips,
 * every subsequent `renderSwfFrame` returns null and tile placements
 * pushed later in cellId order (= bottom rows) never get sprites.
 * 16k is well below any practical wgpu device-level texture limit
 * but high enough that the halt only fires on a real leak.
 */
const TEXTURE_COUNT_HALT = 16384;
/**
 * Surface count above this triggers a warning. Three-canvas
 * architecture is canonically two surfaces (battlefield bottom + top)
 * + one HudVelloAtlas + a few transient probes — the working set
 * should sit comfortably under 16. Climbing past 32 indicates a cache
 * eviction is missing its detachSurface, or HUD components are
 * leaking attachments on unmount.
 */
const SURFACE_COUNT_WARN = 32;
/** React notification rate-limit — the HUD only needs ~10Hz freshness. */
const NOTIFY_INTERVAL_MS = 100;
/**
 * Liveness watchdog poll interval (setInterval, NOT rAF). Survives
 * `requestAnimationFrame` stalls — when the GPU command queue saturates
 * the browser stops scheduling rAF callbacks, but `setInterval` keeps
 * firing on the event loop. This is the only watchdog that can react
 * once the rendering pipeline has hung itself.
 */
const LIVENESS_POLL_MS = 250;
/**
 * If this much wall-clock has passed since the last `recordFrame()` call
 * AND we've already collected enough samples for a steady state, halt.
 * Two seconds is short enough that we react before the macOS WindowServer
 * watchdog (40s) and long enough to ride out a one-off GC pause.
 */
const LIVENESS_STALL_MS = 2000;
/**
 * Don't trigger the liveness watchdog before this many frames have been
 * recorded — boot-time hitches (asset prefetch, atlas warmup) routinely
 * exceed 2s without it being a real hang. Once we're past warmup, the
 * threshold is meaningful.
 */
const LIVENESS_WARMUP_FRAMES = 60;

/**
 * localStorage key controlling boot-time safe mode. When set to "1",
 * the watchdog starts in halted state — every Vello render entry point
 * returns null from the very first call, which makes the app boot
 * cleanly without enqueueing any GPU work. The user is left with a
 * black map but a fully-functional React HUD; from there they can
 * inspect state, run console diagnostics, and decide when (if ever) to
 * `__normalMode()` back in.
 *
 * This is the escape hatch for the macOS WindowServer kill loop:
 * crash → reboot → set this flag → next launch boots without crashing.
 */
const SAFE_MODE_KEY = "dofus.gpuSafeMode";

function readSafeModeFlag(): boolean {
  try {
    return globalThis.localStorage?.getItem(SAFE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface TileDispatchStats {
  avgMs: number;
  lastMs: number;
  dispatchesPerSec: number;
}

export interface FrameAtlasStats {
  slots: number;
  maxSlots: number;
  lastRenders: number;
  lastQueueMs: number;
  lastFlushMs: number;
  lastHits: number;
}

export interface SwfLoadStats {
  /** Currently fetching+decoding (≤ LOAD_CONCURRENCY in vello-loader). */
  active: number;
  /** Waiting for a slot. Steady state during boot before settling at 0. */
  queued: number;
  /** Total bundles successfully loaded since session start. */
  loaded: number;
}

export interface DeviceLostInfo {
  reason: string;
  message: string;
  at: number;
}

export interface RenderSnapshot {
  /** Wall clock at snapshot creation — used by React to detect changes. */
  generation: number;
  fpsInstant: number;
  fpsAvg1s: number;
  fpsMin10s: number;
  frameMsLast: number;
  frameMsAvg: number;
  frameMsP99: number;
  frameMsLongest10s: number;
  slowFrames1s: number;
  stalledFrames10s: number;
  /** Last 120 frame times (newest last), in ms. Bounded for React perf. */
  histogramMs: number[];
  textureCountActive: number;
  texturesCreatedTotal: number;
  texturesFreedTotal: number;
  /**
   * Live Vello canvas surfaces — battlefield bottom + top + per-HUD-icon
   * + per-portrait + the shared HudVelloAtlas. Each surface owns a
   * WebGPU swap chain; an unbounded climb means an `attachCanvasSurface`
   * is missing its `detachSurface` somewhere (cache eviction, component
   * unmount, battlefield teardown).
   */
  surfaceCountActive: number;
  surfacesAttachedTotal: number;
  surfacesDetachedTotal: number;
  testPlayerCount: number;
  deviceLost: DeviceLostInfo | null;
  emergencyHalt: boolean;
  jsHeapUsedMB: number | null;
  jsHeapLimitMB: number | null;
  tileDispatch: TileDispatchStats | null;
  frameAtlas: FrameAtlasStats | null;
  atlasCacheBytes: number | null;
  atlasCacheEntries: number | null;
  swfLoad: SwfLoadStats | null;
  warnings: ReadonlyArray<string>;
}

interface StatsProviders {
  tileDispatch?: () => TileDispatchStats | null;
  frameAtlas?: () => FrameAtlasStats | null;
  atlasCacheBytes?: () => number;
  atlasCacheEntries?: () => number;
  testPlayerCount?: () => number;
  swfLoad?: () => SwfLoadStats | null;
  /** Phase-1 allocation accountant (vello-loader.getGpuLedger). */
  gpuLedger?: () => {
    budgetBytes: number;
    liveBytes: number;
    refusalCount: number;
    refusedBytes: number;
    lastRefusedLabel: string;
    allocRateBytes: number;
    rateWindowTicks: number;
  } | null;
}

interface PerfWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

type EmergencyHandler = () => void;

class RenderWatchdog {
  private frameTimes: Float32Array = new Float32Array(FRAME_HISTORY);
  private frameTimestamps: Float64Array = new Float64Array(FRAME_HISTORY);
  private frameWriteIdx = 0;
  private frameCount = 0;
  private stallRun = 0;

  private texturesActive = 0;
  private texturesCreated = 0;
  private texturesFreed = 0;

  /**
   * Live Vello canvas surfaces. Bumped by `attachCanvasSurface` /
   * `detachSurface` in `vello-loader.ts`. A monotonically growing
   * delta of `attached - detached` is the canonical leak signal for
   * the three-canvas architecture.
   */
  private surfacesActive = 0;
  private surfacesAttached = 0;
  private surfacesDetached = 0;

  private deviceLost: DeviceLostInfo | null = null;
  // Boot-time safe mode: if the localStorage flag is set, start halted.
  // Every render entry point checks `isHalted()` and returns null, so
  // no GPU work is enqueued and the app can boot without crashing.
  private halted = readSafeModeFlag();
  private autoHaltedReason: string | null = readSafeModeFlag()
    ? "boot-time safe mode (localStorage `dofus.gpuSafeMode`=1) — call `__normalMode()` to clear"
    : null;

  private providers: StatsProviders = {};
  private emergencyHandlers: EmergencyHandler[] = [];

  private listeners = new Set<() => void>();
  private dirty = true;
  private lastSnapshot: RenderSnapshot = this.makeEmptySnapshot();
  private lastNotifyAt = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Console heartbeat interval. Every 1s logs ALL tracked counters so
   * the user can see what's growing without needing to keep the React
   * HUD focused — important when the host crashes and we lose the HUD
   * state. Output goes to the dev console which Electrobun captures.
   *
   * Also probes Pixi-side state (TexturePool size if accessible)
   * because the leak that crashes the host is NOT in instrumented
   * Vello textures; we need broader visibility to find the real
   * culprit. Stops on emergencyHalt to avoid noise during recovery.
   */
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatSnapshot: {
    active: number;
    created: number;
    freed: number;
    jsHeapMB: number | null;
  } | null = null;
  /** GPU-budget refusal total at the last heartbeat (delta alerting). */
  private lastGpuRefusalCount = 0;

  /**
   * watchdog (which runs on `setInterval`, not `requestAnimationFrame`)
   * to detect when the rAF loop has stalled. -1 = no frames recorded yet.
   */
  private lastFrameAt = -1;
  private livenessInterval: ReturnType<typeof setInterval> | null = null;

  /** Pixi ticker hook — call exactly once per frame. */
  recordFrame(dtMs: number): void {
    // Guard NaN / negative — Pixi's first tick sometimes feeds 0 or
    // sub-ms. Treat non-finite as a 16ms placeholder so percentile
    // math doesn't poison itself.
    let ms = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 16;
    // Clamp absurd spikes (e.g. tab returning from background can fire
    // a 30s dt that would skew P99 for the next 10s).
    if (ms > 5000) {
      ms = 5000;
    }

    this.frameTimes[this.frameWriteIdx] = ms;
    this.frameTimestamps[this.frameWriteIdx] = performance.now();
    this.frameWriteIdx = (this.frameWriteIdx + 1) % FRAME_HISTORY;
    this.frameCount++;
    this.lastFrameAt = performance.now();
    // Lazy-start the liveness watchdog on the first frame; before any
    // frame has fired the rAF loop hasn't proven itself alive yet, so
    // there's no baseline to compare "no recent tick" against.
    if (!this.livenessInterval) this.startLivenessWatchdog();

    if (ms >= STALL_FRAME_MS) {
      this.stallRun++;
      if (
        this.stallRun >= AUTO_HALT_STALL_RUN &&
        !this.halted &&
        !this.autoHaltedReason
      ) {
        // Three consecutive ≥100ms frames is the canonical "GPU is
        // about to fall over" signature. Auto-halt buys time for the
        // user to react before the host driver gives up.
        this.autoHaltedReason = `${this.stallRun} consecutive stall frames (last=${ms.toFixed(0)}ms)`;
        log.warn(
          `Auto-halt triggered: ${this.autoHaltedReason}. Pausing render submissions.`
        );
        this.emergencyHalt();
      }
    } else {
      this.stallRun = 0;
    }

    if (
      this.texturesActive >= TEXTURE_COUNT_HALT &&
      !this.halted &&
      !this.autoHaltedReason
    ) {
      this.autoHaltedReason = `texture count ${this.texturesActive} exceeded ${TEXTURE_COUNT_HALT}`;
      log.warn(`Auto-halt triggered: ${this.autoHaltedReason}.`);
      this.emergencyHalt();
    }

    this.markDirty();
  }

  registerTextureCreated(label?: string): void {
    this.texturesActive++;
    this.texturesCreated++;
    if (this.texturesActive === TEXTURE_COUNT_WARN + 1) {
      log.warn(
        `texture count crossed ${TEXTURE_COUNT_WARN} (label=${label ?? "?"}). ` +
          `If it keeps climbing, leak likely — check ExternalSource.destroy() / freeRenderTexture pairing.`
      );
    }
    this.markDirty();
  }

  registerTextureFreed(label?: string): void {
    if (this.texturesActive > 0) {
      this.texturesActive--;
    } else {
      log.warn(
        `registerTextureFreed underflow (label=${label ?? "?"}). ` +
          `A free was reported without a matching create — instrumentation drift.`
      );
    }
    this.texturesFreed++;
    this.markDirty();
  }

  /**
   * Bump on every successful `attachCanvasSurface` call. `label` is a
   * free-form descriptor (e.g. `"battlefield-bottom"`, `"hud-atlas"`,
   * `"spell-icon:1054@48"`) that surfaces in the warning when the
   * active count grows unexpectedly.
   */
  registerSurfaceAttached(label?: string): void {
    this.surfacesActive++;
    this.surfacesAttached++;
    if (this.surfacesActive === SURFACE_COUNT_WARN + 1) {
      log.warn(
        `surface count crossed ${SURFACE_COUNT_WARN} (label=${label ?? "?"}). ` +
          "Each surface owns a WebGPU swap chain — verify that cache eviction " +
          "calls detachSurface() and that on-unmount cleanup runs.",
      );
    }
    this.markDirty();
  }

  /** Bump on every `detachSurface` call. */
  registerSurfaceDetached(label?: string): void {
    if (this.surfacesActive > 0) {
      this.surfacesActive--;
    } else {
      log.warn(
        `registerSurfaceDetached underflow (label=${label ?? "?"}). ` +
          "A detach was reported without a matching attach — instrumentation drift.",
      );
    }
    this.surfacesDetached++;
    this.markDirty();
  }

  setDeviceLost(info: GPUDeviceLostInfo): void {
    this.deviceLost = {
      reason: info.reason ?? "unknown",
      message: info.message ?? "(no message)",
      at: Date.now(),
    };
    log.error(
      `WebGPU device lost — reason=${this.deviceLost.reason}, message=${this.deviceLost.message}`
    );
    this.emergencyHalt();
    this.markDirty();
  }

  setStatsProvider(providers: Partial<StatsProviders>): void {
    this.providers = { ...this.providers, ...providers };
    this.markDirty();
  }

  /**
   * Register a handler that fires on emergencyHalt. Stress-test, animation
   * pump, etc. attach their own kill-switches here.
   */
  onEmergencyHalt(handler: EmergencyHandler): () => void {
    this.emergencyHandlers.push(handler);
    return () => {
      const idx = this.emergencyHandlers.indexOf(handler);
      if (idx >= 0) {
        this.emergencyHandlers.splice(idx, 1);
      }
    };
  }

  /**
   * Pull every brake we have. Idempotent — repeated calls just re-fire
   * handlers (which should themselves be idempotent: cancel timers, clear
   * arrays, set flags).
   */
  emergencyHalt(): void {
    this.halted = true;
    for (const handler of this.emergencyHandlers) {
      try {
        handler();
      } catch (e) {
        log.error("emergency handler threw:", e);
      }
    }
    this.markDirty();
  }

  /** Manual resume — clears halt flag. Auto-halt reason is preserved as a warning. */
  resume(): void {
    if (!this.halted) {
      return;
    }
    this.halted = false;
    log.info(
      `Resumed from halt${this.autoHaltedReason ? ` (was: ${this.autoHaltedReason})` : ""}.`
    );
    // Clear stall run so the next frame doesn't immediately re-halt.
    this.stallRun = 0;
    this.markDirty();
  }

  isHalted(): boolean {
    return this.halted;
  }

  /**
   * Start the event-loop-based liveness watchdog. Critical: this fires
   * on `setInterval`, NOT `requestAnimationFrame`. When the WebGPU
   * command queue saturates (the path that the macOS WindowServer
   * watchdog kills with code 409 / WATCHDOG namespace), the browser
   * stops scheduling rAF callbacks — but `setInterval` keeps firing on
   * the JS event loop. So this is the ONLY watchdog that can react to
   * a true GPU hang. The rAF-side stall counter inside `recordFrame`
   * never gets a chance to fire because `recordFrame` is called from
   * the rAF callback that just stopped firing.
   */
  private startLivenessWatchdog(): void {
    if (this.livenessInterval) return;
    this.livenessInterval = setInterval(() => {
      if (this.halted) return;
      if (this.frameCount < LIVENESS_WARMUP_FRAMES) return;
      if (this.lastFrameAt < 0) return;
      const elapsed = performance.now() - this.lastFrameAt;
      if (elapsed >= LIVENESS_STALL_MS) {
        this.autoHaltedReason = `rAF stalled for ${elapsed.toFixed(0)}ms (no frame since last tick) — probable GPU hang`;
        log.error(
          `Liveness watchdog: ${this.autoHaltedReason}. Halting render submissions before macOS WindowServer kills the compositor.`
        );
        this.emergencyHalt();
      }
    }, LIVENESS_POLL_MS);
    this.startHeartbeat();
  }

  /**
   * Per-second console dump of every tracked counter. Logs the DELTA
   * since last heartbeat so a steadily-climbing counter shows up as a
   * non-zero delta tick after tick — the smoking gun signature for a
   * leak. Console output survives the macOS WindowServer kill (the
   * stdout buffer is flushed before the process is killed), so even
   * if the host reboots we can examine the trail post-mortem.
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      if (this.halted) return;
      const perf = performance as PerfWithMemory;
      const heap = perf.memory?.usedJSHeapSize ?? null;
      const heapMB = heap !== null ? heap / (1024 * 1024) : null;
      const cur = {
        active: this.texturesActive,
        created: this.texturesCreated,
        freed: this.texturesFreed,
        jsHeapMB: heapMB,
      };
      let deltaStr = "";
      if (this.lastHeartbeatSnapshot) {
        const dActive = cur.active - this.lastHeartbeatSnapshot.active;
        const dCreated = cur.created - this.lastHeartbeatSnapshot.created;
        const dFreed = cur.freed - this.lastHeartbeatSnapshot.freed;
        const dHeap =
          cur.jsHeapMB !== null && this.lastHeartbeatSnapshot.jsHeapMB !== null
            ? cur.jsHeapMB - this.lastHeartbeatSnapshot.jsHeapMB
            : null;
        deltaStr = ` Δ[active${dActive >= 0 ? "+" : ""}${dActive}, created+${dCreated}, freed+${dFreed}${dHeap !== null ? `, heap${dHeap >= 0 ? "+" : ""}${dHeap.toFixed(1)}MB` : ""}]`;
      }
      // Probe Pixi TexturePool if accessible. The pool is a process
      // singleton in pixi.js — its internal map size can hint at
      // filter-pool growth. Best-effort, swallow errors silently.
      let poolStr = "";
      try {
        const pixi = (globalThis as unknown as { __PIXI_APP__?: unknown })
          .__PIXI_APP__;
        void pixi;
        // Pixi v8 exposes TexturePool via `import { TexturePool } from "pixi.js"`
        // — accessing it through globalThis is uneven; we instead rely on
        // user setting `window.__PIXI_DEVTOOLS__` when needed. Skip for now.
      } catch {
        // ignore
      }
      const tileStats = safeCall(this.providers.tileDispatch, null);
      const tileStr = tileStats
        ? ` tile=${tileStats.lastMs.toFixed(1)}ms/${tileStats.dispatchesPerSec.toFixed(0)}fps`
        : "";
      // Phase-1 GPU allocation accountant: log live bytes vs budget +
      // the trailing allocation rate, and shout when the hard budget
      // starts REFUSING allocations — a refusal means a bake got a
      // placeholder resource (visible corruption is expected and
      // preferable to a host kill; the working set must shrink).
      let gpuStr = "";
      const ledger = safeCall(this.providers.gpuLedger, null);
      if (ledger) {
        const mb = (b: number) => (b / 1048576).toFixed(0);
        gpuStr = ` gpu=${mb(ledger.liveBytes)}MB${ledger.budgetBytes > 0 ? `/${mb(ledger.budgetBytes)}MB` : ""} rate=${mb(ledger.allocRateBytes)}MB/${ledger.rateWindowTicks}t`;
        if (ledger.refusalCount > this.lastGpuRefusalCount) {
          log.error(
            `GPU BUDGET REFUSALS: ${ledger.refusalCount} total (+${
              ledger.refusalCount - this.lastGpuRefusalCount
            } this heartbeat), last label "${ledger.lastRefusedLabel}", ` +
              `${mb(ledger.refusedBytes)}MB refused — live=${mb(ledger.liveBytes)}MB budget=${mb(ledger.budgetBytes)}MB`
          );
          this.lastGpuRefusalCount = ledger.refusalCount;
          this.markDirty();
        }
      }
      log.info(
        `[heartbeat] active=${cur.active} created=${cur.created} freed=${cur.freed}${cur.jsHeapMB !== null ? ` heap=${cur.jsHeapMB.toFixed(0)}MB` : ""}${deltaStr}${poolStr}${tileStr}${gpuStr}`
      );
      this.lastHeartbeatSnapshot = cur;
    }, 1000);
  }

  // ── React subscription protocol ──────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // `useSyncExternalStore` calls this on every render AND whenever React
  // checks the store, so it MUST be cheap and return a STABLE reference
  // between notifications — otherwise the subscriber (RenderDebugOverlay)
  // re-renders every frame (recordFrame marks dirty every tick), allocating
  // a full vdom tree + a fresh snapshot 60-120×/sec. That churn was ~2/3 of
  // the per-frame GC pressure. The snapshot is now recomputed ONLY in
  // `fireListeners` (throttled to NOTIFY_INTERVAL_MS), so this just returns
  // the cached value and the overlay re-renders at the notify cadence.
  getSnapshot = (): RenderSnapshot => this.lastSnapshot;

  // ── Internals ────────────────────────────────────────────────

  private markDirty(): void {
    this.dirty = true;
    const now = performance.now();
    if (now - this.lastNotifyAt >= NOTIFY_INTERVAL_MS) {
      this.lastNotifyAt = now;
      this.fireListeners();
    } else if (!this.notifyTimer) {
      const delay = NOTIFY_INTERVAL_MS - (now - this.lastNotifyAt);
      this.notifyTimer = setTimeout(
        () => {
          this.notifyTimer = null;
          this.lastNotifyAt = performance.now();
          this.fireListeners();
        },
        Math.max(16, delay)
      );
    }
  }

  private fireListeners(): void {
    // Recompute the snapshot at most once per notify (throttled to
    // NOTIFY_INTERVAL_MS), not on every per-frame getSnapshot call — this is
    // the only place `lastSnapshot` changes, giving subscribers a stable
    // reference between notifies and capping the overlay's re-render rate.
    if (this.dirty) {
      this.lastSnapshot = this.computeSnapshot();
      this.dirty = false;
    }
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        log.error("listener threw:", e);
      }
    }
  }

  private computeSnapshot(): RenderSnapshot {
    const samples = this.collectRecentFrames();
    const now = performance.now();

    const fpsInstant =
      samples.length > 0 ? 1000 / samples[samples.length - 1]! : 0;

    let frameMsAvg = 0;
    let count1s = 0;
    let sum1s = 0;
    let slow1s = 0;
    let stall10s = 0;
    let longest10s = 0;
    let _count10s = 0;
    let _sum10s = 0;
    for (let i = 0; i < samples.length; i++) {
      const ms = samples[i]!;
      const ts =
        this.frameTimestamps[
          (this.frameWriteIdx - samples.length + i + FRAME_HISTORY) %
            FRAME_HISTORY
        ]!;
      const age = now - ts;
      if (age <= 1000) {
        sum1s += ms;
        count1s++;
        if (ms >= SLOW_FRAME_MS) {
          slow1s++;
        }
      }
      if (age <= 10000) {
        _sum10s += ms;
        _count10s++;
        if (ms >= STALL_FRAME_MS) {
          stall10s++;
        }
        if (ms > longest10s) {
          longest10s = ms;
        }
      }
      frameMsAvg += ms;
    }
    if (samples.length > 0) {
      frameMsAvg /= samples.length;
    }
    const fpsAvg1s = sum1s > 0 ? (count1s * 1000) / sum1s : 0;
    // FPS min over 10s = inverse of longest 10s frame (worst single-frame perf).
    const fpsMin10s = longest10s > 0 ? 1000 / longest10s : 0;

    const sorted = Float32Array.from(samples).sort();
    const p99 =
      sorted.length > 0
        ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]!
        : 0;

    // Last 120 frames for the histogram strip (~2s at 60fps).
    const histogramMs: number[] = [];
    const start = Math.max(0, samples.length - 120);
    for (let i = start; i < samples.length; i++) {
      histogramMs.push(samples[i]!);
    }

    const perf = performance as PerfWithMemory;
    const mem = perf.memory;
    const jsHeapUsedMB = mem ? mem.usedJSHeapSize / (1024 * 1024) : null;
    const jsHeapLimitMB = mem ? mem.jsHeapSizeLimit / (1024 * 1024) : null;

    const warnings: string[] = [];
    if (this.deviceLost) {
      warnings.push(`GPU device lost: ${this.deviceLost.reason}`);
    }
    if (this.halted) {
      warnings.push("Render halted");
    }
    if (this.autoHaltedReason) {
      warnings.push(`Auto-halt: ${this.autoHaltedReason}`);
    }
    if (this.texturesActive >= TEXTURE_COUNT_WARN) {
      warnings.push(`High texture count: ${this.texturesActive}`);
    }
    if (this.lastGpuRefusalCount > 0) {
      warnings.push(
        `GPU budget refusing allocations (${this.lastGpuRefusalCount})`
      );
    }
    if (slow1s >= 30) {
      warnings.push(`Slow frames last 1s: ${slow1s}`);
    }
    if (stall10s >= 5) {
      warnings.push(`Stalls last 10s: ${stall10s}`);
    }
    if (
      jsHeapUsedMB !== null &&
      jsHeapLimitMB !== null &&
      jsHeapUsedMB / jsHeapLimitMB > 0.85
    ) {
      warnings.push(
        `JS heap ${jsHeapUsedMB.toFixed(0)}MB / ${jsHeapLimitMB.toFixed(0)}MB`
      );
    }

    return {
      generation: this.frameCount,
      fpsInstant,
      fpsAvg1s,
      fpsMin10s,
      frameMsLast: samples.length > 0 ? samples[samples.length - 1]! : 0,
      frameMsAvg,
      frameMsP99: p99,
      frameMsLongest10s: longest10s,
      slowFrames1s: slow1s,
      stalledFrames10s: stall10s,
      histogramMs,
      textureCountActive: this.texturesActive,
      texturesCreatedTotal: this.texturesCreated,
      texturesFreedTotal: this.texturesFreed,
      surfaceCountActive: this.surfacesActive,
      surfacesAttachedTotal: this.surfacesAttached,
      surfacesDetachedTotal: this.surfacesDetached,
      testPlayerCount: safeCall(this.providers.testPlayerCount, 0),
      deviceLost: this.deviceLost,
      emergencyHalt: this.halted,
      jsHeapUsedMB,
      jsHeapLimitMB,
      tileDispatch: safeCall(this.providers.tileDispatch, null),
      frameAtlas: safeCall(this.providers.frameAtlas, null),
      atlasCacheBytes: safeCall(this.providers.atlasCacheBytes, null),
      atlasCacheEntries: safeCall(this.providers.atlasCacheEntries, null),
      swfLoad: safeCall(this.providers.swfLoad, null),
      warnings,
    };
  }

  /**
   * Walk the frame ring oldest → newest and return only the populated
   * entries (the ring may not be full during the first 10 seconds of
   * gameplay).
   */
  private collectRecentFrames(): number[] {
    const out: number[] = [];
    const total = Math.min(this.frameCount, FRAME_HISTORY);
    if (total === 0) {
      return out;
    }
    const start = (this.frameWriteIdx - total + FRAME_HISTORY) % FRAME_HISTORY;
    for (let i = 0; i < total; i++) {
      out.push(this.frameTimes[(start + i) % FRAME_HISTORY]!);
    }
    return out;
  }

  private makeEmptySnapshot(): RenderSnapshot {
    return {
      generation: 0,
      fpsInstant: 0,
      fpsAvg1s: 0,
      fpsMin10s: 0,
      frameMsLast: 0,
      frameMsAvg: 0,
      frameMsP99: 0,
      frameMsLongest10s: 0,
      slowFrames1s: 0,
      stalledFrames10s: 0,
      histogramMs: [],
      textureCountActive: 0,
      texturesCreatedTotal: 0,
      texturesFreedTotal: 0,
      surfaceCountActive: 0,
      surfacesAttachedTotal: 0,
      surfacesDetachedTotal: 0,
      testPlayerCount: 0,
      deviceLost: null,
      emergencyHalt: false,
      jsHeapUsedMB: null,
      jsHeapLimitMB: null,
      tileDispatch: null,
      frameAtlas: null,
      atlasCacheBytes: null,
      atlasCacheEntries: null,
      swfLoad: null,
      warnings: [],
    };
  }
}

function safeCall<T>(fn: (() => T) | undefined, fallback: T): T {
  if (!fn) {
    return fallback;
  }
  try {
    return fn();
  } catch {
    return fallback;
  }
}

let instance: RenderWatchdog | null = null;
export function getRenderWatchdog(): RenderWatchdog {
  if (!instance) {
    instance = new RenderWatchdog();
  }
  return instance;
}

export type { RenderWatchdog };
