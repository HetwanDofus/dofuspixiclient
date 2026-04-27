import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import type {
  FighterReward,
  FightModule,
} from "@modules/fight/engine/fight.module-hooks.types";

export abstract class FightChallenge implements FightModule {
  abstract readonly challengeId: number;
  abstract readonly challengeName: string;

  xpBonusPct = 0;
  dropBonusPct = 0;
  alive = true;
  won = false;
  target: Fighter | null = null;

  get name(): string {
    return `challenge:${this.challengeId}`;
  }

  fail(_fight: Fight, _fighter: Fighter | null): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.won = false;
  }

  succeed(): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.won = true;
  }

  onFightCreated?(f: Fight): void;
  onFighterJoined?(f: Fight, fighter: Fighter): void;
  onTurnStart?(f: Fight, fighter: Fighter): void;
  onTurnEnd?(f: Fight, fighter: Fighter): void;
  onCast?(f: Fight, ctx: CastContext): boolean;
  onCastApplied?(f: Fight, ctx: CastContext): void;
  onFighterDied?(f: Fight, fighter: Fighter): void;
  onFightEnd?(f: Fight, winner: number, rewards: FighterReward[]): void;
  onPlayerMove?(
    f: Fight,
    fighter: Fighter,
    failed: boolean,
    mpUsed: number
  ): void;
  onPlayerAction?(f: Fight, fighter: Fighter, actionId: number): void;
  onCloseCombat?(f: Fight, fighter: Fighter): void;
  onFighterAttacked?(
    f: Fight,
    caster: Fighter,
    target: Fighter,
    ctx: CastContext
  ): void;
  onFightersAttacked?(
    f: Fight,
    caster: Fighter,
    targets: Fighter[],
    effectId: number,
    spellId: number,
    trap: boolean
  ): void;
}
