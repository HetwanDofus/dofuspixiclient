import { TextStyle } from "pixi.js";

import { getColors, getFonts, getMetrics } from "@/themes";

/**
 * Lazy proxy that reads from the active theme on every access.
 * Keeps backward-compat with existing `COLORS.BG` usage.
 */
export const COLORS = new Proxy(
  {} as {
    readonly BG: number;
    readonly BG_ALT: number;
    readonly BG_ALT_DARK: number;
    readonly HEADER_BG: number;
    readonly BORDER: number;
    readonly TEXT_DARK: number;
    readonly TEXT_WHITE: number;
    readonly BAR_BG: number;
    readonly BAR_FILL: number;
    readonly BAR_BORDER: number;
    readonly CLOSE_BG: number;
    readonly BOOST: number;
    readonly BOOST_HOVER: number;
    readonly SLOT_BG: number;
    readonly ALIGN_BORDER: number;
  },
  {
    get(_target, prop: string) {
      const c = getColors();
      const map: Record<string, number> = {
        BG: c.bg,
        BG_ALT: c.bgAlt,
        BG_ALT_DARK: c.bgAltDark,
        HEADER_BG: c.headerBg,
        BORDER: c.border,
        TEXT_DARK: c.textDark,
        TEXT_WHITE: c.textWhite,
        BAR_BG: c.barBg,
        BAR_FILL: c.barFill,
        BAR_BORDER: c.barBorder,
        CLOSE_BG: c.closeBg,
        BOOST: c.boost,
        BOOST_HOVER: c.boostHover,
        SLOT_BG: c.slotBg,
        ALIGN_BORDER: c.alignBorder,
      };
      return map[prop];
    },
  }
);

/**
 * Lazy proxy that reads from the active theme on every access.
 */
export const METRICS = new Proxy(
  {} as {
    readonly ROW_H: number;
    readonly HEADER_H: number;
    readonly PX: number;
    readonly ICON_SIZE: number;
    readonly BAR_H: number;
    readonly CLOSE_SIZE: number;
    readonly ALIGN_FRAME: number;
    readonly JOB_SLOT: number;
    readonly SPEC_SLOT: number;
  },
  {
    get(_target, prop: string) {
      const m = getMetrics();
      const map: Record<string, number> = {
        ROW_H: m.rowH,
        HEADER_H: m.headerH,
        PX: m.px,
        ICON_SIZE: m.iconSize,
        BAR_H: m.barH,
        CLOSE_SIZE: m.closeSize,
        ALIGN_FRAME: m.alignFrame,
        JOB_SLOT: m.jobSlot,
        SPEC_SLOT: m.specSlot,
      };
      return map[prop];
    },
  }
);

export function boldText(size: number, color: number): TextStyle {
  return new TextStyle({
    fontFamily: getFonts().primary,
    fontSize: size,
    fill: color,
    fontWeight: "bold",
  });
}

export function regularText(size: number, color: number): TextStyle {
  return new TextStyle({
    fontFamily: getFonts().primary,
    fontSize: size,
    fill: color,
  });
}
