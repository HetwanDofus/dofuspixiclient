/**
 * Index et validation du suivi d'issues de `doc/issues/`.
 *
 *   bun run scripts/issues.ts          régénère doc/issues/README.md
 *   bun run scripts/issues.ts --check  valide sans écrire (sort 1 si KO)
 *
 * Le dossier porte le domaine, le frontmatter porte gravité et statut : c'est
 * la seule source de vérité. Ce script ne fait que la relire.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ISSUES_DIR = join(import.meta.dir, "..", "doc", "issues");
const INDEX_FILE = join(ISSUES_DIR, "README.md");
const MARKER_START = "<!-- issues:start -->";
const MARKER_END = "<!-- issues:end -->";

const SEVERITIES = ["P0", "P1", "P2", "P3", "none"] as const;
const STATUSES = [
  "open",
  "confirmed",
  "in-progress",
  "fixed",
  "closed",
  "wontfix",
] as const;
const TYPES = ["bug", "gap", "feature", "data", "test-gap", "check"] as const;

/** Statuts qui ne demandent plus de travail. */
const DONE: ReadonlySet<string> = new Set(["closed", "wontfix"]);

const SEVERITY_LABEL: Record<string, string> = {
  P0: "P0 — bloque la session (crash, impossible d'avancer)",
  P1: "P1 — fonctionnalité cassée ou absente sur un flux principal",
  P2: "P2 — comportement divergent du 1.29 canonique, contournable",
  P3: "P3 — finition, confort, cosmétique",
  none: "Sans gravité — vérifications sans défaut",
};

const STATUS_LABEL: Record<string, string> = {
  open: "observé, non reproduit méthodiquement",
  confirmed: "reproduit, preuve au dossier",
  "in-progress": "correctif engagé",
  fixed: "correctif livré, reste à revérifier manette en main",
  closed: "vérifié, clos",
  wontfix: "écarté, avec la raison en fiche",
};

type Issue = {
  id: string;
  title: string;
  severity: string;
  domain: string;
  type: string;
  status: string;
  session: string;
  opened: string;
  closed: string;
  fixed_in: string;
  related: string[];
  files: string[];
  path: string;
};

const FIELDS = [
  "id",
  "title",
  "severity",
  "domain",
  "type",
  "status",
  "session",
  "opened",
] as const;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Frontmatter YAML volontairement minimal : scalaires, listes en ligne
 * `[a, b]` et listes en blocs `- a`. Assez pour ce schéma, zéro dépendance.
 */
function parseFrontmatter(raw: string, path: string): Record<string, string[]> {
  if (!raw.startsWith("---\n")) {
    throw new Error(`${path}: pas de frontmatter en tête de fichier`);
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    throw new Error(`${path}: frontmatter non refermé`);
  }

  const out: Record<string, string[]> = {};
  let key: string | null = null;

  for (const line of raw.slice(4, end).split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item?.[1] !== undefined && key !== null) {
      out[key]?.push(unquote(item[1]));
      continue;
    }

    const pair = /^([a-z_]+):(.*)$/.exec(line);
    if (!pair?.[1]) {
      throw new Error(`${path}: ligne illisible « ${line} »`);
    }
    key = pair[1];
    const value = (pair[2] ?? "").trim();

    if (value.startsWith("[")) {
      const inner = value.slice(1, value.lastIndexOf("]"));
      out[key] = inner
        .split(",")
        .map((entry) => unquote(entry))
        .filter((entry) => entry !== "");
    } else {
      out[key] = value === "" ? [] : [unquote(value)];
    }
  }
  return out;
}

