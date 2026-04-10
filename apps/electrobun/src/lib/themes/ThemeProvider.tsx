import { createContext, type ReactNode, useContext, useEffect } from "react";

import type { Theme, ThemeColorTokens, ThemeComponents } from "./types";
import { setTheme } from "./index";

const ThemeContext = createContext<Theme | null>(null);

/** Inject all color tokens as `--dofus-*` CSS custom properties on :root */
function injectColorTokens(tokens: ThemeColorTokens): void {
  const root = document.documentElement;

  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--dofus-${key}`, value);
  }
}

interface ThemeProviderProps {
  theme: Theme;
  children: ReactNode;
}

export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  useEffect(() => {
    setTheme(theme);
    injectColorTokens(theme.colorTokens);
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);

  if (!theme) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return theme;
}

export function useThemeComponents(): ThemeComponents {
  return useTheme().components;
}

export function useThemeColors(): ThemeColorTokens {
  return useTheme().colorTokens;
}
