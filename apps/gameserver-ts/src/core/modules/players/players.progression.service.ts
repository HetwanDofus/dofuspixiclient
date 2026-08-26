import {
  MAX_LEVEL,
  xpForNextLevel,
} from "@modules/players/players.progression.constants";
import { PlayersRepository } from "@modules/players/players.repository";
import { SpellsService } from "@modules/spells/spells.service";
import { Injectable, Logger } from "@nestjs/common";

/** What one call to `applyExperience` changed, for the caller to report. */
export interface ProgressionResult {
  /** Level before the call. */
  previousLevel: number;
  /** Level after it — equal to `previousLevel` when nothing was gained. */
  level: number;
  /** Spell ids learned as a result. Possibly empty on a level-up. */
  learnedSpellIds: number[];
}

/**
 * Turns banked experience into levels, and levels into spells.
 *
 * Two things used to be missing here and both are the same shape of bug —
 * a state change with no consequence:
 *
 *  - `FightEndService` levelled a character *once* per fight, with an
 *    `if`, so a kill worth three levels granted one and silently dropped
 *    the other two (the experience stayed banked, so the next fight
 *    granted another single level).
 *  - nothing ever inserted into `player_spells`, so a character kept its
 *    three starter spells at every level; a level-101 Féca was missing
 *    seventeen spells it should have learned on the way up.
 *
 * This is the one funnel for "experience changed, make the character
 * match it". Fight rewards are the only source today; quests, jobs and
 * dungeon bonuses land here too rather than each re-deriving the curve.
 */
@Injectable()
export class PlayersProgressionService {
  private readonly logger = new Logger(PlayersProgressionService.name);

  constructor(
    private readonly players: PlayersRepository,
    private readonly spells: SpellsService
  ) {}

  /**
   * Grants every level the character's banked experience covers, then
   * every spell those levels unlock.
   *
   * Returns `undefined` only when the character no longer exists.
   */
  async applyExperience(
    playerId: string
  ): Promise<ProgressionResult | undefined> {
    const player = await this.players.findById(playerId);

    if (!player) {
      return undefined;
    }

    const previousLevel = player.level;
    const level = levelForExperience(previousLevel, Number(player.experience));

    if (level === previousLevel) {
      // The common case by far — one fight in a hundred crosses a
      // threshold. Nothing to grant, and no spell query either: the
      // catch-up for a level gained some other way is `syncSpellBook`,
      // on login, not two queries on every fight anyone finishes.
      return { previousLevel, level, learnedSpellIds: [] };
    }

    await this.players.grantLevels(playerId, level - previousLevel);

    this.logger.log(
      `player ${playerId} leveled up ${previousLevel} -> ${level}` +
        (level - previousLevel > 1 ? ` (${level - previousLevel} levels)` : "")
    );

    const learnedSpellIds = await this.spells.learnClassSpells(
      playerId,
      player.class,
      level
    );

    return { previousLevel, level, learnedSpellIds };
  }

  /**
   * Gives a character every spell its class knows at its current level,
   * whatever it is missing and however it got there.
   *
   * The repair path, called once per session at login. Levels in this
   * project are routinely set by hand in SQL — that is how the dev
   * character reached 101 — and a level that never went through
   * `applyExperience` unlocks nothing on its own. Costs one indexed
   * select of at most 21 rows plus one conflict-swallowing insert, and
   * is a no-op on the wire when the book is already complete.
   */
  async syncSpellBook(playerId: string): Promise<number[]> {
    const player = await this.players.findById(playerId);

    if (!player) {
      return [];
    }

    return this.spells.learnClassSpells(playerId, player.class, player.level);
  }
}

/**
 * The highest level `experience` pays for, starting from `fromLevel`.
 *
 * A loop rather than a closed form because the curve is meant to be
 * replaced by the retail 1.29 table, which has no closed form. It only
 * ever climbs: banked experience is never taken back, so a character
 * whose level was raised by hand past its experience keeps that level.
 */
export function levelForExperience(
  fromLevel: number,
  experience: number
): number {
  let level = fromLevel;

  while (level < MAX_LEVEL && experience >= xpForNextLevel(level)) {
    level++;
  }

  return level;
}
