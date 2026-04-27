import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(8)
export class NomadChallenge extends FightChallenge {
  readonly challengeId = 8;
  readonly challengeName = "Nomad";

  onTurnEnd(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.ap > 0) {
      this.fail(_f, fighter);
    }
  }
}
