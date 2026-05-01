import {
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import "./points.css";
import "./points.generated.css";

import {
  type DamagePoint,
  damagePointsStore,
  removeDamagePoint,
} from "./damage-points-store";
import { damagePointsTracker } from "./damage-points-tracker";

/**
 * Floating damage / AP / MP / heal layer.
 *
 * The visible animation lives entirely in CSS — see
 * `points.css` (static layout + @property declarations) and
 * `points.generated.css` (per-clip @keyframes built from the SWF
 * manifests). This component is just a mount/unmount harness: each
 * point becomes a `<div>` with a className that selects the right
 * @keyframe trio plus per-instance CSS variables (--ax, --ay, --cs)
 * that the DamagePointsTracker keeps in sync with the camera.
 *
 * Font properties are NOT declared inside `points.css`; this
 * component sets them once on the layer wrapper so callers can
 * theme without touching the asset pipeline. The base font-size
 * cascades down through CSS inheritance, and the per-point rule
 * multiplies it by `var(--cs)` via `calc(1em * var(--cs))` so glyph
 * rasterisation happens at canvas-pixel size — crisp at any zoom,
 * no bilinear scaling blur.
 */

const LAYER_FONT: CSSProperties = {
  // Cascades to every `.dofus-point` inside; they re-declare
  // font-size via `calc(1em * var(--cs))` so this is the BASE the
  // camera scale multiplies. Family + weight inherit unchanged.
  fontFamily: '"DofusVerdana", Verdana, sans-serif',
  fontWeight: "bold",
  fontSize: "18px",
};

interface DamagePointViewProps {
  point: DamagePoint;
}

const DamagePointView = memo(function DamagePointView({
  point,
}: DamagePointViewProps) {
  const finishFiredRef = useRef(false);

  // Callback ref: register the DOM node with the tracker on mount,
  // unregister on unmount. The tracker writes --ax / --ay / --cs
  // every pre-tick; React isn't involved.
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) {
        damagePointsTracker.register(point.id, point.cellId, el);
      } else {
        damagePointsTracker.unregister(point.id);
      }
    },
    [point.id, point.cellId]
  );

  // Mid-animation `onAnimateFinished` — fired once at the SWF's
  // canonical finish frame so the next queued point on the same
  // cell can start while the tail of this one is still fading.
  // Implemented as a setTimeout because CSS doesn't expose a
  // mid-keyframe event hook.
  useEffect(() => {
    if (point.finishFrame <= 0 || point.fps <= 0) return;
    const finishMs = ((point.finishFrame - 1) / point.fps) * 1000;
    const timer = window.setTimeout(() => {
      if (!finishFiredRef.current) {
        finishFiredRef.current = true;
        point.onFinishFrame();
      }
    }, Math.max(0, finishMs));
    return () => window.clearTimeout(timer);
  }, [point]);

  // The wrapper hosts the curve animation; spans inherit @property
  // vars and run their own colour animations (or static colours
  // for identity-cxform clips). When the wrapper's curve animation
  // ends, fire onComplete and remove the entry from the store —
  // React then unmounts and the tracker drops the node.
  const onAnimationEnd = useCallback(
    (e: ReactAnimationEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (!finishFiredRef.current) {
        finishFiredRef.current = true;
        point.onFinishFrame();
      }
      point.onComplete();
      removeDamagePoint(point.id);
    },
    [point]
  );

  return (
    <div
      ref={setRef}
      className={`dofus-point dofus-point--${point.styleIdx}-${point.typeIdx}`}
      onAnimationEnd={onAnimationEnd}
    >
      <span className="dofus-point__shadow">{point.text}</span>
      <span className="dofus-point__bright">{point.text}</span>
    </div>
  );
});

export function DamagePoints() {
  const { points } = useSyncExternalStore(
    damagePointsStore.subscribe,
    damagePointsStore.getSnapshot
  );

  if (points.length === 0) {
    return null;
  }

  return (
    <div className="dofus-points-layer" style={LAYER_FONT}>
      {points.map((p) => (
        <DamagePointView key={p.id} point={p} />
      ))}
    </div>
  );
}
