import { useState } from "react";

import { Panel } from "../components/Panel";

interface SpellsPanelProps {
  onClose: () => void;
  zoom?: number;
}

/**
 * Spells panel: 250x390
 * Filter buttons + spell list + boost points footer
 */
export function SpellsPanel({ onClose, zoom = 1 }: SpellsPanelProps) {
  const [activeFilter, setActiveFilter] = useState(0);

  const p = (n: number) => Math.round(n * zoom);

  const filterColors = [
    "#888888",
    "#996633",
    "#3399ff",
    "#ff6633",
    "#669933",
    "#cccccc",
    "#ffcc00",
  ];

  const contentHeight = 390 - 22; // excluding title bar
  const colHeaderY = p(6 + 14 + 14 + 4); // label(6) + filters(18+4) + section header(14) + spacing(4)
  const listY = colHeaderY + p(14);
  const rowH = p(18);
  const footerY = contentHeight - p(16);

  return (
    <Panel title="Sorts" width={250} height={390} onClose={onClose} zoom={zoom}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          fontSize: p(11),
        }}
      >
        {/* Filter type label */}
        <div
          style={{
            position: "absolute",
            left: p(6),
            top: p(6),
            fontSize: p(10),
            fontWeight: "bold",
            color: "var(--dofus-text-dark, #514a3c)",
          }}
        >
          Type
        </div>

        {/* Filter buttons row */}
        <div
          style={{
            position: "absolute",
            left: p(6),
            top: p(20),
            display: "flex",
            flexWrap: "wrap",
            gap: p(4),
            width: p(240),
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6].map((idx) => (
            <button
              type="button"
              key={`filter-${idx}`}
              onClick={() => setActiveFilter(idx)}
              style={{
                width: p(18),
                height: p(18),
                borderRadius: p(2),
                border: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
                background:
                  idx === activeFilter
                    ? filterColors[idx]
                    : "var(--dofus-bar-bg, #514a3c)",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>

        {/* Spell list section header */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: p(44),
            width: "100%",
            height: p(14),
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(3)}px ${p(8)}px`,
            fontSize: p(10),
            fontWeight: "bold",
            boxSizing: "border-box",
          }}
        >
          Liste des sorts
        </div>

        {/* Column headers */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: colHeaderY,
            width: "100%",
            height: p(14),
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(2)}px ${p(6)}px`,
            fontSize: p(10),
            fontWeight: "bold",
            boxSizing: "border-box",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Nom</span>
          <span>Niveau</span>
        </div>

        {/* Spell list rows */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: listY,
            width: "100%",
            height: footerY - listY,
            overflow: "auto",
          }}
        >
          {[...Array(12)].map((_, i) => (
            <div
              key={`spell-${i}`}
              style={{
                position: "relative",
                height: rowH,
                padding: `${p(2)}px ${p(6)}px`,
                borderBottom: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
                background:
                  i % 2 === 1
                    ? "var(--dofus-bg-alt, #c9bda5)"
                    : "var(--dofus-bg, #d5cfaa)",
                fontSize: p(10),
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <img
                src="/themes/classic/assets/panels/spells/spell-slot-background.svg"
                alt="spell"
                style={{ width: p(20), height: p(20) }}
              />
              <div />
            </div>
          ))}
        </div>

        {/* Footer: boost points */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: footerY,
            width: "100%",
            height: contentHeight - footerY,
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(4)}px`,
            textAlign: "center",
            fontSize: p(11),
            fontWeight: "bold",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Points de boost : 0
        </div>
      </div>
    </Panel>
  );
}
