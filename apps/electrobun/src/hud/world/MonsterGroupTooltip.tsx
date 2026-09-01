"use client";

import { useSyncExternalStore } from "react";

import { monsterGroupHoverStore } from "@/hud/world/monster-group-hover-store";
import { cn } from "@/lib/utils";

/**
 * World-map monster-group hover panel — port of canonical
 * `dofus.graphics.battlefield.TextWithTitleOverHead`. Three rows:
 *
 *   1. Title  → `LEVEL <totalLevel>` in white bold (`TEXT_FORMAT`).
 *   2. Stars  → 5 glyphs coloured per `getStarsColor()` against the
 *               `STARS_COLORS` table; an empty-bar style (no fills) for
 *               unbonused groups.
 *   3. Body   → roster text: one row per member, `Name (level)`, sorted
 *               by descending level, exactly as `MonsterGroup.getName`
 *               builds it. The row count is how a player counts the
 *               group, so members are never collapsed.
 *
 * Background mirrors `AbstractTextOverHead`: rounded rectangle, black
 * fill at 70% alpha (BACKGROUND_ALPHA = 70).
 *
 * The panel positions itself in canvas-relative space using the
 * coordinates published by BattlefieldPicking's hover handler.
 */

// Canonical 5-star palette from
// `dofus.graphics.battlefield._SafeStr_214.STARS_COLORS`
// (`__Packages/.../battlefield/%1A%0D%0D.as:13`). Index 0 = `-1` (no
// fill, outline only). Each subsequent index escalates the bonus
// tier; the integer values map to packed RGB triples that we render
// as CSS hex.
const STAR_COLORS: Array<string | null> = [
  null, // 0: -1 (no fill, outline only)
  "#FFFFF3", // 1: 16777011 = 0xFFFFF3 (cream)
  "#FF8000", // 2: 16750848 = 0xFF8000 (orange)
  "#009900", // 3:    39168 = 0x009900 (green)
  "#0099CC", // 4:    39372 = 0x0099CC (cyan)
  "#663300", // 5:  6697728 = 0x663300 (brown)
  "#222222", // 6:  2236962 = 0x222222 (dark gray)
  "#FF0000", // 7: 16711680 = 0xFF0000 (red)
  "#00FF00", // 8:    65280 = 0x00FF00 (green-bright)
  "#FFFFFF", // 9: 16777215 = 0xFFFFFF (white)
  "#FF00FF", // 10:16711935 = 0xFF00FF (magenta)
];
const STARS_COUNT = 5;
// Canonical TextWithTitleOverHead-with-stars constants
// (`%1A%0D%0D.as:10-12`). Each star is rendered as a 10×10 px tile
// with a 2 px gap between adjacent slots — so the full row is
// 5*10 + 4*2 = 58 px wide.
const STARS_TILE_WIDTH = 10;
const STARS_TILE_GAP = 2;

/**
 * Canonical `TextWithTitleOverHead.getStarsColor()`:
 *
 *     base = floor(bonus / 100)
 *     extra = (bonus - base*100) <= i*(100/STARS_COUNT) ? 0 : 1
 *     star[i] = STARS_COLORS[min(base + extra, COLORS.length-1)]
 *
 * Returns the hex string per star slot, or `null` for "no fill".
 */
function starColours(bonus: number): Array<string | null> {
  const base = Math.floor(bonus / 100);
  const remainder = bonus - base * 100;
  const out: Array<string | null> = [];
  for (let i = 0; i < STARS_COUNT; i++) {
    const extra = remainder <= i * (100 / STARS_COUNT) ? 0 : 1;
    const idx = Math.min(base + extra, STAR_COLORS.length - 1);
    out.push(STAR_COLORS[idx] ?? null);
  }
  return out;
}

