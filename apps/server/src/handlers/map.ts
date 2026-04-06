import type { MapChangePayload } from "../protocol/types.ts";
import type { ClientSession } from "../ws/client-session.ts";
import { db } from "../db/database.ts";
import {
  getCharacterById,
  updateCharacterPosition,
} from "../game/character.ts";
import { buildLookString, getLinkedChildren } from "../game/inventory.ts";
import { getMountModel } from "../data/mount-data.ts";
import type { MountData } from "../protocol/types.ts";
import {
  cleanupEmptyMap,
  getMapInstance,
  getOrCreateMapInstance,
} from "../game/game-manager.ts";
import { getAdjacentMaps, getCompressedMap, getMap, mapExists } from "../maps/map-store.ts";
import { getPathfinding } from "../maps/pathfinding.ts";
import { encodeServerMessage } from "../protocol/codec.ts";
import { ServerMessageType } from "../protocol/types.ts";
import { createLogger } from "../utils/logger.ts";

const log = createLogger("Map");
const MAX_TRIGGER_CACHE_SIZE = 200;

export interface MapTrigger {
  targetMapId: number;
  targetCellId: number;
}

// Per-map trigger cache: Map<mapId, Map<cellId, MapTrigger>>
const triggerCache = new Map<number, Map<number, MapTrigger>>();

async function loadMapTriggers(
  mapId: number
): Promise<Map<number, MapTrigger>> {
  const cached = triggerCache.get(mapId);
  if (cached) return cached;

  const rows = await db
    .selectFrom("scripted_cells")
    .select(["cell_id", "action_args"])
    .where("map_id", "=", mapId)
    .where("action_id", "=", 0)
    .where("event_id", "=", 1)
    .execute();

  const triggers = new Map<number, MapTrigger>();
  for (const row of rows) {
    if (!row.action_args) continue;
    const parts = row.action_args.split(",");
    if (parts.length < 2) continue;
    triggers.set(row.cell_id, {
      targetMapId: Number.parseInt(parts[0], 10),
      targetCellId: Number.parseInt(parts[1], 10),
    });
  }

  // Evict oldest if cache exceeds limit
  if (triggerCache.size >= MAX_TRIGGER_CACHE_SIZE) {
    const firstKey = triggerCache.keys().next().value;
    if (firstKey !== undefined) {
      triggerCache.delete(firstKey);
    }
  }

  triggerCache.set(mapId, triggers);
  return triggers;
}

export async function getTrigger(
  mapId: number,
  cellId: number
): Promise<MapTrigger | null> {
  const triggers = await loadMapTriggers(mapId);
  return triggers.get(cellId) ?? null;
}

export async function getMapTriggers(
  mapId: number
): Promise<Map<number, MapTrigger>> {
  return loadMapTriggers(mapId);
}

export async function handleMapChange(
  session: ClientSession,
  payload: MapChangePayload
): Promise<void> {
  if (!session.characterId || !session.characterName) return;
  await changeMap(session, payload.mapId);
}

export async function changeMap(
  session: ClientSession,
  newMapId: number,
  targetCellId?: number
): Promise<void> {
  if (!session.characterId || !session.characterName) return;

  if (!(await mapExists(newMapId))) {
    session.ws.send(
      encodeServerMessage(ServerMessageType.ERROR, { reason: "Map not found" })
    );
    return;
  }

  const oldMapId = session.mapId;

  // Remove from old map
  if (oldMapId !== null) {
    const oldInstance = getMapInstance(oldMapId);
    if (oldInstance) {
      oldInstance.removeActor(session.characterId);
      cleanupEmptyMap(oldMapId);
    }

    const oldPf = await getPathfinding(oldMapId);
    if (oldPf && session.cellId !== null) {
      oldPf.removeOccupied(session.cellId);
    }
  }

  // Load new map
  const map = await getMap(newMapId);
  const compressed = await getCompressedMap(newMapId);
  if (!map || !compressed) return;

  // Use trigger target cell, or fall back to first walkable
  const newCellId = targetCellId ?? map.walkableIds[0] ?? 0;

  // Update session
  session.mapId = newMapId;
  session.cellId = newCellId;

  // Persist to DB
  await updateCharacterPosition(
    session.characterId,
    newMapId,
    newCellId,
    session.direction
  );

  // Load triggers for this map
  const triggers = await getMapTriggers(newMapId);
  const triggerCellIds = Array.from(triggers.keys());

  // Send MAP_DATA
  session.ws.send(
    encodeServerMessage(ServerMessageType.MAP_DATA, {
      mapId: map.id,
      width: map.width,
      height: map.height,
      background: map.background,
      compressed: new Uint8Array(compressed),
      encoding: "gzip",
      triggerCellIds,
    })
  );

  // Get character look (including accessories)
  const character = await getCharacterById(session.characterId);
  let look = character
    ? await buildLookString(character.gfx, character.color1, character.color2, character.color3, character.id)
    : "";

  // Build mount data if character is mounted
  let mountData: MountData | undefined;
  if (character?.mount_model_id != null) {
    const model = getMountModel(character.mount_model_id);
    if (model) {
      const chevauchorGfxId = character.class * 10 + character.sex;
      const mc1 = model.color1 === -1 ? character.color1 : model.color1;
      const mc2 = model.color2 === -1 ? character.color2 : model.color2;
      const mc3 = model.color3 === -1 ? character.color3 : model.color3;
      mountData = {
        modelId: character.mount_model_id,
        chevauchorGfxId,
        color1: mc1, color2: mc2, color3: mc3,
      };
      const accPart = look.split("|").slice(4).join("|");
      look = `${model.gfxId}|${mc1}|${mc2}|${mc3}${accPart ? "|" + accPart : ""}`;
    }
  }

  // Join new map instance — add self first so we appear in the actors list
  const newInstance = getOrCreateMapInstance(newMapId);
  const linkedChildren = character ? await getLinkedChildren(character.id) : undefined;
  newInstance.addActor(
    session,
    session.characterId,
    session.characterName,
    newCellId,
    session.direction,
    look,
    linkedChildren,
    mountData
  );

  // Send all actors (including self) to the joining player
  const actors = newInstance.getActors();
  session.ws.send(
    encodeServerMessage(ServerMessageType.MAP_ACTORS, { actors })
  );

  // Update pathfinding
  const newPf = await getPathfinding(newMapId);
  if (newPf) {
    newPf.addOccupied(newCellId);
  }

  // Send adjacent maps for preloading (fire and forget — non-blocking)
  getAdjacentMaps(newMapId).then((adjacentMaps) => {
    if (adjacentMaps.length === 0) return;
    session.ws.send(
      encodeServerMessage(ServerMessageType.MAP_ADJACENT, {
        maps: adjacentMaps.map((m) => ({
          mapId: m.id,
          dx: m.dx,
          dy: m.dy,
          width: m.width,
          height: m.height,
          background: m.background,
          compressed: new Uint8Array(m.cellsGzip),
          encoding: "gzip" as const,
        })),
      })
    );
  });
}
