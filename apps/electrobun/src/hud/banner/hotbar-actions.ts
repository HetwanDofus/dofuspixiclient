import type { GameClient } from "@/game/game-client";
import type { HotbarDragPayload } from "@/hud/banner/hotbar-dnd";
import { inventoryStore } from "@/game/stores/inventory-store";
import {
  resolveShortcut,
  shortcutsStore,
  slotAt,
} from "@/game/stores/shortcuts-store";
import { UNSLOTTED_POSITION } from "@/game/stores/spells-store";

/**
 * What a hotbar cell *does* — the one implementation the cells, the
 * keyboard shortcuts and the context menu all go through, so a slot can
 * never behave one way under the mouse and another under its key.
 *
 * Modelled on `MouseShortcuts.click` / `.dblClick` / `.drop`.
 */

/**
 * Activate the slot at `index` (0..13) of the current page.
 *
 * In "spells" mode this is deliberately inert outside a fight: 1.29
 * refuses to cast from the map, and `checkCanLaunchSpellReturnObject`
 * returns `NOT_IN_FIGHT`. In-fight casting is driven by the banner's
 * own cell handler, which has the fight state; routing it through here
 * as well would give one action two owners.
 */
export function activateSlot(client: GameClient | null, index: number): void {
  const { tab, page, items } = shortcutsStore.getSnapshot();

  if (tab !== "items") {
    return;
  }

  const slot = slotAt(page, index);

  if (!items.has(slot)) {
    return;
  }

  triggerSlot(client, slot);
}

/**
 * Use (or equip) whatever the slot resolves to.
 *
 * A usable item is consumed; anything else is treated as gear and sent
 * to its equipment slot, which is what `MouseShortcuts.dblClick` does
 * with `equipItem` when `canUse` is false. An already-equipped item is
 * taken off — the same double-click toggles it back.
 */
export function triggerSlot(client: GameClient | null, slot: number): void {
  if (!client) {
    return;
  }

  const resolved = resolveShortcut(
    shortcutsStore.getSnapshot(),
    inventoryStore.getSnapshot(),
    slot
  );

  if (!resolved?.item) {
    return;
  }

  const { item, template } = resolved;

  if (item.position >= 0) {
    client.moveItem(item.unicId, -1);
    return;
  }

  if (template?.usable) {
    // biome-ignore lint/correctness/useHookAtTopLevel: GameClient.useItem is a plain method, not a hook — biome pattern-matches the name.
    client.useItem(item.unicId);
    return;
  }

  const position = template?.positions[0];

  if (position !== undefined) {
    client.moveItem(item.unicId, position);
  }
}

/**
 * Apply a drop onto `slot`. Every branch is a *request* — the bar only
 * redraws once the server's OrA/OrM/SM frame comes back, so a refused
 * drag leaves no phantom icon behind.
 */
export function dropOnSlot(
  client: GameClient | null,
  slot: number,
  payload: HotbarDragPayload
): void {
  if (!client) {
    return;
  }

  switch (payload.kind) {
    case "spell":
      if (payload.fromSlot === slot) {
        return;
      }
      client.moveSpellToSlot(payload.spellId, slot);
      return;

    case "item":
      client.addItemShortcut(slot, payload.unicId);
      return;

    case "shortcut":
      if (payload.fromSlot === slot) {
        return;
      }
      client.moveItemShortcut(payload.fromSlot, slot);
      return;

    default:
      return;
  }
}

/** A cell dragged off the bar and released over nothing — remove it. */
export function removeFromSlot(
  client: GameClient | null,
  payload: HotbarDragPayload
): void {
  if (!client) {
    return;
  }

  if (payload.kind === "spell" && payload.fromSlot !== undefined) {
    client.moveSpellToSlot(payload.spellId, UNSLOTTED_POSITION);
    return;
  }

  if (payload.kind === "shortcut") {
    client.removeItemShortcut(payload.fromSlot);
  }
}
