import { useState } from "react";

import { Panel } from "../components/Panel";

interface GuildPanelProps {
  onClose: () => void;
  zoom?: number;
}

const COLORS = {
  SLOT_BG: "#dcd5bf",
  BORDER: "#8b7355",
  BG_ALT: "#c9bf9d",
  BG_ALT_DARK: "#b4ac8d",
  HEADER_BG: "#514a3c",
  BAR_BG: "#514a3c",
  TEXT_DARK: "#514a3c",
  TEXT_WHITE: "#ffffff",
  XP: "#6699ff",
};

export function GuildPanel({ onClose, zoom = 1 }: GuildPanelProps) {
  const [activeTab, setActiveTab] = useState("members");

  const p = (n: number) => Math.round(n * zoom);

  const TAB_NAMES = [
    "Membres",
    "Infos",
    "Bonus",
    "Percepteurs",
    "Enclos",
    "Maisons",
  ];
  const TAB_KEYS = [
    "members",
    "info",
    "bonus",
    "perceptors",
    "enclos",
    "houses",
  ];

  return (
    <Panel
      title="Guilde"
      width={320}
      height={363}
      onClose={onClose}
      zoom={zoom}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {/* Tab bar at y=0, height=20 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: p(20),
            display: "flex",
            borderBottom: `${p(1)}px solid ${COLORS.BORDER}`,
            zIndex: 10,
          }}
        >
          {TAB_KEYS.map((key, idx) => (
            <button
              type="button"
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                flex: 1,
                background:
                  activeTab === key ? COLORS.HEADER_BG : COLORS.BG_ALT,
                color: activeTab === key ? COLORS.TEXT_WHITE : COLORS.TEXT_DARK,
                border: "none",
                borderRight: `${p(1)}px solid ${COLORS.BORDER}`,
                padding: 0,
                cursor: "pointer",
                fontSize: p(9),
                fontWeight: activeTab === key ? "bold" : "normal",
                fontFamily: "Verdana, sans-serif",
              }}
            >
              {TAB_NAMES[idx]}
            </button>
          ))}
        </div>

        {/* Content area starting at y=20 */}
        <div
          style={{
            position: "relative",
            top: p(20),
            width: "100%",
            height: "100%",
          }}
        >
          {activeTab === "members" && (
            <div>
              {/* Emblem slot (48x48 centered at x=136, y=10) */}
              <div
                style={{
                  position: "absolute",
                  left: p(136),
                  top: p(10),
                  width: p(48),
                  height: p(48),
                  background: COLORS.SLOT_BG,
                  border: `${p(1)}px solid ${COLORS.BORDER}`,
                  borderRadius: p(2),
                  zIndex: 1,
                }}
              />

              {/* "Emblème" label (y=62) */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(62),
                  width: "100%",
                  textAlign: "center",
                  fontSize: p(10),
                  color: COLORS.TEXT_DARK,
                  zIndex: 1,
                }}
              >
                Emblème
              </div>

              {/* Guild level text (y=78, large bold) */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(78),
                  width: "100%",
                  textAlign: "center",
                  fontSize: p(13),
                  fontWeight: "bold",
                  color: COLORS.TEXT_DARK,
                  zIndex: 1,
                }}
              >
                Niveau 1
              </div>

              {/* XP progress bar (label at x=20, bar from x=90) at y=100 */}
              <div
                style={{
                  position: "absolute",
                  left: p(20),
                  top: p(102),
                  fontSize: p(10),
                  color: COLORS.TEXT_DARK,
                  zIndex: 1,
                }}
              >
                XP
              </div>
              <div
                style={{
                  position: "absolute",
                  left: p(90),
                  top: p(105),
                  width: p(220),
                  height: p(10),
                  background: COLORS.BAR_BG,
                  border: `${p(1)}px solid ${COLORS.BAR_BG}`,
                  borderRadius: p(1),
                  overflow: "hidden",
                  zIndex: 1,
                }}
              >
                <div
                  style={{ height: "100%", width: "0%", background: COLORS.XP }}
                />
              </div>

              {/* Guild note section header at y=128 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(128),
                  width: "100%",
                  height: p(18),
                  background: COLORS.HEADER_BG,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: p(8),
                  fontSize: p(10),
                  fontWeight: "bold",
                  color: COLORS.TEXT_WHITE,
                  zIndex: 1,
                }}
              >
                Note de guilde
              </div>

              {/* Guild note text area (80px height at y=146) */}
              <div
                style={{
                  position: "absolute",
                  left: p(6),
                  top: p(146),
                  width: p(308),
                  height: p(80),
                  background: "#ffffff",
                  border: `${p(1)}px solid ${COLORS.BORDER}`,
                  borderRadius: p(2),
                  padding: p(4),
                  overflow: "auto",
                  zIndex: 1,
                }}
              />

              {/* Members section header at y=234 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(234),
                  width: "100%",
                  height: p(18),
                  background: COLORS.HEADER_BG,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: p(8),
                  fontSize: p(10),
                  fontWeight: "bold",
                  color: COLORS.TEXT_WHITE,
                  zIndex: 1,
                }}
              >
                Membres
              </div>

              {/* Members list: 6 rows (y: 252-360, height 18 each) */}
              {[...Array(6)].map((_, i) => (
                <div
                  key={`member-${i}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: p(252 + i * 18),
                    width: "100%",
                    height: p(18),
                    background:
                      i % 2 === 1 ? COLORS.BG_ALT_DARK : COLORS.BG_ALT,
                    borderBottom: `${p(1)}px solid ${COLORS.BORDER}`,
                    paddingLeft: p(6),
                    fontSize: p(10),
                    color: COLORS.TEXT_DARK,
                    display: "flex",
                    alignItems: "center",
                    zIndex: 1,
                  }}
                />
              ))}
            </div>
          )}

          {activeTab !== "members" && (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: p(10),
                color: COLORS.TEXT_DARK,
              }}
            >
              {activeTab === "info"
                ? "Infos"
                : activeTab === "bonus"
                  ? "Bonus"
                  : activeTab === "perceptors"
                    ? "Percepteurs"
                    : activeTab === "enclos"
                      ? "Enclos"
                      : "Maisons"}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
