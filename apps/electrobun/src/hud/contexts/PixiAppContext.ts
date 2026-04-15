import type { Application } from "pixi.js";
import { createContext, useContext } from "react";

/**
 * Provides the main PixiJS Application instance to React components
 * that need to embed PIXI content via usePixiSlotShared.
 */
export const PixiAppContext = createContext<Application | null>(null);

export function usePixiApp(): Application | null {
  return useContext(PixiAppContext);
}
