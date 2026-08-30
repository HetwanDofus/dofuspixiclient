import { useState } from "react";

import type {
  BigStoreListingLine,
  ItemData,
  ItemTemplateData,
} from "@/game/network/protocol";

import { Panel } from "../components/Panel";
import { ItemDetailPanel } from "../inventory/ItemDetailPanel";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";
import { BigStorePriceGrid } from "./BigStorePriceGrid";
import {
  BIGSTORE_BUTTON_HEIGHT,
  formatKamas,
  lotLabel,
  SELL_AVERAGE_HEIGHT,
  SELL_FORM_PANEL,
  SELL_PRICES,
} from "./bigstore-theme";

const C = INVENTORY_COLORS;

/**
 * The card's own box inside this panel, in base units.
 *
 * Deliberately generous: this is the only place a seller reads what they
 * are about to part with, and an item's description is the part that was
 * being cut off first.
 */
const CARD_BOX = { x: 6, y: 4, width: SELL_FORM_PANEL.width - 12, height: 210 };

interface BigStoreSellFormProps {
  zoom: number;
  /** The bag stack the seller picked, or null. */
  item: ItemData | null;
  template: ItemTemplateData | null;
  /** What this model is already selling for here, for comparison. */
  lines: BigStoreListingLine[];
  templates: Map<number, ItemTemplateData>;
  lotSizes: number[];
  /** Lots of 10 and 100 are refused for an item with its own stats. */
  unitaryOnly: boolean;
  taxPercent: number;
  averagePrice: number | undefined;
  onSell: (lotSize: number, price: number) => void;
}

/**
 * The middle window of the sell mode: what you are about to list, and at
 * what price.
 *
 * The tax is previewed with the client's own arithmetic —
 * `Math.max(1, Math.round(price * tax / 100))`, `BigStoreSell
 * .calculateTax` — recomputed on every keystroke, because a seller
 * agreeing to a figure and being charged another is the one thing this
 * form must never do. The server computes it identically.
 *
 * The read-only price grid above is not decoration: it is how a seller
 * decides what to ask, and it is the same component the buy window uses.
 */
export function BigStoreSellForm({
  zoom,
  item,
  template,
  lines,
  templates,
  lotSizes,
  unitaryOnly,
  taxPercent,
  averagePrice,
  onSell,
}: BigStoreSellFormProps) {
  const p = (n: number) => Math.round(n * zoom);
  const [lotSize, setLotSize] = useState(1);
  const [price, setPrice] = useState("");

  const allowed = unitaryOnly ? [1] : lotSizes;
  const chosen = allowed.includes(lotSize) ? lotSize : 1;
  const value = Number.parseInt(price, 10);
  const valid = Number.isFinite(value) && value > 0;
  const tax = valid ? Math.max(1, Math.round(value * (taxPercent / 100))) : 0;
  const enough = item !== null && item.quantity >= chosen;

  return (
    <div style={{ pointerEvents: "auto" }}>
      <Panel
        title={template?.name ?? "Mise en vente"}
        width={SELL_FORM_PANEL.width}
        height={SELL_FORM_PANEL.height}
        zoom={zoom}
        showTitleBar={false}
        floating
      >
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {item && template ? (
            <ItemDetailPanel
              zoom={zoom}
              item={item}
              template={template}
              box={CARD_BOX}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                left: p(CARD_BOX.x),
                top: p(CARD_BOX.y),
                width: p(CARD_BOX.width),
                height: p(CARD_BOX.height),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: C.detailBody,
                borderRadius: p(6),
                fontFamily: "Verdana, sans-serif",
                fontSize: p(11),
                color: C.textMuted,
                textAlign: "center",
                padding: p(10),
                boxSizing: "border-box",
              }}
            >
              Choisis un objet dans ton inventaire
            </div>
          )}

          <div
            style={{
              position: "absolute",
              left: p(CARD_BOX.x),
              top: p(CARD_BOX.y + CARD_BOX.height + 6),
              width: p(CARD_BOX.width),
              height: p(SELL_PRICES.rowHeight * SELL_PRICES.visibleRows + 17),
            }}
          >
            <BigStorePriceGrid
              zoom={zoom}
              lines={lines}
              templates={templates}
              lotSizes={lotSizes}
              selection={null}
              onSelect={() => {}}
              rowHeight={SELL_PRICES.rowHeight}
              visibleRows={SELL_PRICES.visibleRows}
            />
          </div>

          <div
            style={{
              position: "absolute",
              left: p(CARD_BOX.x),
              right: p(CARD_BOX.x),
              top: p(
                CARD_BOX.y +
                  CARD_BOX.height +
                  6 +
                  SELL_PRICES.rowHeight * SELL_PRICES.visibleRows +
                  22
              ),
              display: "flex",
              flexDirection: "column",
              gap: p(6),
              fontFamily: "Verdana, sans-serif",
              fontSize: p(10),
              color: C.text,
            }}
          >
            <span
              style={{ height: p(SELL_AVERAGE_HEIGHT), overflow: "hidden" }}
            >
              {averagePrice === undefined
                ? ""
                : averagePrice < 0
                  ? "Cet objet n'a encore jamais été vendu dans cet hôtel de vente."
                  : `Prix moyen : ${formatKamas(averagePrice)} kamas/u.`}
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: p(6) }}>
              <span>Lot (quantité)</span>
              <select
                value={chosen}
                onChange={(e) => setLotSize(Number(e.target.value))}
                style={{
                  height: p(18),
                  border: "none",
                  borderRadius: p(4),
                  background: C.descBody,
                  color: C.text,
                  fontFamily: "Verdana, sans-serif",
                  fontSize: p(10),
                }}
              >
                {allowed.map((size) => (
                  <option key={size} value={size}>
                    {lotLabel(size)}
                  </option>
                ))}
              </select>

              <span style={{ marginLeft: "auto" }}>Prix du lot</span>
              <input
                value={price}
                inputMode="numeric"
                onChange={(e) =>
                  setPrice(e.target.value.replace(/[^0-9]/g, ""))
                }
                style={{
                  width: p(70),
                  height: p(18),
                  border: "none",
                  borderRadius: p(4),
                  padding: `0 ${p(6)}px`,
                  textAlign: "right",
                  background: C.descBody,
                  color: C.text,
                  fontFamily: "Verdana, sans-serif",
                  fontSize: p(10),
                }}
              />
            </div>

            <span>Taxe de mise en vente : {formatKamas(tax)}</span>

            <button
              type="button"
              disabled={!valid || !enough}
              onClick={() => onSell(chosen, value)}
              style={{
                height: p(BIGSTORE_BUTTON_HEIGHT),
                border: "none",
                borderRadius: p(6),
                background: valid && enough ? "#df7d2e" : "#a8875f",
                color: "#ffffff",
                fontFamily: "Verdana, sans-serif",
                fontSize: p(11),
                cursor: valid && enough ? "pointer" : "default",
              }}
            >
              Mettre en vente
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
