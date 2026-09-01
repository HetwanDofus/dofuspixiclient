import { useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { ItemData } from "@/game/network/protocol";
import { getBagItems, inventoryStore } from "@/game/stores/inventory-store";
import { secureCraftStore } from "@/game/stores/secure-craft-store";

import { Panel } from "../components/Panel";
import { ItemGrid } from "../inventory/ItemGrid";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";

const C = INVENTORY_COLORS;

const WINDOW = { width: 330, height: 466 } as const;
const GRID = { y: 13, width: 145, height: 250 } as const;
const PAY_GRID = { y: 276, width: 145, height: 110 } as const;
const LEFT_X = 12;
const RIGHT_X = 173;
const FOOTER_Y = 394;

/**
 * Crafting for somebody else — exchange types 12 and 13.
 *
 * One window for both ends, because both see the same three piles: the
 * customer's bag, the bench, and what is being offered for the work. What
 * differs is only who may touch what, and the server decides that — the
 * customer lays ingredients and sets the payment, the artisan presses
 * "Créer". Greying the other side's controls here is a courtesy, not the
 * rule.
 *
 * The artisan's own bag is deliberately not shown. The ingredients are the
 * customer's, and an artisan able to add their own would be doing a solo
 * craft with somebody else's name on it.
 */
export function SecureCraftWindow({
  zoom,
  gameClient,
}: {
  zoom: number;
  gameClient: GameClient | null;
}) {
  const craft = useSyncExternalStore(
    secureCraftStore.subscribe,
    secureCraftStore.getSnapshot
  );
  const inventory = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot
  );

  const [kamas, setKamas] = useState("");

  if (!craft.open) {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
  const isCustomer = craft.role === "customer";
  const onBench = new Set([...craft.slots.keys(), ...craft.payItems.keys()]);
  const bag = getBagItems(inventory).filter(
    (item) => !onBench.has(item.unicId)
  );

  const bagActions = [
    {
      label: "Poser sur l'établi",
      enabled: () => isCustomer,
      run: (item: ItemData) =>
        gameClient?.exchangeMoveItem(item.unicId, true, item.quantity),
    },
    {
      label: "Offrir en paiement",
      enabled: () => isCustomer,
      run: (item: ItemData) =>
        gameClient?.movePayItem(item.unicId, true, item.quantity),
    },
  ];

  return (
    <Panel
      title={isCustomer ? "Faire fabriquer" : "Fabriquer pour"}
      width={WINDOW.width}
      height={WINDOW.height}
      zoom={zoom}
      onClose={() => gameClient?.exchangeLeave()}
      style={{ pointerEvents: "auto" }}
    >
      {/* The customer's bag. The artisan sees an empty column, which is
          honest: they have nothing to put in. */}
      <ItemGrid
        zoom={zoom}
        title={isCustomer ? "Mon inventaire" : "Inventaire du client"}
        box={{ x: LEFT_X, ...GRID }}
        items={isCustomer ? bag : []}
        templates={inventory.templates}
        selectedUnicId={null}
        onSelect={() => {}}
        actions={bagActions}
      />

      <ItemGrid
        zoom={zoom}
        title="Recette"
        box={{ x: RIGHT_X, ...GRID }}
        items={[...craft.slots.values()]}
        templates={inventory.templates}
        selectedUnicId={null}
        onSelect={() => {}}
        showFilters={false}
        actions={[
          {
            label: "Retirer",
            enabled: () => isCustomer,
            run: (item: ItemData) =>
              gameClient?.exchangeMoveItem(item.unicId, false, 0),
          },
        ]}
      />

      <ItemGrid
        zoom={zoom}
        title="Paiement"
        box={{ x: RIGHT_X, ...PAY_GRID }}
        items={[...craft.payItems.values()]}
        templates={inventory.templates}
        selectedUnicId={null}
        onSelect={() => {}}
        showFilters={false}
        actions={[
          {
            label: "Retirer",
            enabled: () => isCustomer,
            run: (item: ItemData) =>
              gameClient?.movePayItem(item.unicId, false, 0),
          },
        ]}
      />

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(PAY_GRID.y),
          width: p(GRID.width),
          fontSize: p(9),
          display: "flex",
          flexDirection: "column",
          gap: p(4),
        }}
      >
        <div>Kamas offerts : {craft.payKamas}</div>

        {isCustomer && (
          <div style={{ display: "flex", gap: p(4) }}>
            <input
              value={kamas}
              onChange={(e) => setKamas(e.target.value.replace(/\D/g, ""))}
              placeholder="Kamas"
              aria-label="Kamas offerts"
              style={{ flex: 1, minWidth: 0, fontSize: p(9) }}
            />
            <button
              type="button"
              onClick={() => {
                gameClient?.movePayKamas(Number.parseInt(kamas, 10) || 0);
                setKamas("");
              }}
              style={{ fontSize: p(9), cursor: "pointer" }}
            >
              Offrir
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(FOOTER_Y),
          width: p(WINDOW.width - LEFT_X * 2),
          fontSize: p(9),
          color:
            craft.outcome === "success"
              ? "#8fae4a"
              : craft.outcome === "failure"
                ? "#b4523c"
                : C.text,
        }}
      >
        {craft.outcome === "success" && "Fabrication réussie."}
        {craft.outcome === "failure" &&
          "La fabrication a échoué. Les ingrédients sont perdus."}
      </div>

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(FOOTER_Y + 20),
          width: p(WINDOW.width - LEFT_X * 2),
          display: "flex",
          gap: p(4),
        }}
      >
        {!isCustomer && (
          <button
            type="button"
            disabled={craft.slots.size === 0}
            onClick={() => gameClient?.craftOnce()}
            style={{
              flex: 1,
              fontSize: p(9),
              opacity: craft.slots.size === 0 ? 0.45 : 1,
              cursor: craft.slots.size === 0 ? "default" : "pointer",
            }}
          >
            Créer
          </button>
        )}

        {isCustomer && (
          <div style={{ flex: 1, fontSize: p(9), opacity: 0.75 }}>
            L'artisan lancera la fabrication.
          </div>
        )}
      </div>
    </Panel>
  );
}
