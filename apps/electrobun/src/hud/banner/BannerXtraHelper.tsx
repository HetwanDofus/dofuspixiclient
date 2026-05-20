import { useEffect, useRef, useState } from "react";

import { getBannerViewRenderer } from "@/game/render/banner-view-renderer";

/**
 * "Boune" — the little NPC helper monster from core.swf's `Helper`
 * symbol. Canonical `BannerCircleXtra.showCircleXtra("helper", …)`
 * (Banner.as:160-170) loads either `Helper` or `Helper_TripleFramerate`
 * depending on `Constants.TRIPLEFRAMERATE`; we always pick `Helper`
 * because the runtime framerate is driven JS-side here.
 *
 * The Helper symbol has 1 root frame but its inner sub-clip carries the
 * canonical idle / wave animation. `BannerViewRenderer.animFrameCount`
 * walks past the wrapper and returns the inner cycle length; we tick
 * the frame index at the SWF's authored FPS and re-render through the
 * cache, so each frame's GPU paint is amortized across all subsequent
 * passes through the cycle.
 */
export function BannerXtraHelper() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pixelSize, setPixelSize] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [frame, setFrame] = useState(0);

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

  // Drive the frame ticker at core.swf's authored FPS. The frame count
  // probe runs once `getBannerViewRenderer().subscribeReady` fires
  // (Vello + the BannerViewRenderer's `init()` have both landed). Until
  // then we sit on frame 0.
  useEffect(() => {
    const renderer = getBannerViewRenderer();
    let cancelled = false;
    let intervalId: number | null = null;

    const start = () => {
      if (cancelled) return;
      const frameCount = renderer.animFrameCount("Helper");
      const fps = renderer.bundleFrameRate();
      if (frameCount <= 1) return; // Static — no ticker.
      const periodMs = 1000 / fps;
      intervalId = window.setInterval(() => {
        setFrame((f) => (f + 1) % frameCount);
      }, periodMs);
    };

    const unsubscribeReady = renderer.subscribeReady(start);

    return () => {
      cancelled = true;
      unsubscribeReady();
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (pixelSize <= 0) return;
    const renderer = getBannerViewRenderer();
    let cancelled = false;

    const pull = () => {
      if (cancelled) return;
      const cached = renderer.peekCanvas("Helper", pixelSize, frame);
      if (cached) {
        setCanvas(cached);
        return;
      }
      renderer.getCanvas("Helper", pixelSize, frame).then(() => {
        if (cancelled) return;
        const current = renderer.peekCanvas("Helper", pixelSize, frame);
        if (current) setCanvas(current);
      });
    };

    const unsubscribe = renderer.subscribe("Helper", pixelSize, pull, frame);
    const unsubscribeReady = renderer.subscribeReady(pull);
    pull();

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeReady();
    };
  }, [pixelSize, frame]);

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
      aria-label="Helper (boune)"
    />
  );
}
