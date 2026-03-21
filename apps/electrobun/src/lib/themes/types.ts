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
  combat: {
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

export interface ThemeLayoutStatsPanel {
  width: number;
  height: number;
  headerH: number;
}

export interface ThemeLayoutBanner {
  offsetY: number;
  whiteZoneTopRight: { x: number; y: number; w: number; h: number };
  xpCircle: { x: number; yOffset: number };
  heart: { x: number; yOffset: number };
  bannerContainer: { x: number; yOffset: number };
  shortcuts: { startX: number; yOffset: number; spacingX: number; spacingY: number };
  iconButtons: Array<{ key: string; x: number }>;
}

export interface ThemeLayoutCombat {
  spellBar: { slotSize: number; slotsPerRow: number; spacing: number; totalSlots: number };
  actionBar: { width: number; height: number };
}

export interface ThemeLayoutDisplay {
  width: number;
  height: number;
  bannerHeight: number;
  gameWidth: number;
  gameHeight: number;
}

export interface ThemeLayout {
  statsPanel: ThemeLayoutStatsPanel;
  banner: ThemeLayoutBanner;
  combat: ThemeLayoutCombat;
  display: ThemeLayoutDisplay;
}

export interface ThemeAssets {
  basePath: string;
}

export interface Theme {
  name: string;
  version: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  metrics: ThemeMetrics;
  layout: ThemeLayout;
  assets: ThemeAssets;
}
