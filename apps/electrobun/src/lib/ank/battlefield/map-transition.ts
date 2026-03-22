import {
  BlurFilter,
  type Container,
  type Application,
  RenderTexture,
  Sprite,
  Ticker,
} from "pixi.js";

/**
 * Smooth map-to-map transition using snapshot + crossfade blur.
 *
 * Flow:
 *  1. `startTransition()` — instant: captures mapContainer into a snapshot
 *     sprite that covers loading. Starts a gentle blur-up animation on it.
 *     Does NOT block — tile rendering begins immediately behind the snapshot.
 *
 *  2. `reveal()` — called when new map + actors are ready. Ensures a minimum
 *     time has passed so fast loads don't flash. Then crossfades: snapshot
 *     fades out while mapContainer unblurs simultaneously.
 */
export class MapTransition {
  private app: Application;
  private mapContainer: Container;

  private snapshot: Sprite | null = null;
  private snapshotTexture: RenderTexture | null = null;
  private snapshotBlur: BlurFilter | null = null;
  private mapBlur: BlurFilter | null = null;

  private transitioning = false;
  private transitionStartTime = 0;

  /** Cancel handles for running animations */
  private activeAnimations: (() => void)[] = [];

  // Tuning
  private readonly MAX_BLUR = 10;
  private readonly BLUR_UP_MS = 400; // snapshot blur-up during loading
  private readonly MIN_COVER_MS = 300; // minimum time snapshot stays visible
  private readonly REVEAL_MS = 400; // crossfade + unblur duration

  constructor(app: Application, mapContainer: Container) {
    this.app = app;
    this.mapContainer = mapContainer;
  }

  /**
   * Capture snapshot and start blur-up. Non-blocking.
   * Call right before rendering new tiles.
   */
  startTransition(): void {
    this.cleanup();

    // Nothing to snapshot on first load
    if (this.mapContainer.children.length === 0) {
      return;
    }

    const bounds = this.mapContainer.getBounds();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    this.transitioning = true;
    this.transitionStartTime = performance.now();

    // Oversized capture so the blur has real pixels to sample at the edges
    // instead of bleeding into transparent borders.
    const pad = Math.ceil(this.MAX_BLUR) + 4;

    this.snapshotTexture = RenderTexture.create({
      width: this.app.screen.width + pad * 2,
      height: this.app.screen.height + pad * 2,
    });

    // Shift mapContainer so edge content that sits just off-screen
    // lands inside the padded texture area.
    const origX = this.mapContainer.x;
    const origY = this.mapContainer.y;
    this.mapContainer.position.set(origX + pad, origY + pad);

    this.app.renderer.render({
      container: this.mapContainer,
      target: this.snapshotTexture,
    });

    // Restore original position immediately
    this.mapContainer.position.set(origX, origY);

    this.snapshot = new Sprite(this.snapshotTexture);
    this.snapshot.label = "map-transition-snapshot";
    this.snapshot.position.set(-pad, -pad);

    // Place snapshot above mapContainer so new tiles render behind it
    const mapIndex = this.app.stage.getChildIndex(this.mapContainer);
    this.app.stage.addChildAt(this.snapshot, mapIndex + 1);

    // Start gentle blur-up animation on snapshot (fire and forget)
    this.snapshotBlur = new BlurFilter({ strength: 0, quality: 3 });
    this.snapshot.filters = [this.snapshotBlur];

    this.startAnimation(this.BLUR_UP_MS, (t) => {
      if (this.snapshotBlur) {
        this.snapshotBlur.strength = t * this.MAX_BLUR;
      }
    });
  }

  /**
   * Reveal the new map with a crossfade + unblur.
   * Waits for minimum cover time so fast loads don't flash.
   */
  async reveal(): Promise<void> {
    if (!this.transitioning) return;

    // Ensure minimum cover time has elapsed
    const elapsed = performance.now() - this.transitionStartTime;
    const remaining = this.MIN_COVER_MS - elapsed;
    if (remaining > 0) {
      await this.delay(remaining);
    }

    // Cancel the blur-up animation on snapshot (freeze it where it is)
    this.cancelAnimations();

    // Crossfade: snapshot fades out + mapContainer unblurs simultaneously
    this.mapBlur = new BlurFilter({
      strength: this.MAX_BLUR,
      quality: 3,
    });
    this.mapBlur.padding = this.MAX_BLUR + 4;
    this.mapContainer.filters = [this.mapBlur];

    await this.animateAsync(this.REVEAL_MS, (t) => {
      // Unblur new map
      if (this.mapBlur) {
        this.mapBlur.strength = this.MAX_BLUR * (1 - t);
      }
      // Fade out snapshot
      if (this.snapshot) {
        this.snapshot.alpha = 1 - t;
      }
    });

    // Done — clean everything up
    this.finishTransition();
  }

  isTransitioning(): boolean {
    return this.transitioning;
  }

  cleanup(): void {
    this.cancelAnimations();
    this.removeSnapshot();
    this.removeMapBlur();
    this.transitioning = false;
  }

  destroy(): void {
    this.cleanup();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private finishTransition(): void {
    this.removeSnapshot();
    this.removeMapBlur();
    this.transitioning = false;
  }

  private removeSnapshot(): void {
    if (this.snapshot) {
      this.snapshot.filters = null;
      this.snapshot.parent?.removeChild(this.snapshot);
      this.snapshot.destroy();
      this.snapshot = null;
    }
    this.snapshotBlur = null;

    if (this.snapshotTexture) {
      this.snapshotTexture.destroy(true);
      this.snapshotTexture = null;
    }
  }

  private removeMapBlur(): void {
    if (this.mapBlur) {
      this.mapContainer.filters = null;
      this.mapBlur = null;
    }
  }

  private cancelAnimations(): void {
    for (const cancel of this.activeAnimations) {
      cancel();
    }
    this.activeAnimations = [];
  }

  /** Fire-and-forget animation (for blur-up during load) */
  private startAnimation(
    durationMs: number,
    onTick: (t: number) => void
  ): void {
    const ticker = Ticker.shared;
    let elapsed = 0;

    const tick = () => {
      elapsed += ticker.deltaMS;
      const raw = Math.min(elapsed / durationMs, 1);
      onTick(this.easeOut(raw));

      if (raw >= 1) {
        ticker.remove(tick);
        this.activeAnimations = this.activeAnimations.filter(
          (c) => c !== cancel
        );
      }
    };

    const cancel = () => ticker.remove(tick);
    this.activeAnimations.push(cancel);
    ticker.add(tick);
  }

  /** Awaitable animation (for reveal crossfade) */
  private animateAsync(
    durationMs: number,
    onTick: (t: number) => void
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const ticker = Ticker.shared;
      let elapsed = 0;

      const tick = () => {
        elapsed += ticker.deltaMS;
        const raw = Math.min(elapsed / durationMs, 1);
        onTick(this.easeInOut(raw));

        if (raw >= 1) {
          ticker.remove(tick);
          this.activeAnimations = this.activeAnimations.filter(
            (c) => c !== cancel
          );
          resolve();
        }
      };

      const cancel = () => {
        ticker.remove(tick);
        resolve();
      };

      this.activeAnimations.push(cancel);
      ticker.add(tick);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private easeOut(t: number): number {
    return 1 - (1 - t) ** 2;
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }
}
