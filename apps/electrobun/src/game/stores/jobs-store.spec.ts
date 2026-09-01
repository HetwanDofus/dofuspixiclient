import { beforeEach, describe, expect, test } from "bun:test";

import type { JobSkills } from "@/game/network/protocol";
import {
  BASE_JOB_ID,
  beginHarvest,
  canUseJobSkill,
  clearJobs,
  endHarvest,
  getJobs,
  handleItemTool,
  handleJobSkills,
  isHarvesting,
  isHarvestSkill,
  jobsStore,
} from "@/game/stores/jobs-store";

/** "Couper" a Frêne — Bûcheron (2), level 1. */
const CUT_ASH = 6;
/** "Couper" an Orme — Bûcheron, level 90. */
const CUT_ELM = 35;
/** "Puiser" — `-Base-` (1). No job, no level, no tool. */
const DRAW_WATER = 102;
const LUMBERJACK = 2;
const AXE = 454;
const CARVE = 1;

function skills(
  payload: {
    jobId: number;
    skills: { skillId: number; param1?: number; param2?: number }[];
  }[]
): JobSkills {
  return {
    success: true,
    jobs: payload.map((job) => ({
      jobId: job.jobId,
      skills: job.skills.map((skill) => ({
        skillId: skill.skillId,
        param1: skill.param1 ?? 0,
        param2: skill.param2 ?? 1,
        param3: 0,
        param4: 0,
      })),
    })),
  } as unknown as JobSkills;
}

beforeEach(() => {
  clearJobs();
});

describe("`-Base-` skills", () => {
  test("are usable with no job, no level and no tool", () => {
    handleJobSkills(
      skills([{ jobId: BASE_JOB_ID, skills: [{ skillId: DRAW_WATER }] }])
    );

    expect(canUseJobSkill(DRAW_WATER, BASE_JOB_ID)).toBe(true);
  });

  test("are not usable when the server did not list them", () => {
    // The three jobless gathers the server has no behaviour for — 42
    // "Ramasser", 150 "Jouer", 152 "Pêcher KoinKoin" — never arrive, and
    // being absent from the list is what greys them.
    handleJobSkills(
      skills([{ jobId: BASE_JOB_ID, skills: [{ skillId: DRAW_WATER }] }])
    );

    expect(canUseJobSkill(42, BASE_JOB_ID)).toBe(false);
  });

  test("never appear as a job the character holds", () => {
    // Otherwise "-Base-" shows up in the Métiers panel and the craftsmen's
    // book, and gets counted as one of the three slots.
    handleJobSkills(
      skills([
        { jobId: BASE_JOB_ID, skills: [{ skillId: DRAW_WATER }] },
        { jobId: LUMBERJACK, skills: [{ skillId: CUT_ASH }] },
      ])
    );

    expect(getJobs().map((job) => job.id)).toEqual([LUMBERJACK]);
    expect(jobsStore.getSnapshot().baseSkills).toHaveLength(1);
  });
});

describe("a real job's skills", () => {
  beforeEach(() => {
    handleJobSkills(
      skills([
        {
          jobId: LUMBERJACK,
          skills: [
            { skillId: CUT_ASH, param2: 1 },
            { skillId: CUT_ELM, param2: 90 },
          ],
        },
      ])
    );
  });

  test("need the tool of that job in the weapon slot", () => {
    expect(canUseJobSkill(CUT_ASH, LUMBERJACK)).toBe(false);

    handleItemTool({
      toolItemId: AXE,
      hasTool: true,
      jobId: LUMBERJACK,
    } as never);

    expect(canUseJobSkill(CUT_ASH, LUMBERJACK)).toBe(true);
  });

  test("need the level the skill asks for", () => {
    handleItemTool({
      toolItemId: AXE,
      hasTool: true,
      jobId: LUMBERJACK,
    } as never);

    // The job arrived at level 1 (no `JX` yet): the elm is out of reach.
    expect(canUseJobSkill(CUT_ELM, LUMBERJACK)).toBe(false);
  });

  test("go grey again when the tool comes off", () => {
    handleItemTool({
      toolItemId: AXE,
      hasTool: true,
      jobId: LUMBERJACK,
    } as never);
    handleItemTool({ toolItemId: 0, hasTool: false, jobId: 0 } as never);

    expect(canUseJobSkill(CUT_ASH, LUMBERJACK)).toBe(false);
  });
});

describe("harvest ownership", () => {
  test("classifies gathers by their zero recipe slots", () => {
    handleJobSkills(
      skills([
        { jobId: BASE_JOB_ID, skills: [{ skillId: DRAW_WATER }] },
        {
          jobId: LUMBERJACK,
          skills: [{ skillId: CUT_ASH }, { skillId: CARVE, param1: 2 }],
        },
      ])
    );

    expect(isHarvestSkill(DRAW_WATER)).toBe(true);
    expect(isHarvestSkill(CUT_ASH)).toBe(true);
    expect(isHarvestSkill(CARVE)).toBe(false);
  });

  test("owns the character from GA;501 until the deadline clears it", () => {
    expect(isHarvesting()).toBe(false);

    beginHarvest(154, 12_000, { x: 10, y: 20 });
    expect(isHarvesting()).toBe(true);

    endHarvest();
    expect(isHarvesting()).toBe(false);
  });
});
