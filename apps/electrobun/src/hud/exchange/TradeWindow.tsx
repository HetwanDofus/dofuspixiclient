import { useEffect, useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { ItemData } from "@/game/network/protocol";
import { characterStore } from "@/game/stores/character-store";
import { getBagItems, inventoryStore } from "@/game/stores/inventory-store";
import {
  getTradeItems,
  tradeStore,
  VALIDATE_DELAY_MS,
} from "@/game/stores/trade-store";

import { Panel } from "../components/Panel";
import { ItemGrid } from "../inventory/ItemGrid";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";

const C = INVENTORY_COLORS;

/**
 * Geometry, in the same base units as `inventory-theme`.
 *
 * The inventory keeps `RESOURCES_BOX`'s 145 so its cells are drawn at
 * the size every other 1.29 grid draws them; the two offer panes are the
 * same width, stacked, and shorter because they hold a handful of stacks
 * rather than a bag.
 */
const WINDOW = { width: 330, height: 470 } as const;
const LEFT_X = 12;
const RIGHT_X = 173;
const INVENTORY = { y: 13, width: 145, height: 345 } as const;
const OFFER = { width: 145, height: 158 } as const;
const THEIRS_Y = 13;
const MINE_Y = 200;
const KAMAS_Y = 366;
const FOOTER_Y = 400;

/**
 * Player to player — exchange type 1.
 *
 * Three grids in one panel: the live inventory on the left, the
 * partner's offer and mine on the right. Retail floats them as three
 * separate windows; one panel is the shape `StorageWindow` already
 * established here, and it means opening a trade cannot fight the
 * `activePanel` rotation for the inventory.
 *
 * The left grid reads the **live** inventory store, unlike canonical
 * 1.29 which clones it and moves quantities into a "garbage" pile. The
 * clone exists there so the client can show an offered stack leaving the
 * bag before the server has agreed to anything. Here nothing leaves the
 * bag until the trade commits — the offer is server state — so a clone
 * would only be a second copy to keep in step.
 */
export function TradeWindow({
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
  const inventory = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot
  );
  const { kamas } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  const [selected, setSelected] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const locked = useValidateLock(trade.changedAt, trade.phase === "open");

  if (trade.phase !== "open") {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
  const bag = getBagItems(inventory);
  const mine = getTradeItems(trade.mine);
  const theirs = getTradeItems(trade.theirs);

  /**
   * How much of a stack is already on the table.
   *
   * The offer is absolute, so "propose 1 more" is "propose n+1" —
   * without this, double-clicking a stack twice would offer one unit
   * twice and look like nothing happened the second time.
   */
  const offered = (unicId: number) =>
    trade.mine.items.get(unicId)?.quantity ?? 0;

  const propose = (item: ItemData, quantity: number) => {
    gameClient?.exchangeMoveItem(
      item.unicId,
      true,
      Math.min(quantity, item.quantity)
    );
  };

  const bagActions = [
    {
      label: "Proposer",
      enabled: () => true,
      run: (item: ItemData) => propose(item, offered(item.unicId) + 1),
    },
    {
      label: "Proposer 10",
      enabled: (item: ItemData) => item.quantity > 1,
      run: (item: ItemData) => propose(item, offered(item.unicId) + 10),
    },
    {
      label: "Tout proposer",
      enabled: (item: ItemData) => item.quantity > 1,
      run: (item: ItemData) => propose(item, item.quantity),
    },
  ];

  const mineActions = [
    {
      label: "Retirer",
      enabled: () => true,
      run: (item: ItemData) => {
        const left = item.quantity - 1;

        if (left > 0) {
          gameClient?.exchangeMoveItem(item.unicId, true, left);
          return;
        }

        gameClient?.exchangeMoveItem(item.unicId, false, 0);
      },
    },
    {
      label: "Tout retirer",
      enabled: () => true,
      run: (item: ItemData) =>
        gameClient?.exchangeMoveItem(item.unicId, false, 0),
    },
  ];

  const offerKamas = () => {
    const value = Number.parseInt(amount, 10);

    if (!Number.isFinite(value) || value < 0) {
      return;
    }

    gameClient?.exchangeMoveKamas(value);
    setAmount("");
  };

  return (
    <Panel
      title="Echange"
      width={WINDOW.width}
      height={WINDOW.height}
      zoom={zoom}
      onClose={() => gameClient?.exchangeLeave()}
      style={{ pointerEvents: "auto" }}
    >
      <ItemGrid
        zoom={zoom}
        title="Inventaire"
        box={{ x: LEFT_X, ...INVENTORY }}
        items={bag}
        templates={inventory.templates}
        selectedUnicId={selected}
        onSelect={(item) => setSelected(item.unicId)}
        actions={bagActions}
      />

      <OfferPane
        zoom={zoom}
        x={RIGHT_X}
        y={THEIRS_Y}
        ready={trade.theirs.ready}
      >
        <ItemGrid
          zoom={zoom}
          title={trade.partnerName || "Son offre"}
          box={{ x: RIGHT_X, y: THEIRS_Y, ...OFFER }}
          items={theirs}
          templates={inventory.templates}
          selectedUnicId={selected}
          onSelect={(item) => setSelected(item.unicId)}
          // No actions: taking things off somebody else's side of the
          // table is not a thing a trade lets you do.
          actions={[]}
          showFilters={false}
        />
      </OfferPane>

      <OfferPane zoom={zoom} x={RIGHT_X} y={MINE_Y} ready={trade.mine.ready}>
        <ItemGrid
          zoom={zoom}
          title="Vous"
          box={{ x: RIGHT_X, y: MINE_Y, ...OFFER }}
          items={mine}
          templates={inventory.templates}
          selectedUnicId={selected}
          onSelect={(item) => setSelected(item.unicId)}
          actions={mineActions}
          showFilters={false}
        />
      </OfferPane>

      <KamasRow
        zoom={zoom}
        x={LEFT_X}
        width={INVENTORY.width}
        label="Bourse"
        value={kamas}
      />
      <KamasRow
        zoom={zoom}
        x={RIGHT_X}
        width={OFFER.width}
        label="Sur la table"
        value={trade.mine.kamas}
      />

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(FOOTER_Y),
          width: p(WINDOW.width - LEFT_X * 2),
          display: "flex",
          gap: p(4),
          alignItems: "center",
        }}
      >
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          placeholder="Kamas"
          aria-label="Kamas à proposer"
          style={{
            flex: 1,
            minWidth: 0,
            height: p(20),
            boxSizing: "border-box",
            border: "none",
            borderRadius: p(4),
            padding: `0 ${p(5)}px`,
            fontFamily: "Verdana, sans-serif",
            fontSize: p(9),
            color: C.text,
          }}
        />
        <FooterButton zoom={zoom} label="Proposer" onClick={offerKamas} />
        <FooterButton zoom={zoom} label="Message privé" disabled />
        <FooterButton
          zoom={zoom}
          label={trade.mine.ready ? "Annuler" : "Accepter"}
          // The three-second lock after any change, canonical
          // `DELAY_BEFORE_VALIDATE`. It is what stops a partner from
          // swapping the offer under a finger already on its way down.
          disabled={locked}
          onClick={() => gameClient?.exchangeSetReady()}
        />
      </div>
    </Panel>
  );
}

