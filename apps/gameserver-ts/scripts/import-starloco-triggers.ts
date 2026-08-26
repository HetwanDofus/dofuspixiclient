/**
 * Imports everything that makes the world *actionable* — scripted cells,
 * interactive-object templates, zaaps and house geometry — from a StarLoco
 * `game.sql` dump plus the 1.29 lang bundles.
 *
 * Why this exists: `just import-maps` fills the geometry and
 * `just import-content` fills the population, but every door stayed shut.
 * `ScriptedCellsService.onPlayerArrived` was written, wired into
 * `move-ack.handler.ts` and left with 16 hand-seeded rows for Incarnam — while
 * the dump carries 23 795. Walking onto Astrub's bank door
 * (`scripted_cells (7411, 202) → '10111,181'`) did nothing at all, and so did
 * every shop, temple, dungeon and house staircase in the game.
 *
 *   curl -LO https://raw.githubusercontent.com/StarLoco/StarLoco-Game/master/game.sql
 *   DATABASE_URL=... bun run scripts/import-starloco-triggers.ts game.sql
 *
 * Run it *after* `just import-maps`: every table here references `maps.id`,
 * and the house derivation reads `maps.cells`.
 *
 * ── The four data sets ─────────────────────────────────────────────────────
 *
 * **scripted_cells** — straight from the dump. Its `ActionID` has to become
 * this schema's `verb`: 23 689 rows are action 0, 100 are 979 and 1 is 1, all
 * three carrying `"mapId,cellId"` args, so all three import as `TP`. Actions
 * 101 and 971 (4 rows) carry something else and are skipped with a count.
 *
 * The retail rows also cover many map-edge crossings, and `ScriptedCellsService`
 * short-circuits `maybeCrossEdge` — so wherever a row exists it now wins over
 * the geometric `map_neighbors` election. That is deliberate: the election is
 * a guess that `doc/data-seeding.md` records stranding players inside houses,
 * and the dump is the retail answer. `map_neighbors` still covers the vast
 * majority of border cells, which the dump does not mention.
 *
 * **interactive_objects_templates** — keyed by gfx id, the union of the dump's
 * `interactive_objects_data` (respawn / duration / walkable) and the 1.29
 * bundle's `IO` table (name, type, skill list). The bundle wins on everything
 * it knows, same rule as the other two importers. The *type* is what the
 * server needs: 3 zaap, 5 house door, 6 storage, 10 zaapi.
 *
 * **waypoints** — no table in the dump lists zaaps. They are found by scanning
 * `maps.cells` for a layer-2 object whose interactive bit is armed and whose
 * gfx maps to `IO` type 3 (zaap) or 10 (zaapi): 33 and 75 of them. Zaapi
 * alignment comes from the dump's `zaapi` table.
 *
 * **houses / house_doors** — the dump's `houses` table carries ownership only,
 * never geometry. All three pieces come from `houses.json`:
 *
 *   - `H.d[mapId]["c" + cellId] → houseId` — the 1 095 door cells;
 *   - `H.m[mapId] → houseId` — the 2 121 interior maps (ground floor + upstairs);
 *   - `H.h[houseId].n` — the name.
 *
 * The arrival cell is derived, not given: among a house's interior maps,
 * exactly one carries a `scripted_cells` `TP` back out to the door's map, and
 * that is the way in. House 711's door is `7414:236`, its interiors are
 * {7778, 7779}, and `(7779, 217) → '7414,251'` — so entering lands on 7779.
 * The player is placed on a *walkable neighbour* of 217 rather than 217
 * itself, otherwise the first step back onto it would fire the exit again.
 *
 * About a fifth of the houses have no such exit row anywhere in the dump, and
 * their interiors carry no inside door object either (the 1.29 `H.ids` skill
 * set has nothing to attach to) — there is simply no way back out of them.
 * Those keep `entry_map_id` NULL and stay non-enterable on purpose: shutting a
 * door is a smaller bug than sealing a player inside one. The count is printed
 * at the end of the run.
 *
 * ── What this importer deliberately drops ──────────────────────────────────
 *
 *  - the dump's `houses.owner_id` / `guild_id` — their ids belong to another
 *    server's players and guilds; every house is imported unowned;
 *  - `interactive_doors` (7 lever-operated dungeon doors) — no runtime reads
 *    it, and its shape is StarLoco's, not this schema's;
 *  - scripted-cell `conditions` are stored verbatim but nothing evaluates
 *    them; `-1` (no condition) is what 23 791 of the rows carry anyway.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  cellToRowCol,
  getDirOffsets,
  isValidDirection,
  totalRows,
} from "@dofus/grid";
import { CamelCasePlugin, Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

import { decodeCells } from "../src/core/modules/maps/maps.cells-codec.ts";
import { insertRows, langBundlePath, toRecord } from "./starloco-dump.ts";

const dumpPath = process.argv[2];

if (!dumpPath) {
  console.error(
    "usage: bun run scripts/import-starloco-triggers.ts <path/to/game.sql>"
  );
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

// biome-ignore lint/suspicious/noExplicitAny: this importer writes to tables named at runtime (`upsert(table, …)`), so it cannot be bound to the `DB` interface — a typed Kysely rejects `insertInto(string)` outright.
const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

const BATCH = 500;

/** Inserts in batches, no conflict handling — for tables truncated first. */
async function insertAll(
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insertInto(table)
      .values(rows.slice(i, i + BATCH))
      .execute();
  }
}

