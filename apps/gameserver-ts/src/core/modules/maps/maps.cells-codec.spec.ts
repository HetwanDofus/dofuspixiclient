import { describe, expect, test } from "bun:test";

import { decodeCells } from "@modules/maps/maps.cells-codec";

function encode(chars: string): Uint8Array {
  return new TextEncoder().encode(chars);
}

describe("decodeCells", () => {
  test("returns one cell per 10-char group with the expected id sequence", () => {
    const payload = encode("aaaaaaaaaa".repeat(3));
    const cells = decodeCells(payload);

    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.id)).toEqual([0, 1, 2]);
  });

  test("decodes the 'all-zero' cell as inactive, blocked, no-LoS", () => {
    const cells = decodeCells(encode("aaaaaaaaaa"));

    expect(cells[0]).toMatchObject({
      id: 0,
      active: false,
      walkable: false,
      lineOfSight: false,
      movement: 0,
      ground: 0,
      layer1: 0,
      layer2: 0,
    });
  });

  test("extracts active + LoS bits from char 0", () => {
    // 'H' is HASH_CELL index 33 = 0b100001 → active bit (0x20) + LoS bit (0x01).
    const cells = decodeCells(encode("Haaaaaaaaa"));

    expect(cells[0]?.active).toBe(true);
    expect(cells[0]?.lineOfSight).toBe(true);
  });

  test("extracts movement from char 2 (bits 3-5)", () => {
    // char 2 = 'i' (index 8 = 0b001000 → movement = (0x38 & 0x08) >> 3 = 1 → walkable
    const cells = decodeCells(encode("aaiaaaaaaa"));
    expect(cells[0]?.movement).toBe(1);
    expect(cells[0]?.walkable).toBe(true);
  });

  test("rejects payloads whose length is not a multiple of 10", () => {
    expect(() => decodeCells(encode("aaaaa"))).toThrow("not a multiple of 10");
  });

  test("rejects bytes outside the HASH_CELL alphabet", () => {
    const bad = encode("aaaaa!aaaa");
    expect(() => decodeCells(bad)).toThrow("invalid HASH_CELL byte");
  });
});
