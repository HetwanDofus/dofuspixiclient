import { ExternalStore } from "./game-store";
import type { CharacterStats } from "@/types/stats";

export interface CharacterState {
  name: string;
  level: number;
  classId: number;
  stats: CharacterStats | null;
}

const initialState: CharacterState = {
  name: "",
  level: 1,
  classId: 0,
  stats: null,
};

export const characterStore = new ExternalStore<CharacterState>(initialState);
