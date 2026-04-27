import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<never>): Promise<void> {
  // chat_subscriptions
  await db.schema
    .createTable("chat_subscriptions")
    .addColumn("player_id", "bigint", (col) =>
      col.notNull().references("players.id").onDelete("cascade")
    )
    .addColumn("channel", "char", (col) => col.notNull())
    .addPrimaryKeyConstraint("pk_chat_subscriptions", ["player_id", "channel"])
    .execute();

  // mod_reports
  await db.schema
    .createTable("mod_reports")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("reporter_id", "bigint", (col) =>
      col.references("accounts.id").onDelete("set null")
    )
    .addColumn("target_id", "bigint", (col) =>
      col.references("accounts.id").onDelete("set null")
    )
    .addColumn("type", "smallint", (col) => col.defaultTo(0))
    .addColumn("state", "smallint", (col) => col.defaultTo(0))
    .addColumn("details", "text", (col) => col.defaultTo(""))
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .addColumn("handled_by", "bigint", (col) =>
      col.references("accounts.id").onDelete("set null")
    )
    .addColumn("handled_at", "timestamptz")
    .execute();

  await sql`CREATE INDEX idx_mod_reports_state ON mod_reports(state)`.execute(
    db
  );
  await sql`CREATE INDEX idx_mod_reports_target ON mod_reports(target_id)`.execute(
    db
  );

  // bug_reports
  await db.schema
    .createTable("bug_reports")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("reporter_id", "bigint", (col) =>
      col.references("accounts.id").onDelete("set null")
    )
    .addColumn("category", "smallint", (col) => col.defaultTo(0))
    .addColumn("body", "text")
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  // surveys
  await db.schema
    .createTable("surveys")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("question", "text")
    .addColumn("options", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("active", "boolean", (col) => col.defaultTo(true))
    .addColumn("created_at", "timestamptz", (col) => col.defaultTo(sql`now()`))
    .execute();

  // survey_responses
  await db.schema
    .createTable("survey_responses")
    .addColumn("survey_id", "integer", (col) =>
      col.notNull().references("surveys.id").onDelete("cascade")
    )
    .addColumn("account_id", "bigint", (col) =>
      col.notNull().references("accounts.id").onDelete("cascade")
    )
    .addColumn("answer", "smallint")
    .addColumn("submitted_at", "timestamptz", (col) =>
      col.defaultTo(sql`now()`)
    )
    .addPrimaryKeyConstraint("pk_survey_responses", ["survey_id", "account_id"])
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("survey_responses").execute();
  await db.schema.dropTable("surveys").execute();
  await db.schema.dropTable("bug_reports").execute();
  await db.schema.dropTable("mod_reports").execute();
  await db.schema.dropTable("chat_subscriptions").execute();
}
