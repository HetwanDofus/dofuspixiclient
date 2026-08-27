/**
 * Explain a migration divergence before kysely dies on it.
 *
 * Kysely refuses to run when `kysely_migration` names a migration whose
 * file is not in `migrations/` — rightly so, since the database then
 * carries a schema this checkout cannot describe. What it says is
 *
 *   corrupted migrations: previously executed migration X is missing
 *
 * followed by fifteen frames of its own internals, and that wording sends
 * you looking for a damaged database. The database is fine. You migrated
 * it on a feature branch and went back to `main`; the file left with the
 * branch.
 *
 * So: same check, run first, but it reports *which branch* holds each
 * missing file and the exact rollback that reconciles the two. It never
 * writes — rolling back is destructive, and which way to reconcile is a
 * judgement call (roll the database back, or check the branch out again).
 *
 *   DATABASE_URL=... bun run scripts/check-migrations.ts
 *
 * Exit 1 on divergence, 0 otherwise. A database it cannot reach is not a
 * divergence: it stays quiet and lets `db:migrate` report the connection
 * failure itself, rather than printing a second, vaguer copy of it.
 */
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

/** `undefined_table` — a database that has never been migrated. */
const UNDEFINED_TABLE = "42P01";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(SCRIPT_DIR, "../migrations");

/** Where a migration file sits, seen from the repository root. */
function repoPath(name: string): string {
  return `apps/gameserver-ts/migrations/${name}.ts`;
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

/** Migration names recorded in the database, or null if it is unreachable. */
async function recordedMigrations(): Promise<string[] | null> {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });

  try {
    const { rows } = await pool.query<{ name: string }>(
      "SELECT name FROM kysely_migration ORDER BY name"
    );
    return rows.map((row) => row.name);
  } catch (error) {
    if ((error as { code?: string }).code === UNDEFINED_TABLE) {
      return [];
    }
    return null;
  } finally {
    await pool.end();
  }
}

async function migrationFiles(): Promise<Set<string>> {
  const entries = await readdir(MIGRATIONS_DIR);
  return new Set(
    entries
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.slice(0, -".ts".length))
  );
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function repoRoot(): string | null {
  try {
    return git(["rev-parse", "--show-toplevel"], SCRIPT_DIR);
  } catch {
    return null;
  }
}

function refsUnder(root: string, namespace: string): string[] {
  return git(["for-each-ref", "--format=%(refname:short)", namespace], root)
    .split("\n")
    .filter((ref) => ref.length > 0 && !ref.endsWith("/HEAD"));
}

/**
 * Branches whose tip still carries the file, local ones first.
 *
 * Asking each branch for the blob is more honest than walking history for
 * the commit that added it: a branch that added a migration and later
 * dropped it is not somewhere you can go to get the file back. A remote
 * ref is only reported when no local branch already answers for it —
 * `origin/x` and `x` are the same answer, and `x` is the one you check
 * out.
 */
function branchesHolding(root: string, name: string): string[] {
  const path = repoPath(name);

  const holds = (ref: string): boolean => {
    try {
      git(["cat-file", "-e", `${ref}:${path}`], root);
      return true;
    } catch {
      return false;
    }
  };

  const locals = refsUnder(root, "refs/heads").filter(holds);
  const known = new Set(locals);

  // `refs/remotes` short names are `<remote>/<branch>`; the branch is
  // everything after the first slash, since branch names may contain one.
  const remotes = refsUnder(root, "refs/remotes")
    .filter(holds)
    .filter((ref) => !known.has(ref.slice(ref.indexOf("/") + 1)));

  return [...locals, ...remotes];
}

const recorded = await recordedMigrations();
if (recorded === null) {
  process.exit(0);
}

const present = await migrationFiles();
const missing = recorded.filter((name) => !present.has(name));

