import { describe, expect, test } from "bun:test";

import { animCycleTriggerFrame } from "@/game/scene/player/animation";

describe("animCycleTriggerFrame", () => {
  test("rings on the frame the class metadata lands the action", () => {
    // `anim17R` on a class sprite: 45 frames, applyEnd 18.
    expect(animCycleTriggerFrame(45, 18)).toBe(18);
  });

  test("falls back to the last frame with no metadata", () => {
    expect(animCycleTriggerFrame(45, null)).toBe(44);
  });

  test("never leaves the animation", () => {
    expect(animCycleTriggerFrame(20, 99)).toBe(19);
  });

  test("an applyEnd of 0 would never re-arm, so it rings at the end", () => {
    expect(animCycleTriggerFrame(45, 0)).toBe(44);
  });
});