/**
 * Re-render once the validate lock expires.
 *
 * The lock is a deadline, not a flag, so nothing pushes a change when it
 * passes — hence the timer. Re-armed on every `changedAt`, which is
 * stamped by both offers.
 */
function useValidateLock(changedAt: number, active: boolean): boolean {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    const left = changedAt + VALIDATE_DELAY_MS - performance.now();

    if (left <= 0) {
      return;
    }

    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [changedAt, active]);

  return active && performance.now() < changedAt + VALIDATE_DELAY_MS;
}

/**
 * The tint canonical `updateReadyState` applies to a validated half of
 * the window. Both panes carry it, each from its own flag.
 */
function OfferPane({
  zoom,
  x,
  y,
  ready,
  children,
}: {
  zoom: number;
  x: number;
  y: number;
  ready: boolean;
  children: React.ReactNode;
}) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <>
      {children}
      {ready && (
        <div
          style={{
            position: "absolute",
            left: p(x),
            top: p(y),
            width: p(OFFER.width),
            height: p(OFFER.height),
            borderRadius: p(10),
            boxShadow: `inset 0 0 0 ${p(2)}px #7ac943`,
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}

function KamasRow({
  zoom,
  x,
  width,
  label,
  value,
}: {
  zoom: number;
  x: number;
  width: number;
  label: string;
  value: number;
}) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <div
      style={{
        position: "absolute",
        left: p(x),
        top: p(KAMAS_Y),
        width: p(width),
        height: p(20),
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${p(6)}px`,
        boxSizing: "border-box",
        background: C.boxBg,
        borderRadius: p(6),
        fontFamily: "Verdana, sans-serif",
        fontSize: p(9),
        color: C.kamasText,
      }}
    >
      <span>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: p(3) }}>
        {value.toLocaleString("fr-FR")}
        <img
          src="/themes/classic/assets/panels/inventory/kamas.svg"
          alt=""
          style={{ width: p(10), height: p(10) }}
        />
      </span>
    </div>
  );
}

function FooterButton({
  zoom,
  label,
  onClick,
  disabled,
}: {
  zoom: number;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: p(20),
        padding: `0 ${p(8)}px`,
        border: "none",
        borderRadius: p(6),
        background: "#df7d2e",
        color: "#ffffff",
        fontFamily: "Verdana, sans-serif",
        fontSize: p(9),
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
