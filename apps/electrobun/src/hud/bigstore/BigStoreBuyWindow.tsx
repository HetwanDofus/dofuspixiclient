import { useState } from "react";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import type { BigStoreState } from "@/game/stores/bigstore-store";
import type { InventoryWeight } from "@/game/stores/inventory-store";

import { Panel } from "../components/Panel";
import { ItemDetailPanel } from "../inventory/ItemDetailPanel";
import { INVENTORY_COLORS } from "../inventory/inventory-theme";
import { TypeSelect } from "../inventory/TypeSelect";
import { BigStorePriceGrid, type PriceSelection } from "./BigStorePriceGrid";
import {
  BUY_AVERAGE,
  BUY_CARD,
  BUY_FOOTER,
  BUY_LIST,
  BUY_PRICES,
  BUY_PURSE,
  BUY_WINDOW,
  formatKamas,
} from "./bigstore-theme";
import { TemplateList } from "./TemplateList";

const C = INVENTORY_COLORS;
const ASSET_BASE = "/themes/classic/assets/panels/inventory";

interface BigStoreBuyWindowProps {
  zoom: number;
  store: BigStoreState;
  templates: Map<number, ItemTemplateData>;
  /** `item_types.id` → its 1.29 name, for the category dropdown. */
  typeNames: Map<number, string>;
  kamas: number;
  weight: InventoryWeight;
  onSelectType: (typeId: number) => void;
  onSelectTemplate: (templateId: number) => void;
  onBuy: (selection: PriceSelection) => void;
  onSwitchToSell: () => void;
  onClose: () => void;
}

/**
 * Mode achat — exchange type 11, and one window.
 *
 * Two columns, as `screenshot-ui/hdv/image.png` lays them out: on the
 * left the models on sale in the chosen category, on the right the
 * selected one's card above its price grid. Everything on the left is a
 * question to the server (`EHT` for a category, `EHl` for a model) and
 * everything on the right is its answer, which is why nothing here
 * filters or sorts: the hall decides what it sells and in what order.
 */
