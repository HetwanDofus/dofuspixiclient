import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { distance } from "@modules/fight/map/fight.area";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(40)
export class LimpwristChallenge extends FightChallenge {
  readonly challengeId = 40;
  readonly challengeName = "Limpwrist";

  onTurnEnd(f: Fight, fighter: Fighter): void {
    if (!this.alive || fighter.team?.side !== 0) {
      return;
    }
    const enemies = f
      .fighters()
      .filter((e) => e.team?.side !== fighter.team?.side && !e.dead);
    const isAdjacent = enemies.some(
      (e) => distance(f.fightMap, fighter.cell, e.cell) === 1
    );
    if (isAdjacent) {
      this.fail(f, fighter);
    }
  }
}
