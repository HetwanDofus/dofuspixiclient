/**
 * Per-snapshot wall-time probes for the render pipeline.
 *
 * Single global accumulator, drain-on-read. Each probe records
 * `(count, totalMs, maxMs)` since the last read. The stress monitor
 * reads + resets once per 5 s snapshot. Same pattern as the
 * `tickerStats` block in `stress-test.ts` — duplicating the shape so
 * both run side-by-side without contention.
 *
 * Why this exists: `RENDER_BAKE_PLAN.md` Phase 0. We're trying to
 * validate three assumptions before committing to a tessellation cache
 * + per-bot RT rework:
 *  - Each Vello body-atlas bake costs ~5 ms (drives Phase 1 priority).
 *  - `tickerMsAvg ≈ bakeDrain` when the queue is hot (drives Phase 4
 *    worker-bake priority).
 *  - `composeBot` adds up to ~6 ms/frame at 200 bots (drives Phase 5
 *    RT-reversal priority).
 *
 * Probes are no-op when nothing records into them, so leaving the
 * module imported in production is free.
 */

interface ProbeCounter {
  count: number;
  totalMs: number;
  maxMs: number;
}

const blank = (): ProbeCounter => ({ count: 0, totalMs: 0, maxMs: 0 });

const counters = {
  /** `renderSwfClassAtlas` wall time per call. ONE call per class
   *  per resolution; covers every variant in a single Rust dispatch. */
  classAtlas: blank(),
  /** `renderSwfAccessoryStrip` wall time per call. */
  accessoryStrip: blank(),
  /** `renderSwfMountTransforms` wall time per call. */
  mountTransforms: blank(),
  /** `StripBakeQueue.drain` wall time per rAF firing. */
  bakeDrain: blank(),
  /** `PlayerStripRendererV2.composeBot` wall time per call. */
  composeBot: blank(),
  /** Sub-phase of composeBot: JS iterate + per-batch GPU buffer
   *  upload (`BodyBandBatch.flush`). Scales with batch count. */
  composeFlush: blank(),
  /** Sub-phase of composeBot: `pixiRenderer.render` dispatch per
   *  page. Scales with per-batch instanced draw cost (one draw per
   *  batch per page) — i.e. with total batch count. */
  composeRender: blank(),
};

export type ProbeKey = keyof typeof counters;

/** Add one timing sample. Cheap: 3 field writes + a compare. */
export function recordProbe(key: ProbeKey, ms: number): void {
  const c = counters[key];
  c.count += 1;
  c.totalMs += ms;
  if (ms > c.maxMs) c.maxMs = ms;
}

export type ProbeSnapshot = Record<ProbeKey, ProbeCounter>;

/** Snapshot + clear in place. Stress monitor calls this once per
 *  5 s window so the next window starts fresh. */
export function readAndResetProbes(): ProbeSnapshot {
  const out: ProbeSnapshot = {
    classAtlas: { ...counters.classAtlas },
    accessoryStrip: { ...counters.accessoryStrip },
    mountTransforms: { ...counters.mountTransforms },
    bakeDrain: { ...counters.bakeDrain },
    composeBot: { ...counters.composeBot },
    composeFlush: { ...counters.composeFlush },
    composeRender: { ...counters.composeRender },
  };
  for (const k in counters) {
    const c = counters[k as ProbeKey];
    c.count = 0;
    c.totalMs = 0;
    c.maxMs = 0;
  }
  return out;
}
