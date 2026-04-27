import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE interactive_doors ADD COLUMN IF NOT EXISTS map_id integer DEFAULT 0`.execute(
    db
  );
  await sql`ALTER TABLE interactive_doors ADD COLUMN IF NOT EXISTS cell_id integer DEFAULT 0`.execute(
    db
  );
  await sql`ALTER TABLE interactive_doors ADD COLUMN IF NOT EXISTS required_item_id integer DEFAULT 0`.execute(
    db
  );
  await sql`ALTER TABLE interactive_doors ADD COLUMN IF NOT EXISTS required_quest_id integer DEFAULT 0`.execute(
    db
  );

  await sql`
    CREATE INDEX IF NOT EXISTS idx_interactive_doors_map ON interactive_doors(map_id)
  `.execute(db);

  await sql`
    INSERT INTO interactive_doors (map_id, cell_id, maps, doors_enable, cells_enable, required_cells, button, time_seconds) VALUES
    (10352, 98, '10352', '10352:98', '10352:98', '10352:355;327;299', '-1', 30),
    (1186, 295, '1186', '1186:295', '1186:295', '1186:437', '-1', 30),
    (11935, 216, '11935', '11935:216,66', '11935:216,66', '11935:134;162;317;345', '-1', 30),
    (1213, 409, '1213', '1213:409', '1213:409', '1213:274', '-1', 30),
    (1663, 153, '1663', '1663:153', '1663:153', '1663:450', '-1', 30),
    (1884, 336, '1884', '1884:336', '1884:351,365,366,379,380,381,394,395,409', '1884:378', '-1', 30),
    (1884, 294, '1884', '1884:294', '1884:309,323,324,337,338,339,352,353,367', '1884:295', '-1', 30)
    ON CONFLICT DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_interactive_doors_map`.execute(db);

  await sql`ALTER TABLE interactive_doors DROP COLUMN IF EXISTS required_quest_id`.execute(
    db
  );
  await sql`ALTER TABLE interactive_doors DROP COLUMN IF EXISTS required_item_id`.execute(
    db
  );
  await sql`ALTER TABLE interactive_doors DROP COLUMN IF EXISTS cell_id`.execute(
    db
  );
  await sql`ALTER TABLE interactive_doors DROP COLUMN IF EXISTS map_id`.execute(
    db
  );
}
