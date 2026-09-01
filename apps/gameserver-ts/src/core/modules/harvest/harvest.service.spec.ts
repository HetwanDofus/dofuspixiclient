import "reflect-metadata";

import { describe, expect, test } from "bun:test";

import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type {
  HarvestDenialReason,
  HarvestResult,
} from "@modules/harvest/harvest.service";
import type { SkillEntry } from "@modules/jobs/jobs.catalog.service";
import { GameActionType } from "@dofus/proto/game_pb";
import { InteractiveFrame } from "@modules/harvest/harvest.constants";
import { HarvestFramesService } from "@modules/harvest/harvest.frames.service";
import { HarvestService } from "@modules/harvest/harvest.service";
import { JobSkillKind } from "@shared/db/schema";

/**
 * Frêne on Astrub: skill 6, job 2 (Bûcheron), item 303, level 1, 10 xp.
 * The numbers are the referential's own, so a fixture that drifts from the
 * import is a fixture that stops describing the game.
 */
const SKILL: SkillEntry = {
  id: 6,
  jobId: 2,
  name: "Couper",
  kind: JobSkillKind.Harvest,
  minLevel: 1,
  harvestItemId: 303,
  harvestXp: 10,
  fixedDurationMs: null,
  quantityMin: null,
  quantityMax: null,
  criteria: "J?V:-",
};

const MAP_ID = 7411;
const CELL_ID = 170;
const SESSION = "s-1";
const CHARACTER = "char-1";
/** The Hache de Bûcheron, from `jobs_data.tools`. */
const AXE = 454;

interface HarnessOptions {
  playerJob?: { jobId: number; level: number; experience: string } | null;
  equippedTemplateId?: number | null;
  energy?: number;
  inFight?: boolean;
  onMap?: boolean;
  gatherable?: boolean;
  reserveSucceeds?: boolean;
  carriedPods?: number;
  runnable?: boolean;
  /** Overrides on the referential row, for the level and duration cases. */
  skill?: Partial<SkillEntry>;
}

function harness(options: HarnessOptions = {}) {
  const recorded = {
    sent: [] as DofusMessage[],
    reserved: [] as { mapId: number; cellId: number }[],
    released: [] as { mapId: number; cellId: number }[],
    depleted: [] as { mapId: number; cellId: number; respawnSeconds: number }[],
    given: [] as {
      playerId?: string;
      templateId: number;
      quantity: number;
      effects?: unknown;
    }[],
    experience: [] as { jobId: number; amount: number }[],
    scheduled: [] as { id: string; dueAt: number }[],
  };

  const skill = { ...SKILL, ...options.skill };
  const playerJob =
    options.playerJob === undefined
      ? { jobId: 2, level: 1, experience: "0" }
      : options.playerJob;
  const equipped =
    options.equippedTemplateId === undefined ? AXE : options.equippedTemplateId;

  const state = {
    reserve: async (mapId: number, cellId: number) => {
      recorded.reserved.push({ mapId, cellId });
      return options.reserveSucceeds ?? true;
    },
    release: async (mapId: number, cellId: number) => {
      recorded.released.push({ mapId, cellId });
    },
    deplete: async (
      mapId: number,
      cellId: number,
      _playerId: string,
      respawnSeconds: number
    ) => {
      recorded.depleted.push({ mapId, cellId, respawnSeconds });
      return new Date(Date.now() + respawnSeconds * 1000);
    },
    pending: async () => [],
    depletedOnMap: async () => [],
  };

  const jobsRepo = {
    findGatherable: async () =>
      (options.gatherable ?? true)
        ? {
            mapId: MAP_ID,
            cellId: CELL_ID,
            skillId: skill.id,
            resourceItemId: skill.harvestItemId,
            respawnSeconds: 300,
            jobId: skill.jobId,
            minLevel: skill.minLevel,
            harvestXp: skill.harvestXp,
            fixedDurationMs: null,
            quantityMin: null,
            quantityMax: null,
          }
        : undefined,
    findPlayerJob: async () => playerJob ?? undefined,
    findPlayerJobs: async () =>
      playerJob ? [{ ...playerJob, level: playerJob.level }] : [],
  };

  const catalog = {
    load: async () => {},
    runnableHarvestSkill: (id: number) =>
      (options.runnable ?? true) && id === skill.id ? skill : undefined,
    isToolOf: (templateId: number, jobId: number) =>
      templateId === AXE && jobId === skill.jobId,
  };

  const jobs = {
    addExperience: async (_p: string, jobId: number, amount: number) => {
      recorded.experience.push({ jobId, amount });
      return {
        jobId,
        experience: String(amount),
        level: 1,
        leveledTo: null,
      };
    },
    announceGain: async () => {},
  };

  const presence = {
    getByCharacter: () =>
      (options.onMap ?? true) ? { mapId: MAP_ID, cellId: 1 } : undefined,
    sessionsOnMap: () => [SESSION],
  };

  const players = {
    findById: async () => ({ energy: options.energy ?? 10_000 }),
    findStats: async () => ({ strength: 0 }),
  };

  const fights = { isInFight: () => options.inFight ?? false };

  const inventory = {
    findEquipped: async () =>
      equipped === null ? [] : [{ position: 1, templateId: equipped }],
    findByPlayer: async () => [
      { templateId: 1, quantity: options.carriedPods ?? 0 },
    ],
    findTemplate: async (templateId: number) => ({
      id: templateId,
      weight: 1,
      effects: [],
      animationId: templateId === AXE ? 17 : 0,
    }),
    insertItem: async (grant: {
      playerId: string;
      templateId: number;
      quantity: number;
      effects: unknown;
    }) => {
      recorded.given.push(grant);
      return { id: "item-1", ...grant };
    },
  };

  const inventoryFrames = { sendItemAdd: () => {} };

  const stats = {
    computeEquipmentStats: async () => ({ strength: 0, pods: 0 }),
    sendStats: async () => {},
  };

  const scheduler = {
    schedule: (job: { id: string; dueAt: number }) => {
      recorded.scheduled.push(job);
    },
  };

  const frames = new HarvestFramesService({
    broadcast: (_targets: readonly string[], message: DofusMessage) => {
      recorded.sent.push(message);
    },
  } as never);

  const txHost = {
    withTransaction: <T>(fn: () => Promise<T>) => fn(),
  };

  const service = new HarvestService(
    txHost as never,
    state as never,
    jobsRepo as never,
    catalog as never,
    jobs as never,
    presence as never,
    players as never,
    fights as never,
    inventory as never,
    inventoryFrames as never,
    stats as never,
    scheduler as never,
    frames
  );

  return { service, recorded };
}

