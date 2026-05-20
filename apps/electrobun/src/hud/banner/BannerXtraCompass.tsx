import { useEffect, useRef, useState } from "react";

import {
  type BannerViewExport,
  getBannerViewRenderer,
} from "@/game/render/banner-view-renderer";

interface BannerXtraCompassProps {
  /** Current map game-coords (x,y). */
  current?: { x: number; y: number };
  /**
   * Target map game-coords (x,y). When unset, the no-arrow art is
   * shown (canonical BannerCircleXtra "compass" mode with no
   * `targetCoords` configured).
   */
  target?: { x: number; y: number } | null;
}

/**
 * "Boussole" / compass banner xtra. Three core.swf symbols mirror the
 * canonical `BannerCircleXtra.showCircleXtra("compass", …)` setup:
 *
 *   - `UI_BannerCompassBack`     — dial / cardinal markings (static)
 *   - `UI_BannerCompassArrow`    — needle, rotated by atan2(dy, dx)
 *   - `UI_BannerCompassNoArrow`  — overlay for the "no target" state
 *
 * Rotation matches `ank.gapi.controls.Compass.as` — `arrow.rotation =
 * atan2(targetY - currentY, targetX - currentX) * 180/PI`. CSS rotation
 * is `transform: rotate(deg)` with origin at the dial center (the
 * SWF's authored anchor sits there for both the arrow and the dial).
 */
export function BannerXtraCompass({
  current = { x: 0, y: 0 },
  target = { x: 2, y: 3 },
}: BannerXtraCompassProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pixelSize, setPixelSize] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      const size = Math.max(0, Math.round(Math.max(rect.width, rect.height)));
      setPixelSize(size);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const hasTarget = target != null;
  // Canonical Compass.as: positive Y is south on the Dofus worldmap, so
  // `atan2(dy, dx)` gives an angle where 0° points east. We offset by
  // -90° so 0° = north (matching the typical compass dial orientation
  // where the north tick sits at the top).
  const arrowDeg = hasTarget
    ? Math.atan2(target.y - current.y, target.x - current.x) * (180 / Math.PI) +
      90
    : 0;

  return (
    <div ref={hostRef} className="absolute inset-0 pointer-events-none">
      <CompassLayer exportName="UI_BannerCompassBack" pixelSize={pixelSize} />
      {hasTarget ? (
        <CompassLayer
          exportName="UI_BannerCompassArrow"
          pixelSize={pixelSize}
          rotationDeg={arrowDeg}
        />
      ) : (
        <CompassLayer
          exportName="UI_BannerCompassNoArrow"
          pixelSize={pixelSize}
        />
      )}
    </div>
  );
}

function CompassLayer({
  exportName,
  pixelSize,
  rotationDeg = 0,
}: {
  exportName: BannerViewExport;
  pixelSize: number;
  rotationDeg?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (pixelSize <= 0) return;
    const renderer = getBannerViewRenderer();
    let cancelled = false;

    const pull = () => {
      if (cancelled) return;
      const cached = renderer.peekCanvas(exportName, pixelSize);
      if (cached) {
        setCanvas(cached);
        return;
      }
      renderer.getCanvas(exportName, pixelSize).then(() => {
        if (cancelled) return;
        const current = renderer.peekCanvas(exportName, pixelSize);
        if (current) setCanvas(current);
      });
    };

    const unsubscribe = renderer.subscribe(exportName, pixelSize, pull);
    const unsubscribeReady = renderer.subscribeReady(pull);
    pull();

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeReady();
    };
  }, [exportName, pixelSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canvas) return;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.objectFit = "contain";
    canvas.style.objectPosition = "center";
    canvas.style.pointerEvents = "none";
    canvas.style.imageRendering = "auto";
    host.replaceChildren(canvas);
    return () => {
      if (host.contains(canvas)) host.removeChild(canvas);
    };
  }, [canvas]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `rotate(${rotationDeg}deg)`,
        transformOrigin: "center center",
      }}
    />
  );
}