async function load(): Promise<{ issues: Issue[]; errors: string[] }> {
  const errors: string[] = [];
  const issues: Issue[] = [];
  const domains = (await readdir(ISSUES_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const domain of domains.sort()) {
    const dir = join(ISSUES_DIR, domain);
    for (const name of (await readdir(dir)).sort()) {
      if (!name.endsWith(".md")) {
        continue;
      }
      const path = join(dir, name);
      const rel = relative(ISSUES_DIR, path);
      let fm: Record<string, string[]>;
      try {
        fm = parseFrontmatter(await readFile(path, "utf8"), rel);
      } catch (error) {
        errors.push(String(error instanceof Error ? error.message : error));
        continue;
      }

      const one = (field: string): string => fm[field]?.[0] ?? "";
      for (const field of FIELDS) {
        if (one(field) === "") {
          errors.push(`${rel}: champ « ${field} » vide`);
        }
      }

      const issue: Issue = {
        id: one("id"),
        title: one("title"),
        severity: one("severity"),
        domain: one("domain"),
        type: one("type"),
        status: one("status"),
        session: one("session"),
        opened: one("opened"),
        closed: one("closed"),
        fixed_in: one("fixed_in"),
        related: fm.related ?? [],
        files: fm.files ?? [],
        path: rel,
      };

      const enums: [string, string, readonly string[]][] = [
        ["severity", issue.severity, SEVERITIES],
        ["status", issue.status, STATUSES],
        ["type", issue.type, TYPES],
      ];
      for (const [field, value, allowed] of enums) {
        if (value !== "" && !allowed.includes(value)) {
          errors.push(`${rel}: ${field} « ${value} » hors de [${allowed}]`);
        }
      }
      if (issue.domain !== domain) {
        errors.push(
          `${rel}: domain « ${issue.domain} » ≠ dossier « ${domain} »`
        );
      }
      if (!name.startsWith(`${issue.id}-`)) {
        errors.push(
          `${rel}: le nom de fichier ne commence pas par « ${issue.id}- »`
        );
      }
      if (DONE.has(issue.status) && issue.closed === "") {
        errors.push(`${rel}: statut « ${issue.status} » sans date « closed »`);
      }
      issues.push(issue);
    }
  }

  const byId = new Map<string, string>();
  for (const issue of issues) {
    const seen = byId.get(issue.id);
    if (seen) {
      errors.push(`${issue.path}: id ${issue.id} déjà pris par ${seen}`);
    }
    byId.set(issue.id, issue.path);
  }
  for (const issue of issues) {
    for (const ref of issue.related) {
      if (!byId.has(ref)) {
        errors.push(`${issue.path}: related ${ref} n'existe pas`);
      }
    }
  }

  return { issues, errors };
}

function tally(issues: Issue[], key: keyof Issue, keys: readonly string[]) {
  return keys.map((value) => ({
    value,
    total: issues.filter((issue) => issue[key] === value).length,
    left: issues.filter(
      (issue) => issue[key] === value && !DONE.has(issue.status)
    ).length,
  }));
}

function row(issue: Issue): string {
  const link = `[${issue.id}](${issue.path})`;
  const done = DONE.has(issue.status);
  return `| ${link} | ${issue.severity} | ${issue.domain} | ${issue.type} | ${issue.status} | ${done ? `~~${issue.title}~~` : issue.title} |`;
}

function render(issues: Issue[]): string {
  const sorted = [...issues].sort((a, b) => a.id.localeCompare(b.id));
  const left = sorted.filter((issue) => !DONE.has(issue.status));
  const out: string[] = [];

  out.push(
    `_Généré par \`just issues\` — ne pas éditer à la main entre les marqueurs._`,
    "",
    `**${sorted.length} entrées**, dont **${left.length} encore ouvertes**.`,
    "",
    "## Par gravité",
    "",
    "| Gravité | Restantes | Total |",
    "|---|---|---|"
  );
  for (const bucket of tally(sorted, "severity", SEVERITIES)) {
    if (bucket.total === 0) {
      continue;
    }
    out.push(
      `| ${SEVERITY_LABEL[bucket.value] ?? bucket.value} | ${bucket.left} | ${bucket.total} |`
    );
  }

  out.push("", "## Par statut", "", "| Statut | Entrées |", "|---|---|");
  for (const bucket of tally(sorted, "status", STATUSES)) {
    if (bucket.total === 0) {
      continue;
    }
    out.push(
      `| \`${bucket.value}\` — ${STATUS_LABEL[bucket.value] ?? ""} | ${bucket.total} |`
    );
  }

  const domains = [...new Set(sorted.map((issue) => issue.domain))].sort();
  out.push(
    "",
    "## Par domaine",
    "",
    "| Domaine | Restantes | Total |",
    "|---|---|---|"
  );
  for (const domain of domains) {
    const all = sorted.filter((issue) => issue.domain === domain);
    const rest = all.filter((issue) => !DONE.has(issue.status));
    out.push(
      `| [\`${domain}/\`](${domain}/) | ${rest.length} | ${all.length} |`
    );
  }

  for (const severity of SEVERITIES) {
    const bucket = sorted.filter((issue) => issue.severity === severity);
    if (bucket.length === 0) {
      continue;
    }
    out.push(
      "",
      `## ${SEVERITY_LABEL[severity] ?? severity}`,
      "",
      "| # | Gravité | Domaine | Type | Statut | Titre |",
      "|---|---|---|---|---|---|",
      ...bucket.map(row)
    );
  }

  return out.join("\n");
}

const check = process.argv.includes("--check");
const { issues, errors } = await load();

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`✗ ${error}`);
  }
  console.error(`\n${errors.length} problème(s) dans doc/issues/`);
  process.exit(1);
}

const template = await readFile(INDEX_FILE, "utf8");
const start = template.indexOf(MARKER_START);
const end = template.indexOf(MARKER_END);
if (start === -1 || end === -1) {
  console.error(
    `✗ ${INDEX_FILE} : marqueurs ${MARKER_START} / ${MARKER_END} absents`
  );
  process.exit(1);
}

const next =
  template.slice(0, start + MARKER_START.length) +
  `\n\n${render(issues)}\n\n` +
  template.slice(end);

if (check) {
  if (next !== template) {
    console.error(
      "✗ doc/issues/README.md n'est pas à jour — lancer `just issues`"
    );
    process.exit(1);
  }
  console.log(`✓ ${issues.length} issues valides, index à jour`);
} else {
  await writeFile(INDEX_FILE, next);
  console.log(`✓ ${issues.length} issues indexées dans doc/issues/README.md`);
}
