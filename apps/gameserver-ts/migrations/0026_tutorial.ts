import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("tutorial_steps")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("name", sql`VARCHAR(128)`)
    .addColumn("start_map_id", "integer", (col) => col.defaultTo(0))
    .addColumn("start_cell_id", "integer", (col) => col.defaultTo(0))
    .addColumn("objective_kind", sql`VARCHAR(32)`)
    .addColumn("objective_target", "integer", (col) => col.defaultTo(0))
    .addColumn("reward_items", "jsonb", (col) => col.defaultTo(sql`'[]'`))
    .addColumn("reward_kamas", "bigint", (col) => col.defaultTo(0))
    .addColumn("reward_xp", "bigint", (col) => col.defaultTo(0))
    .addColumn("next_step_id", "integer", (col) => col.defaultTo(0))
    .execute();

  await db.schema
    .createTable("player_tutorial_progress")
    .addColumn("player_id", "bigint", (col) =>
      col.primaryKey().references("players.id").onDelete("cascade")
    )
    .addColumn("current_step", "integer", (col) => col.defaultTo(0))
    .addColumn("completed", "boolean", (col) => col.defaultTo(false))
    .addColumn("started_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("completed_at", "timestamptz")
    .execute();

  await sql`
    INSERT INTO tutorial_steps (id, name, start_map_id, start_cell_id, objective_kind, objective_target, reward_items, reward_kamas, reward_xp, next_step_id) VALUES
    (21, 'Tofu Smash', 6864, 169, 'kill_monster', 285, '[{"template_id":1749,"quantity":1}]'::jsonb, 50, 100, 22),
    (22, 'Duel au Troll', 0, 0, 'kill_monster', 1054, '[{"template_id":1749,"quantity":1}]'::jsonb, 50, 150, 25),
    (25, 'Course au larve', 0, 0, 'kill_monster', 2, '[{"template_id":1749,"quantity":1}]'::jsonb, 25, 75, 27),
    (27, 'Memoire de Blop +', 6876, 284, 'reach_map', 3334, '[{"template_id":1749,"quantity":1}]'::jsonb, 75, 150, 28),
    (28, 'Tir au Ballon', 6866, 422, 'reach_map', 3452, '[{"template_id":1749,"quantity":1}]'::jsonb, 100, 200, 0)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("player_tutorial_progress").ifExists().execute();
  await db.schema.dropTable("tutorial_steps").ifExists().execute();
}