/**
 * The mirror failure: a file that has never run, but sorts *before* one
 * that has. Kysely runs migrations in name order and requires what ran to
 * be a prefix of what exists, so it refuses this too — and calls it
 * "corrupted migrations" as well. It is what merging a branch into a
 * checkout whose database is already past its numbers produces.
 */
const lastApplied = recorded.at(-1) ?? "";
const late = [...present]
  .sort()
  .filter((name) => !recorded.includes(name) && name < lastApplied);

if (missing.length === 0 && late.length === 0) {
  process.exit(0);
}

if (missing.length === 0) {
  const plural = late.length > 1 ? "s" : "";
  const steps =
    recorded.length - recorded.findIndex((n) => n > (late[0] ?? ""));

  console.error(
    `\n${late.length} migration${plural} sort${plural === "" ? "s" : ""} ` +
      `before ${lastApplied}, which this database has already run:\n`
  );
  for (const name of late) {
    console.error(`  ${name}`);
  }
  // `db:rollback` is refused here too — kysely runs the same consistency
  // check before going down as before going up, so the files have to be
  // out of the folder for it to see a database it agrees with. Park them,
  // undo, put them back, migrate: the rollback then re-runs them in order.
  console.error(
    "\nKysely runs migrations in name order and will not slip one in\n" +
      "underneath — nor roll back while they sit there. Park them, undo\n" +
      `the ${steps} migration${steps > 1 ? "s" : ""} above them, put them ` +
      "back, migrate. Take a dump first:\n\n" +
      "  docker compose exec -T postgres pg_dump -U dofus -Fc dofus " +
      "> backup.dump\n" +
      "  mkdir -p /tmp/mig-park\n" +
      `  mv ${late.map(repoPath).join(" ")} /tmp/mig-park/\n` +
      `  (cd apps/gameserver-ts && for i in $(seq ${steps}); do ` +
      "bun run db:rollback; done)\n" +
      "  mv /tmp/mig-park/*.ts apps/gameserver-ts/migrations/\n" +
      "  just db-migrate\n"
  );
  process.exit(1);
}

const root = repoRoot();
const holders = new Map<string, string[]>(
  missing.map((name) => [
    name,
    root === null ? [] : branchesHolding(root, name),
  ])
);

const many = missing.length > 1;
console.error(
  `\n${missing.length} migration${many ? "s" : ""} recorded in this ` +
    `database ${many ? "have" : "has"} no file in migrations/:\n`
);

for (const name of missing) {
  const branches = holders.get(name) ?? [];
  console.error(
    `  ${name} — ${
      branches.length > 0
        ? `lives on ${branches.join(", ")}`
        : "is on no branch in this checkout"
    }`
  );
}

console.error(
  "\nThe database is not corrupt: it was migrated on another branch and\n" +
    "carries a schema this checkout does not describe. Reconcile the two,\n" +
    "after taking a dump:\n\n" +
    "  docker compose exec -T postgres pg_dump -U dofus -Fc dofus " +
    "> backup.dump\n"
);

// Rolling back stops at the oldest missing migration, so every migration
// recorded at or after it has to come off — including the ones this
// checkout does have.
const oldest = missing[0] ?? "";
const steps = recorded.length - recorded.indexOf(oldest);

console.error(
  `Either roll the database back to this branch. Restore the file${
    many ? "s" : ""
  },\n` +
    `undo the ${steps} migration${steps > 1 ? "s" : ""} from ${oldest} up, ` +
    `then drop ${many ? "them" : "it"} again:\n`
);

for (const name of missing) {
  const branch = holders.get(name)?.[0] ?? "<branch>";
  console.error(`  git show ${branch}:${repoPath(name)} > ${repoPath(name)}`);
}

console.error(
  `  (cd apps/gameserver-ts && for i in $(seq ${steps}); do ` +
    "bun run db:rollback; done)\n" +
    `  rm ${missing.map(repoPath).join(" ")}\n` +
    "  just db-migrate\n\n" +
    "Or check out the branch the database already matches, if that is\n" +
    "where the work is.\n"
);

process.exit(1);
