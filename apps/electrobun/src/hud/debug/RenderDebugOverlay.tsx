/**
 * RenderDebugOverlay — live render-pipeline diagnostics + emergency stop.
 *
 * Toggled with `Ctrl+Shift+D` (also exposed as `window.__toggleRenderHUD()`).
 * Subscribes to the `RenderWatchdog` singleton via `useSyncExternalStore`,
 * so the panel re-renders at most ~10Hz (the watchdog rate-limits its own
 * notifications).
 *
 * Visual cues:
 *   - Frame-time histogram strip (last 120 frames, color-coded green
 *     <16ms / yellow <33ms / orange <100ms / red ≥100ms — so a sustained
 *     red pattern is the canonical "GPU is choking" signature visible at
 *     a glance).
 *   - Red border + "EMERGENCY HALTED" banner when `emergencyHalt` is true.
 *   - Per-line warnings list pulled from the snapshot's `.warnings` field.
 *
 * Actions:
 *   - HALT (red): immediate `emergencyHalt()` — pulls every brake.
 *   - RESUME (green): clears halt; visible only when halted.
 *   - SPAWN N: passes through to `window.spawnTestPlayers(N)` so the
 *     dev can stress-test from the same panel where they observe the
 *     consequences. Default N respects the soft warning threshold.
 *   - DESPAWN: drains the test players.
 *
 * Why React: per the project memory note `feedback_react_only`, all UI
 * lives in React/DOM. This panel renders *outside* the canvas (high
 * z-index, fixed-positioned) so it never competes with the Pixi tree.
 */

import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getRenderWatchdog,
  type RenderSnapshot,
} from "@/game/render/render-watchdog";

const STORAGE_KEY = "dofus.debug.renderHud.visible";
const HISTOGRAM_BARS = 120;
const HISTOGRAM_HEIGHT_PX = 40;

/**
 * Color thresholds for the frame-time histogram. Picked to match common
 * perf bands: <16.7ms = 60fps, <33.4ms = 30fps, <100ms = >stalled,
 * ≥100ms = consecutive frames here trigger the watchdog's auto-halt.
 */
function frameMsColor(ms: number): string {
  if (ms < 16.7) {
    return "#22c55e"; // green-500
  }
  if (ms < 33.4) {
    return "#eab308"; // yellow-500
  }
  if (ms < 100) {
    return "#f97316"; // orange-500
  }
  return "#ef4444"; // red-500
}

function loadInitialVisibility(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistVisibility(visible: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, visible ? "1" : "0");
  } catch {
    // localStorage unavailable — in-memory state still works.
  }
}

