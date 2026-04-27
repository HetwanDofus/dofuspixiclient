import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(25)
export class ManiacChallenge extends FightChallenge {
  readonly challengeId = 25;
  readonly challengeName = "Maniac";
  private killOrder: number[] = [];

  onFightCreated(f: Fight): void {
    this.killOrder = f.teams[1]
      .fighters()
      .sort((a, b) => (b.monsterLevel ?? 0) - (a.monsterLevel ?? 0))
      .map((m) => m.id);
  }

  onFighterDied(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.team?.side !== 1) {
      return;
    }
    const idx = this.killOrder.indexOf(fighter.id);
    for (let i = 0; i < idx; i++) {
      const m = f.fighters().find((ff) => ff.id === this.killOrder[i]);
      if (m && !m.dead) {
        this.fail(f, null);
        return;
      }
    }
  }
}
