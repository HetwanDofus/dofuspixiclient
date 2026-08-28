import { GRID_VERSION } from "@dofus/grid";
import { PROTO_VERSION } from "@dofus/proto";

export const SUPPORTED_NAVIGATION_SCHEMA_VERSION = 1;

export interface ServerContractVersions {
  protoVersion: string;
  gridVersion: string;
  navigationSchemaVersion: number;
  navigationWorldRevision: string;
}

export interface ContractCompatibility {
  compatible: boolean;
  reasons: string[];
}

/**
 * Packages follow semver: backward-compatible minor/patch releases stay on
 * the same major. Navigation schemas are integer majors and must match.
 */
export function checkServerContractCompatibility(
  server: ServerContractVersions
): ContractCompatibility {
  const reasons: string[] = [];

  compareMajor("@dofus/proto", server.protoVersion, PROTO_VERSION, reasons);
  compareMajor("@dofus/grid", server.gridVersion, GRID_VERSION, reasons);

  if (server.navigationSchemaVersion !== SUPPORTED_NAVIGATION_SCHEMA_VERSION) {
    reasons.push(
      `navigation schema ${server.navigationSchemaVersion} is incompatible with ${SUPPORTED_NAVIGATION_SCHEMA_VERSION}`
    );
  }
  if (!/^[0-9a-f]{64}$/.test(server.navigationWorldRevision)) {
    reasons.push("navigation world revision is not a SHA-256");
  }

  return { compatible: reasons.length === 0, reasons };
}

function compareMajor(
  name: string,
  actual: string,
  expected: string,
  reasons: string[]
): void {
  const actualMajor = semverMajor(actual);
  const expectedMajor = semverMajor(expected);

  if (
    actualMajor === null ||
    expectedMajor === null ||
    actualMajor !== expectedMajor
  ) {
    reasons.push(`${name} ${actual} is incompatible with ${expected}`);
  }
}

function semverMajor(value: string): number | null {
  const match = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(value);
  return match ? Number(match[1]) : null;
}
