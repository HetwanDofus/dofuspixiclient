import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";

import { PlayerTeam } from "@/game/fight/types";

const PLACEHOLDER_BODY_COLOR_RED = 0xff4444;
const PLACEHOLDER_BODY_COLOR_BLUE = 0x4444ff;
const DIRECTION_ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * Under-foot team ring drawn below every fighter sprite during combat.
 * Dimensions mirror the original circle.swf / circle_0.svg extracted
 * from the 1.29 client (37.1×18.9, centered on the sprite's feet).
 * Colors come straight from dofus.Constants.TEAMS_COLOR
 *   = [16711680, 255] → [0xFF0000, 0x0000FF]
 * so team 0 reads red, team 1 reads blue regardless of whose
 * perspective is viewing — matches the original's absolute coloring.
 */
const FIGHTER_CIRCLE_NATURAL_WIDTH = 37.1;
const FIGHTER_CIRCLE_NATURAL_HEIGHT = 18.9;

// Inline copy of `assets/rasters/sprites/svg/0/circle_0.svg`, with the
// fills swapped from `#000` to `#fff` so Pixi's `Sprite.tint`
// multiply-blends to the team color (multiplying any source color by
// the tint, so a black source can never become red). The structure is
// the original two-path donut: the first path is the ring outline
// (full alpha) and the second is the translucent inner fill (~10%).
//
// The 1.29 client loads `circle.swf` here; the SVG is a faithful
// vector trace of that asset (same 37.1×18.9 bounds, same evenodd
// donut + low-alpha inner fill), produced by our asset pipeline.
const FIGHTER_CIRCLE_SVG_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="37.1" height="18.9" viewBox="0 0 37.1 18.9"><use xlink:href="#a" width="37.1" height="18.9"/><defs><g id="a" fill="#fff" fill-rule="evenodd" stroke="none"><path d="M34.4 9.05q-.05-3.35-4.65-5.7Q25.1.95 18.5.95T7.3 3.35Q2.65 5.7 2.65 9.05t4.65 5.7q4.6 2.35 11.2 2.4 6.6-.05 11.25-2.4 4.6-2.35 4.65-5.7m-2.75 7.1q-5.4 2.75-13.1 2.75t-13.1-2.75Q0 13.35 0 9.45T5.45 2.8Q10.85 0 18.55 0t13.1 2.8q5.45 2.75 5.45 6.65t-5.45 6.7"/><path fill-opacity=".098" d="M34.4 9.05q-.05 3.35-4.65 5.7-4.65 2.35-11.25 2.4-6.6-.05-11.2-2.4-4.65-2.35-4.65-5.7t4.65-5.7Q11.9.95 18.5.95t11.25 2.4q4.6 2.35 4.65 5.7"/></g></defs></svg>`
  );

let circleTexturePromise: Promise<Texture> | null = null;
let circleTexture: Texture | null = null;

/**
 * Lazily load the team-color circle texture once per app lifetime.
 * Pixi's `Assets.load` rasterises the SVG at its natural size; we
 * scale the resulting `Sprite` per-fighter and tint it instead of
 * baking each color variant.
 */
export function preloadFighterCircleTexture(): Promise<Texture> {
  if (circleTexture) {
    return Promise.resolve(circleTexture);
  }
  if (!circleTexturePromise) {
    circleTexturePromise = Assets.load<Texture>({
      src: FIGHTER_CIRCLE_SVG_DATA_URL,
      data: { resolution: 4 },
    }).then((tex) => {
      circleTexture = tex;
      return tex;
    });
  }
  return circleTexturePromise;
}

/**
 * Build the under-foot team ring as a Sprite. Returns the sprite
 * directly (not a Container) so existing call-sites that swap-and-set-
 * tint stay simple. Pre-resolves to a fully-loaded texture if the
 * preload has already completed; otherwise the sprite fades in once
 * the lazy load resolves.
 *
 * Mirrors `addSpriteExtraClip(..., CIRCLE_FILE, TEAMS_COLOR[Team])`
 * in GameIn.as:1298 — the original loads the same circle.swf with a
 * color transform per team.
 */
export function createFighterGroundCircle(team: number): Sprite {
  const sprite = new Sprite(circleTexture ?? Texture.EMPTY);
  sprite.label = "fighter-ground-circle";
  sprite.anchor.set(0.5, 0.5);
  applyFighterCircleTeam(sprite, team);
  // Pin the on-screen footprint to the canonical 37.1×18.9 ellipse
  // regardless of whatever the SVG rasterised to — Pixi may pick a
  // higher pixel size to satisfy the resolution hint.
  sprite.width = FIGHTER_CIRCLE_NATURAL_WIDTH;
  sprite.height = FIGHTER_CIRCLE_NATURAL_HEIGHT;
  if (!circleTexture) {
    void preloadFighterCircleTexture().then((tex) => {
      if (sprite.destroyed) {
        return;
      }
      sprite.texture = tex;
      sprite.width = FIGHTER_CIRCLE_NATURAL_WIDTH;
      sprite.height = FIGHTER_CIRCLE_NATURAL_HEIGHT;
    });
  }
  return sprite;
}

/**
 * Re-tint an existing fighter circle sprite. Cheap — just sets the
 * tint property; no texture reload, no graphics re-issue.
 */
export function applyFighterCircleTeam(sprite: Sprite, team: number): void {
  sprite.tint = team === PlayerTeam.RED ? 0xff0000 : 0x0000ff;
  // The SVG already encodes the canonical inner-fill alpha (~10%) and
  // the full-alpha ring; we only nudge the overall opacity to match
  // the legacy Graphics path's blend (alpha 1.0 reads identically to
  // the original, so we leave it at 1.0 here).
  sprite.alpha = 1;
}

/**
 * Legacy entry point — kept for backwards compat with anything that
 * still calls into the old Graphics-based path. New code should use
 * `createFighterGroundCircle`. Implemented as a no-op clear so
 * callers that pass a Graphics still get a defined, empty graphic.
 *
 * @deprecated Use `createFighterGroundCircle` instead.
 */
export function drawFighterGroundCircle(
  graphics: Graphics,
  _team: number
): void {
  graphics.clear();
}

/**
 * Stand-in sprite shown while the real character atlas loads.
 * Colored by team with a direction indicator that prevents UI "blank" flicker.
 */
export function drawPlayerPlaceholder(
  graphics: Graphics,
  team: number,
  direction: number
): void {
  graphics.clear();

  const color =
    team === PlayerTeam.RED
      ? PLACEHOLDER_BODY_COLOR_RED
      : PLACEHOLDER_BODY_COLOR_BLUE;

  graphics.circle(0, -10, 12);
  graphics.fill({ color, alpha: 0.8 });
  graphics.stroke({ color: 0x000000, width: 2 });

  graphics.circle(0, -25, 8);
  graphics.fill({ color, alpha: 0.9 });
  graphics.stroke({ color: 0x000000, width: 2 });

  const angle = (DIRECTION_ANGLES_DEG[direction] * Math.PI) / 180;
  const indicatorX = Math.cos(angle) * 15;
  const indicatorY = Math.sin(angle) * 8 - 10;

  graphics.circle(indicatorX, indicatorY, 4);
  graphics.fill({ color: 0xffff00 });
}

// Canonical Dofus 1.29 HealthBarOverHead (HealthBarOverHead.as +
// SpriteHealthBar.as + cc-loader-fla LIBRARY/Symbol 321). The panel
// shown over a hovered fighter has THREE pieces stacked vertically:
//
//   ┌─────────────────────────┐
//   │  PlayerName (Verdana    │  ← _txtSpriteName (Bold 10, white)
//   │              Bold 10)   │
//   ├─────────────────────────┤
//   │  ▓▓▓▓▓░░░░░░░  HP       │  ← SpriteHealthBar:
//   └─────────────────────────┘     - background (dark red)
//                                   - bar fill (red gradient)
//                                   - border (red 1px)
//                                   - _txtValue centered (Verdana
//                                     Bold 10, white) showing LP int
//
//   wrapped in a black rounded-rect at 70% alpha
//   (AbstractTextOverHead.drawBackground BACKGROUND_COLOR=0,
//    BACKGROUND_ALPHA=70). Sized as
//      width  = max(textWidth, nBarWidth=100) + WIDTH_SPACER*3=12
//      height = 32 + HEIGHT_SPACER*2=8 → 40
//
// Constants pulled DIRECTLY from canonical AS source plus the FLA
// shape geometry in `cc-loader-fla/LIBRARY/Symbol {316,317,318,320,321}`:
//
//   HealthBarOverHead.as:17  createTextField("_txtSpriteName",  40,
//                              0, -2 + HEIGHT_SPACER, 0, 0)
//                              → name TextField top _y = 2
//   HealthBarOverHead.as:31  panelHeight = ceil(32 + HEIGHT_SPACER*2)
//                              = 40
//   HealthBarOverHead.as:32  panelWidth  = ceil(max(textWidth,
//                              barWidth) + WIDTH_SPACER*3) → max + 12
//   HealthBarOverHead.as:34  attachMovie("SpriteHealthBar", _y =
//                              16 + HEIGHT_SPACER) → bar _y = 20
//   %14.as:14                TITLE_FORMAT = TextFormat("Verdana", 10,
//                              0xFFFFFF, /*bold*/ true, …, "center")
//   %14.as:9                 BACKGROUND_ALPHA = 70 (= 0.70 in Pixi)
//   %14.as:17                HEIGHT_SPACER = 4
//   %14.as:16                WIDTH_SPACER  = 4
//   %14.as:35-37             drawRoundRect(w, h, color, radius=3,
//                              alpha=BACKGROUND_ALPHA)
//
// SpriteHealthBar visible-bar geometry derived from the FLA shapes:
//
//   Symbol 317 (_mcBar fill)   shape edges (twips, 1px = 20twips):
//       x = [0, 2000]  → 100 px wide
//       y = [-325, 325] → centred on 0, ±16.25 px tall
//                          (32.5 px total content height)
//   Symbol 320 (_mcBorder)     same bounds (rectangular stroke)
//   Symbol 321 (SpriteHealthBar) places each child with matrix:
//       a ≈ 1.0, d = 0.4615, tx = 0, ty = 7.5
//   → after matrix: child y_local = c × 0.4615 + 7.5
//       top:    -16.25 × 0.4615 + 7.5 ≈   0.00
//       bottom: +16.25 × 0.4615 + 7.5 ≈ +15.00
//   ⇒ visible bar height in Symbol 321's local space = 15 px.
//
//   Placed at HealthBarOverHead AS _y = 20 → visible bar in panel:
//       top    = 20
//       bottom = 35
//       gives 5 px bottom padding before panel bottom at y = 40.
//
// Why NAME_Y = 4 instead of literal AS 2:
//   Flash TextField rendering reserves a 2 px gutter at the top of
//   the field bounding box before the first glyph. Canonical AS sets
//   the field _y = -2 + HEIGHT_SPACER = 2, which means the visible
//   glyph top lands on panel y = 4 (= HEIGHT_SPACER). Pixi `Text`
//   has no such gutter, so we set y = 4 directly and the rendered
//   glyph top lands on the same canonical row.
//
// Visible Y layout in our Pixi render (matches canonical):
//   y= 0  panel top
//   y= 4  name visible top         ← canonical 4 px top pad
//   y=14  name visible bottom      ← font-size 10 + lineHeight 10
//   y=20  bar visible top          ← canonical AS literal
//   y=35  bar visible bottom       ← 20 + 15
//   y=40  panel bottom             ← 5 px bottom pad
const PANEL_HEIGHT = 40; // canonical fixed total height (32 + HEIGHT_SPACER*2)
const HP_BAR_WIDTH = 100; // canonical SpriteHealthBar nBarWidth
const HP_BAR_HEIGHT = 15; // canonical Symbol 321 visible bar = 32.5 × 0.4615 ≈ 15
const HP_BAR_BG_COLOR = 0x750202;
const HP_BAR_FILL_BOTTOM = 0xcc0000;
const HP_BAR_FILL_TOP = 0xff3300;
const HP_BAR_BORDER_COLOR = 0xcc0000;
const PANEL_BG_COLOR = 0x000000;
const PANEL_BG_ALPHA = 0.7;
const WIDTH_SPACER = 4; // canonical AbstractTextOverHead WIDTH_SPACER
const HEIGHT_SPACER = 4; // canonical AbstractTextOverHead HEIGHT_SPACER
const NAME_Y = HEIGHT_SPACER; // canonical visible glyph top (AS y=2 + Flash 2 px gutter)
const BAR_Y = 20; // canonical AS literal: 16 + HEIGHT_SPACER
const PANEL_CORNER_RADIUS = 3; // canonical _SafeStr_794 drawRoundRect radius
const HP_BAR_Y_OFFSET = -90; // panel attached this many px above sprite feet
// Initial Pixi Text rasterisation resolution; matches the
// PlayerNameplate default. PlayerRenderer.onResize swaps in the live
// zoom factor after the first resize fires.
const INITIAL_TEXT_RESOLUTION = 4;

/**
 * Stateful overhead panel for one fighter: black rounded background,
 * Verdana Bold name on top, canonical-style HP bar with the LP value
 * rendered on it. Mirrors the canonical AS:
 *   HealthBarOverHead (panel + name)
 *   SpriteHealthBar    (bar + LP text)
 */
export class FighterOverheadPanel {
  readonly container: Container;
  private readonly background: Graphics;
  private readonly nameText: Text;
  private readonly bar: Graphics;
  private readonly lpText: Text;
  private currentName = "";
  private currentHp = 0;
  private currentMaxHp = 0;

  constructor(name: string) {
    this.container = new Container();
    this.container.label = "fighter-overhead";
    this.container.y = HP_BAR_Y_OFFSET;

    this.background = new Graphics();
    this.container.addChild(this.background);

    // Verdana Bold 10 white — exactly AbstractTextOverHead.TEXT_FORMAT
    // (Verdana, 10, 16777215, true=bold, false, false, ..., "center").
    // resolution=2 supersamples the text to compensate for the
    // mapContainer's zoom scale (typically 1-2x); without it Pixi
    // rasterises at 1× and the text blurs when the map is zoomed.
    this.nameText = new Text({
      text: "",
      style: new TextStyle({
        // Canonical TITLE_FORMAT: `new TextFormat("Verdana", 10, ...)`
        // with `embedFonts = true`. The embedded "Verdana" face IS
        // the `DofusVerdana` font we ship at
        // `apps/electrobun/public/assets/fonts/DofusVerdanaBold.ttf`
        // (registered as `DofusVerdana` via `typography.css`). Use
        // it directly so we render with the canonical glyph metrics
        // — no system-Verdana approximation, no size compensation.
        fontFamily: "DofusVerdana",
        fontSize: 10,
        fontWeight: "bold",
        fill: 0xffffff,
        align: "center",
      }),
    });
    // Default render resolution before any onResize fires; matches the
    // PlayerNameplate baseline. PlayerRenderer.onResize will swap in
    // ceil(zoom) for the live mapContainer scale right after.
    this.nameText.resolution = INITIAL_TEXT_RESOLUTION;
    // Anchor at horizontal center, vertical top; canonical drawClip
    // sets `_txtSpriteName.autoSize = "center"` which centers the
    // text around its registration point on the X axis.
    this.nameText.anchor.set(0.5, 0);
    this.container.addChild(this.nameText);

    this.bar = new Graphics();
    this.container.addChild(this.bar);

    // SpriteHealthBar.initTextField (`__Packages/.../SpriteHealthBar.as:74`):
    //   `new TextFormat("Font2", 10, 16777215, false, false, false, ..., "center")`
    // "Font2" in canonical Dofus 1.29 IS Verdana Bold — Flash treats
    // Font2 itself as the bold variant (see DofusStylePackage.as +
    // `apps/electrobun/src/hud/fight/TurnChangeBanner.tsx:132-135` for
    // the same mapping used for in-fight banner labels). Our embedded
    // `DofusVerdana` family wraps `DofusVerdanaBold.ttf`, which is
    // exactly the font the SWF library calls "Font2".
    //
    // The size-10 literal in the AS TextFormat is in *points*; with
    // Flash's stage-px = pt mapping (one twip per twip on a 100 %
    // SWF), that renders at 10 px glyph height. We render the same
    // 10 px in Pixi.
    this.lpText = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "DofusVerdana",
        fontSize: 10,
        fill: 0xffffff,
        align: "center",
      }),
    });
    this.lpText.resolution = INITIAL_TEXT_RESOLUTION;
    this.lpText.anchor.set(0.5, 0.5);
    this.container.addChild(this.lpText);

    this.setName(name);
    this.setHp(1, 1);
  }

  setName(name: string): void {
    if (name === this.currentName) {
      return;
    }
    this.currentName = name;
    this.nameText.text = name;
    this.layout();
  }

  setHp(hp: number, maxHp: number): void {
    this.currentHp = Math.max(0, hp);
    this.currentMaxHp = Math.max(1, maxHp);
    this.lpText.text = String(Math.round(this.currentHp));
    this.drawBar();
    this.layout();
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /**
   * Match the parent map container's render resolution so the text
   * stays crisp at any zoom level. Called from PlayerRenderer.onResize
   * which already pipes the zoom factor in for nameplates.
   */
  setResolution(resolution: number): void {
    this.nameText.resolution = resolution;
    this.lpText.resolution = resolution;
  }

  private drawBar(): void {
    this.bar.clear();
    const ratio = Math.max(0, Math.min(1, this.currentHp / this.currentMaxHp));

    // Background — full bar in dark red.
    this.bar.rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT);
    this.bar.fill({ color: HP_BAR_BG_COLOR });

    // Fill — top half lighter red (Symbol 317 layer 2), bottom half
    // full red (layer 1). Width proportional to current/max HP.
    const fillW = HP_BAR_WIDTH * ratio;
    if (fillW > 0) {
      const halfH = HP_BAR_HEIGHT / 2;
      this.bar.rect(-HP_BAR_WIDTH / 2, 0, fillW, halfH);
      this.bar.fill({ color: HP_BAR_FILL_TOP });
      this.bar.rect(-HP_BAR_WIDTH / 2, halfH, fillW, HP_BAR_HEIGHT - halfH);
      this.bar.fill({ color: HP_BAR_FILL_BOTTOM });
    }

    // Border — single 1px stroke (Symbol 320 — weight 0.05 native ≈ 1px on screen).
    this.bar.rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT);
    this.bar.stroke({ color: HP_BAR_BORDER_COLOR, width: 1 });
  }

  private layout(): void {
    // Canonical layout: panel height is ALWAYS 40 (independent of
    // text height); width = max(textWidth, barWidth) + WIDTH_SPACER*3.
    const nameW = Math.ceil(this.nameText.width);
    const innerW = Math.max(nameW, HP_BAR_WIDTH);
    const panelW = innerW + WIDTH_SPACER * 3;
    const panelH = PANEL_HEIGHT;

    // Background — rounded rect, centered horizontally (anchor is
    // (0,0) so we offset by -panelW/2). Canonical 70% alpha + radius 3.
    this.background.clear();
    this.background.roundRect(
      -panelW / 2,
      0,
      panelW,
      panelH,
      PANEL_CORNER_RADIUS
    );
    this.background.fill({ color: PANEL_BG_COLOR, alpha: PANEL_BG_ALPHA });

    // Name centered horizontally at canonical y = -2 + HEIGHT_SPACER (= 2).
    this.nameText.x = 0;
    this.nameText.y = NAME_Y;

    // Bar centered horizontally at canonical y = 16 + HEIGHT_SPACER (= 20).
    this.bar.y = BAR_Y;

    // LP value text centered ON the bar.
    this.lpText.x = 0;
    this.lpText.y = BAR_Y + HP_BAR_HEIGHT / 2;
  }

  destroy(): void {
    if (!this.container.destroyed) {
      this.container.destroy({ children: true });
    }
  }
}

export const HP_BAR_OFFSETS = {
  y: HP_BAR_Y_OFFSET,
  width: HP_BAR_WIDTH,
  height: HP_BAR_HEIGHT,
} as const;
