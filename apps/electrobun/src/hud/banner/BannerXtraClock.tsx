import { useEffect, useRef, useState } from "react";

import {
  type BannerViewExport,
  getBannerViewRenderer,
} from "@/game/render/banner-view-renderer";

/**
 * Visible diagnostic + canonical-AS clock view. Mounts three runtime-
 * rendered canvases from `core.swf`:
 *
 *   - `UI_BannerClockBack`        — static dial face (centered)
 *   - `UI_BannerClockArrowHours`  — hour hand (rotated by CSS transform)
 *   - `UI_BannerClockArrowMinutes` — minute hand (rotated by CSS transform)
 *
 * Mirrors `dofus.graphics.gapi.ui.banner.BannerCircleXtra.showCircleXtra("clock", …)`
 * — back symbol stays put, the two arrow symbols rotate per the host
 * `Clock` controller (canonical: `arrowHours.rotation = hours * 30 +
 * minutes * 0.5`, `arrowMinutes.rotation = minutes * 6`).
 *
 * Used inside `MainBannerCircle` to prove the runtime-SWF pipeline end-
 * to-end without depending on the minimap renderer / Pixi slot
 * machinery. If the clock face appears, `loadSwfBundle("core")` +
 * `renderSwfFrame("core", "UI_BannerClockBack", 0, res)` + the
 * `HudVelloAtlas` blit are all wired correctly.
 */
export function BannerXtraClock() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pixelSize, setPixelSize] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Tick on the wall clock so the hands move (canonical client refreshes
  // every minute; we tick every 5s so the minute hand visibly creeps in
  // a single mounting session).
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  // Track the host's measured pixel size — same pattern as
  // `SpellIconMount`. Integer-rounded so the renderer cache doesn't
  // thrash on sub-pixel layout jitter.
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

  const hoursDeg = (now.getHours() % 12) * 30 + now.getMinutes() * 0.5;
  const minutesDeg = now.getMinutes() * 6 + now.getSeconds() * 0.1;

  return (
    <div ref={hostRef} className="absolute inset-0 pointer-events-none">
      <BannerXtraLayer exportName="UI_BannerClockBack" pixelSize={pixelSize} />
      <BannerXtraLayer
        exportName="UI_BannerClockArrowHours"
        pixelSize={pixelSize}
        rotationDeg={hoursDeg}
      />
      <BannerXtraLayer
        exportName="UI_BannerClockArrowMinutes"
        pixelSize={pixelSize}
        rotationDeg={minutesDeg}
      />
    </div>
  );
}

/**
 * Mounts one core.swf banner export as a 2D canvas. Re-resolves the
 * canvas via the renderer cache whenever (exportName, pixelSize)
 * changes, and re-pulls once the renderer's readiness latch fires
 * (Battlefield bootstrap installs the BannerViewRenderer asynchronously).
 */
function BannerXtraLayer({
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
    // Hand sprites are tall + narrow with the SWF's authored anchor at
    // the dial center. `objectFit: contain` keeps them centered without
    // distortion, and `transformOrigin: center` lets the parent rotate
    // them around the dial pin.
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
