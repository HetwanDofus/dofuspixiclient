import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { Element, FightObjectKind } from "@modules/fight/fight.types";

export type ArrivalTrigger = (fight: Fight, victim: Fighter) => boolean;
export type TurnStartTrigger = (fight: Fight, owner: Fighter) => void;

export interface FightObject {
  id: number;
  kind: FightObjectKind;
  casterId: number;
  cell: number;
  size: number;
  element: Element;
  spellId: number;
  spellLevel: number;
  color: number;
  remaining: number;
  onArrival?: ArrivalTrigger;
  onTurnStart?: TurnStartTrigger;
  cellEligible?: (cell: number) => boolean;
}
