import type { CharacterStats, StatValue } from "@/game/types/stats";
import { STAT_IDS, STAT_NAMES, statBonus, statTotal } from "@/game/types/stats";

import { Panel } from "../components/Panel";
import { getBoostCost } from "./boost-costs";
import { CharacterPortrait } from "./CharacterPortrait";
import {
  CHARACTERISTICS_COLORS as C,
  CHARACTERISTICS_METRICS as M,
  rowTop,
} from "./characteristics-theme";

interface StatsPanelProps {
  stats: CharacterStats | null;
  name: string;
  level: number;
  classId: number;
  gfxId: number;
  colors: readonly [number, number, number];
  onClose: () => void;
  onBoostStat: (statId: number) => void;
  zoom?: number;
}

const ICONS = "/themes/classic/assets/stats";

/**
 * The seven combat lines under the two gauges, in the order the retail
 * window prints them. The first three are the ones it sets in bold.
 */
const COMBAT_ROWS = [
  { key: "hp", label: "Points de vie", icon: `${ICONS}/icon-hp.svg` },
  { key: "ap", label: "Points d'actions", icon: `${ICONS}/icon-ap.svg` },
  { key: "mp", label: "Points de mouvement", icon: `${ICONS}/icon-mp.svg` },
  {
    key: "initiative",
    label: "Initiative",
    icon: `${ICONS}/icon-initiative.svg`,
  },
  {
    key: "prospection",
    label: "Prospection",
    icon: `${ICONS}/icon-prospection.svg`,
  },
  { key: "range", label: "Portée", icon: `${ICONS}/icon-range.svg` },
  { key: "summons", label: "Invocation", icon: `${ICONS}/icon-summons.svg` },
] as const;

/** How many of `COMBAT_ROWS` the window prints in bold. */
const PRIMARY_ROWS = 3;

/**
 * The six characteristics, in the window's own order — which is neither
 * `STAT_IDS`' numeric order nor alphabetical. Each carries its icon, so
 * there is one table rather than a name map and a separate icon map that
 * can drift out of step.
 */
const STAT_ROWS = [
  { id: STAT_IDS.VITALITY, icon: `${ICONS}/icon-vitality.svg` },
  { id: STAT_IDS.WISDOM, icon: `${ICONS}/icon-wisdom.svg` },
  { id: STAT_IDS.STRENGTH, icon: `${ICONS}/icon-earth-bonus.svg` },
  { id: STAT_IDS.INTELLIGENCE, icon: `${ICONS}/icon-fire-bonus.svg` },
  { id: STAT_IDS.CHANCE, icon: `${ICONS}/icon-water-bonus.svg` },
  { id: STAT_IDS.AGILITY, icon: `${ICONS}/icon-air-bonus.svg` },
] as const;

/**
 * "Tes caractéristiques" — a transcription of the retail 1.29 window
 * (see `characteristics-theme.ts` for how the offsets were derived).
 *
 * Identity block, the Énergie and Expérience gauges, seven combat lines,
 * then the six characteristics over a Capital counter and the job slots.
 * Nothing here is computed: every number comes from the last `As` frame,
 * and the `+` button only decides whether it is *drawn* — the server
 * re-prices the boost and is the authority on whether it happens.
 */
