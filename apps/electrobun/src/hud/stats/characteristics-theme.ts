/**
 * Palette and metrics for the characteristics window, sampled off the
 * reference capture of the retail 1.29 client
 * (`screenshot-ui/carac.png`).
 *
 * The panel measures 386 px wide in that capture, white border
 * included. `Panel` draws that border 3 base units thick and the
 * capture's is 5 px, which puts the capture at **386 / 232 ≈ 1.664** and
 * the window at **232 base units** wide — the same base-unit space every
 * other HUD panel lays out in, scaled by `zoom`. The row pitch falls out
 * of that at 29 px / 1.664 ≈ 17.5, and the section bands at 24 px ≈ 14.5,
 * which is how the numbers below were derived.
 *
 * Height is the one place the capture does not decide on its own: it is
 * cropped just below "Capital", and the panel has to fit the strip above
 * the banner. That strip measures ~415 base units in the running client
 * (`HudOverlay`'s wrapper divided by `baseZoom` — *not* `DISPLAY_HEIGHT`,
 * which is a different 432-unit space), so the window is 410. That
 * budget is what tightens the identity rows and the job slots below the
 * roomier proportions retail gives them; the row pitch itself stays at
 * the measured value.
 */

export const CHARACTERISTICS_COLORS = {
  /** Panel body — the lighter of the two alternating row colours. */
  body: "#cec7aa",
  /** The darker alternating row. */
  rowAlt: "#bbb59b",
  /** Title bar and section bands ("Caractéristiques", "Mes Métiers"). */
  band: "#5b5446",
  /** The "Capital" band, a shade lighter than the section bands. */
  capitalBand: "#9c927a",
  bandText: "#ffffff",
  text: "#4a4437",
  /** Secondary rows (Initiative, Prospection, Portée, Invocation). */
  textMuted: "#5d5747",
  /** Both gauges fill in the same orange; only their length differs. */
  gauge: "#ed7930",
  gaugeTrack: "#5b5446",
  /** Empty job / specialisation slots, and the alignment frame. */
  slot: "#dcd5bf",
  slotBorder: "#8b7355",
  /** The `+` boost button, shared with the spell book's upgrade button. */
  plus: "#e8801f",
  plusBorder: "#f6c98a",
  plusText: "#ffffff",
} as const;

/**
 * Every offset is in base units from the top-left of `Panel`'s content
 * box — i.e. inside the 3-unit border and below the 22-unit title bar.
 */
export const CHARACTERISTICS_METRICS = {
  width: 232,
  height: 410,
  /** `Panel` chrome: 3 units of border each side, 22 of title bar. */
  border: 3,
  titleBar: 22,

  /** Identity block: alignment/compass frames, portrait, name, level. */
  headerTop: 2.5,
  headerHeight: 54,
  /** Alignment shield and, under it, the orientation compass. */
  alignSlot: 23,
  alignSlotX: 3,
  compassSlotY: 28,
  portraitX: 34,
  portraitWidth: 57,
  /** Name / "Niveau N" / trophy line all share this left edge. */
  identityX: 94,
  identityRowHeight: 18,

  /**
   * Énergie, Expérience, then the seven combat lines. One uniform grid;
   * the two gauges sit on the first two rows of it.
   */
  statsTop: 56.5,
  rowHeight: 17.2,
  gaugeX: 105,
  gaugeWidth: 94,
  gaugeHeight: 7.5,
  /** The little orange square right of the experience gauge. */
  xpButtonX: 205,
  xpButtonSize: 13,

  /** Section band ("Caractéristiques", "Mes Métiers"). */
  bandHeight: 14,
  /** Left inset of a band's label. */
  bandTextX: 15,

  /**
   * Rows keep a wide left margin: the icon starts 15 units in and the
   * label another 22 after it, which is what the capture measures.
   */
  iconX: 15,
  iconSize: 14,
  labelX: 37,
  /** The two gauges have no icon, so their label sits further left. */
  gaugeLabelX: 20,
  /** Right inset of a combat line's value. */
  valueRight: 15,
  /**
   * Characteristic values stop well short of the edge — retail keeps the
   * `+` button's lane clear whether or not the button is drawn.
   */
  statValueRight: 42,
  plusSize: 12,

  capitalHeight: 16,
  /** Job slots, then the three smaller specialisation slots. */
  jobSlotX: 15,
  jobSlotGap: 5,
  jobSlot: 22,
  specSlot: 14,
  jobSlotY: 3,
  specLabelX: 130,
} as const;

/**
 * Where a row sits, given its index in the uniform grid that starts at
 * `statsTop`. Used for the two gauges and the seven combat lines alike.
 */
export function rowTop(index: number): number {
  return (
    CHARACTERISTICS_METRICS.statsTop + index * CHARACTERISTICS_METRICS.rowHeight
  );
}
