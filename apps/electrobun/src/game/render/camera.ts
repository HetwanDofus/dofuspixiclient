/**
 * Camera — single source of truth for the battlefield viewport state.
 *
 * Multiple consumers stay in lockstep when zoom, pan, viewport size, or
 * device pixel ratio changes:
 *   - Pixi `Application`: `mapContainer.scale` + position,
 *     `app.renderer.resize` + `resolution`.
 *   - Vello renders: resolution scaling for GPU output textures.
 *   - Wrapper `<div>` CSS dims in the React tree (CanvasStack
 *     stretches to its parent, so this is implicit).
 *
 * Subscribers are notified on every state change with the full
 * snapshot. The Camera does NOT do any rendering itself; it is a
 * coordination primitive only.
 */

export interface CameraState {
  /** Current Pixi-side zoom multiplier applied to `mapContainer.scale`. */
  zoom: number;
  /** Pan in logical pixels (mapContainer.position). */
  panX: number;
  panY: number;
  /** Logical viewport — independent of zoom. */
  logicalWidth: number;
  logicalHeight: number;
  /** Device pixel ratio. Drives Pixi `app.renderer.resolution`. */
  dpr: number;
}

export type CameraListener = (state: CameraState) => void;

export class Camera {
  private state: CameraState;
  private listeners = new Set<CameraListener>();

  constructor(initial: CameraState) {
    this.state = { ...initial };
  }

  setZoom(zoom: number): void {
    if (zoom === this.state.zoom) {
      return;
    }
    this.state = { ...this.state, zoom };
    this.notify();
  }

  setPan(x: number, y: number): void {
    if (x === this.state.panX && y === this.state.panY) {
      return;
    }
    this.state = { ...this.state, panX: x, panY: y };
    this.notify();
  }

  setLogicalSize(w: number, h: number): void {
    if (w === this.state.logicalWidth && h === this.state.logicalHeight) {
      return;
    }
    this.state = { ...this.state, logicalWidth: w, logicalHeight: h };
    this.notify();
  }

  setDpr(dpr: number): void {
    if (dpr === this.state.dpr) {
      return;
    }
    this.state = { ...this.state, dpr };
    this.notify();
  }

  /**
   * Atomic batch: apply multiple field changes in one notification.
   * Use when several fields change together (e.g. resize event also
   * shifts pan to keep the focus point centred).
   */
  update(partial: Partial<CameraState>): void {
    const next: CameraState = { ...this.state, ...partial };
    if (
      next.zoom === this.state.zoom &&
      next.panX === this.state.panX &&
      next.panY === this.state.panY &&
      next.logicalWidth === this.state.logicalWidth &&
      next.logicalHeight === this.state.logicalHeight &&
      next.dpr === this.state.dpr
    ) {
      return;
    }
    this.state = next;
    this.notify();
  }

  getState(): Readonly<CameraState> {
    return this.state;
  }

  /**
   * Subscribe to state changes. Fires immediately with the current
   * state so subscribers can sync without waiting for the next change.
   * Returns an unsubscribe function.
   */
  subscribe(fn: CameraListener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn(this.state);
    }
  }
}

/**
 * Wire the standard `matchMedia` DPR-change listener that fires when the
 * window crosses devices (retina ↔ non-retina). Returns a cleanup fn.
 */
export function bindDprAutoUpdate(camera: Camera): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  let mql = window.matchMedia(
    `(resolution: ${window.devicePixelRatio}dppx)`,
  );
  const handler = () => {
    camera.setDpr(window.devicePixelRatio);
    // matchMedia queries are pinned to the value at construction; we
    // need a fresh query targeting the new DPR so the next change
    // also fires.
    mql.removeEventListener("change", handler);
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener("change", handler);
  };
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
