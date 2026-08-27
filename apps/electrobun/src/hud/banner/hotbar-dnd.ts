import type { DragEvent } from "react";

import type { HotbarTab } from "@/game/stores/shortcuts-store";
import { hudStore } from "@/game/stores/hud-store";

/**
 * The MIME type the hotbar drags under. A private type rather than
 * `text/plain` so a stray text drop from another app can never be read
 * as a shortcut payload.
 */
const HOTBAR_MIME = "application/x-dofus-hotbar";

/** A spell being dragged — from the spell book, or from the bar itself. */
interface SpellDrag {
  kind: "spell";
  spellId: number;
  /** Set when the drag started in the bar, so a drop can vacate it. */
  fromSlot?: number;
}

/** A stack dragged out of the inventory, to be pinned as a shortcut. */
interface ItemDrag {
  kind: "item";
  unicId: number;
}

/** An item shortcut being dragged from one slot to another. */
interface ShortcutDrag {
  kind: "shortcut";
  fromSlot: number;
}

export type HotbarDragPayload = SpellDrag | ItemDrag | ShortcutDrag;

/**
 * 1.29 only allows dragging into or out of the bar while the matching
 * panel is open, or with Shift held — `MouseShortcuts.drag` and
 * `.drop` both bail on `getUIComponent(...) == undefined && !Key.isDown(SHIFT)`.
 * Without the rule, dragging the bar around while walking would be far
 * too easy to do by accident.
 */
export function hotbarDragAllowed(tab: HotbarTab, shiftKey: boolean): boolean {
  if (shiftKey) {
    return true;
  }

  const { activePanel } = hudStore.getSnapshot();
  return activePanel === (tab === "spells" ? "spells" : "inventory");
}

function readPayload(e: DragEvent): HotbarDragPayload | undefined {
  const raw = e.dataTransfer.getData(HOTBAR_MIME);

  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as HotbarDragPayload;
  } catch {
    return undefined;
  }
}

/**
 * Marks the element a drag source should drag the *picture* of.
 *
 * Put it on the icon of a source whose clickable area is larger than
 * its icon — the spell book's rows are full-width strips with a name, a
 * level and a `+` button, and dragging the strip drags all of it. What
 * lands in a hotbar slot is the icon, so the icon is what should follow
 * the cursor. Sources that are already icon-shaped (the bag's cells,
 * the bar's own cells) need no marker.
 */
export const HOTBAR_DRAG_IMAGE_ATTR = "data-hotbar-drag-image";

/**
 * Props for a drag *source*: the spell book's cells, the inventory's
 * cells, and the bar's own cells.
 *
 * `onDropNowhere` fires when the drag ends outside any drop target —
 * how a shortcut is removed by flinging it off the bar.
 */
export function hotbarDragProps(
  payload: HotbarDragPayload,
  onDropNowhere?: () => void
) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(HOTBAR_MIME, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";

      const icon = e.currentTarget.querySelector(`[${HOTBAR_DRAG_IMAGE_ATTR}]`);

      if (icon instanceof HTMLElement) {
        // Grabbed by the middle, so the icon sits under the cursor and
        // the drop lands on the slot being pointed at.
        e.dataTransfer.setDragImage(
          icon,
          icon.offsetWidth / 2,
          icon.offsetHeight / 2
        );
      }
    },
    onDragEnd: (e: DragEvent) => {
      // "none" means no target accepted the drop — the pointer was
      // released over the map, a panel, or off-window.
      if (e.dataTransfer.dropEffect === "none") {
        onDropNowhere?.();
      }
    },
  };
}

/** Props for a drop *target* — every cell of the bar. */
export function hotbarDropProps(onDrop: (payload: HotbarDragPayload) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      // The payload itself is unreadable during dragover (browsers only
      // expose `types` until drop), so the MIME is the whole test.
      if (!e.dataTransfer.types.includes(HOTBAR_MIME)) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    onDrop: (e: DragEvent) => {
      const payload = readPayload(e);

      if (!payload) {
        return;
      }

      e.preventDefault();
      onDrop(payload);
    },
  };
}