/**
 * Canonical `StarBorder` glyph — pulled verbatim from
 * `assets/cache/extract/ui.loader/StarBorder.svg`, which is the SVG
 * extraction of `cc-loader-fla/LIBRARY/Symbol 1108.xml` (the FLA
 * library item with `linkageIdentifier="StarBorder"` — exactly the
 * symbol the canonical AS attaches via `attachMovie("StarBorder", …)`
 * at `__Packages/.../battlefield/%1A%0D%0D.as:72`).
 *
 * The native SVG is 10×10 px (matches `STARS_TILE_WIDTH = 10`) with
 * two concentric stars: an outer 8.15×8.05 white star (the "fill"
 * tier) and an inner 10×10 white donut (the "border"). When a bonus
 * tier supplies a colour, we recolour the inner fill via SVG paint;
 * when no colour, the inner fill is transparent and the user sees
 * just the white donut outline.
 */
const STAR_BORDER_OUTLINE =
  "M0.2 -4.95L0.4 -4.7L1.7 -2L4.65 -1.6L4.9 -1.4L5 -1.1L5 -1.05L4.85 -0.75L4.9 -0.75L2.8 1.4L3.3 4.4L3.3 4.45L3.25 4.75L3 4.95L2.65 4.95L0.05 3.55L-2.5 4.95L-2.5 5L-2.85 5L-3.15 4.8L-3.2 4.5L-2.75 1.45L-4.85 -0.7L-5 -0.95L-5 -1L-4.9 -1.3L-4.6 -1.5L-1.7 -1.95L-0.4 -4.7L-0.2 -4.95L0.15 -4.95L0.2 -4.95M1 -1.35L0 -3.4L-0.95 -1.3L-1.1 -1.15L-1.3 -1.05L-3.55 -0.7L-1.9 0.95L-1.8 1.15L-1.75 1.35L-2.15 3.7L-0.2 2.6L-0.2 2.55L0.05 2.5L0.25 2.55L2.25 3.65L1.85 1.3L1.85 1.1L2 0.9L3.6 -0.75L1.35 -1.1L1.3 -1.1L1.15 -1.2L1.1 -1.2L1 -1.35";
const STAR_BORDER_INNER_FILL =
  "M3.7 -0.5L4 -0.25L5 1.8L7.2 2.15L7.5 2.35L7.65 2.7L7.5 3L5.9 4.65L6.3 6.95L6.2 7.3L5.9 7.5L5.55 7.5L3.6 6.4L1.65 7.5L1.3 7.55L1 7.35L0.9 7L1.3 4.7L-0.35 3.05L-0.5 2.75L-0.4 2.4L-0.05 2.2L2.1 1.85L2.15 1.85L2.15 1.8L3.1 -0.2L3.35 -0.45L3.7 -0.5";

function Star({ fill }: { fill: string | null }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={`calc(${STARS_TILE_WIDTH}px * var(--resolution-factor, 1))`}
      height={`calc(${STARS_TILE_WIDTH}px * var(--resolution-factor, 1))`}
      viewBox="0 0 10 10"
      role="presentation"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <title>star</title>
      {/* Inner fill — drawn first so the outer outline sits on top. */}
      {fill !== null && (
        <g transform="translate(5 5) translate(-4.05 -3.9) translate(0.5 0.5) translate(-0.5 -0.5) translate(0.5 0.5)">
          <path
            d={STAR_BORDER_INNER_FILL}
            fill={fill}
            fillRule="evenodd"
            stroke="none"
          />
        </g>
      )}
      {/* White outline — outer 5-point star with hollow interior
          (evenodd punches the inner star out of the outer one). */}
      <g transform="translate(5 5) translate(-5 -5) translate(5 5)">
        <path
          d={STAR_BORDER_OUTLINE}
          fill="#FFFFFF"
          fillRule="evenodd"
          stroke="none"
        />
      </g>
    </svg>
  );
}

