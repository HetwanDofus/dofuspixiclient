#!/usr/bin/env bun
// Dumps a single Dofus 1.29 map row from psql `dofus129` to JSON for the
// Rust spike to consume. Reuses the gameserver's HASH_CELL decoder.
//
// Usage: bun scripts/dump-map.ts 7411 ./output/map-7411.json

import { mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "pg";

import { decodeCells } from "../../../../dofuswebclient2/apps/gameserver-ts/src/core/modules/maps/maps.cells-codec.ts";

const mapId = Number(process.argv[2]);
const outPath = process.argv[3];

if (!Number.isFinite(mapId) || !outPath) {
  console.error("usage: bun dump-map.ts <map_id> <out.json>");
  process.exit(2);
}

const client = new Client({
  database: "dofus129",
  host: process.env.PGHOST ?? "localhost",
  user: process.env.PGUSER ?? process.env.USER,
  password: process.env.PGPASSWORD ?? "",
});

await client.connect();

const { rows } = await client.query<{
  id: number;
  width: number;
  height: number;
  background: number;
  cells: Buffer;
  key: string;
}>(
  `SELECT id, width, height, background, cells, key FROM maps WHERE id = $1`,
  [mapId],
);

if (rows.length === 0) {
  console.error(`map ${mapId} not found`);
  process.exit(1);
}

const row = rows[0];
const cells = decodeCells(new Uint8Array(row.cells));

const out = {
  id: row.id,
  width: row.width,
  height: row.height,
  background: row.background,
  cells: cells.map((c) => ({
    id: c.id,
    active: c.active,
    ground: c.ground,
    layer1: c.layer1,
    layer2: c.layer2,
    groundLevel: c.groundLevel,
    groundSlope: c.groundSlope,
    groundRot: c.layerGroundRot,
    groundFlip: c.layerGroundFlip,
    layer1Rot: c.layerObject1Rot,
    layer1Flip: c.layerObject1Flip,
    layer2Flip: c.layerObject2Flip,
  })),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(
  `wrote ${cells.length} cells to ${outPath} ` +
    `(map ${row.width}x${row.height}, background ${row.background})`,
);

await client.end();