function formatBytes(b: number | null): string {
  if (b === null) {
    return "—";
  }
  if (b < 1024) {
    return `${b} B`;
  }
  if (b < 1024 * 1024) {
    return `${(b / 1024).toFixed(1)} KB`;
  }
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface TestPlayerWindow {
  spawnTestPlayers?: (n: number) => Promise<number[]>;
  despawnTestPlayers?: () => number;
}

export function RenderDebugOverlay(): React.JSX.Element | null {
  const [visible, setVisible] = useState<boolean>(loadInitialVisibility);
  const [spawnN, setSpawnN] = useState<number>(20);

  const watchdog = useMemo(() => getRenderWatchdog(), []);
  const snapshot = useSyncExternalStore(
    watchdog.subscribe,
    watchdog.getSnapshot,
    watchdog.getSnapshot
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+D — chord avoids colliding with the existing 'd'
      // DEBUG_TOGGLE in keybindings.ts which is single-key.
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setVisible((v) => {
          persistVisibility(!v);
          return !v;
        });
      }
    };
    window.addEventListener("keydown", handler);
    // Window-level toggle helper for console use without remembering
    // the chord. Mirrors the existing __renderHalt / __renderResume
    // globals — they all live in the `__render*` namespace.
    (
      window as unknown as { __toggleRenderHUD?: () => void }
    ).__toggleRenderHUD = () =>
      setVisible((v) => {
        persistVisibility(!v);
        return !v;
      });
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const halt = useCallback(() => watchdog.emergencyHalt(), [watchdog]);
  const resume = useCallback(() => watchdog.resume(), [watchdog]);

  const spawn = useCallback(async () => {
    const w = window as unknown as TestPlayerWindow;
    if (!w.spawnTestPlayers) {
      console.warn(
        "[RenderDebugOverlay] spawnTestPlayers not available — load a map first"
      );
      return;
    }
    await w.spawnTestPlayers(spawnN);
  }, [spawnN]);

  const despawn = useCallback(() => {
    const w = window as unknown as TestPlayerWindow;
    if (!w.despawnTestPlayers) {
      return;
    }
    w.despawnTestPlayers();
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <section
      style={overlayStyle(snapshot.emergencyHalt)}
      aria-label="Render diagnostics"
    >
      <Header
        onClose={() => {
          setVisible(false);
          persistVisibility(false);
        }}
      />

      {snapshot.emergencyHalt && (
        <div style={haltBanner}>
          🛑 EMERGENCY HALTED — render submissions paused. Press RESUME below
          when safe.
        </div>
      )}

      {snapshot.deviceLost && (
        <div style={deviceLostBanner}>
          GPU device lost: {snapshot.deviceLost.reason} —{" "}
          {snapshot.deviceLost.message}
        </div>
      )}

      <Histogram samples={snapshot.histogramMs} />

      <Section title="Frame">
        <Stat
          label="FPS now"
          value={snapshot.fpsInstant.toFixed(0)}
          warn={snapshot.fpsInstant < 30}
          crit={snapshot.fpsInstant < 10}
        />
        <Stat
          label="FPS 1s avg"
          value={snapshot.fpsAvg1s.toFixed(0)}
          warn={snapshot.fpsAvg1s < 30}
          crit={snapshot.fpsAvg1s < 10}
        />
        <Stat
          label="FPS min 10s"
          value={snapshot.fpsMin10s.toFixed(1)}
          warn={snapshot.fpsMin10s < 10}
        />
        <Stat
          label="ms last"
          value={snapshot.frameMsLast.toFixed(1)}
          warn={snapshot.frameMsLast >= 33}
          crit={snapshot.frameMsLast >= 100}
        />
        <Stat
          label="ms p99"
          value={snapshot.frameMsP99.toFixed(1)}
          warn={snapshot.frameMsP99 >= 33}
          crit={snapshot.frameMsP99 >= 100}
        />
        <Stat
          label="ms longest 10s"
          value={snapshot.frameMsLongest10s.toFixed(0)}
          warn={snapshot.frameMsLongest10s >= 100}
          crit={snapshot.frameMsLongest10s >= 500}
        />
        <Stat
          label="slow/1s"
          value={snapshot.slowFrames1s.toString()}
          warn={snapshot.slowFrames1s >= 30}
        />
        <Stat
          label="stall/10s"
          value={snapshot.stalledFrames10s.toString()}
          warn={snapshot.stalledFrames10s >= 5}
        />
      </Section>

      <Section title="GPU textures">
        <Stat
          label="active"
          value={snapshot.textureCountActive.toString()}
          warn={snapshot.textureCountActive >= 256}
          crit={snapshot.textureCountActive >= 1024}
        />
        <Stat
          label="created total"
          value={snapshot.texturesCreatedTotal.toString()}
        />
        <Stat
          label="freed total"
          value={snapshot.texturesFreedTotal.toString()}
        />
        <Stat
          label="leaked?"
          value={(
            snapshot.texturesCreatedTotal - snapshot.texturesFreedTotal
          ).toString()}
          warn={
            snapshot.texturesCreatedTotal - snapshot.texturesFreedTotal > 200
          }
        />
      </Section>

      {snapshot.tileDispatch && (
        <Section title="Tile pass">
          <Stat
            label="last ms"
            value={snapshot.tileDispatch.lastMs.toFixed(2)}
            warn={snapshot.tileDispatch.lastMs >= 8}
          />
          <Stat
            label="avg ms"
            value={snapshot.tileDispatch.avgMs.toFixed(2)}
            warn={snapshot.tileDispatch.avgMs >= 8}
          />
          <Stat
            label="disp/sec"
            value={snapshot.tileDispatch.dispatchesPerSec.toFixed(1)}
          />
        </Section>
      )}

      {snapshot.frameAtlas && (
        <Section title="Char atlas">
          <Stat
            label="slots"
            value={`${snapshot.frameAtlas.slots}/${snapshot.frameAtlas.maxSlots}`}
            warn={
              snapshot.frameAtlas.slots / snapshot.frameAtlas.maxSlots > 0.85
            }
          />
          <Stat
            label="renders/tick"
            value={snapshot.frameAtlas.lastRenders.toString()}
            warn={snapshot.frameAtlas.lastRenders >= 32}
          />
          <Stat
            label="queue ms"
            value={snapshot.frameAtlas.lastQueueMs.toFixed(1)}
            warn={snapshot.frameAtlas.lastQueueMs >= 8}
          />
          <Stat
            label="flush ms"
            value={snapshot.frameAtlas.lastFlushMs.toFixed(1)}
            warn={snapshot.frameAtlas.lastFlushMs >= 8}
          />
          <Stat label="hits" value={snapshot.frameAtlas.lastHits.toString()} />
        </Section>
      )}

      <Section title="Atlas cache">
        <Stat label="memory" value={formatBytes(snapshot.atlasCacheBytes)} />
        <Stat
          label="entries"
          value={snapshot.atlasCacheEntries?.toString() ?? "—"}
        />
      </Section>

      {snapshot.swfLoad && (
        <Section title="SWF loads">
          <Stat
            label="active"
            value={snapshot.swfLoad.active.toString()}
            warn={snapshot.swfLoad.active >= 4}
          />
          <Stat
            label="queued"
            value={snapshot.swfLoad.queued.toString()}
            warn={snapshot.swfLoad.queued >= 20}
            crit={snapshot.swfLoad.queued >= 100}
          />
          <Stat label="loaded" value={snapshot.swfLoad.loaded.toString()} />
        </Section>
      )}

      <Section title="JS heap">
        <Stat
          label="used"
          value={
            snapshot.jsHeapUsedMB !== null
              ? `${snapshot.jsHeapUsedMB.toFixed(0)} MB`
              : "—"
          }
          warn={
            snapshot.jsHeapUsedMB !== null &&
            snapshot.jsHeapLimitMB !== null &&
            snapshot.jsHeapUsedMB / snapshot.jsHeapLimitMB > 0.7
          }
          crit={
            snapshot.jsHeapUsedMB !== null &&
            snapshot.jsHeapLimitMB !== null &&
            snapshot.jsHeapUsedMB / snapshot.jsHeapLimitMB > 0.85
          }
        />
        <Stat
          label="limit"
          value={
            snapshot.jsHeapLimitMB !== null
              ? `${snapshot.jsHeapLimitMB.toFixed(0)} MB`
              : "—"
          }
        />
      </Section>

      <Section title="Stress test">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
          }}
        >
          <span>active: {snapshot.testPlayerCount}</span>
          <input
            type="number"
            min={1}
            max={200}
            value={spawnN}
            onChange={(e) =>
              setSpawnN(Math.max(1, Math.min(200, Number(e.target.value) || 1)))
            }
            style={{ width: 50, fontSize: 11, padding: "2px 4px" }}
          />
          <button type="button" onClick={spawn} style={btn("#3b82f6")}>
            spawn
          </button>
          <button type="button" onClick={despawn} style={btn("#6b7280")}>
            despawn
          </button>
        </div>
      </Section>

      {snapshot.warnings.length > 0 && (
        <Section title="Warnings">
          {snapshot.warnings.map((w) => (
            <div key={w} style={warnLine}>
              ⚠ {w}
            </div>
          ))}
        </Section>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {snapshot.emergencyHalt ? (
          <button type="button" onClick={resume} style={btn("#22c55e")}>
            ▶ RESUME
          </button>
        ) : (
          <button type="button" onClick={halt} style={btn("#ef4444")}>
            ⏸ EMERGENCY HALT
          </button>
        )}
        <SafeModeToggle />
      </div>

      <div style={hint}>
        Ctrl+Shift+D to toggle • <code>__renderHalt()</code> /{" "}
        <code>__renderResume()</code> in console
      </div>
    </section>
  );
}

/**
 * Toggle the boot-time safe-mode localStorage flag. When enabled, the
 * watchdog starts halted on next launch — every Vello render entry
 * point returns null, so the app boots without enqueueing GPU work
 * (escape hatch for the macOS WindowServer kill loop).
 */
function SafeModeToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("dofus.gpuSafeMode") === "1";
    } catch {
      return false;
    }
  });
  const toggle = useCallback(() => {
    try {
      if (enabled) {
        globalThis.localStorage?.removeItem("dofus.gpuSafeMode");
        setEnabled(false);
      } else {
        globalThis.localStorage?.setItem("dofus.gpuSafeMode", "1");
        setEnabled(true);
      }
    } catch {
      // ignore
    }
  }, [enabled]);
  return (
    <button
      type="button"
      onClick={toggle}
      style={btn(enabled ? "#a16207" : "#374151")}
      title="When ON: next reload boots with GPU rendering disabled. Useful escape hatch from the macOS WindowServer kill loop."
    >
      {enabled ? "✓ SAFE-BOOT" : "SAFE-BOOT OFF"}
    </button>
  );
}

