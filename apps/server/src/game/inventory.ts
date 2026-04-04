import type { ItemEffect, InventoryItem, InventoryWeightPayload } from "@dofus/protocol";
import { db } from "../db/database.ts";
import type { CharacterItemsTable, ItemTemplatesTable } from "../db/schema.ts";
import { createLogger } from "../utils/logger.ts";

const log = createLogger("Inventory");

// ── Item template cache (static data, loaded once) ──

const templateCache = new Map<number, ItemTemplatesTable>();

export async function getItemTemplate(
  id: number
): Promise<ItemTemplatesTable | undefined> {
  if (templateCache.has(id)) return templateCache.get(id);
  const row = await db
    .selectFrom("item_templates")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (row) templateCache.set(id, row);
  return row;
}

export async function preloadTemplates(): Promise<void> {
  const rows = await db.selectFrom("item_templates").selectAll().execute();
  for (const row of rows) {
    templateCache.set(row.id, row);
  }
  log.info(`Preloaded ${rows.length} item templates`);
}

// ── Character inventory queries ──

type CharacterItemRow = CharacterItemsTable & { id: number };

export async function getCharacterItems(
  characterId: number
): Promise<CharacterItemRow[]> {
  return db
    .selectFrom("character_items")
    .selectAll()
    .where("character_id", "=", characterId)
    .execute() as Promise<CharacterItemRow[]>;
}

export async function getCharacterItem(
  itemUid: number,
  characterId: number
): Promise<CharacterItemRow | undefined> {
  return db
    .selectFrom("character_items")
    .selectAll()
    .where("id", "=", itemUid)
    .where("character_id", "=", characterId)
    .executeTakeFirst() as Promise<CharacterItemRow | undefined>;
}

