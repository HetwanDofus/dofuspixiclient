import type { StateName } from "@modules/fight/fight.types";

export interface Spectator {
  sessionId: string;
  playerId: number;
}

export interface FightState {
  name: StateName;
  enter(f: unknown): void;
  leave(f: unknown): void;
}
