import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { CraftState } from "@modules/exchange/craft.registry";
import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { ItemRow } from "@shared/db/schema";
import { ExchangeType } from "@dofus/proto/common_pb";
import { CraftFlow } from "@modules/exchange/craft.flow";
import { CraftRegistryService } from "@modules/exchange/craft.registry";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";

const SESSION = "s-1";
const CHARACTER = "char-1";

/** "Scier", Bûcheron. Its recipe list is `SK[101].cl`. */
const SAWING = 101;
const JOB_LUMBERJACK = 2;

/** Planche de Frêne: 10 × Bois de Frêne. One ingredient, one slot. */
const ASH_WOOD = 303;
const ASH_PLANK = 459;

interface HarnessOptions {
  /** Level at the moment the bench opened; the grid is frozen from it. */
  jobLevel?: number;
  maxSlots?: number;
  /** Rolls fed to the craft, in order. */
  rolls?: number[];
  bag?: {
    id: string;
    templateId: number;
    quantity: number;
    position?: number;
  }[];
}

function harness(options: HarnessOptions = {}) {
  const recorded = {
    sent: [] as DofusMessage[],
    removed: [] as string[],
    quantities: [] as { id: string; left: number }[],
    given: [] as { templateId: number; quantity: number }[],
    experience: [] as { jobId: number; amount: number }[],
  };

  const bag: ItemRow[] = (
    options.bag ?? [{ id: "i-1", templateId: ASH_WOOD, quantity: 25 }]
  ).map(
    (row) =>
      ({
        id: row.id,
        ownerKind: 1,
        ownerId: CHARACTER,
        templateId: row.templateId,
        position: row.position ?? -1,
        quantity: row.quantity,
        effects: [],
        effectsHash: "",
      }) as unknown as ItemRow
  );

  const rolls = [...(options.rolls ?? [0])];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0;

  const inventory = {
    findOwned: async (_p: string, id: string) => bag.find((r) => r.id === id),
    findByPlayer: async () => bag,
    findTemplate: async (id: number) => ({ id, weight: 1, effects: [] }),
    deleteItem: async (id: string) => {
      recorded.removed.push(id);
      const at = bag.findIndex((r) => r.id === id);
      if (at >= 0) {
        bag.splice(at, 1);
      }
    },
    updateQuantity: async (id: string, left: number) => {
      recorded.quantities.push({ id, left });
      const row = bag.find((r) => r.id === id);
      if (row) {
        (row as { quantity: number }).quantity = left;
      }
    },
    insertItem: async (grant: { templateId: number; quantity: number }) => {
      recorded.given.push(grant);
      return { id: "made-1", ...grant } as unknown as ItemRow;
    },
  };

  const recipes = {
    findBySkill: async () => [
      {
        resultItemId: ASH_PLANK,
        skillId: SAWING,
        ingredients: [{ itemId: ASH_WOOD, quantity: 10 }],
      },
    ],
  };

  const jobs = {
    addExperience: async (_p: string, jobId: number, amount: number) => {
      recorded.experience.push({ jobId, amount });
      return { jobId, experience: String(amount), level: 1, leveledTo: null };
    },
    announceGain: async () => {},
  };

  const frames = new ExchangeFramesService({
    broadcast: (_t: readonly string[], message: DofusMessage) => {
      recorded.sent.push(message);
    },
  } as never);

  const benches = new CraftRegistryService();
  const bench: CraftState = {
    sessionId: SESSION,
    characterId: CHARACTER,
    skillId: SAWING,
    jobId: JOB_LUMBERJACK,
    jobLevel: options.jobLevel ?? 40,
    maxSlots: options.maxSlots ?? 5,
    slots: {},
    lastResultItemId: null,
    remaining: 0,
    crafted: 0,
  };
  benches.open(bench);

  const flow = new CraftFlow(
    { withTransaction: <T>(fn: () => Promise<T>) => fn() } as never,
    benches,
    recipes as never,
    inventory as never,
    {
      sendItemAdd: () => {},
      sendItemRemove: () => {},
      sendItemQuantity: () => {},
    } as never,
    jobs as never,
    { sendStats: async () => {} } as never,
    frames
  );

  const session: ExchangeSession = {
    sessionId: SESSION,
    characterId: CHARACTER,
    accountId: "acc-1",
    kind: ExchangeType.EXCHANGE_CRAFT,
    remote: { kind: 1, id: CHARACTER },
    phase: "open",
    lockKey: SESSION,
    openedAt: Date.now(),
  };

  return {
    flow,
    session,
    bench,
    recorded,
    bag,
    restore: () => {
      Math.random = originalRandom;
    },
  };
}

