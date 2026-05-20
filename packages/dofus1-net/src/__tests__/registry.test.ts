import { describe, expect, test } from "bun:test";
import { listOpcodes } from "../registry";
// Force-load bootstrap messages.
import "..";

describe("registry", () => {
  test("bootstrap opcodes are registered", () => {
    const ops = listOpcodes();
    for (const expected of [
      "HC",
      "HT",
      "HG",
      "HS",
      "Af",
      "Al",
      "AL",
      "Ax",
      "AS",
      "AT",
      "GC",
      "p",
      "q",
      "r",
      "M",
      "k",
      "BN",
    ]) {
      expect(ops).toContain(expected);
    }
  });

  test("Al and AL are distinct opcodes (case-sensitive)", () => {
    const ops = listOpcodes();
    expect(ops).toContain("Al");
    expect(ops).toContain("AL");
    expect(new Set(ops).size).toBe(ops.length); // no duplicates
  });
});
