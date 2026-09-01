import { type Kysely, sql } from "kysely";

/**
 * What `scripts/import-starloco-jobs.ts` needs before it can fill the five
 * tables migration 0011 created and nobody ever wrote to.
 *
 * The shape 0011 guessed is close but short of what the 1.29 data actually
 * carries. `job_skills` has no way to say *what kind* of skill a row is —
 * the bundle's `SK` table tells them apart by which optional field is
 * present (`i` a harvest, `cl` a craft, `f` a forgemagie improvement) and
 * that distinction is what routes a click. It also has nowhere to put the
 * harvested item, the experience it grants, or the criterion string the
 * client evaluates in `Skill.getState`.
 *
 * `job_tools` exists because `jobs_data.tools` is a comma-separated list and
 * "is this equipped weapon a tool for this job" is a lookup on every single
 * harvest attempt.
 *
 * **`gatherable_cell_states` is deliberately not `job_gatherable_cells`.**
 * The latter is a *referential*, rebuilt from the world by an idempotent
 * import; the former is live state. Folding one into the other would mean a
 * re-import wipes every respawn in flight. Same key, two lifetimes, two
 * tables. Taking a resource is a single `UPDATE … RETURNING` filtered on
 * `available_at`, which is what makes it atomic across processes — see
 * QA-123 §2.
 */
export async function up(db: Kysely<never>): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS gfx_id smallint NOT NULL DEFAULT 0`.execute(
    db
  );
  // `J[id].s` — 0 for a base job, else the id of the job it specialises.
  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS specialization_of integer NOT NULL DEFAULT 0`.execute(
    db
  );

  // 1 = harvest, 2 = craft, 3 = forgemagie, 0 = neither (menu-only skills).
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS kind smallint NOT NULL DEFAULT 0`.execute(
    db
  );
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS harvest_item_id integer`.execute(
    db
  );
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS harvest_xp integer`.execute(
    db
  );
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS fixed_duration_ms integer`.execute(
    db
  );
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS quantity_min smallint`.execute(
    db
  );
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS quantity_max smallint`.execute(
    db
  );
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS criteria varchar(32) NOT NULL DEFAULT ''`.execute(
    db
  );
  await sql`ALTER TABLE job_skills ADD COLUMN IF NOT EXISTS fm_item_type integer`.execute(
    db
  );
  await sql`CREATE INDEX IF NOT EXISTS idx_job_skills_kind ON job_skills(kind)`.execute(
    db
  );

  await sql`ALTER TABLE player_jobs ADD COLUMN IF NOT EXISTS learned_at timestamptz NOT NULL DEFAULT now()`.execute(
    db
  );

  await sql`
    CREATE TABLE IF NOT EXISTS job_tools (
      job_id      integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      template_id integer NOT NULL,
      PRIMARY KEY (job_id, template_id)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_job_tools_template ON job_tools(template_id)`.execute(
    db
  );

  await sql`
    CREATE TABLE IF NOT EXISTS gatherable_cell_states (
      map_id         integer     NOT NULL,
      cell_id        integer     NOT NULL,
      available_at   timestamptz NOT NULL DEFAULT now(),
      reserved_by    bigint,
      reserved_until timestamptz,
      PRIMARY KEY (map_id, cell_id)
    )
  `.execute(db);
  // The boot sweep reads this in `available_at` order to re-arm what is still
  // pending. It cannot be a partial index on `available_at > now()`: Postgres
  // refuses a non-IMMUTABLE function in an index predicate.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_gatherable_states_available
      ON gatherable_cell_states(available_at)
  `.execute(db);
}

export async function down(db: Kysely<never>): Promise<void> {
  await sql`DROP TABLE IF EXISTS gatherable_cell_states`.execute(db);
  await sql`DROP TABLE IF EXISTS job_tools`.execute(db);
  await sql`ALTER TABLE player_jobs DROP COLUMN IF EXISTS learned_at`.execute(
    db
  );
  await sql`
    ALTER TABLE job_skills
      DROP COLUMN IF EXISTS kind,
      DROP COLUMN IF EXISTS harvest_item_id,
      DROP COLUMN IF EXISTS harvest_xp,
      DROP COLUMN IF EXISTS fixed_duration_ms,
      DROP COLUMN IF EXISTS quantity_min,
      DROP COLUMN IF EXISTS quantity_max,
      DROP COLUMN IF EXISTS criteria,
      DROP COLUMN IF EXISTS fm_item_type
  `.execute(db);
  await sql`
    ALTER TABLE jobs
      DROP COLUMN IF EXISTS gfx_id,
      DROP COLUMN IF EXISTS specialization_of
  `.execute(db);
}
