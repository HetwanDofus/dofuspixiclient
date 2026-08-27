/**
 * Set a character's level — the whole level, not just the number.
 *
 *   DATABASE_URL=... bun run scripts/set-level.ts <character> [level]
 *   bun run scripts/set-level.ts Dev 101
 *   bun run scripts/set-level.ts Dev          # repair at the current level
 *
 * A level in this game is four things, and `UPDATE players SET level`
 * is one of them:
 *
 *   - the number;
 *   - the experience that justifies it, so the panel's bar is not stuck
 *     at "101 → 102" showing a full bar, and so a later fight does not
 *     immediately re-level the character;
 *   - the capital it earned — 5 characteristic points and 1 spell point
 *     per level;
 *   - the spells the class unlocks along the way.
 *
 * Every hand-levelled character in this project has been missing at
 * least one of the four. The dev character was set to 101 with its 500
 * characteristic points credited, its 100 spell points forgotten (it had
 * 2), and a spell book frozen on the three starters.
 *
 * The two capital balances are *recomputed*, not incremented — earned
 * minus what the current characteristics and spell levels cost to buy —
 * so running this twice, or on a character you have already played,
 * changes nothing the second time. See `players.capital.ts` for the
 * assumption that rests on.
 *
 * Spells are added, never removed: a character that legitimately knows
 * something this class list does not is left alone.
 */
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { BoostableStat } from "../src/core/modules/stats/boost-cost.ts";
import type { DB } from "../src/core/shared/db/schema.ts";
import { expectedCapital } from "../src/core/modules/players/players.capital.ts";
import { xpForLevel } from "../src/core/modules/players/players.progression.constants.ts";

const characterName = process.argv[2];
const requestedLevel = process.argv[3]
  ? Number.parseInt(process.argv[3], 10)
  : undefined;

if (!characterName) {
  console.error(
    "usage: bun run scripts/set-level.ts <character> [level]\n" +
      "  omit the level to repair the character at the level it already has"
  );
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

const player = await db
  .selectFrom("players")
  .select([
    "id",
    "name",
    "class",
    "level",
    "experience",
    "statsPoints",
    "spellPoints",
  ])
  .where("name", "=", characterName)
  .where("deletedAt", "is", null)
  .executeTakeFirst();

if (!player) {
  console.error(`no character named ${characterName}`);
  await db.destroy();
  process.exit(1);
}

const level = requestedLevel ?? player.level;

if (!Number.isFinite(level) || level < 1 || level > 200) {
  console.error(`level must be between 1 and 200, got ${process.argv[3]}`);
  await db.destroy();
  process.exit(1);
}

const stats = await db
  .selectFrom("playerStats")
  .selectAll()
  .where("playerId", "=", player.id)
  .executeTakeFirst();

if (!stats) {
  console.error(
    `${player.name} has no player_stats row — it cannot even be selected ` +
      `at character screen. Run the dev seed first.`
  );
  await db.destroy();
  process.exit(1);
}

/**
 * The class's spells up to the new level, granted before the capital is
 * computed: a spell the character is about to learn arrives at level 1
 * and costs nothing, but one it already owns at level 4 must be counted
 * as spent.
 */
const classSpells = await db
  .selectFrom("classSpells")
  .select(["spellId", "position"])
  .where("classId", "=", player.class)
  .where("learnLevel", "<=", level)
  .orderBy("position")
  .execute();

if (classSpells.length === 0) {
  console.warn(
    `no class_spells rows for class ${player.class} — run \`just db-migrate\`. ` +
      `Levelling anyway; the spell book will stay as it is.`
  );
} else {
  const added = await db
    .insertInto("playerSpells")
    .values(
      classSpells.map((spell: { spellId: number; position: number }) => ({
        playerId: player.id,
        spellId: spell.spellId,
        level: 1,
        position: spell.position,
      }))
    )
    .onConflict((oc) => oc.columns(["playerId", "spellId"]).doNothing())
    .returning("spellId")
    .execute();

  console.log(
    `spells: ${classSpells.length} known at level ${level} ` +
      `(${added.length} added, ${classSpells.length - added.length} already there)`
  );
}

const spellLevels = (
  await db
    .selectFrom("playerSpells")
    .select("level")
    .where("playerId", "=", player.id)
    .execute()
).map((row: { level: number }) => row.level);

const capital = expectedCapital({
  classId: player.class,
  level,
  stats: {
    strength: stats.strength,
    vitality: stats.vitality,
    wisdom: stats.wisdom,
    chance: stats.chance,
    agility: stats.agility,
    intelligence: stats.intelligence,
  } satisfies Record<BoostableStat, number>,
  spellLevels,
});

if (capital.statsPoints < 0 || capital.spellPoints < 0) {
  console.warn(
    `${player.name} has spent more capital than level ${level} earns ` +
      `(carac ${capital.statsSpent}/${(level - 1) * 5}, ` +
      `sorts ${capital.spellsSpent}/${level - 1}). Clamping to 0 — lower the ` +
      `level and you keep what you bought, you just cannot buy more.`
  );
}

/**
 * Only ever raised: the experience a character banked is its own, and a
 * level set *below* what it earned must not silently delete progress.
 */
const experience = Math.max(Number(player.experience), xpForLevel(level));

await db
  .updateTable("players")
  .set({
    level,
    experience: String(experience),
    statsPoints: Math.max(0, capital.statsPoints),
    spellPoints: Math.max(0, capital.spellPoints),
  })
  .where("id", "=", player.id)
  .execute();

console.log(
  `${player.name}: level ${player.level} -> ${level}, ` +
    `xp ${player.experience} -> ${experience}, ` +
    `capital carac ${player.statsPoints} -> ${Math.max(0, capital.statsPoints)} ` +
    `(${capital.statsSpent} spent), ` +
    `capital sorts ${player.spellPoints} -> ${Math.max(0, capital.spellPoints)} ` +
    `(${capital.spellsSpent} spent)`
);
console.log("reconnect the character for the client to see it");

await db.destroy();
