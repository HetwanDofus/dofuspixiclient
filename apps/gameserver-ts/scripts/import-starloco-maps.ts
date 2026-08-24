/**
 * Imports the world geometry (maps, subareas, fight placement cells) from a
 * StarLoco `game.sql` dump.
 *
 * Why this exists: the migrations seed every *static* game table except the
 * world itself. `maps.cells` — the walkability/ground/object payload the
 * gameserver sends on enter-game — has no in-repo source, so a fresh database
 * answers `enter-game: map not found` for every map. StarLoco publishes its
 * game database, and its `maps.mapData` column holds the HASH_CELL payload
 * (10 chars per cell) that `src/core/modules/maps/maps.cells-codec.ts`
 * decodes — for some maps in the clear, for others still ciphered under the
 * row's `key` (see `decryptMapData` below).
 *
 *   curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
 *   DATABASE_URL=... bun run scripts/import-starloco-maps.ts game.sql
 *
 * Positions, subareas and fight-placement cells are NOT taken from the dump.
 * StarLoco targets 1.39.8 while this project targets 1.29, and the 1.29 truth
 * for those fields already ships in the repo — `MA` in
 * `apps/electrobun/public/assets/langs/fr/maps.json`, extracted from
 * `maps_fr_1251.swf`. The dump's own `mappos`/`places` are used only for maps
 * the lang bundle does not know about. (The two agree wherever both have an
 * entry — verified on map 10300.)
 *
 * Cell payloads are copied as-is; nothing else about a map is inferred.
 */
import { basename } from "node:path";

