import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  // accounts
  await db.schema
    .createTable("accounts")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("username", sql`VARCHAR(32)`, (col) => col.notNull().unique())
    .addColumn("pwd_hash", sql`VARCHAR(120)`)
    .addColumn("pseudo", sql`VARCHAR(32)`)
    .addColumn("community", "smallint", (col) => col.defaultTo(0))
    .addColumn("is_admin", "boolean", (col) => col.defaultTo(false))
    .addColumn("is_banned", "boolean", (col) => col.defaultTo(false))
    .addColumn("question", sql`VARCHAR(200)`, (col) => col.defaultTo(""))
    .addColumn("answer", sql`VARCHAR(200)`, (col) => col.defaultTo(""))
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("last_login_at", "timestamptz")
    .addColumn("last_login_ip", sql`INET`)
    .execute();

  // game_servers
  await db.schema
    .createTable("game_servers")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(64)`)
    .addColumn("address", sql`VARCHAR(128)`)
    .addColumn("port", "integer")
    .addColumn("state", "smallint", (col) => col.defaultTo(0))
    .addColumn("community", "smallint", (col) => col.defaultTo(0))
    .addColumn("max_players", "integer", (col) => col.defaultTo(2000))
    .addColumn("online_players", "integer", (col) => col.defaultTo(0))
    .addColumn("last_heartbeat", "timestamptz", (col) =>
      col.defaultTo(sql`now()`)
    )
    .execute();

  // account_servers
  await db.schema
    .createTable("account_servers")
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("server_id", "integer", (col) =>
      col.notNull().references("game_servers.id").onDelete("cascade")
    )
    .addColumn("character_count", "smallint", (col) => col.defaultTo(0))
    .addPrimaryKeyConstraint("pk_account_servers", ["account_id", "server_id"])
    .execute();

  // auth_tickets
  await db.schema
    .createTable("auth_tickets")
    .addColumn("ticket", "uuid", (col) => col.primaryKey())
    .addColumn("account_id", "bigint", (col) =>
      col.references("accounts.id").onDelete("cascade")
    )
    .addColumn("game_server_id", "integer", (col) =>
      col.references("game_servers.id").onDelete("cascade")
    )
    .addColumn("issued_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("expires_at", "timestamptz")
    .addColumn("used_at", "timestamptz")
    .execute();

  await sql`CREATE INDEX idx_auth_tickets_expires ON auth_tickets(expires_at)`.execute(
    db
  );

  // subareas
  await db.schema
    .createTable("subareas")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("area_id", "integer")
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("conquestable", "boolean", (col) => col.defaultTo(false))
    .addColumn("alignment", "smallint", (col) => col.defaultTo(0))
    .execute();

  // maps
  await db.schema
    .createTable("maps")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("date", sql`VARCHAR(16)`, (col) => col.defaultTo(""))
    .addColumn("key", sql`VARCHAR(64)`, (col) => col.defaultTo(""))
    .addColumn("width", "integer")
    .addColumn("height", "integer")
    .addColumn("cells", "bytea")
    .addColumn("subarea_id", "integer", (col) => col.references("subareas.id"))
    .addColumn("x", "integer", (col) => col.defaultTo(0))
    .addColumn("y", "integer", (col) => col.defaultTo(0))
    .addColumn("superarea", "integer", (col) => col.defaultTo(0))
    .addColumn("background", "integer", (col) => col.defaultTo(0))
    .execute();

  // players
  await db.schema
    .createTable("players")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("account_id", "bigint", (col) =>
      col.references("accounts.id").onDelete("cascade")
    )
    .addColumn("server_id", "integer", (col) =>
      col.references("game_servers.id")
    )
    .addColumn("name", sql`VARCHAR(32)`)
    .addColumn("sex", "smallint")
    .addColumn("class", "smallint")
    .addColumn("gfx", "integer")
    .addColumn("level", "integer", (col) => col.defaultTo(1))
    .addColumn("experience", "bigint", (col) => col.defaultTo(0))
    .addColumn("kamas", "bigint", (col) => col.defaultTo(0))
    .addColumn("stats_points", "integer", (col) => col.defaultTo(0))
    .addColumn("spell_points", "integer", (col) => col.defaultTo(0))
    .addColumn("life", "integer", (col) => col.defaultTo(55))
    .addColumn("energy", "integer", (col) => col.defaultTo(10000))
    .addColumn("map_id", "integer", (col) => col.defaultTo(10300))
    .addColumn("cell_id", "integer", (col) => col.defaultTo(319))
    .addColumn("direction", "smallint", (col) => col.defaultTo(3))
    .addColumn("savepoint_map_id", "integer", (col) => col.defaultTo(10300))
    .addColumn("savepoint_cell_id", "integer", (col) => col.defaultTo(319))
    .addColumn("channels", "integer", (col) => col.defaultTo(0))
    .addColumn("alignment", "smallint", (col) => col.defaultTo(0))
    .addColumn("alignment_value", "integer", (col) => col.defaultTo(0))
    .addColumn("alignment_grade", "smallint", (col) => col.defaultTo(0))
    .addColumn("pvp_enabled", "boolean", (col) => col.defaultTo(false))
    .addColumn("restrictions", "bigint", (col) => col.defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("deleted_at", "timestamptz")
    .addUniqueConstraint("uq_players_server_name", ["server_id", "name"])
    .execute();

  await sql`CREATE INDEX idx_players_account ON players(account_id) WHERE deleted_at IS NULL`.execute(
    db
  );
  await sql`CREATE INDEX idx_players_map ON players(map_id) WHERE deleted_at IS NULL`.execute(
    db
  );

  // player_stats
  await db.schema
    .createTable("player_stats")
    .addColumn("player_id", "bigint", (col) =>
      col.primaryKey().references("players.id").onDelete("cascade")
    )
    .addColumn("strength", "integer", (col) => col.defaultTo(0))
    .addColumn("vitality", "integer", (col) => col.defaultTo(0))
    .addColumn("wisdom", "integer", (col) => col.defaultTo(0))
    .addColumn("intelligence", "integer", (col) => col.defaultTo(0))
    .addColumn("chance", "integer", (col) => col.defaultTo(0))
    .addColumn("agility", "integer", (col) => col.defaultTo(0))
    .execute();

  // player_colors
  await db.schema
    .createTable("player_colors")
    .addColumn("player_id", "bigint", (col) =>
      col.primaryKey().references("players.id").onDelete("cascade")
    )
    .addColumn("color1", "integer", (col) => col.defaultTo(-1))
    .addColumn("color2", "integer", (col) => col.defaultTo(-1))
    .addColumn("color3", "integer", (col) => col.defaultTo(-1))
    .execute();

  // player_spells
  await db.schema
    .createTable("player_spells")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("spell_id", "integer", (col) => col.notNull())
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("position", "smallint", (col) => col.defaultTo(-1))
    .addPrimaryKeyConstraint("pk_player_spells", ["player_id", "spell_id"])
    .execute();

  // player_items
  await db.schema
    .createTable("player_items")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("template_id", "integer")
    .addColumn("position", "smallint", (col) => col.defaultTo(-1))
    .addColumn("quantity", "integer", (col) => col.defaultTo(1))
    .addColumn("effects", "jsonb", (col) => col.defaultTo("[]"))
    .execute();

  await sql`CREATE INDEX idx_player_items_player ON player_items(player_id)`.execute(
    db
  );

  // player_mount
  await db.schema
    .createTable("player_mount")
    .addColumn("player_id", "bigint", (col) =>
      col.primaryKey().references("players.id").onDelete("cascade")
    )
    .addColumn("mount_template_id", "integer")
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("experience", "bigint", (col) => col.defaultTo(0))
    .addColumn("energy", "integer", (col) => col.defaultTo(1000))
    .addColumn("name", sql`VARCHAR(32)`, (col) => col.defaultTo(""))
    .execute();

  // map_triggers
  await db.schema
    .createTable("map_triggers")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("map_id", "integer", (col) =>
      col.notNull().references("maps.id").onDelete("cascade")
    )
    .addColumn("cell_id", "integer")
    .addColumn("action", "smallint")
    .addColumn("arguments", "text", (col) => col.defaultTo(""))
    .addColumn("conditions", "text", (col) => col.defaultTo(""))
    .execute();

  await sql`CREATE INDEX idx_map_triggers_map ON map_triggers(map_id)`.execute(
    db
  );

  // map_neighbors
  await db.schema
    .createTable("map_neighbors")
    .addColumn("map_id", "integer", (col) =>
      col.notNull().references("maps.id").onDelete("cascade")
    )
    .addColumn("direction", "smallint", (col) => col.notNull())
    .addColumn("neighbor_map_id", "integer", (col) =>
      col.notNull().references("maps.id").onDelete("cascade")
    )
    .addPrimaryKeyConstraint("pk_map_neighbors", ["map_id", "direction"])
    .execute();

  // map_fight_places
  await db.schema
    .createTable("map_fight_places")
    .addColumn("map_id", "integer", (col) =>
      col.primaryKey().references("maps.id").onDelete("cascade")
    )
    .addColumn("places0", "text", (col) => col.defaultTo(""))
    .addColumn("places1", "text", (col) => col.defaultTo(""))
    .execute();

  // scripted_npcs
  await db.schema
    .createTable("scripted_npcs")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("map_id", "integer", (col) =>
      col.notNull().references("maps.id").onDelete("cascade")
    )
    .addColumn("cell_id", "integer")
    .addColumn("template_id", "integer")
    .addColumn("direction", "smallint", (col) => col.defaultTo(3))
    .execute();

  // item_templates
  await db.schema
    .createTable("item_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("type", "smallint")
    .addColumn("level", "smallint", (col) => col.defaultTo(1))
    .addColumn("weight", "integer", (col) => col.defaultTo(1))
    .addColumn("gfx_id", "integer", (col) => col.defaultTo(0))
    .addColumn("effects", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("criteria", "text", (col) => col.defaultTo(""))
    .addColumn("two_handed", "boolean", (col) => col.defaultTo(false))
    .addColumn("item_set_id", "integer", (col) => col.defaultTo(0))
    .addColumn("usable", "boolean", (col) => col.defaultTo(false))
    .addColumn("targetable", "boolean", (col) => col.defaultTo(false))
    .addColumn("price", "integer", (col) => col.defaultTo(0))
    .execute();

  // item_sets
  await db.schema
    .createTable("item_sets")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("bonuses", "jsonb", (col) => col.defaultTo("[]"))
    .execute();

  // spell_templates
  await db.schema
    .createTable("spell_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("sprite", "integer", (col) => col.defaultTo(0))
    .execute();

  // spell_levels
  await db.schema
    .createTable("spell_levels")
    .addColumn("spell_id", "integer", (col) =>
      col.notNull().references("spell_templates.id").onDelete("cascade")
    )
    .addColumn("level", "smallint", (col) => col.notNull())
    .addColumn("effects", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("critical_effects", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("ap_cost", "smallint")
    .addColumn("range_min", "smallint", (col) => col.defaultTo(0))
    .addColumn("range_max", "smallint")
    .addColumn("critical_rate", "integer", (col) => col.defaultTo(0))
    .addColumn("failure_rate", "integer", (col) => col.defaultTo(0))
    .addColumn("line_of_sight", "boolean", (col) => col.defaultTo(true))
    .addColumn("empty_cell", "boolean", (col) => col.defaultTo(false))
    .addColumn("modifiable_range", "boolean", (col) => col.defaultTo(false))
    .addColumn("cast_per_turn", "smallint", (col) => col.defaultTo(0))
    .addColumn("cast_per_target", "smallint", (col) => col.defaultTo(0))
    .addColumn("cooldown", "smallint", (col) => col.defaultTo(0))
    .addColumn("line_only", "boolean", (col) => col.defaultTo(false))
    .addPrimaryKeyConstraint("pk_spell_levels", ["spell_id", "level"])
    .execute();

  // monster_ai_profiles
  await db.schema
    .createTable("monster_ai_profiles")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(64)`)
    .addColumn("config", "jsonb", (col) => col.defaultTo("{}"))
    .execute();

  // monster_templates
  await db.schema
    .createTable("monster_templates")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("gfx", "integer")
    .addColumn("ai_profile_id", "integer", (col) =>
      col.references("monster_ai_profiles.id")
    )
    .addColumn("color1", "integer", (col) => col.defaultTo(-1))
    .addColumn("color2", "integer", (col) => col.defaultTo(-1))
    .addColumn("color3", "integer", (col) => col.defaultTo(-1))
    .execute();

  // monster_levels
  await db.schema
    .createTable("monster_levels")
    .addColumn("monster_id", "integer", (col) =>
      col.notNull().references("monster_templates.id").onDelete("cascade")
    )
    .addColumn("level", "smallint", (col) => col.notNull())
    .addColumn("life", "integer")
    .addColumn("initiative", "integer")
    .addColumn("ap", "smallint")
    .addColumn("mp", "smallint")
    .addColumn("stats", "jsonb", (col) => col.defaultTo("{}"))
    .addColumn("resistances", "jsonb", (col) => col.defaultTo("{}"))
    .addColumn("spells", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("xp", "bigint", (col) => col.defaultTo(0))
    .addColumn("kamas_min", "integer", (col) => col.defaultTo(0))
    .addColumn("kamas_max", "integer", (col) => col.defaultTo(0))
    .addPrimaryKeyConstraint("pk_monster_levels", ["monster_id", "level"])
    .execute();

  // monster_groups
  await db.schema
    .createTable("monster_groups")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("map_id", "integer", (col) =>
      col.notNull().references("maps.id").onDelete("cascade")
    )
    .addColumn("cell_id", "integer")
    .addColumn("size_min", "smallint", (col) => col.defaultTo(1))
    .addColumn("size_max", "smallint", (col) => col.defaultTo(8))
    .addColumn("members", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("respawn_seconds", "integer", (col) => col.defaultTo(60))
    .addColumn("fixed_members", "boolean", (col) => col.defaultTo(false))
    .execute();

  await sql`CREATE INDEX idx_monster_groups_map ON monster_groups(map_id)`.execute(
    db
  );

  // monster_drops
  await db.schema
    .createTable("monster_drops")
    .addColumn("monster_id", "integer", (col) =>
      col.notNull().references("monster_templates.id").onDelete("cascade")
    )
    .addColumn("item_template_id", "integer", (col) => col.notNull())
    .addColumn("rate", sql`DOUBLE PRECISION`)
    .addColumn("min_quantity", "integer", (col) => col.defaultTo(1))
    .addColumn("max_quantity", "integer", (col) => col.defaultTo(1))
    .addPrimaryKeyConstraint("pk_monster_drops", [
      "monster_id",
      "item_template_id",
    ])
    .execute();

  // fight_history
  await db.schema
    .createTable("fight_history")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("type", "smallint")
    .addColumn("map_id", "integer")
    .addColumn("started_at", "timestamptz")
    .addColumn("ended_at", "timestamptz")
    .addColumn("winner_team", "smallint")
    .addColumn("duration_ms", "integer")
    .execute();

  // fight_participants
  await db.schema
    .createTable("fight_participants")
    .addColumn("fight_id", "bigint", (col) =>
      col.notNull().references("fight_history.id").onDelete("cascade")
    )
    .addColumn("player_id", "bigint", (col) =>
      col.references("players.id").onDelete("set null")
    )
    .addColumn("monster_id", "integer", (col) =>
      col.references("monster_templates.id")
    )
    .addColumn("team", "smallint")
    .addColumn("xp_gained", "bigint", (col) => col.defaultTo(0))
    .addColumn("kamas_gained", "bigint", (col) => col.defaultTo(0))
    .addColumn("dead", "boolean", (col) => col.defaultTo(false))
    .addColumn("left_fight", "boolean", (col) => col.defaultTo(false))
    .execute();

  await sql`CREATE INDEX idx_fight_participants_fight ON fight_participants(fight_id)`.execute(
    db
  );
  await sql`CREATE INDEX idx_fight_participants_player ON fight_participants(player_id)`.execute(
    db
  );
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("fight_participants").execute();
  await db.schema.dropTable("fight_history").execute();
  await db.schema.dropTable("monster_drops").execute();
  await db.schema.dropTable("monster_groups").execute();
  await db.schema.dropTable("monster_levels").execute();
  await db.schema.dropTable("monster_templates").execute();
  await db.schema.dropTable("monster_ai_profiles").execute();
  await db.schema.dropTable("spell_levels").execute();
  await db.schema.dropTable("spell_templates").execute();
  await db.schema.dropTable("item_sets").execute();
  await db.schema.dropTable("item_templates").execute();
  await db.schema.dropTable("scripted_npcs").execute();
  await db.schema.dropTable("map_fight_places").execute();
  await db.schema.dropTable("map_neighbors").execute();
  await db.schema.dropTable("map_triggers").execute();
  await db.schema.dropTable("maps").execute();
  await db.schema.dropTable("subareas").execute();
  await db.schema.dropTable("player_mount").execute();
  await db.schema.dropTable("player_items").execute();
  await db.schema.dropTable("player_spells").execute();
  await db.schema.dropTable("player_colors").execute();
  await db.schema.dropTable("player_stats").execute();
  await db.schema.dropTable("players").execute();
  await db.schema.dropTable("auth_tickets").execute();
  await db.schema.dropTable("account_servers").execute();
  await db.schema.dropTable("game_servers").execute();
  await db.schema.dropTable("accounts").execute();
}
