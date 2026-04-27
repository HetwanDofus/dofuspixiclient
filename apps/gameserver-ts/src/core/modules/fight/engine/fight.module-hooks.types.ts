import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import type { TeamSide } from "@modules/fight/fight.types";

export interface FighterReward {
  fighterId: number;
  team: TeamSide;
  dead: boolean;
  xp: number;
  kamas: number;
  items: Array<{ templateId: number; quantity: number }>;
}

export interface FightModule {
  name: string;
  onFightCreated?(f: Fight): void;
  onFighterJoined?(f: Fight, fighter: Fighter): void;
  onTurnStart?(f: Fight, fighter: Fighter): void;
  onTurnEnd?(f: Fight, fighter: Fighter): void;
  onCast?(f: Fight, ctx: CastContext): boolean;
  onCastApplied?(f: Fight, ctx: CastContext): void;
  onFighterDied?(f: Fight, fighter: Fighter): void;
  onFightEnd?(f: Fight, winner: TeamSide, rewards: FighterReward[]): void;
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
