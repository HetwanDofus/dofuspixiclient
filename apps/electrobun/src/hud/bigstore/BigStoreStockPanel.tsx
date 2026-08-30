import { useState } from "react";

import type {
  BigStoreOwnListing,
  ItemTemplateData,
} from "@/game/network/protocol";

import { Panel } from "../components/Panel";
import { Scrollbar } from "../components/Scrollbar";
import { ItemIcon } from "../inventory/ItemIcon";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";
import {
  BIGSTORE_BUTTON_HEIGHT,
  BUY_LIST,
  formatKamas,
  SELL_STOCK_PANEL,
  SELL_STOCK_ROWS,
} from "./bigstore-theme";

const C = INVENTORY_COLORS;
const ROW_HEIGHT = BUY_LIST.rowHeight;

interface BigStoreStockPanelProps {
  zoom: number;
  listings: BigStoreOwnListing[];
  templates: Map<number, ItemTemplateData>;
  maxItems: number;
  selectedLineId: string | null;
  onSelect: (lineId: string) => void;
  onWithdraw: () => void;
  onSwitchToBuy: () => void;
  onClose: () => void;
}

/**
 * "Stock en magasin (n/max)" — everything this account has on sale here.
 *
 * The count in the title is the slot cap made visible, and it is the only
 * place a seller can see it: the hall sends `max_items` on opening and
 * refuses a listing past it, so a window that did not show the ratio
 * would turn a rule into a mystery.
 *
 * A lot bigger than one is written `x10 <name>`, exactly as the retail
 * capture does — the lot size is part of what is on sale, not a quantity
 * beside it.
 */
export function BigStoreStockPanel({
  zoom,
  listings,
  templates,
  maxItems,
  selectedLineId,
  onSelect,
  onWithdraw,
  onSwitchToBuy,
  onClose,
}: BigStoreStockPanelProps) {
  const p = (n: number) => Math.round(n * zoom);
  const [scrollTop, setScrollTop] = useState(0);

  const visibleRows = SELL_STOCK_ROWS;
  const viewportHeight = ROW_HEIGHT * visibleRows;
  const contentHeight = ROW_HEIGHT * listings.length;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const offset = Math.min(scrollTop, maxScroll);

  return (
    <div style={{ pointerEvents: "auto" }}>
      <Panel
        title={`Stock en magasin (${listings.length}/${maxItems})`}
        width={SELL_STOCK_PANEL.width}
        height={SELL_STOCK_PANEL.height}
        zoom={zoom}
        floating
        onClose={onClose}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: p(6),
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: p(4),
          }}
        >
          <div style={{ display: "flex", gap: p(2), flex: 1, minHeight: 0 }}>
            <div
              style={{
                flex: 1,
                height: p(viewportHeight),
                overflow: "hidden",
                background: C.gridBg,
                borderRadius: p(4),
              }}
              onWheel={(e) => {
                e.preventDefault();
                setScrollTop(
                  Math.max(
                    0,
                    Math.min(
                      maxScroll,
                      offset + Math.sign(e.deltaY) * ROW_HEIGHT
                    )
                  )
                );
              }}
            >
              <div style={{ transform: `translateY(${-p(offset)}px)` }}>
                {listings.map((listing, index) => {
                  const lineId = String(listing.lineId);
                  const template = listing.item
                    ? templates.get(listing.item.itemId)
                    : undefined;
                  const selected = lineId === selectedLineId;

                  return (
                    <button
                      key={lineId}
                      type="button"
                      onClick={() => onSelect(lineId)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: p(5),
                        width: "100%",
                        height: p(ROW_HEIGHT),
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
                      {template && (
                        <ItemIcon
                          typeId={template.typeId}
                          gfxId={template.gfxId}
                          size={p(ROW_HEIGHT - 5)}
                        />
                      )}
                      <span
                        style={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {listing.lotSize > 1 ? `x${listing.lotSize} ` : ""}
                        {template?.name ?? ""}
                      </span>
                      <span>{formatKamas(listing.price)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <Scrollbar
              zoom={zoom}
              width={BUY_LIST.scrollbarWidth}
              scrollTop={offset}
              maxScroll={maxScroll}
              viewportHeight={viewportHeight}
              contentHeight={contentHeight}
              step={ROW_HEIGHT}
              onScroll={setScrollTop}
              trackColor={C.scrollTrack}
              thumbColor={C.scrollThumb}
            />
          </div>

          <button
            type="button"
            disabled={!selectedLineId}
            onClick={onWithdraw}
            style={{
              height: p(BIGSTORE_BUTTON_HEIGHT),
              border: "none",
              borderRadius: p(6),
              background: selectedLineId ? "#df7d2e" : "#a8875f",
              color: "#ffffff",
              fontFamily: "Verdana, sans-serif",
              fontSize: p(11),
              cursor: selectedLineId ? "pointer" : "default",
            }}
          >
            Retirer
          </button>

          {/* Inside the frame, not under it. Retail can hang a button off
              the bottom edge of a window because its windows are dragged
              around as a unit; here a loose button reads as a stray
              control belonging to nothing. */}
          <button
            type="button"
            onClick={onSwitchToBuy}
            style={{
              height: p(BIGSTORE_BUTTON_HEIGHT),
              border: "none",
              borderRadius: p(6),
              background: "#df7d2e",
              color: "#ffffff",
              fontFamily: "Verdana, sans-serif",
              fontSize: p(11),
              cursor: "pointer",
            }}
          >
            Mode achat
          </button>
        </div>
      </Panel>
    </div>
  );
}
