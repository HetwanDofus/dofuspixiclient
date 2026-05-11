/**
 * Standalone Pixi+Vello stress test page. Hash-routed at `#stress`
 * from `main.tsx`.
 *
 * Architecture:
 *   - Main thread: this React component + HUD only.
 *   - 1 render worker: owns its OffscreenCanvas + Vello renderer +
 *     Pixi Application + the entire player population. The
 *     persistent-instance per-frame model: each player has a stable
 *     GPU texture that gets mutated in place by `tickSwfCharacterFrame`
 *     calls; the sprite's Pixi Texture is allocated ONCE and
 *     auto-resamples the GPU memory.
 *
 * Multi-worker was tried and removed: WebGPU on a single physical
 * GPU contends at the hardware queue (each worker gets its own
 * `GPUDevice` but they all serialize on the GPU). Empirically 4
 * workers gave 17fps where 1 worker gave 60fps for the same
 * workload — pure overhead. The win for multi-worker is CPU-bound
 * workloads, not GPU-compute-bound.
 */

import { useEffect, useRef, useState } from "react";

import type {
  WorkerInMessage,
  WorkerOutMessage,
  WorkerStatsPayload,
} from "./stress-worker";

interface StressStats extends WorkerStatsPayload {}

const INITIAL_STATS: StressStats = {
  spawned: 0,
  active: 0,
  fps: 0,
  frameMsP50: 0,
  frameMsP95: 0,
  frameMsP99: 0,
  phase: "init",
  tilesGround: 0,
  tilesLayer1: 0,
  tilesLayer2: 0,
  accAttempted: 0,
  accResolved: 0,
  accMissing: 0,
  note: "",
  rendersPerSec: 0,
  queueDepth: 0,
  playerAnimFps: 0,
  walkingPlayers: 0,
};

function readTargetFromUrl(): number {
  const params = new URLSearchParams(window.location.search);
  const raw = parseInt(params.get("n") ?? "400", 10);
  if (!Number.isFinite(raw) || raw <= 0) return 400;
  return Math.min(raw, 5000);
}

function navigateToTarget(n: number): void {
  window.location.href = `${window.location.pathname}?n=${n}#stress`;
}

export function StressPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const target = readTargetFromUrl();
  const [stats, setStats] = useState<StressStats>(INITIAL_STATS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let worker: Worker | null = null;
    let offscreen: OffscreenCanvas | null = null;
    let destroyed = false;

    try {
      offscreen = canvas.transferControlToOffscreen();
    } catch (e) {
      setError(`OffscreenCanvas unavailable: ${e}`);
      return;
    }

    worker = new Worker(new URL("./stress-worker.ts", import.meta.url), {
      type: "module",
      name: "stress-worker",
    });

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (destroyed) return;
      if (msg.type === "stats") {
        setStats((s) => ({ ...s, ...msg.payload }));
      } else if (msg.type === "error") {
        setError(msg.message);
        console.error("[stress] worker error:", msg.message);
      }
    };

    worker.onerror = (ev) => {
      console.error("[stress] worker onerror:", ev);
      setError(ev.message || "worker error");
    };

    const initMsg: WorkerInMessage = {
      type: "init",
      canvas: offscreen,
      target,
      width: canvas.width,
      height: canvas.height,
      // Single-worker config: we own the entire player population
      // and paint the map tiles. The multi-worker fields stay on
      // the message type for future use but are pinned to (0, 1)
      // here so the worker's player-sharding logic is a no-op.
      workerIndex: 0,
      totalWorkers: 1,
      renderTiles: true,
    };
    worker.postMessage(initMsg, [offscreen]);

    const onResize = () => {
      if (!worker) return;
      const resizeMsg: WorkerInMessage = {
        type: "resize",
        width: window.innerWidth,
        height: window.innerHeight,
      };
      worker.postMessage(resizeMsg);
    };
    window.addEventListener("resize", onResize);

    return () => {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      if (worker) {
        const shutdownMsg: WorkerInMessage = { type: "shutdown" };
        worker.postMessage(shutdownMsg);
        setTimeout(() => worker?.terminate(), 50);
      }
    };
  }, [target]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#1f2233",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          background: "#1f2233",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "8px 12px",
          background: "rgba(0,0,0,0.75)",
          color: "#0f0",
          font: "bold 13px ui-monospace, monospace",
          borderRadius: 4,
          pointerEvents: "auto",
          minWidth: 240,
          zIndex: 10,
        }}
      >
        <div>STRESS — n={target} [{stats.phase}]</div>
        <div>spawned: {stats.spawned} / active: {stats.active}</div>
        <div>fps: {stats.fps.toFixed(1)}</div>
        <div>p50: {stats.frameMsP50.toFixed(2)}ms</div>
        <div>p95: {stats.frameMsP95.toFixed(2)}ms</div>
        <div>p99: {stats.frameMsP99.toFixed(2)}ms</div>
        <div style={{ marginTop: 6, color: "#fc6" }}>
          renders/sec: {stats.rendersPerSec} | queue avg: {stats.queueDepth.toFixed(1)}
        </div>
        <div style={{ color: "#fc6" }}>
          anim: {stats.playerAnimFps.toFixed(1)}fps × {stats.walkingPlayers} walking
        </div>
        <div style={{ marginTop: 4, color: "#9cf" }}>
          map: ground={stats.tilesGround} l1={stats.tilesLayer1} l2={stats.tilesLayer2}
        </div>
        <div style={{ color: "#9cf" }}>
          acc: {stats.accResolved}/{stats.accAttempted} resolved
          {stats.accMissing > 0 ? ` (${stats.accMissing} missing)` : ""}
        </div>
        {stats.note && <div style={{ color: "#fc6" }}>note: {stats.note}</div>}
        <div style={{ marginTop: 8 }}>
          {[50, 100, 200, 400, 500, 800, 1500].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => navigateToTarget(n)}
              style={{
                marginRight: 4,
                padding: "2px 8px",
                background: target === n ? "#0f0" : "#222",
                color: target === n ? "#000" : "#0f0",
                border: "1px solid #0f0",
                cursor: "pointer",
                font: "11px monospace",
              }}
            >
              {n}
            </button>
          ))}
        </div>
        {error && (
          <div style={{ color: "#f66", marginTop: 8 }}>error: {error}</div>
        )}
      </div>
    </div>
  );
}
