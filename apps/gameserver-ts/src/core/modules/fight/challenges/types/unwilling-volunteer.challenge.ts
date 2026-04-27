import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(3)
export class UnwillingVolunteerChallenge extends FightChallenge {
  readonly challengeId = 3;
  readonly challengeName = "Unwilling Volunteer";

  onFightCreated(f: Fight): void {
    const enemies = f
      .fighters()
      .filter((ftr) => ftr.team?.side === 1 && !ftr.isInvocation());
    if (enemies.length > 0) {
      const idx = Math.floor(Math.random() * enemies.length);
      this.target = enemies[idx] ?? null;
    }
  }

  onFighterDied(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.team?.side !== 1 || fighter.isInvocation()) {
      return;
    }
    if (this.target && fighter.id === this.target.id) {
      this.succeed();
    } else {
      this.fail(f, null);
    }
  }
}