function parseEffects(raw: string | ItemEffect[]): ItemEffect[] {
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Convert a DB row to a protocol InventoryItem (enriched with template data) */
export async function rowToInventoryItem(row: CharacterItemRow): Promise<InventoryItem> {
  const template = await getItemTemplate(row.template_id);
  return {
    uid: row.id,
    templateId: row.template_id,
    quantity: row.quantity,
    position: row.position,
    effects: parseEffects(row.effects),
    type: template?.type ?? 0,
    gfxId: template?.gfx_id ?? 0,
    name: template?.name ?? "",
  };
}

// ── Add item to inventory ──

export async function addItemToInventory(
  characterId: number,
  templateId: number,
  quantity: number,
  effects: ItemEffect[],
  position = -1
): Promise<InventoryItem> {
  const template = await getItemTemplate(templateId);

  // Try to stack with existing item (same template, same position, same effects, stackable)
  if (template?.stackable && position === -1) {
    const existing = await db
      .selectFrom("character_items")
      .selectAll()
      .where("character_id", "=", characterId)
      .where("template_id", "=", templateId)
      .where("position", "=", -1)
      .execute();

    for (const row of existing) {
      const rowEffects = parseEffects(row.effects);
      if (effectsEqual(rowEffects, effects)) {
        // Stack onto existing
        const newQty = row.quantity + quantity;
        await db
          .updateTable("character_items")
          .set({ quantity: newQty })
          .where("id", "=", (row as CharacterItemRow).id)
          .execute();
        return {
          uid: (row as CharacterItemRow).id,
          templateId: row.template_id,
          quantity: newQty,
          position: row.position,
          effects: rowEffects,
          type: template?.type ?? 0,
          gfxId: template?.gfx_id ?? 0,
          name: template?.name ?? "",
        };
      }
    }
  }

  // Insert new item row
  const result = await db
    .insertInto("character_items")
    .values({
      character_id: characterId,
      template_id: templateId,
      quantity,
      position,
      effects: JSON.stringify(effects),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return {
    uid: result.id,
    templateId,
    quantity,
    position,
    effects,
    type: template?.type ?? 0,
    gfxId: template?.gfx_id ?? 0,
    name: template?.name ?? "",
  };
}

// ── Remove item / reduce quantity ──

export async function removeItemQuantity(
  itemUid: number,
  characterId: number,
  quantity: number
): Promise<{ removed: boolean; remaining: number }> {
  const item = await getCharacterItem(itemUid, characterId);
  if (!item) return { removed: false, remaining: 0 };

  if (item.quantity <= quantity) {
    await db
      .deleteFrom("character_items")
      .where("id", "=", itemUid)
      .where("character_id", "=", characterId)
      .execute();
    return { removed: true, remaining: 0 };
  }

  const remaining = item.quantity - quantity;
  await db
    .updateTable("character_items")
    .set({ quantity: remaining })
    .where("id", "=", itemUid)
    .execute();
  return { removed: false, remaining };
}

// ── Move / equip / unequip ──

export async function moveItem(
  itemUid: number,
  characterId: number,
  newPosition: number
): Promise<boolean> {
  const item = await getCharacterItem(itemUid, characterId);
  if (!item) return false;

  // If equipping (position >= 0), check if slot is already occupied
  if (newPosition >= 0) {
    const occupying = await db
      .selectFrom("character_items")
      .selectAll()
      .where("character_id", "=", characterId)
      .where("position", "=", newPosition)
      .executeTakeFirst();

    if (occupying) {
      // Unequip the current item in that slot → move to bag
      await db
        .updateTable("character_items")
        .set({ position: -1 })
        .where("id", "=", (occupying as CharacterItemRow).id)
        .execute();
    }
  }

  await db
    .updateTable("character_items")
    .set({ position: newPosition })
    .where("id", "=", itemUid)
    .where("character_id", "=", characterId)
    .execute();

  return true;
}

// ── Weight calculation ──

const BASE_PODS = 1000;
const PODS_PER_STRENGTH = 5;

export async function calculateWeight(
  characterId: number,
  characterStrength: number
): Promise<InventoryWeightPayload> {
  const items = await getCharacterItems(characterId);
  let current = 0;

  for (const item of items) {
    const template = await getItemTemplate(item.template_id);
    if (template) {
      current += template.weight * item.quantity;
    }
  }

  const max = BASE_PODS + characterStrength * PODS_PER_STRENGTH;
  return { current, max };
}

// ── Accessories / look string ──

/**
 * Accessory slots visible on the character sprite.
 * Order matches original Dofus: weapon, hat, cape, pet, shield.
 * Each maps to an EquipmentPosition value.
 */
const ACCESSORY_SLOTS = [1, 6, 7, 8, 15]; // weapon, hat, cape, pet, shield

/**
 * Get linked child sprites for a character (ghouls, companions, special event followers).
 * Standard pets (type 18) are rendered as accessories on the character, NOT as linked children.
 * Linked children are separate sprites that follow the player with their own pathfinding.
 */
export async function getLinkedChildren(_characterId: number): Promise<Array<{ gfxId: number; childIndex: number }> | undefined> {
  // Standard pets (type 18) are handled via the accessory system (slot 3 in look string).
  // Linked children are only used for special following sprites (ghouls, companions, etc.)
  // which would be stored differently (e.g., a separate "followers" table or quest state).
  // For now, return undefined — implement when special follower system is needed.
  return undefined;
}

/**
 * Build the accessories portion of the look string from equipped items.
 * Returns comma-separated "type_gfxId" entries (one per slot, empty string if no item).
 */
export async function buildAccessoriesString(characterId: number): Promise<string> {
  const items = await getCharacterItems(characterId);
  const parts: string[] = [];

  for (const position of ACCESSORY_SLOTS) {
    const equipped = items.find((i) => i.position === position);
    if (equipped) {
      const template = await getItemTemplate(equipped.template_id);
      if (template) {
        parts.push(`${template.type}_${template.gfx_id}`);
        continue;
      }
    }
    parts.push("");
  }

  return parts.join(",");
}

/**
 * Build the full look string for a character including accessories.
 * Format: "gfx|color1|color2|color3|acc1,acc2,acc3,acc4,acc5"
 */
export async function buildLookString(
  gfx: number,
  color1: number,
  color2: number,
  color3: number,
  characterId: number
): Promise<string> {
  const accessories = await buildAccessoriesString(characterId);
  const base = `${gfx}|${color1}|${color2}|${color3}`;
  const result = accessories ? `${base}|${accessories}` : base;
  log.info(`buildLookString(char=${characterId}): ${result}`);
  return result;
}

// ── Helpers ──

function effectsEqual(a: ItemEffect[], b: ItemEffect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].min !== b[i].min || a[i].max !== b[i].max) {
      return false;
    }
  }
  return true;
}
