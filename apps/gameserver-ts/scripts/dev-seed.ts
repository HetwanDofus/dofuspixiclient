/**
 * Minimal dev seed: one game server, one account, one playable character.
 *
 * The migrations create the schema and seed static game data (spells, items,
 * tutorial, …) but deliberately leave `game_servers`, `accounts` and
 * `players` empty — those are per-deployment. A fresh database therefore
 * cannot be logged into at all, and character creation is not implemented
 * yet (no create-character screen, no server feature), so the character
 * rows have to be written by hand.
 *
 *   DATABASE_URL=... bun run scripts/dev-seed.ts [username] [password] [character]
 *
 * Re-running is safe: every row is upserted.
 *
 * Three details are easy to get wrong here:
 *
 *  - `game_servers.state` must be 1 (online) or the server list comes back
 *    empty and login dead-ends on the server-select screen.
 *  - `select-character` INNER JOINs `player_stats`, so a character without a
 *    stats row is listed but cannot be selected.
 *  - the schema's default spawn `cell_id = 319` is NOT walkable on the
 *    default map 10300. We decode `maps.cells` and pick a walkable cell when
 *    the map is present.
 */
import { createHash, pbkdf2 as pbkdf2Cb } from "node:crypto";
import { promisify } from "node:util";

import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import { decodeCells } from "../src/core/modules/maps/maps.cells-codec.ts";

/**
 * Same alphabet the StarLoco / Dofus 1.29 cell payload uses — see
 * `src/core/modules/maps/maps.cells-codec.ts`, which decodes it.
 */
const HASH_CELL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

/**
 * One flat, walkable, empty cell in the 10-char HASH_CELL encoding.
 *
 * Reading the decoder's `unpack60` backwards for the fields we want and
 * leaving every art layer at 0:
 *   d0 = active(0x20) | lineOfSight(0x01) = 0x21 → index 33
 *   d1 = groundLevel 7                            → index 7
 *   d2 = movement 4 (any non-zero = walkable) << 3 → index 32
 *   d3..d9 = 0 (no ground/object graphics)         → index 0
 */
const BLANK_WALKABLE_CELL =
  HASH_CELL[33]! + HASH_CELL[7]! + HASH_CELL[32]! + HASH_CELL[0]!.repeat(7);

const pbkdf2 = promisify(pbkdf2Cb);

/**
 * The raw password never reaches the server: the client stretches it and
 * sends the base64 key as `AccountSendIdentity.encrypted_password`, and the
 * login handler runs `Bun.password.verify(thatKey, accounts.pwd_hash)`. So
 * the stored hash must be over the derived key, not the password.
 *
 * Keep in sync with `apps/electrobun/src/game/auth/pbkdf2.ts`, which owns
 * these parameters.
 */
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEY_BYTES = 32;

async function derivePasswordKey(
  password: string,
  username: string
): Promise<string> {
  const salt = createHash("sha256")
    .update(`dofus:${username.toLowerCase()}`)
    .digest();
  const derived = await pbkdf2(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_BYTES,
    "sha256"
  );
  return derived.toString("base64");
}

const username = process.argv[2] ?? "dev";
const password = process.argv[3] ?? "dev";
const characterName = process.argv[4] ?? "Dev";

/**
 * Where the character wakes up. Defaults to the schema's own default map.
 * Override with `SPAWN_MAP_ID=7365` (Cité d'Astrub) for a map with scenery —
 * see the warning `spawnCell` prints.
 */
const SPAWN_MAP_ID = Number(process.env.SPAWN_MAP_ID ?? 10_300);
/** Used only when the spawn map has no row yet — see the walkability note. */
const FALLBACK_SPAWN_CELL = 311;

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

const pwdHash = await Bun.password.hash(
  await derivePasswordKey(password, username)
);

const server = await db
  .insertInto("gameServers")
  .values({
    id: 1,
    name: "Dev",
    address: "127.0.0.1",
    port: 8080,
    state: 1, // ONLINE
    community: 0,
  })
  .onConflict((oc) => oc.column("id").doUpdateSet({ state: 1 }))
  .returning(["id", "name"])
  .executeTakeFirstOrThrow();

const account = await db
  .insertInto("accounts")
  .values({ username, pwdHash, pseudo: username, isAdmin: true })
  .onConflict((oc) => oc.column("username").doUpdateSet({ pwdHash }))
  .returning(["id", "username"])
  .executeTakeFirstOrThrow();

await db
  .insertInto("accountServers")
  .values({ accountId: account.id, serverId: server.id, characterCount: 0 })
  .onConflict((oc) => oc.columns(["accountId", "serverId"]).doNothing())
  .execute();

/**
 * `players.cell_id` has to be a walkable cell of the spawn map or the client
 * drops the character onto a blocked tile and pathfinding refuses to move.
 * `maps.cells` is the StarLoco HASH_CELL payload; decode it and take the
 * first walkable id.
 */
