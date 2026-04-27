import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(35)
export class ContractKillerChallenge extends FightChallenge {
  readonly challengeId = 35;
  readonly challengeName = "Contract Killer";

  onFightCreated(f: Fight): void {
    this.pickNextTarget(f);
  }

  onFighterDied(f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (fighter.team?.side !== 1 || fighter.isInvocation()) {
      return;
    }
    if (this.target && fighter.id !== this.target.id) {
      this.fail(f, null);
    } else {
      this.pickNextTarget(f);
    }
  }

  private pickNextTarget(f: Fight): void {
    const alive = f
      .fighters()
      .filter(
        (ftr) => ftr.team?.side === 1 && !ftr.dead && !ftr.isInvocation()
      );
    if (alive.length === 0) {
      return;
    }
    const idx = Math.floor(Math.random() * alive.length);
    this.target = alive[idx] ?? null;
  }
}
