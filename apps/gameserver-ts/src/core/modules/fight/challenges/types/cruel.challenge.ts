import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(10)
export class CruelChallenge extends FightChallenge {
  readonly challengeId = 10;
  readonly challengeName = "Cruel";

  onFighterDied(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.team?.side !== 1) {
      return;
    }
    const aliveMonsters = f.teams[1]
      .fighters()
      .filter((m) => !m.dead && m.id !== fighter.id);
    for (const m of aliveMonsters) {
      if (
        m.monsterLevel &&
        fighter.monsterLevel &&
        m.monsterLevel < fighter.monsterLevel
      ) {
        this.fail(f, null);
        return;
      }
    }
  }
}
