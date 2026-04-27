import type { FrameAtlas } from "@/game/render/frame-atlas";

/**
 * Rolling per-frame timing buckets for the player render pipeline.
 * No periodic logging — numbers are exposed via `lastUpdateMs` for the
 * optional debug overlay; the previous once-per-second console dump
 * was removed because it spammed the devtools without carrying
 * actionable information.
 */
export class PlayerPerfMonitor {
  private frameT0 = 0;

  /** Exposed for debug overlay read-back. */
  lastUpdateMs = 0;

  beginFrame(): void {
    this.frameT0 = performance.now();
  }

  endAnim(): void {
    // Retained for API compatibility; timings are read via lastUpdateMs.
  }

  recordFlush(_startTime: number): void {
    // Retained for API compatibility; see above.
  }

  endFrame(
    _deltaMs: number,
    _playerCount: number,
    _atlas: FrameAtlas | null
  ): void {
    this.lastUpdateMs = performance.now() - this.frameT0;
  }
}
