import { describe, expect, test } from "bun:test";

import type { DecodedCell } from "@modules/maps/maps.cells-codec";
import { InteractiveObjectsService } from "@modules/interactive-objects/interactive-objects.service";

const HOUSE_DOOR_GFX = 6749;
const ZAAP_GFX = 7000;
const CHEST_GFX = 7350;

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
}

function harness(options: HarnessOptions) {
  const recorded: Recorded = { teleports: [], zaapMenus: 0, storage: [] };
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
    countHouseStorage: async () => options.houseStorageCount ?? 0,
    countAccountBank: async () => options.bankCount ?? 0,
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

  const service = new InteractiveObjectsService(
    repo as never,
    mapCache as never,
    presence as never,
    transition as never,
    waypoints as never,
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
  });
});
