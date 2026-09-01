/**
 * Imports the jobs referential — the five tables migrations 0011 and 0008
 * created and nothing has ever written to.
 *
 * Why this exists: the world is full of harvestable resources and none of them
 * can be harvested. `interactive_objects_templates` already knows that gfx
 * 7500 is a "Frêne" of type 1 offering skill 6, and there the chain stops:
 * nothing says skill 6 belongs to Bûcheron, yields item 303, needs level 1 and
 * grants 10 experience. See QA-123 and QA-129.
 *
 *   curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
 *   DATABASE_URL=... bun run scripts/import-starloco-jobs.ts game.sql
 *
 * Run it *after* `just import-triggers`: the gatherable scan reads
 * `interactive_objects_templates` for the respawn delay and the object type.
 *
 * ── Where each column comes from ───────────────────────────────────────────
 *
 * The rule is the one every importer here follows: **the 1.29 bundles win
 * wherever they have an entry**, the dump fills what they do not carry, and
 * anything neither has is named out loud rather than guessed.
 *
 * **jobs** — `jobs.json`'s `J`, which gives the name, the icon id (`g`) and
 * the job a specialisation belongs to (`s`). Five of its 39 entries are
 * junk — lowercase duplicates with `g: 0` ('joaillier', 'paysan', 'Coupe'…) —
 * and are rejected with a count.
 *
 * **job_skills** — `skills.json`'s `SK`, all 147 of them, because the popup
 * menu offers skills the server has no behaviour for and the greyed-out ones
 * still need a label. What decides the row's `kind` is which optional field
 * the bundle carries: `i` (the harvested item) makes it a harvest, `cl` (the
 * craftable list) a craft, `f` (the improved item type) a forgemagie skill.
 *
 * **job_skills.min_level / harvest_xp** — `data/starloco-job-skills.json`,
 * committed next to this script. Those two numbers exist in no bundle and in
 * no dump table; they come from StarLoco's Lua scripts and that file records
 * exactly which ones, and when. Three of the bundle's 57 harvest skills have
 * no upstream row at all (42 "Ramasser", 150 "Jouer", 152 "Pêcher KoinKoin" —
 * the jobless ones); they import with a null experience, which is what makes
 * `HarvestService` refuse them, and they are counted here by name.
 *
 * **job_tools** — `jobs_data.tools`, a comma-separated list of item ids, and
 * the only statement anywhere of which tool belongs to which job. It is
 * curated rather than derived: Bûcheron lists 20 axes, Mineur lists the single
 * Pioche de Mineur. StarLoco's scripts instead accept any item of the tool's
 * *type* (19 Hache, 21 Pioche, 22 Faux), which would let a combat axe fell a
 * tree; the curated list is the narrower and the more faithful of the two, so
 * it is what is imported. Every id is checked against `item_templates` and a
 * miss is counted.
 *
 * **recipes** — `crafts.json`'s `CR`, keyed by *result item id* (2 298 of
 * them), joined to the craft skill that lists it in `SK[id].cl`. The dump's
 * `crafts` table holds the same data in `"441*1;473*1"` form plus 71 entries
 * that are 1.39-only, so the bundle is the one read.
 *
 * **job_gatherable_cells** — nothing lists placed resources; they are found
 * the same way `import-starloco-triggers.ts` finds zaaps, by decoding every
 * map's cells and keeping those whose layer-2 object has its interactive bit
 * armed and whose gfx is an `IO` entry of type 1. The respawn delay is the
 * template's own `respawn_ms`, which is the retail value (Frêne 300 s, Chêne
 * 1 020 s, Orme 7 200 s) — deliberately *not* the `{6000, 10000}` placeholder
 * the Lua scripts carry under a `-- TODO: Fix respawn timers`.
 *
 * ── What this importer deliberately drops ──────────────────────────────────
 *
 *  - `jobs_data.AP` — four ascending numbers per job whose meaning is not
 *    established. The craft-slot ladder is a 1.29 rule written in
 *    `modules/jobs/craft.rules.ts`, not a dump column (QA-136);
 *  - `jobs_data.crafts` and `jobs_data.skills` — both restate a link the
 *    bundles already carry (`SK[id].cl`, and `IO.d[id].sk` via
 *    `interactive_objects_templates.skills`);
 *  - `game.sql:runes` — forgemagie, out of scope, no consumer.
 *
 * `job_gatherable_cells` is a referential and is rebuilt wholesale. Its live
 * twin `gatherable_cell_states` is **never touched here**: a re-import must
 * not wipe a respawn in flight.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { CamelCasePlugin, Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

import { decodeCells } from "../src/core/modules/maps/maps.cells-codec.ts";
import { insertRows, langBundlePath, toRecord } from "./starloco-dump.ts";

const dumpPath = process.argv[2];

if (!dumpPath) {
  console.error(
    "usage: bun run scripts/import-starloco-jobs.ts <path/to/game.sql>"
  );
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

// biome-ignore lint/suspicious/noExplicitAny: this importer writes to tables named at runtime (`upsert(table, …)`), so it cannot be bound to the `DB` interface — a typed Kysely rejects `insertInto(string)` outright.
const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

const BATCH = 500;

/** Inserts in batches, no conflict handling — for tables truncated first. */
async function insertAll(
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insertInto(table)
      .values(rows.slice(i, i + BATCH))
      .execute();
  }
}

