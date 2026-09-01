import { useEffect, useRef, useState } from "react";

import { getFighterPortraitRenderer } from "@/game/render/fighter-portrait-renderer";
import { useFightMode } from "@/hud/fight/useFightMode";

/**
 * Canonical Dofus 1.29 "StringCourse" turn-change banner. Mirrors
 * `dofus.graphics.gapi.ui.StringCourse` (loader-fla Symbol 691).
 *
 * --- The actual visible content's bbox in the extracted SVG ---
 *
 * I rendered `UI_StringCourse_2.svg` with the placeholder boxes
 * coloured-in (Loader → blue, _lblName → green, _lblLevel → pink) and
 * MEASURED the canonical visible content. Inside the SVG canvas
 * (492.6 × 220, with the bundle-extractor's outer translate(120, 25)),
 * the visible parchment + dark name/level bar + orange level marker
 * occupies:
 *
 *     SVG (152.5, 42.85) → (487.85, 178.5)   ⇒ 335.35 × 135.65 px
 *
 * Everything outside that rectangle is transparent (the SVG's outer
 * translate(120, 25) plus Symbol 691's local-coord layout leaves wide
 * empty bands on the left/top). My previous attempts anchored the SVG
 * at (-120, -25), which only cancelled the SVG-export wrap and left
 * ~32 px of empty space between the screen edge and the parchment.
 * That's the placement bug.
 *
 * The fix: anchor the SVG `<img>` at exactly (-152.5, -42.85) of the
 * outer container so SVG canvas (152.5, 42.85) — i.e., the parchment's
 * actual top-left — lines up with outer (0, 0). The outer container
 * then sizes to the visible bbox (335.35 × 135.65), so there is NO
 * dead transparent area between the screen corner and the parchment.
 *
 * --- Element offsets, computed once from canonical data ---
 *
 * To use these offsets directly we shift everything by
 * (-32.5, -17.85), the difference between SVG (152.5, 42.85) and
 * Symbol 691 LOCAL (120, 25). After the shift, content positions in
 * the outer container are:
 *
 *     _ldrStringCourse  SVG (100, 0) → outer (-52.5, -42.85)  220×220
 *                       (mirrored; overflow-clipped to the parchment
 *                        area, matches canonical stage clipping)
 *     _lblName  SVG (271.25, 60)   → outer (118.75, 17.15)   171×20  BLACK
 *     _lblLevel SVG (271.25, 80.5) → outer (118.75, 37.65)    75×20  WHITE
 *
 * --- Layer order (Symbol 691 XFL: Layer 1 on TOP) ---
 *
 *     Layer 1 _lblLevel   (WhiteLeftMediumBoldLabel — Font2 size 11
 *                          color #FFFFFF, labelbold:false)
 *     Layer 2 _lblName    (BlackLeftMediumBoldLabel — Font2 size 11
 *                          color #000000, labelbold:false)
 *     Layer 3 _ldrStringCourse (mirrored fighter artwork)
 *     Layer 4 _mcAnim → Symbol 690 panel + slide-in tween (BOTTOM)
 *
 * --- Animation (Symbol 690 timeline @ 24 fps, ~1.5 s wall-clock) ---
 *
 *     frame 0      stop()                            — hidden
 *     frame 1      Symbol 683 motion-blur slide bar  — slide-IN
 *     frames 2-33  Symbol 687 (parchment + name bar) — held
 *     frame 35     Symbol 683 motion-blur slide bar  — slide-OUT
 *     frame 36     unloadThis
 *
 *   The user-visible "appears from left to right" effect comes from
 *   Symbol 683's pre-rendered motion-blurred bitmap in frame 1; the
 *   frame swap IS the animation (no CSS translation needed). We swap
 *   between three pre-extracted frame SVGs:
 *     1  → blurry slide-in   (~83 ms / 2 frames @ 24fps)
 *     2  → clean panel held  (~1333 ms / 32 frames)
 *     35 → blurry slide-out  (~83 ms / 2 frames)
 */

