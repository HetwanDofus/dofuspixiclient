import type {
  ActorMovePayload,
  CharacterMovePayload,
} from "../protocol/types.ts";
import { db } from "../db/database.ts";
import { updateCharacterPosition } from "../game/character.ts";
import { getMapInstance } from "../game/game-manager.ts";
import { getMap } from "../maps/map-store.ts";
import { getPathfinding } from "../maps/pathfinding.ts";
import { encodeServerMessage } from "../protocol/codec.ts";
import { ServerMessageType } from "../protocol/types.ts";
import { type ClientSession, SessionState } from "../ws/client-session.ts";
import { requireInWorld } from "../ws/guards.ts";
import { createLogger } from "../utils/logger.ts";
import { changeMap, getMapTriggers } from "./map.ts";

const log = createLogger("Movement");

/**
 * Pending transition after a move completes.
 * Stored per-session until CHARACTER_MOVE_END arrives.
 */
interface PendingTransition {
  type: "trigger" | "edge";
  targetMapId: number;
  targetCellId: number;
}

const pendingTransitions = new Map<string, PendingTransition>();

export async function handleMovement(
  session: ClientSession,
  payload: CharacterMovePayload,
): Promise<void> {
  if (!requireInWorld(session)) return;
  if (session.state !== SessionState.IN_WORLD) return;

  const { path } = payload;
  if (!path || path.length < 2) return;

  const pf = await getPathfinding(session.mapId);
  if (!pf) return;

  // Validate path
  if (!pf.validatePath(path, session.cellId)) {
    log.warn(
      `REJECTED path: map=${session.mapId} from=${session.cellId} to=${path[path.length - 1]} path=[${path.join(",")}]`,
    );
    session.ws.send(
      encodeServerMessage(ServerMessageType.ERROR, {
        reason: "Invalid path",
      }),
    );
    return;
  }

  log.debug(
    `OK: map=${session.mapId} cell ${session.cellId} -> ${path[path.length - 1]} (${path.length - 1} steps)`,
  );

  // Load all triggers for this map (cached after first load)
  const triggers = await getMapTriggers(session.mapId);

  // Check if path passes through a trigger cell — truncate there if so
  let effectivePath = path;
  let triggerAtEnd: { targetMapId: number; targetCellId: number } | null =
    null;

  for (let i = 1; i < path.length; i++) {
    const trigger = triggers.get(path[i]);
    if (trigger) {
      effectivePath = path.slice(0, i + 1);
      triggerAtEnd = trigger;
      log.debug(
        `Path passes through trigger at cell ${path[i]} (step ${i}/${path.length - 1}), truncating`,
      );
      break;
    }
  }

  const endCellId = effectivePath[effectivePath.length - 1];
  const direction = pf.getDirection(
    effectivePath[effectivePath.length - 2],
    endCellId,
  );

  // Update pathfinding occupancy
  pf.removeOccupied(session.cellId);
  pf.addOccupied(endCellId);

  // Update session state
  session.cellId = endCellId;
  session.direction = direction;

  // Update map instance
  const mapInstance = getMapInstance(session.mapId);
  if (mapInstance) {
    mapInstance.updateActorCell(session.characterId, endCellId, direction);

    // Broadcast ACTOR_MOVE (using the truncated path)
    const movePayload: ActorMovePayload = {
      id: session.characterId,
      path: effectivePath,
    };
    const msg = encodeServerMessage(
      ServerMessageType.ACTOR_MOVE,
      movePayload,
    );
    mapInstance.broadcast(msg, session);
    session.ws.send(msg);
  }

  // Persist to DB (fire and forget)
  updateCharacterPosition(
    session.characterId,
    session.mapId,
    endCellId,
    direction,
  );

  // Store pending transition — will fire when client sends CHARACTER_MOVE_END
  if (triggerAtEnd) {
    log.debug(
      `Pending trigger: cell ${endCellId} -> map ${triggerAtEnd.targetMapId} cell ${triggerAtEnd.targetCellId}`,
    );
    pendingTransitions.set(session.sessionId, {
      type: "trigger",
      targetMapId: triggerAtEnd.targetMapId,
      targetCellId: triggerAtEnd.targetCellId,
    });
    return;
  }

  // Check if this is an edge cell for directional map transition
  if (!session.mapId) return;
  const map = await getMap(session.mapId);
  if (!map) return;

  const transition = getEdgeTransitionDir(map, endCellId);
  if (transition) {
    const targetMap = await db
      .selectFrom("maps")
      .select(["id", "walkable_ids", "width", "height"])
      .where("x", "=", map.x + transition.dx)
      .where("y", "=", map.y + transition.dy)
      .where("superarea", "=", map.superarea)
      .executeTakeFirst();

    if (targetMap) {
      const spawnCellId = findOppositeEdgeCell(
        targetMap.width,
        targetMap.height,
        transition.dx,
        transition.dy,
        targetMap.walkable_ids,
      );
      log.debug(
        `Pending edge: cell ${endCellId} -> map ${targetMap.id} cell ${spawnCellId}`,
      );
      pendingTransitions.set(session.sessionId, {
        type: "edge",
        targetMapId: targetMap.id,
        targetCellId: spawnCellId,
      });
    }
  }
}