function Header({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div style={headerRow}>
      <span style={titleStyle}>RENDER DIAG</span>
      <button
        type="button"
        onClick={onClose}
        style={closeBtn}
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={section}>
      <div style={sectionTitle}>{title}</div>
      <div style={statGrid}>{children}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  crit,
}: {
  label: string;
  value: string;
  warn?: boolean;
  crit?: boolean;
}): React.JSX.Element {
  let color = "#e5e7eb";
  if (crit) {
    color = "#ef4444";
  } else if (warn) {
    color = "#eab308";
  }
  return (
    <div style={statRow}>
      <span style={statLabel}>{label}</span>
      <span style={{ ...statValue, color }}>{value}</span>
    </div>
  );
}

/**
 * Sparkline of recent frame times. Bars are absolute-positioned so we
 * don't pay for layout on every snapshot — only the heights change.
 * Empty samples (early in session) render as a flat green line.
 */
function Histogram({ samples }: { samples: number[] }): React.JSX.Element {
  // Maximum y-axis value: max sample but capped at 200ms so a single
  // 1000ms outlier doesn't flatten the rest of the chart.
  const yMax = Math.max(33, Math.min(200, Math.max(...samples, 16.7)));
  const barWidthPct = 100 / HISTOGRAM_BARS;
  return (
    <div style={histContainer} title="Frame time histogram (last 120 frames)">
      <div style={histYLabel}>{yMax.toFixed(0)}ms</div>
      <div style={histYRef}>33ms</div>
      {samples.map((ms, i) => {
        const h = Math.min(100, (ms / yMax) * 100);
        return (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            style={{
              position: "absolute",
              left: `${i * barWidthPct}%`,
              width: `${barWidthPct}%`,
              bottom: 0,
              height: `${h}%`,
              background: frameMsColor(ms),
            }}
          />
        );
      })}
      <div style={histRefLine} />
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────

const overlayStyle = (halted: boolean): React.CSSProperties => ({
  position: "fixed",
  top: 8,
  right: 8,
  width: 280,
  padding: "10px 12px",
  background: "rgba(15, 17, 23, 0.94)",
  color: "#e5e7eb",
  font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
  border: halted ? "2px solid #ef4444" : "1px solid #374151",
  borderRadius: 6,
  zIndex: 99999999,
  pointerEvents: "auto",
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
});

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 6,
};

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  letterSpacing: 0.5,
  fontSize: 11,
  color: "#9ca3af",
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  color: "#9ca3af",
  border: "none",
  fontSize: 16,
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 4px",
};

