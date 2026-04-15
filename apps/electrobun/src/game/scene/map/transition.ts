import {
  type Application,
  BlurFilter,
  type Container,
  type Filter,
  RenderTexture,
  Sprite,
  Ticker,
} from "pixi.js";

export interface TransitionDirection {
  dx: number;
  dy: number;
}

/**
 * Smooth map-to-map transition using snapshot + crossfade blur.
 *
 * Supports two modes:
 *  - **Crossfade** (no direction): blur old → blur-in new (original behavior)
 *  - **Directional pan** (with direction): slide old map out + slide new map in
 *    along the movement axis with motion blur
 *
 * Flow:
 *  1. `startTransition(direction?)` — captures mapContainer into a snapshot.
 *     If direction given, stores it for pan animation.
 *
 *  2. `reveal()` — called when new map + actors are ready.
 *     - Crossfade: snapshot fades out, new map unblurs.
 *     - Pan: snapshot slides out, new map slides in from direction, with blur.
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
  private direction: TransitionDirection | null = null;

  /** Position of mapContainer before we start animating it */
  private mapRestX = 0;
  private mapRestY = 0;

  /** Persistent filters on mapContainer that must survive transitions */
  private baseFilters: Filter[] = [];

  /** Cancel handles for running animations */
  private activeAnimations: (() => void)[] = [];

  // Tuning
  private readonly MAX_BLUR = 8;
  private readonly PAN_BLUR = 4;
  private readonly BLUR_UP_MS = 150;
  private readonly MIN_COVER_MS = 100;
  private readonly REVEAL_MS = 200;
  private readonly PAN_MS = 250;

  constructor(
    app: Application,
    mapContainer: Container,
    baseFilters: Filter[] = []
  ) {
    this.app = app;
    this.mapContainer = mapContainer;
    this.baseFilters = baseFilters;
  }

  /**
   * Capture snapshot and start loading animation. Non-blocking.
   * @param direction If provided, enables directional pan instead of crossfade.
   */
  startTransition(direction?: TransitionDirection): void {
    this.cleanup();

    this.direction = direction ?? null;

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

    const pad = Math.ceil(this.MAX_BLUR) + 4;

    this.snapshotTexture = RenderTexture.create({
      width: this.app.screen.width + pad * 2,
      height: this.app.screen.height + pad * 2,
    });

    const origX = this.mapContainer.x;
    const origY = this.mapContainer.y;
    this.mapContainer.position.set(origX + pad, origY + pad);

    this.app.renderer.render({
      container: this.mapContainer,
      target: this.snapshotTexture,
    });

    this.mapContainer.position.set(origX, origY);

    this.snapshot = new Sprite(this.snapshotTexture);
    this.snapshot.label = "map-transition-snapshot";
    this.snapshot.position.set(-pad, -pad);

    const mapIndex = this.app.stage.getChildIndex(this.mapContainer);
    this.app.stage.addChildAt(this.snapshot, mapIndex + 1);

    this.snapshotBlur = new BlurFilter({ strength: 0, quality: 3 });
    this.snapshot.filters = [this.snapshotBlur];

    // For directional pan, apply a gentler blur-up
    const targetBlur = this.direction ? this.PAN_BLUR : this.MAX_BLUR;

    this.startAnimation(this.BLUR_UP_MS, (t) => {
      if (this.snapshotBlur) {
        this.snapshotBlur.strength = t * targetBlur;
      }
    });
  }

  /**
   * Reveal the new map.
   * Uses directional pan if a direction was set, otherwise crossfade.
   */
  async reveal(): Promise<void> {
    if (!this.transitioning) {
      return;
    }

    const elapsed = performance.now() - this.transitionStartTime;
    const remaining = this.MIN_COVER_MS - elapsed;

    if (remaining > 0) {
      await this.delay(remaining);
    }

    this.cancelAnimations();

    // Capture rest position NOW — after loadMapFromData has reset mapContainer to (0,0)
    this.mapRestX = this.mapContainer.x;
    this.mapRestY = this.mapContainer.y;

    if (
      this.direction &&
      (this.direction.dx !== 0 || this.direction.dy !== 0)
    ) {
      await this.revealWithPan();
    } else {
      await this.revealWithCrossfade();
    }

    this.finishTransition();
  }

  isTransitioning(): boolean {
    return this.transitioning;
  }

  cleanup(): void {
    this.cancelAnimations();
    // Restore mapContainer position if we were mid-pan
    if (this.direction && this.transitioning) {
      this.mapContainer.position.set(0, 0);
    }

    this.removeSnapshot();
    this.removeMapBlur();
    this.transitioning = false;
    this.direction = null;
  }

  destroy(): void {
    this.cleanup();
  }

  // ---------------------------------------------------------------------------
  // Reveal strategies
  // ---------------------------------------------------------------------------

  /**
   * Pan: snapshot slides out in -direction, new map slides in from +direction.
   * Both get a motion blur along the pan axis.
   */
  private async revealWithPan(): Promise<void> {
    const dir = this.direction;

    if (!dir) {
      return;
    }

    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;

    // Total travel distance for the pan
    const panX = dir.dx * screenW;
    const panY = dir.dy * screenH;

    // Snapshot starts at its captured position, slides out by -pan
    const snapStartX = this.snapshot?.x ?? 0;
    const snapStartY = this.snapshot?.y ?? 0;

    // New map starts offset by +pan, slides to rest position
    const mapStartX = this.mapRestX + panX;
    const mapStartY = this.mapRestY + panY;
    this.mapContainer.position.set(mapStartX, mapStartY);

    // Apply motion blur to new map (along pan axis)
    const blurStrengthX = Math.abs(dir.dx) * this.PAN_BLUR;
    const blurStrengthY = Math.abs(dir.dy) * this.PAN_BLUR;
    this.mapBlur = new BlurFilter({
      strengthX: blurStrengthX,
      strengthY: blurStrengthY,
      quality: 3,
    });
    this.mapBlur.padding = this.PAN_BLUR + 4;
    this.mapContainer.filters = [...this.baseFilters, this.mapBlur];

    await this.animateAsync(this.PAN_MS, (t) => {
      // Slide snapshot out
      if (this.snapshot) {
        this.snapshot.x = snapStartX - panX * t;
        this.snapshot.y = snapStartY - panY * t;
        this.snapshot.alpha = 1 - t * 0.5; // Gentle fade
      }

      // Slide new map in
      this.mapContainer.x = mapStartX - panX * t;
      this.mapContainer.y = mapStartY - panY * t;

      // Reduce motion blur as pan completes
      if (this.mapBlur) {
        this.mapBlur.strengthX = blurStrengthX * (1 - t);
        this.mapBlur.strengthY = blurStrengthY * (1 - t);
      }

      // Reduce snapshot blur as it slides out
      if (this.snapshotBlur) {
        this.snapshotBlur.strength = this.PAN_BLUR * (1 - t * 0.3);
      }
    });

    // Ensure final position is exact
    this.mapContainer.position.set(this.mapRestX, this.mapRestY);
  }

  /**
   * Original crossfade: snapshot fades out + mapContainer unblurs.
   */
  private async revealWithCrossfade(): Promise<void> {
    this.mapBlur = new BlurFilter({
      strength: this.MAX_BLUR,
      quality: 3,
    });
    this.mapBlur.padding = this.MAX_BLUR + 4;
    this.mapContainer.filters = [...this.baseFilters, this.mapBlur];

    await this.animateAsync(this.REVEAL_MS, (t) => {
      if (this.mapBlur) {
        this.mapBlur.strength = this.MAX_BLUR * (1 - t);
      }

      if (this.snapshot) {
        this.snapshot.alpha = 1 - t;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private finishTransition(): void {
    this.removeSnapshot();
    this.removeMapBlur();
    this.transitioning = false;
    this.direction = null;
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
      this.mapContainer.filters =
        this.baseFilters.length > 0 ? this.baseFilters : null;
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

  /** Awaitable animation (for reveal crossfade / pan) */
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
