import { useEffect, useRef, useState } from "react";

import { getFighterPortraitRenderer } from "@/game/render/fighter-portrait-renderer";

interface CharacterPortraitProps {
  /** Breed sprite id — `classId * 10 + sex` in 1.29. */
  gfxId: number;
  /** Colour-zone overrides; -1 keeps the artwork's palette default. */
  colors: readonly [number, number, number];
  /** Physical size to rasterise at, in CSS pixels. */
  pixelSize: number;
  label: string;
}

/** How long to keep re-asking while the renderer is still booting. */
const RETRY_MS = 250;
const MAX_RETRIES = 40;

/**
 * The character's own "big" artwork, filling its host — the same asset
 * the turn-change banner shows, rendered through the same Vello path.
 *
 * Unlike the banner, this can be mounted before the battlefield
 * bootstrap has handed Vello and Pixi to the renderer (the HUD is up as
 * soon as the player is in game, and `c` works immediately). The
 * renderer has no readiness signal of its own, so a bounded retry stands
 * in for one; once a canvas arrives the timer stops.
 */
export function CharacterPortrait({
  gfxId,
  colors,
  pixelSize,
  label,
}: CharacterPortraitProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [c1, c2, c3] = colors;

  useEffect(() => {
    if (gfxId <= 0 || pixelSize <= 0) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pull = (): void => {
      if (cancelled) {
        return;
      }
      void getFighterPortraitRenderer()
        .getCanvas(gfxId, pixelSize, [c1, c2, c3])
        .then((next) => {
          if (cancelled) {
            return;
          }
          if (next) {
            setCanvas(next);
            return;
          }
          attempts += 1;
          if (attempts < MAX_RETRIES) {
            timer = setTimeout(pull, RETRY_MS);
          }
        });
    };
    pull();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [gfxId, pixelSize, c1, c2, c3]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !canvas) {
      return;
    }
    canvas.style.maxWidth = "100%";
    canvas.style.maxHeight = "100%";
    canvas.style.objectFit = "contain";
    canvas.style.display = "block";
    canvas.style.margin = "0 auto";
    canvas.style.pointerEvents = "none";
    // `.map-renderer canvas { image-rendering: pixelated }` would
    // otherwise cascade in; the canvas is already at its natural size.
    canvas.style.imageRendering = "auto";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
    host.replaceChildren(canvas);
    return () => {
      if (host.contains(canvas)) {
        host.removeChild(canvas);
      }
    };
  }, [canvas, label]);

  return (
    <div
      ref={hostRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        overflow: "hidden",
      }}
    />
  );
}
