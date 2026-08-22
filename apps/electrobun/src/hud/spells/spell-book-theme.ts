/**
 * Palette and metrics for the spell book, sampled straight off the
 * reference capture of the retail 1.29 client (`screenshot-ui/spells.png`).
 *
 * The capture was taken at a canvas zoom of 3.654 (742-unit-wide display
 * area rendered 2710 px wide), so every measurement below is the pixel
 * value divided by that factor — i.e. base units, the same space the
 * other HUD panels lay out in and that `zoom` scales.
 */

export const SPELL_BOOK_COLORS = {
  /** Panel body behind the list. */
  body: "#d4d0ae",
  /** Title bar, column header, scrollbar thumb. */
  header: "#504a3d",
  headerText: "#ffffff",
  text: "#4a4437",
  /** Second line of a row (AP / range, upgrade cost). */
  textMuted: "#5d5747",
  rowEven: "#b4ad92",
  rowOdd: "#c7bfa1",
  rowHover: "#d8d1b2",
  rowSelected: "#e7e1c4",
  scrollTrack: "#bdba9c",
  /** The `+` upgrade button. */
  plus: "#e8801f",
  plusBorder: "#f6c98a",
  plusText: "#ffffff",
  /** Detail panel body — noticeably lighter than the list panel. */
  detailBody: "#ecebdd",
  detailRowEven: "#d4d1b3",
  detailRowOdd: "#e1e0cb",
  detailTabActive: "#dcd7c2",
  detailTabInactive: "#b9b4a0",
  /** Selected level number in the "Niveaux du sort" strip. */
  levelActive: "#e2711d",
  check: "#3d8b23",
  cross: "#c0392b",
} as const;

/** Right-hand list panel ("Tes sorts"). */
export const SPELL_LIST_METRICS = {
  width: 320,
  height: 402,
  /** Panel chrome eats 3 px of border on each side plus a 22 px title bar. */
  border: 3,
  titleBar: 22,
  /** Horizontal inset of the list block and the two label rows. */
  gutter: 8,
  capitalRowCenter: 12,
  typeRowCenter: 35,
  dropdownTop: 24,
  dropdownHeight: 18,
  dropdownWidth: 98,
  listTop: 50,
  columnHeader: 19,
  rowHeight: 30,
  /** Rows that fit without scrolling — 10 in the reference capture. */
  visibleRows: 10,
  iconSize: 22,
  scrollbarWidth: 9,
  /** Gap between the AP cost and the range on a row's second line. */
  costRangeGap: 16,
} as const;

/**
 * Left-hand detail panel. Unlike the list, this window has no flow: the
 * retail original places every block at a fixed offset inside a fixed
 * 389x389 frame, so the transcription does too. Values are the reference
 * capture's pixel offsets from the panel's top edge, divided by 3.654.
 */
export const SPELL_DETAIL_METRICS = {
  width: 389,
  height: 389,
  border: 3,
  /** Inset of every content block from the panel's outer edge. */
  padding: 14,
  /** The white tab in the top-right corner holding the level strip. */
  levelTab: 18,
  levelTabWidth: 142,
  /** "Niveaux du sort:" sits on the body, to the left of that tab. */
  levelLabelRight: 149,
  levelLabelTop: 8,

  iconTop: 12,
  iconSize: 42,
  /** Name / "Niveau requis" on the left, range / AP cost on the right. */
  nameTop: 28,
  subTop: 42,
  descriptionTop: 62,

  effectsLabelTop: 124,
  /** Normaux / Critiques tabs, sitting directly on the list's top edge. */
  tabsTop: 140,
  tabsHeight: 19,
  tabWidth: 70,
  effectListTop: 160,
  effectRowHeight: 19.8,
  /** Effect rows the panel always draws, filled or empty. */
  effectRows: 5,
  effectIconSize: 15,

  otherLabelTop: 269,
  statsTop: 291,
  /**
   * The two columns of "Autres caractéristiques" are not the same rhythm
   * in the original: the left one fits five lines at 20 units each, the
   * right one squeezes six into the same span.
   */
  statLineHeight: 20,
  flagLineHeight: 15.7,
  /** Vertical rule between the two columns, measured from the panel's left. */
  statsDivider: 266,
} as const;

/**
 * "CC actuels": the critical rate the player actually rolls against,
 * after their gear's critical-hit bonus. Dofus 1.29 subtracts the bonus
 * from the spell's 1/x rate and never lets it drop below 1/2.
 *
 * Returns 0 for a spell that cannot crit at all, which the panel prints
 * as "-" rather than "1/0".
 */
export function effectiveCriticalRate(
  baseRate: number,
  criticalBonus: number
): number {
  if (baseRate <= 0) {
    return 0;
  }
  return Math.max(2, baseRate - criticalBonus);
}
