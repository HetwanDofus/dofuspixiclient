/**
 * Per-frame-budgeted strip-bake queue.
 *
 * `PlayerStripRenderer.applyAnimation` used to call
 * `renderSwfStripRangeAccessorized` synchronously on every anim swap.
 * That works at small N but collapses when many bots swap on the same
 * tick (e.g. spawn ramp finishing, simultaneous movement-loop kickoff,
 * fight-start where everyone changes pose at once). N synchronous Vello
 * dispatches block the rAF callback for N × ~5 ms; at N = 200 that's
 * ~1 second of stalled frames and the watchdog auto-halts.
 *
 * This queue absorbs the burst: callers enqueue a bake key + render
 * closure + callback. Each rAF tick the queue drains up to `budgetMs`
 * of bake work, then yields. Callers get their strips a few frames
 * later — invisible to the player because anim swaps were going to
 * idle/walk transition anyway.
 *
 * Two extra properties worth flagging:
 *
 * 1. **Dedup by key.** Two requests with the same key (same bundle +
 *    anim + dir + flipped + look) collapse into one render with two
 *    callbacks. Today this rarely hits across bots (random looks make
 *    keys unique) but it's free insurance, and it'll be the dominant
 *    win after the planned shader-recolour refactor decouples color
 *    zones from the bake key (every bot of the same class would share
 *    strips, so dedup hit rate jumps from ~0% to ~99%).
 *
 * 2. **Stale-result guard.** A bot can request walkR then immediately
 *    request walkL while walkR is still queued. The callback signature
 *    receives the strip and the caller is responsible for checking
 *    whether the result is still wanted; stale results MUST call
 *    `freeRenderTexture(strip.textureId)` to avoid leaking GPU memory.
 *    `PlayerStripRenderer` does this check inside its callback.
 */

import { getRenderWatchdog } from "@/game/render/render-watchdog";
import { createLogger } from "@/utils/logger";

const log = createLogger("StripBakeQueue");

/** Generic bake render closure. Returns whatever the caller wants —
 *  the queue itself only cares about non-nullness for routing. Cleanup
 *  on error or stale-skip is the caller's responsibility. */
export type StripBakeRender = () => unknown;
export type StripBakeCallback = (result: unknown) => void;
/** Predicate run right before `render()` fires. If returns false, this
 *  caller is dropped from the bake. If ALL callers' predicates return
 *  false (or were never provided and the entry was the only one),
 *  the render itself is skipped — saves the ~4 ms Vello dispatch +
 *  the wgpu::Texture allocation. */
export type StripBakeWantedCheck = () => boolean;

interface PendingCallback {
  onReady: StripBakeCallback;
  isWanted: StripBakeWantedCheck | null;
}

interface PendingEntry {
  render: StripBakeRender;
  callbacks: PendingCallback[];
}

/**
 * Per-frame budget steps used by the adaptive drain. The queue raises
 * its own budget when the backlog grows past `HIGH_WATERMARK` and
 * lowers it back when it falls under `LOW_WATERMARK`. Steps are
 * picked so a heavy backlog gets ~75 % of a frame (drops frame rate
 * but clears the queue fast), an idle queue gets ~25 % (invisible to
 * the user), with a middle step in between.
 */
const BUDGET_IDLE_MS = 4; // ~25 % of a 16.7 ms frame
const BUDGET_BUSY_MS = 8; // ~50 %
const BUDGET_HEAVY_MS = 12; // ~75 %
const HIGH_WATERMARK = 200;
const LOW_WATERMARK = 30;

class StripBakeQueue {
  /**
   * Insertion-ordered map of pending bakes keyed by anim-key. We
   * iterate in insertion order so FIFO holds — a bot that requested
   * walkR before its neighbour gets its strip first.
   */
  private pending = new Map<string, PendingEntry>();
  private rafHandle: number | null = null;
  private budgetMs = BUDGET_IDLE_MS;

  /** Cumulative counts for diagnostics — read by the stress monitor. */
  private totalEnqueued = 0;
  private totalDispatched = 0;
  private totalDedupCollapses = 0;
  private totalStaleSkipped = 0;

  setBudgetMs(ms: number): void {
    this.budgetMs = Math.max(0.5, ms);
  }

  /**
   * Enqueue a bake. If `key` is already pending, `onReady` is added to
   * the existing entry's callback list (dedup collapse — the bake
   * fires once and every callback gets the same result). Otherwise a
   * new entry is appended at the tail and a rAF drain is scheduled.
   */
  enqueue(
    key: string,
    render: StripBakeRender,
    onReady: StripBakeCallback,
    isWanted: StripBakeWantedCheck | null = null,
  ): void {
    this.totalEnqueued += 1;
    const existing = this.pending.get(key);
    if (existing) {
      existing.callbacks.push({ onReady, isWanted });
      this.totalDedupCollapses += 1;
      return;
    }
    this.pending.set(key, {
      render,
      callbacks: [{ onReady, isWanted }],
    });
    this.scheduleDrain();
  }