/** Upserts in batches, replacing every column the importer owns. */
async function upsert(
  table: string,
  conflict: string[],
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const columns = Object.keys(rows[0]!).filter((c) => !conflict.includes(c));

  // biome-ignore lint/suspicious/noExplicitAny: builder callbacks inherit the untyped `Kysely<any>` above, so there is no narrower type to give them.
  const onConflict = (oc: any) =>
    (conflict.length === 1
      ? oc.column(conflict[0]!)
      : oc.columns(conflict)
    ).doUpdateSet((eb: { ref: (c: string) => unknown }) =>
      Object.fromEntries(columns.map((c) => [c, eb.ref(`excluded.${c}`)]))
    );

  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insertInto(table)
      .values(rows.slice(i, i + BATCH))
      .onConflict(onConflict)
      .execute();
  }
}

/** `job_skills.kind`, mirroring `JobSkillKind` in `shared/db/schema.ts`. */
const KIND_NONE = 0;
const KIND_HARVEST = 1;
const KIND_CRAFT = 2;
const KIND_FORGEMAGIE = 3;

/** `IO.d[id].t` — a harvestable resource. */
const RESOURCE_TYPE = 1;

/** Every rejection is counted under a reason, and every reason is printed. */
const rejects = new Map<string, number>();

function reject(reason: string): void {
  rejects.set(reason, (rejects.get(reason) ?? 0) + 1);
}

console.log(`reading ${basename(dumpPath)}…`);
const dump = readFileSync(dumpPath, "utf8");

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

const jobsLang = JSON.parse(readFileSync(langBundlePath("jobs"), "utf8")).data
  .J as Record<string, { n: string; s?: number; g?: number }>;

const skillsLang = JSON.parse(readFileSync(langBundlePath("skills"), "utf8"))
  .data.SK as Record<
  string,
  {
    d: string;
    j: number;
    io: number;
    c?: string;
    i?: number;
    cl?: number[];
    f?: number;
  }
>;

const craftsLang = JSON.parse(readFileSync(langBundlePath("crafts"), "utf8"))
  .data.CR as Record<string, [number, number][]>;

const io = JSON.parse(
  readFileSync(langBundlePath("interactiveobjects"), "utf8")
).data.IO as {
  g: Record<string, number>;
  d: Record<string, { n: string; t: number; sk?: number[] }>;
};

