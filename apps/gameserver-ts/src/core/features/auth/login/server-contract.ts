import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GRID_VERSION } from "@dofus/grid";
import { PROTO_VERSION } from "@dofus/proto";

export interface ServerContract {
  protoVersion: string;
  gridVersion: string;
  navigationSchemaVersion: number;
  navigationWorldRevision: string;
}

const defaultManifestPath = resolve(
  import.meta.dir,
  "../../../../../../electrobun/public/assets/data/navigation-manifest.json"
);

/**
 * Reads the same public artifact clients download. A missing or malformed
 * manifest prevents authd from starting instead of advertising made-up
 * compatibility values.
 */
export function loadServerContract(
  manifestPath = process.env.NAVIGATION_MANIFEST_PATH ?? defaultManifestPath
): ServerContract {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    schemaVersion?: unknown;
    worldRevision?: unknown;
  };

  if (
    !Number.isSafeInteger(manifest.schemaVersion) ||
    Number(manifest.schemaVersion) <= 0
  ) {
    throw new Error(
      `navigation manifest ${manifestPath} has no positive integer schemaVersion`
    );
  }
  if (
    typeof manifest.worldRevision !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifest.worldRevision)
  ) {
    throw new Error(
      `navigation manifest ${manifestPath} has no SHA-256 worldRevision`
    );
  }

  return {
    protoVersion: PROTO_VERSION,
    gridVersion: GRID_VERSION,
    navigationSchemaVersion: Number(manifest.schemaVersion),
    navigationWorldRevision: manifest.worldRevision,
  };
}
