import { Panel } from "../components/Panel";

interface MountPanelProps {
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

export function MountPanel({ onClose, zoom = 1 }: MountPanelProps) {
  const p = (n: number) => Math.round(n * zoom);

  return (
    <Panel title="Monture" width={250} height={300} onClose={onClose} zoom={zoom}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        {/* Mount viewer frame (140x100, centered at x=55, y=10) */}
        <div
          style={{
            position: "absolute",
            left: p(55),
            top: p(10),
            width: p(140),
            height: p(100),
            background: COLORS.SLOT_BG,
            border: `${p(1)}px solid ${COLORS.BORDER}`,
            borderRadius: p(4),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: p(11),
            color: COLORS.TEXT_DARK,
            zIndex: 1,
          }}
        >
          Pas de monture
        </div>

        {/* Name row (y=120): "Nom :" label at x=20, "—" value right-aligned at x=220 */}
        <div
          style={{
            position: "absolute",
            left: p(20),
            top: p(120),
            fontSize: p(11),
            fontWeight: "bold",
            color: COLORS.TEXT_DARK,
            zIndex: 1,
          }}
        >
          Nom :
        </div>
        <div
          style={{
            position: "absolute",
            right: p(10),
            top: p(120),
            fontSize: p(11),
            fontWeight: "bold",
            color: COLORS.TEXT_DARK,
            zIndex: 1,
          }}
        >
          —
        </div>

        {/* XP bar (label at x=20, bar from x=90) at y=142 */}
        <div
          style={{
            position: "absolute",
            left: p(20),
            top: p(142),
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
            top: p(145),
            width: p(150),
            height: p(10),
            background: COLORS.BAR_BG,
            border: `${p(1)}px solid ${COLORS.BAR_BG}`,
            borderRadius: p(1),
            overflow: "hidden",
            zIndex: 1,
          }}
        >
          <div style={{ height: "100%", width: "0%", background: COLORS.XP }} />
        </div>

        {/* Stat rows: Énergie, Maturité, Amour (y: 164, 182, 200) */}
        {["Énergie", "Maturité", "Amour"].map((stat, i) => (
          <div
            key={stat}
            style={{
              position: "absolute",
              left: 0,
              top: p(164 + i * 18),
              width: "100%",
              height: p(18),
              background: i % 2 === 1 ? COLORS.BG_ALT_DARK : COLORS.BG_ALT,
              borderBottom: `${p(1)}px solid ${COLORS.BORDER}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingLeft: p(10),
              paddingRight: p(10),
              fontSize: p(11),
              fontWeight: "bold",
              color: COLORS.TEXT_DARK,
              zIndex: 1,
            }}
          >
            <span>{stat}</span>
            <span>0</span>
          </div>
        ))}

        {/* Action buttons at y=236 */}
        {/* "Monter" button (90x24 at x=20) */}
        <button
          style={{
            position: "absolute",
            left: p(20),
            top: p(236),
            width: p(90),
            height: p(24),
            background: COLORS.HEADER_BG,
            border: `${p(1)}px solid ${COLORS.BORDER}`,
            borderRadius: p(2),
            cursor: "pointer",
            fontSize: p(10),
            fontWeight: "bold",
            color: COLORS.TEXT_WHITE,
            fontFamily: "Verdana, sans-serif",
            zIndex: 1,
          }}
        >
          Monter
        </button>

        {/* "Libérer" button (90x24 at x=140, with 12px gap) */}
        <button
          style={{
            position: "absolute",
            left: p(140),
            top: p(236),
            width: p(90),
            height: p(24),
            background: COLORS.HEADER_BG,
            border: `${p(1)}px solid ${COLORS.BORDER}`,
            borderRadius: p(2),
            cursor: "pointer",
            fontSize: p(10),
            fontWeight: "bold",
            color: COLORS.TEXT_WHITE,
            fontFamily: "Verdana, sans-serif",
            zIndex: 1,
          }}
        >
          Libérer
        </button>
      </div>
    </Panel>
  );
}
