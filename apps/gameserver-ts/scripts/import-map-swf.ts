/**
 * Reads the retail Dofus 1.29 map SWFs and writes the per-map fields that
 * exist nowhere else.
 *
 *   bun run scripts/import-map-swf.ts /path/to/Client/data/maps
 *
 * Four fields matter here, and neither the StarLoco dump nor the lang bundles
 * carry them, because the original client reads them straight out of the map's
 * own SWF (`dofus/managers/MapsServersManager.as:131-137`):
 *
 *  - `background` — the ground-tile id drawn under the whole map. About 71% of
 *    cells have no per-cell ground tile, so without it maps render with black
 *    gaps between their tiles.
 *  - `outdoor` — the authentic indoor/outdoor flag. `import-starloco-maps.ts`
 *    otherwise has to guess which of the maps stacked on one world position is
 *    the overworld one, and guessing wrong teleports players inside houses.
 *  - `musicId` / `ambianceId` — indices into the `audio` lang bundle. The
 *    server forwards both on GameMapData and the client's AudioManager turns
 *    them into a looping track and an environment sound bed.
 *
 * Each SWF is a zlib-compressed AS2 movie whose first frame is a run of
 * `<name> = <value>` assignments; the parser below walks that bytecode. The
 * same frame also carries the authentic 1.29 `mapData` (ciphered under the
 * map's key) — richer than the 1.39.8 payload the dump provides, but not
 * imported here.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

const mapsDir = process.argv[2];

if (!mapsDir) {
  console.error("usage: bun run scripts/import-map-swf.ts <Client/data/maps>");
  process.exit(1);
}

// ── SWF ─────────────────────────────────────────────────────────────────────

function decompress(raw: Buffer): Buffer {
  const signature = raw.subarray(0, 3).toString("latin1");
  if (signature === "FWS") return raw.subarray(8);
  if (signature === "CWS") return inflateSync(raw.subarray(8));
  throw new Error(`unsupported SWF signature ${signature}`);
}

/** Offset of the first tag: past the header RECT, frame rate and frame count. */
function firstTagOffset(body: Buffer): number {
  const nBits = body[0]! >> 3;
  return Math.ceil((5 + nBits * 4) / 8) + 4;
}

function* tags(body: Buffer): Generator<{ code: number; data: Buffer }> {
  let at = firstTagOffset(body);

  while (at + 2 <= body.length) {
    const header = body.readUInt16LE(at);
    at += 2;

    const code = header >> 6;
    let length = header & 0x3f;

    if (length === 0x3f) {
      length = body.readUInt32LE(at);
      at += 4;
    }

    if (code === 0) return;

    yield { code, data: body.subarray(at, at + length) };
    at += length;
  }
}

/**
 * Evaluates the subset of AS2 the map SWFs use: a constant pool, pushes, and
 * assignments. Anything else clears the stack, which is enough because the
 * assignments are self-contained.
 */
function evaluateActions(data: Buffer): Record<string, unknown> {
  const assigned: Record<string, unknown> = {};
  const stack: unknown[] = [];
  let pool: string[] = [];
  let at = 0;

  const readString = () => {
    const end = data.indexOf(0, at);
    const value = data.subarray(at, end).toString("latin1");
    at = end + 1;
    return value;
  };

  while (at < data.length) {
    const code = data[at++]!;

    if (code === 0) break;

    if (code < 0x80) {
      // SetVariable / SetMember — the two forms the maps use.
      if (code === 0x1d || code === 0x4f) {
        const value = stack.pop();
        const name = stack.pop();
        if (typeof name === "string") assigned[name] = value;
      } else {
        stack.length = 0;
      }
      continue;
    }

    const length = data.readUInt16LE(at);
    at += 2;
    const end = at + length;

    if (code === 0x88) {
      const count = data.readUInt16LE(at);
      at += 2;
      pool = [];
      for (let i = 0; i < count; i++) pool.push(readString());
    } else if (code === 0x96) {
      while (at < end) {
        const type = data[at++]!;
        if (type === 0) stack.push(readString());
        else if (type === 1) { stack.push(data.readFloatLE(at)); at += 4; }
        else if (type === 2) stack.push(null);
        else if (type === 3) stack.push(undefined);
        else if (type === 4) { at += 1; stack.push(undefined); }
        else if (type === 5) stack.push(data[at++] !== 0);
        else if (type === 6) { stack.push(data.readDoubleLE(at)); at += 8; }
        else if (type === 7) { stack.push(data.readInt32LE(at)); at += 4; }
        else if (type === 8) stack.push(pool[data[at++]!]);
        else if (type === 9) { stack.push(pool[data.readUInt16LE(at)]); at += 2; }
        else break;
      }
    }

    at = end;
  }

  return assigned;
}

// ── Import ──────────────────────────────────────────────────────────────────

const db = new Kysely<any>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus",
    }),
  }),
  plugins: [new CamelCasePlugin()],
});

const files = readdirSync(mapsDir).filter((f) => f.endsWith(".swf"));
console.log(`${files.length} map SWFs in ${mapsDir}`);

interface MapUpdate {
  id: number;
  background: number;
  outdoor: boolean;
  musicId: number | null;
  ambianceId: number | null;
}

const updates: MapUpdate[] = [];
let unreadable = 0;

/**
 * `ambianceId` and `musicId` are absent on most maps and, when present, are
 * pushed as AS2 numbers. Anything that is not a positive integer means "no
 * audio", which the column stores as NULL.
 */
function audioId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

for (const file of files) {
  let vars: Record<string, unknown>;

  try {
    const raw = Buffer.from(await Bun.file(join(mapsDir, file)).arrayBuffer());
    vars = evaluateActions(
      [...tags(decompress(raw))]
        .filter((t) => t.code === 12 || t.code === 59)
        .map((t) => (t.code === 59 ? t.data.subarray(2) : t.data))
        .reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))
    );
  } catch {
    unreadable++;
    continue;
  }

  const id = Number(vars.id);
  const background = Number(vars.backgroundNum);

  if (!Number.isFinite(id) || !Number.isFinite(background)) {
    unreadable++;
    continue;
  }

  updates.push({
    id,
    background,
    outdoor: vars.bOutdoor === true,
    musicId: audioId(vars.musicId),
    ambianceId: audioId(vars.ambianceId),
  });
}

console.log(
  `parsed ${updates.length} maps (${unreadable} unreadable), ` +
    `${updates.filter((u) => u.background > 0).length} with a background, ` +
    `${updates.filter((u) => u.outdoor).length} outdoor, ` +
    `${updates.filter((u) => u.musicId !== null).length} with music, ` +
    `${updates.filter((u) => u.ambianceId !== null).length} with an ambiance`
);

let written = 0;

for (const u of updates) {
  const res = await db
    .updateTable("maps")
    .set({
      background: u.background,
      outdoor: u.outdoor,
      musicId: u.musicId,
      ambianceId: u.ambianceId,
    })
    .where("id", "=", u.id)
    .executeTakeFirst();

  written += Number(res.numUpdatedRows ?? 0n);
}

console.log(`updated ${written} rows in maps`);

await db.destroy();
