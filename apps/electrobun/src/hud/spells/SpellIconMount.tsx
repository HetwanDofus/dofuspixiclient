import { useEffect, useRef, useState } from "react";

import { getSpellIconRenderer } from "@/game/render/spell-icon-renderer";

interface SpellIconMountProps {
  spellId: number;
  label: string;
}

/**
 * Mounts a live HTMLCanvasElement of a spell's icon, filling its host.
 * The host is `position: absolute; inset: 0`, so give it a positioned
 * parent sized to the slot you want.
 *
 * A ResizeObserver reads the host's size and asks SpellIconRenderer for
 * a canvas whose natural dimensions are exactly `pixelSize × pixelSize`
 * — no CSS scaling, no blur, regardless of `--resolution-factor`.
 *
 * The global `.map-renderer canvas { image-rendering: pixelated }` rule
 * (MapRenderer.tsx) would otherwise cascade in and snap this to
 * nearest-neighbour. Override to `auto` — the canvas IS pixel-perfect so
 * default smooth rendering is fine, and if a stray subpixel scale shows
 * up we'd rather smooth-sample than hard-crunch.
 */
export function SpellIconMount({ spellId, label }: SpellIconMountProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pixelSize, setPixelSize] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // Measure the slot (via the host div it contains) and republish as
  // integer pixels. Integer so cache keys don't thrash on sub-pixel layout
  // noise, and a 1 px off-axis rect doesn't invalidate the cache.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const ro = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      const size = Math.max(0, Math.round(Math.max(rect.width, rect.height)));
      setPixelSize(size);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // Pull the canvas for the current (spellId, pixelSize). `pull` re-peeks
  // from the renderer cache after each await so an out-of-order promise
  // resolution (e.g., from a prior pixelSize) can't clobber newer state.
  useEffect(() => {
    if (pixelSize <= 0) {
      return;
    }
    const renderer = getSpellIconRenderer();
    let cancelled = false;

    const pull = () => {
      if (cancelled) {
        return;
      }
      const cached = renderer.peekCanvas(spellId, pixelSize);
      if (cached) {
        setCanvas(cached);
        return;
      }
      renderer.getCanvas(spellId, pixelSize).then(() => {
        if (cancelled) {
          return;
        }
        const current = renderer.peekCanvas(spellId, pixelSize);
        if (current) {
          setCanvas(current);
        }
      });
    };

    const unsubscribe = renderer.subscribe(spellId, pixelSize, pull);
    // HUD mounts before battlefield bootstrap wires Vello/Pixi; retry
    // once the renderer latches.
    const unsubscribeReady = renderer.subscribeReady(pull);
    pull();

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeReady();
    };
  }, [spellId, pixelSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canvas) {
      return;
    }
    // Canvas intrinsic size = `Math.round(slot)` (integer pixels), slot CSS
    // size may be fractional (e.g. 48.72 px at resolution-factor 1.9488).
    // `width/height: 100%` pins the canvas's CSS box to the slot exactly,
    // leaving only a sub-pixel downscale (imperceptible + smooth-filtered).
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // Contain + center keeps the icon aligned in the slot even if Vello's
    // tight-bounds output isn't perfectly square.
    canvas.style.objectFit = "contain";
    canvas.style.objectPosition = "center";
    canvas.style.pointerEvents = "none";
    canvas.style.imageRendering = "auto";
    canvas.setAttribute("aria-label", label);
    canvas.setAttribute("role", "img");
    host.replaceChildren(canvas);
    return () => {
      if (host.contains(canvas)) {
        host.removeChild(canvas);
      }
    };
  }, [canvas, label]);

  return <div ref={hostRef} className="absolute inset-0 pointer-events-none" />;
}