type UpstreamSkill = {
  skillId: number;
  jobId: number;
  itemId: number;
  minLevel: number;
  xp: number;
  fixedDurationMs?: number;
  quantityMin?: number;
  quantityMax?: number;
};

const upstream = JSON.parse(
  readFileSync(
    new URL("../data/starloco-job-skills.json", import.meta.url).pathname,
    "utf8"
  )
) as {
  source: { repository: string; retrieved: string };
  skills: UpstreamSkill[];
};

const upstreamBySkill = new Map(upstream.skills.map((s) => [s.skillId, s]));

console.log(
  `upstream harvest table: ${upstream.skills.length} rows from ` +
    `${upstream.source.repository} (${upstream.source.retrieved})`
);

/** gfx id → the `IO.d` entry it resolves to. */
function ioByGfx(gfx: number): { n: string; t: number; sk?: number[] } | null {
  const entryId = io.g[String(gfx)];
  return entryId === undefined ? null : (io.d[String(entryId)] ?? null);
}

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------

const jobs: Record<string, unknown>[] = [];
const knownJobIds = new Set<number>();

for (const [key, entry] of Object.entries(jobsLang)) {
  const id = Number.parseInt(key, 10);

  if (!Number.isFinite(id) || !entry.n) {
    reject("job: unparsable id or empty name");
    continue;
  }

  // The five junk rows carry no icon and duplicate a real job's name in
  // lowercase ('joaillier', 'paysan', 'Coupe'…). `g` is what tells them apart:
  // every real job has one, `-Base-` included (it is -1).
  if (entry.g === undefined || entry.g === 0) {
    reject("job: no icon id (lowercase duplicate placeholder row)");
    continue;
  }

  jobs.push({
    id,
    name: entry.n,
    maxLevel: 100,
    gfxId: Math.max(0, entry.g),
    specializationOf: entry.s ?? 0,
  });
  knownJobIds.add(id);
}

await upsert("jobs", ["id"], jobs);
console.log(`jobs: ${jobs.length} imported of ${Object.keys(jobsLang).length}`);

// ---------------------------------------------------------------------------
// job_skills
// ---------------------------------------------------------------------------

const skills: Record<string, unknown>[] = [];
const craftSkillByResult = new Map<number, number>();
const harvestWithoutUpstream: string[] = [];
let harvestCount = 0;
let craftCount = 0;
let fmCount = 0;

for (const [key, entry] of Object.entries(skillsLang)) {
  const id = Number.parseInt(key, 10);

  if (!Number.isFinite(id)) {
    reject("skill: unparsable id");
    continue;
  }

  if (!knownJobIds.has(entry.j)) {
    // Jobs 0, 32 and 33 do not exist in the 1.29 `J` table at all: three
    // skills ("Faire de la Bière", "Forger une Faux", "Forger une Pioche")
    // are orphans in the retail data itself.
    reject(`skill: job ${entry.j} is absent from the 1.29 jobs table`);
    continue;
  }

  let kind = KIND_NONE;

  if (entry.i !== undefined) {
    kind = KIND_HARVEST;
    harvestCount++;
  } else if (entry.cl !== undefined) {
    kind = KIND_CRAFT;
    craftCount++;
    for (const result of entry.cl) {
      craftSkillByResult.set(result, id);
    }
  } else if (entry.f !== undefined) {
    kind = KIND_FORGEMAGIE;
    fmCount++;
  }

  const source = upstreamBySkill.get(id);

  if (kind === KIND_HARVEST) {
    if (!source) {
      // Jobless gathers the upstream scripts do not define. They import so
      // the menu can label them, with a null experience so the harvest
      // service refuses them rather than inventing a reward.
      harvestWithoutUpstream.push(`${id} "${entry.d}"`);
    } else if (source.itemId !== entry.i) {
      // The upstream table is keyed on this bundle; a mismatch means the
      // transcription drifted and nothing below it can be trusted.
      throw new Error(
        `skill ${id}: upstream says item ${source.itemId}, the 1.29 bundle ` +
          `says ${entry.i} — the two disagree, fix data/starloco-job-skills.json`
      );
    } else if (source.jobId !== entry.j) {
      throw new Error(
        `skill ${id}: upstream says job ${source.jobId}, the 1.29 bundle ` +
          `says ${entry.j}`
      );
    }
  }

  skills.push({
    id,
    jobId: entry.j,
    name: entry.d,
    interactiveId: entry.io ?? null,
    toolItemId: null,
    minLevel: source?.minLevel ?? 1,
    action: 0,
    kind,
    harvestItemId: entry.i ?? null,
    harvestXp: kind === KIND_HARVEST ? (source?.xp ?? null) : null,
    fixedDurationMs: source?.fixedDurationMs ?? null,
    quantityMin: source?.quantityMin ?? null,
    quantityMax: source?.quantityMax ?? null,
    criteria: entry.c ?? "",
    fmItemType: entry.f ?? null,
  });
}

