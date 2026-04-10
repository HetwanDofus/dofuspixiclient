import { Panel } from "../components/Panel";
import { getBoostCost } from "./boost-costs";
import type { CharacterStats, StatValue } from "../../types/stats";
import { STAT_IDS, STAT_NAMES } from "../../types/stats";

interface StatsPanelProps {
  stats: CharacterStats | null;
  name: string;
  level: number;
  classId: number;
  onClose: () => void;
  onBoostStat: (statId: number) => void;
  zoom?: number;
}

const STAT_ORDER = [
  STAT_IDS.VITALITY,
  STAT_IDS.WISDOM,
  STAT_IDS.STRENGTH,
  STAT_IDS.INTELLIGENCE,
  STAT_IDS.CHANCE,
  STAT_IDS.AGILITY,
];

const ICON_MAP: Record<string, string> = {
  hp: "/themes/classic/assets/stats/icon-hp.svg",
  ap: "/themes/classic/assets/stats/icon-ap.svg",
  mp: "/themes/classic/assets/stats/icon-mp.svg",
  initiative: "/themes/classic/assets/stats/icon-initiative.svg",
  prospection: "/themes/classic/assets/stats/icon-prospection.svg",
  vitality: "/themes/classic/assets/stats/icon-vitality.svg",
  wisdom: "/themes/classic/assets/stats/icon-wisdom.svg",
  strength: "/themes/classic/assets/stats/icon-earth-bonus.svg",
  intelligence: "/themes/classic/assets/stats/icon-fire-bonus.svg",
  chance: "/themes/classic/assets/stats/icon-water-bonus.svg",
  agility: "/themes/classic/assets/stats/icon-air-bonus.svg",
  alignment: "/themes/classic/assets/stats/icon-alignment.svg",
};

const PANEL_W = 240;
const PANEL_H = 417;
const TITLE_BAR_H = 22;
const ROW_H = 18;
const BAR_H = 10;
const ICON_SIZE = 14;
const ALIGN_FRAME_SIZE = 50;
const ALIGN_FRAME_PADDING = 6;
const JOB_SLOT_SIZE = 42;
const SPEC_SLOT_SIZE = 30;
const HEADER_H = 18;

const COLORS = {
  SLOT_BG: "#dcd5bf",
  ALIGN_BORDER: "#8b7355",
  BG_ALT: "#c9bf9d",
  BG_ALT_DARK: "#b4ac8d",
  HEADER_BG: "#514a3c",
  CAPITAL_BG: "#93866c",
  BAR_BG: "#514a3c",
  TEXT_DARK: "#514a3c",
  TEXT_WHITE: "#ffffff",
  ENERGY: "#cccc33",
  XP: "#6699ff",
};