export function MonsterGroupTooltip() {
  const { group } = useSyncExternalStore(
    monsterGroupHoverStore.subscribe,
    monsterGroupHoverStore.getSnapshot
  );

  if (!group || group.members.length === 0) {
    return null;
  }

  const totalLevel = group.members.reduce((s, m) => s + m.level, 0);

  // Canonical `MonsterGroup.getName` (`dofus/datacenter/MonsterGroup.as:39-59`):
  // ONE row per member, `Name (level)`, sorted by descending level.
  //
  // This used to deduplicate by name and render `Piou Violet (2)` to avoid a
  // wall of identical rows — but that made the panel unreadable in the exact
  // way it is meant to prevent. The parenthesised number is the *level* in
  // 1.29, so `Piou Violet (2)` reads as one level-2 piou, and a group of two
  // violets plus a blue looked like a two-monster group. Counting the rows is
  // how a player counts the group, so a row per member it is.
  const roster = [...group.members].sort((a, b) => b.level - a.level);

  const stars = starColours(group.bonusValue);

  // Canonical TextWithTitleOverHead-with-stars layout (`%1A%0D%0D.as`,
  // class `_SafeStr_214`):
  //
  //   panelWidth  = max(textWidth, titleWidth, starsWidth) + WIDTH_SPACER*2
  //   panelHeight = textHeight + 20 + HEIGHT_SPACER*4 + STARS_TILE_WIDTH
  //
  // with WIDTH_SPACER = HEIGHT_SPACER = 4, STARS_COUNT = 5,
  // STARS_TILE_WIDTH = 10, STARS_TILE_GAP = 2 (all in Flash pixels).
  //
  // Colors come straight from the canonical AS source (no guessing):
  //   - title  : `_loc15_ = dofus.Constants._SafeStr_2694 = 0xFFFFFF` (white)
  //   - body   : `_loc7_  = dofus.Constants._SafeStr_2693 = 0xFFFF99` (cream)
  //              See `__Packages/.../battlefield/%1E%13%16.as:847,1050`
  //              and `__Packages/dofus/%1E%1C%06.as` constants table.
  //              The body color is overridden to the alignment color
  //              ONLY for aligned players; for monster groups it stays
  //              at the cream default.
  //
  // Sizing scales with `--resolution-factor` (the canvas zoom that
  // `Engine.publishResolutionFactor` writes to the document root) so
  // that this DOM tooltip grows in lockstep with the in-canvas
  // sprites — same as the canonical Flash client where the whole
  // stage scales together. Without that factor, the tooltip looks
  // ~40% too small at typical Dofus stage zooms.
  //
  // Vertical order (top → bottom): title, stars, body, all centered.
  // Background is a 70% alpha black rounded rect with corner radius 3
  // (canonical `_SafeStr_794` draws a rounded rect with radius 3).
  const flipLeft = group.side === "left";
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-30",
        // Side flip: anchor the panel right of (x,y) by default;
        // when group.side==="left" anchor it to the left instead so
        // groups near the right edge of the canvas don't clip.
        flipLeft
          ? "translate-x-[calc(-100%-12px*var(--resolution-factor,1))] -translate-y-1/2"
          : "translate-x-[calc(12px*var(--resolution-factor,1))] -translate-y-1/2",
        // Canonical _SafeStr_794 → `drawRoundRect(..., 3, ...)` — 3 px corner.
        "rounded-[calc(3px*var(--resolution-factor,1))]",
        // Canonical AbstractTextOverHead: bg color 0 (#000), alpha 70%.
        "bg-black/70",
        // WIDTH_SPACER = 4 px each side (panel width = max + WIDTH_SPACER*2).
        "px-[calc(4px*var(--resolution-factor,1))]",
        // Canonical TITLE_FORMAT (`__Packages/.../battlefield/%14.as:14`):
        //   `new TextFormat("Verdana", 10, 16777215, true, ...)`
        //
        // Per Adobe AS2 docs, `TextFormat.size` for embedded fonts is
        // in PIXELS at stage scale 1.0 — `10` means 10 visible CSS px
        // at canvas-zoom 1.0. `--resolution-factor` is the canvas
        // zoom from `Engine.publishResolutionFactor`, so multiplying
        // by it scales the panel exactly like the canonical Flash
        // stage scales every UI element together.
        // Use the canonical embedded font (`DofusVerdanaBold.ttf` →
        // family name `DofusVerdana` registered in
        // `apps/electrobun/src/window/mainview/typography.css`) so
        // glyph metrics match Flash 1:1 — system Verdana renders
        // ~30 % wider per-glyph and is what made the panel look off.
        "font-[DofusVerdana,Verdana,sans-serif]",
        // line-height 1.0 keeps single-line title height = font-size,
        // so the AS Y-math (title.y + textHeight + gap = stars.top)
        // works without browser-leading drift. Multi-line body
        // overrides to 1.25 below to recover natural inter-line gap.
        "text-[calc(10px*var(--resolution-factor,1))] font-bold text-center leading-none"
      )}
      style={{
        left: group.x,
        top: group.y,
        // Canonical positions from `%1A%0D%0D.as` (class `_SafeStr_214`),
        // HS = HEIGHT_SPACER = 4, STW = STARS_TILE_WIDTH = 10:
        //
        //   title._y    = -3 + HS + 4     = 5    (textfield TOP)
        //   stars._y    = HS * 4 + tH     = 28   (sprite CENTRE)
        //   body._y     = -3 + HS*2 + 20 + STW = 35   (textfield TOP)
        //   panelHeight = bodyTextHeight + 46
        //
        // Flash textfields have a 3 px upper gutter (the visible
        // glyph appears 3 px below the textfield's `_y`). Sprites
        // (stars) have no gutter. Compensating, the visible layout:
        //
        //   y= 0  ┌── panel top
        //   y= 8  ┌── title visible top    (canonical 5 + 3 gutter)
        //   y=18  └── title bottom         (8 + font-size 10)
        //   y=23  ┌── stars top            (centre 28 − 5)
        //   y=33  └── stars bottom         (centre 28 + 5)
        //   y=38  ┌── body visible top     (canonical 35 + 3 gutter)
        //   y=48  └── body bottom (1 line) (38 + 10)
        //   y=56  └── panel bottom         (canonical bodyH+46 = 10+46)
        //
        // Flex margins from these visible positions:
        //   padding-top      = 8
        //   margin-top stars = 23 − 18 = 5
        //   margin-top body  = 38 − 33 = 5
        //   padding-bottom   = 56 − 48 = 8
        paddingTop: "calc(8px * var(--resolution-factor, 1))",
        paddingBottom: "calc(8px * var(--resolution-factor, 1))",
      }}
    >
      {/* Title — canonical `_loc15_ = 0xFFFFFF` (white) at panel y=5. */}
      <div className="text-white">Niveau {totalLevel}</div>

      {/* Stars row — canonical centre y=28 → top y=23.
          title.bottom (y=18) → stars.top (y=23) ⇒ mt = 5.
          Each star is STARS_TILE_WIDTH=10 wide with STARS_TILE_GAP=2. */}
      <div
        className="flex justify-center"
        style={{
          marginTop: "calc(5px * var(--resolution-factor, 1))",
          gap: `calc(${STARS_TILE_GAP}px * var(--resolution-factor, 1))`,
        }}
      >
        {stars.map((fill, i) => (
          <Star key={i} fill={fill} />
        ))}
      </div>

      {/* Body — canonical `_loc7_ = 0xFFFF99` (cream) at panel y=35
          (textfield top); visible glyph top after Flash's 3 px upper
          gutter = y=38. stars.bottom (y=33) → body.top (y=38) ⇒ mt = 5.
          Multi-monster groups produce N lines; `leading-none` would
          jam them, so override line-height to 1.25 on the list to
          recover Verdana's natural multi-line leading without
          disturbing the panel-level Y-math (which is single-line). */}
      <ul
        className="text-[#FFFF99]"
        style={{
          marginTop: "calc(5px * var(--resolution-factor, 1))",
          lineHeight: "1.25",
        }}
      >
        {roster.map((m, i) => (
          // Members are not individually identified on the wire and two of
          // them can be the same template at the same level, so the index is
          // the only stable key available here.
          <li key={`${m.templateId}-${i}`} className="tabular-nums">
            {m.name} ({m.level})
          </li>
        ))}
      </ul>
    </div>
  );
}
