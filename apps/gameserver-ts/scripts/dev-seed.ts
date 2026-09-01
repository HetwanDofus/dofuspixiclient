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
 * Re-running is safe, and no longer destructive to a character you have
 * played: it keeps the position (pass `RESET_POSITION=1` to move the
 * character back to the spawn) and adds missing spells rather than
 * rewriting the spellbook. Items and kamas are still re-seeded from
 * scratch — the grants below are a fixture, not a save.
 *
 * Four details are easy to get wrong here:
 *
 *  - `game_servers.state` must be 1 (online) or the server list comes back
 *    empty and login dead-ends on the server-select screen.
 *  - `select-character` INNER JOINs `player_stats`, so a character without a
 *    stats row is listed but cannot be selected.
 *  - the schema's default spawn `cell_id = 319` is NOT walkable on the
 *    default map 10300. We decode `maps.cells` and pick a walkable cell when
 *    the map is present.
 *  - the spellbook is what the class knows at the character's level, from
 *    `class_spells` — three spells at level 1, twenty for a Féca 101, never
 *    the whole 2 091-spell catalogue.
 *  - the item grants below need `item_templates` populated — run the world
 *    content importer first (`bun run scripts/import-starloco-content.ts
 *    game.sql`) or the character starts with kamas but an empty bag.
 */
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import {
  derivePasswordKey,
  hashPasswordKey,
} from "../src/core/features/auth/password-key.ts";
import {
  characterGfx,
  grantClassSpells,
} from "../src/core/features/auth/provision-account/provision-account.service.ts";
import { rollItemEffects } from "../src/core/modules/inventory/item-effects.ts";
import { OwnerKind } from "../src/core/modules/items/item-owner.ts";
import { decodeCells } from "../src/core/modules/maps/maps.cells-codec.ts";
import { findSpawnCell } from "../src/core/modules/maps/spawn-point.ts";

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
  HASH_CELL[33]! + HASH_CELL[7]! + HASH_CELL[32]! + HASH_CELL[0]?.repeat(7);

const username = process.argv[2] ?? "dev";
const password = process.argv[3] ?? "dev";
const characterName = process.argv[4] ?? "Dev";

/**
 * Where the character wakes up: map 7411, the Astrub zaap (`waypoints` id
 * 49) — the same value the gateway gives the provisioning API, so a seeded
 * and a provisioned character land on the same map. Override with
 * `SPAWN_MAP_ID=...` for another one; an existing character keeps the
 * position it walked to unless `RESET_POSITION=1`.
 */
const SPAWN_MAP_ID = Number(process.env.SPAWN_MAP_ID ?? 7411);
/**
 * Feca by default. Drives both `players.class` and which `class_spells` rows
 * the character gets. Override with `CHARACTER_CLASS=2` (1..12, the 1.29
 * breed ids) to seed a second, visually distinct character for two-player
 * testing; `CHARACTER_SEX=1` for the female sprite.
 */
const CHARACTER_CLASS = Number(process.env.CHARACTER_CLASS ?? 1);
const CHARACTER_SEX = Number(process.env.CHARACTER_SEX ?? 0);
const CHARACTER_GFX = characterGfx(CHARACTER_CLASS, CHARACTER_SEX);
/** Used only when the spawn map has no row yet — see the walkability note. */
const FALLBACK_SPAWN_CELL = 311;

/**
 * Kamas the dev character starts with — the exact balance shown in
 * `screenshot-ui/inventaire.png`, so a side-by-side comparison lines up.
 */
const STARTING_KAMAS = 16_161;

/**
 * One entry per item the dev character starts with. `templateId`s are real
 * 1.29 items (verified against `assets/dist/langs/fr/items.json`), chosen to
 * exercise the inventory window end to end:
 *
 *  - one piece per equipment slot, including a dofus, a pet and a shield,
 *    so every paperdoll slot in the reference screenshot has something in it;
 *  - "Épée de l'initié" (one-handed) equipped alongside the shield, and
 *    "Arc de l'initié" (two-handed, unequipped) in the bag — try equipping
 *    the bow to see the shield get displaced in the same move;
 *  - "Petite Epée de Boisaille" needs `CS>4` and this character has 0
 *    strength, so equipping it must be refused — the fail-closed criteria
 *    path has something real to bite on;
 *  - a stack of "Potion de Mini Soin" (heals, effect 110) to exercise `use`;
 *  - three resources at different quantities, to fill the bag grid the way
 *    the screenshot's "Ressources" panel is filled.
 *
 * `position` is an `EquipmentPosition` value (`packages/protocol/src/
 * item-types.ts`) or -1 for the bag.
 */
