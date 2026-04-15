import type { Theme, ThemeColors, ThemeFonts, ThemeMetrics } from "./types";

export type {
  BannerIconKey,
  BannerUtilityIconKey,
  IconProps,
  Theme,
  ThemeBannerIcons,
  ThemeBannerUtilityIcons,
  ThemeColors,
  ThemeColorTokens,
  ThemeComponents,
  ThemeFonts,
  ThemeMetrics,
} from "./types";
export {
  ThemeProvider,
  useTheme,
  useThemeColors,
  useThemeComponents,
} from "./ThemeProvider";

let activeTheme: Theme | null = null;

/**
 * Set the active theme directly from a TS module.
 * Called by ThemeProvider on mount. Replaces the old fetch-based loadTheme().
 */
export function setTheme(theme: Theme): void {
  activeTheme = theme;
}

/**
 * @deprecated Use setTheme() via ThemeProvider instead. Kept for backward compatibility.
 */
export async function loadTheme(name: string): Promise<void> {
  const response = await fetch(`/themes/${name}/theme.json`);
  const raw = await response.json();
  const parsed = parseColors(raw) as Theme;
  activeTheme = parsed;
}

function parseColors(obj: unknown): unknown {
  if (typeof obj === "string" && /^0x[0-9a-fA-F]+$/.test(obj)) {
    return Number(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(parseColors);
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = parseColors(value);
    }

    return result;
  }

  return obj;
}

function ensureLoaded(): Theme {
  if (!activeTheme) {
    throw new Error(
      "Theme not loaded. Call setTheme() or wrap with ThemeProvider before accessing theme."
    );
  }

  return activeTheme;
}

export function getTheme(): Theme {
  return ensureLoaded();
}

export function getColors(): ThemeColors {
  return ensureLoaded().colors;
}

export function getMetrics(): ThemeMetrics {
  return ensureLoaded().metrics;
}

export function getFonts(): ThemeFonts {
  return ensureLoaded().fonts;
}

export function getAssetPath(path: string): string {
  return `${ensureLoaded().assets.basePath}/${path}`;
}
