import "reflect-metadata";

import { describe, expect, test } from "bun:test";

import { JobsService } from "@modules/jobs/jobs.service";

const SESSION = "s-1";
const CHARACTER = "char-1";
const LUMBERJACK = 2;
const MINER = 24;

interface HarnessOptions {
  held?: { jobId: number; level: number }[];
}

function harness(options: HarnessOptions = {}) {
  const held = options.held ?? [
    { jobId: LUMBERJACK, level: 40 },
    { jobId: MINER, level: 12 },
  ];

  const recorded = {
    saved: [] as {
      jobId: number;
      options: number;
      minSlots: number;
      listed: boolean;
    }[],
    unlisted: [] as (number | undefined)[],
    sent: [] as { jobIndex: number; options: number; minSlots: number }[],
  };

  const repo = {
    findPlayerJob: async (_p: string, jobId: number) =>
      held.find((job) => job.jobId === jobId),
    findPlayerJobs: async () =>
      held.map((job) => ({
        ...job,
        experience: "0",
        specializationOf: 0,
        name: "",
      })),
    setOptions: async (
      _p: string,
      jobId: number,
      opts: number,
      minSlots: number,
      listed: boolean
    ) => {
      recorded.saved.push({ jobId, options: opts, minSlots, listed });
    },
    unlist: async (_p: string, jobId?: number) => {
      recorded.unlisted.push(jobId);
    },
  };

  const frames = {
    sendOptions: (
      _s: string,
      jobIndex: number,
      opts: number,
      minSlots: number
    ) => {
      recorded.sent.push({ jobIndex, options: opts, minSlots });
    },
  };

  const service = new JobsService(
    repo as never,
    { load: async () => {} } as never,
    frames as never
  );

  return { service, recorded };
}

describe("JobsService.setOptions", () => {
  test("saves the terms and lists the artisan by the same act", async () => {
    const h = harness();

    expect(
      await h.service.setOptions(SESSION, CHARACTER, LUMBERJACK, 5, 4)
    ).toBe(true);

    expect(h.recorded.saved).toEqual([
      { jobId: LUMBERJACK, options: 5, minSlots: 4, listed: true },
    ]);
  });

  test("a job the character does not have changes nothing", async () => {
    const h = harness();

    expect(await h.service.setOptions(SESSION, CHARACTER, 99, 1, 2)).toBe(
      false
    );
    expect(h.recorded.saved).toEqual([]);
  });

  test("the minimum is floored at two, as JobOptions floors it", async () => {
    const h = harness();

    await h.service.setOptions(SESSION, CHARACTER, LUMBERJACK, 0, 1);

    expect(h.recorded.saved[0]?.minSlots).toBe(2);
    expect(h.recorded.sent[0]?.minSlots).toBe(2);
  });

  test("the echo carries the job's index, not its id", async () => {
    // `aks/Job.as:onOptions` writes `Player.Jobs[index]`. Sending the id
    // would write into the wrong slot, or off the end of the array.
    const h = harness();

    await h.service.setOptions(SESSION, CHARACTER, MINER, 1, 3);

    expect(h.recorded.sent).toEqual([{ jobIndex: 1, options: 1, minSlots: 3 }]);
  });
});

describe("JobsService.unlistExcept", () => {
  test("keeps only the job whose tool is worn", async () => {
    const h = harness();

    await h.service.unlistExcept(CHARACTER, LUMBERJACK);

    expect(h.recorded.unlisted).toEqual([MINER]);
  });

  test("an empty weapon slot drops every listing", async () => {
    const h = harness();

    await h.service.unlistExcept(CHARACTER, null);

    expect(h.recorded.unlisted).toEqual([LUMBERJACK, MINER]);
  });
});
