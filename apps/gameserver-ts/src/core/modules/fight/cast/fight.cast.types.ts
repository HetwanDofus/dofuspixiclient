import type { SpellLevel } from "@modules/fight/cast/fight.spell";
import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";

export interface SpellPort {
  spellLevel(spellId: number, level: number): Promise<SpellLevel | undefined>;
  playerHasSpell?(playerId: string, spellId: number): Promise<boolean>;
}

export interface FightRegistry {
  bySession(sessionId: string): Fight | undefined;
}

export class CastError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface CastResult {
  fight: Fight;
  caster: Fighter;
  spellId: number;
  level: number;
  targetCell: number;
  critical: boolean;
  failure: boolean;
  affectedCells: number[];
}
