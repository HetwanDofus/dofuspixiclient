import { useEffect, useMemo, useRef, useState } from "react";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import { showContextMenu } from "@/game/stores/context-menu-store";

import { Scrollbar } from "../components/Scrollbar";
import { useTooltip } from "../components/Tooltip";
import { ItemIcon } from "./ItemIcon";
import {
  FILTER_CATEGORIES,
  INVENTORY_COLORS,
  RESOURCES_BOX,
  RESOURCES_METRICS,
} from "./inventory-theme";
import { TypeSelect } from "./TypeSelect";

const C = INVENTORY_COLORS;
const M = RESOURCES_METRICS;
const GRID_ASSET_BASE = "/themes/classic/assets/panels/inventory";

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
 * "Ressources" — the bag: category filters, a type dropdown, a name
 * search, and the item grid. Filtering is entirely client-side over what
 * `inventoryStore` already holds; there is no server round trip for it.
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
  const p = (n: number) => Math.round(n * zoom);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [typeName, setTypeName] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const category = FILTER_CATEGORIES.find((c) => c.id === categoryId) ?? null;

  const byCategory = useMemo(() => {
    if (!category) {
      return bagItems;
    }
    return bagItems.filter((item) => {
      const template = templates.get(item.itemId);
      return !!template && category.superTypes?.includes(template.superType);
    });
  }, [bagItems, category, templates]);

  const typeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of byCategory) {
      const name = templates.get(item.itemId)?.typeName;
      if (name) {
        names.add(name);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "fr"));
  }, [byCategory, templates]);

  const visible = useMemo(() => {
    return byCategory.filter((item) => {
      const template = templates.get(item.itemId);
      if (typeName && template?.typeName !== typeName) {
        return false;
      }
      if (
        search.trim() &&
        !template?.name.toLowerCase().includes(search.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [byCategory, templates, typeName, search]);

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
        left: p(RESOURCES_BOX.x),
        top: p(RESOURCES_BOX.y),
        width: p(RESOURCES_BOX.width),
        height: p(RESOURCES_BOX.height),
        background: C.boxBg,
        borderRadius: p(10),
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
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
        Ressources
      </div>

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
            onClick={() => {
              setCategoryId((current) => (current === c.id ? null : c.id));
              setTypeName(null);
            }}
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
            backgroundImage:
              'url("/themes/classic/assets/panels/inventory/icon-search.svg")',
            backgroundSize: "60%",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
        />
      </div>

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
                <BagCell
                  key={item?.unicId ?? `empty-${index}`}
                  zoom={zoom}
                  item={item}
                  template={template}
                  selected={item?.unicId === selectedUnicId}
                  onSelect={onSelect}
                  onEquip={onEquip}
                  onUse={onUse}
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

function BagCell({
  zoom,
  item,
  template,
  selected,
  onSelect,
  onEquip,
  onUse,
}: {
  zoom: number;
  item: ItemData | undefined;
  template: ItemTemplateData | undefined;
  selected: boolean;
  onSelect: (item: ItemData) => void;
  onEquip: (item: ItemData) => void;
  onUse: (item: ItemData) => void;
}) {
  const p = (n: number) => Math.round(n * zoom);
  const tooltip = useTooltip();
  const canEquip = !!template?.positions.length;

  // An empty grid slot — retail fills the whole frame with cells whether
  // or not they hold an object, it's a plain unclickable `grid-cell-bg.svg`.
  if (!item) {
    return (
      <div
        style={{
          width: p(M.cellSize),
          height: p(M.cellSize),
          backgroundImage: `url("${GRID_ASSET_BASE}/grid-cell-bg.svg")`,
          backgroundSize: "100% 100%",
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onDoubleClick={() => {
        if (canEquip) {
          onEquip(item);
        } else if (template?.usable) {
          onUse(item);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const options: { label: string; onClick: () => void }[] = [];
        if (canEquip) {
          options.push({ label: "Équiper", onClick: () => onEquip(item) });
        }
        if (template?.usable) {
          options.push({ label: "Utiliser", onClick: () => onUse(item) });
        }
        if (options.length > 0) {
          showContextMenu(
            template?.name ?? "Objet",
            options,
            e.clientX,
            e.clientY
          );
        }
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
        position: "relative",
        width: p(M.cellSize),
        height: p(M.cellSize),
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
