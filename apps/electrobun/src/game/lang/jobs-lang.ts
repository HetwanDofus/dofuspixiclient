import { createLogger } from "@/utils/logger";

const log = createLogger("JobsLang");

const LOCALE = "fr";
const JOBS_BUNDLE_URL = `/assets/langs/${LOCALE}/jobs.json`;
const SKILLS_BUNDLE_URL = `/assets/langs/${LOCALE}/skills.json`;

/**
 * The two job tables the HUD needs, straight from the 1.29 lang bundles —
 * the same `J` and `SK` the server imports (`import-starloco-jobs.ts`).
 *
 * Only the *naming* half lives here. Which jobs a character has, at what
 * level, and which skills they may use is `jobs-store`, from the server. A
 * name is the one thing the client is allowed to resolve on its own, exactly
 * as it already does for NPC dialogue and interactive elements.
 */
export interface JobText {
  id: number;
  name: string;
  /** `J[id].g` — the icon id, `clips/jobs/<g>.swf` in 1.29. Not extracted. */
  gfxId: number;
  /** `J[id].s` — 0 for a base job, else the job this one specialises. */
  specializationOf: number;
}

export interface SkillText {
  id: number;
  /** `SK[id].d` — "Couper", "Collecter", "Faucher"… */
  label: string;
  /** `SK[id].j` — the job it belongs to. */
  jobId: number;
  /** `SK[id].i` — the item a harvest yields, when it is one. */
  harvestItemId: number | null;
}

export interface JobsLang {
  jobs: Map<number, JobText>;
  skills: Map<number, SkillText>;
}

type JobsBundle = {
  data?: { J?: Record<string, { n?: string; s?: number; g?: number }> };
};

type SkillsBundle = {
  data?: { SK?: Record<string, { d?: string; j?: number; i?: number }> };
};

let cache: JobsLang | null = null;
let loading: Promise<JobsLang> | null = null;

function parseBundles(jobsJson: unknown, skillsJson: unknown): JobsLang {
  const jobs = new Map<number, JobText>();
  const skills = new Map<number, SkillText>();

  for (const [key, entry] of Object.entries(
    (jobsJson as JobsBundle).data?.J ?? {}
  )) {
    const id = Number.parseInt(key, 10);

    // The bundle carries five lowercase duplicates with no icon id
    // ('joaillier', 'paysan', 'Coupe'…). The server drops them at import for
    // the same reason; dropping them here keeps the two lists identical.
    if (!Number.isFinite(id) || !entry.n || !entry.g) {
      continue;
    }

    jobs.set(id, {
      id,
      name: entry.n,
      gfxId: Math.max(0, entry.g),
      specializationOf: entry.s ?? 0,
    });
  }

  for (const [key, entry] of Object.entries(
    (skillsJson as SkillsBundle).data?.SK ?? {}
  )) {
    const id = Number.parseInt(key, 10);

    if (!Number.isFinite(id)) {
      continue;
    }

    skills.set(id, {
      id,
      label: entry.d ?? String(id),
      jobId: entry.j ?? 0,
      harvestItemId: entry.i ?? null,
    });
  }

  return { jobs, skills };
}

export function loadJobsLang(): Promise<JobsLang> {
  if (cache) {
    return Promise.resolve(cache);
  }

  if (!loading) {
    loading = Promise.all([
      fetch(JOBS_BUNDLE_URL).then((r) => r.json()),
      fetch(SKILLS_BUNDLE_URL).then((r) => r.json()),
    ])
      .then(([jobsJson, skillsJson]) => {
        cache = parseBundles(jobsJson, skillsJson);
        return cache;
      })
      .catch((err) => {
        log.error("failed to load job bundles:", err);
        // Latch empty rather than retry: a job with no name reads as a
        // missing job, which is degraded and never wedged.
        cache = { jobs: new Map(), skills: new Map() };
        return cache;
      });
  }

  return loading;
}

/** What is loaded right now — for synchronous call sites like the menu. */
export function jobsLangSnapshot(): JobsLang | null {
  return cache;
}

export function jobNameOf(jobId: number): string | undefined {
  return cache?.jobs.get(jobId)?.name;
}

/** The job a skill belongs to, or `null` while the bundle is still loading. */
export function jobOfSkill(skillId: number): number | null {
  return cache?.skills.get(skillId)?.jobId ?? null;
}
