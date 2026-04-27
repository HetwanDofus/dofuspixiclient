import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(33)
export class SurvivorChallenge extends FightChallenge {
  readonly challengeId = 33;
  readonly challengeName = "Survivor";

  onFighterDied(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.player && fighter.team?.side === 0) {
      this.fail(f, fighter);
    }
  }
}
