import { describe, expect, test } from "bun:test";

import {
  REGEN_MS_PER_LIFE_STANDING,
  resolveLife,
} from "@modules/life-regen/life-regen";

const T0 = new Date("2026-08-23T10:00:00.000Z");
const NOW = T0.getTime();

function after(seconds: number): number {
  return NOW + seconds * 1000;
}

describe("resolveLife", () => {
  test("grants one point per regeneration period", () => {
    const resolved = resolveLife({
      life: 100,
      maxLife: 500,
      lifeUpdatedAt: T0,
      now: after(10),
    });

    expect(resolved.life).toBe(100 + 10_000 / REGEN_MS_PER_LIFE_STANDING);
    expect(resolved.changed).toBe(true);
  });

  test("less than one period's worth grants nothing and writes nothing", () => {
    const resolved = resolveLife({
      life: 100,
      maxLife: 500,
      lifeUpdatedAt: T0,
      now: NOW + REGEN_MS_PER_LIFE_STANDING - 1,
    });

    expect(resolved.life).toBe(100);
    expect(resolved.changed).toBe(false);
    // The timestamp must not move, or the leftover time is lost and a
    // client polling faster than the period would never regenerate.
    expect(resolved.lifeUpdatedAt).toBe(T0);
  });

  test("the leftover fraction of a period carries over", () => {
    // Three and a half periods: three points now, half a period banked.
    const first = resolveLife({
      life: 100,
      maxLife: 500,
      lifeUpdatedAt: T0,
      now: NOW + REGEN_MS_PER_LIFE_STANDING * 3.5,
    });

    expect(first.life).toBe(103);

    // Half a period later, the banked half completes a fourth point.
    const second = resolveLife({
      life: first.life,
      maxLife: 500,
      lifeUpdatedAt: first.lifeUpdatedAt,
      now: NOW + REGEN_MS_PER_LIFE_STANDING * 4,
    });

    expect(second.life).toBe(104);
  });

  test("never exceeds the cap, however long the absence", () => {
    const resolved = resolveLife({
      life: 100,
      maxLife: 500,
      lifeUpdatedAt: T0,
      // A week offline.
      now: after(7 * 24 * 3600),
    });

    expect(resolved.life).toBe(500);
  });

  test("a character at full life is left alone and triggers no write", () => {
    const resolved = resolveLife({
      life: 500,
      maxLife: 500,
      lifeUpdatedAt: T0,
      now: after(3600),
    });

    expect(resolved.life).toBe(500);
    expect(resolved.changed).toBe(false);
  });

  test("life above a shrunken cap resolves down to it", () => {
    // Unequipping a vitality item lowers the derived maximum below the
    // current life. The cap is computed, not stored, so this is normal
    // and must settle rather than persist.
    const resolved = resolveLife({
      life: 600,
      maxLife: 500,
      lifeUpdatedAt: T0,
      now: NOW,
    });

    expect(resolved.life).toBe(500);
    expect(resolved.changed).toBe(true);
  });

  test("a never-measured character gains nothing but gets a baseline", () => {
    const resolved = resolveLife({
      life: 100,
      maxLife: 500,
      lifeUpdatedAt: null,
      now: NOW,
    });

    expect(resolved.life).toBe(100);
    // Changed so the caller stamps the timestamp: without a baseline the
    // next read would grant nothing either, forever.
    expect(resolved.changed).toBe(true);
    expect(resolved.lifeUpdatedAt.getTime()).toBe(NOW);
  });

  test("a clock that went backwards never removes life", () => {
    const resolved = resolveLife({
      life: 100,
      maxLife: 500,
      lifeUpdatedAt: T0,
      now: after(-3600),
    });

    expect(resolved.life).toBe(100);
    expect(resolved.changed).toBe(false);
  });
});
