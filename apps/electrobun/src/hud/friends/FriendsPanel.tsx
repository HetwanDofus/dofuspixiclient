import { useState } from "react";

import { Panel } from "../components/Panel";

interface FriendsPanelProps {
  onClose: () => void;
  zoom?: number;
}

/**
 * Friends panel: 280x368
 * Tab bar + online section + offline section + add friend input
 */
export function FriendsPanel({ onClose, zoom = 1 }: FriendsPanelProps) {
  const [activeTab, setActiveTab] = useState("friends");
  const [friendInput, setFriendInput] = useState("");

  const p = (n: number) => Math.round(n * zoom);

  const contentHeight = 368 - 22; // excluding title bar
  const tabBarH = p(22);
  const sectionHeaderH = p(14);
  const rowH = p(18);
  const onlineStartY = tabBarH;
  const onlineEndY = onlineStartY + p(5 * 18 + 14); // 5 rows + header
  const offlineStartY = onlineEndY;
  const offlineEndY = offlineStartY + p(5 * 18 + 14); // 5 rows + header
  const addFriendY = offlineEndY;

  return (
    <Panel title="Amis" width={280} height={368} onClose={onClose} zoom={zoom}>
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
          {["friends", "enemies", "ignored"].map((tab) => (
            <button
              type="button"
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                background:
                  activeTab === tab
                    ? "var(--dofus-header-bg, #514a3c)"
                    : "transparent",
                color:
                  activeTab === tab
                    ? "var(--dofus-text-white, #ffffff)"
                    : "var(--dofus-text-dark, #514a3c)",
                border: "none",
                padding: `${p(4)}px ${p(8)}px`,
                cursor: "pointer",
                fontSize: p(10),
                fontWeight: activeTab === tab ? "bold" : "normal",
              }}
            >
              {tab === "friends"
                ? "Amis"
                : tab === "enemies"
                  ? "Ennemis"
                  : "Ignorés"}
            </button>
          ))}
        </div>

        {/* Online section header */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: onlineStartY,
            width: "100%",
            height: sectionHeaderH,
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(3)}px ${p(8)}px`,
            fontSize: p(10),
            fontWeight: "bold",
            boxSizing: "border-box",
          }}
        >
          En ligne
        </div>

        {/* Online rows */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: onlineStartY + sectionHeaderH,
            width: "100%",
            height: onlineEndY - onlineStartY - sectionHeaderH,
            overflow: "auto",
          }}
        >
          {[...Array(5)].map((_, i) => (
            <div
              key={`online-${i}`}
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
              }}
            />
          ))}
        </div>

        {/* Offline section header */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: offlineStartY,
            width: "100%",
            height: sectionHeaderH,
            background: "var(--dofus-header-bg, #514a3c)",
            color: "var(--dofus-text-white, #ffffff)",
            padding: `${p(3)}px ${p(8)}px`,
            fontSize: p(10),
            fontWeight: "bold",
            boxSizing: "border-box",
          }}
        >
          Hors ligne
        </div>

        {/* Offline rows */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: offlineStartY + sectionHeaderH,
            width: "100%",
            height: offlineEndY - offlineStartY - sectionHeaderH,
            overflow: "auto",
          }}
        >
          {[...Array(5)].map((_, i) => (
            <div
              key={`offline-${i}`}
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
              }}
            />
          ))}
        </div>

        {/* Add friend section */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: addFriendY,
            width: "100%",
            height: contentHeight - addFriendY,
            padding: `${p(6)}px`,
            background: "var(--dofus-bg, #d5cfaa)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{ fontSize: p(10), fontWeight: "bold", marginBottom: p(8) }}
          >
            Ajouter un ami
          </div>

          <div style={{ display: "flex", gap: p(4) }}>
            <input
              type="text"
              value={friendInput}
              onChange={(e) => setFriendInput(e.target.value)}
              placeholder="Nom"
              style={{
                flex: 1,
                padding: `${p(4)}px ${p(6)}px`,
                fontSize: p(10),
                border: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
                borderRadius: p(3),
                color: "var(--dofus-text-dark, #514a3c)",
                background: "#ffffff",
                boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              style={{
                width: p(44),
                height: p(20),
                padding: `${p(4)}px ${p(12)}px`,
                background: "var(--dofus-header-bg, #514a3c)",
                border: `${p(1)}px solid var(--dofus-bar-border, #514a3c)`,
                borderRadius: p(3),
                cursor: "pointer",
                fontSize: p(9),
                color: "var(--dofus-text-white, #ffffff)",
                fontWeight: "bold",
                boxSizing: "border-box",
              }}
            >
              Ajouter
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
