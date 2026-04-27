import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("jobs")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "varchar(64)")
    .addColumn("max_level", "smallint", (col) => col.defaultTo(100))
    .execute();

  await db.schema
    .createTable("player_jobs")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("job_id", "integer", (col) =>
      col.notNull().references("jobs.id").onDelete("cascade")
    )
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("experience", "bigint", (col) => col.defaultTo(0))
    .addPrimaryKeyConstraint("pk_player_jobs", ["player_id", "job_id"])
    .execute();

  await db.schema
    .createTable("job_skills")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("job_id", "integer", (col) =>
      col.notNull().references("jobs.id").onDelete("cascade")
    )
    .addColumn("name", "varchar(64)")
    .addColumn("interactive_id", "integer")
    .addColumn("tool_item_id", "integer")
    .addColumn("min_level", "smallint", (col) => col.defaultTo(1))
    .addColumn("action", "smallint")
    .execute();

  await sql`CREATE INDEX idx_job_skills_job_id ON job_skills(job_id)`.execute(
    db
  );

  await db.schema
    .createTable("job_gatherable_cells")
    .addColumn("map_id", "integer", (col) => col.notNull())
    .addColumn("cell_id", "integer", (col) => col.notNull())
    .addColumn("resource_item_id", "integer")
    .addColumn("skill_id", "integer", (col) =>
      col.notNull().references("job_skills.id").onDelete("cascade")
    )
    .addColumn("respawn_seconds", "integer", (col) => col.defaultTo(60))
    .addPrimaryKeyConstraint("pk_job_gatherable_cells", ["map_id", "cell_id"])
    .execute();

  await db.schema
    .createTable("quests")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "varchar(128)")
    .addColumn("category", "smallint", (col) => col.defaultTo(0))
    .addColumn("min_level", "smallint", (col) => col.defaultTo(1))
    .addColumn("repeatable", "boolean", (col) => col.defaultTo(false))
    .execute();

  await db.schema
    .createTable("quest_steps")
    .addColumn("quest_id", "integer", (col) =>
      col.notNull().references("quests.id").onDelete("cascade")
    )
    .addColumn("step_id", "smallint", (col) => col.notNull())
    .addColumn("name", "varchar(128)")
    .addColumn("objectives", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .addColumn("rewards", "jsonb", (col) => col.defaultTo(sql`'{}'`))
    .addPrimaryKeyConstraint("pk_quest_steps", ["quest_id", "step_id"])
    .execute();

  await db.schema
    .createTable("player_quests")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("quest_id", "integer", (col) =>
      col.notNull().references("quests.id").onDelete("cascade")
    )
    .addColumn("current_step", "smallint", (col) => col.defaultTo(0))
    .addColumn("completed_objectives", "jsonb", (col) =>
      col.defaultTo(sql`'{}'`)
    )
    .addColumn("completed", "boolean", (col) => col.defaultTo(false))
    .addColumn("started_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("completed_at", "timestamptz")
    .addPrimaryKeyConstraint("pk_player_quests", ["player_id", "quest_id"])
    .execute();

  await db.schema
    .createTable("treasure_hunts")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("template_id", "integer")
    .addColumn("current_step", "smallint", (col) => col.defaultTo(0))
    .addColumn("clues", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .addColumn("reward_map_id", "integer")
    .addColumn("reward_cell_id", "integer")
    .addColumn("started_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("completed_at", "timestamptz")
    .execute();

  await sql`CREATE INDEX idx_treasure_hunts_player_id ON treasure_hunts(player_id) WHERE completed_at IS NULL`.execute(
    db
  );

  await db.schema
    .createTable("ttg_cards")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", "varchar(64)")
    .addColumn("element", "smallint")
    .addColumn("rarity", "smallint", (col) => col.defaultTo(0))
    .addColumn("stats", "jsonb", (col) => col.defaultTo(sql`'{}'`))
    .execute();

  await db.schema
    .createTable("player_ttg_collection")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("card_id", "integer", (col) =>
      col.notNull().references("ttg_cards.id").onDelete("cascade")
    )
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("count", "integer", (col) => col.defaultTo(1))
    .addPrimaryKeyConstraint("pk_player_ttg_collection", [
      "player_id",
      "card_id",
    ])
    .execute();

  await db.schema
    .createTable("ttg_matches")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("player1_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("player2_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("winner_id", "bigint", (col) =>
      col.references("players.id").onDelete("set null")
    )
    .addColumn("state", "smallint", (col) => col.defaultTo(0))
    .addColumn("snapshot", "jsonb", (col) => col.defaultTo(sql`'{}'`))
    .addColumn("started_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("ended_at", "timestamptz")
    .execute();

  await sql`CREATE INDEX idx_ttg_matches_state ON ttg_matches(state) WHERE state < 2`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("ttg_matches").execute();
  await db.schema.dropTable("player_ttg_collection").execute();
  await db.schema.dropTable("ttg_cards").execute();
  await db.schema.dropTable("treasure_hunts").execute();
  await db.schema.dropTable("player_quests").execute();
  await db.schema.dropTable("quest_steps").execute();
  await db.schema.dropTable("quests").execute();
  await db.schema.dropTable("job_gatherable_cells").execute();
  await db.schema.dropTable("job_skills").execute();
  await db.schema.dropTable("player_jobs").execute();
  await db.schema.dropTable("jobs").execute();
}
