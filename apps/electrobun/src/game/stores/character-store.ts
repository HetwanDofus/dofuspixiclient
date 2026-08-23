import type { CharacterStats } from "@/game/types/stats";

import { ExternalStore } from "./game-store";

export interface CharacterState {
  name: string;
  level: number;
  classId: number;
  /**
   * Sprite id of the breed, `classId * 10 + sex` in 1.29. The
   * characteristics window renders the matching "big" artwork from it,
   * the same asset the turn-change banner uses.
   */
  gfxId: number;
  /** Colour-zone overrides for that artwork; -1 keeps the palette default. */
  color1: number;
  color2: number;
  color3: number;
  stats: CharacterStats | null;
  hp: { current: number; max: number };
  energy: { current: number; max: number };
  xp: { current: number; min: number; max: number };
  kamas: number;
}

const DEFAULT_COLOR = -1;

const initialState: CharacterState = {
  name: "",
  level: 1,
  classId: 0,
  gfxId: 0,
  color1: DEFAULT_COLOR,
  color2: DEFAULT_COLOR,
  color3: DEFAULT_COLOR,
  stats: null,
  hp: { current: 0, max: 0 },
  energy: { current: 0, max: 0 },
  xp: { current: 0, min: 0, max: 0 },
  kamas: 0,
};

export const characterStore = new ExternalStore<CharacterState>(initialState);
