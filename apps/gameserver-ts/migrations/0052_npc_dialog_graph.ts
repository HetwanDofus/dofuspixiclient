import { type Kysely, sql } from "kysely";

/**
 * Reshape the dialog tables around what StarLoco's dump actually holds.
 *
 * `npc_dialog_questions` and `npc_dialog_responses` were laid down in 0002
 * before anyone had read the dump, and both miss:
 *
 * - `npc_dialog_responses.action` is a single column, but the dump keys
 *   `npc_reponses_actions` on `(ID, type)` and **181 answers carry more than
 *   one action**. One row per answer cannot represent them.
 * - Both tables carry a `text_id` distinct from `id`. In 1.29 a question's id
 *   *is* its key into the `dialog` lang bundle (`D.q[id]` / `D.a[id]`,
 *   `Question.initialize` -> `api.lang.getDialogQuestionText(nQuestionID)`), so
 *   the indirection has nothing to point at.
 * - An answer has no attributes of its own beyond its actions -- its text lives
 *   in the bundle -- so `npc_dialog_responses` has no reason to exist.
 *
 * Both tables are empty (nothing has ever imported them), so this drops and
 * recreates rather than migrating rows.
 *
 * `cond` and `if_false` come along unevaluated. 55 questions carry a condition
 * (`PG=6` guild rank, `RO=973,1` quest state) against state this server does
 * not model yet; keeping the columns means the day it does, only the service
 * changes and no re-import is needed.
 *
 * The two wander columns ride along here rather than in a migration of their
 * own because they are filled by the same re-import. `npc_template.path`
 * (57 templates) is a patrol route, `npcs.isMovable` (73 placements) the flag
 * that turns it on; only the 14 placements where both are set actually move.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await db.schema.dropTable("npc_dialog_responses").execute();
  await db.schema.dropTable("npc_dialog_questions").execute();

  await db.schema
    .createTable("npc_dialog_questions")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("response_ids", "jsonb", (col) => col.notNull().defaultTo("[]"))
    .addColumn("parameters", "jsonb", (col) => col.notNull().defaultTo("[]"))
    .addColumn("cond", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("if_false", "integer", (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable("npc_dialog_response_actions")
    .addColumn("response_id", "integer", (col) => col.notNull())
    .addColumn("type", "integer", (col) => col.notNull())
    .addColumn("args", "text", (col) => col.notNull().defaultTo(""))
    .addPrimaryKeyConstraint("pk_npc_dialog_response_actions", [
      "response_id",
      "type",
    ])
    .execute();

  await sql`CREATE INDEX idx_npc_dialog_response_actions_response
            ON npc_dialog_response_actions(response_id)`.execute(db);

  await db.schema
    .alterTable("npc_templates")
    .addColumn("path", "text", (col) => col.notNull().defaultTo(""))
    .execute();

  await db.schema
    .alterTable("scripted_npcs")
    .addColumn("is_movable", "boolean", (col) => col.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<never>): Promise<void> {
  await db.schema
    .alterTable("scripted_npcs")
    .dropColumn("is_movable")
    .execute();
  await db.schema.alterTable("npc_templates").dropColumn("path").execute();
  await db.schema.dropTable("npc_dialog_response_actions").execute();
  await db.schema.dropTable("npc_dialog_questions").execute();

  await db.schema
    .createTable("npc_dialog_questions")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("text_id", "integer")
    .addColumn("parameters", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("response_ids", "jsonb", (col) => col.defaultTo("[]"))
    .execute();

  await db.schema
    .createTable("npc_dialog_responses")
    .addColumn("id", "integer", (col) => col.primaryKey())
    .addColumn("text_id", "integer")
    .addColumn("next_question", "integer", (col) => col.defaultTo(0))
    .addColumn("action", sql`VARCHAR(32)`, (col) => col.defaultTo(""))
    .addColumn("action_args", "jsonb", (col) => col.defaultTo("[]"))
    .addColumn("requires_level", "smallint", (col) => col.defaultTo(0))
    .addColumn("requires_kamas", "integer", (col) => col.defaultTo(0))
    .execute();
}
