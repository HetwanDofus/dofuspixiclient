import { useState } from "react";

import type { ItemTemplateData } from "@/game/network/protocol";

import { Scrollbar } from "../components/Scrollbar";
import { ItemIcon } from "../inventory/ItemIcon";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";
import { BUY_LIST } from "./bigstore-theme";

const C = INVENTORY_COLORS;
const M = BUY_LIST;

interface TemplateListProps {
  zoom: number;
  /** The templates on sale, in the server's order. */
  templateIds: number[];
  templates: Map<number, ItemTemplateData>;
  selectedTemplateId: number | null;
  onSelect: (templateId: number) => void;
}

/**
 * "Objets en vente" — the models currently on sale in this category.
 *
 * A scrolling row list rather than a grid, because that is what retail
 * draws and because a row can carry a full item name where a 33-unit
 * cell cannot. The scrolling mechanism is `SpellsPanel`'s: a viewport of
 * exactly `visibleRows` rows, the content translated under it, and the
 * shared `Scrollbar` beside it.
 *
 * A template with no row in `templates` yet is drawn as a blank line
 * rather than skipped: the server sends the list and the presentation
 * data as two frames, and dropping the entry would make the list jump as
 * the second one lands.
 */
export function TemplateList({
  zoom,
  templateIds,
  templates,
  selectedTemplateId,
  onSelect,
}: TemplateListProps) {
  const p = (n: number) => Math.round(n * zoom);
  const [scrollTop, setScrollTop] = useState(0);

  const viewportHeight = M.rowHeight * M.visibleRows;
  const contentHeight = M.rowHeight * templateIds.length;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const offset = Math.min(scrollTop, maxScroll);

  return (
    <div style={{ display: "flex", gap: p(2), flex: 1, minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          height: p(viewportHeight),
          overflow: "hidden",
          position: "relative",
        }}
        onWheel={(e) => {
          e.preventDefault();
          setScrollTop(
            Math.max(
              0,
              Math.min(maxScroll, offset + Math.sign(e.deltaY) * M.rowHeight)
            )
          );
        }}
      >
        <div style={{ transform: `translateY(${-p(offset)}px)` }}>
          {templateIds.map((templateId, index) => {
            const template = templates.get(templateId);
            const selected = templateId === selectedTemplateId;

            return (
              <button
                key={templateId}
                type="button"
                onClick={() => onSelect(templateId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: p(5),
                  width: "100%",
                  height: p(M.rowHeight),
                  padding: `0 ${p(4)}px`,
                  border: "none",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "Verdana, sans-serif",
                  fontSize: p(10),
                  color: selected ? "#ffffff" : C.text,
                  background: selected
                    ? "#df7d2e"
                    : index % 2 === 0
                      ? C.detailRowEven
                      : C.detailRowOdd,
                }}
              >
                {template ? (
                  <ItemIcon
                    typeId={template.typeId}
                    gfxId={template.gfxId}
                    size={p(M.rowHeight - 5)}
                  />
                ) : (
                  <span style={{ width: p(M.rowHeight - 5) }} />
                )}
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {template?.name ?? ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Scrollbar
        zoom={zoom}
        width={M.scrollbarWidth}
        scrollTop={offset}
        maxScroll={maxScroll}
        viewportHeight={viewportHeight}
        contentHeight={contentHeight}
        step={M.rowHeight}
        onScroll={setScrollTop}
        trackColor={C.scrollTrack}
        thumbColor={C.scrollThumb}
      />
    </div>
  );
}
