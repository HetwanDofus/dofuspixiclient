import { describe, expect, test } from "bun:test";

import { canEquip, type EquipCheckInput } from "@modules/inventory/equip-rules";

function input(overrides: Partial<EquipCheckInput> = {}): EquipCheckInput {
  return {
    candidate: { superTypePositions: [6], twoHanded: false, level: 1 },
    position: 6,
    playerLevel: 1,
    equipped: [],
    currentPods: 0,
    maxPods: 1000,
    ...overrides,
  };
}

describe("canEquip", () => {
  test("a legal position for the item's superType is allowed", () => {
    expect(canEquip(input())).toEqual({ ok: true });
  });

  test("a position outside the superType's legal list is refused", () => {
    expect(canEquip(input({ position: 7 }))).toEqual({
      ok: false,
      reason: "invalid-position",
    });
  });

  test("a position outside the valid range is refused even if it slipped into positions", () => {
    // Defense in depth: item_super_types data for some non-equippable
    // superTypes (e.g. "Toniques") carries out-of-range values.
    expect(
      canEquip(
        input({
          candidate: { superTypePositions: [65], twoHanded: false, level: 1 },
          position: 65,
        })
      )
    ).toEqual({ ok: false, reason: "invalid-position" });
  });

  test("a character below the item's level is refused", () => {
    expect(
      canEquip(
        input({
          candidate: { superTypePositions: [6], twoHanded: false, level: 20 },
        })
      )
    ).toEqual({ ok: false, reason: "level-too-low" });
  });

  test("a character exactly at the required level is allowed", () => {
    expect(
      canEquip(
        input({
          candidate: { superTypePositions: [6], twoHanded: false, level: 5 },
          playerLevel: 5,
        })
      )
    ).toEqual({ ok: true });
  });

  test("a two-handed weapon is allowed while a shield is worn — InventoryService auto-unequips the shield, canEquip does not refuse", () => {
    expect(
      canEquip(
        input({
          candidate: { superTypePositions: [1], twoHanded: true, level: 1 },
          position: 1,
          equipped: [{ position: 15, twoHanded: false }],
        })
      )
    ).toEqual({ ok: true });
  });

  test("a shield is refused while a two-handed weapon is worn", () => {
    expect(
      canEquip(
        input({
          candidate: { superTypePositions: [15], twoHanded: false, level: 1 },
          position: 15,
          equipped: [{ position: 1, twoHanded: true }],
        })
      )
    ).toEqual({ ok: false, reason: "two-handed-conflict" });
  });

  test("a one-handed weapon is fine alongside a shield", () => {
    expect(
      canEquip(
        input({
          candidate: { superTypePositions: [1], twoHanded: false, level: 1 },
          position: 1,
          equipped: [{ position: 15, twoHanded: false }],
        })
      )
    ).toEqual({ ok: true });
  });

  test("a shield is fine alongside a one-handed weapon", () => {
    expect(
      canEquip(
        input({
          candidate: { superTypePositions: [15], twoHanded: false, level: 1 },
          position: 15,
          equipped: [{ position: 1, twoHanded: false }],
        })
      )
    ).toEqual({ ok: true });
  });

  test("already over capacity refuses any equip", () => {
    expect(canEquip(input({ currentPods: 1001, maxPods: 1000 }))).toEqual({
      ok: false,
      reason: "over-capacity",
    });
  });

  test("exactly at capacity is still allowed", () => {
    expect(canEquip(input({ currentPods: 1000, maxPods: 1000 }))).toEqual({
      ok: true,
    });
  });
});
