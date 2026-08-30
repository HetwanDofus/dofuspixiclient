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

import { ItemDetailPanel } from "../inventory/ItemDetailPanel";
import { TradeInventoryPanel } from "./TradeInventoryPanel";
import { TradeOfferPanel } from "./TradeOfferPanel";
import {
  TRADE_ARROW,
  TRADE_BUTTON_HEIGHT,
  TRADE_DETAIL_PANEL,
  TRADE_MARGIN,
  TRADE_OFFER_PANEL,
} from "./trade-theme";

/**
 * Player to player — exchange type 1.
 *
 * Not a window: retail floats **three** of them, and this is what places
 * them. The bag browser goes top right, the two offer boards along the
 * bottom (the partner's on the left, yours on the right) with the exchange
 * arrow between, and the item card — the same one the inventory draws —
 * top left, only while something is selected.
 *
 * The bag it hands the browser is the live inventory store minus whatever
 * is already on your side of the table, so an offered stack visibly leaves
 * the bag. That is display only: `TradeFlow.moveItem` writes nothing until
 * both players validate, and no inventory frame arrives in the meantime.
 * The offer is the server's, the subtraction is ours.
 */
export function TradeWindow({
  zoom,
  gameClient,
  playArea,
}: {
  zoom: number;
  gameClient: GameClient | null;
  /** The play area, in CSS px — everything above the banner. */
  playArea: { width: number; height: number };
}) {
  const trade = useSyncExternalStore(
    tradeStore.subscribe,
    tradeStore.getSnapshot
  );
  const inventory = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot
  );
  const { name, kamas } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  const [selected, setSelected] = useState<number | null>(null);
  const locked = useValidateLock(trade.changedAt, trade.phase === "open");

  if (trade.phase !== "open") {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
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

  /**
   * The whole stack, as the server still sees it.
   *
   * The cells below are drawn with the *remaining* quantity, so their
   * `item.quantity` is not what a "tout proposer" should send — it would
   * cap the offer at what is left in the bag.
   */
  const owned = (item: ItemData) =>
    inventory.items.get(item.unicId)?.quantity ?? item.quantity;

  const bag = getBagItems(inventory).flatMap((item) => {
    const left = item.quantity - offered(item.unicId);
    return left > 0 ? [{ ...item, quantity: left }] : [];
  });

  const propose = (item: ItemData, quantity: number) => {
    gameClient?.exchangeMoveItem(
      item.unicId,
      true,
      Math.min(quantity, owned(item))
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
      enabled: (item: ItemData) => owned(item) > 1,
      run: (item: ItemData) => propose(item, offered(item.unicId) + 10),
    },
    {
      label: "Tout proposer",
      enabled: (item: ItemData) => owned(item) > 1,
      run: (item: ItemData) => propose(item, owned(item)),
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

  // Clicking a cell opens its card; clicking it again closes it, the same
  // toggle the inventory window uses.
  const select = (item: ItemData) =>
    setSelected((current) => (current === item.unicId ? null : item.unicId));

  // A selected stack can sit in any of the three grids, and the two offers
  // hold the authoritative copy of anything on the table — look there
  // first so the card shows the offered quantity, not the bag's.
  const selectedItem =
    selected === null
      ? null
      : (trade.mine.items.get(selected) ??
        trade.theirs.items.get(selected) ??
        inventory.items.get(selected) ??
        null);
  const selectedTemplate = selectedItem
    ? (inventory.templates.get(selectedItem.itemId) ?? null)
    : null;

  const offerRowHeight = p(TRADE_OFFER_PANEL.height + 4 + TRADE_BUTTON_HEIGHT);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: playArea.width,
        height: playArea.height,
        pointerEvents: "none",
      }}
    >
      {selectedItem && selectedTemplate && (
        <div
          style={{
            position: "absolute",
            left: p(TRADE_MARGIN),
            top: p(TRADE_MARGIN),
            width: p(TRADE_DETAIL_PANEL.width),
            height: p(TRADE_DETAIL_PANEL.height),
            // The white rounded chrome every 1.29 window carries; the card
            // itself draws its own dark name/level header inside it.
            border: `${p(3)}px solid #ffffff`,
            borderBottom: "none",
            borderRadius: `${p(13)}px ${p(13)}px 0 0`,
            overflow: "hidden",
            pointerEvents: "auto",
          }}
        >
          <ItemDetailPanel
            zoom={zoom}
            item={selectedItem}
            template={selectedTemplate}
            box={{ x: 0, y: 0, ...TRADE_DETAIL_PANEL }}
          />
        </div>
      )}

      <div
        style={{
          position: "absolute",
          right: p(TRADE_MARGIN),
          top: p(TRADE_MARGIN),
          pointerEvents: "auto",
        }}
      >
        <TradeInventoryPanel
          zoom={zoom}
          characterName={name}
          items={bag}
          templates={inventory.templates}
          kamas={kamas}
          weight={inventory.weight}
          selectedUnicId={selected}
          onSelect={select}
          actions={bagActions}
          onClose={() => gameClient?.exchangeLeave()}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: p(TRADE_MARGIN),
          right: p(TRADE_MARGIN),
          bottom: p(TRADE_MARGIN),
          height: offerRowHeight,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: p(8),
          pointerEvents: "auto",
        }}
      >
        <TradeOfferPanel
          zoom={zoom}
          title={trade.partnerName || "Son offre"}
          items={theirs}
          templates={inventory.templates}
          kamas={trade.theirs.kamas}
          ready={trade.theirs.ready}
          selectedUnicId={selected}
          onSelect={select}
          // Taking things off somebody else's side of the table is not a
          // thing a trade lets you do.
          actions={[]}
          button={{ label: "Message privé", disabled: true }}
        />

        <ExchangeArrow zoom={zoom} />

        <TradeOfferPanel
          zoom={zoom}
          title=""
          items={mine}
          templates={inventory.templates}
          kamas={trade.mine.kamas}
          ready={trade.mine.ready}
          selectedUnicId={selected}
          onSelect={select}
          actions={mineActions}
          onKamas={(quantity) => gameClient?.exchangeMoveKamas(quantity)}
          button={{
            label: trade.mine.ready ? "Annuler" : "Accepter",
            // The three-second lock after any change, canonical
            // `DELAY_BEFORE_VALIDATE`. It is what stops a partner from
            // swapping the offer under a finger already on its way down.
            disabled: locked,
            onClick: () => gameClient?.exchangeSetReady(),
          }}
        />
      </div>
    </div>
  );
}

/**
 * The double arrow between the two boards. Drawn inline — there is no
 * extracted asset for it, same case as `EquipmentPanel`'s mount cross.
 */
function ExchangeArrow({ zoom }: { zoom: number }) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <svg
      width={p(TRADE_ARROW.width)}
      height={p(TRADE_ARROW.height)}
      viewBox="0 0 54 32"
      aria-hidden="true"
      style={{ alignSelf: "center", flexShrink: 0 }}
    >
      <path
        d="M14 10 H40 V4 L52 16 L40 28 V22 H14 V28 L2 16 L14 4 Z"
        fill="#e9e6d4"
        stroke="#6b6552"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
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