await upsert("job_skills", ["id"], skills);
console.log(
  `job skills: ${skills.length} imported — ${harvestCount} harvest, ` +
    `${craftCount} craft, ${fmCount} forgemagie`
);

if (harvestWithoutUpstream.length > 0) {
  console.log(
    `  ${harvestWithoutUpstream.length} harvest skills have no upstream ` +
      `level/xp and stay unusable: ${harvestWithoutUpstream.join(", ")}`
  );
}

// ---------------------------------------------------------------------------
// job_tools
// ---------------------------------------------------------------------------

const JOBS_DATA_COLUMNS = [
  "id",
  "name",
  "tools",
  "crafts",
  "skills",
  "ap",
] as const;

const templateIds = new Set<number>(
  (await db.selectFrom("itemTemplates").select("id").execute()).map(
    (r: { id: number }) => r.id
  )
);

const tools: Record<string, unknown>[] = [];
let jobsDataRows = 0;

for (const values of insertRows(dump, "jobs_data")) {
  const row = toRecord(JOBS_DATA_COLUMNS, values);
  const jobId = Number.parseInt(row.id, 10);
  jobsDataRows++;

  if (!knownJobIds.has(jobId)) {
    // Four `jobs_data` rows are workbenches rather than jobs — "Etabli à
    // Patates", "Établi Moon", "Briser des ressources", "Fée d'Artifice".
    // They carry no tools and have no entry in the bundle.
    reject(`tools: jobs_data row ${row.id} "${row.name}" is not a job`);
    continue;
  }

  for (const part of row.tools.split(",")) {
    const templateId = Number.parseInt(part.trim(), 10);

    if (!Number.isFinite(templateId)) {
      continue;
    }
    if (!templateIds.has(templateId)) {
      reject("tools: item template not in the 1.29 bundle");
      continue;
    }

    tools.push({ jobId, templateId });
  }
}

await sql`TRUNCATE job_tools`.execute(db);
await insertAll("job_tools", tools);
console.log(
  `job tools: ${tools.length} imported from ${jobsDataRows} jobs_data rows`
);

// ---------------------------------------------------------------------------
// recipes
// ---------------------------------------------------------------------------

const recipes: Record<string, unknown>[] = [];

for (const [key, ingredients] of Object.entries(craftsLang)) {
  const resultItemId = Number.parseInt(key, 10);

  if (!Number.isFinite(resultItemId) || !Array.isArray(ingredients)) {
    reject("recipe: unparsable entry");
    continue;
  }

  const skillId = craftSkillByResult.get(resultItemId);

  if (skillId === undefined) {
    reject("recipe: no craft skill lists this result");
    continue;
  }

  recipes.push({
    resultItemId,
    skillId,
    skillLevel: 1,
    ingredients: JSON.stringify(
      ingredients.map(([quantity, itemId]) => ({ quantity, itemId }))
    ),
  });
}

