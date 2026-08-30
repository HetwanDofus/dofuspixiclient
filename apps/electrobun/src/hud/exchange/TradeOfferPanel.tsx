import { useState } from "react";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";

import { Panel } from "../components/Panel";
import { ItemGrid, type ItemGridAction } from "../inventory/ItemGrid";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";
import {
  TRADE_BUTTON_HEIGHT,
  TRADE_OFFER_METRICS,
  TRADE_OFFER_PANEL,
  TRADE_PAD,
} from "./trade-theme";

const C = INVENTORY_COLORS;
const ASSET_BASE = "/themes/classic/assets/panels/inventory";
const KAMAS_ROW_HEIGHT = 18;

interface TradeOfferPanelProps {
  zoom: number;
  /** The board's heading — the partner's name, or empty for your own. */
  title: string;
  items: ItemData[];
  templates: Map<number, ItemTemplateData>;
  kamas: number;
  /** Green frame: this side has validated. Canonical `updateReadyState`. */
  ready: boolean;
  selectedUnicId: number | null;
  onSelect: (item: ItemData) => void;
  actions: ItemGridAction[];
  /** Only your own board lets you set the kamas on the table. */
  onKamas?: (quantity: number) => void;
  button: { label: string; onClick?: () => void; disabled?: boolean };
}

/**
 * One side of the table — retail draws two of these, bottom left for the
 * partner and bottom right for you.
 *
 * The two differ by their props alone: the partner's board is titled with
 * their name and takes no actions (lifting things off somebody else's side
 * of the table is not a thing a trade lets you do), yours is untitled,
 * carries the editable kamas field and the validate button.
 */
export function TradeOfferPanel({
  zoom,
  title,
  items,
  templates,
  kamas,
  ready,
  selectedUnicId,
  onSelect,
  actions,
  onKamas,
  button,
}: TradeOfferPanelProps) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <div style={{ width: p(TRADE_OFFER_PANEL.width) }}>
      <div style={{ position: "relative" }}>
        {/* The partner's board is titled with their name and carries
            their kamas at the right of that bar; yours has no bar at all
            — retail draws it as a bare rounded box, with the kamas in the
            editable row inside. */}
        <Panel
          title={title}
          width={TRADE_OFFER_PANEL.width}
          height={TRADE_OFFER_PANEL.height}
          zoom={zoom}
          showTitleBar={!!title}
          titleRight={
            title ? (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: p(4),
                  marginLeft: "auto",
                  color: "#ffffff",
                  fontFamily: "Verdana, sans-serif",
                  fontSize: p(11),
                }}
              >
                {kamas.toLocaleString("fr-FR")}
                <img
                  src={`${ASSET_BASE}/kamas.svg`}
                  alt="kamas"
                  style={{ width: p(11), height: p(13) }}
                />
              </span>
            ) : undefined
          }
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              padding: `${p(4)}px ${p(TRADE_PAD)}px 0`,
              boxSizing: "border-box",
            }}
          >
            {onKamas && (
              <KamasRow zoom={zoom} kamas={kamas} onKamas={onKamas} />
            )}

            <ItemGrid
              zoom={zoom}
              title=""
              showTitle={false}
              showFilters={false}
              boxBackground="transparent"
              metrics={TRADE_OFFER_METRICS}
              box={{
                x: TRADE_PAD,
                y: 4 + (onKamas ? KAMAS_ROW_HEIGHT + 2 : 0),
                width: TRADE_OFFER_PANEL.width - TRADE_PAD * 2 - 6,
                height:
                  TRADE_OFFER_METRICS.visibleRows *
                    TRADE_OFFER_METRICS.cellSize +
                  8,
              }}
              items={items}
              templates={templates}
              selectedUnicId={selectedUnicId}
              onSelect={onSelect}
              actions={actions}
            />
          </div>
        </Panel>

        {ready && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: `${p(13)}px ${p(13)}px 0 0`,
              boxShadow: `inset 0 0 0 ${p(3)}px #7ac943`,
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <button
        type="button"
        onClick={button.onClick}
        disabled={button.disabled}
        style={{
          display: "block",
          margin: `${p(4)}px auto 0`,
          width: "72%",
          height: p(TRADE_BUTTON_HEIGHT),
          border: "none",
          borderRadius: p(4),
          background: "#df7d2e",
          color: "#ffffff",
          fontFamily: "Verdana, sans-serif",
          fontSize: p(11),
          cursor: button.disabled ? "default" : "pointer",
          opacity: button.disabled ? 0.45 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {button.label}
      </button>
    </div>
  );
}

/**
 * The kamas line above the board.
 *
 * Read-only on the partner's side. On yours it is an input, because the
 * offer the server keeps is **absolute** — typing the amount is the whole
 * interaction, which is why retail has no "propose" button beside it.
 */
function KamasRow({
  zoom,
  kamas,
  onKamas,
}: {
  zoom: number;
  kamas: number;
  onKamas: (quantity: number) => void;
}) {
  const p = (n: number) => Math.round(n * zoom);
  // The draft remembers which server value it was typed against, so an
  // `EM` that clamps or changes the offer wins over a stale field without
  // an effect having to reach in and clear it.
  const [draft, setDraft] = useState<{ from: number; text: string } | null>(
    null
  );
  const text = draft && draft.from === kamas ? draft.text : String(kamas);

  const commit = () => {
    if (!draft) {
      return;
    }

    const value = Number.parseInt(draft.text, 10);
    setDraft(null);

    if (Number.isFinite(value) && value >= 0 && value !== kamas) {
      onKamas(value);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: p(5),
        height: p(KAMAS_ROW_HEIGHT),
        fontFamily: "Verdana, sans-serif",
        fontSize: p(11),
        color: C.text,
      }}
    >
      <img
        src={`${ASSET_BASE}/kamas.svg`}
        alt="kamas"
        style={{ width: p(12), height: p(14) }}
      />
      <input
        value={text}
        onChange={(e) =>
          setDraft({ from: kamas, text: e.target.value.replace(/\D/g, "") })
        }
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
          }
        }}
        aria-label="Kamas à proposer"
        style={{
          width: p(90),
          height: p(14),
          boxSizing: "border-box",
          border: "none",
          borderRadius: p(3),
          padding: `0 ${p(4)}px`,
          fontFamily: "Verdana, sans-serif",
          fontSize: p(10),
          color: C.text,
        }}
      />
    </div>
  );
}
