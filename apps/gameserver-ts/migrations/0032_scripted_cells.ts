import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS scripted_cells (
      map_id integer,
      cell_id integer,
      action_id integer DEFAULT 0,
      event_id integer DEFAULT 0,
      verb VARCHAR(16),
      actions_args text DEFAULT '',
      conditions text DEFAULT '',
      PRIMARY KEY (map_id, cell_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scripted_cells_map_id ON scripted_cells(map_id)
  `.execute(db);

  await sql`
    INSERT INTO scripted_cells (map_id, cell_id, action_id, event_id, verb, actions_args, conditions) VALUES
    (4, 436, 0, 1, 'TP', '2147,169', '-1'),
    (5, 422, 0, 1, 'TP', '2142,265', '-1'),
    (5, 436, 0, 1, 'TP', '2142,265', '-1'),
    (6, 455, 0, 1, 'TP', '51,49', '-1'),
    (6, 33, 0, 1, 'TP', '7,439', '-1'),
    (6, 392, 0, 1, 'TP', '49,419', '-1'),
    (6, 173, 0, 1, 'TP', '54,175', '-1'),
    (7, 454, 0, 1, 'TP', '6,48', '-1'),
    (7, 21, 0, 1, 'TP', '46,440', '-1'),
    (7, 299, 0, 1, 'TP', '160,367', '-1'),
    (7, 405, 0, 1, 'TP', '53,378', '-1'),
    (7, 247, 0, 1, 'TP', '48,216', '-1'),
    (8, 21, 0, 1, 'TP', '24,457', '-1'),
    (8, 456, 0, 1, 'TP', '12,21', '-1'),
    (9, 20, 0, 1, 'TP', '13,456', '-1'),
    (9, 456, 0, 1, 'TP', '24,22', '-1')
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("scripted_cells").ifExists().cascade().execute();
}
