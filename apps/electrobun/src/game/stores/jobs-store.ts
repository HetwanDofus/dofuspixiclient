import type {
  ItemTool,
  JobLevel,
  JobOptions,
  JobRemove,
  JobSkills,
  JobXP,
} from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/** One skill of a job, as `JS` describes it. */
export interface JobSkill {
  id: number;
  /**
   * `param1` — the number of craft slots this skill offers at the
   * character's current level. Zero for a harvest skill, which has none.
   * See QA-131 for why the four params are positional.
   */
  slots: number;
  /** `param2` — the job level the skill needs. */
  minLevel: number;
}

/** `JobOptions`'s bitmask, as the decompiled client reads it. */
export const JobOptionBit = {
  /** "Je fais payer". */
  Paid: 1,
  /** "Gratuit si j'échoue". */
  FreeOnFailure: 2,
  /** "Le client fournit les ressources". */
  ClientSupplies: 4,
} as const;

export interface PlayerJob {
  id: number;
  level: number;
  /** Cumulative experience, and the window the gauge draws. */
  experience: number;
  xpMin: number;
  xpMax: number;
  skills: JobSkill[];
  /** `JobOptionBit`s. Sending them is also what lists the artisan. */
  options: number;
  /** The smallest recipe the artisan will take on; never below 2. */
  minSlots: number;
}

/**
 * `-Base-`, the bundle's job 1.
 *
 * Not a job: it carries the actions anyone can perform — drawing water from
 * a well is the only one implemented — and no character ever holds it. The
 * server sends its skills alongside the real ones in `JS` because otherwise
 * a client has no way to know a well is usable at all.
 */
export const BASE_JOB_ID = 1;

export interface JobsState {
  /** Job id → what the character has of it. `-Base-` is never in here. */
  jobs: Map<number, PlayerJob>;
  /** `-Base-`'s skills: no job, no level, no tool. */
  baseSkills: JobSkill[];
  /**
   * The item template in the weapon slot, when it is a job tool — `OT`.
   * `null` means "no tool", which is not the same as "not told yet": the
   * server sends it on every change to that slot, unequips included.
   */
  toolTemplateId: number | null;
  /** The job that tool belongs to; 0 when there is none. */
  toolJobId: number;
  /**
   * The harvest in progress, if any — what draws the gauge over the
   * character. `anchorX`/`anchorY` are canvas-relative pixels, the same
   * space the nameplates use; they are captured once, at the start, because
   * a character that moves has its harvest interrupted anyway.
   */
  harvesting: {
    cellId: number;
    startedAt: number;
    durationMs: number;
    anchorX: number;
    anchorY: number;
  } | null;
}

const initialState: JobsState = {
  jobs: new Map(),
  baseSkills: [],
  toolTemplateId: null,
  toolJobId: 0,
  harvesting: null,
};

/**
 * What the character's jobs are, from the server and only from the server.
 *
 * The client owns no rule here: it does not compute a level from experience,
 * does not know the curve, and does not decide whether a harvest is allowed
 * — `JX` carries the gauge's own bounds and `canUseSkill` below asks about
 * facts the server has already sent. That is what QA-123 means by "the client
 * never simulates the outcome".
 */
export const jobsStore = new ExternalStore<JobsState>(initialState);

/** `JS` — the whole list, replacing whatever was there. */
export function handleJobSkills(payload: JobSkills): void {
  const previous = jobsStore.getSnapshot().jobs;
  const jobs = new Map<number, PlayerJob>();
  let baseSkills: JobSkill[] = [];

  for (const entry of payload.jobs) {
    // `-Base-` travels with the list and is not part of it. Letting it into
    // `jobs` would put "-Base-" in the Métiers panel and in the craftsmen's
    // book, and would have it counted as a job everywhere else.
    if (entry.jobId === BASE_JOB_ID) {
      baseSkills = entry.skills.map((skill) => ({
        id: skill.skillId,
        slots: skill.param1,
        minLevel: skill.param2,
      }));
      continue;
    }

    const known = previous.get(entry.jobId);

    jobs.set(entry.jobId, {
      id: entry.jobId,
      // `JS` carries no level or experience — that is `JX`'s job, and the
      // two arrive together. Keeping what is known avoids a frame where the
      // panel shows every job back at level 1.
      level: known?.level ?? 1,
      experience: known?.experience ?? 0,
      xpMin: known?.xpMin ?? 0,
      xpMax: known?.xpMax ?? 0,
      options: known?.options ?? 0,
      minSlots: known?.minSlots ?? 2,
      skills: entry.skills.map((skill) => ({
        id: skill.skillId,
        slots: skill.param1,
        minLevel: skill.param2,
      })),
    });
  }

  jobsStore.setState({ jobs, baseSkills });
}

/** `JX` — level and the experience window, per job. */
export function handleJobXp(payload: JobXP): void {
  const jobs = new Map(jobsStore.getSnapshot().jobs);

  for (const entry of payload.entries) {
    const known = jobs.get(entry.jobId);

    jobs.set(entry.jobId, {
      id: entry.jobId,
      level: entry.level,
      experience: Number(entry.xpCurrent),
      xpMin: Number(entry.xpMin),
      xpMax: Number(entry.xpMax),
      skills: known?.skills ?? [],
      options: known?.options ?? 0,
      minSlots: known?.minSlots ?? 2,
    });
  }

  jobsStore.setState({ jobs });
}

