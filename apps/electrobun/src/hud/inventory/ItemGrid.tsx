import { useEffect, useRef, useState } from "react";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import { showContextMenu } from "@/game/stores/context-menu-store";

import { Scrollbar } from "../components/Scrollbar";
import { useTooltip } from "../components/Tooltip";
import { ItemIcon } from "./ItemIcon";
import {
  FILTER_CATEGORIES,
  INVENTORY_COLORS,
  RESOURCES_METRICS,
} from "./inventory-theme";
import { TypeSelect } from "./TypeSelect";
import { useItemFilters } from "./use-item-filters";

const C = INVENTORY_COLORS;
const GRID_ASSET_BASE = "/themes/classic/assets/panels/inventory";

export interface ItemGridBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The measurements a grid draws itself from. Widened from
 * `typeof RESOURCES_METRICS`, whose `as const` literals rejected any other
 * shape — the exchange windows pass 8×3 and 7×2 grids with no title row.
 */
export type ItemGridMetrics = {
  readonly [K in keyof typeof RESOURCES_METRICS]: number;
};

/**
 * One entry of a cell's context menu, and — for the first one whose
 * `enabled` holds — what a double-click does.
 *
 * Order is priority: the bag lists "Équiper" before "Utiliser" because
 * double-clicking a wearable equips it and double-clicking a potion
 * drinks it, which is the same rule stated once.
 */
export interface ItemGridAction {
  label: string;
  enabled: (item: ItemData, template: ItemTemplateData | undefined) => boolean;
  run: (item: ItemData) => void;
}

export interface ItemGridProps {
  zoom: number;
  /** Header text — "Ressources" in the bag, the container's name elsewhere. */
  title: string;
  /** Where the grid sits inside its window, in base units. */
  box: ItemGridBox;
  metrics?: ItemGridMetrics;
  items: ItemData[];
  templates: Map<number, ItemTemplateData>;
  selectedUnicId: number | null;
  onSelect: (item: ItemData) => void;
  actions: ItemGridAction[];
  /**
   * Extra props for a cell — the hotbar drag source, for the bag only.
   * A bank grid must not inherit it: dropping a banked item onto the
   * hotbar would create a shortcut to something the player is not
   * carrying.
   */
  cellExtraProps?: (item: ItemData) => Record<string, unknown>;
  /**
   * Draw the category buttons, the type dropdown and the search box.
   *
   * On by default, because every grid the 1.29 client shows *as an
   * inventory* has them. The two offer panes of a trade do not: they
   * hold a handful of stacks the player just put there, and filtering
   * your own offer is filtering a list you can already see whole.
   */
  showFilters?: boolean;
  /**
   * Draw the header line holding `title`.
   *
   * On by default. The three exchange windows turn it off: there the
   * container's name is the `Panel`'s own title bar, and a second copy of
   * it inside the box is a row of wasted height retail does not spend.
   */
  showTitle?: boolean;
  /**
   * The rounded box drawn behind the whole browser.
   *
   * `INVENTORY_COLORS.boxBg` — the dark frame — everywhere the grid is a
   * box nested inside a bigger window. The exchange windows pass
   * `"transparent"`: there the grid *is* the window's content, and retail
   * draws its cells straight onto the panel's tan.
   */
  boxBackground?: string;
}

/**
 * The 1.29 item browser: category filters, a type dropdown, a name
 * search and a scrolling grid.
 *
 * Extracted from `BagPanel` when the bank needed a second one. Almost
 * all of it was already generic — the filtering, the search, the
 * virtualised scroll and the always-full grid are computed from the
 * props — and only five things were pinned to the inventory window: its
 * box, its metrics, the literal title "Ressources", the
 * equip/use vocabulary, and the hotbar drag source. Those are the five
 * that became props.
 *
 * Filtering is entirely client-side over what the caller already holds;
 * there is no server round trip for it.
 */
