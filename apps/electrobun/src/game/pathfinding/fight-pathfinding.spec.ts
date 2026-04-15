import { describe, expect, it } from "bun:test";

import {
  createPathfindingFromMap,
  type FightPathfinding,
} from "./fight-pathfinding";

/**
 * Build a fully-walkable W×H grid so tests can focus on pathfinding logic
 * rather than map construction boilerplate.
 */
function fullyWalkable(width: number, height: number): FightPathfinding {
  const walkable = Array.from({ length: width * height }, (_, i) => i);
  return createPathfindingFromMap(width, height, walkable);
}

describe("FightPathfinding", () => {
  describe("findPath", () => {
    it("returns null when start or goal is unwalkable", () => {
      const pf = createPathfindingFromMap(5, 5, [0, 1, 2, 3]); // 4 isn't walkable
      expect(pf.findPath(0, 4)).toBeNull();
      expect(pf.findPath(4, 0)).toBeNull();
    });

    it("returns a single-cell path when start == goal", () => {
      const pf = fullyWalkable(5, 5);
      expect(pf.findPath(12, 12)).toEqual([12]);
    });

    it("includes both start and goal in the returned path", () => {
      const pf = fullyWalkable(5, 5);
      const path = pf.findPath(0, 1);
      expect(path).not.toBeNull();
      expect(path?.[0]).toBe(0);
      expect(path?.[path.length - 1]).toBe(1);
    });

    it("returns null when the goal is unreachable", () => {
      // Walkable islands: {0,1} and {24} — no connection
      const pf = createPathfindingFromMap(5, 5, [0, 1, 24]);
      expect(pf.findPath(0, 24)).toBeNull();
    });

    it("routes around occupied cells when a detour exists", () => {
      // 5×5 grid; block cell 7 (middle row, 2nd col) — detour available
      const pf = fullyWalkable(5, 5);
      pf.setOccupiedCells(new Set([7]));
      const path = pf.findPath(6, 8);
      expect(path).not.toBeNull();
      expect(path).not.toContain(7);
      expect(path?.[0]).toBe(6);
      expect(path?.[path.length - 1]).toBe(8);
    });

    it("allows occupied start and goal (you stand on them)", () => {
      const pf = fullyWalkable(3, 3);
      pf.addOccupied(0);
      pf.addOccupied(8);
      const path = pf.findPath(0, 8);
      expect(path).not.toBeNull();
      expect(path?.[0]).toBe(0);
      expect(path?.[path.length - 1]).toBe(8);
    });
  });

  describe("findPathWithMP", () => {
    it("returns full path when within MP budget", () => {
      const pf = fullyWalkable(5, 5);
      const full = pf.findPath(0, 4);
      const limited = pf.findPathWithMP(0, 4, 10);
      expect(limited).toEqual(full);
    });

    it("returns partial path truncated at MP limit", () => {
      const pf = fullyWalkable(5, 5);
      const limited = pf.findPathWithMP(0, 4, 2);
      expect(limited).not.toBeNull();
      // maxMP=2 → 2 steps → 3 cells including start
      expect(limited?.length).toBe(3);
      expect(limited?.[0]).toBe(0);
    });

    it("returns null when no path exists", () => {
      const pf = createPathfindingFromMap(5, 5, [0]);
      expect(pf.findPathWithMP(0, 24, 10)).toBeNull();
    });
  });

  describe("occupancy mutation", () => {
    it("removeOccupied re-opens a cell", () => {
      const pf = fullyWalkable(3, 3);
      pf.addOccupied(4);
      const blocked = pf.findPath(0, 8);
      expect(blocked).not.toContain(4);

      pf.removeOccupied(4);
      const opened = pf.findPath(0, 8);
      expect(opened).not.toBeNull();
    });
  });
});
