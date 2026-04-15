import { type Application, Container, Ticker } from "pixi.js";

import type { CharacterSpriteLoader } from "@/game/assets/character-sprite";
import type { Engine } from "@/game/render/engine";
import type { RendererRegistry } from "@/game/render/renderer-registry";
import type { Scene } from "@/game/scene/scene";
import { AdjacentMapCache } from "@/game/assets/adjacent-map-cache";
import { InteractionHandler } from "@/game/input/interaction-handler";
import { AtlasLoader } from "@/game/render/atlas-loader";
import { PickingSystem } from "@/game/render/picking-system";
import { MapTransition } from "@/game/scene/map/transition";
import { DebugOverlay } from "@/game/scene/overlays/debug";
import { GridOverlay } from "@/game/scene/overlays/grid";
import { createLogger } from "@/utils/logger";

import type { BattlefieldPicking } from "./picking";
import type { BattlefieldWorldActors } from "./world-actors";
import type { BattlefieldZoom } from "./zoom";

const log = createLogger("BattlefieldBootstrap");

/**
 * State container Battlefield hands to the bootstrap functions so they can
 * wire up the Pixi engine, Vello renderer, picking, atlas loader, interaction
 * handlers, and overlays without reaching into private fields from outside
 * the class. Fields are typed as nullable since they're populated in order.
 */
export interface BattlefieldBootstrapContext {
  engine: Engine;
  scene: Scene;
  rendererRegistry: RendererRegistry;
  characterSpriteLoader: CharacterSpriteLoader;

  picking: BattlefieldPicking;
  worldActors: BattlefieldWorldActors;
  zoom: BattlefieldZoom;

  app: Application | null;
  mapContainer: Container | null;
  mapTransition: MapTransition | null;
  pickingSystem: PickingSystem | null;
  atlasLoader: AtlasLoader | null;
  adjacentMapCache: AdjacentMapCache | null;
  interactionHandler: InteractionHandler | null;
  debugOverlay: DebugOverlay | null;
  gridOverlay: GridOverlay | null;
  sceneTickerCallback: (() => void) | null;

  handleGroundClick(mapX: number, mapY: number): void;
}

/**
 * Init Pixi engine + shared Vello GPU device. Must complete before anything
 * renders — Vello needs the GPUDevice attached before `engine.init()` so the
 * WebGPU pipeline uses the shared device (enables zero-copy texture sharing).
 */
export async function initEngineAndVello(
  ctx: BattlefieldBootstrapContext
): Promise<void> {
  try {
    const { initVello } = await import("@/game/render/vello-loader");
    const { gpu } = await initVello();
    ctx.engine.setGpu(gpu);
    log.info("Vello WASM renderer initialized (zero-copy GPU sharing)");
  } catch (e) {
    log.error("Vello WASM failed to initialize — rendering will not work:", e);
  }

  await ctx.engine.init();
  ctx.app = ctx.engine.getApp();

  ctx.mapContainer = new Container();
  ctx.app.stage.addChild(ctx.mapContainer);
  ctx.mapTransition = new MapTransition(ctx.app, ctx.mapContainer);
}

export function initPickingAndAtlas(ctx: BattlefieldBootstrapContext): void {
  if (!ctx.app) {
    throw new Error("initPickingAndAtlas called before engine init");
  }

  ctx.pickingSystem = new PickingSystem(ctx.app.renderer, 16);
  ctx.pickingSystem.initializeTexture(
    ctx.app.screen.width,
    ctx.app.screen.height
  );
  ctx.atlasLoader = new AtlasLoader(ctx.app.renderer, "/assets/spritesheets");
}

/**
 * Hand the shared Vello renderer to both tile + character sprite loaders and
 * wire up the debug overlay line. No-op if Vello is unavailable.
 */
