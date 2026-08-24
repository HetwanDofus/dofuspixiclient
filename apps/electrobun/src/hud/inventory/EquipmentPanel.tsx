import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import type { InventoryWeight } from "@/game/stores/inventory-store";
import { showContextMenu } from "@/game/stores/context-menu-store";

import { useTooltip } from "../components/Tooltip";
import { ItemIcon } from "./ItemIcon";
import {
  EQUIP_BOX,
  EQUIP_FOOTER,
  EQUIP_SLOT_BOXES,
  INVENTORY_COLORS,
} from "./inventory-theme";

const C = INVENTORY_COLORS;
const ASSET_BASE = "/themes/classic/assets/panels/inventory";
const MOUNT_POSITION = 16;

interface EquipmentPanelProps {
  zoom: number;
  equipped: Map<number, ItemData>; // keyed by EquipmentPosition
  templates: Map<number, ItemTemplateData>;
  kamas: number;
  weight: InventoryWeight;
  selectedUnicId: number | null;
  onSelect: (item: ItemData) => void;
  onUnequip: (item: ItemData) => void;
}

/**
 * The paperdoll: 16 equipment slots on the reference's dark rounded box,
 * plus the kamas balance and pods gauge beneath it. Positions come from
 * `EQUIP_SLOT_BOXES`, keyed by `EquipmentPosition` so a slot maps
 * directly to `ItemData.position` with no name lookup in between.
 */
export function EquipmentPanel({
  zoom,
  equipped,
  templates,
  kamas,
  weight,
  selectedUnicId,
  onSelect,
  onUnequip,
}: EquipmentPanelProps) {
  const p = (n: number) => Math.round(n * zoom);
  const podsPct =
    weight.max > 0 ? Math.min(100, (weight.current / weight.max) * 100) : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: p(EQUIP_BOX.x),
        top: p(EQUIP_BOX.y),
        width: p(EQUIP_BOX.width),
        height: p(EQUIP_BOX.height),
        background: C.boxBg,
        borderRadius: p(10),
        overflow: "hidden",
      }}
    >
      {/* Character silhouette watermark, behind every slot — retail draws
          it centered in the paperdoll frame, head near the amulet slot,
          hands roughly on the ring slots. The SVG already carries its own
          50% fill-opacity. */}
      <img
        src={`${ASSET_BASE}/character-silhouette.svg`}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          left: p(78),
          top: p(10),
          width: p(163),
          height: p(174),
          pointerEvents: "none",
        }}
      />

      {Object.entries(EQUIP_SLOT_BOXES).map(([posStr, box]) => {
        const position = Number(posStr);
        const item = equipped.get(position);
        const template = item ? templates.get(item.itemId) : undefined;

        return (
          <EquipSlot
            key={position}
            zoom={zoom}
            box={box}
            position={position}
            item={item}
            template={template}
            selected={item?.unicId === selectedUnicId}
            onSelect={onSelect}
            onUnequip={onUnequip}
          />
        );
      })}

      <img
        src={`${ASSET_BASE}/kamas.svg`}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          left: p(EQUIP_FOOTER.kamasIcon.x),
          top: p(EQUIP_FOOTER.kamasIcon.y),
          width: p(EQUIP_FOOTER.kamasIcon.width),
          height: p(EQUIP_FOOTER.kamasIcon.height),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: p(EQUIP_FOOTER.kamasTextCenter.x),
          top: p(EQUIP_FOOTER.kamasTextCenter.y - 6),
          transform: "translateX(-50%)",
          color: C.kamasText,
          fontSize: p(10),
          fontWeight: "bold",
          fontFamily: "Verdana, sans-serif",
          whiteSpace: "nowrap",
        }}
      >
        {kamas.toLocaleString("fr-FR")}
      </div>

      <div
        style={{
          position: "absolute",
          left: p(EQUIP_FOOTER.podsLabel.x),
          top: p(EQUIP_FOOTER.podsLabel.y - 10),
          transform: "translateX(-50%)",
          color: "#ffffff",
          fontSize: p(9),
          fontWeight: "bold",
          fontFamily: "Verdana, sans-serif",
        }}
      >
        Pods
      </div>
      <div
        title={`${weight.current} / ${weight.max}`}
        style={{
          position: "absolute",
          left: p(EQUIP_FOOTER.podsBar.x),
          top: p(EQUIP_FOOTER.podsBar.y),
          width: p(EQUIP_FOOTER.podsBar.width),
          height: p(EQUIP_FOOTER.podsBar.height),
          background: C.podsTrack,
          borderRadius: p(EQUIP_FOOTER.podsBar.height / 2),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${podsPct}%`,
            background: C.podsFill,
          }}
        />
      </div>
    </div>
  );
}

function EquipSlot({
  zoom,
  box,
  position,
  item,
  template,
  selected,
  onSelect,
  onUnequip,
}: {
  zoom: number;
  box: { x: number; y: number; w: number; h: number };
  position: number;
  item: ItemData | undefined;
  template: ItemTemplateData | undefined;
  selected: boolean;
  onSelect: (item: ItemData) => void;
  onUnequip: (item: ItemData) => void;
}) {
  const p = (n: number) => Math.round(n * zoom);
  const tooltip = useTooltip();
  const highlighted = selected;

  return (
    <button
      type="button"
      onClick={() => item && onSelect(item)}
      onDoubleClick={() => item && onUnequip(item)}
      onContextMenu={(e) => {
        if (!item) {
          return;
        }
        e.preventDefault();
        showContextMenu(
          template?.name ?? "Objet",
          [{ label: "Déséquiper", onClick: () => onUnequip(item) }],
          e.clientX,
          e.clientY
        );
      }}
      onMouseEnter={(e) => {
        if (template) {
          tooltip.show(
            `${template.name}${template.level ? ` (Niv.${template.level})` : ""}`,
            e.clientX,
            e.clientY
          );
        }
      }}
      onMouseLeave={tooltip.hide}
      style={{
        position: "absolute",
        left: p(box.x),
        top: p(box.y),
        width: p(box.w),
        height: p(box.h),
        border: "none",
        padding: 0,
        // `equip-slot-fill.svg` — the retail case, drawn under every slot,
        // filled or not (there is no separate "empty" treatment in 1.29).
        backgroundImage: `url("${ASSET_BASE}/equip-slot-fill.svg")`,
        backgroundSize: "100% 100%",
        cursor: item ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {item && template && (
        <ItemIcon
          typeId={template.typeId}
          gfxId={template.gfxId}
          size={Math.min(p(box.w), p(box.h)) - p(4)}
          alt={template.name}
        />
      )}
      {!item && position === MOUNT_POSITION && <MountSlotCross zoom={zoom} />}
      {highlighted && (
        <img
          src={`${ASSET_BASE}/equip-slot-highlight.svg`}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      )}
    </button>
  );
}

/**
 * The empty mount slot in the reference capture shows a large grey X, not
 * the dragodinde icon `mount-icon.svg` is (that's used for the mount-park
 * UI, not this cross) — drawn inline since no extracted asset matches it.
 */
function MountSlotCross({ zoom }: { zoom: number }) {
  const p = (n: number) => Math.round(n * zoom);
  const size = p(18);
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M2 2 L16 16 M16 2 L2 16"
        stroke="#8a8577"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
