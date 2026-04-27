import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(41)
export class ExuberantChallenge extends FightChallenge {
  readonly challengeId = 41;
  readonly challengeName = "Exuberant";

  onTurnEnd(f: Fight, fighter: Fighter): void {
    if (!this.alive || fighter.team?.side !== 0) {
      return;
    }
    if (fighter.ap > 0) {
      this.fail(f, fighter);
    }
  }
}