// --- Canonical Symbol 691 stage-clipped bbox (the version the user
// confirmed "size is perfect, placement is perfect"). ---
//
// LOCAL (0, 0) → (367.85, 195) ⇒ 368 × 195. Outer top corresponds
// to LOCAL y=0; the canonical Loader's "above-parchment" region
// (LOCAL y=-25 to 0) is stage-clipped via overflow:hidden, mirroring
// canonical Flash stage behaviour at gapi (0, 0).
const PANEL_W = 368;
const PANEL_H = 195;

// --- SVG anchoring ---
// SVG export wraps content in `matrix(1, 0, 0, 1, 120, 25)` so
// coords land >= 0. Anchoring the SVG `<img>` at (-120, -25) makes
// LOCAL (X, Y) coincide with outer (X, Y) — identity mapping.
const SVG_W = 492.6;
const SVG_H = 220;
const SVG_OFFSET_X = -120;
const SVG_OFFSET_Y = -25;

// _ldrStringCourse: matrix(-2.2, 0, 0, 2.2, 200, -25). Symbol 691.xml
// confirms `scaleContent=true, centerContent=false`. The canonical
// loader bbox in display LOCAL = (-20, -25) → (200, 195) = 220×220.
//
// Vello returns the path's TIGHT content bounds; canonical Flash
// scales by the artwork SWF's stage rect, which is generally larger
// than (and contains) the tight bbox. Result: a 1:1 220×220 host
// displays the character noticeably smaller and pinned too far right.
//
// Compensation strategy:
//   • Keep canonical HEIGHT (220) so the canvas's height-fit constraint
//     never produces a canvas taller than the loader bbox — this is
//     what caused "too up + clipped on bottom" with a uniform scale.
//   • Widen the host by `LOADER_SCALE_W` so wider-aspect characters
//     (Iop with weapon out, etc.) can stretch leftward past the
//     canonical loader bbox before height-fit kicks in.
//   • Anchor the host's BOTTOM-RIGHT to canonical loader bottom-right
//     (200, 195). The canvas inside is bottom + right anchored, so
//     the visible character's bottom-right edge stays pinned at
//     (200, 195) and width grows leftward.
const LOADER_SCALE_W = 1.15;
const ARTWORK_W = Math.round(220 * LOADER_SCALE_W);
const ARTWORK_H = 220;
const ARTWORK_LEFT = 200 - ARTWORK_W;
const ARTWORK_TOP = 195 - ARTWORK_H;

// _lblName: matrix(1.71, 0, 0, 1, 151.25, 35) → LOCAL (151.25, 35).
// 100×20 base × scale (1.71, 1) = 171×20.
const NAME_LEFT = 151.25;
const NAME_TOP = 35;
const NAME_W = 171;
const NAME_H = 20;

// _lblLevel: matrix(0.7498, 0, 0, 1, 151.25, 55.5) → LOCAL
// (151.25, 55.5). 100×20 × scale (0.7498, 1) = 75×20.
const LEVEL_LEFT = 151.25;
const LEVEL_TOP = 55.5;
const LEVEL_W = 75;
const LEVEL_H = 20;

// Canonical Font2 (Verdana Bold) at `labelsize:11`. The label styles
// in DofusStylePackage.as use `labelfont:"Font2"` with `labelbold:false`
// — Flash treats Font2 itself as the bold variant, so the false flag
// just prevents Flash from double-bolding. In CSS we emulate Font2 by
// applying `font-bold` (700) to a Verdana stack. We multiply by
// --resolution-factor so the typography scales in lockstep with the
// banner geometry.
const LABEL_FONT_SIZE_PX = 11;

const PANEL_BLURRY = "/assets/ui/loader/UI_StringCourse_1.svg";
const PANEL_CLEAN = "/assets/ui/loader/UI_StringCourse_2.svg";
const PANEL_BLURRY_OUT = "/assets/ui/loader/UI_StringCourse_35.svg";

