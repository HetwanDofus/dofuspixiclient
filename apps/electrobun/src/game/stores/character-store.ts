import type { CharacterStats } from "@/game/types/stats";

import { ExternalStore } from "./game-store";

export interface CharacterState {
  name: string;
  level: number;
  classId: number;
  stats: CharacterStats | null;
  hp: { current: number; max: number };
  energy: { current: number; max: number };
  xp: { current: number; min: number; max: number };
  kamas: number;
}

const initialState: CharacterState = {
  name: "",
  level: 1,
  classId: 0,
  stats: null,
  hp: { current: 0, max: 0 },
  energy: { current: 0, max: 0 },
  xp: { current: 0, min: 0, max: 0 },
  kamas: 0,
};

export const characterStore = new ExternalStore<CharacterState>(initialState);