export function StatsPanel({
  stats,
  name,
  level,
  classId,
  gfxId,
  colors,
  onClose,
  onBoostStat,
  zoom = 1,
}: StatsPanelProps) {
  const p = (n: number) => n * zoom;

  if (!stats) {
    return null;
  }

  const combatValues: Record<(typeof COMBAT_ROWS)[number]["key"], string> = {
    hp: `${stats.hp} / ${stats.maxHp}`,
    ap: String(statTotal(stats.ap)),
    mp: String(statTotal(stats.mp)),
    initiative: String(stats.initiative),
    prospection: String(stats.discernment),
    range: String(statTotal(stats.range)),
    summons: String(statTotal(stats.summonLimit)),
  };

  const statValues: Record<number, StatValue> = {
    [STAT_IDS.VITALITY]: stats.vitality,
    [STAT_IDS.WISDOM]: stats.wisdom,
    [STAT_IDS.STRENGTH]: stats.strength,
    [STAT_IDS.INTELLIGENCE]: stats.intelligence,
    [STAT_IDS.CHANCE]: stats.chance,
    [STAT_IDS.AGILITY]: stats.agility,
  };

  // The band under the last combat line, and everything that follows it.
  const caracBandTop = rowTop(COMBAT_ROWS.length + 2);
  const statRowsTop = caracBandTop + M.bandHeight;
  const capitalTop = statRowsTop + STAT_ROWS.length * M.rowHeight;
  const jobBandTop = capitalTop + M.capitalHeight;
  const jobSlotsTop = jobBandTop + M.bandHeight + M.jobSlotY;

  return (
    <Panel
      title="Tes caractéristiques"
      width={M.width}
      height={M.height}
      onClose={onClose}
      zoom={zoom}
      style={{ background: C.body }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          color: C.text,
          fontFamily: "Verdana, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Alternating row stripes. They run the full width behind
            everything else, so each block below only paints its own
            content. The identity block gets its own three, taller. */}
        {[0, 1, 2].map((i) => (
          <Stripe
            key={`identity-stripe-${i}`}
            top={p(M.headerTop + i * M.identityRowHeight)}
            height={p(M.identityRowHeight)}
            dark={i % 2 === 0}
          />
        ))}
        {Array.from({ length: COMBAT_ROWS.length + 2 }, (_, i) => (
          <Stripe
            key={`row-stripe-${i}`}
            top={p(rowTop(i))}
            height={p(M.rowHeight)}
            dark={i % 2 === 1}
          />
        ))}
        {STAT_ROWS.map((row, i) => (
          <Stripe
            key={`stat-stripe-${row.id}`}
            top={p(statRowsTop + i * M.rowHeight)}
            height={p(M.rowHeight)}
            dark={i % 2 === 0}
          />
        ))}

        {/* ── Identity: alignment, compass, portrait, name, level ── */}
        <Slot
          left={p(M.alignSlotX)}
          top={p(M.headerTop + 2)}
          size={p(M.alignSlot)}
        >
          <img
            src={`${ICONS}/icon-alignment.svg`}
            alt="Alignement"
            style={{ width: "70%", height: "70%" }}
          />
        </Slot>
        <Slot
          left={p(M.alignSlotX)}
          top={p(M.headerTop + M.compassSlotY)}
          size={p(M.alignSlot)}
        >
          <Compass size={p(M.alignSlot * 0.6)} />
        </Slot>

        <div
          style={{
            position: "absolute",
            left: p(M.portraitX),
            top: p(M.headerTop),
            width: p(M.portraitWidth),
            height: p(M.headerHeight),
          }}
        >
          <CharacterPortrait
            gfxId={gfxId}
            colors={colors}
            pixelSize={Math.round(p(M.headerHeight))}
            label={name}
          />
        </div>

        <IdentityLine index={0} zoom={zoom} bold>
          {name}
        </IdentityLine>
        <IdentityLine index={1} zoom={zoom}>
          Niveau {level}
        </IdentityLine>
        <IdentityLine index={2} zoom={zoom}>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: p(4) }}
          >
            <Trophy size={p(M.iconSize)} />
            {stats.successPoints} points
          </span>
        </IdentityLine>

        {/* ── Énergie / Expérience gauges ── */}
        <Gauge
          index={0}
          label="Énergie"
          fraction={fraction(stats.energy, stats.maxEnergy)}
          zoom={zoom}
        />
        <Gauge
          index={1}
          label="Expérience"
          fraction={levelFraction(stats)}
          zoom={zoom}
        />
        <div
          style={{
            position: "absolute",
            left: p(M.xpButtonX),
            top: p(rowTop(1) + (M.rowHeight - M.xpButtonSize) / 2),
            width: p(M.xpButtonSize),
            height: p(M.xpButtonSize),
            background: C.plus,
            border: `${Math.max(1, p(1))}px solid ${C.plusBorder}`,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width={p(M.xpButtonSize) * 0.6}
            height={p(M.xpButtonSize) * 0.6}
            viewBox="0 0 10 10"
            aria-hidden="true"
          >
            <path d="M5 1l4 5H6v3H4V6H1z" fill={C.plusText} />
          </svg>
        </div>

        {/* ── Combat lines ── */}
        {COMBAT_ROWS.map((row, i) => (
          <Line
            key={row.key}
            top={p(rowTop(i + 2))}
            icon={row.icon}
            label={row.label}
            zoom={zoom}
            bold={i < PRIMARY_ROWS}
          >
            <span
              style={{
                position: "absolute",
                right: p(M.valueRight),
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: p(9.5),
                fontWeight: i < PRIMARY_ROWS ? "bold" : "normal",
                color: i < PRIMARY_ROWS ? C.text : C.textMuted,
              }}
            >
              {combatValues[row.key]}
            </span>
          </Line>
        ))}

        {/* ── Caractéristiques ── */}
        <Band top={p(caracBandTop)} zoom={zoom} label="Caractéristiques">
          <img
            src={`${ICONS}/QuillIcon.svg`}
            alt=""
            style={{
              position: "absolute",
              right: p(M.bandTextX),
              width: p(M.iconSize),
              height: p(M.iconSize),
            }}
          />
        </Band>

        {STAT_ROWS.map((row, i) => {
          const value = statValues[row.id];
          if (!value) {
            return null;
          }
          const bonus = statBonus(value);
          const cost = getBoostCost(classId, row.id, value.base);
          const canBoost = stats.bonusPoints >= cost;
          const label = STAT_NAMES[row.id] ?? "";

          return (
            <Line
              key={row.id}
              top={p(statRowsTop + i * M.rowHeight)}
              icon={row.icon}
              label={label}
              zoom={zoom}
            >
              <span
                style={{
                  position: "absolute",
                  right: p(M.statValueRight),
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: p(9.5),
                  fontWeight: "bold",
                  whiteSpace: "nowrap",
                }}
              >
                {value.base}
                {bonus !== 0 && ` (${bonus > 0 ? "+" : ""}${bonus})`}
              </span>
              {canBoost && (
                <PlusButton
                  zoom={zoom}
                  label={`Augmenter ${label} pour ${cost} point${
                    cost > 1 ? "s" : ""
                  } de capital`}
                  onClick={() => onBoostStat(row.id)}
                />
              )}
            </Line>
          );
        })}

        {/* ── Capital ── */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: p(capitalTop),
            width: "100%",
            height: p(M.capitalHeight),
            background: C.capitalBand,
            color: C.bandText,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingLeft: p(M.bandTextX),
            paddingRight: p(M.valueRight),
            boxSizing: "border-box",
            fontSize: p(9.5),
            fontWeight: "bold",
          }}
        >
          <span>Capital</span>
          <span>{stats.bonusPoints}</span>
        </div>

        {/* ── Métiers. No jobs module exists client-side yet, so the
            slots are drawn empty — the window is the same shape it will
            be once one does. ── */}
        <Band top={p(jobBandTop)} zoom={zoom} label="Mes Métiers" />
        {[0, 1, 2].map((i) => (
          <Slot
            key={`job-${i}`}
            left={p(M.jobSlotX + i * (M.jobSlot + M.jobSlotGap))}
            top={p(jobSlotsTop)}
            size={p(M.jobSlot)}
          />
        ))}
        <span
          style={{
            position: "absolute",
            left: p(M.specLabelX),
            top: p(jobBandTop + M.bandHeight + 1),
            fontSize: p(8),
            color: C.textMuted,
          }}
        >
          Spécialisations
        </span>
        {[0, 1, 2].map((i) => (
          <Slot
            key={`spec-${i}`}
            left={p(M.specLabelX + i * (M.specSlot + 4))}
            top={p(jobSlotsTop + M.jobSlot - M.specSlot)}
            size={p(M.specSlot)}
          />
        ))}
      </div>
    </Panel>
  );
}

