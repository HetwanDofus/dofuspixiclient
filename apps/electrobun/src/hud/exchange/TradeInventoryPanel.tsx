import type { ReactNode } from "react";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import type { InventoryWeight } from "@/game/stores/inventory-store";

import { Panel } from "../components/Panel";
import {
  ItemGrid,
  type ItemGridAction,
  type ItemGridMetrics,
} from "../inventory/ItemGrid";
import {
  FILTER_CATEGORIES,
  INVENTORY_COLORS,
} from "../inventory/inventory-theme";
import { TypeSelect } from "../inventory/TypeSelect";
import { useItemFilters } from "../inventory/use-item-filters";
import {
  TRADE_FILTER_IDS,
  TRADE_INVENTORY_METRICS,
  TRADE_INVENTORY_PANEL,
  TRADE_PAD,
} from "./trade-theme";

const C = INVENTORY_COLORS;
const ASSET_BASE = "/themes/classic/assets/panels/inventory";
const HEADER = { rowHeight: 18, filterSize: 22, podsBarWidth: 100 } as const;

interface TradeInventoryPanelProps {
  zoom: number;
  /** The window's title in retail is the player's own character name. */
  characterName: string;
  /**
   * Extra height and a strip under the grid.
   *
   * The auction house reuses this window verbatim — same header, same
   * grid, same filtering — and adds one checkbox to it ("Filtrer pour cet
   * HDV"). Two props are cheaper than a second copy of a 200-line panel
   * that would then drift from this one.
   */
  height?: number;
  footer?: ReactNode;
  /**
   * What the header reads when no category button is pressed — that is,
   * when the grid is showing everything. The trade says "Inventaire";
   * the auction house says so explicitly, because there the grid is
   * *also* narrowed by "Filtrer pour cet HDV" and the player needs to
   * see that no second filter is hiding anything.
   */
  allCategoriesLabel?: string;
  /**
   * Grid geometry. The auction house gives its bag one more visible row
   * than the trade does, because its window is taller.
   */
  metrics?: ItemGridMetrics;
  /** All four borders — see `Panel`. The auction house floats; the trade
   * window sits on the banner and does not. */
  floating?: boolean;
  items: ItemData[];
  templates: Map<number, ItemTemplateData>;
  kamas: number;
  weight: InventoryWeight;
  selectedUnicId: number | null;
  onSelect: (item: ItemData) => void;
  actions: ItemGridAction[];
  onClose: () => void;
}

/**
 * The bag browser of an open trade — retail's top-right window.
 *
 * Its header is the reason this is not just an `ItemGrid`: 1.29 lays the
 * category label, the type dropdown, three filter buttons, the pods gauge
 * and the kamas balance out in two horizontal rows, where the inventory
 * window stacks them. The filtering itself is the same, so it comes from
 * the shared `useItemFilters`; only the markup differs, and the grid below
 * is fed the already-filtered list with its own filters turned off.
 */
export function TradeInventoryPanel({
  zoom,
  characterName,
  height = TRADE_INVENTORY_PANEL.height,
  footer,
  allCategoriesLabel = "Inventaire",
  metrics = TRADE_INVENTORY_METRICS,
  floating = false,
  items,
  templates,
  kamas,
  weight,
  selectedUnicId,
  onSelect,
  actions,
  onClose,
}: TradeInventoryPanelProps) {
  const p = (n: number) => Math.round(n * zoom);
  const filters = useItemFilters(items, templates);

  const categories = TRADE_FILTER_IDS.map((id) =>
    FILTER_CATEGORIES.find((c) => c.id === id)
  ).filter((c): c is (typeof FILTER_CATEGORIES)[number] => !!c);

  const activeLabel =
    FILTER_CATEGORIES.find((c) => c.id === filters.categoryId)?.label ??
    allCategoriesLabel;

  const podsPct =
    weight.max > 0 ? Math.min(100, (weight.current / weight.max) * 100) : 0;

  return (
    <Panel
      title={characterName || "Inventaire"}
      width={TRADE_INVENTORY_PANEL.width}
      height={height}
      zoom={zoom}
      floating={floating}
      onClose={onClose}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          padding: `${p(6)}px ${p(TRADE_PAD)}px 0`,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: p(4),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: p(6),
            height: p(HEADER.rowHeight),
          }}
        >
          <span
            style={{
              fontFamily: "Verdana, sans-serif",
              fontSize: p(11),
              color: C.text,
              whiteSpace: "nowrap",
            }}
          >
            {activeLabel}
          </span>
          <div style={{ width: p(130) }}>
            <TypeSelect
              value={filters.typeName}
              options={filters.typeOptions}
              onChange={filters.setTypeName}
              zoom={zoom}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: p(6),
            height: p(HEADER.filterSize),
          }}
        >
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={filters.categoryId === c.id}
              title={c.label}
              onClick={() =>
                filters.setCategoryId(filters.categoryId === c.id ? null : c.id)
              }
              style={{
                width: p(HEADER.filterSize),
                height: p(HEADER.filterSize),
                border:
                  filters.categoryId === c.id ? "2px solid #ffffff" : "none",
                borderRadius: p(4),
                background: "#df7d2e",
                backgroundImage: `url("${c.icon}")`,
                backgroundSize: "70%",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
              }}
            />
          ))}

          {/* The pods gauge — same reading and the same two colours as the
              one under the paperdoll in `EquipmentPanel`. */}
          <div
            title={`${Math.round(weight.current)} / ${weight.max} pods`}
            style={{
              width: p(HEADER.podsBarWidth),
              height: p(10),
              background: C.podsTrack,
              borderRadius: p(5),
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: `${podsPct}%`,
                height: "100%",
                background: C.podsFill,
              }}
            />
          </div>

          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: p(4),
              fontFamily: "Verdana, sans-serif",
              fontSize: p(11),
              color: C.text,
              whiteSpace: "nowrap",
            }}
          >
            {kamas.toLocaleString("fr-FR")}
            <img
              src={`${ASSET_BASE}/kamas.svg`}
              alt="kamas"
              style={{ width: p(12), height: p(14) }}
            />
          </span>
        </div>

        {/* `ItemGrid` positions itself absolutely inside its window, so the
            box is measured from the panel's own top-left, not from this
            flex column — hence the header heights added up by hand. */}
        <ItemGrid
          zoom={zoom}
          title=""
          showTitle={false}
          showFilters={false}
          boxBackground="transparent"
          metrics={metrics}
          box={{
            x: TRADE_PAD,
            y: 6 + HEADER.rowHeight + 4 + HEADER.filterSize + 4,
            width: TRADE_INVENTORY_PANEL.width - TRADE_PAD * 2 - 6,
            // The grid track plus `ItemGrid`'s own 2/4 vertical margins.
            height: metrics.visibleRows * metrics.cellSize + 8,
          }}
          items={filters.visible}
          templates={templates}
          selectedUnicId={selectedUnicId}
          onSelect={onSelect}
          actions={actions}
        />

        {/* `ItemGrid` is absolutely positioned, so this column only ever
            lays out the two header rows; `marginTop: auto` is what puts
            the strip at the bottom of the panel rather than immediately
            under them. */}
        {footer && <div style={{ marginTop: "auto" }}>{footer}</div>}
      </div>
    </Panel>
  );
}