function reasonOf(result: HarvestResult): HarvestDenialReason | "ok" {
  return result.ok ? "ok" : result.reason;
}

function framesOf(sent: readonly DofusMessage[]) {
  return sent
    .filter((m) => m.payload.case === "gameFrameObject2")
    .flatMap((m) =>
      (
        m.payload.value as {
          entries: { cellId: number; frame: number; interactive: boolean }[];
        }
      ).entries.map((entry) => ({
        cellId: entry.cellId,
        frame: entry.frame,
        interactive: entry.interactive,
      }))
    );
}

describe("HarvestService.start — the refusals", () => {
  test.each<[string, HarnessOptions, HarvestDenialReason]>([
    ["the character is not in the world", { onMap: false }, "not-in-world"],
    ["the character is in a fight", { inFight: true }, "in-fight"],
    [
      "the skill is not a runnable harvest",
      { runnable: false },
      "skill-not-runnable",
    ],
    [
      "nothing was imported on that cell",
      { gatherable: false },
      "no-resource-here",
    ],
    ["the job is not learned", { playerJob: null }, "job-not-learned"],
    [
      "the job level is below the skill's minimum",
      { skill: { minLevel: 30 } },
      "job-level-too-low",
    ],
    [
      "no tool is equipped at all",
      { equippedTemplateId: null },
      "no-tool-equipped",
    ],
    [
      "the equipped weapon is not this job's tool",
      { equippedTemplateId: 999 },
      "no-tool-equipped",
    ],
    ["the character has no energy left", { energy: 0 }, "no-energy"],
    ["the bag is full", { carriedPods: 5000 }, "too-heavy"],
    [
      "someone else already took it",
      { reserveSucceeds: false },
      "resource-taken",
    ],
  ])("refuses when %s", async (_label, options, expected) => {
    const { service } = harness(options);

    const result = await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    expect(reasonOf(result)).toBe(expected);
  });

  test("a level advantage shortens the action by 100 ms a level", async () => {
    const { service, recorded } = harness({
      playerJob: { jobId: 2, level: 21, experience: "0" },
    });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    const action = recorded.sent.find((m) => m.payload.case === "gameAction");
    expect((action?.payload.value as { rawParams: string }).rawParams).toBe(
      `${CELL_ID},10000,17`
    );
  });

  test("every refusal tells the player why", async () => {
    // QA-123: "aucune branche ne doit rester silencieuse". A refusal that
    // only reaches the log leaves a player unable to tell a missing axe
    // from a broken game.
    const { service, recorded } = harness({ equippedTemplateId: null });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    const info = recorded.sent.find((m) => m.payload.case === "infoMessage");

    expect((info?.payload.value as { message: string }).message).toContain(
      "outil"
    );
  });

  test("a refusal never takes the resource", async () => {
    const { service, recorded } = harness({ equippedTemplateId: null });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    expect(recorded.reserved).toEqual([]);
    expect(framesOf(recorded.sent)).toEqual([]);
  });

  test("a resource already taken is not announced to the map", async () => {
    const { service, recorded } = harness({ reserveSucceeds: false });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    expect(framesOf(recorded.sent)).toEqual([]);
  });
});

