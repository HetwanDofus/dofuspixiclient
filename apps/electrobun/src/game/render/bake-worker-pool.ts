/**
 * Opt-9 bake-worker pool.
 *
 * Lazy-initialised singleton wrapping N module-workers each running
 * `bake-worker.ts`. Distributes class-atlas bake requests round-robin
 * across the pool; the main thread continues to handle accessory and
 * single-variant bakes since those are cheap (<1 ms) and frequent.
 *
 * Boot:
 * 1. `initBakeWorkerPool({ size, wasmUrl })` once at boot.
 * 2. Each worker initialises its own WASM + Vello + WebGPU device in
 *    parallel; `init` resolves once they all signal `ready`.
 *
 * Per-bake flow:
 * 1. `bakeClassAtlas(bundle, resolution)` is called from the main
 *    thread (replacing the synchronous `renderer.renderSwfClassAtlas`).
 * 2. The pool picks a worker via round-robin.
 * 3. If the worker hasn't loaded this bundle yet, the main thread
 *    `postMessage`s the cached bundle bytes (from
 *    `getRetainedSwfBundleBytes`), the worker calls its own
 *    `loadSwfBundle`, and replies `bundleLoaded`. Bundle bytes are
 *    cloned (not transferred) so the main thread can still feed other
 *    workers later.
 * 4. The pool dispatches `bakeClassAtlas`; the worker bakes and
 *    replies with `bakeResult` carrying `ImageBitmap`s transferred
 *    zero-copy.
 * 5. The caller's `Promise` resolves with the result.
 *
 * Fallback: if `initBakeWorkerPool` fails (no `navigator.gpu`,
 * Safari < 16.4, dev environment without COOP/COEP, etc.) the pool
 * stays `null` and `bakeClassAtlasViaWorkerPool` returns `null`.
 * Callers must check and fall back to the main-thread path.
 */

import { getRetainedSwfBundleBytes } from "./vello-loader";
import type { VelloSwfClassAtlasResult } from "./vello-loader";

interface PoolSlot {
  worker: Worker;
  loaded: Set<string>;
  loadInflight: Map<string, Promise<void>>;
}

type WorkerOutMsg =
  | { type: "ready" }
  | { type: "bundleLoaded"; name: string }
  | { type: "bakeResult"; reqId: number; result: VelloSwfClassAtlasResult | null }
  | { type: "error"; message: string };

