import { useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { ItemData } from "@/game/network/protocol";
import { characterStore } from "@/game/stores/character-store";
import { exchangeStore, getExchangeItems } from "@/game/stores/exchange-store";
import { getBagItems, inventoryStore } from "@/game/stores/inventory-store";

import { Panel } from "../components/Panel";
import { ItemGrid } from "../inventory/ItemGrid";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";

const C = INVENTORY_COLORS;

/**
 * Window geometry, in the same base units as `inventory-theme`.
 *
 * Two grids of the bag's own width side by side: the retail Storage
 * window is symmetrical, and reusing `RESOURCES_BOX`'s 145 keeps the
 * cells at the size every other 1.29 grid draws them.
 */
const WINDOW = { width: 330, height: 426 } as const;
const GRID = { y: 13, width: 145, height: 345 } as const;
const LEFT_X = 12;
const RIGHT_X = 173;
const FOOTER_Y = 366;

/**
 * The bank and the house chest — exchange type 5.
 *
 * Server-driven, like the NPC dialogue: it opens on `EC` and closes on
 * `EV`, so it lives outside the `activePanel` rotation the keyboard
 * panels share. Opening the bank must not close the inventory.
 *
 * The left half is the live inventory store, not a copy — canonical
 * `Storage.initData` binds `Player.Inventory` directly, and only the
 * player-to-player trade clones it, because only a trade has an offer
 * that can be cancelled. Here every movement has already committed by
 * the time the client hears about it.
 */
export function StorageWindow({
  zoom,
  gameClient,
}: {
  zoom: number;
  gameClient: GameClient | null;
}) {
  const exchange = useSyncExternalStore(
    exchangeStore.subscribe,
    exchangeStore.getSnapshot
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

  if (!exchange.open) {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
  const bag = getBagItems(inventory);
  const stored = getExchangeItems(exchange);

  const move = (item: ItemData, toContainer: boolean, quantity: number) => {
    gameClient?.exchangeMoveItem(
      item.unicId,
      toContainer,
      Math.min(quantity, item.quantity)
    );
  };

  /**
   * Canonical `Storage.moveItem` sends one unit on a double-click and
   * the whole stack when Ctrl is held. `ItemGrid` runs the first action
   * on a double-click, so listing "Transférer" first reproduces the
   * single-unit default and the rest stay available from the menu.
   */
  const actions = (toContainer: boolean) => [
    {
      label: "Transférer",
      enabled: () => true,
      run: (item: ItemData) => move(item, toContainer, 1),
    },
    {
      label: "Transférer 10",
      enabled: (item: ItemData) => item.quantity > 1,
      run: (item: ItemData) => move(item, toContainer, 10),
    },
    {
      label: "Tout transférer",
      enabled: (item: ItemData) => item.quantity > 1,
      run: (item: ItemData) => move(item, toContainer, item.quantity),
    },
  ];

  const moveKamas = (sign: 1 | -1) => {
    const value = Number.parseInt(amount, 10);

    if (!Number.isFinite(value) || value <= 0) {
      return;
    }

    gameClient?.exchangeMoveKamas(sign * value);
    setAmount("");
  };

  return (
    <Panel
      title="Coffre"
      width={WINDOW.width}
      height={WINDOW.height}
      zoom={zoom}
      onClose={() => gameClient?.exchangeLeave()}
      style={{ pointerEvents: "auto" }}
    >
      <ItemGrid
        zoom={zoom}
        title="Inventaire"
        box={{ x: LEFT_X, ...GRID }}
        items={bag}
        templates={inventory.templates}
        selectedUnicId={selected}
        onSelect={(item) => setSelected(item.unicId)}
        actions={actions(true)}
      />

      <ItemGrid
        zoom={zoom}
        title="Coffre"
        box={{ x: RIGHT_X, ...GRID }}
        items={stored}
        templates={inventory.templates}
        selectedUnicId={selected}
        onSelect={(item) => setSelected(item.unicId)}
        actions={actions(false)}
      />

      <KamasRow
        zoom={zoom}
        x={LEFT_X}
        width={GRID.width}
        label="Vous"
        value={kamas}
      />
      <KamasRow
        zoom={zoom}
        x={RIGHT_X}
        width={GRID.width}
        label="Coffre"
        value={exchange.kamas}
      />

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(FOOTER_Y + 26),
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
          aria-label="Montant en kamas"
          style={{
            flex: 1,
            minWidth: 0,
            height: p(18),
            boxSizing: "border-box",
            border: "none",
            borderRadius: p(4),
            padding: `0 ${p(5)}px`,
            fontFamily: "Verdana, sans-serif",
            fontSize: p(9),
            color: C.text,
          }}
        />
        <KamasButton zoom={zoom} label="Déposer" onClick={() => moveKamas(1)} />
        <KamasButton
          zoom={zoom}
          label="Retirer"
          onClick={() => moveKamas(-1)}
        />
      </div>
    </Panel>
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
        top: p(FOOTER_Y),
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
          alt="kamas"
          draggable={false}
          style={{ width: p(11), height: p(11) }}
        />
      </span>
    </div>
  );
}

function KamasButton({
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
        height: p(18),
        padding: `0 ${p(8)}px`,
        border: "none",
        borderRadius: p(4),
        background: "#df7d2e",
        color: "#ffffff",
        fontFamily: "Verdana, sans-serif",
        fontSize: p(9),
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
