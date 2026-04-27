import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(42)
export class TwoForOneChallenge extends FightChallenge {
  readonly challengeId = 42;
  readonly challengeName = "Two For One";

  private killCountThisTurn = 0;

  onTurnStart(_f: Fight, _fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    this.killCountThisTurn = 0;
  }

  onFighterDied(_f: Fight, _fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    this.killCountThisTurn++;
  }

  onTurnEnd(_f: Fight, _fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (this.killCountThisTurn === 1) {
      this.fail(_f, _fighter);
    }
  }
}