const haltBanner: React.CSSProperties = {
  background: "#7f1d1d",
  color: "#fee2e2",
  padding: "6px 8px",
  borderRadius: 4,
  marginBottom: 8,
  fontWeight: 600,
};

const deviceLostBanner: React.CSSProperties = {
  background: "#581c1c",
  color: "#fecaca",
  padding: "6px 8px",
  borderRadius: 4,
  marginBottom: 8,
};

const histContainer: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: HISTOGRAM_HEIGHT_PX,
  background: "#0a0c11",
  border: "1px solid #1f2937",
  marginBottom: 8,
  overflow: "hidden",
};

const histYLabel: React.CSSProperties = {
  position: "absolute",
  top: 2,
  left: 4,
  fontSize: 9,
  color: "#6b7280",
  zIndex: 2,
};

const histYRef: React.CSSProperties = {
  position: "absolute",
  bottom: `${(33 / 200) * 100}%`,
  left: 4,
  fontSize: 9,
  color: "#6b7280",
  zIndex: 2,
};

const histRefLine: React.CSSProperties = {
  position: "absolute",
  bottom: `${(33 / 200) * 100}%`,
  left: 0,
  right: 0,
  height: 1,
  background: "rgba(234, 179, 8, 0.25)",
  pointerEvents: "none",
};

const section: React.CSSProperties = {
  marginBottom: 6,
  paddingTop: 4,
  borderTop: "1px solid #1f2937",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.5,
  color: "#6b7280",
  textTransform: "uppercase",
  marginBottom: 2,
};

const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  rowGap: 1,
  columnGap: 8,
};

const statRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
};

const statLabel: React.CSSProperties = {
  color: "#9ca3af",
};

const statValue: React.CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
};

const warnLine: React.CSSProperties = {
  color: "#fbbf24",
  fontSize: 10,
  marginTop: 2,
};

const hint: React.CSSProperties = {
  marginTop: 8,
  fontSize: 9,
  color: "#6b7280",
};

function btn(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "#fff",
    border: "none",
    padding: "4px 8px",
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  };
}

// Re-export the watchdog snapshot type so consumers (tests etc.) can
// type their fixtures without reaching into the render module path.
export type { RenderSnapshot };