/**
 * The well, `SK[102]` — job 1, `-Base-`.
 *
 * `-Base-` is not a job: it carries the actions anyone can perform, and no
 * character ever holds a row for it. Gating it like a real job made every
 * well in the world unusable, which is what these pin.
 */
const WELL: SkillEntry = {
  id: 102,
  jobId: 1,
  name: "Puiser",
  kind: JobSkillKind.Harvest,
  minLevel: 1,
  harvestItemId: 311,
  harvestXp: 0,
  fixedDurationMs: 1500,
  quantityMin: 1,
  quantityMax: 10,
  criteria: "",
};

describe("HarvestService — the jobless gathers", () => {
  test("a well needs no job", async () => {
    const { service } = harness({ skill: WELL, playerJob: null });

    expect(
      reasonOf(await service.start(SESSION, CHARACTER, CELL_ID, WELL.id))
    ).toBe("ok");
  });

  test("a well needs no tool", async () => {
    const { service } = harness({
      skill: WELL,
      playerJob: null,
      equippedTemplateId: null,
    });

    expect(
      reasonOf(await service.start(SESSION, CHARACTER, CELL_ID, WELL.id))
    ).toBe("ok");
  });

  test("but it still needs energy and a free bag", async () => {
    expect(
      reasonOf(
        await harness({
          skill: WELL,
          playerJob: null,
          energy: 0,
        }).service.start(SESSION, CHARACTER, CELL_ID, WELL.id)
      )
    ).toBe("no-energy");

    expect(
      reasonOf(
        await harness({
          skill: WELL,
          playerJob: null,
          carriedPods: 5000,
        }).service.start(SESSION, CHARACTER, CELL_ID, WELL.id)
      )
    ).toBe("too-heavy");
  });

  test("its action is the flat one it declares, not a level-scaled one", async () => {
    const { service, recorded } = harness({ skill: WELL, playerJob: null });

    await service.start(SESSION, CHARACTER, CELL_ID, WELL.id);

    const action = recorded.sent.find((m) => m.payload.case === "gameAction");
    expect((action?.payload.value as { rawParams: string }).rawParams).toBe(
      `${CELL_ID},1500,3`
    );
  });
});

describe("HarvestService.start — the action", () => {
  test("takes the resource before announcing anything", async () => {
    const { service, recorded } = harness();

    const result = await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    expect(reasonOf(result)).toBe("ok");
    expect(recorded.reserved).toEqual([{ mapId: MAP_ID, cellId: CELL_ID }]);
  });

  test("announces GA;501 with the server's own duration", async () => {
    const { service, recorded } = harness();

    const result = await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    const action = recorded.sent.find((m) => m.payload.case === "gameAction");
    const value = action?.payload.value as {
      actionType: number;
      rawParams: string;
    };

    expect(value.actionType).toBe(GameActionType.ACTION_HARVEST);
    expect(value.rawParams).toBe(`${CELL_ID},12000,17`);
    expect(
      (action?.payload.value as { actionData: { value: { animId: number } } })
        .actionData.value.animId
    ).toBe(17);
    expect(result.ok && result.durationMs).toBe(12_000);
  });

  test("locks the cell for everyone on the map", async () => {
    const { service, recorded } = harness();

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    expect(framesOf(recorded.sent)).toEqual([
      { cellId: CELL_ID, frame: InteractiveFrame.Locked, interactive: false },
    ]);
  });

  test("a second attempt while one is running is refused", async () => {
    const { service } = harness();

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    const second = await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);

    expect(reasonOf(second)).toBe("already-harvesting");
  });
});

/**
 * The completion path runs off a real `setTimeout`, so these drive it with a
 * skill that declares a 1 ms action — the same field the well uses — rather
 * than faking the clock. It keeps the timer, the ordering and the transaction
 * exactly as they are in production.
 */
