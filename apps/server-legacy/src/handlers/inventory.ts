import type {
  InventoryListPayload,
  InventoryWeightPayload,
  ItemAddPayload,
  ItemDestroyRequestPayload,
  ItemDropRequestPayload,
  ItemMovePayload,
  ItemMoveRequestPayload,
  ItemQuantityPayload,
  ItemRemovePayload,
  ItemUseRequestPayload,
} from "@dofus/protocol";
import { encodeServerMessage } from "../protocol/codec.ts";
import { ServerMessageType } from "../protocol/types.ts";
import type { ClientSession } from "../ws/client-session.ts";
import {
  addItemToInventory,
  buildLookString,
  calculateWeight,
  getCharacterItem,
  getCharacterItems,
  getItemTemplate,
  moveItem,
  removeItemQuantity,
  rowToInventoryItem,
} from "../game/inventory.ts";
import { getCharacterById } from "../game/character.ts";
import { getMapInstance } from "../game/game-manager.ts";
import { createLogger } from "../utils/logger.ts";

const log = createLogger("Inventory");

// ── Send full inventory ──

export async function sendInventoryList(session: ClientSession): Promise<void> {
  if (!session.characterId) return;

  const character = await getCharacterById(session.characterId);
  if (!character) return;

  const rows = await getCharacterItems(session.characterId);
  const items = await Promise.all(rows.map(rowToInventoryItem));
  const weight = await calculateWeight(session.characterId, character.strength ?? 0);

  const payload: InventoryListPayload = {
    items,
    kamas: character.kama ?? 0,
    weight,
  };

  session.ws.send(
    encodeServerMessage(ServerMessageType.INVENTORY_LIST, payload)
  );
}

// ── Send weight update ──

async function sendWeightUpdate(session: ClientSession): Promise<void> {
  if (!session.characterId) return;
  const character = await getCharacterById(session.characterId);
  if (!character) return;

  const weight = await calculateWeight(session.characterId, character.strength ?? 0);
  session.ws.send(
    encodeServerMessage(ServerMessageType.ITEM_WEIGHT, weight)
  );
}

// ── Broadcast look change to all players on the map ──

async function broadcastLookUpdate(session: ClientSession): Promise<void> {
  if (!session.characterId || session.mapId === null) return;

  const character = await getCharacterById(session.characterId);
  if (!character) return;

  const look = await buildLookString(
    character.gfx, character.color1, character.color2, character.color3, character.id
  );

  const mapInstance = getMapInstance(session.mapId);
  if (!mapInstance) return;

  // Update the actor's look in the map instance
  mapInstance.updateActorLook(session.characterId, look);

  // Broadcast ACTOR_UPDATE to all players on the map (including self)
  const msg = encodeServerMessage(ServerMessageType.ACTOR_UPDATE, {
    id: session.characterId,
    look,
  });
  mapInstance.broadcastToAll(msg);
}

// ── Item move (equip / unequip / reorder) ──

export async function handleItemMove(
  session: ClientSession,
  payload: ItemMoveRequestPayload
): Promise<void> {
  if (!session.characterId) return;

  const { uid, position } = payload;
  const success = await moveItem(uid, session.characterId, position);
  if (!success) return;

  const movePayload: ItemMovePayload = { uid, position };
  session.ws.send(
    encodeServerMessage(ServerMessageType.ITEM_MOVE, movePayload)
  );

  await sendWeightUpdate(session);

  // Broadcast look change if equipping/unequipping (position changed to/from equipped slot)
  await broadcastLookUpdate(session);
}

// ── Item use (consumable) ──

