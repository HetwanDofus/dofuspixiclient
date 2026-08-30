/**
 * Where a brand new character wakes up.
 *
 * The schema's default `cell_id = 319` is not walkable on the default map
 * 10300, and a character standing on a blocked tile cannot be pathed off
 * it — so a spawn cell has to be read out of the map rather than assumed.
 * `maps.cells` is the StarLoco HASH_CELL payload; decode it and take the
 * walkable cell closest to the middle of the diamond.
 *
 * Nearest-to-centre rather than first-walkable on purpose: cell ids start
 * at the top corner, which is usually off the top of the viewport, so the
 * naive pick makes the character look missing.
 */
import type { DB } from "@shared/db/schema";
import type { Kysely } from "kysely";
import { decodeCells } from "@modules/maps/maps.cells-codec";

export async function findSpawnCell(
  db: Kysely<DB>,
  mapId: number
): Promise<number | null> {
  const map = await db
    .selectFrom("maps")
    .select(["cells", "width", "height"])
    .where("id", "=", mapId)
    .executeTakeFirst();

  if (!map?.cells) {
    return null;
  }

  const cells = decodeCells(
    map.cells instanceof Uint8Array ? map.cells : new Uint8Array(map.cells)
  );

  // Consecutive ids alternate between the two interleaved rows of the
  // isometric grid — see `packages/grid`. `stride` is one full pair of rows.
  const stride = 2 * map.width - 1;
  const centreRow = map.height - 1;
  const centreCol = Math.floor(map.width / 2);

  let best: { id: number; distance: number } | null = null;

  for (const cell of cells) {
    if (!cell.active || !cell.walkable) {
      continue;
    }

    const pair = Math.floor(cell.id / stride);
    const offset = cell.id % stride;
    const row = offset < map.width ? pair * 2 : pair * 2 + 1;
    const col = offset < map.width ? offset : offset - map.width;
    const distance = Math.abs(row - centreRow) + Math.abs(col - centreCol);

    if (!best || distance < best.distance) {
      best = { id: cell.id, distance };
    }
  }

  return best?.id ?? null;
}