import { CamelCasePlugin, Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

import { decodeCells } from "../src/core/modules/maps/maps.cells-codec.ts";
import { insertRows, langBundlePath, toRecord } from "./starloco-dump.ts";

const dumpPath = process.argv[2];

if (!dumpPath) {
  console.error(
    "usage: bun run scripts/import-starloco-maps.ts <path/to/game.sql>"
  );
  process.exit(1);
}

const LANG_MAPS = langBundlePath("maps");

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

// ── Map payload decryption ──────────────────────────────────────────────────

/**
 * Number of cells a Dofus map of these dimensions has.
 *
 * The grid is a diamond: rows alternate between `width` and `width - 1` cells,
 * for `2 * height - 1` rows. That is `(height - 1)` full stride pairs of
 * `2 * width - 1`, plus one last row of `width`. A 15x17 map is 479 cells, not
 * the 510 a naive `width * height * 2` suggests.
 */
function expectedCellCount(width: number, height: number): number {
  return (height - 1) * (2 * width - 1) + width;
}

/**
 * Port of StarLoco's `CryptManager.prepareKey`: the stored key is a hex string
 * whose decoded bytes are themselves URL-encoded.
 */
function prepareKey(key: string): string {
  let raw = "";
  for (let i = 0; i + 1 < key.length; i += 2) {
    raw += String.fromCharCode(Number.parseInt(key.slice(i, i + 2), 16));
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Port of StarLoco's `CryptManager.checksumKey`. */
function checksumKey(key: string): number {
  let sum = 0;
  for (let i = 0; i < key.length; i++) {
    sum += key.charCodeAt(i) % 16;
  }
  return sum % 16;
}

/**
 * Port of StarLoco's `CryptManager.decryptMapData` — each output character is
 * one hex byte of the payload XORed with a rotating character of the key.
 */
function decryptMapData(data: string, rawKey: string): string {
  const key = prepareKey(rawKey);
  if (key.length === 0) {
    return "";
  }

  const checksum = checksumKey(key) * 2;
  let out = "";

  for (let i = 0; i + 1 < data.length; i += 2) {
    const byte = Number.parseInt(data.slice(i, i + 2), 16);
    const k = key.charCodeAt((i / 2 + checksum) % key.length);
    out += String.fromCharCode(byte ^ k);
  }

  return out;
}

const HASH_CELL_RE = /^[a-zA-Z0-9_-]*$/;

/**
 * Returns the plain HASH_CELL payload for a row, or `null` if it cannot be
 * recovered. Cell count is the discriminator: a plaintext payload is exactly
 * 10 characters per cell, a ciphered one is hex and therefore 20. Guessing
 * from the character set does not work — hex digits are themselves valid
 * HASH_CELL characters.
 */
function plainCells(
  mapData: string,
  key: string,
  width: number,
  height: number
): string | null {
  const expected = expectedCellCount(width, height);

  if (mapData.length === expected * 10 && HASH_CELL_RE.test(mapData)) {
    return mapData;
  }

  if (mapData.length === expected * 20) {
    const decrypted = decryptMapData(mapData, key);
    if (decrypted.length === expected * 10 && HASH_CELL_RE.test(decrypted)) {
      return decrypted;
    }
    return null;
  }

  return null;
}

// ── 1.29 map metadata from the lang bundle ──────────────────────────────────

interface LangMap {
  x: number;
  y: number;
  /** Subarea id. */
  sa: number;
  /** Fight placement cells, side 0 and side 1 (2 chars per cell id). */
  p1?: string;
  p2?: string;
}

interface LangSubarea {
  n: string;
  /** Area id. */
  a: number;
}

interface LangArea {
  n: string;
  /** Superarea id — Amakna and Incarnam are separate coordinate grids. */
  sua: number;
}

const lang = (await Bun.file(LANG_MAPS).json()) as {
  data: {
    MA: {
      m: Record<string, LangMap>;
      sa: Record<string, LangSubarea>;
      a: Record<string, LangArea>;
    };
  };
};

const langMaps = lang.data.MA.m;
const langSubareas = lang.data.MA.sa;
const langAreas = lang.data.MA.a;

console.log(
  `lang bundle: ${Object.keys(langMaps).length} maps, ` +
    `${Object.keys(langSubareas).length} subareas`
);

// ── Read the dump ───────────────────────────────────────────────────────────

const dump = await Bun.file(dumpPath).text();
console.log(
  `read ${basename(dumpPath)} (${(dump.length / 1e6).toFixed(1)} MB)`
);

/** Column order of StarLoco's `maps` table (note the `heigth` typo). */
const MAP_COLUMNS = [
  "id",
  "date",
  "width",
  "heigth",
  "places",
  "key",
  "mapData",
  "monsters",
  "capabilities",
  "mappos",
  "numgroup",
  "minSize",
  "fixSize",
  "maxSize",
  "forbidden",
  "sniffed",
] as const;

interface MapRow {
  id: number;
  date: string;
  key: string;
  width: number;
  height: number;
  cells: Buffer;
  subareaId: number;
  x: number;
  y: number;
  monstersRaw: string;
  capabilities: number;
  numgroup: number;
  mobSizeMin: number;
  mobSizeMax: number;
  mobFixSize: number;
  forbidden: string;
}

const maps: MapRow[] = [];
const places: { mapId: number; places0: string; places1: string }[] = [];
const usedSubareas = new Set<number>();
let skipped = 0;

for (const values of insertRows(dump, "maps")) {
  const row = toRecord(MAP_COLUMNS, values);

  const id = Number(row.id);
  const width = Number(row.width);
  const height = Number(row.heigth);
  const cells =
    Number.isFinite(id) && width > 0 && height > 0
      ? plainCells(row.mapData, row.key, width, height)
      : null;

  // A map whose payload does not decode to the expected cell count cannot be
  // entered — better to leave it out than to store cells the codec will
  // mis-read.
  if (cells === null) {
    skipped++;
    continue;
  }

  const meta = langMaps[String(id)];
  const mappos = row.mappos.split(",").map(Number);
  const subareaId = meta?.sa ?? mappos[2] ?? 0;

  usedSubareas.add(subareaId);

  maps.push({
    id,
    date: row.date.slice(0, 16),
    key: row.key,
    width,
    height,
    cells: Buffer.from(cells, "utf8"),
    subareaId,
    x: meta?.x ?? mappos[0] ?? 0,
    y: meta?.y ?? mappos[1] ?? 0,
    monstersRaw: row.monsters,
    capabilities: Number(row.capabilities) || 0,
    numgroup: Number(row.numgroup) || 3,
    mobSizeMin: Number(row.minSize) || 1,
    mobSizeMax: Number(row.maxSize) || 8,
    mobFixSize: Number(row.fixSize) || -1,
    forbidden: row.forbidden,
  });

  const [dumpP0 = "", dumpP1 = ""] = row.places.split("|");
  places.push({
    mapId: id,
    places0: meta?.p1 ?? dumpP0,
    places1: meta?.p2 ?? dumpP1,
  });
}

console.log(
  `parsed ${maps.length} maps (${skipped} skipped: unusable cell payload)`
);

// ── Write ───────────────────────────────────────────────────────────────────

// `maps.subarea_id` is a foreign key, so every referenced subarea must exist
// first. Names come from the lang bundle; ids only the dump knows about get an
// empty name rather than being dropped.
const subareaRows = [...usedSubareas].map((id) => ({
  id,
  areaId: langSubareas[String(id)]?.a ?? 0,
  name: (langSubareas[String(id)]?.n ?? "").slice(0, 128),
}));

await db
  .insertInto("subareas")
  .values(subareaRows)
  .onConflict((oc) =>
    oc.column("id").doUpdateSet((eb) => ({
      areaId: eb.ref("excluded.areaId"),
      name: eb.ref("excluded.name"),
    }))
  )
  .execute();

console.log(`upserted ${subareaRows.length} subareas`);

const BATCH = 200;

for (let i = 0; i < maps.length; i += BATCH) {
  await db
    .insertInto("maps")
    .values(maps.slice(i, i + BATCH))
    .onConflict((oc) =>
      oc.column("id").doUpdateSet((eb) => ({
        date: eb.ref("excluded.date"),
        key: eb.ref("excluded.key"),
        width: eb.ref("excluded.width"),
        height: eb.ref("excluded.height"),
        cells: eb.ref("excluded.cells"),
        subareaId: eb.ref("excluded.subareaId"),
        x: eb.ref("excluded.x"),
        y: eb.ref("excluded.y"),
        monstersRaw: eb.ref("excluded.monstersRaw"),
        capabilities: eb.ref("excluded.capabilities"),
        numgroup: eb.ref("excluded.numgroup"),
        mobSizeMin: eb.ref("excluded.mobSizeMin"),
        mobSizeMax: eb.ref("excluded.mobSizeMax"),
        mobFixSize: eb.ref("excluded.mobFixSize"),
        forbidden: eb.ref("excluded.forbidden"),
      }))
    )
    .execute();
}

console.log(`upserted ${maps.length} maps`);

for (let i = 0; i < places.length; i += BATCH) {
  await db
    .insertInto("mapFightPlaces")
    .values(places.slice(i, i + BATCH))
    .onConflict((oc) =>
      oc.column("mapId").doUpdateSet((eb) => ({
        places0: eb.ref("excluded.places0"),
        places1: eb.ref("excluded.places1"),
      }))
    )
    .execute();
}

console.log(`upserted ${places.length} fight-placement rows`);

// ── Neighbours ──────────────────────────────────────────────────────────────

/**
 * `map_neighbors` is what `move-ack`'s edge transition reads to answer "the
 * player just stepped off the north side — which map is that?". Nothing in the
 * schema or the dump fills it, so without this step walking off a map does
 * nothing at all.
 *
 * The links are derived from world coordinates: adjacent maps in Dofus sit at
 * adjacent (x, y), with x growing east and y growing south. Two guards keep
 * that honest:
 *
 *  - Coordinates are only comparable inside one superarea (Amakna and Incarnam
 *    each have their own grid starting near the origin).
 *  - Roughly half of all coordinates are shared by several maps — interiors
 *    stack on the position of the building they belong to. One map per
 *    position is elected to represent it — see `electionScore`.
 */
const DIRECTION_DELTAS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 0], // E
  [1, 1, 1], // SE
  [2, 0, 1], // S
  [3, -1, 1], // SW
  [4, -1, 0], // W
  [5, -1, -1], // NW
  [6, 0, -1], // N
  [7, 1, -1], // NE
];

function superareaOf(subareaId: number): number | undefined {
  const areaId = langSubareas[String(subareaId)]?.a;
  if (areaId === undefined) {
    return undefined;
  }
  return langAreas[String(areaId)]?.sua;
}

interface Election {
  id: number;
  /** The retail indoor/outdoor flag, when `import-map-swf.ts` has run. */
  outdoor: boolean;
  /** width x height — interiors are authored smaller than overworld maps. */
  area: number;
  /** Per-cell ground tiles — an interior's floor is a handful of tiles. */
  ground: number;
}

/**
 * Picks which of the maps sharing a world position is the overworld one: the
 * map you land on when you walk east off its neighbour.
 *
 * `maps.outdoor` decides it outright when present — that is the retail flag,
 * imported by `scripts/import-map-swf.ts`, so run that first. Everything below
 * is the fallback for maps it has not covered.
 *
 * Counting walkable edge cells does NOT work, which is worth recording. A
 * small house interior whose floor runs to the border of its diamond scores
 * *higher* than the street outside it — 48 edge cells against 34 at Astrub
 * (2, -18) — so that rule sent players indoors and stranded them there, with
 * no way to walk back out. Size and ground coverage separate the two better:
 * the street is 15x17 with 210 ground tiles, the house 9x12 with 9.
 */
function electionScore(m: MapRow): Election {
  let ground = 0;

  for (const cell of decodeCells(m.cells)) {
    if (cell.ground > 0) {
      ground++;
    }
  }

  return {
    id: m.id,
    outdoor: outdoorFlags.get(m.id) === true,
    area: m.width * m.height,
    ground,
  };
}

function beats(a: Election, b: Election): boolean {
  if (a.outdoor !== b.outdoor) {
    return a.outdoor;
  }
  if (a.area !== b.area) {
    return a.area > b.area;
  }
  if (a.ground !== b.ground) {
    return a.ground > b.ground;
  }
  return a.id < b.id;
}

const outdoorFlags = new Map<number, boolean | null>(
  (await db.selectFrom("maps").select(["id", "outdoor"]).execute()).map(
    (r: { id: number; outdoor: boolean | null }) => [r.id, r.outdoor]
  )
);

console.log(
  `retail outdoor flag known for ` +
    `${[...outdoorFlags.values()].filter((v) => v !== null).length} maps`
);

/** (superarea, x, y) → the map elected to represent that world position. */
const byPosition = new Map<string, Election>();
const positionOf = new Map<number, string>();

for (const m of maps) {
  const sua = superareaOf(m.subareaId);
  if (sua === undefined) {
    continue;
  }

  const key = `${sua}:${m.x}:${m.y}`;
  positionOf.set(m.id, key);

  const score = electionScore(m);
  const held = byPosition.get(key);

  if (!held || beats(score, held)) {
    byPosition.set(key, score);
  }
}

const neighbours: {
  mapId: number;
  direction: number;
  neighborMapId: number;
}[] = [];
let notElected = 0;
let indoor = 0;

for (const m of maps) {
  const sua = superareaOf(m.subareaId);
  if (sua === undefined) {
    continue;
  }

  const key = positionOf.get(m.id);
  if (!key || byPosition.get(key)?.id !== m.id) {
    notElected++;
    continue;
  }

  // A map the retail flag calls indoor has no business gaining edge exits,
  // even if it won its position for want of an outdoor map there.
  if (outdoorFlags.get(m.id) === false) {
    indoor++;
    continue;
  }

  for (const [direction, dx, dy] of DIRECTION_DELTAS) {
    // No walkability check here: `resolveLandingCell` decides at runtime
    // whether the arrival edge has somewhere to stand, and logs when it does
    // not. Walking into a known interior is refused outright though — that is
    // the trap that stranded players inside houses.
    const target = byPosition.get(`${sua}:${m.x + dx}:${m.y + dy}`);
    if (!target || outdoorFlags.get(target.id) === false) {
      continue;
    }

    neighbours.push({ mapId: m.id, direction, neighborMapId: target.id });
  }
}

for (let i = 0; i < neighbours.length; i += BATCH) {
  await db
    .insertInto("mapNeighbors")
    .values(neighbours.slice(i, i + BATCH))
    .onConflict((oc) =>
      oc.columns(["mapId", "direction"]).doUpdateSet((eb) => ({
        neighborMapId: eb.ref("excluded.neighborMapId"),
      }))
    )
    .execute();
}

console.log(
  `upserted ${neighbours.length} neighbour links ` +
    `(${notElected} not elected for their world position, ` +
    `${indoor} skipped as indoor)`
);

const { count } = await db
  .selectFrom("maps")
  .select(sql<number>`count(*)::int`.as("count"))
  .executeTakeFirstOrThrow();

console.log(`done — maps table now holds ${count} rows`);

await db.destroy();
