import { useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { ItemData } from "@/game/network/protocol";
import {
  characterStore,
  getBagItems,
  getEquippedItems,
  inventoryStore,
} from "@/game/stores";

import { Panel } from "../components/Panel";
import { BagPanel } from "./BagPanel";
import { EquipmentPanel } from "./EquipmentPanel";
import { ItemDetailPanel } from "./ItemDetailPanel";
import { WINDOW_METRICS } from "./inventory-theme";

interface InventoryWindowProps {
  onClose: () => void;
  zoom?: number;
  gameClient: GameClient | null;
}

/**
 * "Ton inventaire" — one window, reproducing the reference capture's
 * single-Panel-with-three-nested-boxes layout: the paperdoll (top-left),
 * the item detail card (bottom-left, below it), and the "Ressources" bag
 * browser (full-height, right). See `inventory-theme.ts` for how those
 * three boxes' positions were measured.
 *
 * All three read the same `inventoryStore` snapshot; only the selected
 * item is local state, since nothing server-side needs to know what a
 * player is looking at.
 */
export function InventoryWindow({
  onClose,
  zoom = 1,
  gameClient,
}: InventoryWindowProps) {
  const { items, templates, weight } = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot
  );
  const { kamas } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  const [selectedUnicId, setSelectedUnicId] = useState<number | null>(null);

  const bagItems = getBagItems({ items, templates, weight });
  const equippedByPosition = new Map(
    getEquippedItems({ items, templates, weight }).map((item) => [
      item.position,
      item,
    ])
  );

  const selected =
    selectedUnicId !== null ? (items.get(selectedUnicId) ?? null) : null;
  const selectedTemplate = selected
    ? (templates.get(selected.itemId) ?? null)
    : null;

  const select = (item: ItemData) => {
    setSelectedUnicId((current) =>
      current === item.unicId ? null : item.unicId
    );
  };

  const equip = (item: ItemData) => {
    const template = templates.get(item.itemId);
    const position = template?.positions[0];
    if (position === undefined) {
      return;
    }
    gameClient?.moveItem(item.unicId, position);
  };

  const unequip = (item: ItemData) => {
    gameClient?.moveItem(item.unicId, -1);
  };

  const consume = (item: ItemData) => {
    // biome-ignore lint/correctness/useHookAtTopLevel: GameClient.useItem is a plain method, not a hook — biome pattern-matches the name.
    gameClient?.useItem(item.unicId);
  };

  return (
    <Panel
      title="Ton inventaire"
      width={WINDOW_METRICS.width}
      height={WINDOW_METRICS.height}
      zoom={zoom}
      onClose={onClose}
    >
      {/* Fills whatever `Panel` leaves below its title bar. Sizing this in
          base units instead (`height - 22`) overshot by the 3-unit border
          `Panel` draws inside its own box-sized height, which was enough to
          arm `.dofus-panel__content`'s `overflow-y: auto` and put a scroll
          bar down the whole window. The three boxes below are positioned
          absolutely and all end before unit 401, so they fit. */}
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <EquipmentPanel
          zoom={zoom}
          equipped={equippedByPosition}
          templates={templates}
          kamas={kamas}
          weight={weight}
          selectedUnicId={selectedUnicId}
          onSelect={select}
          onUnequip={unequip}
        />
        <ItemDetailPanel
          zoom={zoom}
          item={selected}
          template={selectedTemplate}
        />
        <BagPanel
          zoom={zoom}
          bagItems={bagItems}
          templates={templates}
          selectedUnicId={selectedUnicId}
          onSelect={select}
          onEquip={equip}
          onUse={consume}
        />
      </div>
    </Panel>
  );
}
