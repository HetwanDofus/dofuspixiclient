/**
 * Patch the 'active' field into existing cell data in the database.
 * Reads active-cells.json (from extract-active-cells.php) and updates
 * the cells JSON + cells_gzip for each map.
 *
 * Usage: bun tools/patch-active-cells.ts
 */

import { gzipSync } from "bun";
import { db } from "../apps/server/src/db/database.ts";

const activeCellsPath = new URL("./active-cells.json", import.meta.url).pathname;
const activeData: Record<string, boolean[]> = JSON.parse(
  await Bun.file(activeCellsPath).text()
);

const mapIds = Object.keys(activeData).map(Number);
console.log(`Loaded active flags for ${mapIds.length} maps`);

let updated = 0;
let skipped = 0;

for (const mapId of mapIds) {
  const row = await db
    .selectFrom("maps")
    .select(["id", "cells"])
    .where("id", "=", mapId)
    .executeTakeFirst();

  if (!row) {
    skipped++;
    continue;
  }

  const cells = row.cells as any[];
  const activeFlags = activeData[String(mapId)];

  if (cells.length !== activeFlags.length) {
    console.warn(
      `Map ${mapId}: cell count mismatch (db=${cells.length}, active=${activeFlags.length}), skipping`
    );
    skipped++;
    continue;
  }

  // Patch each cell with the active flag
  for (let i = 0; i < cells.length; i++) {
    cells[i].active = activeFlags[i];
  }

  // Re-compress
  const json = JSON.stringify(cells);
  const compressed = gzipSync(new TextEncoder().encode(json)) as Uint8Array;

  await db
    .updateTable("maps")
    .set({
      cells: JSON.stringify(cells),
      cells_gzip: Buffer.from(compressed),
    })
    .where("id", "=", mapId)
    .execute();

  updated++;
  if (updated % 500 === 0) {
    console.log(`  ${updated} maps updated...`);
  }
}

console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
process.exit(0);
