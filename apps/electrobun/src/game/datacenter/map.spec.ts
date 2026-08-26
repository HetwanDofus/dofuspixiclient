import { describe, expect, test } from "bun:test";

import { computeMapScale, projectCellPosition } from "@/game/datacenter/map";

// The tile layers place every sprite at `pos * scale + offset`
// (`layer-builder.ts`). Anything else drawn from cell coordinates into the
// map containers — world actors above all — has to agree, or it drifts off
// the terrain. QA-088.

describe("computeMapScale", () => {
  test("is the identity on the default 15x17 map", () => {
    expect(computeMapScale(15, 17)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  test("recentres a smaller map without scaling it", () => {
    // An 11x13 house interior: (11-1)*53 = 530 wide against a 742 viewport,
    // (13-1)*27 = 324 tall against 432.
    expect(computeMapScale(11, 13)).toEqual({
      scale: 1,
      offsetX: 106,
      offsetY: 54,
    });
  });

  test("shrinks a map larger than the viewport on both axes", () => {
    const { scale } = computeMapScale(19, 22);

    expect(scale).toBeLessThan(1);
    expect(scale).toBeCloseTo(742 / ((19 - 1) * 53), 5);
  });
});

describe("projectCellPosition", () => {
  test("leaves a position untouched under the identity transform", () => {
    const identity = { scale: 1, offsetX: 0, offsetY: 0 };

    expect(projectCellPosition({ x: 185, y: 256 }, identity)).toEqual({
      x: 185,
      y: 256,
    });
  });

  test("applies the offset an 11x13 map centres its terrain by", () => {
    // Cell 203 of a house interior — where the character stood on the wall
    // for as long as actors skipped this transform.
    expect(
      projectCellPosition({ x: 185.5, y: 256.5 }, computeMapScale(11, 13))
    ).toEqual({ x: 291.5, y: 310.5 });
  });

  test("scales before offsetting", () => {
    expect(
      projectCellPosition(
        { x: 100, y: 200 },
        { scale: 0.5, offsetX: 10, offsetY: 20 }
      )
    ).toEqual({ x: 60, y: 120 });
  });
});