const INSTANT = { fixedDurationMs: 1 };

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("HarvestService — completion", () => {
  test("credits the item and the experience", async () => {
    const { service, recorded } = harness({ skill: INSTANT });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    await settle();

    // The quantity is a roll (`random(1, 2 + gap / 5)`), so the assertion is
    // on its range: pinning it to a value would be pinning `Math.random`.
    expect(recorded.given).toHaveLength(1);
    expect(recorded.given[0]).toMatchObject({
      playerId: CHARACTER,
      templateId: 303,
      effects: [],
    });
    expect(recorded.given[0]?.quantity).toBeGreaterThanOrEqual(1);
    expect(recorded.given[0]?.quantity).toBeLessThanOrEqual(2);
    expect(recorded.experience).toEqual([{ jobId: 2, amount: 10 }]);
  });

  test("depletes the cell for its own respawn delay", async () => {
    const { service, recorded } = harness({ skill: INSTANT });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    await settle();

    expect(recorded.depleted).toEqual([
      { mapId: MAP_ID, cellId: CELL_ID, respawnSeconds: 300 },
    ]);
    expect(recorded.released).toEqual([]);
  });

  test("shows the map the depleted frame, and arms the respawn", async () => {
    const { service, recorded } = harness({ skill: INSTANT });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    await settle();

    expect(framesOf(recorded.sent).at(-1)).toEqual({
      cellId: CELL_ID,
      frame: InteractiveFrame.InUse,
      interactive: false,
    });
    expect(recorded.scheduled.map((job) => job.id)).toEqual([
      `harvest:${MAP_ID}:${CELL_ID}`,
    ]);
  });

  test("a character who left the map gets nothing, and the resource returns", async () => {
    let onMap = true;
    const { service, recorded } = harness({ skill: INSTANT });

    // Swapped after the action has started, which is exactly the window the
    // second check exists to cover: twelve seconds is long enough to leave.
    (
      service as unknown as { presence: { getByCharacter: () => unknown } }
    ).presence = {
      getByCharacter: () => (onMap ? { mapId: MAP_ID, cellId: 1 } : undefined),
      sessionsOnMap: () => [SESSION],
    } as never;

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    onMap = false;
    await settle();

    expect(recorded.given).toEqual([]);
    expect(recorded.experience).toEqual([]);
    expect(recorded.depleted).toEqual([]);
    expect(recorded.released).toEqual([{ mapId: MAP_ID, cellId: CELL_ID }]);
  });

  test("a character dragged into a fight gets nothing either", async () => {
    let inFight = false;
    const { service, recorded } = harness({ skill: INSTANT });

    (service as unknown as { fights: { isInFight: () => boolean } }).fights = {
      isInFight: () => inFight,
    } as never;

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    inFight = true;
    await settle();

    expect(recorded.given).toEqual([]);
    expect(recorded.released).toEqual([{ mapId: MAP_ID, cellId: CELL_ID }]);
  });

  test("a movement attempt cannot cancel an active harvest", async () => {
    const { service, recorded } = harness({ skill: INSTANT });

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    await service.interrupt(CHARACTER, "moved");
    await settle();

    expect(recorded.released).toEqual([]);
    expect(recorded.given).toHaveLength(1);
    expect(recorded.depleted).toEqual([
      { mapId: MAP_ID, cellId: CELL_ID, respawnSeconds: 300 },
    ]);
  });
});

describe("HarvestService.interrupt", () => {
  test("a disconnection hands the resource straight back, with no reward", async () => {
    const { service, recorded } = harness();

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    await service.interrupt(CHARACTER, "disconnected");

    expect(recorded.released).toEqual([{ mapId: MAP_ID, cellId: CELL_ID }]);
    expect(recorded.given).toEqual([]);
    expect(recorded.experience).toEqual([]);
    expect(framesOf(recorded.sent).at(-1)).toEqual({
      cellId: CELL_ID,
      frame: InteractiveFrame.Ready,
      interactive: true,
    });
  });

  test("a disconnection frees the character to start again", async () => {
    const { service } = harness();

    await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id);
    await service.interrupt(CHARACTER, "disconnected");

    expect(
      reasonOf(await service.start(SESSION, CHARACTER, CELL_ID, SKILL.id))
    ).toBe("ok");
  });

  test("interrupting nothing is not an error", async () => {
    const { service, recorded } = harness();

    await service.interrupt(CHARACTER, "disconnected");

    expect(recorded.released).toEqual([]);
  });
});