const ITEM_GRANTS: Array<{
  templateId: number;
  name: string;
  quantity: number;
  position: number;
}> = [
  {
    templateId: 39,
    name: "Petite Amulette du Hibou",
    quantity: 1,
    position: 0,
  },
  { templateId: 6780, name: "Épée de l'initié", quantity: 1, position: 1 },
  {
    templateId: 100,
    name: "Petit Anneau de Sagesse",
    quantity: 1,
    position: 2,
  },
  {
    templateId: 252,
    name: "Petite Ceinture Vitalesque",
    quantity: 1,
    position: 3,
  },
  { templateId: 109, name: "Petit Anneau de Chance", quantity: 1, position: 4 },
  {
    templateId: 297,
    name: "Bottes du Petit Bouftou",
    quantity: 1,
    position: 5,
  },
  { templateId: 940, name: "Louffeur", quantity: 1, position: 6 },
  { templateId: 677, name: "Cape du Pirate", quantity: 1, position: 7 },
  { templateId: 7708, name: "Pioute bleu", quantity: 1, position: 8 },
  { templateId: 7043, name: "Dofus des Glaces", quantity: 1, position: 9 },
  {
    templateId: 7097,
    name: "Bouclier d'entraînement",
    quantity: 1,
    position: 15,
  },
  { templateId: 6783, name: "Arc de l'initié", quantity: 1, position: -1 },
  {
    templateId: 40,
    name: "Petite Epée de Boisaille",
    quantity: 1,
    position: -1,
  },
  { templateId: 1182, name: "Potion de Mini Soin", quantity: 5, position: -1 },
  // The three starter job tools, in the bag rather than equipped: the
  // harvest loop refuses without one in the weapon slot (QA-123), and a
  // character who cannot equip one cannot exercise it at all. They are the
  // real `jobs_data.tools` entries for Bûcheron, Mineur and Paysan.
  { templateId: 454, name: "Hache de Bûcheron", quantity: 1, position: -1 },
  { templateId: 497, name: "Pioche du Mineur", quantity: 1, position: -1 },
  { templateId: 577, name: "Faux du Paysan", quantity: 1, position: -1 },
  { templateId: 289, name: "Blé", quantity: 25, position: -1 },
  { templateId: 303, name: "Bois de Frêne", quantity: 8, position: -1 },
  { templateId: 312, name: "Fer", quantity: 3, position: -1 },
  // Chienchien, unequipped (the pet slot is already taken by the Pioute
  // above): the reference capture's own familier. Its template effects are
  // `[800 "Points de vie", 124 "+20 en sagesse"]` — no 983 "Lié au compte"
  // (that row in the capture is the *instance*'s account-bound flag, not
  // template data, and this project doesn't stamp one on creation) and 800
  // is filtered by `HIDDEN_EFFECT_IDS` (its param3 is a constant sentinel,
  // not a real per-pet HP value — see that constant's doc comment). So
  // this item renders one clean, real effect row: "+20 en sagesse", green.
  { templateId: 1711, name: "Chienchien", quantity: 1, position: -1 },
];

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dofus:dofus@localhost:5432/dofus";

const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  plugins: [new CamelCasePlugin()],
});

