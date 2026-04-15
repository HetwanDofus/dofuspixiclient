import type { ComponentType, HTMLAttributes } from "react";

export type IconProps = HTMLAttributes<HTMLElement>;

export interface ThemeColors {
  bg: number;
  bgAlt: number;
  bgAltDark: number;
  headerBg: number;
  border: number;
  textDark: number;
  textWhite: number;
  barBg: number;
  barFill: number;
  barBorder: number;
  closeBg: number;
  boost: number;
  boostHover: number;
  slotBg: number;
  alignBorder: number;
  banner: {
    background: number;
    whiteZone: number;
  };
  fight: {
    spellSlotBg: number;
    spellSlotActive: number;
    spellHighlight: number;
    apCostText: number;
    actionBarBg: number;
    apBar: number;
    mpBar: number;
    passTurnButton: number;
    forfeitButton: number;
  };
  chatFilters: Array<{ index: number; color: number }>;
}

export interface ThemeMetrics {
  rowH: number;
  headerH: number;
  px: number;
  iconSize: number;
  barH: number;
  closeSize: number;
  alignFrame: number;
  jobSlot: number;
  specSlot: number;
}

export interface ThemeFonts {
  primary: string;
}

export interface ThemeAssets {
  basePath: string;
}

/** All banner icon keys — a theme must provide every one of these */
export type BannerIconKey =
  | "stats"
  | "spells"
  | "inventory"
  | "quest"
  | "map"
  | "friends"
  | "guild"
  | "mount"
  | "pvp";

/** Utility icon keys used in the banner UI */
export type BannerUtilityIconKey =
  | "buttonUp"
  | "buttonDown"
  | "expand"
  | "reduce"
  | "emotes"
  | "emotesHover"
  | "sit"
  | "sitHover";

/** Map from every required key to a React SVG component */
export type ThemeBannerIcons = {
  [K in BannerIconKey]: ComponentType<IconProps>;
};

export type ThemeBannerUtilityIcons = {
  [K in BannerUtilityIconKey]: ComponentType<IconProps>;
};

/**
 * Replaceable React components a theme must supply.
 * Add new component slots here — the compiler will enforce them
 * in every theme.
 */
export interface ThemeComponents {
  bannerIcons: ThemeBannerIcons;
  bannerUtilityIcons: ThemeBannerUtilityIcons;
}

/**
 * Flat color-token map that gets injected as CSS custom properties
 * (like Tailwind v3 colors).
 *
 * Keys become `--dofus-<key>`, values are CSS color strings.
 * Themes produce this from their ThemeColors.
 */
export type ThemeColorTokens = {
  /* general */
  bg: string;
  "bg-alt": string;
  "bg-alt-dark": string;
  "header-bg": string;
  border: string;
  "text-dark": string;
  "text-white": string;
  "bar-bg": string;
  "bar-fill": string;
  "bar-border": string;
  "close-bg": string;
  boost: string;
  "boost-hover": string;
  "slot-bg": string;
  "align-border": string;
  /* banner */
  "banner-bg": string;
  "banner-white-zone": string;
  /* fight */
  "fight-spell-slot-bg": string;
  "fight-spell-slot-active": string;
  "fight-spell-highlight": string;
  "fight-ap-cost-text": string;
  "fight-action-bar-bg": string;
  "fight-ap": string;
  "fight-mp": string;
  "fight-pass-turn": string;
  "fight-forfeit": string;
};

export interface Theme {
  name: string;
  version: string;
  colors: ThemeColors;
  colorTokens: ThemeColorTokens;
  fonts: ThemeFonts;
  metrics: ThemeMetrics;
  assets: ThemeAssets;
  components: ThemeComponents;
}
