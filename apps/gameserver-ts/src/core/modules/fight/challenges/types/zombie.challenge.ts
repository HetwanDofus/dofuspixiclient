import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(1)
export class ZombieChallenge extends FightChallenge {
  readonly challengeId = 1;
  readonly challengeName = "Zombie";

  private startMpPerFighter = new Map<Fighter, number>();

  onTurnStart(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    this.startMpPerFighter.set(fighter, fighter.ap);
  }

  onPlayerMove(
    _f: Fight,
    fighter: Fighter,
    _failed: boolean,
    mpUsed: number
  ): void {
    if (!this.alive) {
      return;
    }
    if (mpUsed > 1) {
      this.fail(_f, fighter);
    }
  }

  onTurnEnd(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    const startMp = this.startMpPerFighter.get(fighter);
    if (startMp === fighter.ap) {
      this.fail(_f, fighter);
    }
  }
}
