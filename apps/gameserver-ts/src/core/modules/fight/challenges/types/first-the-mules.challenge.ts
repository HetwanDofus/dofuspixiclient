import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(48)
export class FirstTheMulesChallenge extends FightChallenge {
  readonly challengeId = 48;
  readonly challengeName = "First The Mules";

  onFighterDied(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.team?.side === (_f.fighters()[0]?.team?.side ?? null)) {
      return;
    }

    const remainingEnemies = _f
      .fighters()
      .filter(
        (ftr) =>
          ftr.team?.side !== (_f.fighters()[0]?.team?.side ?? null) &&
          ftr.lp > 0
      );

    if (remainingEnemies.length === 0) {
      return;
    }

    const minLevel = Math.min(...remainingEnemies.map((ftr) => ftr.level));

    if (fighter.level > minLevel) {
      this.fail(_f, null);
    }
  }
}
