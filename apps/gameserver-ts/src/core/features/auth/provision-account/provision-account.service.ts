/**
 * Creating a playable account, in one transaction, from one place.
 *
 * There used to be exactly one way to get an account into this game:
 * `scripts/dev-seed.ts`, which needs a shell on the checkout and a
 * superuser-ish view of postgres. An external control plane has neither,
 * so QA-126 puts the same job behind `POST /admin/accounts`. The rules
 * live here rather than in the route so that there is still one
 * implementation of them — the seed script composes the same primitives.
 *
 * Everything below runs inside a single transaction. A character that is
 * listed but not selectable (no `player_stats` row) or mute (no
 * `player_spells`) is worse than no character at all, so partial success
 * is not a state this API can leave behind.
 */
import type { DB } from "@shared/db/schema";
import type { Kysely } from "kysely";
import { hashPasswordKey } from "@features/auth/password-key";
import { findSpawnCell } from "@modules/maps/spawn-point";

import {
  fingerprintRequest,
  type ProvisionAccountRequest,
  type ProvisionAccountResult,
} from "./provision-account.contract";
import {
  ProvisionError,
  type ProvisionErrorCode,
} from "./provision-account.errors";

/** `game_servers.state` — mirrors `ServerState.ONLINE` in common.proto. */
const SERVER_STATE_ONLINE = 1;

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = "23505";

/**
 * The values 1.29 gives a freshly created character. Everything not named
 * here is a column default (level 1, 55 life, 10000 energy, no kamas, no
 * stat points) — see migration 0001.
 */
const CHARACTER_START_LEVEL = 1;
const CHARACTER_START_DIRECTION = 3;

/** The 1.29 sprite id: breed 1 sex 0 is 10, breed 2 sex 1 is 21. */
export function characterGfx(breedId: number, sex: number): number {
  return breedId * 10 + sex;
}

export type ProvisioningOptions = {
  /**
   * The map a provisioned character starts on. Shares `SPAWN_MAP_ID` with
   * the seed script so both agree on where "the start of the game" is.
   */
  spawnMapId: number;
};

/**
 * Every helper below takes a plain `Kysely<DB>` so the seed script — which
 * runs statement by statement, not in one transaction — can call the same
 * code. `provision()` passes a `Transaction<DB>`, which is what makes the
 * API's all-or-nothing guarantee hold.
 */
type Db = Kysely<DB>;

export class AccountProvisioningService {
  constructor(
    private readonly db: Kysely<DB>,
    private readonly options: ProvisioningOptions
  ) {}

  async provision(
    idempotencyKey: string,
    request: ProvisionAccountRequest
  ): Promise<ProvisionAccountResult> {
    const fingerprint = fingerprintRequest(request);

    return this.db
      .transaction()
      .execute(async (tx): Promise<ProvisionAccountResult> => {
        // Claim the key before anything else exists. A concurrent call with
        // the same key blocks here on the speculative insert, and once we
        // commit it falls through to replay() and returns our result — which
        // is what makes two racing retries produce one account, not two.
        const claimed = await tx
          .insertInto("provisioningRequests")
          .values({ idempotencyKey, requestHash: fingerprint })
          .onConflict((oc) => oc.column("idempotencyKey").doNothing())
          .returning("idempotencyKey")
          .executeTakeFirst();

        if (!claimed) {
          return replay(tx, idempotencyKey, fingerprint);
        }

        const result = await create(tx, request, this.options);

        await tx
          .updateTable("provisioningRequests")
          .set({
            accountId: result.account.id,
            characterId: result.character.id,
          })
          .where("idempotencyKey", "=", idempotencyKey)
          .execute();

        return result;
      });
  }
}

/**
 * The key is already on file. Same body → the earlier result; different
 * body → a caller bug, and nothing is mutated.
 */