export function ItemGrid({
  zoom,
  title,
  box,
  metrics,
  items,
  templates,
  selectedUnicId,
  onSelect,
  actions,
  cellExtraProps,
  showFilters = true,
  showTitle = true,
  boxBackground,
}: ItemGridProps) {
  const M = metrics ?? RESOURCES_METRICS;
  const p = (n: number) => Math.round(n * zoom);
  const {
    categoryId,
    setCategoryId,
    typeName,
    setTypeName,
    typeOptions,
    search,
    setSearch,
    searchOpen,
    setSearchOpen,
    visible,
  } = useItemFilters(items, templates);
  const [scrollTop, setScrollTop] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  // Retail always fills the whole frame with cells, empty or not — a
  // filtered-down sac still shows the grid, not a bare rectangle. `rows`
  // is at least `visibleRows` (fills the viewport) and grows with content.
  const rows = Math.max(
    M.visibleRows,
    Math.ceil(visible.length / M.gridColumns)
  );
  const cellCount = rows * M.gridColumns;
  const viewportHeight = M.visibleRows * M.cellSize;
  const contentHeight = rows * M.cellSize;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const clampedScroll = Math.min(scrollTop, maxScroll);
  const scrollable = maxScroll > 0;
  // Grid track is exactly `columns × cellSize` — the reference capture's
  // grid area (px 1292..1573) plus its scrollbar (px 1573..1596) already
  // add up to the full resources box width, with no side margin to spare.
  const gridWidth = M.gridColumns * M.cellSize;

  return (
    <div
      style={{
        position: "absolute",
        left: p(box.x),
        top: p(box.y),
        width: p(box.width),
        height: p(box.height),
        background: boxBackground ?? C.boxBg,
        borderRadius: p(10),
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      {showTitle && (
        <div
          style={{
            textAlign: "center",
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: p(11),
            marginTop: p(M.titleTop),
            height: p(M.titleHeight),
            fontFamily: "Verdana, sans-serif",
          }}
        >
          {title}
        </div>
      )}

      {showFilters && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${M.filterColumns}, 1fr)`,
            gap: p(M.filterGap),
            padding: `0 ${p(6)}px`,
            marginTop: p(M.filtersTop - M.titleTop - M.titleHeight),
          }}
        >
          {FILTER_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={categoryId === c.id}
              title={c.label}
              onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
              style={{
                width: p(M.filterSize),
                height: p(M.filterSize),
                border: categoryId === c.id ? "2px solid #ffffff" : "none",
                borderRadius: p(4),
                background: "#df7d2e",
                backgroundImage: `url("${c.icon}")`,
                backgroundSize: "70%",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      )}

      {showFilters && (
        <div
          style={{
            display: "flex",
            gap: p(4),
            padding: `0 ${p(6)}px`,
            marginTop: p(6),
            height: p(M.dropdownHeight),
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {searchOpen ? (
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => {
                  if (!search) {
                    setSearchOpen(false);
                  }
                }}
                placeholder="Rechercher..."
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing: "border-box",
                  border: "none",
                  borderRadius: p(4),
                  padding: `0 ${p(5)}px`,
                  fontFamily: "Verdana, sans-serif",
                  fontSize: p(8),
                  color: C.text,
                }}
              />
            ) : (
              <TypeSelect
                value={typeName}
                options={typeOptions}
                onChange={setTypeName}
                zoom={zoom}
              />
            )}
          </div>
          <button
            type="button"
            aria-label="Rechercher"
            onClick={() => setSearchOpen((v) => !v)}
            style={{
              width: p(M.searchSize),
              height: p(M.searchSize),
              border: "none",
              borderRadius: p(4),
              background: "#df7d2e",
              backgroundImage: `url("${GRID_ASSET_BASE}/icon-search.svg")`,
              backgroundSize: "60%",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              cursor: "pointer",
              padding: 0,
              flexShrink: 0,
            }}
          />
        </div>
      )}

      <div
        style={{
          flex: 1,
          margin: `${p(2)}px 0 ${p(4)}px`,
          display: "flex",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: p(gridWidth),
            height: "100%",
            background: C.gridBg,
            borderRadius: p(3),
            overflow: "hidden",
          }}
          onWheel={(e) => {
            if (!scrollable) {
              return;
            }
            e.stopPropagation();
            setScrollTop((prev) =>
              Math.max(
                0,
                Math.min(maxScroll, prev + Math.sign(e.deltaY) * M.cellSize)
              )
            );
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${M.gridColumns}, ${p(M.cellSize)}px)`,
              transform: `translateY(${p(-clampedScroll)}px)`,
              willChange: "transform",
            }}
          >
            {Array.from({ length: cellCount }, (_, index) => {
              const item = visible[index];
              const template = item ? templates.get(item.itemId) : undefined;
              return (
                <ItemGridCell
                  key={item?.unicId ?? `empty-${index}`}
                  zoom={zoom}
                  cellSize={M.cellSize}
                  item={item}
                  template={template}
                  selected={item?.unicId === selectedUnicId}
                  onSelect={onSelect}
                  actions={actions}
                  extraProps={cellExtraProps}
                />
              );
            })}
          </div>
        </div>

        {scrollable && (
          <Scrollbar
            zoom={zoom}
            width={M.scrollbarWidth}
            scrollTop={clampedScroll}
            maxScroll={maxScroll}
            viewportHeight={viewportHeight}
            contentHeight={contentHeight}
            step={M.cellSize}
            onScroll={setScrollTop}
            trackColor={C.scrollTrack}
            thumbColor={C.scrollThumb}
          />
        )}
      </div>
    </div>
  );
}

