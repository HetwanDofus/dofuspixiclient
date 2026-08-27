import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";

/**
 * `player_spells.position` for a spell that is not in the hotbar — the
 * column default since 0001.
 */
export const UNSLOTTED_POSITION = -1;

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

  /**
   * Every level row of one spell, ordered 1..6 — what the spell book's
   * detail panel paginates through. Separate from `findLevel` because
   * the panel needs all levels at once (the player can preview a level
   * they have not bought yet).
   */
  findAllLevels(spellId: number) {
    return this.txHost.tx
      .selectFrom("spellLevels")
      .selectAll()
      .where("spellId", "=", spellId)
      .orderBy("level", "asc")
      .execute();
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
      .innerJoin("spellTemplates", "spellTemplates.id", "playerSpells.spellId")
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

  findPlayerSpell(playerId: string, spellId: number) {
    return this.txHost.tx
      .selectFrom("playerSpells")
      .selectAll()
      .where("playerId", "=", playerId)
      .where("spellId", "=", spellId)
      .executeTakeFirst();
  }

  /**
   * Bumps one player spell to `newLevel`. Returns the number of rows
   * touched so the caller can treat a concurrent upgrade (same spell,
   * two frames in flight) as a no-op rather than double-charging.
   */
  async setPlayerSpellLevel(
    playerId: string,
    spellId: number,
    newLevel: number
  ): Promise<number> {
    const res = await this.txHost.tx
      .updateTable("playerSpells")
      .set({ level: newLevel })
      .where("playerId", "=", playerId)
      .where("spellId", "=", spellId)
      .where("level", "<", newLevel)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  /**
   * The spells `classId` owns at `playerLevel` — i.e. everything it has
   * learned so far, starters included. Ordered by learn level so a
   * caller granting several levels at once inserts them in the order
   * they were unlocked.
   */
  findClassSpells(classId: number, playerLevel: number) {
    return this.txHost.tx
      .selectFrom("classSpells")
      .select(["spellId", "position", "learnLevel"])
      .where("classId", "=", classId)
      .where("learnLevel", "<=", playerLevel)
      .orderBy("learnLevel", "asc")
      .execute();
  }

  /**
   * Adds spells to a spell book, ignoring the ones already in it, and
   * returns the ids that were actually inserted.
   *
   * `do nothing` on the (player, spell) key is what makes learning
   * idempotent and safe to re-run: a spell the player already upgraded
   * keeps its level and its chosen bar slot, and two level-ups racing
   * over the same threshold cannot double-insert.
   */
  async addPlayerSpells(
    playerId: string,
    spells: readonly { spellId: number; position: number }[]
  ): Promise<number[]> {
    if (spells.length === 0) {
      return [];
    }

    const inserted = await this.txHost.tx
      .insertInto("playerSpells")
      .values(
        spells.map((spell) => ({
          playerId,
          spellId: spell.spellId,
          level: 1,
          position: spell.position,
        }))
      )
      .onConflict((oc) => oc.columns(["playerId", "spellId"]).doNothing())
      .returning("spellId")
      .execute();

    return inserted.map((row) => row.spellId);
  }

  /** Whichever spell currently occupies a hotbar slot, if any. */
  findPlayerSpellAtPosition(playerId: string, position: number) {
    return this.txHost.tx
      .selectFrom("playerSpells")
      .selectAll()
      .where("playerId", "=", playerId)
      .where("position", "=", position)
      .executeTakeFirst();
  }

  /**
   * Put a spell in a hotbar slot, or take it out of the bar with
   * `UNSLOTTED_POSITION`. `player_spells.position` defaults to that
   * sentinel (0001), so "out of the bar" and "never placed" are the
   * same state — which is what the client's SpellList reader assumes.
   */
  async setPlayerSpellPosition(
    playerId: string,
    spellId: number,
    position: number
  ): Promise<void> {
    await this.txHost.tx
      .updateTable("playerSpells")
      .set({ position })
      .where("playerId", "=", playerId)
      .where("spellId", "=", spellId)
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
