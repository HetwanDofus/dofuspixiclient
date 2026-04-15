import type { Theme, ThemeColors, ThemeColorTokens } from "../types";
import { bannerIcons, bannerUtilityIcons } from "./icons";

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function buildColorTokens(c: ThemeColors): ThemeColorTokens {
  return {
    bg: hex(c.bg),
    "bg-alt": hex(c.bgAlt),
    "bg-alt-dark": hex(c.bgAltDark),
    "header-bg": hex(c.headerBg),
    border: hex(c.border),
    "text-dark": hex(c.textDark),
    "text-white": hex(c.textWhite),
    "bar-bg": hex(c.barBg),
    "bar-fill": hex(c.barFill),
    "bar-border": hex(c.barBorder),
    "close-bg": hex(c.closeBg),
    boost: hex(c.boost),
    "boost-hover": hex(c.boostHover),
    "slot-bg": hex(c.slotBg),
    "align-border": hex(c.alignBorder),
    "banner-bg": hex(c.banner.background),
    "banner-white-zone": hex(c.banner.whiteZone),
    "fight-spell-slot-bg": hex(c.fight.spellSlotBg),
    "fight-spell-slot-active": hex(c.fight.spellSlotActive),
    "fight-spell-highlight": hex(c.fight.spellHighlight),
    "fight-ap-cost-text": hex(c.fight.apCostText),
    "fight-action-bar-bg": hex(c.fight.actionBarBg),
    "fight-ap": hex(c.fight.apBar),
    "fight-mp": hex(c.fight.mpBar),
    "fight-pass-turn": hex(c.fight.passTurnButton),
    "fight-forfeit": hex(c.fight.forfeitButton),
  };
}

const colors: ThemeColors = {
  bg: 0xd5cfaa,
  bgAlt: 0xc9bf9d,
  bgAltDark: 0xb4ac8d,
  headerBg: 0x514a3c,
  border: 0x4e4028,
  textDark: 0x514a3c,
  textWhite: 0xffffff,
  barBg: 0x514a3c,
  barFill: 0xff6600,
  barBorder: 0x514a3c,
  closeBg: 0xff6500,
  boost: 0xff6100,
  boostHover: 0xeca272,
  slotBg: 0xdcd5bf,
  alignBorder: 0x88bbcc,
  banner: {
    background: 0xd5cfaa,
    whiteZone: 0xffffff,
  },
  fight: {
    spellSlotBg: 0x222222,
    spellSlotActive: 0x333333,
    spellHighlight: 0xffff00,
    apCostText: 0x00aaff,
    actionBarBg: 0x000000,
    apBar: 0x00aaff,
    mpBar: 0x00ff00,
    passTurnButton: 0x4444aa,
    forfeitButton: 0xaa4444,
  },
  chatFilters: [
    { index: 0, color: 0x009900 },
    { index: 2, color: 0x111111 },
    { index: 3, color: 0x0066ff },
    { index: 4, color: 0x663399 },
    { index: 5, color: 0xdd7700 },
    { index: 6, color: 0x737373 },
    { index: 7, color: 0x663300 },
    { index: 10, color: 0xe4287c },
  ],
};

export const classicTheme: Theme = {
  name: "classic",
  version: "1.0.0",
  colors,
  colorTokens: buildColorTokens(colors),
  fonts: {
    primary: "Verdana",
  },
  metrics: {
    rowH: 18,
    headerH: 18,
    px: 10,
    iconSize: 14,
    barH: 10,
    closeSize: 12,
    alignFrame: 40,
    jobSlot: 42,
    specSlot: 30,
  },
  assets: {
    basePath: "/themes/classic/assets",
  },
  components: {
    bannerIcons,
    bannerUtilityIcons,
  },
};
