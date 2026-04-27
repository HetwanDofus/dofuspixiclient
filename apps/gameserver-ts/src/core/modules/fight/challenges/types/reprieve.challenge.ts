import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(4)
export class ReprieveChallenge extends FightChallenge {
  readonly challengeId = 4;
  readonly challengeName = "Reprieve";

  private targetFighter: Fighter | null = null;

  onFightCreated(f: Fight): void {
    if (!this.alive) {
      return;
    }
    const enemies = f.fighters().filter((ftr) => ftr.team?.side === 1);
    if (enemies.length > 0) {
      this.targetFighter =
        enemies[Math.floor(Math.random() * enemies.length)] ?? null;
    }
  }

  onFighterDied(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter === this.targetFighter) {
      const enemiesAlive = f
        .fighters()
        .filter((ftr) => ftr.team?.side === 1 && ftr.lp > 0 && ftr !== fighter);
      if (enemiesAlive.length > 0) {
        this.fail(f, null);
      }
    }
  }
}