export async function wireVelloLoaders(
  ctx: BattlefieldBootstrapContext
): Promise<void> {
  const { getVelloRenderer, getMaxTextureSize } = await import(
    "@/game/render/vello-loader"
  );
  const vello = getVelloRenderer();

  if (!vello || !ctx.app || !ctx.atlasLoader) {
    return;
  }

  ctx.atlasLoader.setVelloRenderer(vello);
  ctx.characterSpriteLoader.setVelloRenderer(
    vello,
    ctx.app.renderer,
    getMaxTextureSize()
  );
  ctx.adjacentMapCache = new AdjacentMapCache(ctx.atlasLoader);

  const spriteLoader = ctx.characterSpriteLoader;
  ctx.engine.debugInfo = () => {
    const atlas = spriteLoader.getAtlas();

    if (!atlas) {
      return "no atlas";
    }

    const s = atlas.stats;
    const war = ctx.worldActors.getRenderer();
    const updMs = war ? war.lastUpdateMs.toFixed(1) : "?";
    const n = war ? war.getPlayerIds().length : 0;
    return `${n}act upd:${updMs}ms | sl:${s.slots}/${s.maxSlots} r:${s.lastRenders} q:${s.lastQueueMs.toFixed(1)}ms fl:${s.lastFlushMs.toFixed(1)}ms h:${s.lastHits}`;
  };
}

export function initInteraction(ctx: BattlefieldBootstrapContext): void {
  if (!ctx.app || !ctx.mapContainer || !ctx.pickingSystem) {
    throw new Error("initInteraction called before engine/picking init");
  }

  const canvas = ctx.engine.getCanvas();

  if (!canvas) {
    throw new Error("Canvas not created");
  }

  ctx.app.stage.eventMode = "static";
  ctx.mapContainer.eventMode = "static";

  ctx.interactionHandler = new InteractionHandler({
    mapContainer: ctx.mapContainer,
    pickingSystem: ctx.pickingSystem,
    canvas,
    onZoomChange: (zoom) => ctx.zoom.request(zoom),
    onObjectClick: (result) => ctx.picking.onObjectClick(result),
    onObjectHover: (result) => ctx.picking.onObjectHover(result),
    onGroundClick: (mapX, mapY) => ctx.handleGroundClick(mapX, mapY),
  });
  ctx.interactionHandler.init();
  ctx.interactionHandler.setBaseZoom(ctx.engine.getBaseZoom());

  const handler = ctx.interactionHandler;
  ctx.app.stage.on("pointerdown", (e) => handler.handlePointerDown(e));
  ctx.app.stage.on("pointermove", (e) => handler.handlePointerMove(e));
  ctx.app.stage.on("pointerup", () => handler.handlePointerUp());
  ctx.app.stage.on("pointerupoutside", () => handler.handlePointerUp());
}

export function initOverlays(ctx: BattlefieldBootstrapContext): void {
  if (!ctx.app || !ctx.mapContainer) {
    throw new Error("initOverlays called before engine init");
  }

  ctx.debugOverlay = new DebugOverlay(ctx.app.stage);
  ctx.debugOverlay.setMapContainer(ctx.mapContainer);
  ctx.debugOverlay.setScreenSize(ctx.app.screen.width, ctx.app.screen.height);
  ctx.scene.add(ctx.debugOverlay);

  // Inside mapContainer so the grid pans/zooms with the map.
  ctx.gridOverlay = new GridOverlay(ctx.mapContainer);
  ctx.scene.add(ctx.gridOverlay);

  ctx.rendererRegistry.register("debug-overlay", (e) =>
    ctx.debugOverlay?.onResize(e)
  );
  ctx.rendererRegistry.register("grid-overlay", (e) =>
    ctx.gridOverlay?.onResize(e)
  );
}

/** Single game-loop entry: scene drives per-frame work, interaction polls after. */
export function startSceneTicker(ctx: BattlefieldBootstrapContext): void {
  ctx.sceneTickerCallback = () => {
    ctx.scene.tick(Ticker.shared.deltaMS);
    ctx.interactionHandler?.tick();
  };

  Ticker.shared.add(ctx.sceneTickerCallback);
}
