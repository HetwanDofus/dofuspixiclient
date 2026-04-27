import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

@Injectable()
export class SpellsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  findLevel(spellId: number, level: number) {
    return this.txHost.tx
      .selectFrom("spellLevels")
      .selectAll()
      .where("spellId", "=", spellId)
      .where("level", "=", level)
      .executeTakeFirst();
  }

  findTemplate(spellId: number) {
    return this.txHost.tx
      .selectFrom("spellTemplates")
      .selectAll()
      .where("id", "=", spellId)
      .executeTakeFirst();
  }

  findByPlayer(playerId: string) {
    return this.txHost.tx
      .selectFrom("playerSpells")
      .selectAll()
      .where("playerId", "=", playerId)
      .execute();
  }

  /**
   * Player spells + their level rows in a single round-trip.
   *
   * Joins `player_spells` to `spell_levels` on the composite `(spell_id,
   * level)` key. Replaces the N+1 pattern that iterated every player spell
   * and ran a separate query for each level — visible as multi-second
   * `enter-game` hitches on high-level characters with full spell books.
   */
  findPlayerSpellsWithLevels(playerId: string) {
    return this.txHost.tx
      .selectFrom("playerSpells")
      .innerJoin("spellLevels", (join) =>
        join
          .onRef("spellLevels.spellId", "=", "playerSpells.spellId")
          .onRef("spellLevels.level", "=", "playerSpells.level")
      )
      .innerJoin(
        "spellTemplates",
        "spellTemplates.id",
        "playerSpells.spellId"
      )
      .select([
        "playerSpells.spellId",
        "playerSpells.level",
        "playerSpells.position",
        "spellLevels.apCost",
        "spellLevels.rangeMin",
        "spellLevels.rangeMax",
        "spellLevels.lineOfSight",
        "spellLevels.modifiableRange",
        "spellLevels.emptyCell",
        "spellLevels.lineOnly",
        "spellLevels.castPerTurn",
        "spellLevels.castPerTarget",
        "spellLevels.cooldown",
        "spellLevels.criticalRate",
        "spellLevels.failureRate",
        "spellLevels.effects",
        // Fallback display name when the lang bundle has no entry for this
        // spell (e.g. new spells without translations). The localized name
        // lives in the lang bundle and is merged into the SpellList payload
        // by the service.
        "spellTemplates.name as templateName",
      ])
      .where("playerSpells.playerId", "=", playerId)
      .execute();
  }

  async playerHasSpell(playerId: string, spellId: number): Promise<boolean> {
    const row = await this.txHost.tx
      .selectFrom("playerSpells")
      .select("spellId")
      .where("playerId", "=", playerId)
      .where("spellId", "=", spellId)
      .executeTakeFirst();
    return row !== undefined;
  }
}