async function replay(
  tx: Db,
  idempotencyKey: string,
  fingerprint: string
): Promise<ProvisionAccountResult> {
  const prior = await tx
    .selectFrom("provisioningRequests")
    .select(["requestHash", "accountId", "characterId"])
    .where("idempotencyKey", "=", idempotencyKey)
    .executeTakeFirstOrThrow();

  if (prior.requestHash !== fingerprint) {
    throw new ProvisionError(
      "idempotency_key_reuse",
      "this Idempotency-Key was already used for a different request body"
    );
  }

  if (!prior.accountId || !prior.characterId) {
    // Unreachable while the ids are written by the same transaction that
    // claims the row — kept as a loud failure rather than a null deref.
    throw new ProvisionError(
      "provisioning_incomplete",
      "a previous provisioning attempt left no account on this key"
    );
  }

  const account = await tx
    .selectFrom("accounts")
    .select(["id", "username"])
    .where("id", "=", prior.accountId)
    .executeTakeFirstOrThrow();

  const character = await tx
    .selectFrom("players")
    .select(["id", "name"])
    .where("id", "=", prior.characterId)
    .executeTakeFirstOrThrow();

  return { created: false, account, character };
}

async function create(
  tx: Db,
  request: ProvisionAccountRequest,
  options: ProvisioningOptions
): Promise<ProvisionAccountResult> {
  const serverId = await resolveServer(tx, request.serverId);
  const spawn = await resolveSpawn(tx, options.spawnMapId);

  const account = await insertAccount(tx, {
    username: request.username,
    pseudo: request.pseudo,
    pwdHash: await hashPasswordKey(request.passwordKey),
  });

  await bindAccountToServer(tx, account.id, serverId);

  const character = await insertCharacter(tx, {
    accountId: account.id,
    serverId,
    name: request.character.name,
    breedId: request.character.breedId,
    sex: request.character.sex,
    spawn,
  });

  await grantClassSpells(tx, character.id, request.character.breedId, {
    level: CHARACTER_START_LEVEL,
  });

  await refreshCharacterCount(tx, account.id, serverId);

  return { created: true, account, character };
}

/**
 * `serverId` omitted means "the only server anybody could select". Two
 * online servers make that ambiguous, and guessing would put the bot on a
 * world its operator never named.
 */
async function resolveServer(tx: Db, serverId?: number): Promise<number> {
  if (serverId !== undefined) {
    const server = await tx
      .selectFrom("gameServers")
      .select("id")
      .where("id", "=", serverId)
      .executeTakeFirst();

    if (!server) {
      throw new ProvisionError("unknown_server", `no server ${serverId}`);
    }

    return server.id;
  }

  const online = await tx
    .selectFrom("gameServers")
    .select("id")
    .where("state", "=", SERVER_STATE_ONLINE)
    .orderBy("id")
    .limit(2)
    .execute();

  const only = online[0];

  if (!only) {
    throw new ProvisionError(
      "no_server_available",
      "no game server is online to host the character"
    );
  }

  if (online.length > 1) {
    throw new ProvisionError(
      "server_required",
      "several servers are online — name one in serverId"
    );
  }

  return only.id;
}

export type SpawnPoint = { mapId: number; cellId: number };

async function resolveSpawn(tx: Db, mapId: number): Promise<SpawnPoint> {
  const cellId = await findSpawnCell(tx, mapId);

  if (cellId === null) {
    // Not a caller mistake: the world has not been imported. Say so
    // instead of dropping the character onto a blocked default cell.
    throw new ProvisionError(
      "spawn_map_missing",
      `spawn map ${mapId} has no walkable cell — import the world first`
    );
  }

  return { mapId, cellId };
}

export async function insertAccount(
  tx: Db,
  values: { username: string; pseudo: string; pwdHash: string }
): Promise<{ id: string; username: string }> {
  try {
    return await tx
      .insertInto("accounts")
      .values({ ...values, isAdmin: false })
      .returning(["id", "username"])
      .executeTakeFirstOrThrow();
  } catch (err) {
    throw uniqueViolationAs(err, {
      accounts_username_key: [
        "username_taken",
        `account "${values.username}" already exists`,
      ],
      uq_accounts_pseudo_lower: [
        "pseudo_taken",
        `pseudo "${values.pseudo}" is already taken`,
      ],
    });
  }
}