/**
 * Called when client reports it has finished walking the path.
 * Fires any pending trigger or edge transition.
 */
export async function handleMoveEnd(session: ClientSession): Promise<void> {
  const pending = pendingTransitions.get(session.sessionId);
  if (!pending) return;

  pendingTransitions.delete(session.sessionId);

  log.debug(
    `Move ended, executing ${pending.type} transition -> map ${pending.targetMapId} cell ${pending.targetCellId}`,
  );

  await changeMap(session, pending.targetMapId, pending.targetCellId);
}

/**
 * Clean up pending transitions for a session (on disconnect).
 */
export function clearPendingTransition(sessionId: string): void {
  pendingTransitions.delete(sessionId);
}

/**
 * Check if a cell is on the edge of the map and return the exit direction.
 */
function getEdgeTransitionDir(
  map: { width: number; height: number },
  cellId: number,
): { dx: number; dy: number } | null {
  const W = map.width;
  const H = map.height;
  const stride = 2 * W - 1;
  const totalRows = 2 * H - 1;

  const pair = Math.floor(cellId / stride);
  const offset = cellId % stride;
  const isLong = offset < W;
  const row = isLong ? 2 * pair : 2 * pair + 1;
  const col = isLong ? offset : offset - W;

  let dx = 0;
  let dy = 0;

  if (row <= 1) {
    dy = -1;
  } else if (row >= totalRows - 2) {
    dy = 1;
  }

  if (col === 0) {
    dx = -1;
  } else if ((isLong && col === W - 1) || (!isLong && col === W - 2)) {
    dx = 1;
  }

  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

function findOppositeEdgeCell(
  width: number,
  height: number,
  dx: number,
  dy: number,
  walkableIds: number[],
): number {
  const walkableSet = new Set(walkableIds);
  const stride = 2 * width - 1;
  const totalRows = 2 * height - 1;
  const totalCells = height * width + (height - 1) * (width - 1);

  function rowColToCell(row: number, col: number): number {
    const pair = Math.floor(row / 2);
    if (row % 2 === 0) return pair * stride + col;
    return pair * stride + width + col;
  }

  const candidates: number[] = [];

  if (dx === 1) {
    for (let r = 0; r < totalRows; r++) {
      const cellId = rowColToCell(r, 0);
      if (cellId < totalCells && walkableSet.has(cellId))
        candidates.push(cellId);
    }
  } else if (dx === -1) {
    for (let r = 0; r < totalRows; r++) {
      const maxCol = r % 2 === 0 ? width - 1 : width - 2;
      const cellId = rowColToCell(r, maxCol);
      if (cellId < totalCells && walkableSet.has(cellId))
        candidates.push(cellId);
    }
  }

  if (dy === 1) {
    for (let col = 0; col < width; col++) {
      const cellId = rowColToCell(0, col);
      if (cellId < totalCells && walkableSet.has(cellId))
        candidates.push(cellId);
    }
    for (let col = 0; col < width - 1; col++) {
      const cellId = rowColToCell(1, col);
      if (cellId < totalCells && walkableSet.has(cellId))
        candidates.push(cellId);
    }
  } else if (dy === -1) {
    const lastLongRow =
      (totalRows - 1) % 2 === 0 ? totalRows - 1 : totalRows - 2;
    const lastShortRow =
      (totalRows - 1) % 2 === 1 ? totalRows - 1 : totalRows - 2;
    for (let col = 0; col < width; col++) {
      const cellId = rowColToCell(lastLongRow, col);
      if (cellId < totalCells && walkableSet.has(cellId))
        candidates.push(cellId);
    }
    for (let col = 0; col < width - 1; col++) {
      const cellId = rowColToCell(lastShortRow, col);
      if (cellId < totalCells && walkableSet.has(cellId))
        candidates.push(cellId);
    }
  }

  if (candidates.length > 0) {
    return candidates[Math.floor(candidates.length / 2)];
  }

  return walkableIds[0] ?? 0;
}