export async function handleItemUse(
  session: ClientSession,
  payload: ItemUseRequestPayload
): Promise<void> {
  if (!session.characterId) return;

  const item = await getCharacterItem(payload.uid, session.characterId);
  if (!item) return;

  const template = await getItemTemplate(item.template_id);
  if (!template?.usable) return;

  // TODO: apply item effects (heal, buff, etc.)

  const { removed, remaining } = await removeItemQuantity(
    payload.uid,
    session.characterId,
    1
  );

  if (removed) {
    const removePayload: ItemRemovePayload = { uid: payload.uid };
    session.ws.send(
      encodeServerMessage(ServerMessageType.ITEM_REMOVE, removePayload)
    );
  } else {
    const qtyPayload: ItemQuantityPayload = {
      uid: payload.uid,
      quantity: remaining,
    };
    session.ws.send(
      encodeServerMessage(ServerMessageType.ITEM_QUANTITY, qtyPayload)
    );
  }

  await sendWeightUpdate(session);
}

// ── Item drop ──

export async function handleItemDrop(
  session: ClientSession,
  payload: ItemDropRequestPayload
): Promise<void> {
  if (!session.characterId) return;

  const { uid, quantity } = payload;
  const { removed, remaining } = await removeItemQuantity(
    uid,
    session.characterId,
    quantity
  );

  if (removed) {
    const removePayload: ItemRemovePayload = { uid };
    session.ws.send(
      encodeServerMessage(ServerMessageType.ITEM_REMOVE, removePayload)
    );
  } else {
    const qtyPayload: ItemQuantityPayload = { uid, quantity: remaining };
    session.ws.send(
      encodeServerMessage(ServerMessageType.ITEM_QUANTITY, qtyPayload)
    );
  }

  // TODO: spawn item entity on ground

  await sendWeightUpdate(session);
}

// ── Item destroy ──

export async function handleItemDestroy(
  session: ClientSession,
  payload: ItemDestroyRequestPayload
): Promise<void> {
  if (!session.characterId) return;

  const { uid, quantity } = payload;
  const { removed, remaining } = await removeItemQuantity(
    uid,
    session.characterId,
    quantity
  );

  if (removed) {
    const removePayload: ItemRemovePayload = { uid };
    session.ws.send(
      encodeServerMessage(ServerMessageType.ITEM_REMOVE, removePayload)
    );
  } else {
    const qtyPayload: ItemQuantityPayload = { uid, quantity: remaining };
    session.ws.send(
      encodeServerMessage(ServerMessageType.ITEM_QUANTITY, qtyPayload)
    );
  }

  await sendWeightUpdate(session);
}

// ── Debug: give item ──

export async function handleDebugGiveItem(
  session: ClientSession,
  payload: { templateId: number; quantity: number }
): Promise<void> {
  if (!session.characterId) return;

  const template = await getItemTemplate(payload.templateId);
  if (!template) {
    log.warn(`DEBUG give item: template ${payload.templateId} not found`);
    return;
  }

  const quantity = Math.max(1, Math.min(payload.quantity ?? 1, 9999));
  const effects = parseDefaultEffects(template.effects);

  const item = await addItemToInventory(
    session.characterId,
    payload.templateId,
    quantity,
    effects
  );

  const addPayload: ItemAddPayload = { items: [item] };
  session.ws.send(
    encodeServerMessage(ServerMessageType.ITEM_ADD, addPayload)
  );

  await sendWeightUpdate(session);
  log.info(
    `DEBUG: gave ${quantity}x template ${payload.templateId} to character ${session.characterId}`
  );
}

/** Roll default effects from template (for now, use min values) */
function parseDefaultEffects(raw: string | unknown[]): import("@dofus/protocol").ItemEffect[] {
  let effects: import("@dofus/protocol").ItemEffect[];
  if (typeof raw === "string") {
    try {
      effects = JSON.parse(raw);
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    effects = raw as import("@dofus/protocol").ItemEffect[];
  } else {
    return [];
  }

  // Roll random values between min and max
  return effects.map((e) => ({
    id: e.id,
    min: e.max > e.min ? e.min + Math.floor(Math.random() * (e.max - e.min + 1)) : e.min,
    max: 0, // Instance effects store the rolled value in min, max=0
    ...(e.param3 != null ? { param3: e.param3 } : {}),
    ...(e.text != null ? { text: e.text } : {}),
  }));
}
