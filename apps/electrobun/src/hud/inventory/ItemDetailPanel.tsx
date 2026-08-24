import { useEffect, useState } from "react";

import type { ItemData, ItemTemplateData } from "@/game/network/protocol";
import {
  formatEffect,
  isEffectsLangReady,
  loadEffectsLang,
  subscribeEffectsLang,
} from "@/game/lang/effects-lang";
import { formatCriteria } from "@/game/lang/item-conditions";

import { ItemIcon } from "./ItemIcon";
import {
  characteristicIcon,
  DETAIL_BOX,
  DETAIL_METRICS,
  FLAG_EFFECT_LABELS,
  HIDDEN_EFFECT_IDS,
  INVENTORY_COLORS,
  isStatCharacteristic,
} from "./inventory-theme";

const C = INVENTORY_COLORS;
const M = DETAIL_METRICS;

interface ItemDetailPanelProps {
  zoom: number;
  item: ItemData | null;
  template: ItemTemplateData | null;
}

/**
 * The card below the paperdoll: name/level header, pods + big icon on
 * the left, an Effets/Conditions tab pair on the right, and the
 * description underneath — a 1:1 layout transcription of the reference
 * capture's "Chienchien" card.
 */
export function ItemDetailPanel({
  zoom,
  item,
  template,
}: ItemDetailPanelProps) {
  const p = (n: number) => Math.round(n * zoom);
  const [tab, setTab] = useState<"effects" | "conditions">("effects");
  const [, forceRender] = useState(0);

  // Effect descriptions are template sentences fetched once and cached —
  // same lazy-load / re-render-on-arrival pattern as SpellDetailPanel.
  useEffect(() => {
    loadEffectsLang();
    return subscribeEffectsLang(() => forceRender((v) => v + 1));
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: p(DETAIL_BOX.x),
        top: p(DETAIL_BOX.y),
        width: p(DETAIL_BOX.width),
        height: p(DETAIL_BOX.height),
        background: C.detailBody,
        borderRadius: p(10),
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: p(M.headerHeight),
          background: C.boxBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${p(8)}px`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "#ffffff",
            fontWeight: "bold",
            fontSize: p(11),
            fontFamily: "Verdana, sans-serif",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {template?.name ?? ""}
        </span>
        {template && (
          <span
            style={{
              color: "#ffffff",
              fontWeight: "bold",
              fontSize: p(11),
              fontFamily: "Verdana, sans-serif",
              flexShrink: 0,
            }}
          >
            Niv.{template.level}
          </span>
        )}
      </div>

      {!template || !item ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#8a8571",
            fontSize: p(11),
            fontFamily: "Verdana, sans-serif",
          }}
        >
          Aucun objet sélectionné
        </div>
      ) : (
        <>
          <div style={{ position: "relative", flex: 1 }}>
            <div
              style={{
                position: "absolute",
                left: p(8),
                top: p(6),
                width: p(M.leftColumnWidth - 8),
              }}
            >
              <div
                style={{
                  color: C.text,
                  fontSize: p(10),
                  fontFamily: "Verdana, sans-serif",
                  marginBottom: p(4),
                }}
              >
                {template.weight} pods
              </div>
              <div
                style={{
                  width: p(M.icon.w),
                  height: p(M.icon.h),
                  margin: "0 auto",
                }}
              >
                <ItemIcon
                  typeId={template.typeId}
                  gfxId={template.gfxId}
                  size={p(Math.min(M.icon.w, M.icon.h))}
                  alt={template.name}
                />
              </div>
            </div>

            <div
              style={{
                position: "absolute",
                left: p(M.leftColumnWidth),
                top: p(2),
                right: p(4),
              }}
            >
              <div style={{ display: "flex" }}>
                <DetailTab
                  zoom={zoom}
                  label="Effets"
                  active={tab === "effects"}
                  onClick={() => setTab("effects")}
                />
                <DetailTab
                  zoom={zoom}
                  label="Conditions"
                  active={tab === "conditions"}
                  onClick={() => setTab("conditions")}
                />
              </div>

              <div>
                {tab === "effects"
                  ? renderEffects(item, zoom)
                  : renderConditions(template.criteria, zoom)}
              </div>
            </div>
          </div>

          <div
            style={{
              background: C.descBody,
              padding: p(8),
              fontSize: p(M.descriptionFontSize),
              color: C.text,
              fontFamily: "Verdana, sans-serif",
              overflowY: "auto",
              flexShrink: 0,
              // `descriptionTop` is already measured from `DETAIL_BOX`'s top,
              // so the header must not be subtracted a second time — doing so
              // left the box 33 units tall instead of the capture's 55.
              height: p(DETAIL_BOX.height - M.descriptionTop),
            }}
          >
            <div style={{ textDecoration: "underline", marginBottom: p(3) }}>
              Catégorie : {template.typeName}
            </div>
            <div>{template.description}</div>
          </div>
        </>
      )}
    </div>
  );
}

function renderEffects(item: ItemData, zoom: number) {
  const p = (n: number) => Math.round(n * zoom);

  if (!isEffectsLangReady()) {
    return null;
  }

  // Pet husbandry bookkeeping (806/807/808) is filtered out entirely —
  // see `HIDDEN_EFFECT_IDS`'s doc comment — before anything else, so an
  // item left with zero real effects still shows "Aucun effet.".
  const rows = item.effects
    .filter((effect) => !HIDDEN_EFFECT_IDS.has(effect.effectType))
    .map((effect) => ({
      effect,
      formatted: formatEffect({
        effectId: effect.effectType,
        min: effect.param1,
        max: effect.param2,
        special: effect.param3,
        duration: 0,
      }),
    }))
    // Higher `priority` (the bundle's `p`) first — matches the reference
    // capture's row order (800 → 124 → 983). See `FormattedEffect.priority`.
    .sort(
      (a, b) => (b.formatted?.priority ?? 0) - (a.formatted?.priority ?? 0)
    );

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: p(6),
          fontSize: p(9),
          color: C.textMuted,
          fontFamily: "Verdana, sans-serif",
        }}
      >
        Aucun effet.
      </div>
    );
  }

  return rows.map(({ effect, formatted }, index) => {
    const flagLabel = FLAG_EFFECT_LABELS[effect.effectType];
    const text = flagLabel ?? formatted?.text ?? "";
    const icon = flagLabel
      ? null
      : formatted
        ? characteristicIcon(formatted.characteristic, formatted.element)
        : null;
    // Green only for an actual characteristic buff, matching the reference
    // capture: "+20 en sagesse" is green, but "Points de vie : 1" (a life
    // value, not a stat buff) is plain text despite also being positive.
    const positive =
      !flagLabel &&
      !!formatted &&
      isStatCharacteristic(formatted.characteristic) &&
      effect.param1 > 0;

    return (
      <div
        key={`${effect.effectType}-${index}`}
        style={{
          height: p(M.rowHeight),
          background: index % 2 === 0 ? C.detailRowEven : C.detailRowOdd,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${p(6)}px`,
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            fontSize: p(10),
            fontFamily: "Verdana, sans-serif",
            color: positive ? C.positiveText : C.text,
          }}
        >
          {text}
        </span>
        {icon && (
          <img
            src={icon}
            alt=""
            draggable={false}
            style={{ width: p(16), height: p(16), flexShrink: 0 }}
          />
        )}
      </div>
    );
  });
}

