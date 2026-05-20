/**
 * Dev overlay for driving the in-game stress test (random bots walking
 * to random cells via pathfinding). Calls the window globals exposed
 * by `BattlefieldScene` (`spawnTestPlayers`, `despawnTestPlayers`,
 * `__getTestPlayerCount`).
 *
 * Mount inside the battlefield React tree (see `MapRenderer.tsx`).
 * The panel hides itself if the globals aren't installed yet (e.g.
 * before the battlefield finishes initializing).
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface WindowStressGlobals {
  spawnTestPlayers?: (n: number) => Promise<number[]>;
  despawnTestPlayers?: () => number;
  __getTestPlayerCount?: () => number;
}

const DEFAULT_SPAWN = 50;

export function StressTestPanel() {
  const [count, setCount] = useState(DEFAULT_SPAWN);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [available, setAvailable] = useState(false);
  const [fps, setFps] = useState(0);
  const lastFpsRead = useRef(0);

  // Poll for globals + live counters at 4 Hz (cheap, dev-only).
  useEffect(() => {
    const tick = () => {
      const w = window as unknown as WindowStressGlobals;
      const ok = typeof w.spawnTestPlayers === "function";
      setAvailable(ok);
      if (ok) {
        try {
          setActive(w.__getTestPlayerCount?.() ?? 0);
        } catch {
          /* */
        }
      }
      // Read the FPS overlay's text node — engine.ts:213 wires the
      // overlay as `position:fixed top:0 left:0` plain text. Falls back
      // to 0 if the node hasn't been mounted yet.
      const now = performance.now();
      if (now - lastFpsRead.current > 240) {
        lastFpsRead.current = now;
        const overlay = document.querySelector<HTMLDivElement>(
          "div[style*='font: bold 14px monospace']",
        );
        if (overlay) {
          const m = overlay.textContent?.match(/(\d+(?:\.\d+)?)\s*fps/i);
          if (m) setFps(Number.parseFloat(m[1] ?? "0"));
        }
      }
    };
    tick();
    const h = setInterval(tick, 250);
    return () => clearInterval(h);
  }, []);

  const handleSpawn = useCallback(async () => {
    const w = window as unknown as WindowStressGlobals;
    if (!w.spawnTestPlayers) return;
    setBusy(true);
    try {
      await w.spawnTestPlayers(count);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[StressTestPanel] spawn failed:", e);
    } finally {
      setBusy(false);
    }
  }, [count]);

  const handleDespawn = useCallback(() => {
    const w = window as unknown as WindowStressGlobals;
    if (!w.despawnTestPlayers) return;
    try {
      w.despawnTestPlayers();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[StressTestPanel] despawn failed:", e);
    }
  }, []);

  if (!available) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        zIndex: 999998,
        background: "rgba(0,0,0,0.78)",
        color: "#0f0",
        font: "12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace",
        border: "1px solid rgba(0,255,0,0.35)",
        borderRadius: 4,
        padding: collapsed ? "4px 8px" : "8px 10px",
        minWidth: collapsed ? undefined : 200,
        userSelect: "none",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: "pointer",
          marginBottom: collapsed ? 0 : 6,
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span style={{ fontWeight: "bold" }}>STRESS</span>
        <span style={{ color: "#ccc" }}>
          {active} bots · {fps.toFixed(0)} fps
        </span>
        <span style={{ color: "#888" }}>{collapsed ? "▸" : "▾"}</span>
      </div>
      {!collapsed && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <label htmlFor="stress-count" style={{ color: "#ccc" }}>
              N=
            </label>
            <input
              id="stress-count"
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) =>
                setCount(
                  Math.max(
                    1,
                    Math.min(500, Number.parseInt(e.target.value, 10) || 1),
                  ),
                )
              }
              style={{
                width: 60,
                background: "#111",
                color: "#0f0",
                border: "1px solid #333",
                borderRadius: 3,
                padding: "2px 4px",
                font: "inherit",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={handleSpawn}
              disabled={busy}
              style={{
                background: busy ? "#222" : "#040",
                color: "#0f0",
                border: "1px solid #060",
                borderRadius: 3,
                padding: "3px 8px",
                font: "inherit",
                cursor: busy ? "wait" : "pointer",
                flex: 1,
              }}
            >
              {busy ? "spawning…" : "Spawn"}
            </button>
            <button
              type="button"
              onClick={handleDespawn}
              disabled={active === 0}
              style={{
                background: active === 0 ? "#222" : "#400",
                color: active === 0 ? "#666" : "#f88",
                border: "1px solid #600",
                borderRadius: 3,
                padding: "3px 8px",
                font: "inherit",
                cursor: active === 0 ? "default" : "pointer",
                flex: 1,
              }}
            >
              Despawn
            </button>
          </div>
        </>
      )}
    </div>
  );
}
