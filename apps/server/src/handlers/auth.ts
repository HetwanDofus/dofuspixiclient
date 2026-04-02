import type {
  AuthSuccessPayload,
  CharacterInfoPayload,
  CharacterSelectPayload,
  LoginPayload,
} from "../protocol/types.ts";
import { db } from "../db/database.ts";
import {
  getCharacterById,
  getCharactersByAccountId,
} from "../game/character.ts";
import {
  cleanupEmptyMap,
  getMapInstance,
  getOrCreateMapInstance,
  registerOnlineCharacter,
  unregisterOnlineCharacter,
} from "../game/game-manager.ts";
import { getCompressedMap, getMap } from "../maps/map-store.ts";
import { getPathfinding } from "../maps/pathfinding.ts";
import { encodeServerMessage } from "../protocol/codec.ts";
import { ServerMessageType } from "../protocol/types.ts";
import {
  type ClientSession,
  SessionState,
  transitionTo,
} from "../ws/client-session.ts";
import { requireAuthenticated } from "../ws/guards.ts";
import { createLogger } from "../utils/logger.ts";
import { sendInventoryList } from "./inventory.ts";
import { buildLookString } from "../game/inventory.ts";
import { sendCharacterStats } from "./stats.ts";

const log = createLogger("Auth");

export async function handleLogin(
  session: ClientSession,
  payload: LoginPayload
): Promise<void> {
  const { username, password } = payload;

  const account = await db
    .selectFrom("accounts")
    .selectAll()
    .where("username", "=", username)
    .where("password", "=", password)
    .executeTakeFirst();

  if (!account) {
    const msg = encodeServerMessage(ServerMessageType.AUTH_FAILURE, {
      reason: "Invalid credentials",
    });
    session.ws.send(msg);
    return;
  }

  session.accountId = account.id;
  transitionTo(session, SessionState.AUTHENTICATED);

  const characters = await getCharactersByAccountId(account.id);

  const authSuccess: AuthSuccessPayload = {
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      class: c.class,
      sex: c.sex,
      gfx: c.gfx,
      level: c.level,
      mapId: c.map_id,
      cellId: c.cell_id,
    })),
  };

  const msg = encodeServerMessage(ServerMessageType.AUTH_SUCCESS, authSuccess);
  session.ws.send(msg);
}

export async function handleCharacterSelect(
  session: ClientSession,
  payload: CharacterSelectPayload
): Promise<void> {
  if (!requireAuthenticated(session)) return;

  const character = await getCharacterById(payload.characterId);
  if (!character || character.account_id !== session.accountId) {
    log.warn(`Character not found or unauthorized access attempt`);
    session.ws.send(
      encodeServerMessage(ServerMessageType.ERROR, {
        reason: "Character not found",
      })
    );
    return;
  }

  session.characterId = character.id;
  session.characterName = character.name;
  session.mapId = character.map_id;
  session.cellId = character.cell_id;
  session.direction = character.direction;

  registerOnlineCharacter(character.id, session);

  // Send CHARACTER_INFO
  const charInfo: CharacterInfoPayload = {
    id: character.id,
    name: character.name,
    class: character.class,
    sex: character.sex,
    color1: character.color1,
    color2: character.color2,
    color3: character.color3,
    gfx: character.gfx,
    level: character.level,
    mapId: character.map_id,
    cellId: character.cell_id,
    direction: character.direction,
  };
  session.ws.send(
    encodeServerMessage(ServerMessageType.CHARACTER_INFO, charInfo)
  );

  // Send CHARACTER_STATS
  await sendCharacterStats(session);

  // Send INVENTORY_LIST
  await sendInventoryList(session);

  // Send MAP_DATA
  const map = await getMap(character.map_id);
  const compressed = await getCompressedMap(character.map_id);
  if (map && compressed) {
    session.ws.send(
      encodeServerMessage(ServerMessageType.MAP_DATA, {
        mapId: map.id,
        width: map.width,
        height: map.height,
        background: map.background,
        compressed: new Uint8Array(compressed),
        encoding: "gzip",
      })
    );
  }

  // Join map instance — add self first so we appear in the actors list
  const mapInstance = getOrCreateMapInstance(character.map_id);
  const look = await buildLookString(
    character.gfx, character.color1, character.color2, character.color3, character.id
  );
  mapInstance.addActor(
    session,
    character.id,
    character.name,
    character.cell_id,
    character.direction,
    look
  );

  // Send all actors (including self) to the joining player
  const actors = mapInstance.getActors();
  session.ws.send(
    encodeServerMessage(ServerMessageType.MAP_ACTORS, { actors })
  );

  // Init pathfinding occupancy
  const pf = await getPathfinding(character.map_id);
  if (pf) {
    pf.addOccupied(character.cell_id);
  }

  transitionTo(session, SessionState.IN_WORLD);
}

export async function handleLogout(session: ClientSession): Promise<void> {
  if (session.characterId && session.mapId !== null) {
    const mapInstance = getMapInstance(session.mapId);
    if (mapInstance) {
      mapInstance.removeActor(session.characterId);
      cleanupEmptyMap(session.mapId);
    }

    const pf = await getPathfinding(session.mapId);
    if (pf && session.cellId !== null) {
      pf.removeOccupied(session.cellId);
    }

    unregisterOnlineCharacter(session.characterId);
  }

  session.accountId = null;
  session.characterId = null;
  session.characterName = null;
  session.mapId = null;
  session.cellId = null;
}
