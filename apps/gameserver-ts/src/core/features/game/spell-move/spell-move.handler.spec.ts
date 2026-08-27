import { describe, expect, test } from "bun:test";

import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import type { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { SpellMoveRequestSchema } from "@dofus/proto/spells_pb";
import {
  SpellsRepository,
  UNSLOTTED_POSITION,
} from "@modules/spells/spells.repository";

import { SpellMoveHandler } from "./spell-move.handler";

const SESSION = "s-1";
const CHARACTER = "1";

/** What the client would see, in the order it would see it. */
type Frame =
  | { kind: "move"; spellId: number; position: number }
  | { kind: "remove"; position: number };

interface Harness {
  handle: (spellId: number, newSlot: number) => Promise<void>;
  /** spellId → position, the `player_spells` column under test. */
  positions: Map<number, number>;
  frames: Frame[];
}

/**
 * The handler's whole job is deciding *which* rows move and what the
 * client is told, so the repository is a Map and the gateway an array.
 * `withTransaction` runs inline — nothing here depends on rollback.
 */
function harness(initial: [number, number][]): Harness {
  const positions = new Map<number, number>(initial);
  const frames: Frame[] = [];

  const spells = {
    findPlayerSpell: async (_playerId: string, spellId: number) => {
      const position = positions.get(spellId);
      return position === undefined ? undefined : { spellId, position };
    },
    findPlayerSpellAtPosition: async (_playerId: string, position: number) => {
      for (const [spellId, at] of positions) {
        if (at === position) {
          return { spellId, position };
        }
      }
      return undefined;
    },
    setPlayerSpellPosition: async (
      _playerId: string,
      spellId: number,
      position: number
    ) => {
      positions.set(spellId, position);
    },
  } as unknown as SpellsRepository;

  const sessions = {
    get: () => ({ characterId: CHARACTER }),
  } as unknown as SessionRegistry;

  const gateway = {
    broadcast: (_sessions: string[], msg: { payload: unknown }) => {
      const { case: kind, value } = msg.payload as {
        case: string;
        value: { spellId?: number; position: number };
      };
      frames.push(
        kind === "spellMove"
          ? {
              kind: "move",
              spellId: value.spellId ?? 0,
              position: value.position,
            }
          : { kind: "remove", position: value.position }
      );
    },
  } as unknown as GatewayFrameService;

  const txHost = {
    withTransaction: <T>(fn: () => Promise<T>) => fn(),
  } as never;

  const handler = new SpellMoveHandler(txHost, sessions, gateway, spells);
  const ctx = { sessionId: SESSION } as HandlerContext;

  return {
    handle: (spellId, newSlot) =>
      handler.handle(ctx, create(SpellMoveRequestSchema, { spellId, newSlot })),
    positions,
    frames,
  };
}

describe("SpellMoveHandler", () => {
  test("moves a spell into an empty slot", async () => {
    const h = harness([[101, 3]]);

    await h.handle(101, 7);

    expect(h.positions.get(101)).toBe(7);
    expect(h.frames).toEqual([
      { kind: "remove", position: 3 },
      { kind: "move", spellId: 101, position: 7 },
    ]);
  });

  test("swaps two spells already on the bar", async () => {
    const h = harness([
      [101, 3],
      [202, 7],
    ]);

    await h.handle(101, 7);

    expect(h.positions.get(101)).toBe(7);
    expect(h.positions.get(202)).toBe(3);
    // No SR at all: neither slot ends up empty, and the mover's SM has
    // to land first — it is what evicts 202 client-side before 202's own
    // SM claims slot 3.
    expect(h.frames).toEqual([
      { kind: "move", spellId: 101, position: 7 },
      { kind: "move", spellId: 202, position: 3 },
    ]);
  });

  test("a spell from the book evicts the slot's occupant", async () => {
    const h = harness([
      [101, UNSLOTTED_POSITION],
      [202, 7],
    ]);

    await h.handle(101, 7);

    expect(h.positions.get(101)).toBe(7);
    // Nothing to swap into — the mover had no slot of its own.
    expect(h.positions.get(202)).toBe(UNSLOTTED_POSITION);
    expect(h.frames).toEqual([
      { kind: "remove", position: 7 },
      { kind: "move", spellId: 101, position: 7 },
    ]);
  });

  test("dragging a spell off the bar clears its slot", async () => {
    const h = harness([[101, 3]]);

    await h.handle(101, UNSLOTTED_POSITION);

    expect(h.positions.get(101)).toBe(UNSLOTTED_POSITION);
    expect(h.frames).toEqual([{ kind: "remove", position: 3 }]);
  });

  test("a drop back onto the same slot changes nothing", async () => {
    const h = harness([[101, 3]]);

    await h.handle(101, 3);

    expect(h.positions.get(101)).toBe(3);
    expect(h.frames).toEqual([]);
  });

  test("refuses a spell the character does not own", async () => {
    const h = harness([[101, 3]]);

    await h.handle(999, 7);

    expect(h.positions.has(999)).toBe(false);
    expect(h.frames).toEqual([]);
  });

  test("refuses a slot outside the bar", async () => {
    const h = harness([[101, 3]]);

    await h.handle(101, 99);

    expect(h.positions.get(101)).toBe(3);
    expect(h.frames).toEqual([]);
  });
});
