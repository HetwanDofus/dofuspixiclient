import { describe, expect, test } from "bun:test";

import type { DecodedCell } from "@modules/maps/maps.cells-codec";
import { ExchangeType } from "@dofus/proto/common_pb";
import { InteractiveObjectsService } from "@modules/interactive-objects/interactive-objects.service";
import { type ItemOwner, OwnerKind } from "@modules/items/item-owner";

const HOUSE_DOOR_GFX = 6749;
const ZAAP_GFX = 7000;
const CHEST_GFX = 7350;
/** Frêne — `IO.g[7500] = 1`, whose only skill is 6 "Couper". */
const ASH_GFX = 7500;
/** Scie — `IO.g[7003] = 2`, type 2 (workbench), skill 101 "Scier". */
const SAW_GFX = 7003;

function cell(overrides: Partial<DecodedCell> = {}): DecodedCell {
  return {
    id: 0,
    active: true,
    ground: 0,
    layer1: 0,
    layer2: 0,
    groundLevel: 0,
    groundSlope: 0,
    walkable: true,
    movement: 1,
    lineOfSight: true,
    layerGroundRot: 0,
    layerGroundFlip: false,
    layerObject1Rot: 0,
    layerObject1Flip: false,
    layerObject2Rot: 0,
    layerObject2Flip: false,
    layerObject2Interactive: false,
    ...overrides,
  };
}

interface Recorded {
  teleports: {
    mapId: number;
    cellId: number;
  }[];
  zaapMenus: number;
  storage: { totalSlots: number; usedSlots: number }[];
  exchanges: { kind: number; ownerKind: number; ownerId: string }[];
  harvests: { cellId: number; skillId: number }[];
  benches: {
    skillId: number;
    jobId: number;
    jobLevel: number;
    maxSlots: number;
  }[];
}

interface HarnessOptions {
  cells: DecodedCell[];
  templates?: Record<number, { type: number; skills: string }>;
  houseByDoor?: {
    id: string;
    entryMapId: number | null;
    entryCellId: number | null;
  } | null;
  houseByInteriorMap?: { id: string } | null;
  houseStorageCount?: number;
  bankCount?: number;
  /** Skill ids the referential would report as runnable harvests. */
  harvestSkills?: number[];
  /** Skill ids the referential would report as craft skills. */
  craftSkills?: number[];
  /** The level the character has in the job; absent means "no job". */
  jobLevel?: number;
}

function harness(options: HarnessOptions) {
  const recorded: Recorded = {
    teleports: [],
    zaapMenus: 0,
    storage: [],
    exchanges: [],
    harvests: [],
    benches: [],
  };
  const harvestSkills = new Map(
    (options.harvestSkills ?? []).map((id) => [id, { id }])
  );
  const templates = options.templates ?? {
    [HOUSE_DOOR_GFX]: { type: 5, skills: "97,100,84,108,98,81" },
    [ZAAP_GFX]: { type: 3, skills: "114" },
    [CHEST_GFX]: { type: 6, skills: "106,104,105" },
  };

  const repo = {
    findTemplate: async (gfxId: number) => {
      const t = templates[gfxId];
      return t
        ? { id: gfxId, name: `gfx-${gfxId}`, type: t.type, skills: t.skills }
        : undefined;
    },
    findHouseByDoor: async () => options.houseByDoor ?? undefined,
    findHouseByInteriorMap: async () => options.houseByInteriorMap ?? undefined,
    // One method now, told apart by the owner the service built. That
    // makes this fake assert something the old pair could not: which
    // container the chest actually resolved to, not merely which of two
    // methods got called.
    countStacks: async (owner: ItemOwner) =>
      owner.kind === OwnerKind.House
        ? (options.houseStorageCount ?? 0)
        : (options.bankCount ?? 0),
  };

  const mapCache = {
    load: async () => ({
      id: 7411,
      width: 15,
      height: 17,
      cells: options.cells,
    }),
  };

  const presence = {
    getByCharacter: () => ({ mapId: 7411, cellId: 216 }),
  };

  const transition = {
    teleport: async (
      _sessionId: string,
      _characterId: string,
      mapId: number,
      cellId: number
    ) => {
      recorded.teleports.push({ mapId, cellId });
    },
  };

  const waypoints = {
    openZaapMenu: async () => {
      recorded.zaapMenus++;
    },
  };

  const frames = {
    broadcast: (
      _targets: string[],
      msg: {
        payload: {
          value?: { totalSlots?: number; usedSlots?: number };
        };
      }
    ) => {
      recorded.storage.push({
        totalSlots: msg.payload.value?.totalSlots ?? -1,
        usedSlots: msg.payload.value?.usedSlots ?? -1,
      });
    },
  };

  const exchange = {
    openCraft: async (
      _sessionId: string,
      _accountId: string,
      _characterId: string,
      skillId: number,
      jobId: number,
      jobLevel: number,
      maxSlots: number
    ) => {
      recorded.benches.push({ skillId, jobId, jobLevel, maxSlots });
      return { ok: true as const };
    },
    openStorage: async (
      _sessionId: string,
      _accountId: string,
      _characterId: string,
      owner: ItemOwner,
      kind: number
    ) => {
      recorded.exchanges.push({
        kind,
        ownerKind: owner.kind,
        ownerId: owner.id,
      });
      return { ok: true as const };
    },
  };

  // The referential is not loaded in these tests: every skill they exercise
  // is one of the three the service handles itself. `runnableHarvestSkill`
  // answering "no" is what routes anything else to the log, which is the
  // branch the "not implemented" cases below assert on.
  const catalog = {
    load: async () => {},
    runnableHarvestSkill: (id: number) => harvestSkills.get(id),
    skill: (id: number) =>
      (options.craftSkills ?? []).includes(id)
        ? { id, jobId: 2, kind: 2, minLevel: 1 }
        : harvestSkills.get(id),
  };

  const jobs = {
    findPlayerJob: async () =>
      options.jobLevel === undefined
        ? undefined
        : { jobId: 2, level: options.jobLevel, experience: "0" },
  };

  const harvest = {
    start: async (
      _sessionId: string,
      _characterId: string,
      cellId: number,
      skillId: number
    ) => {
      recorded.harvests.push({ cellId, skillId });
      return { ok: true as const, durationMs: 12_000 };
    },
  };

  const service = new InteractiveObjectsService(
    repo as never,
    mapCache as never,
    presence as never,
    transition as never,
    waypoints as never,
    exchange as never,
    catalog as never,
    jobs as never,
    harvest as never,
    frames as never
  );

  return { service, recorded };
}

