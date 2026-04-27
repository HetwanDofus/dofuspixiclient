import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { CastContext } from "@modules/fight/effects/fight.buff.types";
import type {
  FighterReward,
  FightModule,
} from "@modules/fight/engine/fight.module-hooks.types";
import type { TeamSide } from "@modules/fight/fight.types";

export type {
  FighterReward,
  FightModule,
} from "@modules/fight/engine/fight.module-hooks.types";

export class ModuleList {
  private items: FightModule[] = [];

  add(m: FightModule): void {
    this.items.push(m);
  }

  all(): FightModule[] {
    return [...this.items];
  }

  get(name: string): FightModule | undefined {
    return this.items.find((m) => m.name === name);
  }

  fireCreated(f: Fight): void {
    for (const m of this.items) {
      m.onFightCreated?.(f);
    }
  }

  fireJoined(f: Fight, fighter: Fighter): void {
    for (const m of this.items) {
      m.onFighterJoined?.(f, fighter);
    }
  }

  fireTurnStart(f: Fight, fighter: Fighter): void {
    for (const m of this.items) {
      m.onTurnStart?.(f, fighter);
    }
  }

  fireTurnEnd(f: Fight, fighter: Fighter): void {
    for (const m of this.items) {
      m.onTurnEnd?.(f, fighter);
    }
  }

  fireCastPre(f: Fight, ctx: CastContext): boolean {
    for (const m of this.items) {
      if (m.onCast && !m.onCast(f, ctx)) {
        return false;
      }
    }
    return true;
  }

  fireCastApplied(f: Fight, ctx: CastContext): void {
    for (const m of this.items) {
      m.onCastApplied?.(f, ctx);
    }
  }

  fireFighterDied(f: Fight, fighter: Fighter): void {
    for (const m of this.items) {
      m.onFighterDied?.(f, fighter);
    }
  }

  fireEnd(f: Fight, winner: TeamSide, rewards: FighterReward[]): void {
    for (const m of this.items) {
      m.onFightEnd?.(f, winner, rewards);
    }
  }

  firePlayerMove(
    f: Fight,
    fighter: Fighter,
    failed: boolean,
    mpUsed: number
  ): void {
    for (const m of this.items) {
      m.onPlayerMove?.(f, fighter, failed, mpUsed);
    }
  }

  firePlayerAction(f: Fight, fighter: Fighter, actionId: number): void {
    for (const m of this.items) {
      m.onPlayerAction?.(f, fighter, actionId);
    }
  }

  fireCloseCombat(f: Fight, fighter: Fighter): void {
    for (const m of this.items) {
      m.onCloseCombat?.(f, fighter);
    }
  }

  fireFighterAttacked(
    f: Fight,
    caster: Fighter,
    target: Fighter,
    ctx: CastContext
  ): void {
    for (const m of this.items) {
      m.onFighterAttacked?.(f, caster, target, ctx);
    }
  }

  fireFightersAttacked(
    f: Fight,
    caster: Fighter,
    targets: Fighter[],
    effectId: number,
    spellId: number,
    trap: boolean
  ): void {
    for (const m of this.items) {
      m.onFightersAttacked?.(f, caster, targets, effectId, spellId, trap);
    }
  }
}
