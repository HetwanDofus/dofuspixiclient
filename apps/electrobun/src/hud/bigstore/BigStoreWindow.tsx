import { useEffect, useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { ItemData } from "@/game/network/protocol";
import {
  bigStoreStore,
  getOwnListings,
  selectBigStoreLine,
} from "@/game/stores/bigstore-store";
import { characterStore } from "@/game/stores/character-store";
import { getBagItems, inventoryStore } from "@/game/stores/inventory-store";

import { TradeInventoryPanel } from "../exchange/TradeInventoryPanel";
import { BigStoreBuyWindow } from "./BigStoreBuyWindow";
import { BigStoreSellForm } from "./BigStoreSellForm";
import { BigStoreStockPanel } from "./BigStoreStockPanel";
import {
  BIGSTORE_FOOTPRINT,
  BIGSTORE_MARGIN,
  BUY_WINDOW,
  SELL_FORM_PANEL,
  SELL_INVENTORY,
  SELL_INVENTORY_METRICS,
  SELL_LAYOUT,
  SELL_STOCK_PANEL,
} from "./bigstore-theme";

interface BigStoreWindowProps {
  zoom: number;
  gameClient: GameClient | null;
  /** The area above the banner, as `TradeWindow` receives it. */
  playArea: { width: number; height: number };
}

/**
 * The auction house, both modes.
 *
 * Server-driven like the bank and the trade: mounted unconditionally,
 * drawing nothing until an `EC` for type 10 or 11 opens it, and closing
 * on `EV`. It is deliberately outside the `activePanel` rotation — an
 * auction house is not a panel the player toggles, and closing it means
 * leaving the exchange, not hiding a window.
 *
 * Buy mode is one window and centres itself. Sell mode is three, placed
 * the way the retail capture spreads them: the stock bottom left, the
 * listing form in the middle, the bag on the right — the same
 * absolute-placement mechanism `TradeWindow` uses, with `pointerEvents`
 * off on the frame and back on for each piece.
 */
export function BigStoreWindow({
  zoom,
  gameClient,
  playArea,
}: BigStoreWindowProps) {
  const store = useSyncExternalStore(
    bigStoreStore.subscribe,
    bigStoreStore.getSnapshot
  );
  const inventory = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot
  );
  const character = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  const [sellItemId, setSellItemId] = useState<number | null>(null);
  const [hallOnly, setHallOnly] = useState(true);

  const templateId = store.templateId;
  const open = store.open;

  // The average price is a separate round trip (`EHP`), asked for
  // whenever the model on screen changes — the same moment 1.29 asks,
  // from `askMiddlePrice`.
  useEffect(() => {
    if (open && templateId !== null) {
      gameClient?.bigStoreMiddlePrice(templateId);
    }
  }, [open, templateId, gameClient]);

  // A buy window opens on no category at all, and its list is then
  // empty with nothing to say why. Retail lands on the hall's first
  // category; asking for it here is one `EHT`, and it is the only way
  // the window is useful the moment it appears.
  const firstType = store.params?.types[0];
  const hasType = store.typeId !== null;

  useEffect(() => {
    if (open && !hasType && firstType !== undefined) {
      gameClient?.bigStoreBrowseType(firstType);
    }
  }, [open, hasType, firstType, gameClient]);

  if (!store.open) {
    return null;
  }

  // One scale for the whole auction house, both modes — see
  // `BIGSTORE_FOOTPRINT`.
  const z = fitZoom(zoom, playArea, BIGSTORE_FOOTPRINT);
  const q = (n: number) => Math.round(n * z);

  const params = store.params;
  const typeNames = new Map(
    (params?.types ?? []).map((id, index) => [
      id,
      params?.typeNames[index] ?? `Type ${id}`,
    ])
  );

  const leave = () => gameClient?.exchangeLeave();

  if (store.mode === "buy") {
    return (
      <div
        style={{
          position: "absolute",
          left: "50%",
          // Centred both ways, like the sell block: the two modes replace
          // each other in place rather than jumping up the screen.
          top: Math.max(
            q(BIGSTORE_MARGIN),
            Math.round((playArea.height - q(BUY_WINDOW.height)) / 2)
          ),
          transform: "translateX(-50%)",
          pointerEvents: "auto",
        }}
      >
        <BigStoreBuyWindow
          zoom={z}
          store={store}
          templates={inventory.templates}
          typeNames={typeNames}
          kamas={character.kamas}
          weight={inventory.weight}
          onSelectType={(typeId) => gameClient?.bigStoreBrowseType(typeId)}
          onSelectTemplate={(id) => gameClient?.bigStoreBrowseTemplate(id)}
          onBuy={(selection) =>
            gameClient?.bigStoreBuy(
              selection.lineId,
              selection.quantityIndex,
              selection.price
            )
          }
          onSwitchToSell={() => switchMode(gameClient, params?.npcId, 10)}
          onClose={leave}
        />
      </div>
    );
  }

  // ── Sell mode ───────────────────────────────────────────────────────
  const listings = getOwnListings(store);
  const bag = getBagItems(inventory);
  const sellable = hallOnly
    ? bag.filter((item) => {
        const template = inventory.templates.get(item.itemId);
        // A template that has not arrived yet is left in rather than
        // hidden: the alternative is items blinking into the grid as
        // their presentation lands.
        return !template || (params?.types ?? []).includes(template.typeId);
      })
    : bag;

  const sellItem =
    sellItemId === null ? null : (inventory.items.get(sellItemId) ?? null);
  const sellTemplate = sellItem
    ? (inventory.templates.get(sellItem.itemId) ?? null)
    : null;

  // Equipment, weapons and pets carry their own rolls, so they go one at
  // a time. The server enforces this; the form only avoids offering a
  // lot it knows will be refused.
  const unitaryOnly = Boolean(sellTemplate?.positions.length);

  // Three columns, laid out as one block and centred in the play area,
  // horizontally and vertically — the retail spread, minus the overlap
  // retail can afford because its windows can be dragged out of each
  // other's way. Inside the block the three are bottom-aligned, which is
  // how the capture reads: they differ in height, not in baseline.
  const groupWidth = q(SELL_LAYOUT.width);
  const groupHeight = q(SELL_LAYOUT.height);
  const left = Math.max(0, Math.round((playArea.width - groupWidth) / 2));
  const top = Math.max(0, Math.round((playArea.height - groupHeight) / 2));

  const widths = [
    SELL_STOCK_PANEL.width,
    SELL_FORM_PANEL.width,
    SELL_INVENTORY.width,
  ];

  const place = (index: number) => {
    let x = 0;
    for (let i = 0; i < index; i += 1) {
      x += (widths[i] ?? 0) + SELL_LAYOUT.gutter;
    }

    const columnHeight = SELL_LAYOUT.columnHeights[index] ?? 0;

    return {
      position: "absolute" as const,
      left: left + q(x),
      top: top + q(SELL_LAYOUT.height - columnHeight),
    };
  };

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
      <div style={place(0)}>
        <BigStoreStockPanel
          zoom={z}
          listings={listings}
          templates={inventory.templates}
          maxItems={params?.maxItems ?? 0}
          selectedLineId={store.selectedLineId}
          onSelect={selectBigStoreLine}
          onWithdraw={() => {
            if (store.selectedLineId) {
              gameClient?.bigStoreWithdraw(store.selectedLineId);
            }
          }}
          onSwitchToBuy={() => switchMode(gameClient, params?.npcId, 11)}
          onClose={leave}
        />
      </div>

      <div style={place(1)}>
        <BigStoreSellForm
          zoom={z}
          item={sellItem}
          template={sellTemplate}
          lines={store.lines}
          templates={inventory.templates}
          lotSizes={params?.lotSizes ?? [1, 10, 100]}
          unitaryOnly={unitaryOnly}
          taxPercent={params?.taxPercent ?? 0}
          averagePrice={
            sellItem ? store.middlePrices.get(sellItem.itemId) : undefined
          }
          onSell={(lotSize, price) => {
            if (sellItem) {
              gameClient?.bigStoreList(sellItem.unicId, lotSize, price);
            }
          }}
        />
      </div>

      <div style={{ ...place(2), pointerEvents: "auto" }}>
        <TradeInventoryPanel
          zoom={z}
          characterName={character.name}
          height={SELL_INVENTORY.height}
          // No category button pressed is the useful default here: with
          // "Filtrer pour cet HDV" on, the grid then shows exactly what
          // this hall will take, which is the question a seller is
          // actually asking.
          allCategoriesLabel="Tous les objets"
          metrics={SELL_INVENTORY_METRICS}
          floating
          items={sellable}
          templates={inventory.templates}
          kamas={character.kamas}
          weight={inventory.weight}
          selectedUnicId={sellItemId}
          onSelect={(item: ItemData) => {
            setSellItemId((current) =>
              current === item.unicId ? null : item.unicId
            );
            // The form shows what this model already sells for, which is
            // the same `EHl` the buy mode asks for.
            gameClient?.bigStoreBrowseTemplate(item.itemId);
          }}
          actions={[]}
          onClose={leave}
          footer={
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: q(5),
                padding: `0 ${q(8)}px ${q(6)}px`,
                fontFamily: "Verdana, sans-serif",
                fontSize: q(10),
                color: "#4a4437",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={hallOnly}
                onChange={(e) => setHallOnly(e.target.checked)}
              />
              Filtrer pour cet HDV
            </label>
          }
        />
      </div>
    </div>
  );
}

