import { useEffect, useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { CraftsLang } from "@/game/lang/crafts-lang";
import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import { loadCraftsLang, matchCraftRecipe } from "@/game/lang/crafts-lang";
import { type JobsLang, loadJobsLang } from "@/game/lang/jobs-lang";
import { characterStore } from "@/game/stores/character-store";
import { showContextMenu } from "@/game/stores/context-menu-store";
import { craftStore } from "@/game/stores/craft-store";
import { getBagItems, inventoryStore } from "@/game/stores/inventory-store";

import { Panel } from "../components/Panel";
import { Scrollbar } from "../components/Scrollbar";
import { useTooltip } from "../components/Tooltip";
import { ItemIcon } from "../inventory/ItemIcon";
import { FILTER_CATEGORIES } from "../inventory/inventory-theme";
import { TypeSelect } from "../inventory/TypeSelect";
import { useItemFilters } from "../inventory/use-item-filters";
import {
  CRAFT_BENCH,
  CRAFT_COLORS,
  CRAFT_COLUMN,
  CRAFT_LAYOUT,
  CRAFT_OBTAINED,
  CRAFT_QUANTITIES,
  CRAFT_RECIPES,
  CRAFT_WINDOW,
} from "./craft-theme";
import { RecipeBookPanel } from "./RecipeBookPanel";

const C = CRAFT_COLORS;
const GRID_ASSET_BASE = "/themes/classic/assets/panels/inventory";

/**
 * The three category buttons retail draws in the craft window, in the
 * order the capture has them. The bag's own row has nine; a bench does
 * not, and the missing six are not a simplification of this port —
 * `screenshot-ui/craft_menu.png` shows exactly these three.
 */
const CRAFT_FILTER_IDS = ["equipment", "consumables", "resources"] as const;

/**
 * The workbench — exchange type 3.
 *
 * Server-driven like the bank: it opens on `EC` and closes on `EV`, so it
 * sits outside the `activePanel` rotation and opening it must not close
 * the inventory.
 *
 * Laid out after `screenshot-ui/craft_menu.png`, which is four separate
 * pieces rather than one window: the skill caption, the bag window, the
 * bench strip with its button row, and the "Objet obtenu" box facing them
 * from the far side of the play area. `craft-theme.ts` carries the
 * measurements and how they were taken.
 *
 * The bench is not a container. Nothing laid there has left the bag — the
 * server holds it in memory and moves rows only when the craft commits —
 * which is why both the grid and the strip can be drawn from the live
 * inventory store without either of them lying.
 */
export function CraftWindow({
  zoom,
  gameClient,
  playArea,
}: {
  zoom: number;
  gameClient: GameClient | null;
  playArea: { width: number; height: number };
}) {
  const craft = useSyncExternalStore(
    craftStore.subscribe,
    craftStore.getSnapshot
  );
  const inventory = useSyncExternalStore(
    inventoryStore.subscribe,
    inventoryStore.getSnapshot
  );
  const { name: characterName } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  const [selected, setSelected] = useState<number | null>(null);
  const [quantityIndex, setQuantityIndex] = useState(0);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [craftsLang, setCraftsLang] = useState<CraftsLang | null>(null);
  const [jobsLang, setJobsLang] = useState<JobsLang | null>(null);

  useEffect(() => {
    void loadCraftsLang().then(setCraftsLang);
    void loadJobsLang().then(setJobsLang);
  }, []);

  const laid = [...craft.slots.values()];
  const recipe = matchCraftRecipe(
    jobsLang?.skills.get(craft.skillId)?.craftItemIds ?? [],
    laid,
    craftsLang?.recipes ?? null
  );

  // Kept so the result box still shows what came out after a craft: the
  // server empties the bench on every attempt, so by the time `Ec` says
  // "réussie" there is nothing left to match a recipe against.
  const [lastResultItemId, setLastResultItemId] = useState<number | null>(null);
  const matchedResultId = recipe?.resultItemId ?? null;
  useEffect(() => {
    if (matchedResultId !== null) {
      setLastResultItemId(matchedResultId);
    }
  }, [matchedResultId]);

  if (!craft.open) {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
  const skill = jobsLang?.skills.get(craft.skillId);
  const skillName = skill?.label ?? "Atelier";

  // A stack already on the bench is drawn in the strip, not twice.
  const onBench = new Set(craft.slots.keys());
  const bag = getBagItems(inventory).filter(
    (item) => !onBench.has(item.unicId)
  );

  const full = craft.slots.size >= craft.maxSlots;
  const running = craft.seriesRemaining > 0;
  const quantity = CRAFT_QUANTITIES[quantityIndex] ?? 1;

  const lay = (item: ItemData, amount: number) => {
    gameClient?.exchangeMoveItem(
      item.unicId,
      true,
      Math.min(amount, item.quantity)
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

  const combine = () => {
    if (running) {
      gameClient?.stopCraftSeries();
    } else if (quantity <= 1) {
      gameClient?.craftOnce();
    } else {
      gameClient?.craftSeries(quantity);
    }
  };

  const clearBench = () => {
    for (const item of laid) {
      gameClient?.exchangeMoveItem(item.unicId, false, 0);
    }
  };

  // `playArea` arrives in canvas pixels, like the trade window's; every
  // measurement in `craft-theme` is in base units, so the one place the two
  // meet is the recipe book's height, which `Panel` wants in base units.
  const playHeightBase = playArea.height / Math.max(zoom, 0.01);
  // The result box sits level with the bench strip, which puts its bottom
  // edge exactly one button row above the column's.
  const obtainedBottom = CRAFT_LAYOUT.edge + CRAFT_BENCH.buttons.height;
  const recipesHeight = Math.max(
    140,
    playHeightBase -
      CRAFT_RECIPES.top -
      obtainedBottom -
      CRAFT_OBTAINED.box.height -
      CRAFT_LAYOUT.edge
  );

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
      {recipesOpen && (
        <RecipeBookPanel
          zoom={zoom}
          skillName={skillName}
          craftItemIds={skill?.craftItemIds ?? []}
          lang={craftsLang}
          maxSlots={craft.maxSlots}
          left={CRAFT_LAYOUT.leftEdge}
          top={CRAFT_RECIPES.top}
          height={recipesHeight}
          onClose={() => setRecipesOpen(false)}
        />
      )}

      <ObtainedBox
        zoom={zoom}
        left={CRAFT_LAYOUT.leftEdge}
        bottom={obtainedBottom}
        resultItemId={matchedResultId ?? lastResultItemId}
        lang={craftsLang}
        craft={craft}
      />

      {/* Pinned to the bottom-right corner and stacking upward, so the
          bench strip keeps its place whatever the play area's height. */}
      <div
        style={{
          position: "absolute",
          right: p(CRAFT_LAYOUT.edge),
          bottom: p(CRAFT_LAYOUT.edge),
          width: p(CRAFT_COLUMN.width),
        }}
      >
        <SkillBanner zoom={zoom} skillName={skillName} />

        <div style={{ height: p(CRAFT_COLUMN.bannerGap) }} />

        <Panel
          title={characterName || "Atelier"}
          width={CRAFT_COLUMN.width}
          height={CRAFT_COLUMN.windowHeight}
          zoom={zoom}
          floating
          onClose={() => gameClient?.exchangeLeave()}
          style={{ pointerEvents: "auto" }}
        >
          <BagBrowser
            zoom={zoom}
            items={bag}
            templates={inventory.templates}
            weight={inventory.weight}
            selectedUnicId={selected}
            onSelect={(item) => setSelected(item.unicId)}
            actions={bagActions}
          />
        </Panel>

        <div style={{ height: p(CRAFT_COLUMN.benchGap) }} />

        <Panel
          title=""
          showTitleBar={false}
          width={CRAFT_COLUMN.width}
          height={CRAFT_BENCH.height}
          zoom={zoom}
          floating
          style={{ pointerEvents: "auto" }}
        >
          <BenchSlots
            zoom={zoom}
            laid={laid}
            maxSlots={craft.maxSlots}
            templates={inventory.templates}
            onRemove={(item) =>
              gameClient?.exchangeMoveItem(item.unicId, false, 0)
            }
          />
        </Panel>

        <div
          style={{
            display: "flex",
            marginLeft: p(CRAFT_BENCH.buttons.x),
            pointerEvents: "auto",
          }}
        >
          <CraftButton
            zoom={zoom}
            width={CRAFT_BENCH.buttons.recipes}
            tone="dark"
            label="Recettes"
            pressed={recipesOpen}
            onClick={() => setRecipesOpen((open) => !open)}
          />
          <CraftButton
            zoom={zoom}
            width={CRAFT_BENCH.buttons.quantity}
            tone="orange"
            label={`Qté : ${quantity}`}
            title="Nombre de fabrications enchaînées"
            disabled={running}
            onClick={() =>
              setQuantityIndex((i) => (i + 1) % CRAFT_QUANTITIES.length)
            }
          />
          <CraftButton
            zoom={zoom}
            width={CRAFT_BENCH.buttons.clear}
            tone="orange"
            title="Vider l'atelier"
            disabled={running || craft.slots.size === 0}
            onClick={clearBench}
          >
            <ResetGlyph zoom={zoom} />
          </CraftButton>
          <CraftButton
            zoom={zoom}
            width={CRAFT_BENCH.buttons.combine}
            tone="orange"
            label={running ? "Arrêter" : "Combiner"}
            disabled={!running && craft.slots.size === 0}
            onClick={combine}
          />
        </div>
      </div>
    </div>
  );
}

/** "Compétence : Sculpter un Bâton", above the window. */
function SkillBanner({ zoom, skillName }: { zoom: number; skillName: string }) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <div
      style={{
        width: p(CRAFT_COLUMN.width),
        height: p(CRAFT_COLUMN.bannerHeight),
        boxSizing: "border-box",
        background: C.dark,
        border: `${p(3)}px solid #ffffff`,
        borderRadius: p(13),
        display: "flex",
        alignItems: "center",
        padding: `0 ${p(12)}px`,
        fontFamily: "Verdana, sans-serif",
        fontSize: p(11),
        fontWeight: "bold",
        color: C.darkText,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      Compétence : {skillName}
    </div>
  );
}

/**
 * The window's contents: the type caption and dropdown, the three
 * category buttons beside the pods gauge, and the 9×3 bag grid.
 *
 * Absolutely positioned against `Panel`'s padding box, so every y here is
 * measured from under the top border and the title bar occupies 0..22.
 */
function BagBrowser({
  zoom,
  items,
  templates,
  weight,
  selectedUnicId,
  onSelect,
  actions,
}: {
  zoom: number;
  items: ItemData[];
  templates: Map<number, ItemTemplateData>;
  weight: { current: number; max: number };
  selectedUnicId: number | null;
  onSelect: (item: ItemData) => void;
  actions: CraftCellAction[];
}) {
  const p = (n: number) => Math.round(n * zoom);
  const G = CRAFT_WINDOW.grid;
  const {
    categoryId,
    setCategoryId,
    typeName,
    setTypeName,
    typeOptions,
    visible,
  } = useItemFilters(items, templates);
  const [scrollTop, setScrollTop] = useState(0);

  const rows = Math.max(G.rows, Math.ceil(visible.length / G.columns));
  const cellCount = rows * G.columns;
  const viewportHeight = G.rows * G.cellSize;
  const contentHeight = rows * G.cellSize;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const clampedScroll = Math.min(scrollTop, maxScroll);
  const podsRatio =
    weight.max > 0 ? Math.min(1, Math.max(0, weight.current / weight.max)) : 0;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: p(CRAFT_WINDOW.label.x),
          top: p(CRAFT_WINDOW.label.y),
          height: p(CRAFT_WINDOW.label.height),
          display: "flex",
          alignItems: "center",
          fontFamily: "Verdana, sans-serif",
          fontSize: p(CRAFT_WINDOW.label.fontSize),
          color: C.text,
        }}
      >
        Équipement
      </div>

      <div
        style={{
          position: "absolute",
          left: p(CRAFT_WINDOW.dropdown.x),
          top: p(CRAFT_WINDOW.dropdown.y),
          width: p(CRAFT_WINDOW.dropdown.width),
          height: p(CRAFT_WINDOW.dropdown.height),
        }}
      >
        <TypeSelect
          value={typeName}
          options={typeOptions}
          onChange={setTypeName}
          zoom={zoom}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: p(CRAFT_WINDOW.filters.x),
          top: p(CRAFT_WINDOW.filters.y),
          display: "flex",
          gap: p(CRAFT_WINDOW.filters.pitch - CRAFT_WINDOW.filters.size),
        }}
      >
        {CRAFT_FILTER_IDS.map((id) => {
          const category = FILTER_CATEGORIES.find((c) => c.id === id);
          if (!category) {
            return null;
          }
          const active = categoryId === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              title={category.label}
              onClick={() => setCategoryId(active ? null : id)}
              style={{
                width: p(CRAFT_WINDOW.filters.size),
                height: p(CRAFT_WINDOW.filters.size),
                border: "none",
                borderRadius: p(4),
                // Retail darkens the button that is on rather than
                // outlining it — the capture's "Ressources" filter is a
                // brown tile beside two orange ones.
                background: active ? C.dark : "#df7d2e",
                backgroundImage: `url("${category.icon}")`,
                backgroundSize: "70%",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                cursor: "pointer",
                padding: 0,
              }}
            />
          );
        })}
      </div>

      <div
        title={`Pods : ${weight.current} / ${weight.max}`}
        style={{
          position: "absolute",
          left: p(CRAFT_WINDOW.pods.x),
          top: p(CRAFT_WINDOW.pods.y),
          width: p(CRAFT_WINDOW.pods.width),
          height: p(CRAFT_WINDOW.pods.height),
          background: C.gaugeTrack,
          borderRadius: p(CRAFT_WINDOW.pods.height / 2),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${podsRatio * 100}%`,
            height: "100%",
            background: C.orange,
            borderRadius: p(CRAFT_WINDOW.pods.height / 2),
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: p(G.x),
          top: p(G.y),
          display: "flex",
          height: p(viewportHeight),
        }}
      >
        <div
          style={{
            width: p(G.columns * G.cellSize),
            height: "100%",
            overflow: "hidden",
          }}
          onWheel={(e) => {
            if (maxScroll <= 0) {
              return;
            }
            e.stopPropagation();
            setScrollTop((prev) =>
              Math.max(
                0,
                Math.min(maxScroll, prev + Math.sign(e.deltaY) * G.cellSize)
              )
            );
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${G.columns}, ${p(G.cellSize)}px)`,
              transform: `translateY(${p(-clampedScroll)}px)`,
              willChange: "transform",
            }}
          >
            {Array.from({ length: cellCount }, (_, index) => {
              const item = visible[index];
              return (
                <CraftCell
                  key={item?.unicId ?? `empty-${index}`}
                  zoom={zoom}
                  width={G.cellSize}
                  height={G.cellSize}
                  item={item}
                  template={item ? templates.get(item.itemId) : undefined}
                  selected={item?.unicId === selectedUnicId}
                  onSelect={onSelect}
                  actions={actions}
                />
              );
            })}
          </div>
        </div>

        <Scrollbar
          zoom={zoom}
          width={G.scrollbarWidth}
          scrollTop={clampedScroll}
          maxScroll={maxScroll}
          viewportHeight={viewportHeight}
          contentHeight={contentHeight}
          step={G.cellSize}
          onScroll={setScrollTop}
          trackColor="transparent"
          thumbColor={C.scrollThumb}
          thumbVisible={maxScroll > 0}
        />
      </div>
    </>
  );
}

