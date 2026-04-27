import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { distance } from "@modules/fight/map/fight.area";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(36)
export class ImpertinenceChallenge extends FightChallenge {
  readonly challengeId = 36;
  readonly challengeName = "Impertinence";

  onTurnEnd(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    const enemies = _f
      .fighters()
      .filter((ftr) => ftr.team?.side !== fighter.team?.side && ftr.lp > 0);
    const isAdjacent = enemies.some(
      (enemy) => distance(_f.fightMap, fighter.cell, enemy.cell) === 1
    );
    if (!isAdjacent) {
      this.fail(_f, fighter);
    }
  }
}
