import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("koliseum_config")
    .ifNotExists()
    .addColumn("singleton", "boolean", (col) =>
      col.primaryKey().defaultTo(true)
    )
    .addColumn("arena_map_id", "integer", (col) => col.defaultTo(9425))
    .execute();

  await sql`
    INSERT INTO koliseum_config (singleton, arena_map_id) VALUES (TRUE, 9425) ON CONFLICT (singleton) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("koliseum_config").execute();
}