const pwdHash = await hashPasswordKey(
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

  // The pick itself is shared with `POST /admin/accounts` — a seeded
  // character and a provisioned one must wake up the same way.
  const cellId = await findSpawnCell(db, SPAWN_MAP_ID);

  if (cellId === null) {
    throw new Error(`map ${SPAWN_MAP_ID} has no walkable cell`);
  }

  return cellId;
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

/**
 * Re-running the seed used to teleport an existing character back to the
 * spawn map, which is how a character ends up standing somewhere it
 * never walked to. Position now belongs to the character once it exists;
 * pass `RESET_POSITION=1` to ask for the old behaviour explicitly.
 */
const resetPosition = process.env.RESET_POSITION === "1";

const character = await db
  .insertInto("players")
  .values({
    accountId: account.id,
    serverId: server.id,
    name: characterName,
    sex: CHARACTER_SEX,
    class: CHARACTER_CLASS,
    gfx: CHARACTER_GFX,
    level: 1,
    kamas: String(STARTING_KAMAS),
    mapId: SPAWN_MAP_ID,
    cellId,
    savepointMapId: SPAWN_MAP_ID,
    savepointCellId: cellId,
    direction: 3,
  })
  .onConflict((oc) =>
    oc.columns(["serverId", "name"]).doUpdateSet({
      kamas: String(STARTING_KAMAS),
      ...(resetPosition ? { mapId: SPAWN_MAP_ID, cellId } : {}),
    })
  )
  .returning(["id", "name", "level", "mapId", "cellId"])
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

/**
 * `ITEM_GRANTS` re-seeded from scratch on every run, same reasoning as the
 * spellbook below: re-running with a shorter or different list must not
 * leave orphaned rows from a previous run behind.
 *
 * Each grant rolls its own effects via `rollItemEffects` — the same
 * function `FightEndService.grantLoot` uses for real drops — rather than
 * copying the template's effects verbatim, so a seeded weapon looks like
 * an actually-looted one (a jet, not the minimum of every range).
 */
const templates = await db
  .selectFrom("itemTemplates")
  .selectAll()
  .where(
    "id",
    "in",
    ITEM_GRANTS.map((g) => g.templateId)
  )
  .execute();
const templateById = new Map(templates.map((t) => [t.id, t]));

const missing = ITEM_GRANTS.filter((g) => !templateById.has(g.templateId));
if (missing.length === ITEM_GRANTS.length) {
  console.warn(
    "item_templates is empty — run the content importer " +
      "(`bun run scripts/import-starloco-content.ts game.sql`) to give the " +
      "dev character a starting inventory. Kamas were still granted."
  );
} else if (missing.length > 0) {
  console.warn(
    `${missing.length} seeded item template(s) not found, skipping: ` +
      missing.map((g) => `${g.templateId} (${g.name})`).join(", ")
  );
}

await db
  .deleteFrom("items")
  .where("ownerKind", "=", OwnerKind.Player)
  .where("ownerId", "=", character.id)
  .execute();

const itemRows = ITEM_GRANTS.filter((g) => templateById.has(g.templateId)).map(
  (grant) => ({
    ownerKind: OwnerKind.Player,
    ownerId: character.id,
    templateId: grant.templateId,
    position: grant.position,
    quantity: grant.quantity,
    effects: JSON.stringify(
      rollItemEffects(templateById.get(grant.templateId).effects)
    ),
  })
);

if (itemRows.length > 0) {
  await db.insertInto("items").values(itemRows).execute();
}

/**
 * Migration 0036 cross-joins players × spell_templates, but it runs before any
 * player exists, so a hand-seeded character starts with an empty spellbook.
 *
 * The spellbook is what the class knows *at this character's level*, from
 * `class_spells` (migration 0048) — three spells for a fresh level 1, twenty
 * for a Féca 101. Copying `spell_templates` wholesale, which this did before
 * 0044, hands a level-1 character all 2 091 spells in the game; seeding only
 * the three starters, which it did between 0044 and 0048, leaves a levelled
 * character mute.
 *
 * Two deliberate asymmetries:
 *
 *  - the grant is an upsert that does nothing on conflict, so a spell the
 *    character has upgraded keeps its level and its bar slot;
 *  - the delete is scoped to spells that are *not* the class's, which is what
 *    still trims a character seeded before 0044 (the whole catalogue) without
 *    touching anything legitimately learned.
 */
const classSpells = await db
  .selectFrom("classSpells")
  .select("spellId")
  .where("classId", "=", CHARACTER_CLASS)
  .execute();

if (classSpells.length === 0) {
  console.warn(
    `no class_spells rows for class ${CHARACTER_CLASS} — run ` +
      `\`just db-migrate\` (migration 0048) or the character starts mute.`
  );
} else {
  await db
    .deleteFrom("playerSpells")
    .where("playerId", "=", character.id)
    .where(
      "spellId",
      "not in",
      classSpells.map((s: { spellId: number }) => s.spellId)
    )
    .execute();

  // The grant itself is the one `POST /admin/accounts` uses. Only the trim
  // above is a seed concern: it is what still repairs a character seeded
  // before migration 0044 with the whole catalogue.
  const granted = await grantClassSpells(db, character.id, CHARACTER_CLASS, {
    level: character.level,
  });

  console.log(
    `spellbook: ${granted}/${classSpells.length} class ` +
      `${CHARACTER_CLASS} spells granted at level ${character.level}`
  );
}

await db
  .updateTable("accountServers")
  .set({ characterCount: 1 })
  .where("accountId", "=", account.id)
  .where("serverId", "=", server.id)
  .execute();

console.log(
  `seeded account ${account.username} (id=${account.id}) on server ` +
    `${server.name} (id=${server.id}) with character ${character.name} ` +
    `(id=${character.id}, level ${character.level}) at map ` +
    `${character.mapId} cell ${character.cellId}` +
    (character.mapId === SPAWN_MAP_ID && character.cellId === cellId
      ? ""
      : ` (kept — re-run with RESET_POSITION=1 to move it back to ` +
        `map ${SPAWN_MAP_ID} cell ${cellId})`)
);

await db.destroy();