async function spawnCell(): Promise<number> {
  let map = await db
    .selectFrom("maps")
    .select(["cells", "background"])
    .where("id", "=", SPAWN_MAP_ID)
    .executeTakeFirst();

  if (!map?.cells) {
    await seedPlaceholderMap();
    map = await db
      .selectFrom("maps")
      .select(["cells", "background"])
      .where("id", "=", SPAWN_MAP_ID)
      .executeTakeFirst();
  }

  if (!map?.cells) {
    return FALLBACK_SPAWN_CELL;
  }

  const cells = decodeCells(
    map.cells instanceof Uint8Array ? map.cells : new Uint8Array(map.cells)
  );

  // A map draws its scenery from per-cell ground/object tiles plus a single
  // background image. Nothing populates `maps.background` yet, so a map with
  // no ground tiles — 10300 "Pitons rocheux" is one — renders as an empty
  // viewport even though it is perfectly playable.
  if (!cells.some((c) => c.ground > 0) && !map.background) {
    console.warn(
      `map ${SPAWN_MAP_ID} has no per-cell ground tiles and no background, so ` +
        `it will render as an empty viewport. Set SPAWN_MAP_ID to a map with ` +
        `scenery (e.g. 7365, Cité d'Astrub) to see the world.`
    );
  }

  const map2 = await db
    .selectFrom("maps")
    .select(["width", "height"])
    .where("id", "=", SPAWN_MAP_ID)
    .executeTakeFirstOrThrow();

  // Spawn in the middle of the map rather than on the first walkable cell —
  // cell ids start at the top corner of the diamond, which is usually off the
  // top of the viewport, so a naive pick makes the character look missing.
  const stride = 2 * map2.width - 1;
  const centreRow = map2.height - 1;
  const centreCol = Math.floor(map2.width / 2);

  let best: { id: number; d: number } | null = null;

  for (const cell of cells) {
    if (!cell.active || !cell.walkable) continue;

    const pair = Math.floor(cell.id / stride);
    const offset = cell.id % stride;
    const row = offset < map2.width ? pair * 2 : pair * 2 + 1;
    const col = offset < map2.width ? offset : offset - map2.width;
    const d = Math.abs(row - centreRow) + Math.abs(col - centreCol);

    if (!best || d < best.d) best = { id: cell.id, d };
  }

  if (!best) {
    throw new Error(`map ${SPAWN_MAP_ID} has no walkable cell`);
  }

  return best.id;
}

/**
 * `enter-game` refuses to place a character on a map that has no row, and the
 * `maps` table is populated from a StarLoco `maps` dump that this repository
 * does not ship (only `assets/sources/starloco/sorts.sql` is here). To keep a
 * fresh checkout playable end-to-end we drop in a placeholder: a 15×17 grid of
 * flat, walkable, art-less cells. It is a blank room, NOT the real Incarnam
 * map — import the real dump to replace it.
 */
async function seedPlaceholderMap(): Promise<void> {
  const width = 15;
  const height = 17;
  const cellCount = width * height * 2;

  console.warn(
    `map ${SPAWN_MAP_ID} is missing — inserting a blank ${width}x${height} ` +
      `placeholder so enter-game works. Import a StarLoco maps dump for the ` +
      `real world.`
  );

  await db
    .insertInto("subareas")
    .values({ id: 1, areaId: 0, name: "Dev" })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  await db
    .insertInto("maps")
    .values({
      id: SPAWN_MAP_ID,
      date: "0000000000",
      key: "",
      width,
      height,
      cells: Buffer.from(BLANK_WALKABLE_CELL.repeat(cellCount), "utf8"),
      subareaId: 1,
      x: -4,
      y: 3,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
}

const cellId = await spawnCell();

const character = await db
  .insertInto("players")
  .values({
    accountId: account.id,
    serverId: server.id,
    name: characterName,
    sex: 0,
    class: 1, // Feca
    gfx: 10, // class 1, sex 0 → sprite 10
    level: 1,
    mapId: SPAWN_MAP_ID,
    cellId,
    savepointMapId: SPAWN_MAP_ID,
    savepointCellId: cellId,
    direction: 3,
  })
  .onConflict((oc) =>
    oc.columns(["serverId", "name"]).doUpdateSet({ mapId: SPAWN_MAP_ID, cellId })
  )
  .returning(["id", "name"])
  .executeTakeFirstOrThrow();

await db
  .insertInto("playerStats")
  .values({ playerId: character.id })
  .onConflict((oc) => oc.column("playerId").doNothing())
  .execute();

await db
  .insertInto("playerColors")
  .values({ playerId: character.id })
  .onConflict((oc) => oc.column("playerId").doNothing())
  .execute();

// Migration 0036 cross-joins players × spell_templates, but it runs before any
// player exists, so a hand-seeded character starts with an empty spellbook.
await db
  .insertInto("playerSpells")
  .columns(["playerId", "spellId", "level", "position"])
  .expression((eb) =>
    eb
      .selectFrom("spellTemplates")
      .select([
        eb.val(character.id).as("playerId"),
        "spellTemplates.id as spellId",
        eb.val(1).as("level"),
        eb.val(-1).as("position"),
      ])
  )
  .onConflict((oc) => oc.columns(["playerId", "spellId"]).doNothing())
  .execute();

await db
  .updateTable("accountServers")
  .set({ characterCount: 1 })
  .where("accountId", "=", account.id)
  .where("serverId", "=", server.id)
  .execute();

console.log(
  `seeded account ${account.username} (id=${account.id}) on server ` +
    `${server.name} (id=${server.id}) with character ${character.name} ` +
    `(id=${character.id}) at map ${SPAWN_MAP_ID} cell ${cellId}`
);

await db.destroy();
