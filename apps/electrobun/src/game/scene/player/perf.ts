import type { FrameAtlas } from "@/game/render/frame-atlas";

const LOG_INTERVAL_MS = 1000;

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/**
 * Rolling per-frame timing buckets for the player render pipeline.
 * Logs an aggregated line once per second when `logInterval` elapses.
 */
export class PlayerPerfMonitor {
  private prevFrameStart = 0;
  private frameTimes: number[] = [];
  private updateTimes: number[] = [];
  private animTimes: number[] = [];
  private flushTimes: number[] = [];
  private logTimer = 0;

  private frameT0 = 0;
  private animT0 = 0;

  /** Exposed for debug overlay read-back. */
  lastUpdateMs = 0;

  beginFrame(): void {
    this.frameT0 = performance.now();

    if (this.prevFrameStart > 0) {
      this.frameTimes.push(this.frameT0 - this.prevFrameStart);
    }

    this.prevFrameStart = this.frameT0;
    this.animT0 = performance.now();
  }

  endAnim(): void {
    this.animTimes.push(performance.now() - this.animT0);
  }

  recordFlush(startTime: number): void {
    this.flushTimes.push(performance.now() - startTime);
  }

  endFrame(
    deltaMs: number,
    playerCount: number,
    atlas: FrameAtlas | null
  ): void {
    this.lastUpdateMs = performance.now() - this.frameT0;
    this.updateTimes.push(this.lastUpdateMs);
    this.logTimer += deltaMs;

    if (this.logTimer < LOG_INTERVAL_MS || this.frameTimes.length === 0) {
      return;
    }

    this.flushSummary(playerCount, atlas);
    this.reset();
  }

  private flushSummary(playerCount: number, atlas: FrameAtlas | null): void {
    const frameMs = avg(this.frameTimes);
    const updateMs = avg(this.updateTimes);
    const animMs = avg(this.animTimes);
    const flushMs = avg(this.flushTimes);
    const pixiMs = frameMs - updateMs;
    const s = atlas?.stats;

    console.log(
      `[PERF] ${(1000 / frameMs).toFixed(0)}fps ` +
        `frame:${frameMs.toFixed(1)}ms ` +
        `upd:${updateMs.toFixed(1)}ms ` +
        `(anim+move:${animMs.toFixed(1)}ms flush:${flushMs.toFixed(1)}ms) ` +
        `pixi+gpu:${pixiMs.toFixed(1)}ms ` +
        `| ${playerCount}players ` +
        (s
          ? `slots:${s.slots}/${s.maxSlots} r:${s.lastRenders} ` +
            `q:${s.lastQueueMs.toFixed(1)}ms fl:${s.lastFlushMs.toFixed(1)}ms ` +
            `h:${s.lastHits}`
          : "no atlas")
    );
  }

  private reset(): void {
    this.logTimer = 0;
    this.frameTimes = [];
    this.updateTimes = [];
    this.animTimes = [];
    this.flushTimes = [];
  }
}