function ItemGridCell({
  zoom,
  cellSize,
  item,
  template,
  selected,
  onSelect,
  actions,
  extraProps,
}: {
  zoom: number;
  cellSize: number;
  item: ItemData | undefined;
  template: ItemTemplateData | undefined;
  selected: boolean;
  onSelect: (item: ItemData) => void;
  actions: ItemGridAction[];
  extraProps?: (item: ItemData) => Record<string, unknown>;
}) {
  const p = (n: number) => Math.round(n * zoom);
  const tooltip = useTooltip();

  // An empty grid slot — retail fills the whole frame with cells whether
  // or not they hold an object, it's a plain unclickable `grid-cell-bg.svg`.
  if (!item) {
    return (
      <div
        style={{
          width: p(cellSize),
          height: p(cellSize),
          backgroundImage: `url("${GRID_ASSET_BASE}/grid-cell-bg.svg")`,
          backgroundSize: "100% 100%",
          boxSizing: "border-box",
        }}
      />
    );
  }

  const available = actions.filter((action) => action.enabled(item, template));

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onDoubleClick={() => available[0]?.run(item)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (available.length === 0) {
          return;
        }
        showContextMenu(
          template?.name ?? "Objet",
          available.map((action) => ({
            label: action.label,
            onClick: () => action.run(item),
          })),
          e.clientX,
          e.clientY
        );
      }}
      {...(extraProps?.(item) ?? {})}
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
        position: "relative",
        width: p(cellSize),
        height: p(cellSize),
        border: "none",
        padding: p(2),
        backgroundImage: `url("${GRID_ASSET_BASE}/grid-cell-bg.svg")`,
        backgroundSize: "100% 100%",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      {template && (
        <ItemIcon
          typeId={template.typeId}
          gfxId={template.gfxId}
          size="100%"
          alt={template.name}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {item.quantity > 1 && (
        <span
          style={{
            position: "absolute",
            left: p(2),
            top: p(1),
            color: "#ffffff",
            fontSize: p(9),
            fontWeight: "bold",
            fontFamily: "Verdana, sans-serif",
            textShadow:
              "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
          }}
        >
          {item.quantity}
        </span>
      )}
      {selected && (
        <img
          src={`${GRID_ASSET_BASE}/grid-cell-highlight.svg`}
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
