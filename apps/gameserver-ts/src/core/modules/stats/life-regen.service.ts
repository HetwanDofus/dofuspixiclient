import type { PlayerRow } from "@shared/db/schema";
import { PlayersRepository } from "@modules/players/players.repository";
import { resolveLife } from "@modules/stats/life-regen";
import { Injectable } from "@nestjs/common";

/**
 * The one place a character's life is read.
 *
 * Every caller that needs current life goes through here rather than
 * reading `player.life` directly, because the stored value is only ever
 * a lower bound: it is exact as of `life_updated_at` and owed whatever
 * has accrued since. Reading the column raw is how a character shows
 * yesterday's life.
 *
 * Persisting on read is deliberate. The alternative — resolving for
 * display and writing only occasionally — means the value shown and the
 * value stored disagree, and the first thing that reads the column
 * without resolving (a fight starting, a script, a support query)
 * silently uses the stale one.
 */
@Injectable()
export class LifeRegenService {
  constructor(private readonly players: PlayersRepository) {}

  /**
   * Resolve `player.life` forward to now, persisting it when it moved.
   *
   * `maxLife` must come from `maxLifePoints(level, totalVitality)` with
   * equipment folded in — there is no maximum-life column, and a cap
   * computed any other way will drift away from the one the character
   * sheet shows the moment a vitality item is equipped.
   */
  async resolve(player: PlayerRow, maxLife: number): Promise<number> {
    const resolved = resolveLife({
      life: player.life,
      maxLife,
      lifeUpdatedAt: player.lifeUpdatedAt,
    });

    if (resolved.changed) {
      await this.players.setLife(
        String(player.id),
        resolved.life,
        resolved.lifeUpdatedAt
      );
    }

    return resolved.life;
  }
}
