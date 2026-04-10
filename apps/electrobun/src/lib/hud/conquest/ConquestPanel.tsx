import { useState } from "react";
import { Panel } from "../components/Panel";

interface ConquestPanelProps {
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
  BAR_FILL: "#ff6600",
  PVP_INACTIVE: "#cc3333",
};

export function ConquestPanel({ onClose, zoom = 1 }: ConquestPanelProps) {
  const [activeTab, setActiveTab] = useState("stats");

  const p = (n: number) => Math.round(n * zoom);

  return (
    <Panel title="Conquête" width={228} height={358} onClose={onClose} zoom={zoom}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
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
          {["Stats", "Zones", "Rejoindre"].map((label, idx) => (
            <button
              key={label}
              onClick={() => setActiveTab(["stats", "zones", "join"][idx])}
              style={{
                flex: 1,
                background: activeTab === ["stats", "zones", "join"][idx] ? COLORS.HEADER_BG : COLORS.BG_ALT,
                color: activeTab === ["stats", "zones", "join"][idx] ? COLORS.TEXT_WHITE : COLORS.TEXT_DARK,
                border: "none",
                borderRight: `${p(1)}px solid ${COLORS.BORDER}`,
                padding: 0,
                cursor: "pointer",
                fontSize: p(9),
                fontWeight: activeTab === ["stats", "zones", "join"][idx] ? "bold" : "normal",
                fontFamily: "Verdana, sans-serif",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content area starting at y=20 */}
        <div style={{ position: "relative", top: p(20), width: "100%", height: "100%" }}>
          {activeTab === "stats" && (
            <div>
              {/* "Équilibre mondial" section header at y=0 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
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
                Équilibre mondial
              </div>

              {/* World balance bar (label at x=20, bar from x=90) at y=22 */}
              <div
                style={{
                  position: "absolute",
                  left: p(20),
                  top: p(22),
                  fontSize: p(9),
                  color: COLORS.TEXT_DARK,
                  zIndex: 1,
                }}
              >
                Équilibre
              </div>
              <div
                style={{
                  position: "absolute",
                  left: p(90),
                  top: p(25),
                  width: p(120),
                  height: p(10),
                  background: COLORS.BAR_BG,
                  border: `${p(1)}px solid ${COLORS.BAR_BG}`,
                  borderRadius: p(1),
                  overflow: "hidden",
                  zIndex: 1,
                }}
              >
                <div style={{ height: "100%", width: "50%", background: COLORS.BAR_FILL }} />
              </div>

              {/* "Équilibre de zone" section header at y=50 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(50),
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
                Équilibre de zone
              </div>

              {/* Zone balance bar (label at x=20, bar from x=90) at y=72 */}
              <div
                style={{
                  position: "absolute",
                  left: p(20),
                  top: p(72),
                  fontSize: p(9),
                  color: COLORS.TEXT_DARK,
                  zIndex: 1,
                }}
              >
                Équilibre
              </div>
              <div
                style={{
                  position: "absolute",
                  left: p(90),
                  top: p(75),
                  width: p(120),
                  height: p(10),
                  background: COLORS.BAR_BG,
                  border: `${p(1)}px solid ${COLORS.BAR_BG}`,
                  borderRadius: p(1),
                  overflow: "hidden",
                  zIndex: 1,
                }}
              >
                <div style={{ height: "100%", width: "50%", background: COLORS.BAR_FILL }} />
              </div>

              {/* PvP status row at y=100 with red indicator circle */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(100),
                  width: "100%",
                  height: p(18),
                  background: COLORS.BG_ALT_DARK,
                  borderBottom: `${p(1)}px solid ${COLORS.BORDER}`,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: p(10),
                  fontSize: p(10),
                  color: COLORS.TEXT_DARK,
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    width: p(5),
                    height: p(5),
                    borderRadius: "50%",
                    background: COLORS.PVP_INACTIVE,
                    marginRight: p(8),
                  }}
                />
                <span>PvP : Inactif</span>
              </div>

              {/* Alignment row at y=118 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(118),
                  width: "100%",
                  height: p(18),
                  background: COLORS.BG_ALT,
                  borderBottom: `${p(1)}px solid ${COLORS.BORDER}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingLeft: p(10),
                  paddingRight: p(10),
                  fontSize: p(10),
                  color: COLORS.TEXT_DARK,
                  zIndex: 1,
                }}
              >
                <span>Alignement</span>
                <span>—</span>
              </div>

              {/* "Classement des guildes" section header at y=136 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: p(136),
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
                Classement des guildes
              </div>

              {/* 5 ranking rows (y: 154-226, height 18 each) */}
              {[...Array(5)].map((_, i) => (
                <div
                  key={`rank-${i}`}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: p(154 + i * 18),
                    width: "100%",
                    height: p(18),
                    background: i % 2 === 1 ? COLORS.BG_ALT_DARK : COLORS.BG_ALT,
                    borderBottom: `${p(1)}px solid ${COLORS.BORDER}`,
                    paddingLeft: p(6),
                    fontSize: p(10),
                    color: COLORS.TEXT_DARK,
                    display: "flex",
                    alignItems: "center",
                    zIndex: 1,
                  }}
                >
                  {`#${i + 1}`}
                </div>
              ))}
            </div>
          )}

          {activeTab !== "stats" && (
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
              {activeTab === "zones" ? "Zones" : "Rejoindre"}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
