import { describe, expect, test } from "bun:test";

import type { InventoryRepository } from "@modules/inventory/inventory.repository";
import type { ShortcutsFramesService } from "@modules/shortcuts/shortcuts.frames.service";
import type { ShortcutsRepository } from "@modules/shortcuts/shortcuts.repository";
import { ShortcutsService } from "@modules/shortcuts/shortcuts.service";

const SESSION = "s-1";
const PLAYER = "1";
const OTHER_PLAYER = "2";

type Frame =
  | { kind: "add"; slot: number; templateId: number }
  | { kind: "remove"; slot: number };

interface Harness {
  service: ShortcutsService;
  slots: Map<number, number>;
  frames: Frame[];
}

/**
 * The service is thin on purpose — the rules are ownership, the slot
 * range and what the client is told — so the fakes here are a Map and an
 * array rather than a mocking framework. `withTransaction` runs its
 * callback inline: nothing under test depends on rollback.
 */
function harness(
  items: { unicId: string; playerId: string; templateId: number }[] = [
    { unicId: "10", playerId: PLAYER, templateId: 1182 },
  ]
): Harness {
  const slots = new Map<number, number>();
  const frames: Frame[] = [];

  const shortcutsRepo = {
    findByPlayer: async () =>
      [...slots].map(([slot, templateId]) => ({
        playerId: PLAYER,
        slot,
        templateId,
      })),
    findSlot: async (_playerId: string, slot: number) => {
      const templateId = slots.get(slot);
      return templateId === undefined
        ? undefined
        : { playerId: PLAYER, slot, templateId };
    },
    put: async (_playerId: string, slot: number, templateId: number) => {
      slots.set(slot, templateId);
    },
    deleteSlot: async (_playerId: string, slot: number) => {
      slots.delete(slot);
    },
  } as unknown as ShortcutsRepository;

  const inventoryRepo = {
    // Ownership is a predicate in the real repository's SQL since the
    // move to `items`, not a field the caller is trusted to compare, so
    // the fake has to enforce it the same way or the "belongs to someone
    // else" case below would pass for the wrong reason.
    findOwned: async (playerId: string, id: string) =>
      items.find((i) => i.unicId === id && i.playerId === playerId),
  } as unknown as InventoryRepository;

  const framesService = {
    sendAdd: (_s: string, slot: number, templateId: number) => {
      frames.push({ kind: "add", slot, templateId });
    },
    sendRemove: (_s: string, slot: number) => {
      frames.push({ kind: "remove", slot });
    },
  } as unknown as ShortcutsFramesService;

  const txHost = {
    withTransaction: <T>(fn: () => Promise<T>) => fn(),
  } as never;

  return {
    service: new ShortcutsService(
      txHost,
      shortcutsRepo,
      inventoryRepo,
      framesService
    ),
    slots,
    frames,
  };
}

describe("ShortcutsService.add", () => {
  test("stores the template, not the stack", async () => {
    const h = harness();

    const result = await h.service.add(SESSION, PLAYER, 3, 10);

    expect(result.ok).toBe(true);
    expect(h.slots.get(3)).toBe(1182);
    expect(h.frames).toEqual([{ kind: "add", slot: 3, templateId: 1182 }]);
  });

  test("refuses a stack owned by someone else", async () => {
    const h = harness([
      { unicId: "10", playerId: OTHER_PLAYER, templateId: 1182 },
    ]);

    const result = await h.service.add(SESSION, PLAYER, 3, 10);

    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(h.slots.size).toBe(0);
    expect(h.frames).toEqual([]);
  });

  test.each([
    ["slot 0 — the melee container, not a shortcut", 0],
    ["one past the last page", 43],
    ["negative", -1],
  ])("refuses %s", async (_label, slot) => {
    const h = harness();

    const result = await h.service.add(SESSION, PLAYER, slot, 10);

    expect(result).toEqual({ ok: false, reason: "bad-slot" });
    expect(h.frames).toEqual([]);
  });

  test("overwrites whatever sat in the slot", async () => {
    const h = harness([
      { unicId: "10", playerId: PLAYER, templateId: 1182 },
      { unicId: "11", playerId: PLAYER, templateId: 289 },
    ]);

    await h.service.add(SESSION, PLAYER, 3, 10);
    await h.service.add(SESSION, PLAYER, 3, 11);

    expect(h.slots.get(3)).toBe(289);
  });
});

describe("ShortcutsService.move", () => {
  test("vacates the source and claims the destination", async () => {
    const h = harness();
    await h.service.add(SESSION, PLAYER, 3, 10);
    h.frames.length = 0;

    const result = await h.service.move(SESSION, PLAYER, 3, 20);

    expect(result.ok).toBe(true);
    expect(h.slots.has(3)).toBe(false);
    expect(h.slots.get(20)).toBe(1182);
    // Both ends are announced, in that order: the bar must never show
    // the same shortcut twice, not even for one frame.
    expect(h.frames).toEqual([
      { kind: "remove", slot: 3 },
      { kind: "add", slot: 20, templateId: 1182 },
    ]);
  });

  test("refuses an empty source", async () => {
    const h = harness();

    const result = await h.service.move(SESSION, PLAYER, 3, 20);

    expect(result).toEqual({ ok: false, reason: "empty-slot" });
    expect(h.frames).toEqual([]);
  });

  test("a drop back onto the same slot is a no-op", async () => {
    const h = harness();
    await h.service.add(SESSION, PLAYER, 3, 10);
    h.frames.length = 0;

    const result = await h.service.move(SESSION, PLAYER, 3, 3);

    expect(result).toEqual({ ok: false, reason: "same-slot" });
    expect(h.slots.get(3)).toBe(1182);
    expect(h.frames).toEqual([]);
  });

  test("swaps with an occupied destination", async () => {
    const h = harness([
      { unicId: "10", playerId: PLAYER, templateId: 1182 },
      { unicId: "11", playerId: PLAYER, templateId: 289 },
    ]);
    await h.service.add(SESSION, PLAYER, 3, 10);
    await h.service.add(SESSION, PLAYER, 4, 11);
    h.frames.length = 0;

    await h.service.move(SESSION, PLAYER, 3, 4);

    expect(h.slots.get(4)).toBe(1182);
    // The source keeps the destination's shortcut instead of emptying:
    // rearranging a full bar must not cost the player a slot.
    expect(h.slots.get(3)).toBe(289);
    // No OrR — neither slot ends up empty, and an OrR here would blank
    // the source on the client before its OrA refilled it.
    expect(h.frames).toEqual([
      { kind: "add", slot: 3, templateId: 289 },
      { kind: "add", slot: 4, templateId: 1182 },
    ]);
  });
});

describe("ShortcutsService.remove", () => {
  test("clears the slot and says so", async () => {
    const h = harness();
    await h.service.add(SESSION, PLAYER, 3, 10);
    h.frames.length = 0;

    const result = await h.service.remove(SESSION, PLAYER, 3);

    expect(result.ok).toBe(true);
    expect(h.slots.has(3)).toBe(false);
    expect(h.frames).toEqual([{ kind: "remove", slot: 3 }]);
  });

  test("an empty slot emits nothing", async () => {
    const h = harness();

    const result = await h.service.remove(SESSION, PLAYER, 3);

    expect(result).toEqual({ ok: false, reason: "empty-slot" });
    expect(h.frames).toEqual([]);
  });
});
