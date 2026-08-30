import { describe, expect, test } from "bun:test";

import { GRID_VERSION } from "@dofus/grid";
import { PROTO_VERSION } from "@dofus/proto";

import {
  checkServerContractCompatibility,
  SUPPORTED_NAVIGATION_SCHEMA_VERSION,
} from "./contract-compatibility";

const revision = "a".repeat(64);

describe("server contract compatibility", () => {
  test("accepts the exact package and manifest contract", () => {
    expect(
      checkServerContractCompatibility({
        protoVersion: PROTO_VERSION,
        gridVersion: GRID_VERSION,
        navigationSchemaVersion: SUPPORTED_NAVIGATION_SCHEMA_VERSION,
        navigationWorldRevision: revision,
      })
    ).toEqual({ compatible: true, reasons: [] });
  });

  test("rejects a different protocol, grid or navigation major", () => {
    const result = checkServerContractCompatibility({
      protoVersion: "99.0.0",
      gridVersion: "99.0.0",
      navigationSchemaVersion: 99,
      navigationWorldRevision: revision,
    });

    expect(result.compatible).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });
});
