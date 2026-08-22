import { useEffect, useState, useSyncExternalStore } from "react";

import {
  type EffectElement,
  formatEffect,
  loadEffectsLang,
  subscribeEffectsLang,
} from "@/game/lang/effects-lang";
import { characterStore } from "@/game/stores";
import {
  type SpellDetailEffect,
  spellDetailsStore,
} from "@/game/stores/spell-details-store";

import { SpellIconMount } from "./SpellIconMount";
import {
  effectiveCriticalRate,
  SPELL_BOOK_COLORS,
  SPELL_DETAIL_METRICS,
} from "./spell-book-theme";

const M = SPELL_DETAIL_METRICS;
const C = SPELL_BOOK_COLORS;

interface SpellDetailPanelProps {
  spellId: number;
  zoom?: number;
  onClose: () => void;
}

/**
 * The spell book's detail window: icon, required level, range and AP
 * cost, description, the effect list under its Normaux / Critiques
 * tabs, and the "Autres caractéristiques" grid.
 *
 * The level strip across the top pages through every level in the
 * spell's table, including ones the player has not bought — that is how
 * retail lets you decide whether the next level is worth the points.
 * The level the player owns is preselected and highlighted.
 */
export function SpellDetailPanel({
  spellId,
  zoom = 1,
  onClose,
}: SpellDetailPanelProps) {
  const p = (n: number) => n * zoom;

  const { byId } = useSyncExternalStore(
    spellDetailsStore.subscribe,
    spellDetailsStore.getSnapshot
  );
  const { stats } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  const detail = byId.get(spellId);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [tab, setTab] = useState<"normal" | "critical">("normal");
  const [langVersion, setLangVersion] = useState(0);

  // Effect sentences come from a lang bundle fetched on demand; bump a
  // counter when it lands so the rows re-render with real text.
  useEffect(() => {
    loadEffectsLang();
    return subscribeEffectsLang(() => setLangVersion((v) => v + 1));
  }, []);

  // Follow the spell: opening a different one (or upgrading the current
  // one) snaps the strip back to the level the player actually owns.
  // biome-ignore lint/correctness/useExhaustiveDependencies: spellId is the trigger, not a value the body reads.
  useEffect(() => {
    setSelectedLevel(null);
    setTab("normal");
  }, [spellId]);

  if (!detail) {
    return (
      <DetailFrame zoom={zoom} onClose={onClose} levels={[]} level={1}>
        <Block
          zoom={zoom}
          top={M.nameTop}
          style={{ left: p(M.padding), fontSize: p(9) }}
        >
          Chargement…
        </Block>
      </DetailFrame>
    );
  }

  const ownedLevel = Math.max(1, detail.playerLevel);
  const level = selectedLevel ?? ownedLevel;
  const data = detail.levels.find((l) => l.level === level) ?? detail.levels[0];

  if (!data) {
    return (
      <DetailFrame zoom={zoom} onClose={onClose} levels={[]} level={level}>
        <Block
          zoom={zoom}
          top={M.nameTop}
          style={{ left: p(M.padding), fontSize: p(9) }}
        >
          Aucune donnée pour ce sort.
        </Block>
      </DetailFrame>
    );
  }

  const effects = tab === "normal" ? data.effects : data.criticalEffects;
  const criticalBonus = stats?.criticalHit ?? 0;
  const actualCrit = effectiveCriticalRate(data.criticalRate, criticalBonus);

  return (
    <DetailFrame
      zoom={zoom}
      onClose={onClose}
      levels={detail.levels.map((l) => l.level)}
      level={level}
      onSelectLevel={setSelectedLevel}
    >
      {/* Header: icon, name + required level, range + AP cost */}
      <Block zoom={zoom} top={M.iconTop} style={{ left: p(M.padding) }}>
        <div
          style={{
            position: "relative",
            width: p(M.iconSize),
            height: p(M.iconSize),
            border: `${Math.max(1, p(1))}px solid #241a12`,
            boxSizing: "border-box",
          }}
        >
          <SpellIconMount spellId={spellId} label={detail.name} />
        </div>
      </Block>

      <Block
        zoom={zoom}
        top={M.nameTop}
        style={{
          left: p(M.padding + M.iconSize + 10),
          fontSize: p(11),
          fontWeight: "bold",
        }}
      >
        {detail.name}
      </Block>
      <Block
        zoom={zoom}
        top={M.subTop}
        style={{ left: p(M.padding + M.iconSize + 10), fontSize: p(9) }}
      >
        Niveau requis: {data.minPlayerLevel}
      </Block>

      <Block
        zoom={zoom}
        top={M.nameTop}
        style={{ right: p(M.padding), fontSize: p(9) }}
      >
        {formatRangeLong(data.rangeMin, data.rangeMax)} PO
      </Block>
      <Block
        zoom={zoom}
        top={M.subTop}
        style={{ right: p(M.padding), fontSize: p(9) }}
      >
        {data.apCost} PA
      </Block>

      <Block
        zoom={zoom}
        top={M.descriptionTop}
        style={{
          left: p(M.padding),
          right: p(M.padding),
          fontSize: p(9),
          lineHeight: 1.35,
        }}
      >
        {detail.description}
      </Block>

      {/* Effects */}
      <Block
        zoom={zoom}
        top={M.effectsLabelTop}
        style={{ left: p(M.padding), fontSize: p(10), fontWeight: "bold" }}
      >
        Effets
      </Block>

      <Block
        zoom={zoom}
        top={M.tabsTop}
        style={{ left: p(M.padding), display: "flex", zIndex: 1 }}
      >
        <EffectTab
          zoom={zoom}
          label="Normaux"
          active={tab === "normal"}
          onClick={() => setTab("normal")}
        />
        <EffectTab
          zoom={zoom}
          label="Critiques"
          active={tab === "critical"}
          onClick={() => setTab("critical")}
        />
      </Block>

      <Block
        zoom={zoom}
        top={M.effectListTop}
        style={{ left: p(M.padding), right: p(M.padding) }}
      >
        {Array.from({ length: M.effectRows }, (_, i) => (
          <EffectRow
            // `langVersion` forces a fresh format pass once the bundle
            // resolves; the row itself is keyed by slot, not by effect.
            key={`${i}-${langVersion}`}
            zoom={zoom}
            index={i}
            effect={effects[i]}
          />
        ))}
      </Block>

      {/* Autres caractéristiques */}
      <Block
        zoom={zoom}
        top={M.otherLabelTop}
        style={{ left: p(M.padding), fontSize: p(10), fontWeight: "bold" }}
      >
        Autres caractéristiques
      </Block>

      <Block
        zoom={zoom}
        top={M.statsTop}
        style={{ left: p(M.padding), width: p(M.statsDivider - M.padding - 6) }}
      >
        <StatLine
          zoom={zoom}
          label="Probabilité de coup critique"
          value={data.criticalRate > 0 ? `1/${data.criticalRate}` : "-"}
        />
        <StatLine
          zoom={zoom}
          label="Probabilité d'échec"
          value={data.failureRate > 0 ? `1/${data.failureRate}` : "-"}
        />
        <StatLine
          zoom={zoom}
          label="Nb. de lancers par tour"
          value={data.castPerTurn > 0 ? String(data.castPerTurn) : "-"}
        />
        <StatLine
          zoom={zoom}
          label="Nb. de lancers par tour par joueur"
          value={data.castPerTarget > 0 ? String(data.castPerTarget) : "-"}
        />
        <StatLine
          zoom={zoom}
          label="Nb. de tours entre deux lancers"
          value={data.cooldown > 0 ? String(data.cooldown) : "-"}
        />
      </Block>

      <Block
        zoom={zoom}
        top={M.statsTop - 1}
        style={{
          left: p(M.statsDivider),
          width: Math.max(1, p(1)),
          height: p(5 * M.statLineHeight),
          background: "#c3c0aa",
        }}
      >
        {null}
      </Block>

      <Block
        zoom={zoom}
        top={M.statsTop}
        style={{ left: p(M.statsDivider + 6), right: p(M.padding - 5) }}
      >
        <FlagLine
          zoom={zoom}
          label="Portée modifiable"
          on={data.modifiableRange}
        />
        <FlagLine zoom={zoom} label="Ligne de vue" on={data.lineOfSight} />
        <FlagLine zoom={zoom} label="Lancer en ligne" on={data.lineOnly} />
        <FlagLine zoom={zoom} label="Cellules libres" on={data.emptyCell} />
        <FlagLine
          zoom={zoom}
          label="EC fini le tour"
          on={data.critFailureEndsTurn}
        />
        <FlagLine
          zoom={zoom}
          label="CC actuels"
          value={actualCrit > 0 ? `1/${actualCrit}` : "-"}
        />
      </Block>
    </DetailFrame>
  );
}

