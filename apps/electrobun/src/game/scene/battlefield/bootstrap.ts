import { type Application, Container, Ticker } from "pixi.js";

import type { CharacterSpriteLoader } from "@/game/assets/character-sprite";
import type { Engine } from "@/game/render/engine";
import type { RendererRegistry } from "@/game/render/renderer-registry";
import type { MapHandler } from "@/game/scene/map/handler";
import type { Scene } from "@/game/scene/scene";
import { AdjacentMapCache } from "@/game/assets/adjacent-map-cache";
import { InteractionHandler } from "@/game/input/interaction-handler";
import { AtlasLoader } from "@/game/render/atlas-loader";
import { PickingSystem } from "@/game/render/picking-system";
import { PlayerStripRenderer } from "@/game/render/player-strip-renderer";
import { getRenderWatchdog } from "@/game/render/render-watchdog";
import { SideBandCompositor } from "@/game/render/side-band-compositor";
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

  /**
   * Single canvas element handed to Pixi's `Application` as its render
   * target. Owned by the React component; passed in by the Battlefield
   * host.
   */
  canvas: HTMLCanvasElement | null;

  app: Application | null;
  mapContainer: Container | null;
  /**
   * Widescreen side-band compositor. Wraps `mapContainer` in a
   * masked offset container so the game renders centred in the
   * 1.95-aspect canvas, and fills the lateral bands with a sampled
   * mirror+blur of the game render texture. Owned by the Battlefield.
   */
  sideBandCompositor: SideBandCompositor | null;
  mapTransition: MapTransition | null;
  /**
   * Map renderer — populated lazily by `Battlefield.loadManifest()`
   * AFTER the bootstrap functions complete. Read by the watchdog
   * stats provider via the closure in `wireVelloLoaders`, so it
   * tolerates being null during the initial engine bringup.
   */
  mapHandler: MapHandler | null;
  pickingSystem: PickingSystem | null;
  atlasLoader: AtlasLoader | null;
  adjacentMapCache: AdjacentMapCache | null;
  interactionHandler: InteractionHandler | null;
  debugOverlay: DebugOverlay | null;
  gridOverlay: GridOverlay | null;
  sceneTickerCallback: (() => void) | null;
  /**
   * Strip-rendered character sprite owner. Constructed in
   * `initEngineAndVello` after Pixi adopts Vello's GPUDevice; each
   * player gets a Pixi sprite child of `player.container`, with
   * frames produced by ONE `renderSwfStripRangeAccessorized` dispatch
   * per anim swap.
   */
  playerStripRenderer: PlayerStripRenderer | null;

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
  if (!ctx.canvas) {
    throw new Error(
      "initEngineAndVello: canvas not provided by host (must mount first)"
    );
  }

  try {
    const { initVello } = await import("@/game/render/vello-loader");
    await initVello();
    // Vello creates the shared `GPUDevice` (via the patched wgpu fork
    // that exposes the raw JS handle). Pixi adopts it inside
    // `engine.init()` via `app.init({ gpu: getVelloGpu() })` so both
    // libraries render on ONE WebGPU device. Vello-produced
    // GPUTextures are consumed by Pixi as `ExternalSource` sprites.
    log.info("Vello WASM renderer initialized");
  } catch (e) {
    log.error("Vello WASM failed to initialize — rendering will not work:", e);
  }

  await ctx.engine.init(ctx.canvas);
  ctx.app = ctx.engine.getApp();

  ctx.mapContainer = new Container();
  // mapContainer holds every renderable: ground/object1/object2 tile
  // sprites (TileSpriteRenderer), per-player containers with strip-
  // rendered char sprites (PlayerStripRenderer), cell-tint diamonds
  // (WorldCellTints), and overlays (grid, debug). One canvas, one
  // Pixi compositor.
  ctx.mapContainer.sortableChildren = true;
  ctx.app.stage.addChild(ctx.mapContainer);
  // SideBandCompositor positions mapContainer at the centring offset
  // for the wider 1.95-aspect canvas and stands up two band sprites
  // beside it that fill the lateral strips with a heavy LOD-based
  // blur of the rendered game. The offset lives directly on
  // `mapContainer.position` so existing interaction math (which reads
  // `mapContainer.x` as the screen anchor) keeps working — see the
  // compositor file header for the rationale.
  ctx.sideBandCompositor = new SideBandCompositor(ctx.app, ctx.mapContainer);
  ctx.mapTransition = new MapTransition(ctx.app, ctx.mapContainer);

  // Strip-rendered character sprite owner. Pixi adopted Vello's
  // GPUDevice in `engine.init` (Phase 2), so the strip's GPUTexture
  // wraps cleanly as a Pixi `ExternalSource` on the same device.
  ctx.playerStripRenderer = new PlayerStripRenderer(ctx.app.renderer);
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
  ctx.atlasLoader = new AtlasLoader(ctx.app.renderer);
}

/**
 * Pre-warm all gfx tile bundles (g1, g2, o1..o12, cell, tactic) at boot.
 * One parallel fetch per bundle; total ~63 MB and parses fast. After this
 * completes, tile rendering is a synchronous WASM call. A failed bundle
 * leaves its tiles invisible (logged) — same blast radius as a missing
 * dofasset would have had.
 */
