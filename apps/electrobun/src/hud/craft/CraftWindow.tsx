import { useEffect, useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { ItemData } from "@/game/network/protocol";
import {
  craftRecipeTone,
  loadCraftsLang,
  matchCraftRecipe,
} from "@/game/lang/crafts-lang";
import { jobsLangSnapshot } from "@/game/lang/jobs-lang";
import { craftStore } from "@/game/stores/craft-store";
import { getBagItems, inventoryStore } from "@/game/stores/inventory-store";

import { Panel } from "../components/Panel";
import { ItemGrid } from "../inventory/ItemGrid";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";

const C = INVENTORY_COLORS;

/**
 * Same geometry as the bank, and deliberately: 1.29 draws its craft window
 * on the same chrome, and reusing `StorageWindow`'s numbers keeps the cells
 * the size every other grid in the game draws them.
 */
const WINDOW = { width: 330, height: 426 } as const;
const GRID = { y: 13, width: 145, height: 345 } as const;
const LEFT_X = 12;
const RIGHT_X = 173;
const FOOTER_Y = 366;

/** How many rounds "Créer ×N" asks for. */
const SERIES_SIZE = 10;

/**
 * The workbench — exchange type 3.
 *
 * Server-driven like the bank: it opens on `EC` and closes on `EV`, so it
 * sits outside the `activePanel` rotation and opening it must not close the
 * inventory.
 *
 * The right pane is not a container. Nothing laid there has left the bag —
 * the server holds the bench in memory and moves rows only when the craft
 * commits — which is why the two grids can both be drawn from the live
 * inventory store without either of them lying.
 */
export function CraftWindow({
  zoom,
  gameClient,
}: {
  zoom: number;
  gameClient: GameClient | null;
}) {
  const craft = useSyncExternalStore(
    craftStore.subscribe,
    craftStore.getSnapshot
  );
  const inventory = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot
  );

  const [selected, setSelected] = useState<number | null>(null);
  const [craftRecipes, setCraftRecipes] = useState<Awaited<
    ReturnType<typeof loadCraftsLang>
  > | null>(null);

  useEffect(() => {
    void loadCraftsLang().then(setCraftRecipes);
  }, []);

  if (!craft.open) {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
  const laid = [...craft.slots.values()];
  const onBench = new Set(craft.slots.keys());
  // A stack already on the bench is drawn on the right, not twice.
  const bag = getBagItems(inventory).filter(
    (item) => !onBench.has(item.unicId)
  );
  const skillName =
    jobsLangSnapshot()?.skills.get(craft.skillId)?.label ?? "Atelier";
  const skill = jobsLangSnapshot()?.skills.get(craft.skillId);
  const recipe = matchCraftRecipe(
    skill?.craftItemIds ?? [],
    laid,
    craftRecipes
  );
  const recipeTone = craftRecipeTone(
    recipe?.ingredients.length ?? 0,
    craft.maxSlots
  );
  const full = craft.slots.size >= craft.maxSlots;

  const lay = (item: ItemData, quantity: number) => {
    gameClient?.exchangeMoveItem(
      item.unicId,
      true,
      Math.min(quantity, item.quantity)
    );
  };

  const bagActions = [
    {
      label: "Poser",
      enabled: () => !full,
      run: (item: ItemData) => lay(item, 1),
    },
    {
      label: "Poser 10",
      enabled: (item: ItemData) => !full && item.quantity > 1,
      run: (item: ItemData) => lay(item, 10),
    },
    {
      label: "Tout poser",
      enabled: (item: ItemData) => !full && item.quantity > 1,
      run: (item: ItemData) => lay(item, item.quantity),
    },
  ];

  const benchActions = [
    {
      label: "Retirer",
      enabled: () => true,
      run: (item: ItemData) =>
        gameClient?.exchangeMoveItem(item.unicId, false, 0),
    },
  ];

  const running = craft.seriesRemaining > 0;

  return (
    <Panel
      title={skillName}
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
        actions={bagActions}
      />

      <ItemGrid
        zoom={zoom}
        title={`Recette (${craft.slots.size}/${craft.maxSlots})`}
        box={{ x: RIGHT_X, ...GRID }}
        items={laid}
        templates={inventory.templates}
        selectedUnicId={selected}
        onSelect={(item) => setSelected(item.unicId)}
        actions={benchActions}
        showFilters={false}
      />

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(FOOTER_Y - 10),
          width: p(WINDOW.width - LEFT_X * 2),
          height: p(12),
          fontFamily: "Verdana, sans-serif",
          fontSize: p(9),
          color: recipeColor(recipeTone),
        }}
      >
        {recipe
          ? `Résultat : ${recipe.resultName}`
          : craft.slots.size > 0
            ? "Recette inconnue"
            : ""}
      </div>

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(FOOTER_Y + 4),
          width: p(WINDOW.width - LEFT_X * 2),
          height: p(12),
          fontFamily: "Verdana, sans-serif",
          fontSize: p(9),
          color: outcomeColor(craft.outcome),
        }}
      >
        {outcomeLabel(craft)}
      </div>

      <div
        style={{
          position: "absolute",
          left: p(LEFT_X),
          top: p(FOOTER_Y + 22),
          width: p(WINDOW.width - LEFT_X * 2),
          display: "flex",
          gap: p(4),
        }}
      >
        <CraftButton
          zoom={zoom}
          label="Créer"
          disabled={running || craft.slots.size === 0}
          onClick={() => gameClient?.craftOnce()}
        />
        <CraftButton
          zoom={zoom}
          label={`Créer ×${SERIES_SIZE}`}
          disabled={running || craft.slots.size === 0}
          onClick={() => gameClient?.craftSeries(SERIES_SIZE)}
        />
        <CraftButton
          zoom={zoom}
          label="Arrêter"
          disabled={!running}
          onClick={() => gameClient?.stopCraftSeries()}
        />
      </div>
    </Panel>
  );
}

function recipeColor(tone: "none" | "grey" | "green" | "red"): string {
  if (tone === "grey") {
    return "#858585";
  }
  if (tone === "green") {
    return "#8fae4a";
  }
  if (tone === "red") {
    return "#b4523c";
  }
  return C.text;
}

function outcomeLabel(craft: {
  outcome: string;
  seriesRemaining: number;
  seriesCrafted: number;
}): string {
  if (craft.seriesRemaining > 0) {
    return `Fabrication en série — ${craft.seriesRemaining} restantes`;
  }

  if (craft.seriesCrafted > 0) {
    return `Série terminée — ${craft.seriesCrafted} fabriqués`;
  }

  if (craft.outcome === "success") {
    return "Fabrication réussie.";
  }

  if (craft.outcome === "failure") {
    // Worth saying out loud, because the ingredients are gone either way.
    return "La fabrication a échoué. Les ingrédients sont perdus.";
  }

  return "";
}

function outcomeColor(outcome: string): string {
  if (outcome === "success") {
    return "#8fae4a";
  }

  if (outcome === "failure") {
    return "#b4523c";
  }

  return C.text;
}

function CraftButton({
  zoom,
  label,
  disabled,
  onClick,
}: {
  zoom: number;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        height: p(18),
        border: "none",
        borderRadius: p(4),
        fontFamily: "Verdana, sans-serif",
        fontSize: p(9),
        color: C.text,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