function Stripe({
  top,
  height,
  dark,
}: {
  top: number;
  height: number;
  dark: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: "100%",
        height,
        background: dark ? C.rowAlt : C.body,
        pointerEvents: "none",
      }}
    />
  );
}

/** One line of the identity block, to the right of the portrait. */
function IdentityLine({
  index,
  zoom,
  bold = false,
  children,
}: {
  index: number;
  zoom: number;
  bold?: boolean;
  children: React.ReactNode;
}) {
  const p = (n: number) => n * zoom;
  return (
    <div
      style={{
        position: "absolute",
        left: p(M.identityX),
        right: p(M.valueRight),
        top: p(M.headerTop + (index + 0.5) * M.identityRowHeight),
        transform: "translateY(-50%)",
        fontSize: p(10),
        fontWeight: bold ? "bold" : "normal",
        color: C.text,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </div>
  );
}

/** A labelled gauge on one of the grid's rows. */
function Gauge({
  index,
  label,
  fraction: filled,
  zoom,
}: {
  index: number;
  label: string;
  fraction: number;
  zoom: number;
}) {
  const p = (n: number) => n * zoom;
  const top = rowTop(index);
  return (
    <>
      <span
        style={{
          position: "absolute",
          left: p(M.gaugeLabelX),
          top: p(top + M.rowHeight / 2),
          transform: "translateY(-50%)",
          fontSize: p(9.5),
          fontWeight: "bold",
        }}
      >
        {label}
      </span>
      <div
        style={{
          position: "absolute",
          left: p(M.gaugeX),
          top: p(top + (M.rowHeight - M.gaugeHeight) / 2),
          width: p(M.gaugeWidth),
          height: p(M.gaugeHeight),
          background: C.gaugeTrack,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${filled * 100}%`,
            background: C.gauge,
          }}
        />
      </div>
    </>
  );
}

/** Icon + label on the left of a row; `children` places the value. */
function Line({
  top,
  icon,
  label,
  zoom,
  bold = false,
  children,
}: {
  top: number;
  icon: string;
  label: string;
  zoom: number;
  bold?: boolean;
  children: React.ReactNode;
}) {
  const p = (n: number) => n * zoom;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: "100%",
        height: p(M.rowHeight),
      }}
    >
      <img
        src={icon}
        alt=""
        style={{
          position: "absolute",
          left: p(M.iconX),
          top: "50%",
          transform: "translateY(-50%)",
          width: p(M.iconSize),
          height: p(M.iconSize),
        }}
      />
      <span
        style={{
          position: "absolute",
          left: p(M.labelX),
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: p(9.5),
          fontWeight: bold ? "bold" : "normal",
          color: bold ? C.text : C.textMuted,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** A full-width section band with a left-aligned label. */
function Band({
  top,
  zoom,
  label,
  children,
}: {
  top: number;
  zoom: number;
  label: string;
  children?: React.ReactNode;
}) {
  const p = (n: number) => n * zoom;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top,
        width: "100%",
        height: p(M.bandHeight),
        background: C.band,
        color: C.bandText,
        display: "flex",
        alignItems: "center",
        paddingLeft: p(M.bandTextX),
        boxSizing: "border-box",
        fontSize: p(9.5),
        fontWeight: "bold",
      }}
    >
      {label}
      {children}
    </div>
  );
}

/** An inset square — alignment frame, job slot, specialisation slot. */
function Slot({
  left,
  top,
  size,
  children,
}: {
  left: number;
  top: number;
  size: number;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        background: C.slot,
        border: `1px solid ${C.slotBorder}`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

function PlusButton({
  zoom,
  label,
  onClick,
}: {
  zoom: number;
  label: string;
  onClick: () => void;
}) {
  const p = (n: number) => n * zoom;
  const size = p(M.plusSize);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        position: "absolute",
        right: p(M.valueRight),
        top: "50%",
        transform: "translateY(-50%)",
        width: size,
        height: size,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.plus,
        border: `${Math.max(1, p(1))}px solid ${C.plusBorder}`,
        boxSizing: "border-box",
        cursor: "pointer",
      }}
    >
      <svg
        width={size * 0.7}
        height={size * 0.7}
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <path d="M4 0h2v4h4v2H6v4H4V6H0V4h4z" fill={C.plusText} />
      </svg>
    </button>
  );
}

function Compass({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 0l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"
        fill={C.band}
        stroke={C.slotBorder}
        strokeWidth="0.6"
      />
    </svg>
  );
}

function Trophy({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 1h8v4a4 4 0 0 1-8 0zM2 2h2v3a2 2 0 0 1-2-2zM12 2h2v1a2 2 0 0 1-2 2zM7 9h2v3H7zM4.5 12h7v2h-7z"
        fill="#e8b53a"
        stroke="#8a6a12"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fraction(current: number, max: number): number {
  if (max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, current / max));
}

/**
 * How far into the current level the character is. The bar is empty
 * rather than full when the server has not sent real bounds yet — an
 * `xpHigh` of 0 must not read as "level complete".
 */
function levelFraction(stats: CharacterStats): number {
  const span = stats.xpHigh - stats.xpLow;
  if (span <= 0) {
    return 0;
  }
  return fraction(stats.xp - stats.xpLow, span);
}
