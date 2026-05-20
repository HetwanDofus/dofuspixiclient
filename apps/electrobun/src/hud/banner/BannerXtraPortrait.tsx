import { useEffect, useRef, useState } from "react";

import { getFighterPortraitRenderer } from "@/game/render/fighter-portrait-renderer";

interface BannerXtraPortraitProps {
  /**
   * `clips/artworks/big/<gfxId>.swf` to display. Matches the canonical
   * `dofus.Constants.ARTWORKS_BIG_PATH + gfxFileName + ".swf"` lookup
   * used by `BannerCircleXtra.showCircleXtra("artwork", …)`. The default
   * (`10`) is a low-id Iop male artwork that ships with the source
   * tree — pick the active player's `gfxFileName` from the character
   * store when wiring this in earnest.
   */
  gfxId?: number;
  /**
   * Optional three-zone tint `[c1, c2, c3]` (each `0xRRGGBB`) for the
   * artwork's stringCourseColor zones. Maps to the `Player.color1/2/3`
   * fields the canonical client passes through `setSpriteColors`.
   */
  colors?: readonly [number, number, number] | null;
}

/**
 * Player artwork banner xtra. Reuses `FighterPortraitRenderer`
 * (already wired in the Battlefield bootstrap) — same runtime-SWF +
 * Vello + HudVelloAtlas chain that paints the StringCourse turn-change
 * banner portraits. The artwork SWFs at
 * `assets/sources/clips/artworks/big/<gfxId>.swf` are served at
 * `/swf/artworks/big/<gfxId>.swf` by the dev plugin.
 */
export function BannerXtraPortrait({
  gfxId = 10,
  colors = null,
}: BannerXtraPortraitProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pixelSize, setPixelSize] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

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

  useEffect(() => {
    if (pixelSize <= 0) return;
    let cancelled = false;
    const renderer = getFighterPortraitRenderer();
    renderer.getCanvas(gfxId, pixelSize, colors).then((c) => {
      if (!cancelled && c) setCanvas(c);
    });
    return () => {
      cancelled = true;
    };
  }, [gfxId, pixelSize, colors]);

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
      aria-label="Player artwork"
    />
  );
}
