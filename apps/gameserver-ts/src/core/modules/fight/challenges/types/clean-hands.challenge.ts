import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(19)
export class CleanHandsChallenge extends FightChallenge {
  readonly challengeId = 19;
  readonly challengeName = "Clean Hands";

  onFighterAttacked(f: Fight, caster: Fighter, target: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (caster.team?.side !== 0) {
      return;
    }
    if (caster.isInvocation()) {
      return;
    }
    if (target.team?.side !== 1) {
      return;
    }
    this.fail(f, caster);
  }
}