/**
 * How much the HUD's zoom has to be scaled back for a block of this size
 * to fit the play area.
 *
 * Never scales *up*: a small window stays the size the rest of the HUD
 * draws at. This exists because the auction house is the largest thing
 * in the interface — the buy window alone is 703 units against the
 * inventory's 502, and the sell mode is three windows side by side —
 * and because no window in this project can be dragged out of the way.
 */
function fitZoom(
  zoom: number,
  playArea: { width: number; height: number },
  footprint: { width: number; height: number }
): number {
  if (playArea.width <= 0 || playArea.height <= 0) {
    return zoom;
  }

  const margin = BIGSTORE_MARGIN * 2;
  const fit = Math.min(
    playArea.width / ((footprint.width + margin) * zoom),
    playArea.height / ((footprint.height + margin) * zoom),
    1
  );

  return zoom * fit;
}

/**
 * "Mode vente" / "Mode achat" is a fresh `ER` on the other type against
 * the same vendor — `BigStoreSell.as:449` does exactly this. The server
 * closes the open hall before opening the other, so no `EV` is needed
 * here.
 */
function switchMode(
  gameClient: GameClient | null,
  npcId: number | undefined,
  exchangeType: number
): void {
  if (npcId) {
    gameClient?.requestExchange(npcId, exchangeType);
  }
}
