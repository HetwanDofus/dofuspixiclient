import { ExternalStore } from "./game-store";

export type CombatMode = "none" | "placement" | "fighting" | "spectating";

export interface CombatState {
  mode: CombatMode;
  ap: number;
  mp: number;
  maxAp: number;
  maxMp: number;
  turnIndex: number;
  timeline: number[];
  isMyTurn: boolean;
}

const initialState: CombatState = {
  mode: "none",
  ap: 0,
  mp: 0,
  maxAp: 0,
  maxMp: 0,
  turnIndex: 0,
  timeline: [],
  isMyTurn: false,
};

export const combatStore = new ExternalStore<CombatState>(initialState);