/**
 * The bench strip: one slot per craft slot the skill grants, right-aligned
 * with the first free one outlined the way retail marks where the next
 * ingredient lands.
 */
function BenchSlots({
  zoom,
  laid,
  maxSlots,
  templates,
  onRemove,
}: {
  zoom: number;
  laid: ItemData[];
  maxSlots: number;
  templates: Map<number, ItemTemplateData>;
  onRemove: (item: ItemData) => void;
}) {
  const p = (n: number) => Math.round(n * zoom);
  const S = CRAFT_BENCH.slot;
  const actions = [{ label: "Retirer", enabled: () => true, run: onRemove }];

  return (
    <div
      style={{
        position: "absolute",
        right: p(S.rightMargin),
        top: p(S.top),
        display: "flex",
      }}
    >
      {Array.from({ length: Math.max(0, maxSlots) }, (_, index) => (
        <CraftCell
          // Slot index is the identity here: the strip is a fixed row of
          // positions, not a list that reorders.
          key={`slot-${index}`}
          zoom={zoom}
          width={S.width}
          height={S.height}
          item={laid[index]}
          template={
            laid[index] ? templates.get(laid[index]?.itemId ?? 0) : undefined
          }
          selected={index === laid.length && laid.length < maxSlots}
          onSelect={() => undefined}
          actions={actions}
        />
      ))}
    </div>
  );
}

