import { useState } from "react";

import type {
  BigStoreListingLine,
  ItemTemplateData,
} from "@/game/network/protocol";

import { Scrollbar } from "../components/Scrollbar";
import { ItemIcon } from "../inventory/ItemIcon";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";
import { BUY_PRICES, formatKamas, lotLabel } from "./bigstore-theme";

const C = INVENTORY_COLORS;
const M = BUY_PRICES;

/** Which of a row's three prices is picked, if any. */
export interface PriceSelection {
  lineId: string;
  /** 1-based, as `EHB` names it. */
  quantityIndex: number;
  price: number;
}

interface BigStorePriceGridProps {
  zoom: number;
  lines: BigStoreListingLine[];
  templates: Map<number, ItemTemplateData>;
  /** The three lot sizes, from the hall's own parameters. */
  lotSizes: number[];
  selection: PriceSelection | null;
  onSelect: (selection: PriceSelection | null) => void;
  /** Absent in sell mode, where the grid is only there to compare with. */
  onBuy?: (selection: PriceSelection) => void;
  rowHeight?: number;
  visibleRows?: number;
}

/**
 * The x1 / x10 / x100 grid — the heart of the buy window.
 *
 * Each row is a group and each of its three cells an independently
 * buyable price, which is exactly how `bigstore/BigStorePriceItem.as`
 * draws it: three toggle buttons sharing one `oItem.id`, a "Acheter"
 * that stays disabled until one of them is pressed, and a `-` in any
 * column nobody is selling. Picking a price in one row clears the pick in
 * every other, because a purchase names one price.
 *
 * For an item whose stats vary each row is a distinct exemplar and only
 * the x1 column is ever filled; for a resource there is a single row and
 * its three prices may come from three different sellers. The client does
 * not need to know which case it is in — the server has already decided
 * by the shape of the rows it sent.
 */
export function BigStorePriceGrid({
  zoom,
  lines,
  templates,
  lotSizes,
  selection,
  onSelect,
  onBuy,
  rowHeight = M.rowHeight,
  visibleRows = M.visibleRows,
}: BigStorePriceGridProps) {
  const p = (n: number) => Math.round(n * zoom);
  const [scrollTop, setScrollTop] = useState(0);

  const viewportHeight = rowHeight * visibleRows;
  const contentHeight = rowHeight * lines.length;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const offset = Math.min(scrollTop, maxScroll);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: p(M.headerHeight),
          background: C.header,
          color: "#ffffff",
          fontFamily: "Verdana, sans-serif",
          fontSize: p(10),
        }}
      >
        <span style={{ width: p(M.iconWidth), flexShrink: 0 }} />
        {lotSizes.map((size) => (
          // The three price columns share whatever the row is given
          // rather than taking a fixed width: the seller's card is far
          // narrower than the buy window, and a fixed column pushed x100
          // off the edge of it entirely.
          <span key={size} style={{ flex: 1, textAlign: "center" }}>
            {lotLabel(size)}
          </span>
        ))}
        {onBuy && <span style={{ width: p(M.buyWidth), flexShrink: 0 }} />}
      </div>

      <div style={{ display: "flex", gap: p(2), flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: 1,
            height: p(viewportHeight),
            overflow: "hidden",
          }}
          onWheel={(e) => {
            e.preventDefault();
            setScrollTop(
              Math.max(
                0,
                Math.min(maxScroll, offset + Math.sign(e.deltaY) * rowHeight)
              )
            );
          }}
        >
          <div style={{ transform: `translateY(${-p(offset)}px)` }}>
            {lines.map((line, index) => {
              const lineId = String(line.lineId);
              const template = templates.get(line.templateId);
              const prices = [
                Number(line.priceQty1),
                Number(line.priceQty10),
                Number(line.priceQty100),
              ];

              return (
                <div
                  key={lineId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: p(rowHeight),
                    background:
                      index % 2 === 0 ? C.detailRowEven : C.detailRowOdd,
                  }}
                >
                  <span
                    style={{
                      width: p(M.iconWidth),
                      flexShrink: 0,
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
                    {template && (
                      <ItemIcon
                        typeId={template.typeId}
                        gfxId={template.gfxId}
                        size={p(rowHeight - 4)}
                      />
                    )}
                  </span>

                  {lotSizes.map((size, column) => {
                    const price = prices[column] ?? 0;
                    const picked =
                      selection?.lineId === lineId &&
                      selection.quantityIndex === column + 1;

                    return (
                      <button
                        key={size}
                        type="button"
                        // Nobody is selling this amount: 1.29 draws a
                        // dash and disables the cell rather than hiding
                        // the column, so the three lots always line up
                        // across rows.
                        disabled={price <= 0}
                        onClick={() =>
                          onSelect(
                            picked
                              ? null
                              : {
                                  lineId,
                                  quantityIndex: column + 1,
                                  price,
                                }
                          )
                        }
                        style={{
                          flex: 1,
                          minWidth: 0,
                          height: p(rowHeight - 3),
                          border: "none",
                          borderRadius: p(3),
                          textAlign: "right",
                          padding: `0 ${p(6)}px`,
                          fontFamily: "Verdana, sans-serif",
                          fontSize: p(10),
                          background: picked ? "#df7d2e" : "transparent",
                          color: picked
                            ? "#ffffff"
                            : price > 0
                              ? C.text
                              : C.textMuted,
                          cursor: price > 0 ? "pointer" : "default",
                        }}
                      >
                        {price > 0 ? formatKamas(price) : "-"}
                      </button>
                    );
                  })}

                  <span
                    style={{
                      width: onBuy ? p(M.buyWidth) : 0,
                      flexShrink: 0,
                      display: "flex",
                      justifyContent: "flex-end",
                      paddingRight: onBuy ? p(4) : 0,
                    }}
                  >
                    {onBuy && (
                      <button
                        type="button"
                        disabled={selection?.lineId !== lineId}
                        onClick={() => selection && onBuy(selection)}
                        style={{
                          width: p(M.buyWidth - 8),
                          height: p(rowHeight - 4),
                          border: "none",
                          borderRadius: p(4),
                          background:
                            selection?.lineId === lineId
                              ? "#df7d2e"
                              : "#a8875f",
                          color: "#ffffff",
                          fontFamily: "Verdana, sans-serif",
                          fontSize: p(10),
                          cursor:
                            selection?.lineId === lineId
                              ? "pointer"
                              : "default",
                        }}
                      >
                        Acheter
                      </button>
                    )}
                  </span>
                </div>
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
          step={rowHeight}
          onScroll={setScrollTop}
          trackColor={C.scrollTrack}
          thumbColor={C.scrollThumb}
        />
      </div>
    </div>
  );
}
