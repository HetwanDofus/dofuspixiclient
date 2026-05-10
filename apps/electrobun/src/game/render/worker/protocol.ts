/**
 * Battlefield worker ⇄ main thread message protocol.
 *
 * Mirrors stress-worker's message contract but generalized to accept
 * real gameserver-driven player + tile + fight state instead of the
 * stress test's spawn-N-random-players loop.
 *
 * One direction at a time: messages either flow main → worker
 * (orchestration) OR worker → main (events / picking results / stats).
 */

export type DirSuffix = "R" | "L" | "F" | "B" | "S";

export interface WorkerInitPayload {
  /**
   * OffscreenCanvas transferred from the main-thread <canvas>. Becomes
   * the sole render target — Pixi Application's render output blits to
   * this canvas. The browser composites it into the page.
   */
  canvas: OffscreenCanvas;
  /** Rendered map data (already decoded from `GameMapData` proto on main thread). */
  mapData?: unknown;
  /** Initial logical viewport (typ 742×432). */
  width: number;
  height: number;
  /** Three independent dials per `feedback_battlefield_render_architecture`. */
  dials: {
    renderResolution: number;
    stageZoom: number;
    playerAnimFps: number;
  };
}

export interface WorkerSpawnPlayerPayload {
  id: number;
  cellId: number;
  direction: number;
  look: string;
  team?: number;
  isCurrentPlayer?: boolean;
}

export interface WorkerSetPlayerAnimPayload {
  id: number;
  /** Base animation name without direction suffix (`walk`, `run`, etc.). */
  baseAnim: string;
  direction: number;
}

export interface WorkerSetPlayerCellPayload {
  id: number;
  cellId: number;
  path?: number[];
}

export interface WorkerPickPayload {
  /** Pointer-event coordinates in canvas-local pixels. */
  x: number;
  y: number;
  /** Echoed back with the result so the caller can correlate. */
  requestId: number;
}

export type WorkerInMessage =
  | { type: "init"; payload: WorkerInitPayload }
  | { type: "loadMap"; mapData: unknown }
  | { type: "spawnPlayer"; payload: WorkerSpawnPlayerPayload }
  | { type: "despawnPlayer"; id: number }
  | { type: "setPlayerAnim"; payload: WorkerSetPlayerAnimPayload }
  | { type: "setPlayerCell"; payload: WorkerSetPlayerCellPayload }
  | { type: "setPlayerLook"; id: number; look: string }
  | { type: "enterFightMode"; mode: string }
  | { type: "exitFightMode" }
  | { type: "castSpell"; payload: unknown }
  | { type: "addCellHighlight"; payload: unknown }
  | { type: "clearCellHighlights" }
  | { type: "pick"; payload: WorkerPickPayload }
  | { type: "resize"; width: number; height: number }
  | { type: "setZoom"; zoom: number }
  | { type: "setTacticalMode"; enabled: boolean }
  | { type: "shutdown" };

export interface WorkerPickResultPayload {
  requestId: number;
  /** null when no hit; otherwise the picked cell id. */
  cellId: number | null;
  /** Optional player id when the hit landed on a sprite (priority). */
  playerId?: number | null;
}

export interface WorkerStatsPayload {
  fps: number;
  players: number;
  tiles: number;
  liveTextures: number;
  /** Whatever the watchdog reports — opaque to main thread. */
  watchdog?: unknown;
}

export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "pickResult"; payload: WorkerPickResultPayload }
  | {
      type: "animationDone";
      payload: { id: number; animName: string };
    }
  | { type: "cellClick"; cellId: number }
  | { type: "cellHover"; cellId: number | null }
  | { type: "stats"; payload: Partial<WorkerStatsPayload> }
  | { type: "error"; message: string };