await upsert("recipes", ["resultItemId"], recipes);
console.log(
  `recipes: ${recipes.length} imported of ${Object.keys(craftsLang).length}`
);

// ---------------------------------------------------------------------------
// job_gatherable_cells — the scan
// ---------------------------------------------------------------------------

const templateBySkill = new Map<number, { respawnMs: number }>();

for (const template of await db
  .selectFrom("interactiveObjectsTemplates")
  .select(["id", "skills", "respawnMs", "type"])
  .execute()) {
  const t = template as {
    id: number;
    skills: string;
    respawnMs: number;
    type: number;
  };

  if (t.type !== RESOURCE_TYPE) {
    continue;
  }

  for (const part of t.skills.split(",")) {
    const skillId = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(skillId)) {
      templateBySkill.set(skillId, { respawnMs: t.respawnMs });
    }
  }
}

const harvestSkillIds = new Set(
  skills
    .filter((s) => s.kind === KIND_HARVEST && s.harvestXp !== null)
    .map((s) => s.id as number)
);

const mapRows = await db.selectFrom("maps").select(["id", "cells"]).execute();

const gatherable: Record<string, unknown>[] = [];
let interactiveCells = 0;

for (const map of mapRows as { id: number; cells: Uint8Array | null }[]) {
  if (!map.cells || map.cells.length === 0) {
    continue;
  }

  let cells: ReturnType<typeof decodeCells>;

  try {
    cells = decodeCells(map.cells);
  } catch {
    reject("gatherable: undecodable map payload");
    continue;
  }

  for (const cell of cells) {
    if (!cell.layerObject2Interactive) {
      continue;
    }

    interactiveCells++;

    const entry = ioByGfx(cell.layer2);

    if (!entry || entry.t !== RESOURCE_TYPE) {
      continue;
    }

    // A resource model offers exactly one harvest skill in 1.29; take the
    // first one the server can actually run.
    const skillId = (entry.sk ?? []).find((s) => harvestSkillIds.has(s));

    if (skillId === undefined) {
      reject("gatherable: resource model offers no usable harvest skill");
      continue;
    }

    const skill = skills.find((s) => s.id === skillId);
    const respawnMs = templateBySkill.get(skillId)?.respawnMs ?? 0;

    if (respawnMs <= 0) {
      reject("gatherable: template carries no respawn delay");
      continue;
    }

    gatherable.push({
      mapId: map.id,
      cellId: cell.id,
      resourceItemId: skill?.harvestItemId ?? null,
      skillId,
      respawnSeconds: Math.round(respawnMs / 1000),
    });
  }
}

// A referential, rebuilt wholesale. `gatherable_cell_states` is not touched:
// a re-import must not wipe a respawn in flight.
await sql`TRUNCATE job_gatherable_cells`.execute(db);
await insertAll("job_gatherable_cells", gatherable);

console.log(
  `gatherable cells: ${gatherable.length} imported of ${interactiveCells} ` +
    `interactive cells across ${mapRows.length} maps`
);

// ---------------------------------------------------------------------------

if (rejects.size > 0) {
  console.log("rejected:");
  for (const [reason, count] of [...rejects].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(6)}  ${reason}`);
  }
}

const counts = await sql<Record<string, number>>`
  SELECT
    (SELECT count(*)::int FROM jobs)                   AS "jobs",
    (SELECT count(*)::int FROM job_skills)             AS "jobSkills",
    (SELECT count(*)::int FROM job_skills WHERE kind = 1 AND harvest_xp IS NOT NULL)
                                                       AS "harvestSkills",
    (SELECT count(*)::int FROM job_tools)              AS "jobTools",
    (SELECT count(*)::int FROM recipes)                AS "recipes",
    (SELECT count(*)::int FROM job_gatherable_cells)   AS "gatherableCells"
`
  .execute(db)
  .then((r) => r.rows[0]);

console.log(
  `done — ${Object.entries(counts ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}`
);

await db.destroy();