/**
 * `JN` — a level was gained.
 *
 * `JX` travels with it and carries the authoritative numbers, so this only
 * exists to let the HUD announce it. Writing the level here too would race
 * with the frame that actually knows the experience.
 */
export function handleJobLevel(_payload: JobLevel): void {
  // Intentionally inert: see above. The banner listens to `jobsStore`.
}

/** `JR` — the job is gone. */
export function handleJobRemove(payload: JobRemove): void {
  const jobs = new Map(jobsStore.getSnapshot().jobs);

  if (jobs.delete(payload.jobId)) {
    jobsStore.setState({ jobs });
  }
}

/**
 * `JO` — the artisan's terms came back.
 *
 * The first field is an **index into this list**, not a job id:
 * `aks/Job.as:onOptions` writes `Player.Jobs[index]`. The list is the one
 * `JS` built, in the order it arrived, so the index is resolved against
 * that same ordering here.
 */
export function handleJobOptions(payload: JobOptions): void {
  const ordered = getJobs();
  const target = ordered[payload.jobIndex];

  if (!target) {
    return;
  }

  const jobs = new Map(jobsStore.getSnapshot().jobs);
  jobs.set(target.id, {
    ...target,
    options: payload.option1,
    minSlots: payload.option2,
  });

  jobsStore.setState({ jobs });
}

/** `OT` — what is in the weapon slot, when it is a tool. */
export function handleItemTool(payload: ItemTool): void {
  jobsStore.setState({
    toolTemplateId: payload.hasTool ? payload.toolItemId : null,
    toolJobId: payload.hasTool ? payload.jobId : 0,
  });
}

/** `GA;501` arrived for the local character. */
export function beginHarvest(
  cellId: number,
  durationMs: number,
  anchor: { x: number; y: number } | null
): void {
  jobsStore.setState({
    harvesting: {
      cellId,
      durationMs,
      startedAt: Date.now(),
      anchorX: anchor?.x ?? 0,
      anchorY: anchor?.y ?? 0,
    },
  });
}

export function endHarvest(): void {
  if (jobsStore.getSnapshot().harvesting) {
    jobsStore.setState({ harvesting: null });
  }
}

/** Whether the server currently owns the character for a harvest action. */
export function isHarvesting(
  state: JobsState = jobsStore.getSnapshot()
): boolean {
  return state.harvesting !== null;
}

/**
 * Whether a skill sent in `JS` is a gather rather than a craft.
 * Harvest skills expose zero recipe slots; craft skills expose at least one.
 */
export function isHarvestSkill(
  skillId: number,
  state: JobsState = jobsStore.getSnapshot()
): boolean {
  if (state.baseSkills.some((skill) => skill.id === skillId)) {
    return true;
  }

  for (const job of state.jobs.values()) {
    const skill = job.skills.find((entry) => entry.id === skillId);
    if (skill) {
      return skill.slots === 0;
    }
  }

  return false;
}

export function clearJobs(): void {
  jobsStore.replaceState({
    jobs: new Map(),
    baseSkills: [],
    toolTemplateId: null,
    toolJobId: 0,
    harvesting: null,
  });
}

/** The jobs a character holds, in a stable order for the panel. */
export function getJobs(
  state: JobsState = jobsStore.getSnapshot()
): PlayerJob[] {
  return [...state.jobs.values()].sort((a, b) => a.id - b.id);
}

/**
 * Whether the character may use this job skill right now.
 *
 * Three facts, all of them the server's: the job is held (`JS`), its level
 * reaches the skill's minimum (`JS`, `param2`), and the tool in the weapon
 * slot belongs to that job (`OT`). Nothing here is derived — the client does
 * not know the experience curve, does not know which items are tools, and
 * does not decide the outcome; it decides only what to grey out, and the
 * server checks all three again before doing anything.
 *
 * `jobIdOfSkill` comes from the lang bundle (`SK[id].j`), which is naming
 * data the client already owns.
 */
export function canUseJobSkill(
  skillId: number,
  jobIdOfSkill: number | null,
  state: JobsState = jobsStore.getSnapshot()
): boolean {
  if (jobIdOfSkill === null) {
    return false;
  }

  // A `-Base-` skill asks nothing of the character: no job to hold, no level
  // to reach, no tool to wear. Being in the list the server sent *is* the
  // permission — the three it does not implement are simply not in it.
  if (jobIdOfSkill === BASE_JOB_ID) {
    return state.baseSkills.some((skill) => skill.id === skillId);
  }

  const job = state.jobs.get(jobIdOfSkill);

  if (!job) {
    return false;
  }

  const skill = job.skills.find((entry) => entry.id === skillId);

  if (!skill) {
    return false;
  }

  // `slots` is `param1` and `minLevel` is `param2`; a harvest skill reports
  // zero slots, which says nothing about whether it is usable.
  if (job.level < skill.minLevel) {
    return false;
  }

  return state.toolJobId === jobIdOfSkill;
}

/**
 * How many ingredient slots a craft skill offers this character.
 *
 * `param1` of `JS`, and the same number the server froze into the bench when
 * it opened — the client is reading it back, not deriving it.
 */
export function craftSlotsOf(
  skillId: number,
  state: JobsState = jobsStore.getSnapshot()
): number {
  for (const job of state.jobs.values()) {
    const skill = job.skills.find((entry) => entry.id === skillId);

    if (skill) {
      return skill.slots;
    }
  }

  return 0;
}

export function getJob(
  jobId: number,
  state: JobsState = jobsStore.getSnapshot()
): PlayerJob | undefined {
  return state.jobs.get(jobId);
}
