import { beforeEach, describe, expect, it } from "bun:test";

import {
  applySpellMove,
  applySpellRemove,
  type SpellEntry,
  spellsStore,
  UNSLOTTED_POSITION,
} from "./spells-store";

function spell(spellId: number, position: number): SpellEntry {
  return {
    spellId,
    level: 1,
    position,
    apCost: 3,
    rangeMin: 1,
    rangeMax: 5,
    lineOfSight: true,
    modifiableRange: false,
    emptyCell: false,
    lineOnly: false,
    castPerTurn: 0,
    castPerTarget: 0,
    cooldown: 0,
    criticalRate: 0,
    failureRate: 0,
    areaKind: 0,
    areaSize: 0,
    targetMask: 0,
    singleTargetSpawn: false,
    name: `Sort ${spellId}`,
    description: "",
    cooldownRemaining: 0,
  } as SpellEntry;
}

function seed(...spells: SpellEntry[]): void {
  spellsStore.replaceState({
    spells,
    byId: new Map(spells.map((s) => [s.spellId, s])),
  });
}

function positionOf(spellId: number): number | undefined {
  return spellsStore.getSnapshot().byId.get(spellId)?.position;
}

beforeEach(() => {
  spellsStore.replaceState({ spells: [], byId: new Map() });
});

describe("spells-store hotbar slots", () => {
  it("moves a spell into an empty slot", () => {
    seed(spell(101, UNSLOTTED_POSITION));

    applySpellMove(101, 3);

    expect(positionOf(101)).toBe(3);
  });

  it("evicts whatever held the destination", () => {
    seed(spell(101, 3), spell(102, UNSLOTTED_POSITION));

    applySpellMove(102, 3);

    expect(positionOf(102)).toBe(3);
    // The server sends its own SR for the evicted spell, but the two
    // frames race — the bar must never render one slot twice.
    expect(positionOf(101)).toBe(UNSLOTTED_POSITION);
  });

  it("takes a spell out of the bar on SR", () => {
    seed(spell(101, 3));

    applySpellRemove(3);

    expect(positionOf(101)).toBe(UNSLOTTED_POSITION);
  });

  it("does not re-render when nothing occupied the removed slot", () => {
    seed(spell(101, 3));
    const before = spellsStore.getSnapshot();

    applySpellRemove(7);

    expect(spellsStore.getSnapshot()).toBe(before);
  });

  it("keeps `spells` and `byId` in step", () => {
    seed(spell(101, 3), spell(102, 4));

    applySpellMove(101, 4);

    const { spells, byId } = spellsStore.getSnapshot();
    for (const s of spells) {
      expect(byId.get(s.spellId)).toBe(s);
    }
  });
});
