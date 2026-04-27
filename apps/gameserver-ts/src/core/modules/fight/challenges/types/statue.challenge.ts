import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(2)
export class StatueChallenge extends FightChallenge {
  readonly challengeId = 2;
  readonly challengeName = "Statue";

  private cellPerFighter = new Map<Fighter, number>();

  onTurnStart(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    this.cellPerFighter.set(fighter, fighter.cell);
  }

  onTurnEnd(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    const startCell = this.cellPerFighter.get(fighter);
    if (startCell !== fighter.cell) {
      this.fail(_f, fighter);
    }
  }
}
