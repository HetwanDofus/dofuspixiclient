import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(30)
export class LowLevelsFirstChallenge extends FightChallenge {
  readonly challengeId = 30;
  readonly challengeName = "Low Levels First";

  onFighterDied(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    const killedLevel = fighter.level;
    const aliveMonsters = f
      .fighters()
      .filter((ftr) => ftr.team?.side === 1 && ftr.lp > 0 && ftr !== fighter);
    const hasHigherLevel = aliveMonsters.some((m) => m.level > killedLevel);
    if (hasHigherLevel) {
      this.fail(f, null);
    }
  }
}
