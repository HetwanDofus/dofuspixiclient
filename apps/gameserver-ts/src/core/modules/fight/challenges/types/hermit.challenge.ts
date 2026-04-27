import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { distance } from "@modules/fight/map/fight.area";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(39)
export class HermitChallenge extends FightChallenge {
  readonly challengeId = 39;
  readonly challengeName = "Hermit";

  onTurnEnd(f: Fight, fighter: Fighter): void {
    if (!this.alive || fighter.team?.side !== 0) {
      return;
    }
    const allies = f
      .fighters()
      .filter((a) => a.team?.side === 0 && a.id !== fighter.id && !a.dead);
    const isAdjacent = allies.some(
      (a) => distance(f.fightMap, fighter.cell, a.cell) === 1
    );
    if (isAdjacent) {
      this.fail(f, fighter);
    }
  }
}
