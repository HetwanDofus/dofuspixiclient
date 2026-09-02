/**
 * Palette and metrics for the workbench, sampled off the reference capture
 * `screenshot-ui/craft_menu.png`.
 *
 * The capture carries no "captured at zoom N" note, so — same method as
 * `inventory-theme.ts` — the zoom is derived from `Panel`'s title bar,
 * which is a hardcoded `22` base units: the reference window's bar runs
 * y97→122, i.e. 26 px, so this capture's zoom is `26 / 22 ≈ 1.18`. Every
 * number below is that capture's pixel measurement divided by 1.18, which
 * is why so few of them are round.
 *
 * Two independent checks say 1.18 is right rather than convenient: the
 * grid cell comes out at 38 px / 1.18 = 32.2, and `grid-cell-bg.svg` — the
 * asset retail draws it with — is authored at exactly 32×32; and the pods
 * gauge comes out 69.5×8.5 against `EQUIP_FOOTER.podsBar`'s 75×9.
 *
 * The whole thing is one right-anchored column — skill banner, window,
 * bench, buttons — plus two pieces pinned to the left: the "Objet obtenu"
 * box and the arrow that points at it. `COLUMN` holds the stack, `BENCH`
 * the strip under it, `OBTAINED` the left pair.
 */

export const CRAFT_COLORS = {
  /** Panel body, shared with every other 1.29 window. */
  body: "#d4d0b0",
  /** The dark chrome: title bars, the "Objet obtenu" box, "Recettes". */
  dark: "#514a3c",
  darkText: "#ffffff",
  text: "#4a4437",
  /**
   * The action orange. Redder than `INVENTORY_COLORS.podsFill` (#e9702e)
   * because it is sampled off this capture, not off `inventaire.png` —
   * (255, 92, 31) on the "Combiner" fill, and the same value again on the
   * pods gauge and the selected-slot outline.
   */
  orange: "#ff5c1f",
  orangePressed: "#d84712",
  /** Track behind the pods fill. */
  gaugeTrack: "#4a4238",
  /** The quantity tag retail paints in a cell's top-left corner. */
  quantityTag: "rgba(56, 51, 41, 0.85)",
  success: "#8fae4a",
  failure: "#b4523c",
  /** Recipe book: the ingredient lines under each result. */
  muted: "#6b6553",
  rowOdd: "#c6c0a2",
  rowEven: "#dbd6bb",
  scrollTrack: "#beb99c",
  scrollThumb: "#504a3a",
} as const;

/** Margins of the whole assembly inside the play area, in base units. */
export const CRAFT_LAYOUT = {
  edge: 8,
  /** Left margin of the "Objet obtenu" box and the recipe book. */
  leftEdge: 10,
} as const;

/** The right-anchored column: banner, window, bench strip. */
export const CRAFT_COLUMN = {
  width: 319,
  /** "Compétence : Sculpter un Bâton" — capture y15→60. */
  bannerHeight: 39,
  /** Capture: banner bottom y60 → window top y94. */
  bannerGap: 29,
  windowHeight: 188,
  /** Capture: window bottom y316 → bench top y346. */
  benchGap: 25,
} as const;

/**
 * Inside the window, in coordinates local to `Panel`'s padding box — so
 * y 0..22 is the title bar and everything here sits below it.
 */
export const CRAFT_WINDOW = {
  /** "Équipement", the caption retail prints beside the type dropdown. */
  label: { x: 8, y: 27, height: 19, fontSize: 11 },
  dropdown: { x: 136, y: 27, width: 170, height: 19 },
  /** Three category buttons, not the bag's nine. */
  filters: { x: 7, y: 53, size: 18, pitch: 23 },
  pods: { x: 236, y: 58, width: 70, height: 9 },
  grid: {
    x: 8,
    y: 81,
    columns: 9,
    rows: 3,
    /** `grid-cell-bg.svg`'s own authored size. */
    cellSize: 32,
    scrollbarWidth: 11,
  },
} as const;

/**
 * The bench strip and the button row under it.
 *
 * The slots are right-aligned, not centred: the capture's six slots end
 * 4 px shy of the panel's inner right edge and leave the whole left half
 * empty. A bench holds between two and nine of them (`craft.maxSlots`),
 * so the row has to grow from somewhere, and retail grows it leftward.
 */
export const CRAFT_BENCH = {
  height: 58,
  slot: { width: 38, height: 35, top: 8, rightMargin: 3 },
  buttons: {
    height: 20,
    /** Capture: the row starts 11 px inside the strip's left edge. */
    x: 9,
    recipes: 92,
    quantity: 82,
    clear: 32,
    combine: 102,
  },
} as const;

/** The result box pinned bottom-left, and the arrow pointing into it. */
export const CRAFT_OBTAINED = {
  box: { width: 167, height: 57 },
  slot: { size: 38 },
  arrow: { width: 55, height: 42, gap: 6 },
} as const;

/** The recipe book, in the free space the window leaves at top-left. */
export const CRAFT_RECIPES = {
  width: 390,
  top: 10,
  rowIconSize: 30,
  /** Two lines of ingredients fit under a result before the row grows. */
  rowMinHeight: 44,
  ingredientIconSize: 14,
} as const;

/** The quantities the "Qté" button cycles through. */
export const CRAFT_QUANTITIES = [1, 10, 50, 100] as const;