  /**
   * Best-effort cancel. If the entry is still queued (bake hasn't
   * fired), `onReady` is removed; if it was the last callback for
   * that key, the whole entry is dropped. If the bake already ran,
   * the callback will fire and the caller is responsible for
   * discarding the stale result.
   */
  cancel(key: string, onReady: StripBakeCallback): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    const idx = entry.callbacks.findIndex((c) => c.onReady === onReady);
    if (idx >= 0) entry.callbacks.splice(idx, 1);
    if (entry.callbacks.length === 0) {
      this.pending.delete(key);
    }
  }

  size(): number {
    return this.pending.size;
  }

  getStats(): {
    pending: number;
    totalEnqueued: number;
    totalDispatched: number;
    totalDedupCollapses: number;
    totalStaleSkipped: number;
    budgetMs: number;
  } {
    return {
      pending: this.pending.size,
      totalEnqueued: this.totalEnqueued,
      totalDispatched: this.totalDispatched,
      totalDedupCollapses: this.totalDedupCollapses,
      totalStaleSkipped: this.totalStaleSkipped,
      budgetMs: this.budgetMs,
    };
  }

  private scheduleDrain(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.drain();
    });
  }

  /**
   * Pick the right per-frame budget for the current backlog.
   *
   * Two ladders compose:
   *   1. Queue depth → base budget (4 / 8 / 12 ms).
   *   2. Recent frame time → damping multiplier (0.6× / 0.4×).
   *
   * KEY INVARIANT: budget never falls below `MIN_BUDGET_MS`. Earlier
   * iteration zeroed the budget when `frameMsAvg ≥ 25 ms` thinking
   * the frame was over-budget because of bakes — but at 300+ bots
   * the frame is over-budget because of Pixi DRAWS, not bakes.
   * Yielding bake budget didn't speed up rendering, it just starved
   * the cache: bake throughput dropped below the miss rate so the
   * queue grew unboundedly, hit rate stalled, eviction churn fed
   * MORE misses, and the death spiral kicked in.
   *
   * The bake queue MUST always make progress proportional to the
   * miss rate or the cache never fills. At 300-bot stress the floor
   * works out to ~4 ms/frame just to break even (50 misses/s × 5 ms
   * per bake / 60 fps).
   *
   * Additionally: if the queue is HEAVY we override the frame-time
   * damping and run full budget. The bakes are the only way out of
   * the churn state — choking them perpetuates it.
   */
  private adaptBudget(): void {
    const n = this.pending.size;
    let target: number;
    if (n >= HIGH_WATERMARK) {
      target = BUDGET_HEAVY_MS;
    } else if (n >= LOW_WATERMARK) {
      target = BUDGET_BUSY_MS;
    } else {
      target = BUDGET_IDLE_MS;
    }
    // Only dampen for frame time when the queue is below the heavy
    // watermark — if the queue is deep we MUST drain to escape the
    // churn state, regardless of what the framerate looks like.
    if (n < HIGH_WATERMARK) {
      try {
        const snap = getRenderWatchdog().getSnapshot();
        const frameMs = snap.frameMsAvg;
        if (Number.isFinite(frameMs) && frameMs > 0) {
          if (frameMs >= 25) {
            target = target * 0.4;
          } else if (frameMs >= 16.7) {
            target = target * 0.6;
          }
        }
      } catch {
        // ignore — watchdog might not be initialised yet.
      }
    }
    // Floor: never below the rate needed to keep up with steady-
    // state miss rate at stress scale. Below this, the cache never
    // fills and the queue grows forever.
    const MIN_BUDGET_MS = 3;
    this.budgetMs = Math.max(MIN_BUDGET_MS, target);
  }

  private drain(): void {
    if (this.pending.size === 0) return;
    this.adaptBudget();
    const deadline = performance.now() + this.budgetMs;
    // Iterate over the (insertion-ordered) Map. We delete entries as
    // we process them to keep memory steady; the for-of remains valid
    // under deletion of the current key per ECMA-262.
    for (const [key, entry] of this.pending) {
      this.pending.delete(key);

      // Drop callbacks whose owners have moved on. If everyone moved
      // on, skip the render entirely — saves the Vello dispatch + GPU
      // texture allocation. This is the dominant savings during heavy
      // direction-change churn (bot rapidly cycles directions while
      // its earlier bakes are still queued).
      const livingCallbacks = entry.callbacks.filter(
        (c) => c.isWanted === null || c.isWanted(),
      );
      if (livingCallbacks.length === 0) {
        this.totalStaleSkipped += 1;
        if (performance.now() >= deadline) break;
        continue;
      }

      let result: unknown = null;
      try {
        result = entry.render();
      } catch (e) {
        log.error(`render for '${key}' threw:`, e);
      }
      this.totalDispatched += 1;
      // Invoke every still-wanted callback. If two callers requested
      // the same key, both get the SAME result — they share the
      // underlying GPU texture. The last caller to release is
      // responsible for `freeRenderTexture` via the normal retire
      // path. Cleanup on callback error is the caller's concern.
      for (const cb of livingCallbacks) {
        try {
          cb.onReady(result);
        } catch (e) {
          log.error(`callback for '${key}' threw:`, e);
        }
      }
      if (performance.now() >= deadline) {
        break;
      }
    }
    if (this.pending.size > 0) {
      this.scheduleDrain();
    }
  }
}

let instance: StripBakeQueue | null = null;

export function getStripBakeQueue(): StripBakeQueue {
  if (!instance) {
    instance = new StripBakeQueue();
  }
  return instance;
}