interface CraftCellAction {
  label: string;
  enabled: (item: ItemData, template: ItemTemplateData | undefined) => boolean;
  run: (item: ItemData) => void;
}

/**
 * One slot, in the grid or in the bench strip.
 *
 * Same `grid-cell-bg.svg` as every other 1.29 grid, stretched: the bench
 * slots are 38×35 base units against the grid's 32×32, which is the
 * capture's own proportion and not a square.
 */
function CraftCell({
  zoom,
  width,
  height,
  item,
  template,
  selected,
  onSelect,
  actions,
}: {
  zoom: number;
  width: number;
  height: number;
  item: ItemData | undefined;
  template: ItemTemplateData | undefined;
  selected: boolean;
  onSelect: (item: ItemData) => void;
  actions: CraftCellAction[];
}) {
  const p = (n: number) => Math.round(n * zoom);
  const tooltip = useTooltip();

  const frame = {
    width: p(width),
    height: p(height),
    backgroundImage: `url("${GRID_ASSET_BASE}/grid-cell-bg.svg")`,
    backgroundSize: "100% 100%",
    boxSizing: "border-box" as const,
  };

  const highlight = selected && (
    <img
      src={`${GRID_ASSET_BASE}/grid-cell-highlight.svg`}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );

  if (!item) {
    return <div style={{ ...frame, position: "relative" }}>{highlight}</div>;
  }

  const available = actions.filter((action) => action.enabled(item, template));

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      onDoubleClick={() => available[0]?.run(item)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (available.length === 0) {
          return;
        }
        showContextMenu(
          template?.name ?? "Objet",
          available.map((action) => ({
            label: action.label,
            onClick: () => action.run(item),
          })),
          e.clientX,
          e.clientY
        );
      }}
      onMouseEnter={(e) => {
        if (template) {
          tooltip.show(
            `${template.name}${template.level ? ` (Niv.${template.level})` : ""}`,
            e.clientX,
            e.clientY
          );
        }
      }}
      onMouseLeave={tooltip.hide}
      style={{
        ...frame,
        position: "relative",
        border: "none",
        padding: p(2),
        cursor: "pointer",
      }}
    >
      {template && (
        <ItemIcon
          typeId={template.typeId}
          gfxId={template.gfxId}
          size="100%"
          alt={template.name}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {item.quantity > 1 && <QuantityTag zoom={zoom} value={item.quantity} />}
      {highlight}
    </button>
  );
}

