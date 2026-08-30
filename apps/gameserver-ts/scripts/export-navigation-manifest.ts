import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { DB } from "../src/core/shared/db/schema";
import {
  buildNavigationManifest,
  serializeNavigationManifest,
  serializeNavigationManifestSchema,
} from "./navigation-manifest";

const defaultOutput = resolve(
  import.meta.dir,
  "../../electrobun/public/assets/data/navigation-manifest.json"
);
const outputPath = resolve(process.argv[2] ?? defaultOutput);
const schemaPath = outputPath.replace(/\.json$/, ".schema.json");

if (schemaPath === outputPath) {
  throw new Error("navigation manifest output must end in .json");
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";
const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

try {
  const [maps, neighbors, scriptedCells] = await Promise.all([
    db
      .selectFrom("maps")
      .select([
        "id",
        "x",
        "y",
        "subareaId",
        "superarea",
        "width",
        "height",
        "outdoor",
      ])
      .execute(),
    db
      .selectFrom("mapNeighbors")
      .select(["mapId", "direction", "neighborMapId"])
      .execute(),
    db
      .selectFrom("scriptedCells as transition")
      // Migrations historically seeded a few Incarnam transitions before
      // their source maps existed. They are not effective runtime edges and
      // therefore are not part of the valid projection. A missing *target*
      // remains a hard buildNavigationManifest error below.
      .innerJoin("maps as sourceMap", "sourceMap.id", "transition.mapId")
      .select([
        "transition.mapId as mapId",
        "transition.cellId as cellId",
        "transition.actionsArgs as actionsArgs",
      ])
      .where("transition.verb", "=", "TP")
      .execute(),
  ]);

  const mapsById = new Map(maps.map((map) => [map.id, map]));
  const validScriptedCells = scriptedCells.filter((transition) => {
    const source = mapsById.get(transition.mapId);
    if (!source) {
      return false;
    }
    const cellCount =
      source.height * source.width + (source.height - 1) * (source.width - 1);
    return transition.cellId < cellCount;
  });
  const ignoredScriptedCells = scriptedCells.length - validScriptedCells.length;
  if (ignoredScriptedCells > 0) {
    console.warn(
      `ignored ${ignoredScriptedCells} inert scripted transition(s) whose source cell is outside its map geometry`
    );
  }

  const manifest = buildNavigationManifest({
    maps: maps.map((map) => {
      if (map.subareaId === null) {
        throw new Error(`map ${map.id} has no subarea_id`);
      }
      return {
        id: map.id,
        x: map.x,
        y: map.y,
        subareaId: map.subareaId,
        superareaId: map.superarea,
        width: map.width,
        height: map.height,
        ...(map.outdoor === null ? {} : { outdoor: map.outdoor }),
      };
    }),
    borderTransitions: neighbors.map((transition) => ({
      sourceMapId: transition.mapId,
      direction: transition.direction,
      targetMapId: transition.neighborMapId,
    })),
    scriptedTransitions: validScriptedCells.map((transition) => {
      const target = parseTarget(transition.actionsArgs);
      if (!target) {
        throw new Error(
          `scripted transition ${transition.mapId}:${transition.cellId} has invalid args ${JSON.stringify(transition.actionsArgs)}`
        );
      }
      return {
        sourceMapId: transition.mapId,
        sourceCellId: transition.cellId,
        targetMapId: target.mapId,
        targetCellId: target.cellId,
      };
    }),
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, serializeNavigationManifest(manifest)),
    writeFile(schemaPath, serializeNavigationManifestSchema()),
  ]);

  console.log(
    `navigation manifest ${manifest.worldRevision}: ${manifest.maps.length} maps, ` +
      `${manifest.transitions.border.length} border transitions, ` +
      `${manifest.transitions.scripted.length} scripted transitions`
  );
  console.log(`wrote ${outputPath}`);
  console.log(`wrote ${schemaPath}`);
} finally {
  await db.destroy();
}

function parseTarget(value: string): { mapId: number; cellId: number } | null {
  const match = /^(\d+)\s*,\s*(\d+)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const mapId = Number(match[1]);
  const cellId = Number(match[2]);
  return Number.isSafeInteger(mapId) && Number.isSafeInteger(cellId)
    ? { mapId, cellId }
    : null;
}
