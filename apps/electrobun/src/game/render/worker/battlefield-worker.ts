/**
 * Battlefield render worker.
 *
 * Production version of `apps/electrobun/src/window/mainview/stress-worker.ts`.
 * Owns Vello + Pixi inside a DedicatedWorker via OffscreenCanvas; reads
 * the gameserver-driven game state via postMessage from the main thread
 * and renders accordingly.
 *
 * **Status: scaffolding.** This file establishes the worker entry,
 * message protocol, Vello+Pixi bootstrap, and tick driver. The
 * existing main-thread `Battlefield` (apps/electrobun/src/game/scene/
 * battlefield-scene.ts) is not yet relocated into the worker — full
 * cutover requires:
 *
 *   1. Single canvas in `MapRenderer.tsx` (currently 3-canvas via
 *      `CanvasStack`); collapse first via Phase 6 cleanup.
 *   2. Migrating `worldLayer`'s spells/decals/celltints/mount-layer
 *      placements from the top Vello surface to Pixi sprites (so the
 *      worker only owns one Pixi compositor canvas).
 *   3. Picking moved into the worker as an RPC (Pixi `containsPoint`
 *      against `playersLayer/object1Layer/object2Layer`, falls back
 *      to a worker-side CPU bitmap query if alpha-precise tile hits
 *      matter).
 *   4. FightUI's overlay renderers (`SpellRenderer`, `CellHighlighter`,
 *      `DamageRenderer`, `FighterPortraitRenderer`) move worker-side;
 *      HUD / DOM panels stay on main thread.
 *
 * Pattern to mirror at full cutover: `stress-worker.ts:374-1052`
 * (init → layer containers → setInterval(16) tick: animated tiles
 * + player anim swap queue + accumulator frame advance + `app.renderer
 * .render(app.stage)`). Reuse `stress-worker-bootstrap.ts` for the
 * `document`/`window` polyfills.
 */

// MUST be the first import — sets `document`/`window`/etc. polyfills
// before pixi.js evaluates. Without this, Pixi throws "document is
// not defined" during Application.init in a worker.
import "@/window/mainview/stress-worker-bootstrap";

import { Application, Container } from "pixi.js";

import { initVello } from "@/game/render/vello-loader";

import type { WorkerInMessage, WorkerOutMessage } from "./protocol";

const TICK_INTERVAL_MS = 1000 / 60;

interface WorkerState {
  app: Application | null;
  stage: Container | null;
  groundLayer: Container | null;
  object1Layer: Container | null;
  playersLayer: Container | null;
  object2Layer: Container | null;
  tickInterval: ReturnType<typeof setInterval> | null;
  dials: {
    renderResolution: number;
    stageZoom: number;
    playerAnimFps: number;
  };
}

const state: WorkerState = {
  app: null,
  stage: null,
  groundLayer: null,
  object1Layer: null,
  playersLayer: null,
  object2Layer: null,
  tickInterval: null,
  dials: {
    renderResolution: 3,
    stageZoom: 3,
    playerAnimFps: 60,
  },
};

const post = (msg: WorkerOutMessage): void => {
  // `as DedicatedWorkerGlobalScope` cast for the postMessage binding —
  // the global `self` in a worker IS that scope but TS doesn't pick
  // it up by default in the lib config we ship.
  (self as unknown as { postMessage: (msg: WorkerOutMessage) => void })
    .postMessage(msg);
};

async function bootstrap(canvas: OffscreenCanvas, width: number, height: number): Promise<void> {
  // 1. Vello creates the GPUDevice (patched wgpu exposes the JS handle).
  const { gpu } = await initVello();

  // 2. Pixi adopts the same device (mirrors stress-worker.ts:398-412).
  const app = new Application();
  await app.init({
    canvas,
    width,
    height,
    backgroundAlpha: 0,
    preference: "webgpu",
    gpu,
    resolution: 1,
    antialias: true,
    autoDensity: false,
  } as Parameters<Application["init"]>[0]);
  app.ticker.stop();

  const stage = app.stage;
  const groundLayer = new Container();
  const object1Layer = new Container();
  const playersLayer = new Container();
  const object2Layer = new Container();
  groundLayer.sortableChildren = true;
  object1Layer.sortableChildren = true;
  playersLayer.sortableChildren = true;
  object2Layer.sortableChildren = true;
  stage.addChild(groundLayer, object1Layer, playersLayer, object2Layer);

  // 3. Stage transform — STAGE_ZOOM applied to stage, centered on canvas.
  const z = state.dials.stageZoom;
  stage.scale.set(z, z);
  stage.x = (width * (1 - z)) / 2;
  stage.y = (height * (1 - z)) / 2;

  state.app = app;
  state.stage = stage;
  state.groundLayer = groundLayer;
  state.object1Layer = object1Layer;
  state.playersLayer = playersLayer;
  state.object2Layer = object2Layer;

  // 4. Tick driver (no rAF in workers — `setInterval(16)`).
  state.tickInterval = setInterval(() => {
    if (state.app) {
      state.app.renderer.render(state.app.stage);
    }
  }, TICK_INTERVAL_MS);

  post({ type: "ready" });
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      const { canvas, width, height, dials } = msg.payload;
      state.dials = dials;
      bootstrap(canvas, width, height).catch((err: unknown) => {
        post({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
      break;
    }
    case "resize": {
      if (state.app) {
        state.app.renderer.resize(msg.width, msg.height);
      }
      break;
    }
    case "shutdown": {
      if (state.tickInterval) {
        clearInterval(state.tickInterval);
        state.tickInterval = null;
      }
      if (state.app) {
        state.app.destroy(true, { children: true, texture: true });
        state.app = null;
      }
      break;
    }
    // Cutover items: spawnPlayer/setPlayerAnim/setPlayerCell/loadMap/
    // pick/enterFightMode/etc. are not yet implemented. They land
    // when the main-thread Battlefield is relocated into the worker
    // (see file-header docstring for the cutover checklist).
    default:
      break;
  }
};