/**
 * The stack count.
 *
 * A filled dark tag rather than the outlined text `ItemGrid` draws: in
 * this capture the number sits on its own 12×12 plaque in the cell's
 * top-left corner, which is what makes it readable over a pale icon.
 */
function QuantityTag({ zoom, value }: { zoom: number; value: number }) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <span
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        minWidth: p(12),
        height: p(12),
        padding: `0 ${p(1)}px`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.quantityTag,
        color: "#ffffff",
        fontFamily: "Verdana, sans-serif",
        fontSize: p(8),
        fontWeight: "bold",
        lineHeight: 1,
      }}
    >
      {value}
    </span>
  );
}

/**
 * "Objet obtenu", facing the bench from the left edge of the play area.
 *
 * It carries the outcome line too — the capture has no other place for
 * one, and a failed craft has to say so out loud because the ingredients
 * are gone either way.
 */
function ObtainedBox({
  zoom,
  left,
  bottom,
  resultItemId,
  lang,
  craft,
}: {
  zoom: number;
  left: number;
  bottom: number;
  resultItemId: number | null;
  lang: CraftsLang | null;
  craft: {
    outcome: string;
    seriesRemaining: number;
    seriesCrafted: number;
  };
}) {
  const p = (n: number) => Math.round(n * zoom);
  const B = CRAFT_OBTAINED;
  const result = resultItemId === null ? null : lang?.items.get(resultItemId);
  const outcome = outcomeLabel(craft);

  return (
    <div
      style={{
        position: "absolute",
        left: p(left),
        bottom: p(bottom),
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: p(B.box.width),
          height: p(B.box.height),
          boxSizing: "border-box",
          background: C.dark,
          border: `${p(3)}px solid #ffffff`,
          borderRadius: p(13),
          display: "flex",
          alignItems: "center",
          gap: p(8),
          padding: `0 ${p(9)}px`,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "Verdana, sans-serif",
              fontSize: p(11),
              fontWeight: "bold",
              color: C.darkText,
            }}
          >
            Objet obtenu
          </div>
          {outcome && (
            <div
              style={{
                marginTop: p(3),
                fontFamily: "Verdana, sans-serif",
                fontSize: p(8),
                color: outcomeColor(craft.outcome),
              }}
            >
              {outcome}
            </div>
          )}
        </div>

        <div
          style={{
            width: p(B.slot.size),
            height: p(B.slot.size),
            flexShrink: 0,
            backgroundImage: `url("${GRID_ASSET_BASE}/grid-cell-bg.svg")`,
            backgroundSize: "100% 100%",
            padding: p(2),
            boxSizing: "border-box",
          }}
          title={result?.name ?? ""}
        >
          {result && (
            <ItemIcon
              typeId={result.typeId}
              gfxId={result.gfxId}
              size="100%"
              alt={result.name}
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </div>
      </div>

      <svg
        width={p(B.arrow.width)}
        height={p(B.arrow.height)}
        viewBox="0 0 55 42"
        aria-hidden="true"
        style={{ marginLeft: p(B.arrow.gap), display: "block" }}
      >
        <path
          d="M3 21 23 4v9h29v16H23v9z"
          fill="#ece8d8"
          stroke="#ffffff"
          strokeWidth={3}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** The ↻ on the "vider l'atelier" button. */
function ResetGlyph({ zoom }: { zoom: number }) {
  const size = Math.round(12 * zoom);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8"
        fill="none"
        stroke="#ffffff"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <path d="M14.2 1.4v5.2H9z" fill="#ffffff" />
    </svg>
  );
}

function CraftButton({
  zoom,
  width,
  tone,
  label,
  title,
  pressed = false,
  disabled = false,
  onClick,
  children,
}: {
  zoom: number;
  width: number;
  tone: "dark" | "orange";
  label?: string;
  title?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  const p = (n: number) => Math.round(n * zoom);
  const background =
    tone === "dark" ? C.dark : pressed ? C.orangePressed : C.orange;

  return (
    <button
      type="button"
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: p(width),
        height: p(CRAFT_BENCH.buttons.height),
        boxSizing: "border-box",
        background: pressed && tone === "dark" ? "#6b6252" : background,
        border: `${p(2)}px solid #ffffff`,
        borderRadius: p(7),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        fontFamily: "Verdana, sans-serif",
        fontSize: p(10),
        fontWeight: "bold",
        color: C.darkText,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children ?? label}
    </button>
  );
}

function outcomeLabel(craft: {
  outcome: string;
  seriesRemaining: number;
  seriesCrafted: number;
}): string {
  if (craft.seriesRemaining > 0) {
    return `En série — ${craft.seriesRemaining} restantes`;
  }

  if (craft.seriesCrafted > 0) {
    return `Série terminée — ${craft.seriesCrafted} fabriqués`;
  }

  if (craft.outcome === "success") {
    return "Fabrication réussie.";
  }

  if (craft.outcome === "failure") {
    // Worth saying out loud, because the ingredients are gone either way.
    return "Échec — ingrédients perdus.";
  }

  return "";
}

function outcomeColor(outcome: string): string {
  if (outcome === "success") {
    return C.success;
  }

  if (outcome === "failure") {
    return C.failure;
  }

  return "#cdc7b4";
}
