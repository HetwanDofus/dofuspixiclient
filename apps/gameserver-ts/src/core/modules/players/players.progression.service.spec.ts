import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { PlayersRepository } from "@modules/players/players.repository";
import type { SpellsService } from "@modules/spells/spells.service";
import { xpForLevel } from "@modules/players/players.progression.constants";
import {
  levelForExperience,
  PlayersProgressionService,
} from "@modules/players/players.progression.service";

const PLAYER = "42";
/** Féca. Only used to check the class reaches `learnClassSpells`. */
const FECA = 1;

interface FakePlayer {
  level: number;
  class: number;
  experience: string;
}

let player: FakePlayer;
let grants: number[];
let learnCalls: Array<{ classId: number; level: number }>;
let service: PlayersProgressionService;

beforeEach(() => {
  player = { level: 1, class: FECA, experience: "0" };
  grants = [];
  learnCalls = [];

  const players = {
    findById: async () => ({ ...player }),
    grantLevels: async (_id: string, levels: number) => {
      grants.push(levels);
      player.level += levels;
    },
  } as unknown as PlayersRepository;

  const spells = {
    learnClassSpells: async (
      _playerId: string,
      classId: number,
      level: number
    ) => {
      learnCalls.push({ classId, level });
      return [];
    },
  } as unknown as SpellsService;

  service = new PlayersProgressionService(players, spells);
});

describe("levelForExperience", () => {
  test("stays put below the next threshold", () => {
    expect(levelForExperience(1, xpForLevel(2) - 1)).toBe(1);
  });

  test("climbs every level the experience covers, not just one", () => {
    // The bug this replaces: one `if` per fight, so a kill worth three
    // levels granted one and banked the rest.
    expect(levelForExperience(1, xpForLevel(4))).toBe(4);
  });

  test("never descends when the level was raised past the experience", () => {
    // Levels in this project get set by hand in SQL; reconciling must
    // not read that as "owes 100 levels of experience" and demote.
    expect(levelForExperience(101, 0)).toBe(101);
  });

  test("stops at the 1.29 ceiling", () => {
    expect(levelForExperience(1, Number.MAX_SAFE_INTEGER)).toBe(200);
  });
});

describe("applyExperience", () => {
  test("grants the levels in one call and learns their spells", async () => {
    player.experience = String(xpForLevel(4));

    const result = await service.applyExperience(PLAYER);

    expect(result).toEqual({
      previousLevel: 1,
      level: 4,
      learnedSpellIds: [],
    });
    // One grant of three, not three grants of one: the row is never
    // observable at an intermediate level.
    expect(grants).toEqual([3]);
    expect(learnCalls).toEqual([{ classId: FECA, level: 4 }]);
  });

  test("does not touch the spell book when no level was crossed", async () => {
    player.experience = String(xpForLevel(2) - 1);

    const result = await service.applyExperience(PLAYER);

    expect(result?.level).toBe(1);
    expect(grants).toEqual([]);
    // The common case — one fight in a hundred levels anyone up. It must
    // not cost a spell query.
    expect(learnCalls).toEqual([]);
  });

  test("reports the character is gone rather than inventing one", async () => {
    const players = {
      findById: async () => undefined,
      grantLevels: async () => {
        throw new Error("must not be called");
      },
    } as unknown as PlayersRepository;

    const gone = new PlayersProgressionService(players, {
      learnClassSpells: async () => [],
    } as unknown as SpellsService);

    expect(await gone.applyExperience(PLAYER)).toBeUndefined();
  });
});

describe("syncSpellBook", () => {
  test("reconciles at the current level, whatever produced it", async () => {
    player.level = 101;

    await service.syncSpellBook(PLAYER);

    expect(learnCalls).toEqual([{ classId: FECA, level: 101 }]);
    expect(grants).toEqual([]);
  });
});
