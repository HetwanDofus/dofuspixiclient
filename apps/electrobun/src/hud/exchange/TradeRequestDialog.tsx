import { useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import { tradeStore } from "@/game/stores/trade-store";

import { Panel } from "../components/Panel";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";

const C = INVENTORY_COLORS;
const BOX = { width: 300, height: 140 } as const;

/**
 * The two boxes of a trade proposal.
 *
 * One component, because they are one server frame read from opposite
 * ends: canonical `Exchange.onRequest` shows an `INFO_CANCEL` to whoever
 * sent the request and a `CAUTION_YESNOIGNORE` to whoever received it,
 * off the same `ER`. Splitting them into two components would duplicate
 * the chrome to express a difference that is two labels and a button.
 *
 * There is no "Ignorer". Canonical offers it because it drops the asker
 * into a blacklist that suppresses their future requests; this server
 * has no blacklist, so the button would do nothing a plain "Non" does
 * not already do (QA-122).
 */
export function TradeRequestDialog({
  zoom,
  gameClient,
}: {
  zoom: number;
  gameClient: GameClient | null;
}) {
  const trade = useSyncExternalStore(
    tradeStore.subscribe,
    tradeStore.getSnapshot
  );

  if (trade.phase !== "awaiting-answer" && trade.phase !== "asked") {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
  const who = trade.partnerName || "ce joueur";
  const waiting = trade.phase === "awaiting-answer";

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "34%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "auto",
      }}
    >
      <Panel title="Echange" width={BOX.width} height={BOX.height} zoom={zoom}>
        {/* A plain child of `.dofus-panel__content` — the flex:1 area
            `Panel` leaves below its title bar. Positioning this absolutely
            at `inset: 0` instead resolved against `.dofus-panel` itself,
            which is `position: relative`, and wrote the sentence straight
            over the title bar (QA problem-1). Same trap `InventoryWindow`
            documents. */}
        <div
          style={{
            height: "100%",
            padding: `${p(14)}px ${p(16)}px ${p(10)}px`,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "Verdana, sans-serif",
            fontSize: p(10),
            color: C.text,
            textAlign: "center",
          }}
        >
          <span style={{ whiteSpace: "pre-line", lineHeight: 1.4 }}>
            {waiting
              ? `En attente de la réponse de ${who} pour un échange...`
              : `${who} te propose de faire un échange.\nAcceptes-tu ?`}
          </span>

          <div style={{ display: "flex", gap: p(8) }}>
            {waiting ? (
              <DialogButton
                zoom={zoom}
                label="Annuler"
                onClick={() => gameClient?.exchangeLeave()}
              />
            ) : (
              <>
                <DialogButton
                  zoom={zoom}
                  label="Oui"
                  onClick={() => gameClient?.exchangeAccept()}
                />
                <DialogButton
                  zoom={zoom}
                  label="Non"
                  onClick={() => gameClient?.exchangeLeave()}
                />
              </>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function DialogButton({
  zoom,
  label,
  onClick,
}: {
  zoom: number;
  label: string;
  onClick: () => void;
}) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minWidth: p(72),
        height: p(20),
        border: "none",
        borderRadius: p(6),
        background: "#df7d2e",
        color: "#ffffff",
        fontFamily: "Verdana, sans-serif",
        fontSize: p(10),
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