function renderConditions(criteria: string, zoom: number) {
  const p = (n: number) => Math.round(n * zoom);
  const clauses = formatCriteria(criteria);

  if (clauses.length === 0) {
    return (
      <div
        style={{
          padding: p(6),
          fontSize: p(9),
          color: C.textMuted,
          fontFamily: "Verdana, sans-serif",
        }}
      >
        Aucune condition.
      </div>
    );
  }

  return clauses.map((clause, index) => (
    <div
      key={clause}
      style={{
        height: p(M.rowHeight),
        background: index % 2 === 0 ? C.detailRowEven : C.detailRowOdd,
        display: "flex",
        alignItems: "center",
        padding: `0 ${p(6)}px`,
        boxSizing: "border-box",
        fontSize: p(10),
        fontFamily: "Verdana, sans-serif",
        color: C.text,
      }}
    >
      {clause}
    </div>
  ));
}

function DetailTab({
  zoom,
  label,
  active,
  onClick,
}: {
  zoom: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const p = (n: number) => Math.round(n * zoom);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        border: "none",
        background: active ? C.detailTabActive : C.detailTabInactive,
        color: active ? "#3f3b31" : "#ffffff",
        borderRadius: `${p(4)}px ${p(4)}px 0 0`,
        height: p(M.tabsHeight),
        // Width follows the label — see `DETAIL_METRICS.tabPaddingX`.
        padding: `0 ${p(M.tabPaddingX)}px`,
        whiteSpace: "nowrap",
        fontFamily: "Verdana, sans-serif",
        fontSize: p(9),
        fontWeight: active ? "bold" : "normal",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
