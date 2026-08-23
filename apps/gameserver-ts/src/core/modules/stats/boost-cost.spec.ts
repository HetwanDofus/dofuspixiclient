import { describe, expect, test } from "bun:test";

import { boostCost } from "@modules/stats/boost-cost";

// Breed ids follow the 1.29 numbering: 1 Féca, 2 Osamodas, 12 Pandawa.
const FECA = 1;
const PANDAWA = 12;

describe("boostCost", () => {
  test("vitality is always one capital point, wisdom always three", () => {
    expect(boostCost(FECA, "vitality", 0)).toBe(1);
    expect(boostCost(FECA, "vitality", 900)).toBe(1);
    expect(boostCost(FECA, "wisdom", 0)).toBe(3);
    expect(boostCost(FECA, "wisdom", 900)).toBe(3);
  });

  test("price steps up as the characteristic crosses a threshold", () => {
    // Féca strength: 2 below 50, then 3 below 150.
    expect(boostCost(FECA, "strength", 49)).toBe(2);
    expect(boostCost(FECA, "strength", 50)).toBe(3);
    expect(boostCost(FECA, "strength", 149)).toBe(3);
    expect(boostCost(FECA, "strength", 150)).toBe(4);
  });

  test("the last tier caps at five and never runs off the table", () => {
    expect(boostCost(FECA, "strength", 250)).toBe(5);
    expect(boostCost(FECA, "strength", 10_000)).toBe(5);
  });

  test("breeds price the same characteristic differently", () => {
    // A Féca pays 2 for its first point of Force; a Pandawa pays 1.
    expect(boostCost(FECA, "strength", 0)).toBe(2);
    expect(boostCost(PANDAWA, "strength", 0)).toBe(1);
  });

  test("an unknown breed falls back to the most expensive tier", () => {
    // Never the cheapest: a bad class id must not buy a discount.
    expect(boostCost(999, "strength", 0)).toBe(5);
  });
});
