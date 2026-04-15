import { useState } from "react";

import { Panel } from "../components/Panel";

interface QuestsPanelProps {
  onClose: () => void;
  zoom?: number;
}

/**
 * Quests panel: 280x312
 * Tab bar + quest list + finished quests toggle + count footer
 */
export function QuestsPanel({ onClose, zoom = 1 }: QuestsPanelProps) {
  const [activeTab, setActiveTab] = useState("current");
  const [showFinished, setShowFinished] = useState(false);

  const p = (n: number) => Math.round(n * zoom);

  const contentHeight = 312 - 22; // excluding title bar
  const tabBarH = p(22);
  const colHeaderH = p(14);
  const colHeaderY = tabBarH;
  const rowH = p(18);
  const toggleH = p(22);
  const listStartY = colHeaderY + colHeaderH;
  const toggleY = contentHeight - toggleH - p(16);
  const footerY = toggleY + toggleH;

  return (
    <Panel
      title="Quêtes"
      width={280}
      height={312}
      onClose={onClose}
      zoom={zoom}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          fontSize: p(11),
        }}
      >
        {/* Tab bar */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: tabBarH,
            display: "flex",
            borderBottom: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("current")}
            style={{
              flex: 1,
              background:
                activeTab === "current"
                  ? "var(--dofus-header-bg, #514a3c)"
                  : "transparent",
              color:
                activeTab === "current"
                  ? "var(--dofus-text-white, #ffffff)"
                  : "var(--dofus-text-dark, #514a3c)",
              border: "none",
              padding: `${p(4)}px ${p(8)}px`,
              cursor: "pointer",
              fontSize: p(10),
              fontWeight: activeTab === "current" ? "bold" : "normal",
            }}
          >
            Étape en cours
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            style={{
              flex: 1,
              background:
                activeTab === "all"
                  ? "var(--dofus-header-bg, #514a3c)"
                  : "transparent",
              color:
                activeTab === "all"
                  ? "var(--dofus-text-white, #ffffff)"
                  : "var(--dofus-text-dark, #514a3c)",
              border: "none",
              padding: `${p(4)}px ${p(8)}px`,
              cursor: "pointer",
              fontSize: p(10),
              fontWeight: activeTab === "all" ? "bold" : "normal",
            }}
          >
            Liste des étapes
          </button>
        </div>

        {/* Column headers */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: colHeaderY,
            width: "100%",
            height: colHeaderH,
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(2)}px ${p(6)}px`,
            fontSize: p(10),
            fontWeight: "bold",
            boxSizing: "border-box",
            display: "flex",
          }}
        >
          <span style={{ width: p(40) }}>Statut</span>
          <span style={{ flex: 1 }}>Nom</span>
        </div>

        {/* Quest list rows */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: listStartY,
            width: "100%",
            height: toggleY - listStartY,
            overflow: "auto",
          }}
        >
          {[...Array(10)].map((_, i) => (
            <div
              key={`quest-${i}`}
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
              }}
            >
              <div style={{ width: p(40) }} />
              <div style={{ flex: 1 }} />
            </div>
          ))}
        </div>

        {/* Finished quests toggle */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: toggleY,
            width: "100%",
            height: toggleH,
            display: "flex",
            alignItems: "center",
            padding: `${p(4)}px ${p(6)}px`,
            background: "var(--dofus-bg-alt, #c9bda5)",
            borderBottom: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
            boxSizing: "border-box",
          }}
        >
          <input
            type="checkbox"
            checked={showFinished}
            onChange={() => setShowFinished(!showFinished)}
            style={{
              marginRight: p(6),
              cursor: "pointer",
              width: p(12),
              height: p(12),
            }}
          />
          <span style={{ cursor: "pointer", fontSize: p(10) }}>
            Quêtes terminées
          </span>
        </div>

        {/* Quest count footer */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: footerY,
            width: "100%",
            height: contentHeight - footerY,
            display: "flex",
            justifyContent: "space-between",
            padding: `${p(4)}px ${p(6)}px`,
            fontSize: p(10),
            background: "var(--dofus-bg, #d5cfaa)",
            boxSizing: "border-box",
          }}
        >
          <span />
          <span>Quêtes : 0</span>
        </div>
      </div>
    </Panel>
  );
}