export function StatsPanel({
  stats,
  name,
  level,
  classId,
  onClose,
  onBoostStat,
  zoom = 1,
}: StatsPanelProps) {
  if (!stats) return null;

  const p = (n: number) => Math.round(n * zoom);

  const getStatValue = (stat: StatValue): { base: number; total: number; bonus: number } => {
    const total = stat.base + stat.items + stat.boost;
    return {
      base: stat.base,
      total,
      bonus: stat.items + stat.boost,
    };
  };

  const statsData = {
    [STAT_IDS.VITALITY]: getStatValue(stats.vitality),
    [STAT_IDS.WISDOM]: getStatValue(stats.wisdom),
    [STAT_IDS.STRENGTH]: getStatValue(stats.strength),
    [STAT_IDS.INTELLIGENCE]: getStatValue(stats.intelligence),
    [STAT_IDS.CHANCE]: getStatValue(stats.chance),
    [STAT_IDS.AGILITY]: getStatValue(stats.agility),
  };

  const xpPercent = stats.xpHigh > stats.xpLow
    ? ((stats.xp - stats.xpLow) / (stats.xpHigh - stats.xpLow)) * 100
    : 0;

  const titleBarCenterY = (TITLE_BAR_H - 11) / 2 + 11;

  return (
    <Panel title="Caractéristiques" width={PANEL_W} height={PANEL_H} onClose={onClose} zoom={zoom}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>

        {/* Content area with absolute positioning */}
        <div style={{ position: "relative", width: "100%", height: "100%" }}>

          {/* Alignment frame (50x50 at x=10, y=10) */}
          <div
            style={{
              position: "absolute",
              left: p(10),
              top: p(10),
              width: p(ALIGN_FRAME_SIZE),
              height: p(ALIGN_FRAME_SIZE),
              background: COLORS.SLOT_BG,
              border: `${p(1)}px solid ${COLORS.ALIGN_BORDER}`,
              borderRadius: p(2),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={ICON_MAP.alignment}
              alt="alignment"
              style={{
                width: p(ALIGN_FRAME_SIZE - ALIGN_FRAME_PADDING * 2),
                height: p(ALIGN_FRAME_SIZE - ALIGN_FRAME_PADDING * 2),
              }}
            />
          </div>

          {/* Name text (x=57, y=centered in title bar) */}
          <div
            style={{
              position: "absolute",
              left: p(57),
              top: p(3),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_WHITE,
            }}
          >
            {name}
          </div>

          {/* Level text (x=57, y=30) */}
          <div
            style={{
              position: "absolute",
              left: p(57),
              top: p(30),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
            }}
          >
            Niv. {level}
          </div>

          {/* BG_ALT rect from y=54, height=260 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: p(54),
              width: "100%",
              height: p(260),
              background: COLORS.BG_ALT,
              pointerEvents: "none",
              zIndex: 0,
            }}
          />

          {/* BG_ALT rect from y=348, height=60 */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: p(348),
              width: "100%",
              height: p(60),
              background: COLORS.BG_ALT,
              pointerEvents: "none",
              zIndex: 0,
            }}
          />

          {/* Dark alternating rows at y: [73, 111, 147, 202, 238, 274] */}
          {[73, 111, 147, 202, 238, 274].map((y, idx) => (
            <div
              key={`row-bg-${idx}`}
              style={{
                position: "absolute",
                left: 0,
                top: p(y),
                width: "100%",
                height: p(ROW_H),
                background: COLORS.BG_ALT_DARK,
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
          ))}

          {/* Energy row (y=53) */}
          <div style={{ position: "absolute", left: p(20), top: p(57), zIndex: 1 }}>
            <span
              style={{
                fontSize: p(11),
                fontWeight: "bold",
                color: COLORS.TEXT_DARK,
              }}
            >
              Énergie
            </span>
          </div>
          <div
            style={{
              position: "absolute",
              left: p(124),
              top: p(60),
              width: p(100),
              height: p(BAR_H),
              background: COLORS.BAR_BG,
              border: `${p(1)}px solid ${COLORS.BAR_BG}`,
              borderRadius: p(1),
              overflow: "hidden",
              zIndex: 1,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(stats.energy / stats.maxEnergy) * 100}%`,
                background: COLORS.ENERGY,
              }}
            />
          </div>

          {/* XP row (y=73) */}
          <div style={{ position: "absolute", left: p(20), top: p(77), zIndex: 1 }}>
            <span
              style={{
                fontSize: p(11),
                fontWeight: "bold",
                color: COLORS.TEXT_DARK,
              }}
            >
              XP
            </span>
          </div>
          <div
            style={{
              position: "absolute",
              left: p(124),
              top: p(80),
              width: p(100),
              height: p(BAR_H),
              background: COLORS.BAR_BG,
              border: `${p(1)}px solid ${COLORS.BAR_BG}`,
              borderRadius: p(1),
              overflow: "hidden",
              zIndex: 1,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${xpPercent}%`,
                background: COLORS.XP,
              }}
            />
          </div>

          {/* Combat stats rows */}
          {/* HP row (y=92) */}
          <div style={{ position: "absolute", left: p(20), top: p(96), zIndex: 1 }}>
            <img
              src={ICON_MAP.hp}
              alt="HP"
              style={{
                position: "absolute",
                width: p(ICON_SIZE),
                height: p(ICON_SIZE),
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: p(38),
              top: p(94),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            PV
          </div>
          <div
            style={{
              position: "absolute",
              right: p(10),
              top: p(94),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            {stats.hp} / {stats.maxHp}
          </div>

          {/* AP row (y=110) */}
          <div style={{ position: "absolute", left: p(20), top: p(114), zIndex: 1 }}>
            <img
              src={ICON_MAP.ap}
              alt="AP"
              style={{
                position: "absolute",
                width: p(ICON_SIZE),
                height: p(ICON_SIZE),
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: p(38),
              top: p(112),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            PA
          </div>
          <div
            style={{
              position: "absolute",
              right: p(10),
              top: p(112),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            {stats.ap}
          </div>

          {/* MP row (y=128) */}
          <div style={{ position: "absolute", left: p(20), top: p(132), zIndex: 1 }}>
            <img
              src={ICON_MAP.mp}
              alt="MP"
              style={{
                position: "absolute",
                width: p(ICON_SIZE),
                height: p(ICON_SIZE),
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: p(38),
              top: p(130),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            PM
          </div>
          <div
            style={{
              position: "absolute",
              right: p(10),
              top: p(130),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            {stats.mp}
          </div>

          {/* Initiative row (y=146) */}
          <div style={{ position: "absolute", left: p(20), top: p(150), zIndex: 1 }}>
            <img
              src={ICON_MAP.initiative}
              alt="Initiative"
              style={{
                position: "absolute",
                width: p(ICON_SIZE),
                height: p(ICON_SIZE),
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: p(38),
              top: p(148),
              fontSize: p(11),
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            Initiative
          </div>
          <div
            style={{
              position: "absolute",
              right: p(10),
              top: p(148),
              fontSize: p(11),
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            {stats.initiative}
          </div>

          {/* Prospection row (y=164) */}
          <div style={{ position: "absolute", left: p(20), top: p(168), zIndex: 1 }}>
            <img
              src={ICON_MAP.prospection}
              alt="Prospection"
              style={{
                position: "absolute",
                width: p(ICON_SIZE),
                height: p(ICON_SIZE),
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              left: p(38),
              top: p(166),
              fontSize: p(11),
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            Prospection
          </div>
          <div
            style={{
              position: "absolute",
              right: p(10),
              top: p(166),
              fontSize: p(11),
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            {stats.discernment}
          </div>

          {/* Caractéristiques header (y~182) */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: p(182),
              width: "100%",
              height: p(HEADER_H),
              background: COLORS.HEADER_BG,
              display: "flex",
              alignItems: "center",
              zIndex: 1,
            }}
          >
            <span
              style={{
                marginLeft: p(15),
                fontSize: p(11),
                fontWeight: "bold",
                color: COLORS.TEXT_WHITE,
              }}
            >
              Caractéristiques
            </span>
            <img
              src="/themes/classic/assets/common/quill.svg"
              alt="quill"
              style={{
                position: "absolute",
                right: p(14),
                width: p(12),
                height: p(12),
              }}
            />
          </div>

          {/* 6 Characteristic rows starting at y=200 */}
          {STAT_ORDER.map((statId, idx) => {
            const stat = statsData[statId];
            const cost = getBoostCost(classId, statId, stat.base);
            const canBoost = stats.bonusPoints >= cost;
            const yPos = 200 + idx * ROW_H;

            return (
              <div key={statId} style={{ position: "relative", zIndex: 1 }}>
                <img
                  src={ICON_MAP[getIconKeyForStat(statId)]}
                  alt={STAT_NAMES[statId]}
                  style={{
                    position: "absolute",
                    left: p(5),
                    top: p(yPos + 2),
                    width: p(ICON_SIZE),
                    height: p(ICON_SIZE),
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: p(22),
                    top: p(yPos + 3),
                    fontSize: p(11),
                    color: COLORS.TEXT_DARK,
                  }}
                >
                  {STAT_NAMES[statId]}
                </span>
                <span
                  style={{
                    position: "absolute",
                    right: canBoost ? p(30) : p(10),
                    top: p(yPos + 3),
                    fontSize: p(11),
                    fontWeight: "bold",
                    color: COLORS.TEXT_DARK,
                  }}
                >
                  {stat.base}{stat.bonus > 0 && ` (+${stat.bonus})`}
                </span>
                {canBoost && (
                  <button
                    onClick={() => onBoostStat(statId)}
                    style={{
                      position: "absolute",
                      right: p(10),
                      top: p(yPos + 2),
                      width: p(20),
                      height: p(14),
                      background: "#ff9900",
                      color: COLORS.TEXT_WHITE,
                      border: `${p(1)}px solid #cc6600`,
                      borderRadius: p(2),
                      fontSize: p(9),
                      fontWeight: "bold",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 2,
                    }}
                  >
                    <img
                      src="/themes/classic/assets/common/plus-up.svg"
                      alt="+"
                      style={{
                        width: p(10),
                        height: p(10),
                      }}
                    />
                  </button>
                )}
              </div>
            );
          })}

          {/* Capital header (after stat rows, y~338) */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: p(338),
              width: "100%",
              height: p(HEADER_H),
              background: COLORS.CAPITAL_BG,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingLeft: p(20),
              paddingRight: p(10),
              zIndex: 1,
            }}
          >
            <span
              style={{
                fontSize: p(11),
                fontWeight: "bold",
                color: COLORS.TEXT_WHITE,
              }}
            >
              Capital
            </span>
            <span
              style={{
                fontSize: p(11),
                fontWeight: "bold",
                color: COLORS.TEXT_WHITE,
              }}
            >
              {stats.bonusPoints}
            </span>
          </div>

          {/* Mes Métiers header (y~356) */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: p(356),
              width: "100%",
              height: p(HEADER_H),
              background: COLORS.HEADER_BG,
              display: "flex",
              alignItems: "center",
              zIndex: 1,
            }}
          >
            <span
              style={{
                marginLeft: p(15),
                fontSize: p(11),
                fontWeight: "bold",
                color: COLORS.TEXT_WHITE,
              }}
            >
              Mes Métiers
            </span>
          </div>

          {/* Job slots (3 slots at x: [9, 54, 99], y=355) */}
          {[
            { x: 9, y: 374 },
            { x: 54, y: 374 },
            { x: 99, y: 374 },
          ].map((pos, i) => (
            <div
              key={`job-${i}`}
              style={{
                position: "absolute",
                left: p(pos.x),
                top: p(pos.y),
                width: p(JOB_SLOT_SIZE),
                height: p(JOB_SLOT_SIZE),
                background: COLORS.SLOT_BG,
                border: `${p(1)}px solid ${COLORS.ALIGN_BORDER}`,
                borderRadius: p(2),
                zIndex: 1,
              }}
            />
          ))}

          {/* Spécialisations label (x=141, y=349) */}
          <span
            style={{
              position: "absolute",
              left: p(141),
              top: p(349),
              fontSize: p(11),
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            Spécialisations
          </span>

          {/* Spec slots (3 slots at x: [146, 175, 205], y=370) */}
          {[
            { x: 146, y: 370 },
            { x: 175, y: 370 },
            { x: 205, y: 370 },
          ].map((pos, i) => (
            <div
              key={`spec-${i}`}
              style={{
                position: "absolute",
                left: p(pos.x),
                top: p(pos.y),
                width: p(SPEC_SLOT_SIZE),
                height: p(SPEC_SLOT_SIZE),
                background: COLORS.SLOT_BG,
                border: `${p(1)}px solid ${COLORS.ALIGN_BORDER}`,
                borderRadius: p(2),
                zIndex: 1,
              }}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function getIconKeyForStat(statId: number): string {
  const iconMap: Record<number, string> = {
    0: "vitality",
    1: "wisdom",
    2: "strength",
    3: "intelligence",
    4: "chance",
    5: "agility",
  };
  return iconMap[statId] || "vitality";
}
