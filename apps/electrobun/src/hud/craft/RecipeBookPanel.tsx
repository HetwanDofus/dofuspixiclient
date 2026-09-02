import { useMemo, useRef, useState } from "react";

import type {
  CraftRecipe,
  CraftRecipeTone,
  CraftsLang,
} from "@/game/lang/crafts-lang";
import { craftRecipeTone, recipesForSkill } from "@/game/lang/crafts-lang";

import { Panel } from "../components/Panel";
import { ItemIcon } from "../inventory/ItemIcon";
import { CRAFT_COLORS, CRAFT_RECIPES } from "./craft-theme";

const C = CRAFT_COLORS;
const R = CRAFT_RECIPES;

interface RecipeBookPanelProps {
  zoom: number;
  /** The bench's skill, for the title — "Recettes : Sculpter un Bâton". */
  skillName: string;
  /** `SK[skillId].cl` — the result templates this skill can make. */
  craftItemIds: readonly number[];
  lang: CraftsLang | null;
  /**
   * The open bench's slot count, for the 1.29 recipe-line colours: a
   * recipe that leaves slots unused pays less experience, or none, and
   * retail says so by tinting the line rather than in words.
   */
  maxSlots: number;
  left: number;
  top: number;
  height: number;
  onClose: () => void;
}

/**
 * What the "Recettes" button opens: every recipe the open bench's skill
 * knows, cheapest first, each with its ingredient list underneath.
 *
 * It fills the space the workbench leaves free at the top left rather than
 * covering it, because the point of having it open is to read it *while*
 * laying the ingredients out — the bench, the bag grid and this list are
 * all on screen at once.
 *
 * Everything here is resolved from `crafts.json` and `items.json`, not
 * from the server: an ingredient the player has never held has no
 * `ItemTemplateData`, so `inventoryStore.templates` cannot name it, let
 * alone give it a level or an icon.
 */
export function RecipeBookPanel({
  zoom,
  skillName,
  craftItemIds,
  lang,
  maxSlots,
  left,
  top,
  height,
  onClose,
}: RecipeBookPanelProps) {
  const p = (n: number) => Math.round(n * zoom);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const recipes = useMemo(
    () => recipesForSkill(craftItemIds, lang),
    [craftItemIds, lang]
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return recipes;
    }
    return recipes.filter((recipe) =>
      recipe.resultName.toLowerCase().includes(needle)
    );
  }, [recipes, search]);

  return (
    <div style={{ position: "absolute", left: p(left), top: p(top) }}>
      <Panel
        title={`Recettes : ${skillName}`}
        width={R.width}
        height={height}
        zoom={zoom}
        floating
        onClose={onClose}
        style={{ pointerEvents: "auto" }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: `${p(6)}px ${p(8)}px ${p(8)}px`,
            boxSizing: "border-box",
            gap: p(5),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: p(6),
              flexShrink: 0,
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une recette..."
              style={{
                flex: 1,
                minWidth: 0,
                height: p(18),
                boxSizing: "border-box",
                border: "none",
                borderRadius: p(4),
                padding: `0 ${p(6)}px`,
                background: "#ffffff",
                fontFamily: "Verdana, sans-serif",
                fontSize: p(9),
                color: C.text,
              }}
            />
            <span
              style={{
                fontFamily: "Verdana, sans-serif",
                fontSize: p(9),
                color: C.muted,
                whiteSpace: "nowrap",
              }}
            >
              {visible.length} recette{visible.length > 1 ? "s" : ""}
            </span>
          </div>

          <div
            ref={listRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              background: C.rowEven,
              borderRadius: p(4),
            }}
            onWheel={(e) => e.stopPropagation()}
          >
            {lang === null && (
              <EmptyLine zoom={zoom} text="Chargement des recettes..." />
            )}
            {lang !== null && visible.length === 0 && (
              <EmptyLine
                zoom={zoom}
                text={
                  recipes.length === 0
                    ? "Aucune recette connue pour ce métier."
                    : "Aucune recette ne correspond."
                }
              />
            )}
            {visible.map((recipe, index) => (
              <RecipeRow
                key={recipe.resultItemId}
                zoom={zoom}
                recipe={recipe}
                lang={lang}
                tone={craftRecipeTone(recipe.ingredients.length, maxSlots)}
                odd={index % 2 === 1}
              />
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function EmptyLine({ zoom, text }: { zoom: number; text: string }) {
  const p = (n: number) => Math.round(n * zoom);
  return (
    <div
      style={{
        padding: p(10),
        fontFamily: "Verdana, sans-serif",
        fontSize: p(9),
        color: C.muted,
      }}
    >
      {text}
    </div>
  );
}

/**
 * 1.29 tints a recipe line by what it pays: grey for a recipe too small
 * for this bench to grant experience, green for one that still does, red
 * for one that fills the bench and pays the normal rate. `craftRecipeTone`
 * owns the thresholds; this is only the palette.
 */
function toneColor(tone: CraftRecipeTone): string {
  if (tone === "grey") {
    return "#858585";
  }
  if (tone === "green") {
    return "#5f7f2e";
  }
  if (tone === "red") {
    return "#a8412c";
  }
  return C.text;
}

/**
 * One result and, in smaller type under it, what it takes to make.
 *
 * The ingredients wrap rather than scroll sideways: the longest recipes in
 * the bundle run to eight lines, and a row that grows is readable where a
 * row that clips is not.
 */
function RecipeRow({
  zoom,
  recipe,
  lang,
  tone,
  odd,
}: {
  zoom: number;
  recipe: CraftRecipe;
  lang: CraftsLang | null;
  tone: CraftRecipeTone;
  odd: boolean;
}) {
  const p = (n: number) => Math.round(n * zoom);
  const result = lang?.items.get(recipe.resultItemId);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: p(6),
        minHeight: p(R.rowMinHeight),
        padding: `${p(5)}px ${p(6)}px`,
        background: odd ? C.rowOdd : C.rowEven,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: p(R.rowIconSize),
          height: p(R.rowIconSize),
          flexShrink: 0,
        }}
      >
        {result && (
          <ItemIcon
            typeId={result.typeId}
            gfxId={result.gfxId}
            size="100%"
            alt={result.name}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: p(5),
            fontFamily: "Verdana, sans-serif",
            fontSize: p(10),
            fontWeight: "bold",
            color: toneColor(tone),
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {recipe.resultName}
          </span>
          <span
            style={{
              flexShrink: 0,
              fontWeight: "normal",
              fontSize: p(9),
              color: C.muted,
            }}
          >
            Niv. {recipe.resultLevel}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: `${p(1)}px ${p(8)}px`,
            marginTop: p(2),
          }}
        >
          {recipe.ingredients.map((ingredient) => {
            const info = lang?.items.get(ingredient.itemId);
            return (
              <span
                key={ingredient.itemId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: p(3),
                  fontFamily: "Verdana, sans-serif",
                  fontSize: p(8),
                  color: C.muted,
                }}
              >
                {info && (
                  <ItemIcon
                    typeId={info.typeId}
                    gfxId={info.gfxId}
                    size={p(R.ingredientIconSize)}
                    alt=""
                  />
                )}
                <span style={{ fontWeight: "bold" }}>
                  {ingredient.quantity}×
                </span>
                {info?.name ?? `Objet ${ingredient.itemId}`}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
