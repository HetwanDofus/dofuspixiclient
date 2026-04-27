import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(49)
export class ProtectTheMulesChallenge extends FightChallenge {
  readonly challengeId = 49;
  readonly challengeName = "Protect The Mules";

  onFighterDied(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }

    if (
      fighter.team?.side === (_f.fighters()[0]?.team?.side ?? null) &&
      fighter.isInvocation?.()
    ) {
      this.fail(_f, fighter);
    }
  }
}
