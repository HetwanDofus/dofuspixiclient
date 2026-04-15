import { type Actor, createActor } from "xstate";

import { fightMachine } from "@/game/machines/fight.machine";

import { ExternalStore } from "./game-store";

/**
 * Fight mode — projected from fightMachine state value.
 * Kept for existing consumers; prefer reading from fightActor directly.
 */
export type FightMode =
  | "none"
  | "placement"
  | "fighting"
  | "spectating"
  | "ended";

export interface FightState {
  mode: FightMode;
  ap: number;
  mp: number;
  maxAp: number;
  maxMp: number;
  turnIndex: number;
  timeline: string[];
  isMyTurn: boolean;
}

const initialState: FightState = {
  mode: "none",
  ap: 0,
  mp: 0,
  maxAp: 0,
  maxMp: 0,
  turnIndex: 0,
  timeline: [],
  isMyTurn: false,
};

/**
 * Backing XState actor — single source of truth for fight state.
 * fightStore projects a denormalized snapshot for legacy useSyncExternalStore
 * consumers. New consumers should useSelector on fightActor directly.
 */
export const fightActor: Actor<typeof fightMachine> = createActor(fightMachine);

export const fightStore = new ExternalStore<FightState>(initialState);

function projectMode(value: unknown): FightMode {
  if (typeof value === "string") {
    if (
      value === "none" ||
      value === "placement" ||
      value === "spectating" ||
      value === "ended"
    ) {
      return value;
    }
  }

  if (value && typeof value === "object" && "fighting" in value) {
    return "fighting";
  }

  return "none";
}

fightActor.subscribe((snap) => {
  const ctx = snap.context;
  const mode = projectMode(snap.value);
  const isMyTurn =
    typeof snap.value === "object" &&
    snap.value !== null &&
    "fighting" in (snap.value as Record<string, unknown>) &&
    (snap.value as { fighting: string }).fighting === "myTurn";

  fightStore.setState({
    mode,
    ap: ctx.ap,
    mp: ctx.mp,
    maxAp: ctx.maxAp,
    maxMp: ctx.maxMp,
    turnIndex: ctx.turnIndex,
    timeline: ctx.timeline,
    isMyTurn,
  });
});

fightActor.start();
