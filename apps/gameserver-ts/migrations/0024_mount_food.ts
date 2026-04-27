import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  await db.schema
    .createTable("mount_food_templates")
    .addColumn("template_id", "integer", (col) => col.primaryKey())
    .addColumn("energy", "integer", (col) => col.defaultTo(0))
    .addColumn("maturity", "integer", (col) => col.defaultTo(0))
    .addColumn("serenity", "integer", (col) => col.defaultTo(0))
    .addColumn("stamina", "integer", (col) => col.defaultTo(0))
    .addColumn("love", "integer", (col) => col.defaultTo(0))
    .addColumn("fecundity", "integer", (col) => col.defaultTo(0))
    .execute();

  await sql`
    INSERT INTO mount_food_templates (template_id, energy, maturity, serenity, stamina, love, fecundity) VALUES
        (598,  5000,    0,    0,    0,    0,    0),
        (600,  5000,    0,    0,    0,    0,    0),
        (602,  5000,  100,    0,  200,  100,   50),
        (603,  5000,    0,    0,  100,    0,    0),
        (607,  5000,    0,    0,   50,    0,    0),
        (1750, 5000,    0,    0,  100,    0,    0),
        (1754, 5000,    0,    0,   50,    0,    0),
        (1757, 5000,    0,    0,   50,    0,    0),
        (1762, 5000,    0,    0,  100,    0,    0),
        (1779, 5000,   50,    0,  100,    0,    0),
        (1782, 5000,    0,    0,   50,    0,    0),
        (1784, 5000,  100,    0,  150,    0,    0),
        (1788, 5000,   50,    0,  100,    0,    0),
        (1792, 5000,  100,    0,  150,    0,    0),
        (1794, 5000,   50,    0,  100,    0,    0),
        (1796, 5000,   50,    0,  100,    0,    0),
        (1799, 5000,  150,    0,  200,  100,   50),
        (1801, 5000,  100,    0,  150,    0,    0),
        (1803, 5000,  100,    0,  150,    0,    0),
        (1805, 5000,    0,    0,   50,    0,    0),
        (1807, 5000,    0,    0,   50,    0,    0),
        (1844, 5000,    0,    0,   50,    0,    0),
        (1846, 5000,  200,    0,  200,  200,  100),
        (1847, 5000,    0,    0,   50,    0,    0),
        (1849, 5000,    0,    0,   50,    0,    0),
        (1853, 5000,  100,    0,  200,  100,   50),
        (2187, 5000,  100,    0,  150,  100,   50)
  `.execute(db);

  await sql`
    ALTER TABLE players
    ADD COLUMN mount_xp_share smallint DEFAULT 0 CHECK(mount_xp_share BETWEEN 0 AND 100)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`
    ALTER TABLE players
    DROP COLUMN mount_xp_share
  `.execute(db);

  await db.schema.dropTable("mount_food_templates").execute();
}
