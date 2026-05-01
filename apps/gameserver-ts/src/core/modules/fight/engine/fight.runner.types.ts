import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";

export interface FrameSink {
  broadcast(fight: Fight, messageId: string, payload: unknown): void;
  sendTo(sessionId: string, messageId: string, payload: unknown): void;
}

export interface TurnObserver {
  onTurnStart(fight: Fight, fighter: Fighter): void;
}

export interface TurnListFrame {
  spriteIds: string[];
}

export interface TurnStartPayload {
  spriteId: string;
  timeMs: number;
  tableTurnNum: number;
}

export interface TurnFinishPayload {
  spriteId: string;
}

export interface TurnMiddleEntry {
  spriteId: string;
  cell: number;
  lp: number;
  /**
   * Authoritative max LP for the fighter. The client patches the fight
   * store with `{ hp: lp, maxHp: lpMax }` on every GTM, so a missing
   * value would let the proto default (0) clobber the real maxHp and
   * collapse the HP bar to 0/0.
   */
  lpMax: number;
  ap: number;
  mp: number;
  isDead: boolean;
}

export interface TurnMiddlePayload {
  entries: TurnMiddleEntry[];
}
