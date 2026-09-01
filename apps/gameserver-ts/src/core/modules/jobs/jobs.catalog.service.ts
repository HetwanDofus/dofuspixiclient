import type { JobSkillKindValue } from "@shared/db/schema";
import { JobsRepository } from "@modules/jobs/jobs.repository";
import { BASE_JOB_ID } from "@modules/jobs/jobs.rules";
import { Injectable } from "@nestjs/common";
import { JobSkillKind } from "@shared/db/schema";

export interface JobEntry {
  id: number;
  name: string;
  gfxId: number;
  specializationOf: number;
  maxLevel: number;
}

export interface SkillEntry {
  id: number;
  jobId: number;
  name: string;
  kind: JobSkillKindValue;
  minLevel: number;
  harvestItemId: number | null;
  harvestXp: number | null;
  fixedDurationMs: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  criteria: string;
}

/**
 * The jobs referential, held in memory.
 *
 * It is 34 jobs, 144 skills and 70 tools, written only by
 * `scripts/import-starloco-jobs.ts` and never at runtime — so it is loaded
 * once and pinned, the same call the map cache makes for the same reason.
 * Every harvest attempt asks it three questions (does this skill exist, what
 * does it need, is this equipped item its tool), and none of them should be a
 * round trip.
 */
@Injectable()
export class JobsCatalogService {
  private jobs = new Map<number, JobEntry>();
  private skills = new Map<number, SkillEntry>();
  /** templateId → the jobs that accept it as a tool. */
  private toolJobs = new Map<number, Set<number>>();
  private loading: Promise<void> | null = null;

  constructor(private readonly repo: JobsRepository) {}

  async load(): Promise<void> {
    if (this.loading) {
      return this.loading;
    }

    this.loading = (async () => {
      const [jobs, skills, tools] = await Promise.all([
        this.repo.findAllJobs(),
        this.repo.findAllSkills(),
        this.repo.findAllTools(),
      ]);

      this.jobs = new Map(jobs.map((j) => [j.id, j]));
      this.skills = new Map(
        skills.map((s) => [
          s.id,
          { ...s, kind: s.kind as JobSkillKindValue } satisfies SkillEntry,
        ])
      );

      this.toolJobs = new Map();
      for (const tool of tools) {
        const jobsForTool =
          this.toolJobs.get(tool.templateId) ?? new Set<number>();
        jobsForTool.add(tool.jobId);
        this.toolJobs.set(tool.templateId, jobsForTool);
      }
    })();

    return this.loading;
  }

  job(id: number): JobEntry | undefined {
    return this.jobs.get(id);
  }

  skill(id: number): SkillEntry | undefined {
    return this.skills.get(id);
  }

  /** Every skill of a job, in the order the `JS` frame lists them. */
  skillsOfJob(jobId: number): SkillEntry[] {
    return [...this.skills.values()]
      .filter((s) => s.jobId === jobId)
      .sort((a, b) => a.id - b.id);
  }

  /**
   * Whether this item template is a tool of that job.
   *
   * The referential is the curated `jobs_data.tools` list, not the item's
   * type: a combat axe is a type-19 Hache and is not a Bûcheron's tool.
   */
  isToolOf(templateId: number, jobId: number): boolean {
    return this.toolJobs.get(templateId)?.has(jobId) ?? false;
  }

  /** Whether this item template is any job's tool — what `OT` announces. */
  isTool(templateId: number): boolean {
    return this.toolJobs.has(templateId);
  }

  /**
   * The job this tool belongs to, for `OT`. No template in the imported
   * referential serves two jobs, so the first is the answer.
   */
  jobOfTool(templateId: number): number | null {
    const [first] = this.toolJobs.get(templateId) ?? [];

    return first ?? null;
  }

  /**
   * The jobless gathers the server implements.
   *
   * `-Base-` (job 1) is not a job and nobody holds a row for it, so its
   * skills would never reach a client through the ordinary "your jobs" list.
   * They are sent alongside it instead — see `JobsFramesService.sendSkills`.
   */
  runnableBaseSkills(): SkillEntry[] {
    return [...this.skills.values()]
      .filter(
        (skill) =>
          skill.jobId === BASE_JOB_ID &&
          skill.kind === JobSkillKind.Harvest &&
          skill.harvestXp !== null
      )
      .sort((a, b) => a.id - b.id);
  }

  /**
   * A harvest skill the server can actually run. The three jobless gathers
   * the retail scripts never defined (`Ramasser`, `Jouer`, `Pêcher KoinKoin`)
   * import without an experience value, and this is what keeps them out.
   */
  runnableHarvestSkill(id: number): SkillEntry | undefined {
    const skill = this.skills.get(id);

    return skill?.kind === JobSkillKind.Harvest && skill.harvestXp !== null
      ? skill
      : undefined;
  }
}