function mapWithElement(cellId: number, gfx: number, interactive: boolean) {
  const cells: DecodedCell[] = [];

  for (let i = 0; i <= cellId; i++) {
    cells.push(
      i === cellId
        ? cell({ id: i, layer2: gfx, layerObject2Interactive: interactive })
        : cell({ id: i })
    );
  }

  return cells;
}

describe("InteractiveObjectsService.use", () => {
  test("enters a house through a door and lands on its entry cell", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(170, HOUSE_DOOR_GFX, true),
      houseByDoor: { id: "654", entryMapId: 7668, entryCellId: 203 },
    });

    await service.use("s1", "acc1", "char1", 170, 84);

    expect(recorded.teleports).toEqual([{ mapId: 7668, cellId: 203 }]);
  });

  test("keeps a house shut when the importer found no way back out", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(170, HOUSE_DOOR_GFX, true),
      houseByDoor: { id: "126", entryMapId: null, entryCellId: null },
    });

    await service.use("s1", "acc1", "char1", 170, 84);

    expect(recorded.teleports).toEqual([]);
  });

  test("refuses a cell whose interactive bit is not armed", async () => {
    // Same gfx, decoration rather than element — the whole point of shipping
    // the bit instead of matching on the gfx id.
    const { service, recorded } = harness({
      cells: mapWithElement(170, HOUSE_DOOR_GFX, false),
      houseByDoor: { id: "654", entryMapId: 7668, entryCellId: 203 },
    });

    await service.use("s1", "acc1", "char1", 170, 84);

    expect(recorded.teleports).toEqual([]);
  });

  test("refuses a skill the element does not offer", async () => {
    // "Entrer" (84) aimed at a zaap: the client can name any pair it likes,
    // the template decides.
    const { service, recorded } = harness({
      cells: mapWithElement(297, ZAAP_GFX, true),
      houseByDoor: { id: "654", entryMapId: 7668, entryCellId: 203 },
    });

    await service.use("s1", "acc1", "char1", 297, 84);

    expect(recorded.teleports).toEqual([]);
    expect(recorded.zaapMenus).toBe(0);
  });

  test("opens the zaap menu on skill 114", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(297, ZAAP_GFX, true),
    });

    await service.use("s1", "acc1", "char1", 297, 114);

    expect(recorded.zaapMenus).toBe(1);
  });

  test("a chest on a map with no house opens the account bank", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(213, CHEST_GFX, true),
      houseByInteriorMap: null,
      bankCount: 7,
    });

    await service.use("s1", "acc1", "char1", 213, 104);

    expect(recorded.storage).toEqual([{ totalSlots: 100, usedSlots: 7 }]);
    // `sI` announces the size; the contents are the exchange, and the
    // bank is keyed by account so that a player's characters share it.
    expect(recorded.exchanges).toEqual([
      {
        kind: ExchangeType.EXCHANGE_STORAGE,
        ownerKind: OwnerKind.Bank,
        ownerId: "acc1",
      },
    ]);
  });

  test("a chest inside a house opens that house's storage", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(154, CHEST_GFX, true),
      houseByInteriorMap: { id: "711" },
      houseStorageCount: 3,
      bankCount: 99,
    });

    await service.use("s1", "acc1", "char1", 154, 104);

    expect(recorded.storage).toEqual([{ totalSlots: 100, usedSlots: 3 }]);
    expect(recorded.exchanges).toEqual([
      {
        kind: ExchangeType.EXCHANGE_STORAGE,
        ownerKind: OwnerKind.House,
        ownerId: "711",
      },
    ]);
  });

  test("does nothing for a skill that is offered but not implemented", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(170, HOUSE_DOOR_GFX, true),
      houseByDoor: { id: "654", entryMapId: 7668, entryCellId: 203 },
    });

    // 97 = "Acheter" — listed by the door, greyed out in the client's menu.
    await service.use("s1", "acc1", "char1", 170, 97);

    expect(recorded.teleports).toEqual([]);
    expect(recorded.storage).toEqual([]);
    expect(recorded.harvests).toEqual([]);
  });

  test("hands a harvest skill to the harvest service", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(170, ASH_GFX, true),
      templates: { [ASH_GFX]: { type: 1, skills: "6" } },
      harvestSkills: [6],
    });

    await service.use("s1", "acc1", "char1", 170, 6);

    expect(recorded.harvests).toEqual([{ cellId: 170, skillId: 6 }]);
  });

  test("a harvest skill the referential cannot run is logged, not run", async () => {
    // The three jobless gathers (`Ramasser`, `Jouer`, `Pêcher KoinKoin`)
    // import without a level or an experience value, and this is where that
    // shows: the element offers the skill and nothing happens.
    const { service, recorded } = harness({
      cells: mapWithElement(170, ASH_GFX, true),
      templates: { [ASH_GFX]: { type: 1, skills: "42" } },
      harvestSkills: [],
    });

    await service.use("s1", "acc1", "char1", 170, 42);

    expect(recorded.harvests).toEqual([]);
  });

  test("a workbench opens a craft window sized to the job level", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(170, SAW_GFX, true),
      templates: { [SAW_GFX]: { type: 2, skills: "101" } },
      craftSkills: [101],
      jobLevel: 40,
    });

    await service.use("s1", "acc1", "char1", 170, 101);

    expect(recorded.benches).toEqual([
      { skillId: 101, jobId: 2, jobLevel: 40, maxSlots: 5 },
    ]);
  });

  test("a workbench stays shut for a character without the job", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(170, SAW_GFX, true),
      templates: { [SAW_GFX]: { type: 2, skills: "101" } },
      craftSkills: [101],
    });

    await service.use("s1", "acc1", "char1", 170, 101);

    expect(recorded.benches).toEqual([]);
  });

  test("a craft skill on something that is not a workbench does nothing", async () => {
    // The same skill list on a resource: the type is what separates a bench
    // from a tree, and neither branch may claim the other's element.
    const { service, recorded } = harness({
      cells: mapWithElement(170, ASH_GFX, true),
      templates: { [ASH_GFX]: { type: 1, skills: "101" } },
      craftSkills: [101],
      jobLevel: 40,
    });

    await service.use("s1", "acc1", "char1", 170, 101);

    expect(recorded.benches).toEqual([]);
    expect(recorded.harvests).toEqual([]);
  });

  test("stone polishing stays shut below level 40", async () => {
    const shut = harness({
      cells: mapWithElement(170, SAW_GFX, true),
      templates: { [SAW_GFX]: { type: 2, skills: "48" } },
      craftSkills: [48],
      jobLevel: 39,
    });

    await shut.service.use("s1", "acc1", "char1", 170, 48);
    expect(shut.recorded.benches).toEqual([]);

    const open = harness({
      cells: mapWithElement(170, SAW_GFX, true),
      templates: { [SAW_GFX]: { type: 2, skills: "48" } },
      craftSkills: [48],
      jobLevel: 40,
    });

    await open.service.use("s1", "acc1", "char1", 170, 48);
    expect(open.recorded.benches).toHaveLength(1);
  });

  test("a harvest skill the element does not offer never reaches the service", async () => {
    const { service, recorded } = harness({
      cells: mapWithElement(170, ASH_GFX, true),
      templates: { [ASH_GFX]: { type: 1, skills: "6" } },
      harvestSkills: [6, 10],
    });

    // 10 = "Couper" on an oak. Runnable, and not what stands on this cell.
    await service.use("s1", "acc1", "char1", 170, 10);

    expect(recorded.harvests).toEqual([]);
  });
});