export async function prewarmSwfTileBundles(): Promise<void> {
  const { GFX_BUNDLE_NAMES, loadSwfBundle } = await import(
    "@/game/render/vello-loader"
  );
  const { getLoadProgress } = await import("@/game/render/load-progress");
  const progress = getLoadProgress();
  const total = GFX_BUNDLE_NAMES.length;
  let loaded = 0;
  let failed = 0;

  await Promise.all(
    GFX_BUNDLE_NAMES.map(async (name) => {
      try {
        const ok = await loadSwfBundle(name);
        if (!ok) {
          failed++;
          log.warn(`SWF bundle ${name} failed to load`);
        }
      } catch (e) {
        failed++;
        log.warn(`SWF bundle ${name} threw:`, e);
      } finally {
        loaded++;
        progress.report("swf-bundles", loaded, total);
      }
    })
  );

  if (failed === 0) {
    log.info(`prewarmSwfTileBundles: ${loaded}/${total} loaded`);
  } else {
    log.warn(
      `prewarmSwfTileBundles: ${loaded - failed}/${total} ok, ${failed} failed`
    );
  }
}

/**
 * Hand the shared Vello renderer to both tile + character sprite loaders and
 * wire up the debug overlay line. No-op if Vello is unavailable.
 */
export async function wireVelloLoaders(
  ctx: BattlefieldBootstrapContext
): Promise<void> {
  const { getVelloRenderer } = await import("@/game/render/vello-loader");
  const vello = getVelloRenderer();

  if (!vello || !ctx.app || !ctx.atlasLoader) {
    return;
  }

  ctx.atlasLoader.setVelloRenderer(vello);
  ctx.characterSpriteLoader.setVelloRenderer(vello, ctx.app.renderer);
  ctx.adjacentMapCache = new AdjacentMapCache(ctx.atlasLoader);

  // HUD spell-icon renderer composes `/swf/spells/icons/back/<b>.swf` +
  // `/swf/spells/icons/up/<up>.swf` into `<img>`-ready canvases for the
  // banner grid. Initialized here so the hook mounted by BannerReact can
  // resolve canvases as soon as the battlefield finishes boot.
  const { getSpellIconRenderer } = await import(
    "@/game/render/spell-icon-renderer"
  );
  getSpellIconRenderer().init(vello, ctx.app.renderer);

  // StringCourse turn-change banner artwork — canonical Game.as:389
  // loads `ARTWORKS_BIG_PATH + gfxFileName + ".swf"` for the active
  // fighter; served verbatim from `/swf/artworks/big/<gfxId>.swf` and
  // rasterized through the same Vello + Pixi extract path the spell-icon
  // renderer uses.
  const { getFighterPortraitRenderer } = await import(
    "@/game/render/fighter-portrait-renderer"
  );
  getFighterPortraitRenderer().init(vello, ctx.app.renderer);

  // Banner-circle "xtra" views from core.swf — UI_BannerClockBack,
  // UI_BannerCompassArrow, Helper, … — rendered at the React side as
  // 2D canvases. Bundle is fetched lazily on the first getCanvas call;
  // init() just flips the ready flag so the React hook fires once Vello
  // is up.
  const { getBannerViewRenderer } = await import(
    "@/game/render/banner-view-renderer"
  );
  getBannerViewRenderer().init();

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

  // Wire providers so the watchdog HUD can read live stats from the
  // existing renderer instances. Each provider closure re-resolves the
  // owner on call (atlasLoader, characterSpriteLoader.getAtlas(),
  // mapHandler) — that way the HUD survives map changes that recreate
  // them and shows null/zero gracefully before they're populated.
  const atlasLoader = ctx.atlasLoader;
  const { getSwfLoadStats } = await import("@/game/render/vello-loader");
  getRenderWatchdog().setStatsProvider({
    tileDispatch: () => ctx.mapHandler?.getTileLayerStats() ?? null,
    frameAtlas: () => {
      const atlas = spriteLoader.getAtlas();
      if (!atlas) return null;
      const s = atlas.stats;
      return {
        slots: s.slots,
        maxSlots: s.maxSlots,
        lastRenders: s.lastRenders,
        lastQueueMs: s.lastQueueMs,
        lastFlushMs: s.lastFlushMs,
        lastHits: s.lastHits,
      };
    },
    atlasCacheBytes: () => atlasLoader?.getFrameCacheMemoryBytes() ?? 0,
    atlasCacheEntries: () => atlasLoader?.getFrameCacheEntryCount() ?? 0,
    swfLoad: () => getSwfLoadStats(),
  });
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
  // Stage pointer events route through the handler's own bound methods
  // (registered + removable). The previous inline-arrow `.on()` calls
  // could not be unbound, pinning the handler closure when the stage
  // was rebuilt.
  ctx.interactionHandler.attachToStage(ctx.app.stage);
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
    const dtMs = Ticker.shared.deltaMS;
    ctx.scene.tick(dtMs);
    ctx.interactionHandler?.tick();
    // After scene + interaction ticks settle this frame's animation
    // state, capture the wrapper into `gameRt` so the side-band filters
    // sample the latest map state. Runs before Pixi's internal stage
    // render fires (Pixi's render callback sits at LOW priority while
    // this ticker is at NORMAL).
    ctx.sideBandCompositor?.captureFrame();
  };

  Ticker.shared.add(ctx.sceneTickerCallback);
}
