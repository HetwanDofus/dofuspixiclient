import { useLayoutEffect, useRef } from "react";

/**
 * CanvasStack — single `<canvas>` element handed to the Pixi
 * `Application`. After Phases 3-6 of the render migration, every
 * renderable (tiles, chars, mounts, spells, cell tints, overlays)
 * lives in Pixi's scene graph; Vello produces off-screen GPUTextures
 * consumed by Pixi as `ExternalSource` sprites — one canvas, one
 * compositor.
 *
 * Component name kept (rather than renaming to `BattlefieldCanvas`)
 * to minimize churn — there's still exactly one consumer.
 */
export interface CanvasStackProps {
  onMount?: (canvases: { canvas: HTMLCanvasElement }) => void;
}

export function CanvasStack({ onMount }: CanvasStackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    if (mountedRef.current) {
      return;
    }
    if (canvasRef.current) {
      mountedRef.current = true;
      onMount?.({ canvas: canvasRef.current });
    }
  }, [onMount]);

  return (
    <div
      className="canvas-stack"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    >
      <canvas
        ref={canvasRef}
        className="canvas-main"
        style={{
          // Canonical letterbox: the engine sizes the canvas to the
          // 742×556 stage block (Kernel.as:146) x the container fit;
          // centring here puts flat black around it like canonical
          // fullscreen. Pixi's autoDensity overwrites style.width/
          // height per resize but leaves the centring transform alone.
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}
