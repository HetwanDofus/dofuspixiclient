import { getAssetPath, getColors } from "@/themes";

export interface IconConfig {
  key: string;
  path: string;
  x: number;
}

export interface FilterConfig {
  index: number;
  color: number;
}

export function getBannerAssetsPath(): string {
  return getAssetPath("banner");
}

export const BANNER_ASSETS_PATH = "/themes/classic/assets/banner";

export const ICON_BUTTON_CONFIGS: IconConfig[] = [
  { key: "stats", path: "stats", x: 476 - 415 },
  { key: "spells", path: "spells", x: 505.25 - 415 },
  { key: "inventory", path: "inventory", x: 534.5 - 415 },
  { key: "quest", path: "quest", x: 563.75 - 415 },
  { key: "map", path: "map", x: 593 - 415 },
  { key: "friends", path: "friends", x: 622.25 - 415 },
  { key: "guild", path: "guild", x: 651.5 - 415 },
  { key: "mount", path: "mount", x: 680.75 - 415 },
  { key: "pvp", path: "pvp", x: 710 - 415 },
];

export function getChatFilterConfigs(): FilterConfig[] {
  return getColors().chatFilters;
}

export const CHAT_FILTER_CONFIGS: FilterConfig[] = [
  { index: 0, color: 0x009900 },
  { index: 2, color: 0x111111 },
  { index: 3, color: 0x0066ff },
  { index: 4, color: 0x663399 },
  { index: 5, color: 0xdd7700 },
  { index: 6, color: 0x737373 },
  { index: 7, color: 0x663300 },
  { index: 10, color: 0xe4287c },
];
