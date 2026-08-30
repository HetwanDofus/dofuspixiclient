import { TRADE_INVENTORY_METRICS } from "../exchange/trade-theme";

/**
 * Geometry of the auction house, in the same base units as
 * `inventory-theme` (multiplied by `zoom` at draw time).
 *
 * Measured 1:1 off `screenshot-ui/hdv/image.png`. That capture is 711 px
 * wide and its body text is 11 px — the same 11 units every other panel
 * in this project draws — so one pixel of the capture is one base unit
 * here, and no scale factor is guessed. The auction house really is
 * bigger than the inventory window (502 units); in retail it is too.
 *
 * The sell mode (`screenshot-ui/hdv/mode-vente.png`) is a full-screen
 * capture at the game's own zoom rather than a 1:1 window shot, so its
 * three windows are laid out to match the buy window's units instead of
 * being measured off it.
 */

/**
 * Mode achat — one window, two columns.
 *
 * The height is the capture's 393 **plus** the 22 units of title bar:
 * `Panel` lays its content out below the bar, so every `y` below is
 * measured from the content's own top, and a window sized to the
 * capture would clip its own footer by exactly one title bar.
 */
export const BUY_WINDOW = { width: 703, height: 415 } as const;

/** The left column: "Objets en vente". */
export const BUY_LIST = {
  x: 8,
  y: 6,
  width: 275,
  height: 325,
  /** "Objets en vente", inside the sunken box. */
  headerHeight: 20,
  /** The "Catégorie [ ▾ ]" row. */
  categoryHeight: 24,
  rowHeight: 20,
  visibleRows: 12,
  scrollbarWidth: 10,
  /** "125 objets", bottom right of the box. */
  footerHeight: 18,
} as const;

/** "Porte monnaie : 14 426 762" and the pods gauge, under the list. */
export const BUY_PURSE = { x: 8, y: 335, width: 275, height: 20 } as const;

/** The right column, top: the item card. */
export const BUY_CARD = { x: 291, y: 4, width: 404, height: 205 } as const;

/** The right column, bottom: the x1 / x10 / x100 price grid. */
export const BUY_PRICES = {
  x: 291,
  y: 213,
  width: 404,
  height: 118,
  headerHeight: 17,
  rowHeight: 19,
  visibleRows: 5,
  scrollbarWidth: 10,
  /** The icon column, left of the three prices. */
  iconWidth: 26,
  /** The "Acheter" button at the end of a row. */
  buyWidth: 74,
} as const;

/** "Prix moyen : 83 759 kamas/u." under the grid. */
export const BUY_AVERAGE = { x: 291, y: 333, width: 404, height: 20 } as const;

/** `[Mode vente] [Rechercher…] [Fermer]`. */
export const BUY_FOOTER = { y: 357, height: 22, gap: 10, width: 118 } as const;

/** Margin from the play area's edges, matching the trade window's. */
export const BIGSTORE_MARGIN = 10;

/** The wide orange buttons under each sell-mode window. */
export const BIGSTORE_BUTTON_HEIGHT = 22;

/** Mode vente — three floating windows, like the player-to-player trade. */
export const SELL_STOCK_PANEL = { width: 280, height: 300 } as const;
export const SELL_FORM_PANEL = { width: 330, height: 396 } as const;

/** The bag browser of the sell mode — `TradeInventoryPanel`, made taller
 * by an extra grid row and the "Filtrer pour cet HDV" strip under it. */
export const SELL_INVENTORY = { width: 300, height: 270 } as const;

/** Rows of the stock list, sized to fill `SELL_STOCK_PANEL`. */
export const SELL_STOCK_ROWS = 10;

/** Four rows of bag here, against the trade window's three. */
export const SELL_INVENTORY_METRICS = {
  ...TRADE_INVENTORY_METRICS,
  visibleRows: 4,
} as const;

/**
 * The whole sell mode, as one block: three windows side by side with a
 * gutter between them, plus the "Mode achat" button under the stock.
 *
 * Used to work out how much the group has to be scaled down to fit the
 * play area. Three fixed windows at the HUD's own zoom do not fit a
 * 1080p canvas, and retail gets away with it only because its windows
 * can be dragged — nothing here can, so the group shrinks instead of
 * overlapping itself.
 */
export const SELL_LAYOUT = {
  gutter: 10,
  get width() {
    return (
      SELL_STOCK_PANEL.width +
      SELL_FORM_PANEL.width +
      SELL_INVENTORY.width +
      this.gutter * 2
    );
  },
  /** The tallest column — the block's own height. */
  get height() {
    return Math.max(
      SELL_STOCK_PANEL.height,
      SELL_FORM_PANEL.height,
      SELL_INVENTORY.height
    );
  },
  /** How tall each column is, in the order they are drawn. */
  get columnHeights() {
    return [
      SELL_STOCK_PANEL.height,
      SELL_FORM_PANEL.height,
      SELL_INVENTORY.height,
    ];
  },
} as const;

/**
 * The largest footprint the auction house ever needs, over both modes.
 *
 * Both windows are scaled by the **same** factor, worked out from this
 * rather than each from its own size. Sizing them independently made the
 * buy window render ~20% larger than the sell window — same base units,
 * two different scales — so the two halves of one feature disagreed
 * about how big text is, and switching mode resized everything on
 * screen.
 */
export const BIGSTORE_FOOTPRINT = {
  get width() {
    return Math.max(BUY_WINDOW.width, SELL_LAYOUT.width);
  },
  get height() {
    return Math.max(BUY_WINDOW.height, SELL_LAYOUT.height);
  },
} as const;

/** The read-only price grid inside the seller's card. */
/**
 * Two rows, not the buy window's five: this grid is here so a seller can
 * see what the model already goes for, and the space below it belongs to
 * the lot/price form, which is what the window is actually for.
 */
export const SELL_PRICES = { rowHeight: 19, visibleRows: 2 } as const;

/**
 * Two lines reserved for the average-price sentence.
 *
 * "Cet objet n'a encore jamais été vendu dans cet hôtel de vente." wraps
 * at this width, and letting it push the form down clipped the "Mettre
 * en vente" button off the bottom of the window. The height is fixed so
 * the button never moves, whichever of the two sentences is showing.
 */
export const SELL_AVERAGE_HEIGHT = 28;

/**
 * The three lots, as labels. The sizes themselves come from the server in
 * `ExchangeBigStoreParams.lot_sizes` — this is only how they are written.
 */
export function lotLabel(size: number): string {
  return `x${size}`;
}

/** 1.29 writes every price with a thin thousands separator. */
export function formatKamas(value: number | bigint): string {
  return Number(value).toLocaleString("fr-FR");
}
