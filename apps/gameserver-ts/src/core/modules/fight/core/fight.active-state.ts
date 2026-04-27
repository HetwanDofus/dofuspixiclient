import type { Fight } from "@modules/fight/core/fight.entity";
import type { FightState } from "@modules/fight/core/fight.entity.types";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { TurnList } from "@modules/fight/core/fight.turn";
import { FightType, StateName } from "@modules/fight/fight.types";

export class ActiveState implements FightState {
  readonly name = StateName.Active;
  turnList: TurnList = new TurnList([]);
  private started = false;

  enter(f: unknown): void {
    this.turnList = new TurnList((f as Fight).fighters());
    this.started = true;
  }

  leave(_f: unknown): void {}

  get isStarted(): boolean {
    return this.started;
  }

  allowLeave(f: Fight, _fighter: Fighter): boolean {
    return f.type !== FightType.Challenge;
  }
}