/** Bundle hash for shard dispatch. Stable per-string FNV-1a 32-bit —
 *  deterministic across sessions so the same bundle always lands on
 *  the same worker. Tiny and dependency-free. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

class BakeWorkerPool {
  private slots: PoolSlot[] = [];
  private nextIdx = 0;
  /** Dispatch policy: when true, route each bundle to the same worker
   *  every time via `hash(bundle) % slots.length`. Keeps per-worker
   *  subscene caches warm at pool size > 1 (round-robin would cross-
   *  thrash). Set via `initBakeWorkerPool({ size, shardByBundle })`. */
  private shardByBundle = false;
  private pendingBakes = new Map<
    number,
    {
      resolve: (r: VelloSwfClassAtlasResult | null) => void;
      reject: (e: Error) => void;
    }
  >();
  private nextReqId = 1;

  async init(size: number, wasmUrl?: string): Promise<void> {
    const inits: Promise<void>[] = [];
    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL("./bake-worker.ts", import.meta.url),
        { type: "module" },
      );
      const slot: PoolSlot = {
        worker,
        loaded: new Set(),
        loadInflight: new Map(),
      };
      this.slots.push(slot);
      inits.push(this.bindAndInit(slot, wasmUrl));
    }
    await Promise.all(inits);
  }

  isReady(): boolean {
    return this.slots.length > 0;
  }

  async bakeClassAtlas(
    bundle: string,
    resolution: number,
  ): Promise<VelloSwfClassAtlasResult | null> {
    if (this.slots.length === 0) {
      throw new Error("bake-worker pool not initialised");
    }
    let slot: PoolSlot;
    if (this.shardByBundle) {
      // Shard: same bundle always lands on the same worker, keeping
      // that worker's body_subscene_cache warm across rebakes.
      slot = this.slots[fnv1a32(bundle) % this.slots.length];
    } else {
      // Round-robin: balances load but each worker's subscene cache
      // sees ~7/8 misses at pool=8. Safe only at pool=1.
      slot = this.slots[this.nextIdx];
      this.nextIdx = (this.nextIdx + 1) % this.slots.length;
    }
    await this.ensureBundleLoaded(slot, bundle);
    return this.dispatchBake(slot, bundle, resolution);
  }

  setShardByBundle(on: boolean): void {
    this.shardByBundle = on;
  }
  isShardByBundle(): boolean {
    return this.shardByBundle;
  }
  size(): number {
    return this.slots.length;
  }

  private bindAndInit(slot: PoolSlot, wasmUrl?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      slot.worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
        const msg = e.data;
        switch (msg.type) {
          case "ready":
            resolve();
            return;
          case "bundleLoaded": {
            const pending = slot.loadInflight.get(msg.name);
            if (pending) {
              slot.loaded.add(msg.name);
              slot.loadInflight.delete(msg.name);
            }
            return;
          }
          case "bakeResult": {
            const cb = this.pendingBakes.get(msg.reqId);
            if (cb) {
              this.pendingBakes.delete(msg.reqId);
              // Path 2 instrumentation: stamp the receive time and
              // compute transit (worker→main postMessage cost).
              // The worker stamped `_workerTimings.postPostedAt`
              // just before postMessage; the diff is the transit
              // cost which includes ImageBitmap+ArrayBuffer
              // structured-clone-and-transfer.
              const r = msg.result as unknown as
                | { _workerTimings?: { postPostedAt?: number } }
                | null;
              if (r && r._workerTimings) {
                const wt = r._workerTimings as {
                  postPostedAt?: number;
                  transitMs?: number;
                  mainReceivedAt?: number;
                };
                // Worker stamps postPostedAt in absolute wall-clock
                // (timeOrigin + perf.now()); we compare against the
                // same scale here so the diff is real transit, not
                // the cross-context perf.now() origin offset.
                const recv = performance.timeOrigin + performance.now();
                wt.transitMs =
                  typeof wt.postPostedAt === "number"
                    ? recv - wt.postPostedAt
                    : undefined;
                wt.mainReceivedAt = recv;
              }
              cb.resolve(msg.result);
            }
            return;
          }
          case "error":
            // eslint-disable-next-line no-console
            console.error("[bake-worker] error:", msg.message);
            return;
        }
      };
      slot.worker.onerror = (e) => {
        reject(new Error(`bake-worker boot error: ${e.message}`));
      };
      slot.worker.postMessage({ type: "init", wasmUrl });
    });
  }

  private async ensureBundleLoaded(
    slot: PoolSlot,
    bundle: string,
  ): Promise<void> {
    if (slot.loaded.has(bundle)) return;
    const inflight = slot.loadInflight.get(bundle);
    if (inflight) return inflight;
    const bytes = getRetainedSwfBundleBytes(bundle);
    if (!bytes) {
      throw new Error(
        `bake-worker pool: bundle '${bundle}' not retained on main thread`,
      );
    }
    const promise = new Promise<void>((resolve) => {
      // Resolution is driven by the `bundleLoaded` handler in onmessage
      // above. We stash a per-bundle resolver via a once-handler.
      const handler = (e: MessageEvent<WorkerOutMsg>) => {
        if (e.data.type === "bundleLoaded" && e.data.name === bundle) {
          slot.worker.removeEventListener(
            "message",
            handler as EventListener,
          );
          resolve();
        }
      };
      slot.worker.addEventListener("message", handler as EventListener);
      // Clone bytes for the worker; main thread retains the original
      // so other workers can be fed the same bundle later.
      slot.worker.postMessage(
        { type: "loadBundle", name: bundle, bytes: bytes.slice() },
        // bytes are not transferred — the slice is a copy.
      );
    });
    slot.loadInflight.set(bundle, promise);
    return promise;
  }

  private dispatchBake(
    slot: PoolSlot,
    bundle: string,
    resolution: number,
  ): Promise<VelloSwfClassAtlasResult | null> {
    const reqId = this.nextReqId++;
    return new Promise<VelloSwfClassAtlasResult | null>((resolve, reject) => {
      this.pendingBakes.set(reqId, { resolve, reject });
      slot.worker.postMessage({
        type: "bakeClassAtlas",
        reqId,
        bundle,
        resolution,
      });
    });
  }
}

let pool: BakeWorkerPool | null = null;
/** Resolved when `initBakeWorkerPool` either succeeds (pool ready)
 *  or fails (pool stays null). Always resolves; callers should
 *  `await` this before issuing the first dispatch so they don't race
 *  the multi-worker GPU-device init and fall back to a main-thread
 *  bake that contends with the Pixi ticker's `tickDeferredDestroys`
 *  (which produces the "recursive use of an object" wasm-bindgen
 *  panic when both run within the same Rust borrow window). */