function resultCodes(sent: readonly DofusMessage[]): string[] {
  return sent
    .filter((m) => m.payload.case === "exchangeCraft")
    .map((m) => (m.payload.value as { resultCode: string }).resultCode);
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("CraftFlow.moveItem", () => {
  test("lays an ingredient in a slot", async () => {
    const h = harness();
    cleanup = h.restore;

    expect(await h.flow.moveItem(h.session, true, "i-1", 10)).toEqual({
      ok: true,
    });
    expect(h.bench.slots).toEqual({ "i-1": 10 });
  });

  test("takes it back", async () => {
    const h = harness();
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.moveItem(h.session, false, "i-1", 0);

    expect(h.bench.slots).toEqual({});
  });

  test("refuses more than the stack holds", async () => {
    const h = harness();
    cleanup = h.restore;

    expect(await h.flow.moveItem(h.session, true, "i-1", 99)).toEqual({
      ok: false,
      reason: "not-enough",
    });
  });

  test("refuses a worn item — the paperdoll is not a shelf", async () => {
    const h = harness({
      bag: [{ id: "i-1", templateId: ASH_WOOD, quantity: 5, position: 1 }],
    });
    cleanup = h.restore;

    expect(await h.flow.moveItem(h.session, true, "i-1", 1)).toEqual({
      ok: false,
      reason: "equipped",
    });
  });

  test("refuses to fill more slots than the frozen grid holds", async () => {
    const h = harness({
      maxSlots: 2,
      bag: [
        { id: "i-1", templateId: 1, quantity: 5 },
        { id: "i-2", templateId: 2, quantity: 5 },
        { id: "i-3", templateId: 3, quantity: 5 },
      ],
    });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 1);
    await h.flow.moveItem(h.session, true, "i-2", 1);

    expect(await h.flow.moveItem(h.session, true, "i-3", 1)).toEqual({
      ok: false,
      reason: "no-slot-left",
    });
  });

  test("nothing leaves the inventory until the craft commits", async () => {
    const h = harness();
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);

    expect(h.recorded.removed).toEqual([]);
    expect(h.recorded.quantities).toEqual([]);
    expect(h.bag[0]?.quantity).toBe(25);
  });
});

describe("CraftFlow.craft", () => {
  test("an empty bench is not a craft", async () => {
    const h = harness();
    cleanup = h.restore;

    expect(await h.flow.craft(h.session)).toEqual({
      ok: false,
      reason: "empty-bench",
    });
  });

  test("ingredients that match no recipe are refused, and kept", async () => {
    const h = harness();
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 3);

    expect(await h.flow.craft(h.session)).toEqual({
      ok: false,
      reason: "no-such-recipe",
    });
    expect(h.recorded.removed).toEqual([]);
  });

  test("a success consumes the ingredients and produces the item", async () => {
    const h = harness({ rolls: [0] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.craft(h.session);

    expect(h.recorded.quantities).toEqual([{ id: "i-1", left: 15 }]);
    expect(h.recorded.given).toHaveLength(1);
    expect(h.recorded.given[0]).toMatchObject({
      templateId: ASH_PLANK,
      quantity: 1,
    });
    expect(resultCodes(h.recorded.sent)).toEqual(["S"]);
  });

  test("a failure consumes them anyway — this is 1.29, not a bug", async () => {
    // Level 40, one ingredient of a five-slot grid: `craftExperience` pays
    // nothing there, so this uses a roll past the base rate at a size that
    // can fail. One ingredient at level 40 is grey *and* certain, so the
    // failing case is built from a low level instead.
    const h = harness({ jobLevel: 1, maxSlots: 2, rolls: [0.99] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.craft(h.session);

    expect(resultCodes(h.recorded.sent)).toEqual(["E"]);
    expect(h.recorded.quantities).toEqual([{ id: "i-1", left: 15 }]);
    expect(h.recorded.given).toEqual([]);
  });

  test("and pays the experience anyway — likewise", async () => {
    const h = harness({ jobLevel: 1, maxSlots: 2, rolls: [0.99] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.craft(h.session);

    // Level 1 holds two slots; a one-ingredient recipe is worth 1.
    expect(h.recorded.experience).toEqual([
      { jobId: JOB_LUMBERJACK, amount: 1 },
    ]);
  });

  test("a grey recipe pays nothing", async () => {
    // Level 100 holds eight slots; one ingredient is four below the reach.
    const h = harness({ jobLevel: 100, maxSlots: 8, rolls: [0] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.craft(h.session);

    expect(h.recorded.given).toHaveLength(1);
    expect(h.recorded.experience).toEqual([
      { jobId: JOB_LUMBERJACK, amount: 0 },
    ]);
  });

  test("the bench is cleared afterwards, success or not", async () => {
    const h = harness({ rolls: [0] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.craft(h.session);

    expect(h.bench.slots).toEqual({});
  });

  test("a stack emptied by the craft is removed, not left at zero", async () => {
    const h = harness({
      rolls: [0],
      bag: [{ id: "i-1", templateId: ASH_WOOD, quantity: 10 }],
    });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.craft(h.session);

    expect(h.recorded.removed).toEqual(["i-1"]);
    expect(h.recorded.quantities).toEqual([]);
  });

  test("a double-click cannot craft twice from one set of ingredients", async () => {
    const h = harness({
      rolls: [0, 0],
      bag: [{ id: "i-1", templateId: ASH_WOOD, quantity: 10 }],
    });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);

    const [a, b] = await Promise.all([
      h.flow.craft(h.session),
      h.flow.craft(h.session),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(h.recorded.given).toHaveLength(1);
  });
});

describe("CraftFlow.repeat", () => {
  test("runs the series and re-lays the recipe each round", async () => {
    const h = harness({ rolls: [0, 0, 0] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.repeat(h.session, 2);

    expect(h.recorded.given).toHaveLength(2);
    expect(h.bench.crafted).toBe(2);
  });

  test("stops on its own when the ingredients run out", async () => {
    // 25 wood, 10 a craft: two rounds and no third.
    const h = harness({ rolls: [0, 0, 0, 0, 0] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.repeat(h.session, 10);

    expect(h.recorded.given).toHaveLength(2);
  });

  test("closes with `Ea`, whatever ended it", async () => {
    const h = harness({ rolls: [0, 0, 0] });
    cleanup = h.restore;

    await h.flow.moveItem(h.session, true, "i-1", 10);
    await h.flow.repeat(h.session, 2);

    const ends = h.recorded.sent.filter(
      (m) => m.payload.case === "exchangeCraftLoopEnd"
    );

    expect(ends).toHaveLength(1);
  });
});
