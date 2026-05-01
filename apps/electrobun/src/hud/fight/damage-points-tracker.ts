/**
 * Per-tick anchor writer for in-flight damage points.
 *
 * Each `<DamagePoint>` registers its DOM node with this tracker on
 * mount and unregisters on unmount (or on animation end). Per
 * pre-tick, `flush(...)` walks the registered set, projects each
 * point's `cellId` through the camera transform supplied by the
 * caller, and writes `--ax / --ay / --cs` straight onto the DOM
 * via `element.style.setProperty`.
 *
 * No store update, no React reconciliation, no rAF — just three
 * `setProperty` calls per active point per tick. Animation curves
 * live entirely in `points.generated.css`'s @keyframes, so the
 * browser interpolates everything else without our involvement.
 */
export interface PointAnchor {
  /** Canvas-relative pixel x (HudOverlay-local). */
  x: number;
  /** Canvas-relative pixel y. */
  y: number;
  /** Live camera zoom — multiplies font-size + per-frame translate. */
  cs: number;
}

export type AnchorResolver = (cellId: number) => PointAnchor | null;

interface Registration {
  el: HTMLElement;
  cellId: number;
}

export class DamagePointsTracker {
  private readonly nodes = new Map<number, Registration>();

  /** Called by `<DamagePoint>` on mount via callback ref. */
  register(id: number, cellId: number, el: HTMLElement): void {
    this.nodes.set(id, { el, cellId });
  }

  /** Called on unmount or animation end. */
  unregister(id: number): void {
    this.nodes.delete(id);
  }

  /** Number of currently-tracked points. */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Push fresh anchor + camera scale onto every live node. Called
   * from the scene's pre-tick (DamageRenderer wires this in). The
   * resolver projects a cell's world coords through the live
   * mapContainer transform; null skips the node.
   */
  flush(resolve: AnchorResolver): void {
    if (this.nodes.size === 0) return;
    for (const [, reg] of this.nodes) {
      const a = resolve(reg.cellId);
      if (!a) continue;
      // setProperty bypasses React + the style object — three GPU
      // var updates per frame per point. Cheap.
      reg.el.style.setProperty("--ax", `${a.x}px`);
      reg.el.style.setProperty("--ay", `${a.y}px`);
      reg.el.style.setProperty("--cs", String(a.cs));
    }
  }

  /** Tear down all registrations (fight teardown). */
  clear(): void {
    this.nodes.clear();
  }
}

/** Module-level singleton — one tracker per app, attached to the
 *  fight scene's DamageRenderer. The React component imports it
 *  directly to call register/unregister. */
export const damagePointsTracker = new DamagePointsTracker();
