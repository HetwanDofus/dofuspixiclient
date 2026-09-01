import "reflect-metadata";

import { describe, expect, test } from "bun:test";

import type { ItemRow } from "@shared/db/schema";
import { InventoryService } from "@modules/inventory/inventory.service";

/**
 * "Potion d'oubli de métier : Bûcheron", template 1587.
 *
 * Its single effect is 615 with `param3: "2"` — job 2, in hexadecimal,
 * which is the encoding all seventeen forget potions use. `1596` (Mineur)
 * says `"18"` = 24 and `1600` (Paysan) says `"1c"` = 28; the hex reading is
 * the only one under which all three land on a real job.
 */
const FORGET_LUMBERJACK = {
  id: 1587,
  name: "Potion d'oubli de métier : Bûcheron",
  usable: true,
  effects: [{ id: 615, param1: 0, param2: 0, param3: "2" }],
};

/** "Potion d'oubli de métier : Mineur" — job 24, spelled `18`. */
const FORGET_MINER = {
  ...FORGET_LUMBERJACK,
  id: 1596,
  name: "Potion d'oubli de métier : Mineur",
  effects: [{ id: 615, param1: 0, param2: 0, param3: "18" }],
};

/** Effect 603, "Apprend le métier #3". */
const LEARN_LUMBERJACK = {
  ...FORGET_LUMBERJACK,
  id: 9999,
  name: "Parchemin de métier : Bûcheron",
  effects: [{ id: 603, param1: 0, param2: 0, param3: "2" }],
};

interface HarnessOptions {
  template?: typeof FORGET_LUMBERJACK;
  quantity?: number;
  forgetSucceeds?: boolean;
  learnSucceeds?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const recorded = {
    forgotten: [] as number[],
    learned: [] as number[],
    removed: [] as string[],
    quantities: [] as { id: string; left: number }[],
  };

  const template = options.template ?? FORGET_LUMBERJACK;
  const item = {
    id: "p-1",
    templateId: template.id,
    quantity: options.quantity ?? 1,
    position: -1,
    effects: [],
  } as unknown as ItemRow;

  const inventory = {
    findOwned: async () => item,
    deleteItem: async (id: string) => {
      recorded.removed.push(id);
    },
    updateQuantity: async (id: string, left: number) => {
      recorded.quantities.push({ id, left });
    },
  };

  const templates = { load: async () => template };

  const jobsService = {
    forget: async (_s: string, _p: string, jobId: number) => {
      recorded.forgotten.push(jobId);
      return options.forgetSucceeds ?? true;
    },
    learn: async (_s: string, _p: string, jobId: number) => {
      recorded.learned.push(jobId);
      return (options.learnSucceeds ?? true)
        ? { ok: true as const, jobId }
        : { ok: false as const, reason: "no-slot-left" as const };
    },
  };

  const service = new InventoryService(
    { withTransaction: <T>(fn: () => Promise<T>) => fn() } as never,
    inventory as never,
    templates as never,
    {} as never,
    {} as never,
    { sendItemQuantity: () => {}, sendItemRemove: () => {} } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    jobsService as never
  );

  return { service, recorded };
}

describe("InventoryService.use — job potions", () => {
  test("a forget potion forgets the job its effect names", async () => {
    const { service, recorded } = harness();

    expect(await service.use("s-1", "char-1", "p-1")).toEqual({ ok: true });
    expect(recorded.forgotten).toEqual([2]);
  });

  test("the job id is read as hexadecimal, not decimal", async () => {
    // `"18"` is 24 (Mineur). Read as decimal it would be 18, which is
    // Sculpteur de Bâtons — a real job, and the wrong one, which is why
    // this cannot be caught by a "does it resolve" check.
    const { service, recorded } = harness({ template: FORGET_MINER });

    await service.use("s-1", "char-1", "p-1");

    expect(recorded.forgotten).toEqual([24]);
  });

  test("the potion is consumed", async () => {
    const { service, recorded } = harness();

    await service.use("s-1", "char-1", "p-1");

    expect(recorded.removed).toEqual(["p-1"]);
  });

  test("one unit off a stack, not the stack", async () => {
    const { service, recorded } = harness({ quantity: 3 });

    await service.use("s-1", "char-1", "p-1");

    expect(recorded.quantities).toEqual([{ id: "p-1", left: 2 }]);
    expect(recorded.removed).toEqual([]);
  });

  test("forgetting a job the character does not have does not eat it", async () => {
    const { service, recorded } = harness({ forgetSucceeds: false });

    expect(await service.use("s-1", "char-1", "p-1")).toEqual({
      ok: false,
      reason: "no-supported-effect",
    });
    expect(recorded.removed).toEqual([]);
    expect(recorded.quantities).toEqual([]);
  });

  test("a learn scroll teaches, and is refused by the slot rules", async () => {
    const taught = harness({ template: LEARN_LUMBERJACK });
    await taught.service.use("s-1", "char-1", "p-1");
    expect(taught.recorded.learned).toEqual([2]);
    expect(taught.recorded.removed).toEqual(["p-1"]);

    const refused = harness({
      template: LEARN_LUMBERJACK,
      learnSucceeds: false,
    });
    expect(await refused.service.use("s-1", "char-1", "p-1")).toEqual({
      ok: false,
      reason: "no-supported-effect",
    });
    expect(refused.recorded.removed).toEqual([]);
  });
});
