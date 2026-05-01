import { type Application, Container, Ticker } from "pixi.js";

import type { CharacterSpriteLoader } from "@/game/assets/character-sprite";
import type { Engine } from "@/game/render/engine";
import type { RendererRegistry } from "@/game/render/renderer-registry";
import type { Scene } from "@/game/scene/scene";
import { AdjacentMapCache } from "@/game/assets/adjacent-map-cache";
import { InteractionHandler } from "@/game/input/interaction-handler";
import { AtlasLoader } from "@/game/render/atlas-loader";
import { PickingSystem } from "@/game/render/picking-system";
import { SpellVelloRenderer } from "@/game/render/spell-vello-renderer";
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
  /**
   * Shared Vello renderer for spell .dofasset files. Instantiated in
   * `initPickingAndAtlas` and bound to the Vello WASM renderer in
   * `wireVelloLoaders`; FightUI reads it when creating SpellRenderer
   * so cast animations render through the same GPU pipeline as tiles
   * and character sprites.
   */
  spellVelloRenderer: SpellVelloRenderer | null;

  handleGroundClick(mapX: number, mapY: number): void;
  handleGroundHover(mapX: number, mapY: number): void;
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
  // mapContainer holds the full battlefield stack — tiles, world-actors,
  // cell-highlights, grid, damage/spell-fx. Without sortableChildren the
  // order would follow insertion (fight UI added last → on top of every
  // sprite), which is the opposite of the original Dofus 1.29 layout
  // where Zone (cell tints) sits between Object1 and Object2. Explicit
  // zIndex on each layer child keeps the ordering deterministic.
  ctx.mapContainer.sortableChildren = true;
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
  ctx.spellVelloRenderer = new SpellVelloRenderer(
    ctx.app.renderer,
    "/assets/spritesheets"
  );
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
  ctx.spellVelloRenderer?.setVelloRenderer(vello);
  ctx.adjacentMapCache = new AdjacentMapCache(ctx.atlasLoader);

  // HUD spell-icon renderer uses the same Vello + Pixi handles to turn
  // `/assets/dofassets/spells/icons/<sprite>.dofasset` into `<img>`-ready
  // data URLs for the banner grid. Initialized here so the hook mounted by
  // BannerReact can resolve URLs as soon as the battlefield finishes boot.
  const { getSpellIconRenderer } = await import(
    "@/game/render/spell-icon-renderer"
  );
  getSpellIconRenderer().init(vello, ctx.app.renderer);

  // StringCourse turn-change banner artwork — canonical Game.as:389
  // loads `ARTWORKS_BIG_PATH + gfxFileName + ".swf"` for the active
  // fighter; we serve those as `.dofassets` published by the asset
  // pipeline and rasterize through the same Vello + Pixi extract path
  // the spell-icon renderer uses.
  const { getFighterPortraitRenderer } = await import(
    "@/game/render/fighter-portrait-renderer"
  );
  getFighterPortraitRenderer().init(vello, ctx.app.renderer);

  // Generic UI dofasset renderer — backs the canonical loader.swf
  // panels (UI_StringCourse parchment, etc.) by path. Same Vello +
  // Pixi extract pipeline; React mounts the resulting canvas as the
  // panel background.
  const { getUiAssetRenderer } = await import(
    "@/game/render/ui-asset-renderer"
  );
  getUiAssetRenderer().init(vello, ctx.app.renderer);

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
    onGroundHover: (mapX, mapY) => ctx.handleGroundHover(mapX, mapY),
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
