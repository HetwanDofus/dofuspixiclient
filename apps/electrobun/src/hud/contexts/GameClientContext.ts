import { createContext, useContext } from "react";

import type { GameClient } from "@/game/game-client";

/**
 * Provides the GameClient instance to React components
 * for dispatching game actions (boost stat, teleport, etc.)
 */
export const GameClientContext = createContext<GameClient | null>(null);

export function useGameClient(): GameClient | null {
  return useContext(GameClientContext);
}
