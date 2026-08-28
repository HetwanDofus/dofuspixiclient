import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import { hotbarDragProps } from "@/hud/banner/hotbar-dnd";

import { ItemGrid } from "./ItemGrid";
import { RESOURCES_BOX } from "./inventory-theme";

interface BagPanelProps {
  zoom: number;
  bagItems: ItemData[];
  templates: Map<number, ItemTemplateData>;
  selectedUnicId: number | null;
  onSelect: (item: ItemData) => void;
  onEquip: (item: ItemData) => void;
  onUse: (item: ItemData) => void;
}

/**
 * "Ressources" — the bag half of the inventory window.
 *
 * The browser itself is `ItemGrid`, which the bank reuses. What is left
 * here is what makes this grid *the bag*: where it sits, what it is
 * called, that its verbs are equip and use, and that it is the drag
 * source for the hotbar's "Obj." tab.
 */
export function BagPanel({
  zoom,
  bagItems,
  templates,
  selectedUnicId,
  onSelect,
  onEquip,
  onUse,
}: BagPanelProps) {
  return (
    <ItemGrid
      zoom={zoom}
      title="Ressources"
      box={RESOURCES_BOX}
      items={bagItems}
      templates={templates}
      selectedUnicId={selectedUnicId}
      onSelect={onSelect}
      // Order is priority: a double-click equips what can be worn and
      // drinks what cannot.
      actions={[
        {
          label: "Équiper",
          enabled: (_item, template) => !!template?.positions.length,
          run: onEquip,
        },
        {
          label: "Utiliser",
          enabled: (_item, template) => !!template?.usable,
          run: onUse,
        },
      ]}
      // The unic id goes on the wire; the server turns it into a template
      // so the shortcut outlives this particular stack.
      cellExtraProps={(item) =>
        hotbarDragProps({ kind: "item", unicId: item.unicId })
      }
    />
  );
}
