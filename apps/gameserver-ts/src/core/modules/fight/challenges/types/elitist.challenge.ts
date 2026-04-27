import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import { Challenge } from "@modules/fight/challenges/fight.challenge.decorator";
import { Injectable } from "@nestjs/common";

@Injectable()
@Challenge(32)
export class ElitistChallenge extends FightChallenge {
  readonly challengeId = 32;
  readonly challengeName = "Elitist";

  onFightCreated(f: Fight): void {
    const enemies = f
      .fighters()
      .filter((ftr) => ftr.team?.side === 1 && !ftr.isInvocation());
    if (enemies.length > 0) {
      const idx = Math.floor(Math.random() * enemies.length);
      this.target = enemies[idx] ?? null;
    }
  }

  onFighterAttacked(f: Fight, caster: Fighter, attackTarget: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (caster.team?.side !== 0 || attackTarget.team?.side !== 1) {
      return;
    }
    if (this.target && attackTarget.id !== this.target.id) {
      this.fail(f, caster);
    }
  }

  onFighterDied(_f: Fight, fighter: Fighter): void {
    if (!this.alive) {
      return;
    }
    if (this.target && fighter.id === this.target.id) {
      this.succeed();
    }
  }
}