export function BigStoreBuyWindow({
  zoom,
  store,
  templates,
  typeNames,
  kamas,
  weight,
  onSelectType,
  onSelectTemplate,
  onBuy,
  onSwitchToSell,
  onClose,
}: BigStoreBuyWindowProps) {
  const p = (n: number) => Math.round(n * zoom);
  // Derived during render rather than reset in an effect: the pick
  // belongs to the grid that was on screen when it was made, so it is
  // stamped with that grid's template and simply stops applying when the
  // server replaces it — another category, another model, or somebody
  // else's purchase.
  const [picked, setPicked] = useState<{
    templateId: number | null;
    selection: PriceSelection;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const selection =
    picked && picked.templateId === store.templateId ? picked.selection : null;

  const setSelection = (next: PriceSelection | null) =>
    setPicked(next ? { templateId: store.templateId, selection: next } : null);

  const params = store.params;
  const lotSizes = params?.lotSizes ?? [1, 10, 100];
  const typeOptions = (params?.types ?? []).map(
    (id) => typeNames.get(id) ?? `Type ${id}`
  );
  const currentTypeName =
    store.typeId === null ? null : (typeNames.get(store.typeId) ?? null);

  const selectedLine =
    store.lines.find((line) => String(line.lineId) === selection?.lineId) ??
    store.lines[0];
  const shownItem = (selectedLine?.item ?? null) as ItemData | null;
  const shownTemplate = store.templateId
    ? (templates.get(store.templateId) ?? null)
    : null;

  const average = store.templateId
    ? store.middlePrices.get(store.templateId)
    : undefined;

  // The list the player actually sees, once "Rechercher..." has narrowed
  // it. A template whose presentation has not arrived yet has no name to
  // match on and stays listed rather than blinking out.
  const needle = search.trim().toLowerCase();
  const visibleTemplateIds =
    searchOpen && needle.length > 0
      ? store.templateIds.filter((id) => {
          const name = templates.get(id)?.name;
          return !name || name.toLowerCase().includes(needle);
        })
      : store.templateIds;

  const podsPct =
    weight.max > 0 ? Math.min(100, (weight.current / weight.max) * 100) : 0;

  return (
    <Panel
      title={`Hôtel de vente (Niveau maximum : ${params?.levelMax ?? 0})`}
      width={BUY_WINDOW.width}
      height={BUY_WINDOW.height}
      zoom={zoom}
      floating
      onClose={onClose}
    >
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {/* ── Left column: what is on sale ─────────────────────────── */}
        <div
          style={{
            position: "absolute",
            left: p(BUY_LIST.x),
            top: p(BUY_LIST.y),
            width: p(BUY_LIST.width),
            height: p(BUY_LIST.height),
            background: C.gridBg,
            borderRadius: p(6),
            padding: p(5),
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            gap: p(4),
          }}
        >
          <span
            style={{
              height: p(BUY_LIST.headerHeight),
              display: "flex",
              alignItems: "center",
              fontFamily: "Verdana, sans-serif",
              fontSize: p(11),
              color: C.text,
            }}
          >
            Objets en vente
          </span>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: p(6),
              height: p(BUY_LIST.categoryHeight),
            }}
          >
            <span
              style={{
                fontFamily: "Verdana, sans-serif",
                fontSize: p(10),
                color: C.text,
              }}
            >
              Catégorie
            </span>
            <div style={{ flex: 1 }}>
              <TypeSelect
                value={currentTypeName}
                options={typeOptions}
                onChange={(name) => {
                  const typeId = (params?.types ?? []).find(
                    (id) => typeNames.get(id) === name
                  );
                  if (typeId !== undefined) {
                    onSelectType(typeId);
                  }
                }}
                zoom={zoom}
              />
            </div>
          </div>

          {searchOpen && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nom de l'objet"
              // Retail's "Rechercher..." queries the whole hall; this
              // narrows the category that is already listed, which is
              // every template the client has been told about. Searching
              // a category the player has not opened would mean asking
              // the server for a name index it does not keep.
              style={{
                height: p(18),
                border: "none",
                borderRadius: p(4),
                padding: `0 ${p(6)}px`,
                fontFamily: "Verdana, sans-serif",
                fontSize: p(10),
                color: C.text,
                background: C.descBody,
              }}
            />
          )}

          <TemplateList
            zoom={zoom}
            templateIds={visibleTemplateIds}
            templates={templates}
            selectedTemplateId={store.templateId}
            onSelect={onSelectTemplate}
          />

          <span
            style={{
              height: p(BUY_LIST.footerHeight),
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              fontFamily: "Verdana, sans-serif",
              fontSize: p(10),
              color: C.textMuted,
            }}
          >
            {visibleTemplateIds.length} objet
            {visibleTemplateIds.length > 1 ? "s" : ""}
          </span>
        </div>

        {/* ── The purse, under the list ────────────────────────────── */}
        <div
          style={{
            position: "absolute",
            left: p(BUY_PURSE.x),
            top: p(BUY_PURSE.y),
            width: p(BUY_PURSE.width),
            height: p(BUY_PURSE.height),
            display: "flex",
            alignItems: "center",
            gap: p(6),
            fontFamily: "Verdana, sans-serif",
            fontSize: p(10),
            color: C.text,
          }}
        >
          <span>Porte monnaie :</span>
          <span>{formatKamas(kamas)}</span>
          <img
            src={`${ASSET_BASE}/kamas.svg`}
            alt="kamas"
            style={{ width: p(12), height: p(14) }}
          />
          <div
            title={`${Math.round(weight.current)} / ${weight.max} pods`}
            style={{
              marginLeft: "auto",
              width: p(80),
              height: p(10),
              background: C.podsTrack,
              borderRadius: p(5),
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${podsPct}%`,
                height: "100%",
                background: C.podsFill,
              }}
            />
          </div>
        </div>

        {/* ── Right column: the card, then the prices ──────────────── */}
        {shownItem && shownTemplate ? (
          <ItemDetailPanel
            zoom={zoom}
            item={shownItem}
            template={shownTemplate}
            box={BUY_CARD}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              left: p(BUY_CARD.x),
              top: p(BUY_CARD.y),
              width: p(BUY_CARD.width),
              height: p(BUY_CARD.height),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: C.detailBody,
              borderRadius: p(6),
              fontFamily: "Verdana, sans-serif",
              fontSize: p(11),
              color: C.textMuted,
            }}
          >
            Sélectionne un objet dans la liste
          </div>
        )}

        <div
          style={{
            position: "absolute",
            left: p(BUY_PRICES.x),
            top: p(BUY_PRICES.y),
            width: p(BUY_PRICES.width),
            height: p(BUY_PRICES.height),
          }}
        >
          <BigStorePriceGrid
            zoom={zoom}
            lines={store.lines}
            templates={templates}
            lotSizes={lotSizes}
            selection={selection}
            onSelect={setSelection}
            onBuy={onBuy}
          />
        </div>

        <span
          style={{
            position: "absolute",
            left: p(BUY_AVERAGE.x),
            top: p(BUY_AVERAGE.y),
            width: p(BUY_AVERAGE.width),
            height: p(BUY_AVERAGE.height),
            display: "flex",
            alignItems: "center",
            fontFamily: "Verdana, sans-serif",
            fontSize: p(10),
            color: C.text,
          }}
        >
          {/* -1 is the server's "never sold here", and 1.29 writes it out
              as a sentence rather than as a number. */}
          {average === undefined
            ? ""
            : average < 0
              ? "Cet objet n'a encore jamais été vendu dans cet hôtel de vente."
              : `Prix moyen : ${formatKamas(average)} kamas/u.`}
        </span>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: p(BUY_FOOTER.y),
            display: "flex",
            justifyContent: "center",
            gap: p(BUY_FOOTER.gap),
          }}
        >
          <FooterButton
            zoom={zoom}
            label="Mode vente"
            onClick={onSwitchToSell}
          />
          <FooterButton
            zoom={zoom}
            label="Rechercher..."
            onClick={() => setSearchOpen((open) => !open)}
          />
          <FooterButton zoom={zoom} label="Fermer" onClick={onClose} />
        </div>
      </div>
    </Panel>
  );
}

function FooterButton({
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
        width: p(BUY_FOOTER.width),
        height: p(BUY_FOOTER.height),
        border: "none",
        borderRadius: p(6),
        background: "#df7d2e",
        color: "#ffffff",
        fontFamily: "Verdana, sans-serif",
        fontSize: p(11),
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
