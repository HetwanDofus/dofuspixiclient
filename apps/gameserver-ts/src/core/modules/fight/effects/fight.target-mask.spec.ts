import { describe, expect, it } from "bun:test";

import type { Fighter } from "@modules/fight/core/fight.fighter";

import {
  isValidTarget,
  parseTargetParam,
  TargetMask,
} from "@modules/fight/effects/fight.target-mask";

function fighter(id: number, side: 0 | 1 = 0): Fighter {
  return {
    id,
    team: { side },
    dead: false,
  } as unknown as Fighter;
}

describe("isValidTarget", () => {
  const caster = fighter(1, 0);
  const ally = fighter(2, 0);
  const enemy = fighter(3, 1);

  it("mask 0 (no filter) accepts everything", () => {
    expect(isValidTarget(0, caster, null)).toBe(true);
    expect(isValidTarget(0, caster, ally)).toBe(true);
    expect(isValidTarget(0, caster, enemy)).toBe(true);
  });

  it("Enemy mask only accepts enemies", () => {
    expect(isValidTarget(TargetMask.Enemy, caster, enemy)).toBe(true);
    expect(isValidTarget(TargetMask.Enemy, caster, ally)).toBe(false);
    expect(isValidTarget(TargetMask.Enemy, caster, caster)).toBe(false);
    expect(isValidTarget(TargetMask.Enemy, caster, null)).toBe(false);
  });

  it("AlliesAndSelf mask accepts allies and caster but not enemies", () => {
    expect(isValidTarget(TargetMask.AlliesAndSelf, caster, ally)).toBe(true);
    expect(isValidTarget(TargetMask.AlliesAndSelf, caster, caster)).toBe(true);
    expect(isValidTarget(TargetMask.AlliesAndSelf, caster, enemy)).toBe(false);
  });

  it("EmptyOnly mask only accepts empty cells", () => {
    expect(isValidTarget(TargetMask.EmptyOnly, caster, null)).toBe(true);
    expect(isValidTarget(TargetMask.EmptyOnly, caster, enemy)).toBe(false);
    expect(isValidTarget(TargetMask.EmptyOnly, caster, ally)).toBe(false);
  });
});

describe("parseTargetParam", () => {
  it("parses FT=N codes", () => {
    expect(parseTargetParam("FT=1")).toBe(TargetMask.Enemy);
    expect(parseTargetParam("FT=2")).toBe(TargetMask.Ally);
    expect(parseTargetParam("FT=4")).toBe(TargetMask.Self);
    expect(parseTargetParam("FT=7")).toBe(
      TargetMask.Enemy | TargetMask.Ally | TargetMask.Self
    );
  });

  it("returns null when no FT= directive present", () => {
    expect(parseTargetParam("")).toBeNull();
    expect(parseTargetParam("Cm<10")).toBeNull();
    expect(parseTargetParam("PB=86")).toBeNull();
  });

  it("returns null on unknown FT codes", () => {
    expect(parseTargetParam("FT=99")).toBeNull();
  });

  it("extracts FT= even when other directives precede it", () => {
    expect(parseTargetParam("Cm<10;FT=1")).toBe(TargetMask.Enemy);
  });
});
