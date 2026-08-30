import { RESOURCES_METRICS } from "../inventory/inventory-theme";

/**
 * Geometry of the player-to-player exchange, in the same base units as
 * `inventory-theme` (multiplied by `zoom` at draw time).
 *
 * Measured off `screenshot-ui/exchanges/ui-result-wanted.png` with the
 * factor 0.6 — the one that brings that capture's grid cell back to
 * `RESOURCES_METRICS.cellSize`, the 33 units every other 1.29 grid in the
 * project draws. Retail floats three separate windows here rather than the
 * one box `StorageWindow` uses, so each has its own `Panel`.
 */

/** The bag browser, top right: 8 columns of the capture's wide grid. */
export const TRADE_INVENTORY_PANEL = { width: 300, height: 190 } as const;

/** Both offer boards, bottom left and bottom right. Same width. */
export const TRADE_OFFER_PANEL = { width: 300, height: 116 } as const;

/** Padding between a panel's border and the box it holds. */
export const TRADE_PAD = 8;

export const TRADE_INVENTORY_METRICS = {
  ...RESOURCES_METRICS,
  gridColumns: 8,
  visibleRows: 3,
  // The `Panel` title bar carries the name, so the grid draws no header
  // line of its own and the two are zeroed rather than left to reserve
  // height nothing fills.
  titleTop: 0,
  titleHeight: 0,
} as const;

export const TRADE_OFFER_METRICS = {
  ...RESOURCES_METRICS,
  gridColumns: 7,
  visibleRows: 2,
  titleTop: 0,
  titleHeight: 0,
} as const;

/**
 * The three filter categories retail shows in this window — not the nine
 * of the inventory. Ids into `FILTER_CATEGORIES`.
 */
export const TRADE_FILTER_IDS = ["equipment", "consumables", "resources"];

/** The wide button under each offer board. */
export const TRADE_BUTTON_HEIGHT = 22;

/** The exchange arrow drawn between the two boards. */
export const TRADE_ARROW = { width: 54, height: 32 } as const;

/** Gap between the two offer boards — the arrow sits in it. */
export const TRADE_ARROW_GUTTER = 74;

/** The item card, opened by clicking any cell. Same size as the bag's. */
export const TRADE_DETAIL_PANEL = { width: 325, height: 184 } as const;

/** Margin from the play area's edges for the whole three-window group. */
export const TRADE_MARGIN = 10;