const FRAME_MS = 1000 / 24;
const SLIDE_IN_MS = Math.round(2 * FRAME_MS); // ≈ 83 ms
const HOLD_MS = Math.round(32 * FRAME_MS); // ≈ 1333 ms
const SLIDE_OUT_MS = Math.round(2 * FRAME_MS); // ≈ 83 ms

export function TurnChangeBanner() {
  const fight = useFightMode();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"in" | "hold" | "out" | "idle">("idle");
  const lastTurnRef = useRef<string | null>(null);
  const portraitHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = fight.currentTurnSpriteId;
    if (!next || !fight.isCombat || next === lastTurnRef.current) {
      return;
    }
    lastTurnRef.current = next;
    setActiveId(next);
    setPhase("in");

    const inTimer = setTimeout(() => setPhase("hold"), SLIDE_IN_MS);
    const outTimer = setTimeout(() => setPhase("out"), SLIDE_IN_MS + HOLD_MS);
    const doneTimer = setTimeout(
      () => {
        setPhase("idle");
        setActiveId(null);
      },
      SLIDE_IN_MS + HOLD_MS + SLIDE_OUT_MS
    );

    return () => {
      clearTimeout(inTimer);
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
    };
  }, [fight.currentTurnSpriteId, fight.isCombat]);

  const fighter = activeId ? fight.fighters.get(activeId) : undefined;
  const gfxId = fighter?.gfxId ?? null;
  const c1 = fighter?.color1 ?? -1;
  const c2 = fighter?.color2 ?? -1;
  const c3 = fighter?.color3 ?? -1;
  // Always-mounted artwork host: gating with `phase === "hold"` lost
  // the first attach cycle and left the canvas floating without a
  // parent (manifesting as "image not loaded" for monsters and
  // players). Visibility is opacity-driven so the ref stays stable.
  useEffect(() => {
    if (gfxId === null) {
      return;
    }
    let cancelled = false;
    void getFighterPortraitRenderer()
      .getCanvas(gfxId, ARTWORK_W * 2, [c1, c2, c3])
      .then((canvas) => {
        if (cancelled || !canvas) {
          return;
        }
        const current = portraitHostRef.current;
        if (!current) {
          return;
        }
        canvas.style.maxWidth = "100%";
        canvas.style.maxHeight = "100%";
        canvas.style.objectFit = "contain";
        // _ldrStringCourse mirrors via negative x-scale.
        canvas.style.transform = "scaleX(-1)";
        canvas.style.display = "block";
        current.replaceChildren(canvas);
      });
    return () => {
      cancelled = true;
    };
  }, [gfxId, c1, c2, c3]);

  if (!activeId || phase === "idle" || !fighter) {
    return null;
  }

  // Pick the canonical Symbol 690 frame for this phase.
  const panelSrc =
    phase === "in"
      ? PANEL_BLURRY
      : phase === "out"
        ? PANEL_BLURRY_OUT
        : PANEL_CLEAN;

  // Artwork + labels are visible only during HOLD — canonical
  // `complete()` sets `_lblName.text` / `_lblLevel.text` AFTER the
  // loader fires its complete event.
  const contentOpacity = phase === "hold" ? 1 : 0;

  return (
    <div
      className="pointer-events-none absolute"
      data-turn-banner
      style={{
        // Canonical Game.as:389 attaches Symbol 691 to `_mcLayer_UI` at
        // gapi-local (0, 0). Flush with the canvas top-left corner —
        // the canonical client doesn't inset the StringCourse banner.
        top: 0,
        left: 0,
        width: `calc(${PANEL_W}px * var(--resolution-factor))`,
        height: `calc(${PANEL_H}px * var(--resolution-factor))`,
        // overflow:hidden so the avatar host (canonical Loader at
        // outer (-20, -25) sized 220×220) is clipped to the banner's
        // 0..PANEL_W × 0..PANEL_H bounds. overflow:visible let the
        // avatar render past the banner edges, which the user reported
        // as wrong image placement.
        overflow: "hidden",
        // Above the in-fight Pixi canvas's stacking context.
        zIndex: 1000,
      }}
    >
      {/* Symbol 690 frame as a background-image so the browser scales
          the SVG to the exact CSS box (492.6 × 220 → outer-relative
          extent) without the `<img>` aspect-ratio negotiation that was
          collapsing the parchment to a thin strip. The background is
          anchored at (-152.5 × factor, -42.85 × factor) so SVG canvas
          (152.5, 42.85) — the parchment's actual top-left — lands on
          outer (0, 0). overflow:hidden on the outer crops the rest. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: `calc(${SVG_OFFSET_X}px * var(--resolution-factor))`,
          top: `calc(${SVG_OFFSET_Y}px * var(--resolution-factor))`,
          width: `calc(${SVG_W}px * var(--resolution-factor))`,
          height: `calc(${SVG_H}px * var(--resolution-factor))`,
          backgroundImage: `url(${panelSrc})`,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
        }}
      />

      {/* _ldrStringCourse — fighter artwork (Layer 3). Hosted at the
          canonical Loader bbox LOCAL (-20, -25) sized 220×220. The
          canvas inside is top + right anchored (canonical Flash
          centerContent=false → top-LEFT, then the mirror matrix flips
          it to top-RIGHT in display). overflow:hidden on the outer
          clips the head extending into y<0, matching canonical Flash
          stage clipping at gapi (0, 0). */}
      <div
        ref={portraitHostRef}
        aria-hidden
        style={{
          position: "absolute",
          left: `calc(${ARTWORK_LEFT}px * var(--resolution-factor))`,
          top: `calc(${ARTWORK_TOP}px * var(--resolution-factor))`,
          width: `calc(${ARTWORK_W}px * var(--resolution-factor))`,
          height: `calc(${ARTWORK_H}px * var(--resolution-factor))`,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          opacity: contentOpacity,
          transition: "opacity 50ms linear",
        }}
      />

      {/* _lblName (Layer 2) — BlackLeftMediumBoldLabel: Font2 size 11
          color #000000, labelbold:false. */}
      <span
        className="font-[Verdana,sans-serif] font-bold"
        style={{
          position: "absolute",
          left: `calc(${NAME_LEFT}px * var(--resolution-factor))`,
          top: `calc(${NAME_TOP}px * var(--resolution-factor))`,
          width: `calc(${NAME_W}px * var(--resolution-factor))`,
          height: `calc(${NAME_H}px * var(--resolution-factor))`,
          color: "#000000",
          fontSize: `calc(${LABEL_FONT_SIZE_PX}px * var(--resolution-factor))`,
          lineHeight: `calc(${NAME_H}px * var(--resolution-factor))`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          opacity: contentOpacity,
          transition: "opacity 50ms linear",
        }}
      >
        {fighter.name}
      </span>

      {/* _lblLevel (Layer 1, TOP) — WhiteLeftMediumBoldLabel: Font2
          size 11 color #FFFFFF. Reads against Symbol 686's embedded
          dark band on the level row. */}
      <span
        className="font-[Verdana,sans-serif] font-bold"
        style={{
          position: "absolute",
          left: `calc(${LEVEL_LEFT}px * var(--resolution-factor))`,
          top: `calc(${LEVEL_TOP}px * var(--resolution-factor))`,
          width: `calc(${LEVEL_W}px * var(--resolution-factor))`,
          height: `calc(${LEVEL_H}px * var(--resolution-factor))`,
          color: "#ffffff",
          fontSize: `calc(${LABEL_FONT_SIZE_PX}px * var(--resolution-factor))`,
          lineHeight: `calc(${LEVEL_H}px * var(--resolution-factor))`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          opacity: contentOpacity,
          transition: "opacity 50ms linear",
        }}
      >
        Lvl. {fighter.level}
      </span>
    </div>
  );
}