let poolInitDone: Promise<void> | null = null;
let poolInitResolve: (() => void) | null = null;

function ensurePoolInitPromise(): Promise<void> {
  if (poolInitDone) return poolInitDone;
  poolInitDone = new Promise<void>((resolve) => {
    poolInitResolve = resolve;
  });
  return poolInitDone;
}

/** Wait until pool init has completed (success OR failure). Callers
 *  that need pool dispatch should `await` this before checking
 *  `isBakeWorkerPoolReady()`. Always resolves; never rejects. */
export function whenBakeWorkerPoolInitDone(): Promise<void> {
  return ensurePoolInitPromise();
}

/**
 * Initialise the bake-worker pool. Call once at boot AFTER the main
 * thread's Vello is initialised. `wasmUrl` is the path the worker uses
 * to `wasmInit(...)` its own copy of the WASM module.
 *
 * Failure modes (no `navigator.gpu`, worker boot error, etc.) result
 * in `pool = null` and `bakeClassAtlasViaWorkerPool` returning `null`
 * forever; callers fall back to the main-thread bake path.
 *
 * `size` is clamped to `[1, min(navigator.hardwareConcurrency / 2, 4)]`
 * — beyond that, multiple WebGPU device-create calls compete for the
 * same physical GPU at boot and at-runtime bake dispatch starts
 * contending with the main thread's render-loop, producing the
 * `tickDeferredDestroys` "recursive use" wasm-bindgen panic.
 */
export async function initBakeWorkerPool(opts: {
  size: number;
  wasmUrl?: string;
  /** When true (only safe at size > 1), use `hash(bundle) % size` to
   *  pick the worker per dispatch. Keeps per-worker subscene caches
   *  warm; required if you bump size above 1. Default false (round-
   *  robin). See vello-loader.ts for the rationale on pool=1 today. */
  shardByBundle?: boolean;
}): Promise<boolean> {
  ensurePoolInitPromise();
  if (pool) {
    poolInitResolve?.();
    poolInitResolve = null;
    return true;
  }
  // Cap pool size against hardware. Each worker spins up its own
  // WebGPU device against the same physical GPU; the OS-level Metal
  // driver doesn't pipeline many concurrent device-create calls well,
  // so we bound the parallelism.
  let hwc = 4;
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.hardwareConcurrency === "number"
    ) {
      hwc = navigator.hardwareConcurrency;
    }
  } catch {
    // ignore
  }
  const safeMax = Math.max(1, Math.min(4, Math.floor(hwc / 2)));
  const sizeClamped = Math.max(1, Math.min(opts.size, safeMax));
  if (sizeClamped !== opts.size) {
    console.warn(
      `[bake-worker-pool] requested size=${opts.size} clamped to ${sizeClamped} (hwc=${hwc}/2 = ${safeMax})`,
    );
  }
  try {
    const p = new BakeWorkerPool();
    await p.init(sizeClamped, opts.wasmUrl);
    p.setShardByBundle(opts.shardByBundle ?? false);
    pool = p;
    poolInitResolve?.();
    poolInitResolve = null;
    return true;
  } catch {
    pool = null;
    poolInitResolve?.();
    poolInitResolve = null;
    return false;
  }
}

/**
 * Dispatch a class atlas bake to the worker pool. Returns `null` if
 * the pool is not initialised — callers MUST fall back to the
 * synchronous main-thread path in that case.
 */
export async function bakeClassAtlasViaWorkerPool(
  bundle: string,
  resolution: number,
): Promise<VelloSwfClassAtlasResult | null> {
  if (!pool) return null;
  return pool.bakeClassAtlas(bundle, resolution);
}

export function isBakeWorkerPoolReady(): boolean {
  return pool?.isReady() ?? false;
}

/** Diagnostic accessor for the sweep report. Returns the configured
 *  pool size + shard policy so the report can credit measurements to
 *  the right A/B arm. */
export function getBakeWorkerPoolConfig(): {
  size: number;
  shardByBundle: boolean;
  ready: boolean;
} {
  return {
    size: pool?.size() ?? 0,
    shardByBundle: pool?.isShardByBundle() ?? false,
    ready: pool?.isReady() ?? false,
  };
}
