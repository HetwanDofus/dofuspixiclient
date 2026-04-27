import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { distance } from "@modules/fight/map/fight.area";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(37)
export class TightChallenge extends FightChallenge {
  readonly challengeId = 37;
  readonly challengeName = "Tight";

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
    if (!isAdjacent && allies.length > 0) {
      this.fail(f, fighter);
    }
  }
}
