import { ExternalStore } from "@/game/stores/game-store";

/**
 * One floating damage / AP / MP / heal point in flight. The visual
 * (relief stack, scale curve, cxform fade-in, alpha fade-out) is
 * entirely driven by CSS `@keyframes` generated from the SWF
 * manifest — see `tools/asset-pipeline/src/stages/compile/points-css.ts`
 * → `apps/electrobun/src/hud/fight/points.generated.css`.
 *
 * The store carries only the bits React needs to MOUNT each point
 * and pick the right CSS class:
 *
 *   - `id`            : stable React key + correlation handle.
 *   - `cellId`        : world cell the float is anchored to. Used
 *                       by `DamagePointsTracker` to recompute the
 *                       canvas-relative anchor every pre-tick.
 *   - `text`          : visible glyph stack ("-25", "+3", " -3").
 *   - `styleIdx/typeIdx`: which (style, type) clip — drives the
 *                       className `.dofus-point--<s>-<t>`.
 *
 * No anchor coords, no camera scale, no per-frame curve, no fps —
 * those previously lived here for the rAF interpolator. The
 * interpolator is gone: the browser walks the curve via the
 * compiled CSS keyframes, and the tracker writes anchor + zoom
 * straight to the DOM via `style.setProperty` (no React re-render).
 */
export interface DamagePoint {
  id: number;
  cellId: number;
  text: string;
  styleIdx: number;
  typeIdx: number;
  /**
   * Called when the curve animation finishes and the wrapper's
   * `onAnimationEnd` event fires. Drives queue advance + cleanup.
   */
  onComplete: () => void;
  /**
   * Called once when the curve reaches `onAnimateFinished`'s frame.
   * Mirrors the SWF DoAction at the "finish" frame which signals
   * the next queued clip on the same fighter to start. Triggered
   * from the React component via `setTimeout(... finishMs)`.
   */
  onFinishFrame: () => void;
  /**
   * 0-based frame index of the SWF DoAction that fires
   * `_parent.onAnimateFinished(...)`. The component derives a
   * timeout from `finishFrame / fps` and fires `onFinishFrame`
   * once when that timeout elapses.
   */
  finishFrame: number;
  /** Total frame count — drives the finishMs timeout calculation. */
  totalFrames: number;
  /** SWF playback fps — drives the finishMs timeout calculation. */
  fps: number;
}

interface DamagePointsState {
  points: readonly DamagePoint[];
}

const initial: DamagePointsState = { points: [] };

export const damagePointsStore = new ExternalStore<DamagePointsState>(initial);

export function addDamagePoint(point: DamagePoint): void {
  const { points } = damagePointsStore.getSnapshot();
  damagePointsStore.setState({ points: [...points, point] });
}

export function removeDamagePoint(id: number): void {
  const { points } = damagePointsStore.getSnapshot();
  const next = points.filter((p) => p.id !== id);
  if (next.length !== points.length) {
    damagePointsStore.setState({ points: next });
  }
}

export function clearDamagePoints(): void {
  damagePointsStore.setState({ points: [] });
}
