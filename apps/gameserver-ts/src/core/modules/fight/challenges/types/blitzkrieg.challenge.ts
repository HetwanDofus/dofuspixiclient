import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(38)
export class BlitzkriegChallenge extends FightChallenge {
  readonly challengeId = 38;
  readonly challengeName = "Blitzkrieg";
  private damagedEnemies = new Set<number>();

  onFighterAttacked(_f: Fight, caster: Fighter, target: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (caster.team?.side !== 0 || target.team?.side !== 1) {
      return;
    }
    this.damagedEnemies.add(target.id);
  }

  onTurnStart(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.team?.side === 1 && this.damagedEnemies.has(fighter.id)) {
      this.fail(f, null);
    }
  }

  onFighterDied(_f: Fight, fighter: Fighter): void {
    this.damagedEnemies.delete(fighter.id);
  }
}
