import type { CharactersTable } from "../db/schema.ts";
import { db } from "../db/database.ts";

export type Character = CharactersTable & { id: number };

export async function getCharactersByAccountId(
  accountId: number
): Promise<Character[]> {
  return db
    .selectFrom("characters")
    .selectAll()
    .where("account_id", "=", accountId)
    .execute() as Promise<Character[]>;
}

export async function getCharacterById(
  id: number
): Promise<Character | undefined> {
  return db
    .selectFrom("characters")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst() as Promise<Character | undefined>;
}

export async function updateCharacterPosition(
  id: number,
  mapId: number,
  cellId: number,
  direction: number
): Promise<void> {
  await db
    .updateTable("characters")
    .set({ map_id: mapId, cell_id: cellId, direction })
    .where("id", "=", id)
    .execute();
}