export async function bindAccountToServer(
  tx: Db,
  accountId: string,
  serverId: number
): Promise<void> {
  await tx
    .insertInto("accountServers")
    .values({ accountId, serverId, characterCount: 0 })
    .onConflict((oc) => oc.columns(["accountId", "serverId"]).doNothing())
    .execute();
}

export async function insertCharacter(
  tx: Db,
  values: {
    accountId: string;
    serverId: number;
    name: string;
    breedId: number;
    sex: number;
    spawn: SpawnPoint;
  }
): Promise<{ id: string; name: string }> {
  let character: { id: string; name: string };

  try {
    character = await tx
      .insertInto("players")
      .values({
        accountId: values.accountId,
        serverId: values.serverId,
        name: values.name,
        sex: values.sex,
        class: values.breedId,
        gfx: characterGfx(values.breedId, values.sex),
        level: CHARACTER_START_LEVEL,
        mapId: values.spawn.mapId,
        cellId: values.spawn.cellId,
        savepointMapId: values.spawn.mapId,
        savepointCellId: values.spawn.cellId,
        direction: CHARACTER_START_DIRECTION,
      })
      .returning(["id", "name"])
      .executeTakeFirstOrThrow();
  } catch (err) {
    throw uniqueViolationAs(err, {
      uq_players_server_name: [
        "character_name_taken",
        `character "${values.name}" already exists on server ` +
          `${values.serverId}`,
      ],
    });
  }

  // `character-list` and `select-character` read both of these. A
  // character missing them is listed and then refuses to be played, which
  // looks like a client bug and is not one.
  await tx
    .insertInto("playerStats")
    .values({ playerId: character.id })
    .execute();

  await tx
    .insertInto("playerColors")
    .values({ playerId: character.id })
    .execute();

  return character;
}

/**
 * The spellbook is what the class knows *at this level*, from
 * `class_spells` — three spells for a fresh level 1, not the 2 091-spell
 * catalogue and not an empty bar.
 */
export async function grantClassSpells(
  tx: Db,
  characterId: string,
  breedId: number,
  opts: { level: number }
): Promise<number> {
  const known = await tx
    .selectFrom("classSpells")
    .select(["spellId", "position"])
    .where("classId", "=", breedId)
    .where("learnLevel", "<=", opts.level)
    .orderBy("position")
    .execute();

  if (known.length === 0) {
    return 0;
  }

  await tx
    .insertInto("playerSpells")
    .values(
      known.map((spell) => ({
        playerId: characterId,
        spellId: spell.spellId,
        level: 1,
        position: spell.position,
      }))
    )
    .onConflict((oc) => oc.columns(["playerId", "spellId"]).doNothing())
    .execute();

  return known.length;
}

export async function refreshCharacterCount(
  tx: Db,
  accountId: string,
  serverId: number
): Promise<void> {
  const { count } = await tx
    .selectFrom("players")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("accountId", "=", accountId)
    .where("serverId", "=", serverId)
    .where("deletedAt", "is", null)
    .executeTakeFirstOrThrow();

  await tx
    .updateTable("accountServers")
    .set({ characterCount: Number(count) })
    .where("accountId", "=", accountId)
    .where("serverId", "=", serverId)
    .execute();
}

/**
 * Turns a postgres unique violation into the 409 that names the field the
 * caller has to change. Anything else is rethrown untouched — swallowing
 * an unrelated database error here would report "name taken" for a dead
 * connection.
 */
function uniqueViolationAs(
  err: unknown,
  byConstraint: Record<string, [code: ProvisionErrorCode, message: string]>
): unknown {
  const pg = err as { code?: string; constraint?: string };

  if (pg.code !== UNIQUE_VIOLATION || !pg.constraint) {
    return err;
  }

  const mapped = byConstraint[pg.constraint];

  return mapped ? new ProvisionError(mapped[0], mapped[1]) : err;
}