/** Upserts in batches, replacing every column the importer owns. */
async function upsert(
  table: string,
  conflict: string[],
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const columns = Object.keys(rows[0]!).filter((c) => !conflict.includes(c));

  // biome-ignore lint/suspicious/noExplicitAny: builder callbacks inherit the untyped `Kysely<any>` above, so there is no narrower type to give them.
  const onConflict = (oc: any) =>
    (conflict.length === 1
      ? oc.column(conflict[0]!)
      : oc.columns(conflict)
    ).doUpdateSet((eb: { ref: (c: string) => unknown }) =>
      Object.fromEntries(columns.map((c) => [c, eb.ref(`excluded.${c}`)]))
    );

  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insertInto(table)
      .values(rows.slice(i, i + BATCH))
      .onConflict(onConflict)
      .execute();
  }
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === "string" && v.trim() === "") {
    return fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Parses a scripted cell's `"mapId,cellId"` argument pair. */
function parseMapCell(args: string): { mapId: number; cellId: number } | null {
  const parts = args.trim().split(",");

  if (parts.length !== 2) {
    return null;
  }

  const mapId = Number.parseInt((parts[0] ?? "").trim(), 10);
  const cellId = Number.parseInt((parts[1] ?? "").trim(), 10);

  return Number.isFinite(mapId) && Number.isFinite(cellId)
    ? { mapId, cellId }
    : null;
}

// On the 1.29 iso grid, SE/SW/NW/NE (1/3/5/7) are the four directions whose
// step lands on the *touching* diamond; E/S/W/N are two-cell jumps that skip
// it (`packages/grid/src/area.ts:53-61`). Preferring the diagonals keeps the
// arrival spot right beside the door instead of one diamond further out.
const NEIGHBOUR_DIRECTIONS = [1, 3, 5, 7, 0, 2, 4, 6] as const;

console.log(`reading ${basename(dumpPath)}…`);
const dump = readFileSync(dumpPath, "utf8");

const io = JSON.parse(
  readFileSync(langBundlePath("interactiveobjects"), "utf8")
).data.IO as {
  /** gfx id → IO data id */
  g: Record<string, number>;
  /** IO data id → { n: name, t: type, sk: skill ids } */
  d: Record<string, { n: string; t: number; sk?: number[] }>;
};

const housesLang = JSON.parse(readFileSync(langBundlePath("houses"), "utf8"))
  .data.H as {
  /** house id → { n: name, d: description } */
  h: Record<string, { n: string; d: string }>;
  /** interior map id → house id */
  m: Record<string, number>;
  /** door map id → { "c<cellId>": house id } */
  d: Record<string, Record<string, number>>;
};

/** gfx id → its IO entry, resolved through the two-level `IO.g`/`IO.d` hop. */
function ioByGfx(gfx: number): { n: string; t: number; sk?: number[] } | null {
  const dataId = io.g[String(gfx)];
  return dataId === undefined ? null : (io.d[String(dataId)] ?? null);
}

// ---------------------------------------------------------------------------
// Maps — every step below needs the id set, and the zaap and house passes
// need the cell payloads.
// ---------------------------------------------------------------------------

const mapRows = await db
  .selectFrom("maps")
  .select(["id", "width", "height", "cells", "subareaId"])
  .execute();

const mapIds = new Set<number>(mapRows.map((m: { id: number }) => m.id));

console.log(`maps in database: ${mapIds.size}`);

// ---------------------------------------------------------------------------
// scripted_cells
// ---------------------------------------------------------------------------

const SCRIPTED_CELL_COLUMNS = [
  "MapID",
  "CellID",
  "ActionID",
  "EventID",
  "ActionsArgs",
  "Conditions",
] as const;

/** StarLoco `ActionID` → this schema's verb. All three variants teleport. */
const TELEPORT_ACTIONS = new Set([0, 1, 979]);

const scriptedCells: Record<string, unknown>[] = [];
const scriptedSkipped = { action: 0, args: 0, sourceMap: 0, targetMap: 0 };

for (const values of insertRows(dump, "scripted_cells")) {
  const row = toRecord(SCRIPTED_CELL_COLUMNS, values);
  const actionId = num(row.ActionID, -1);

  if (!TELEPORT_ACTIONS.has(actionId)) {
    scriptedSkipped.action++;
    continue;
  }

  const mapId = num(row.MapID, -1);

  if (!mapIds.has(mapId)) {
    scriptedSkipped.sourceMap++;
    continue;
  }

  const target = parseMapCell(row.ActionsArgs);

  if (!target) {
    scriptedSkipped.args++;
    continue;
  }

  if (!mapIds.has(target.mapId)) {
    scriptedSkipped.targetMap++;
    continue;
  }

  scriptedCells.push({
    mapId,
    cellId: num(row.CellID),
    actionId,
    eventId: num(row.EventID, 1),
    verb: "TP",
    actionsArgs: `${target.mapId},${target.cellId}`,
    conditions: row.Conditions,
  });
}

await upsert("scripted_cells", ["mapId", "cellId"], scriptedCells);

console.log(
  `scripted cells: ${scriptedCells.length} imported — skipped ` +
    `${scriptedSkipped.action} non-teleport actions, ` +
    `${scriptedSkipped.args} malformed args, ` +
    `${scriptedSkipped.sourceMap} unknown source maps, ` +
    `${scriptedSkipped.targetMap} unknown target maps`
);

/** (mapId, cellId) → target map, for the house entry derivation below. */
const teleportTargets = new Map<string, number>();

for (const row of scriptedCells) {
  const target = parseMapCell(String(row.actionsArgs));

  if (target) {
    teleportTargets.set(`${row.mapId}:${row.cellId}`, target.mapId);
  }
}

// ---------------------------------------------------------------------------
// interactive_objects_templates — union of the dump and the 1.29 IO table
// ---------------------------------------------------------------------------

const IO_DATA_COLUMNS = [
  "id",
  "respawn",
  "duration",
  "unknow",
  "walkable",
  "nameIO",
] as const;

const templates = new Map<number, Record<string, unknown>>();

for (const gfxKey of Object.keys(io.g)) {
  const gfx = Number(gfxKey);
  const entry = ioByGfx(gfx);

  if (!entry) {
    continue;
  }

  templates.set(gfx, {
    id: gfx,
    name: entry.n,
    respawnMs: 10_000,
    durationMs: 1500,
    walkable: true,
    unknown: 4,
    type: entry.t ?? 0,
    skills: (entry.sk ?? []).join(","),
  });
}

let templatesFromDump = 0;

for (const values of insertRows(dump, "interactive_objects_data")) {
  const row = toRecord(IO_DATA_COLUMNS, values);
  const gfx = num(row.id, -1);

  if (gfx < 0) {
    continue;
  }

  templatesFromDump++;

  const entry = ioByGfx(gfx);
  const existing = templates.get(gfx);

  templates.set(gfx, {
    id: gfx,
    // The bundle is the 1.29 name; the dump's is a 1.39 working label.
    name: entry?.n ?? row.nameIO,
    respawnMs: num(row.respawn, 10_000),
    durationMs: num(row.duration, 1500),
    walkable: num(row.walkable, 1) !== 0,
    unknown: num(row.unknow, 4),
    type: entry?.t ?? existing?.type ?? 0,
    skills: (entry?.sk ?? []).join(","),
  });
}

await upsert("interactive_objects_templates", ["id"], [...templates.values()]);

console.log(
  `interactive object templates: ${templates.size} imported ` +
    `(${Object.keys(io.g).length} from the 1.29 bundle, ${templatesFromDump} from the dump)`
);

// ---------------------------------------------------------------------------
// waypoints — found by scanning the cell payloads for armed zaap sprites
// ---------------------------------------------------------------------------

const ZAAP_TYPE = 3;
const ZAAPI_TYPE = 10;

/** Zaapi alignment, keyed by map — the dump's only zaap-adjacent table. */
const zaapiAlignments = new Map<number, number>();

for (const values of insertRows(dump, "zaapi")) {
  zaapiAlignments.set(num(values[0], -1), num(values[1]));
}

const waypoints: Record<string, unknown>[] = [];
const interactiveByType = new Map<number, number>();

for (const map of mapRows) {
  const raw: Uint8Array | null = map.cells;

  if (!raw || raw.length === 0) {
    continue;
  }

  let cells: ReturnType<typeof decodeCells>;

  try {
    cells = decodeCells(raw);
  } catch {
    continue;
  }

  for (const cell of cells) {
    if (!cell.layerObject2Interactive) {
      continue;
    }

    const entry = ioByGfx(cell.layer2);
    const type = entry?.t ?? -1;
    interactiveByType.set(type, (interactiveByType.get(type) ?? 0) + 1);

    if (type !== ZAAP_TYPE && type !== ZAAPI_TYPE) {
      continue;
    }

    waypoints.push({
      mapId: map.id,
      cellId: cell.id,
      kind: type === ZAAP_TYPE ? 0 : 1,
      costKamas: 10,
      subAreaId: map.subareaId,
    });
  }
}

// `waypoints.id` is a surrogate key, so an upsert has nothing to conflict on;
// the natural key is (map_id, cell_id) and this importer owns the table.
await sql`TRUNCATE waypoints RESTART IDENTITY CASCADE`.execute(db);
await insertAll("waypoints", waypoints);

const zaapCount = waypoints.filter((w) => w.kind === 0).length;

console.log(
  `waypoints: ${zaapCount} zaaps + ${waypoints.length - zaapCount} zaapis ` +
    `(${zaapiAlignments.size} zaapi alignments in the dump)`
);
console.log(
  `interactive cells by IO type: ${[...interactiveByType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t === -1 ? "unknown" : t}=${n}`)
    .join(" ")}`
);

// ---------------------------------------------------------------------------
// houses / house_doors
// ---------------------------------------------------------------------------

const HOUSE_COLUMNS = [
  "id",
  "owner_id",
  "sale",
  "guild_id",
  "access",
  "key",
  "guild_rights",
] as const;

const housePrices = new Map<number, number>();

for (const values of insertRows(dump, "houses")) {
  const row = toRecord(HOUSE_COLUMNS, values);
  housePrices.set(num(row.id, -1), num(row.sale, 1_000_000));
}

/** house id → the maps that belong to it (ground floor plus upper floors). */
const interiorsByHouse = new Map<number, number[]>();

for (const [mapKey, houseId] of Object.entries(housesLang.m)) {
  const mapId = Number(mapKey);

  if (!mapIds.has(mapId)) {
    continue;
  }

  const list = interiorsByHouse.get(houseId);

  if (list) {
    list.push(mapId);
  } else {
    interiorsByHouse.set(houseId, [mapId]);
  }
}

interface DoorRef {
  mapId: number;
  cellId: number;
}

const doorsByHouse = new Map<number, DoorRef[]>();
let doorsOnUnknownMap = 0;
let doorsWithoutHouse = 0;

for (const [mapKey, cells] of Object.entries(housesLang.d)) {
  const mapId = Number(mapKey);

  for (const [cellKey, houseId] of Object.entries(cells)) {
    if (!mapIds.has(mapId)) {
      doorsOnUnknownMap++;
      continue;
    }

    // The bundle has one pair of doors (709:300 and 2026:264) whose house id
    // is null — a 1.29 extraction artefact, not a house we can name.
    if (typeof houseId !== "number" || !Number.isFinite(houseId)) {
      doorsWithoutHouse++;
      continue;
    }

    const cellId = Number(cellKey.slice(1));
    const list = doorsByHouse.get(houseId);

    if (list) {
      list.push({ mapId, cellId });
    } else {
      doorsByHouse.set(houseId, [{ mapId, cellId }]);
    }
  }
}

const mapById = new Map(mapRows.map((m: { id: number }) => [m.id, m]));

/**
 * The cell a player should land on when entering. `exitCell` is the interior
 * cell that teleports back out, so standing on it would fire the exit again on
 * the next step; the first walkable neighbour is the honest arrival spot.
 */
function landingCellFor(mapId: number, exitCell: number): number {
  const map = mapById.get(mapId);

  if (!map?.cells) {
    return exitCell;
  }

  let cells: ReturnType<typeof decodeCells>;

  try {
    cells = decodeCells(map.cells);
  } catch {
    return exitCell;
  }

  const offsets = getDirOffsets(map.width);
  const rows = totalRows(map.height);
  const { row, col, isLong } = cellToRowCol(exitCell, map.width);

  for (const dir of NEIGHBOUR_DIRECTIONS) {
    if (!isValidDirection(row, col, isLong, dir, map.width, rows)) {
      continue;
    }

    const candidate = cells[exitCell + (offsets[dir] as number)];

    if (candidate?.active && candidate.walkable) {
      return candidate.id;
    }
  }

  return exitCell;
}

const houses: Record<string, unknown>[] = [];
const houseDoors: Record<string, unknown>[] = [];
let withoutEntry = 0;

for (const [houseId, doors] of doorsByHouse) {
  const interiors = interiorsByHouse.get(houseId) ?? [];
  const doorMaps = new Set(doors.map((d) => d.mapId));

  // The way in is the interior map that teleports back out to a door's map.
  let entryMapId: number | null = null;
  let entryCellId: number | null = null;

  for (const interior of interiors) {
    const map = mapById.get(interior);

    if (!map?.cells) {
      continue;
    }

    for (let cellId = 0; cellId < map.cells.length / 10; cellId++) {
      const target = teleportTargets.get(`${interior}:${cellId}`);

      if (target !== undefined && doorMaps.has(target)) {
        entryMapId = interior;
        entryCellId = landingCellFor(interior, cellId);
        break;
      }
    }

    if (entryMapId !== null) {
      break;
    }
  }

  if (entryMapId === null) {
    withoutEntry++;
  }

  const first = doors[0]!;

  houses.push({
    id: houseId,
    mapId: first.mapId,
    cellId: first.cellId,
    price: housePrices.get(houseId) ?? 1_000_000,
    ownerId: null,
    guildId: null,
    locked: false,
    lockCode: "",
    doors: JSON.stringify(doors),
    entryMapId,
    entryCellId,
    interiorMapIds: JSON.stringify(interiors),
  });

  for (const door of doors) {
    houseDoors.push({ mapId: door.mapId, cellId: door.cellId, houseId });
  }
}

await upsert("houses", ["id"], houses);
await upsert("house_doors", ["mapId", "cellId"], houseDoors);

// The ids above are the 1.29 house ids, written straight into a bigserial
// column — without this the sequence still points at 1 and the first house
// bought in game would collide.
await sql`
  SELECT setval(
    pg_get_serial_sequence('houses', 'id'),
    GREATEST((SELECT COALESCE(max(id), 0) FROM houses), 1)
  )
`.execute(db);

console.log(
  `houses: ${houses.length} imported, ${houseDoors.length} doors — ` +
    `${houses.length - withoutEntry} enterable, ${withoutEntry} with no exit ` +
    `in the dump (kept shut); skipped ${doorsOnUnknownMap} doors on unknown ` +
    `maps and ${doorsWithoutHouse} with no house id`
);

// ---------------------------------------------------------------------------

const counts = await sql<Record<string, number>>`
  SELECT
    (SELECT count(*)::int FROM scripted_cells)                AS "scriptedCells",
    (SELECT count(*)::int FROM interactive_objects_templates) AS "ioTemplates",
    (SELECT count(*)::int FROM waypoints)                     AS "waypoints",
    (SELECT count(*)::int FROM houses)                        AS "houses",
    (SELECT count(*)::int FROM house_doors)                   AS "houseDoors"
`
  .execute(db)
  .then((r) => r.rows[0]);

console.log(
  `done — ${Object.entries(counts ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}`
);

await db.destroy();
