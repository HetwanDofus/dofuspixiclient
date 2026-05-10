/**
 * BattlefieldClient — main-thread thin RPC wrapper around the
 * battlefield render worker.
 *
 * **Status: scaffolding.** Mirrors the eventual public surface of
 * `Battlefield` (the existing main-thread class in `apps/electrobun/
 * src/game/scene/battlefield-scene.ts`) so MapRenderer can swap one
 * for the other once the worker has feature parity. Every
 * Battlefield method becomes a `worker.postMessage(...)`; events
 * flowing the other way (cell-click, cell-hover, picking results,
 * animation-done) drive callback subscriptions.
 *
 * Not yet wired into MapRenderer — the worker side
 * (`battlefield-worker.ts`) is also scaffolding. Wire both
 * together once the worker reaches parity.
 */
import type {
  WorkerInMessage,
  WorkerOutMessage,
  WorkerPickResultPayload,
} from "@/game/render/worker/protocol";

export interface BattlefieldClientConfig {
  /** OffscreenCanvas-eligible <canvas>. We `.transferControlToOffscreen()`. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  dials?: {
    renderResolution?: number;
    stageZoom?: number;
    playerAnimFps?: number;
  };
}

export class BattlefieldClient {
  private worker: Worker;
  private nextRequestId = 1;
  private pickWaiters = new Map<number, (r: WorkerPickResultPayload) => void>();
  private cellClickListeners = new Set<(cellId: number) => void>();
  private cellHoverListeners = new Set<(cellId: number | null) => void>();
  private readyPromise: Promise<void>;

  constructor(config: BattlefieldClientConfig) {
    this.worker = new Worker(
      new URL("../worker/battlefield-worker.ts", import.meta.url),
      { type: "module" }
    );

    let resolveReady: () => void = () => {};
    this.readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      switch (msg.type) {
        case "ready":
          resolveReady();
          break;
        case "pickResult": {
          const waiter = this.pickWaiters.get(msg.payload.requestId);
          if (waiter) {
            this.pickWaiters.delete(msg.payload.requestId);
            waiter(msg.payload);
          }
          break;
        }
        case "cellClick":
          for (const fn of this.cellClickListeners) fn(msg.cellId);
          break;
        case "cellHover":
          for (const fn of this.cellHoverListeners) fn(msg.cellId);
          break;
        case "error":
          // eslint-disable-next-line no-console
          console.error("[battlefield-worker]", msg.message);
          break;
        default:
          break;
      }
    };

    const offscreen = config.canvas.transferControlToOffscreen();
    this.send(
      {
        type: "init",
        payload: {
          canvas: offscreen,
          width: config.width,
          height: config.height,
          dials: {
            renderResolution: config.dials?.renderResolution ?? 3,
            stageZoom: config.dials?.stageZoom ?? 3,
            playerAnimFps: config.dials?.playerAnimFps ?? 60,
          },
        },
      },
      [offscreen]
    );
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  resize(width: number, height: number): void {
    this.send({ type: "resize", width, height });
  }

  spawnPlayer(payload: {
    id: number;
    cellId: number;
    direction: number;
    look: string;
    team?: number;
    isCurrentPlayer?: boolean;
  }): void {
    this.send({ type: "spawnPlayer", payload });
  }

  despawnPlayer(id: number): void {
    this.send({ type: "despawnPlayer", id });
  }

  setPlayerAnim(id: number, baseAnim: string, direction: number): void {
    this.send({
      type: "setPlayerAnim",
      payload: { id, baseAnim, direction },
    });
  }

  setPlayerCell(id: number, cellId: number, path?: number[]): void {
    this.send({
      type: "setPlayerCell",
      payload: { id, cellId, path },
    });
  }

  setPlayerLook(id: number, look: string): void {
    this.send({ type: "setPlayerLook", id, look });
  }

  loadMap(mapData: unknown): void {
    this.send({ type: "loadMap", mapData });
  }

  enterFightMode(mode: string): void {
    this.send({ type: "enterFightMode", mode });
  }

  exitFightMode(): void {
    this.send({ type: "exitFightMode" });
  }

  setZoom(zoom: number): void {
    this.send({ type: "setZoom", zoom });
  }

  setTacticalMode(enabled: boolean): void {
    this.send({ type: "setTacticalMode", enabled });
  }

  /**
   * Pointer pick. Resolves with the hit cell + optional player id
   * once the worker replies. Caller should debounce per pointermove
   * (typ. 16ms is plenty).
   */
  pick(x: number, y: number): Promise<WorkerPickResultPayload> {
    const requestId = this.nextRequestId++;
    return new Promise<WorkerPickResultPayload>((resolve) => {
      this.pickWaiters.set(requestId, resolve);
      this.send({ type: "pick", payload: { x, y, requestId } });
    });
  }

  onCellClick(fn: (cellId: number) => void): () => void {
    this.cellClickListeners.add(fn);
    return () => {
      this.cellClickListeners.delete(fn);
    };
  }

  onCellHover(fn: (cellId: number | null) => void): () => void {
    this.cellHoverListeners.add(fn);
    return () => {
      this.cellHoverListeners.delete(fn);
    };
  }

  destroy(): void {
    this.send({ type: "shutdown" });
    this.worker.terminate();
    this.pickWaiters.clear();
    this.cellClickListeners.clear();
    this.cellHoverListeners.clear();
  }

  private send(msg: WorkerInMessage, transfer?: Transferable[]): void {
    if (transfer) {
      this.worker.postMessage(msg, transfer);
    } else {
      this.worker.postMessage(msg);
    }
  }
}