/**
 * Panel chrome: a white 3 px border with the top-right corner grown into
 * a tab that holds the level strip and the close button. That tab is the
 * one piece of the 1.29 spell window that the shared `Panel` component
 * cannot express — hence the bespoke frame here.
 */
function DetailFrame({
  zoom,
  onClose,
  levels,
  level,
  onSelectLevel,
  children,
}: {
  zoom: number;
  onClose: () => void;
  levels: number[];
  level: number;
  onSelectLevel?: (level: number) => void;
  children: React.ReactNode;
}) {
  const p = (n: number) => n * zoom;

  return (
    <div
      style={{
        position: "relative",
        width: p(M.width),
        height: p(M.height),
        background: "#ffffff",
        borderRadius: `${p(10)}px ${p(10)}px 0 0`,
        boxSizing: "border-box",
        pointerEvents: "auto",
        fontFamily: "Verdana, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Body inset by the white border, and by the tab on the right. */}
      <div
        style={{
          position: "absolute",
          left: p(M.border),
          right: p(M.border),
          top: p(M.border),
          bottom: 0,
          background: C.detailBody,
          borderRadius: `${p(7)}px ${p(7)}px 0 0`,
        }}
      />

      {/* "Niveaux du sort:" label sits on the body, left of the tab. */}
      <div
        style={{
          position: "absolute",
          right: p(M.levelLabelRight),
          top: p(M.levelLabelTop),
          fontSize: p(9),
          color: C.text,
        }}
      >
        Niveaux du sort:
      </div>

      {/*
        The white tab: level numbers + close. It has to sit above the
        content layer below, which spans the whole panel — without the
        z-index that layer wins the hit test and swallows every click on
        the level strip and on the close button.
      */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          zIndex: 2,
          width: p(M.levelTabWidth),
          height: p(M.levelTab),
          background: "#ffffff",
          borderRadius: `${p(8)}px ${p(8)}px 0 ${p(8)}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: p(9),
          paddingRight: p(9),
          boxSizing: "border-box",
        }}
      >
        {levels.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={l === level}
            onClick={() => onSelectLevel?.(l)}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: onSelectLevel ? "pointer" : "default",
              fontFamily: "Verdana, sans-serif",
              fontSize: p(10),
              color: l === level ? C.levelActive : "#4a4437",
            }}
          >
            {l}
          </button>
        ))}
        <button
          type="button"
          aria-label="Fermer"
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <svg
            width={p(10)}
            height={p(10)}
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path
              d="M1.8 0 6 4.2 10.2 0 12 1.8 7.8 6 12 10.2 10.2 12 6 7.8 1.8 12 0 10.2 4.2 6 0 1.8z"
              fill="#2b2b2b"
            />
          </svg>
        </button>
      </div>

      {/*
        Content sits in the panel's own coordinate space (offsets measured
        from the panel's top edge), and *under* the tab — the header block
        starts level with the tab's lower half, exactly as in the original.
      */}
      <div
        style={{ position: "absolute", inset: 0, zIndex: 1, color: C.text }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One absolutely-placed block of the detail panel. `top` is in base units
 * from the panel's top edge; horizontal placement comes from `style`.
 */
function Block({
  zoom,
  top,
  style,
  children,
}: {
  zoom: number;
  top: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: top * zoom,
        // `top` values are measured to the top of the glyphs, so the box
        // must not add half-leading above them.
        lineHeight: 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function EffectTab({
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
  const p = (n: number) => n * zoom;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        border: "none",
        background: active ? C.detailTabActive : C.detailTabInactive,
        borderRadius: `${p(4)}px ${p(4)}px 0 0`,
        height: p(M.tabsHeight),
        width: p(M.tabWidth),
        padding: 0,
        fontFamily: "Verdana, sans-serif",
        fontSize: p(9),
        fontWeight: active ? "bold" : "normal",
        color: active ? C.text : "#f2f0e4",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function EffectRow({
  zoom,
  index,
  effect,
}: {
  zoom: number;
  index: number;
  effect: SpellDetailEffect | undefined;
}) {
  const p = (n: number) => n * zoom;
  const formatted = effect ? formatEffect(effect) : null;

  return (
    <div
      style={{
        height: p(M.effectRowHeight),
        background: index % 2 === 0 ? C.detailRowEven : C.detailRowOdd,
        display: "flex",
        alignItems: "center",
        gap: p(3),
        paddingLeft: p(3),
        fontSize: p(9),
        color: C.text,
        boxSizing: "border-box",
      }}
    >
      {formatted?.element && (
        <ElementIcon element={formatted.element} size={p(M.effectIconSize)} />
      )}
      <span
        style={{
          // Rows without an element badge still start where the text of
          // a badged row does, so the column reads straight.
          marginLeft: formatted?.element ? 0 : p(M.effectIconSize + 3),
        }}
      >
        {formatted?.text ?? ""}
      </span>
    </div>
  );
}

const ELEMENT_FILL: Record<EffectElement, [string, string]> = {
  earth: ["#8a4a1e", "#c98a4a"],
  fire: ["#a32b1c", "#e08a52"],
  water: ["#1f5f96", "#6fb3e0"],
  air: ["#3f7a2a", "#8fc46a"],
  neutral: ["#6b6b6b", "#b4b4b4"],
};

/**
 * The little element badge in front of a damage/heal line. Retail draws
 * a bitmap per element; a triangle in the element's two-tone palette
 * reads the same at this size and stays crisp at any zoom.
 */
function ElementIcon({
  element,
  size,
}: {
  element: EffectElement;
  size: number;
}) {
  const [dark, light] = ELEMENT_FILL[element];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M6 1 11 11H1z" fill={dark} />
      <path d="M6 4 9 9.5H3z" fill={light} />
    </svg>
  );
}

function StatLine({
  zoom,
  label,
  value,
}: {
  zoom: number;
  label: string;
  value: string;
}) {
  const p = (n: number) => n * zoom;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: p(6),
        fontSize: p(9),
        height: p(M.statLineHeight),
      }}
    >
      <span>{label}</span>
      <span style={{ fontWeight: "bold", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

/**
 * A right-column line: a label plus either a check/cross or, for the one
 * row that carries a number ("CC actuels"), the value itself.
 */
function FlagLine({
  zoom,
  label,
  on,
  value,
}: {
  zoom: number;
  label: string;
  on?: boolean;
  value?: string;
}) {
  const p = (n: number) => n * zoom;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: p(6),
        fontSize: p(9),
        height: p(M.flagLineHeight),
      }}
    >
      <span>{label}</span>
      {value !== undefined ? (
        <span style={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
          {value}
        </span>
      ) : on ? (
        <CheckIcon size={p(11)} />
      ) : (
        <CrossIcon size={p(11)} />
      )}
    </div>
  );
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      role="img"
      aria-label="oui"
    >
      <path
        d="M1 6.4 4.3 9.8 11 2.6"
        fill="none"
        stroke={C.check}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      role="img"
      aria-label="non"
    >
      <path
        d="M2 2 10 10M10 2 2 10"
        fill="none"
        stroke={C.cross}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** `1 à 8`, or just the maximum when the minimum is 0 — as in the list. */
function formatRangeLong(min: number, max: number): string {
  return min === 0 ? String(max) : `${min} à ${max}`;
}
