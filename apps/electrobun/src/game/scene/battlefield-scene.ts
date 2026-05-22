import type { DofusPathfinding } from "@dofus/grid";
import { LayoutSystem } from "@pixi/layout";
import {
  type Application,
  type Container,
  extensions,
  TextureSource,
  Ticker,
} from "pixi.js";

import type { AdjacentMapCache } from "@/game/assets/adjacent-map-cache";
import type { InteractionHandler } from "@/game/input/interaction-handler";
import type { AtlasLoader } from "@/game/render/atlas-loader";
// Side-effect import: registers `window.__spike` for the
// OffscreenCanvas + ImageBitmap bridge spike. Invoke from devtools
// inside a loaded battle. Delete with the spike file.
import "@/game/render/spike-bitmap-bridge";
import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerStripRenderer } from "@/game/render/player-strip-renderer";
import type {
  MapTransition,
  TransitionDirection,
} from "@/game/scene/map/transition";
import type { DebugOverlay } from "@/game/scene/overlays/debug";
import type { GridOverlay } from "@/game/scene/overlays/grid";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import type { InteractiveObjectData } from "@/game/types";
import {
  type CharacterSpriteLoader,
  initCharacterSpriteLoader,
} from "@/game/assets/character-sprite";
import { type CellData, findCellAtPosition } from "@/game/datacenter/cell";
import { computeMapScale, type MapData } from "@/game/datacenter/map";
import { Camera } from "@/game/render/camera";
import { Engine } from "@/game/render/engine";
import {
  diffMemSnapshot,
  formatLeakReport,
  formatMemSnapshot,
  takeMemSnapshot,
  type MemSnapshot,
  type MemSources,
} from "@/game/render/mem-snapshot";
import { RendererRegistry } from "@/game/render/renderer-registry";
import {
  type BattlefieldBootstrapContext,
  initEngineAndVello,
  initInteraction,
  initOverlays,
  initPickingAndAtlas,
  prewarmSwfTileBundles,
  startSceneTicker,
  wireVelloLoaders,
} from "@/game/scene/battlefield/bootstrap";
import { BattlefieldPicking } from "@/game/scene/battlefield/picking";
import {
  BattlefieldWorldActors,
  type WorldActorData,
} from "@/game/scene/battlefield/world-actors";
import { BattlefieldZoom } from "@/game/scene/battlefield/zoom";
import { MapHandler } from "@/game/scene/map/handler";
import { Scene } from "@/game/scene/scene";
import { hideContextMenu } from "@/game/stores/context-menu-store";
import { fightActor } from "@/game/stores/fight-store";
import { FightUI } from "@/hud/fight/fight-ui";
import {
  setTacticalMode as setTacticalModeStore,
  tacticalModeStore,
} from "@/hud/fight/tactical-mode-store";
import { loadTheme } from "@/themes";
import { createLogger } from "@/utils/logger";

extensions.add(LayoutSystem);
TextureSource.defaultOptions.scaleMode = "linear";
TextureSource.defaultOptions.autoGenerateMipmaps = false;

// FightMode single source of truth is src/lib/machines/fightMachine.ts
// (state value) + src/lib/stores/fight-store.ts (type export).
import type { FightMode } from "@/game/stores/fight-store";
export type FightModeValue = FightMode;

export type { WorldActorData } from "@/game/scene/battlefield/world-actors";

export interface BattlefieldConfig {
  /**
   * Single canvas element handed to the Pixi `Application` as its
   * render target. Owned by the React component; the battlefield
   * bootstrap binds Pixi to it (Vello renders to off-screen GPU
   * textures consumed by Pixi as `ExternalSource` sprites — no
   * additional surface attachment is needed).
   */
  canvas: HTMLCanvasElement;
  /**
   * Wrapping `<div>` whose getBoundingClientRect drives the engine's
   * resize math + HUD anchor projection. The Battlefield does not
   * mount any canvas inside it (the React tree owns the canvases).
   */
  container: HTMLElement;
  backgroundColor?: number;
  preferWebGPU?: boolean;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  resizeDebounceMs?: number;
}

const log = createLogger("Battlefield");

function projectFightMode(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "fighting" in value) {
    return "fighting";
  }
  return "none";
}

export class Battlefield {
  private engine: Engine;
  /**
   * Single source of truth for viewport state — logicalWidth/Height
   * (canonical 742×432), pan, zoom, dpr. Mutated by the engine on
   * resize / DPR change and by `BattlefieldZoom` on user wheel zoom.
   * Subscribers (Camera-aware HUD components, Vello surface
   * reconfigure on DPR change, etc.) react to changes.
   */
  private readonly camera: Camera;
  /** Single canvas hosting the Pixi `Application`. */
  private canvas: HTMLCanvasElement;
  private app: Application | null = null;
  private mapContainer: Container | null = null;
  private atlasLoader: AtlasLoader | null = null;
  /**
   * Strip-rendered character sprite owner. Constructed by
   * `initEngineAndVello` (after Pixi adopts Vello's GPUDevice); each
   * player gets a Pixi sprite child of `player.container`, fed by one
   * Vello strip dispatch per anim swap. Per-tick frame advance is a
   * free pointer-swap.
   */
  private playerStripRenderer: PlayerStripRenderer | null = null;
  private mapHandler: MapHandler | null = null;
  private interactionHandler: InteractionHandler | null = null;
  private pickingSystem: PickingSystem | null = null;
  private characterSpriteLoader: CharacterSpriteLoader;

  private fightUI: FightUI | null = null;
  private fightActorUnsubscribe: (() => void) | null = null;
  private tacticalUnsubscribe: (() => void) | null = null;
  private lastFightMode: string = "none";
  private tacticalMode = false;

  private currentMapData: MapData | null = null;
  private cellDataMap: Map<number, CellData> = new Map();

  private transparencyMode = false;
  private interactiveGfxIds = new Set<number>();
  private interactiveObjectsData = new Map<number, InteractiveObjectData>();

  private pathfinding: DofusPathfinding | null = null;

  private debugOverlay: DebugOverlay | null = null;
  private gridOverlay: GridOverlay | null = null;

  /** Blur-out old map → blur-in new map on map change. */
  private mapTransition: MapTransition | null = null;
  private adjacentMapCache: AdjacentMapCache | null = null;

  /** Bound keydown handler (E = fée-cœur firework at cursor). Stored
   *  as a field so `destroy()` can actually `removeEventListener` —
   *  inline arrows captured per-init wouldn't match. */
  private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
  /** Bound mousemove handler that records the last cursor position
   *  in client-window coordinates. Used by `boundOnKeyDown` so F
   *  spawns at the cursor without needing a fresh pointer event. */
  private boundOnMouseMove: ((e: MouseEvent) => void) | null = null;
  /** Most recent cursor position in CLIENT coordinates (page-relative,
   *  matches `MouseEvent.clientX/Y`). -1 until first mousemove. */
  private lastClientMouseX = -1;
  private lastClientMouseY = -1;

  /** Capability-bucketed actor registry + single ticker entry point. */
  private scene: Scene = new Scene();
  private sceneTickerCallback: (() => void) | null = null;

  private rendererRegistry = new RendererRegistry();

  private onCellClickCallback?: (cellId: number) => void;
  private onCellHoverCallback?: (cellId: number | null) => void;
  private lastHoveredCellId: number | null = null;
  private onResizeStartCallback?: () => void;
  private onResizeEndCallback?: () => void;

  private readonly picking = new BattlefieldPicking({
    pickingSystem: () => this.pickingSystem,
    interactiveObjects: () => this.interactiveObjectsData,
    worldActorRenderer: () => this.worldActors.getRenderer(),
    app: () => this.app,
    onCellPickThrough: (cellId) => this.onCellClickCallback?.(cellId),
  });

  private readonly worldActors = new BattlefieldWorldActors({
    mapContainer: () => this.mapContainer,
    mapHandler: () => this.mapHandler,
    scene: () => this.scene,
    characterSpriteLoader: () => this.characterSpriteLoader,
    pickingSystem: () => this.pickingSystem,
    pathfinding: () => this.pathfinding,
    cellDataMap: () => this.cellDataMap,
    rendererRegistry: () => this.rendererRegistry,
    stripRenderer: () => this.playerStripRenderer,
    currentMapWidth: () => this.currentMapData?.width ?? 15,
    transparencyEnabled: () => this.transparencyMode,
    applyTransparency: () => this.applyTransparencyMode(),
    registerPlayerForPicking: (
      id,
      renderer,
      monsterGroup,
      isCurrentPlayer,
      monsterGroupBonus,
      groupSpriteIds
    ) =>
      this.picking.registerPlayer(
        id,
        renderer,
        monsterGroup,
        isCurrentPlayer,
        monsterGroupBonus,
        groupSpriteIds
      ),
    unregisterPlayerFromPicking: (id) => this.picking.unregisterPlayer(id),
    markPickingDirty: () => this.pickingSystem?.markDirty(),
  });

  private readonly zoom = new BattlefieldZoom({
    mapHandler: () => this.mapHandler,
    mapContainer: () => this.mapContainer,
    atlasLoader: () => this.atlasLoader,
    currentMapData: () => this.currentMapData,
    getViewport: () => this.getViewport(),
    camera: () => this.camera,
    onBeforeRebuild: () => {
      this.picking.clearTiles();
      this.debugOverlay?.clear();
    },
    onAfterRender: (z) =>
      this.notifyResize(
        z,
        this.app?.screen.width ?? 0,
        this.app?.screen.height ?? 0
      ),
  });

  constructor(config: BattlefieldConfig) {
    this.onResizeStartCallback = config.onResizeStart;
    this.onResizeEndCallback = config.onResizeEnd;
    this.canvas = config.canvas;

    this.characterSpriteLoader = initCharacterSpriteLoader();

    // Initial viewport state — refined by the engine on first
    // `init()` (which knows the actual container dims + computed
    // baseZoom) and by subsequent resize / DPR / wheel-zoom events.
    this.camera = new Camera({
      logicalWidth: 742,
      logicalHeight: 432,
      panX: 0,
      panY: 0,
      zoom: 1,
      dpr:
        typeof window !== "undefined" ? window.devicePixelRatio : 1,
    });

    this.engine = new Engine({
      container: config.container,
      antialias: true,
      backgroundColor: config.backgroundColor ?? 0x000000,
      preferWebGPU: config.preferWebGPU ?? true,
      resizeDebounceMs: config.resizeDebounceMs ?? 300,
      camera: this.camera,
      onResize: (width, height) => this.handleCanvasResize(width, height),
      onResizeStart: () => this.handleResizeStart(),
      onResizeEnd: (width, height) => this.handleResizeEnd(width, height),
    });
  }

  /**
   * Read-only view of the canonical viewport state. HUD components
   * subscribe via `getCamera().subscribe(fn)` to receive
   * resize/zoom/DPR notifications.
   */
  getCamera(): Camera {
    return this.camera;
  }

  private handleCanvasResize(width: number, height: number): void {
    if (this.pickingSystem) {
      this.pickingSystem.initializeTexture(width, height);
      this.pickingSystem.markDirty();
    }

    if (this.interactionHandler) {
      this.interactionHandler.setBaseZoom(this.engine.getBaseZoom());
    }

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    this.notifyResize(zoom, width, height);
  }

  private notifyResize(zoom: number, screenW: number, screenH: number): void {
    this.rendererRegistry.notifyResize({
      zoom,
      baseZoom: this.engine.getBaseZoom(),
      screenWidth: screenW,
      screenHeight: screenH,
    });
  }

  private handleResizeStart(): void {
    if (this.onResizeStartCallback) {
      this.onResizeStartCallback();
    }
  }

  private async handleResizeEnd(
    _width: number,
    _height: number
  ): Promise<void> {
    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    await this.zoom.forceRender(zoom);
    this.onResizeEndCallback?.();
  }

  async init(): Promise<void> {
    await loadTheme("classic");

    const ctx = this as unknown as BattlefieldBootstrapContext;
    await initEngineAndVello(ctx);
    await this.loadInteractiveObjects();
    initPickingAndAtlas(ctx);
    await wireVelloLoaders(ctx);
    await prewarmSwfTileBundles();
    initInteraction(ctx);
    initOverlays(ctx);
    startSceneTicker(ctx);

    // Drive fight overlay lifecycle off the XState fightActor. The actor
    // receives FIGHT_INIT / FIGHT_END from the gameserver via FightHandler;
    // we only react to mode transitions and pass the canvas in/out of
    // fight-overlay state.
    this.fightActorUnsubscribe = fightActor.subscribe((snap) => {
      const mode = projectFightMode(snap.value);
      if (mode !== this.lastFightMode) {
        const previous = this.lastFightMode;
        this.lastFightMode = mode;
        if (
          mode === "placement" ||
          mode === "fighting" ||
          mode === "spectating"
        ) {
          this.enterFightMode(mode);
        } else {
          this.exitFightMode();
        }
        // Auto-enable the tactical grid lines the moment combat actually
        // starts (placement → fighting, or spectator drop-in). The
        // original client shows the grid by default during combat;
        // matching that behaviour avoids forcing the player to click the
        // tactical toggle on every fight. We only force-on at the edge:
        // if the user disables it mid-fight it stays off.
        if (
          (mode === "fighting" || mode === "spectating") &&
          previous !== "fighting" &&
          previous !== "spectating"
        ) {
          this.gridOverlay?.toggle(true);
        }
      }

      // Active-turn ring: redraw the current-turn fighter's ground
      // circle in the "glow" variant whenever the server shifts the
      // turn baton. Only meaningful once we're actually in combat —
      // context.currentTurnSpriteId is meaningful mid-fight, but the
      // ring layer is hidden during placement anyway.
      let turnId: number | null = null;
      if (mode === "fighting" && snap.context.currentTurnSpriteId) {
        const parsed = Number(snap.context.currentTurnSpriteId);
        turnId = Number.isFinite(parsed) ? parsed : null;
      }
      this.worldActors.getRenderer()?.setActiveTurnPlayer(turnId);
    }).unsubscribe;

    this.tacticalUnsubscribe = tacticalModeStore.subscribe(() => {
      // setTacticalMode is async (it re-renders the whole map); the store
      // change is the "intent" — we fire-and-forget and let the internal
      // tacticalMode guard dedupe repeated calls.
      void this.setTacticalMode(tacticalModeStore.getSnapshot().tactical);
    });
  }

  /**
   * Lazily create FightUI and bring up cell highlight / damage / spell
   * overlays on top of the existing world rendering. Idempotent.
   *
   * Team-colored ground rings are NOT enabled here — they turn on only
   * when the active state flips to "fighting" (below). During
   * placement the original client shows unadorned sprites; the rings
   * appear the moment combat actually starts.
   */
  enterFightMode(mode: string): void {
    // Circles appear once combat actually starts; during placement we
    // show the unadorned sprites like the original client. Spectators
    // always drop into an in-progress fight, so they keep the rings.
    this.worldActors
      .getRenderer()
      ?.setFightMode(mode === "fighting" || mode === "spectating");

    if (!this.fightUI) {
      if (!this.playerStripRenderer) {
        throw new Error(
          "enterFightMode: playerStripRenderer not yet constructed (bootstrap order regression)"
        );
      }
      if (!this.app) {
        throw new Error(
          "enterFightMode: Pixi app not yet initialized (bootstrap order regression)"
        );
      }
      this.fightUI = new FightUI(
        this.mapContainer,
        this.cellDataMap,
        this.pickingSystem,
        this.rendererRegistry,
        this.currentMapData
          ? {
              width: this.currentMapData.width,
              height: this.currentMapData.height,
            }
          : null,
        this.characterSpriteLoader,
        this.scene,
        this.playerStripRenderer
      );
    }
    this.fightUI.enterFightMode(mode);

  }

  exitFightMode(): void {
    const renderer = this.worldActors.getRenderer();
    renderer?.setActiveTurnPlayer(null);
    renderer?.setFightMode(false);
    this.fightUI?.exitFightMode();
    // Reset tactical mode so the next fight starts with normal terrain and
    // the HUD button reflects the actual render state. The store write
    // re-triggers setTacticalMode via the subscription.
    if (this.tacticalMode) {
      setTacticalModeStore(false);
    }
  }

  getFightUI(): FightUI | null {
    return this.fightUI;
  }

  getCurrentMapData(): MapData | null {
    return this.currentMapData;
  }

  /**
   * Returns whether the cell at `cellId` blocks line-of-sight (walls,
   * decorations, glass cells with `lineOfSight=false`). Used by spell
   * targeting to gate which cells the caster can see.
   */
  isCellLosBlocked(cellId: number): boolean {
    const cell = this.cellDataMap.get(cellId);
    if (!cell) {
      // Out-of-map cells are blocking by definition; the LoS walker
      // also short-circuits on out-of-bounds, so this is a safe
      // fallback when the map isn't loaded yet.
      return true;
    }
    return cell.lineOfSight === false;
  }

  /**
   * Toggle the tactical view: swap per-cell ground/layer1/layer2 IDs to the
   * extracted gfx.tactic sprites (walkable/blocked/LOS markers) and re-render
   * through the atlas pipeline. Mirrors the AS `MapHandler.tacticMode()`
   * semantics; falls back to a no-op when no map or map handler is ready.
   */
  async setTacticalMode(enabled: boolean): Promise<void> {
    if (
      this.tacticalMode === enabled ||
      !this.mapHandler ||
      !this.currentMapData ||
      !this.mapContainer
    ) {
      return;
    }
    this.tacticalMode = enabled;

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    const viewport = this.getViewport();

    if (enabled) {
      await this.mapHandler.enterTacticMode(
        this.currentMapData,
        this.mapContainer,
        zoom,
        viewport
      );
    } else {
      await this.mapHandler.exitTacticMode(
        this.currentMapData,
        this.mapContainer,
        zoom,
        viewport
      );
    }

    this.pickingSystem?.markDirty();
  }

  isTacticalMode(): boolean {
    return this.tacticalMode;
  }

  async loadManifest(): Promise<void> {
    if (!this.atlasLoader) {
      return;
    }

    this.mapHandler = new MapHandler({
      atlasLoader: this.atlasLoader,
      interactiveGfxIds: this.interactiveGfxIds,
      scene: this.scene,
      pixiRenderer: this.app?.renderer,
      ticker: this.app?.ticker,
      onSpriteCreated: (
        sprite,
        tileId,
        cellId,
        layer,
        rotation,
        flip,
        groundSlope
      ) => {
        if (layer > 0 && this.isInteractiveTile(tileId)) {
          this.picking.registerTile(sprite, tileId);
        }

        // Register sprite with debug overlay
        if (this.debugOverlay) {
          const type = layer === 0 ? "ground" : "objects";
          this.debugOverlay.registerSprite({
            sprite,
            tileId,
            cellId,
            layer,
            type,
            rotation,
            flip,
            groundSlope,
          });
        }
      },
    });

    // DevTools stress-test hooks. Expose as window globals so the
    // renderer + accessory pipeline can be exercised with N random
    // players via the console:
    //
    //   await spawnTestPlayers(20)
    //   despawnTestPlayers()
    //   __renderHalt()       — manual emergency stop
    //   __renderResume()     — clear halt
    if (typeof window !== "undefined") {
      const { spawnTestPlayers, despawnTestPlayers, getTestPlayerCount } =
        await import("@/game/scene/battlefield/stress-test");
      const { getRenderWatchdog } = await import(
        "@/game/render/render-watchdog"
      );
      const w = window as unknown as {
        spawnTestPlayers?: (n: number) => Promise<number[]>;
        despawnTestPlayers?: () => number;
        __renderHalt?: () => void;
        __renderResume?: () => void;
        __getTestPlayerCount?: () => number;
        __pathCacheStats?: () => unknown;
        __clearPathCache?: () => void;
      };
      w.spawnTestPlayers = async (n: number) => {
        const renderer = this.worldActors?.getRenderer() ?? null;
        const cells = this.currentMapData?.cells ?? [];
        if (!renderer) {
          throw new Error(
            "spawnTestPlayers: no PlayerRenderer (load a map first)"
          );
        }
        if (!this.pathfinding) {
          throw new Error(
            "spawnTestPlayers: no DofusPathfinding (load a map first)"
          );
        }
        return spawnTestPlayers(n, renderer, cells, this.pathfinding);
      };
      w.despawnTestPlayers = () => {
        const renderer = this.worldActors?.getRenderer() ?? null;
        if (!renderer) return 0;
        return despawnTestPlayers(renderer);
      };
      w.__renderHalt = () => getRenderWatchdog().emergencyHalt();
      w.__renderResume = () => getRenderWatchdog().resume();
      w.__getTestPlayerCount = () => getTestPlayerCount();
      // Path-cache observability hooks. Console:
      //   __pathCacheStats() → { bundleCacheCount, sceneCacheCount, sceneBytesEstimate }
      //   __clearPathCache() → drop both caches (memory-pressure recovery).
      const { getPathCacheStats, clearPathCache } =
        await import("@/game/render/vello-loader");
      w.__pathCacheStats = () => getPathCacheStats();
      w.__clearPathCache = () => clearPathCache();
      // Boot-time safe mode escape hatch. Crash → reboot → run
      // `__safeMode()` in console → reload (or close+reopen) → app
      // boots halted, no Vello work, React HUD stays alive so the dev
      // can investigate without re-triggering the GPU storm.
      // Reverse with `__normalMode()` + reload.
      const w2 = window as unknown as {
        __safeMode?: () => void;
        __normalMode?: () => void;
      };
      w2.__safeMode = () => {
        try {
          localStorage.setItem("dofus.gpuSafeMode", "1");
          // eslint-disable-next-line no-console
          console.warn(
            "[safeMode] enabled. Reload (or close+reopen) to boot in halted state. Use __normalMode() to revert."
          );
        } catch {
          // localStorage unavailable — best effort.
        }
      };
      w2.__normalMode = () => {
        try {
          localStorage.removeItem("dofus.gpuSafeMode");
          // eslint-disable-next-line no-console
          console.info("[safeMode] cleared. Reload to boot normally.");
        } catch {
          // ignore
        }
      };

      // Wire the watchdog's test-player counter so the React HUD shows
      // a live count without re-importing the stress-test module.
      getRenderWatchdog().setStatsProvider({
        testPlayerCount: () => getTestPlayerCount(),
      });

      // E = throw ONE "Fée d'artifice invocatrice de cœurs" at the
      // cursor. Ignored while typing in inputs so chat / search fields
      // don't trigger it. Bound here (not in InteractionHandler)
      // because it's a global document key, not a canvas-scoped
      // pointer event — but the cursor position comes from a
      // mousemove tracker since keydown carries no mouse coords.
      const { spawnFeeCoeurAt } = await import("@/game/render/fee-coeur");
      this.boundOnMouseMove = (e: MouseEvent) => {
        this.lastClientMouseX = e.clientX;
        this.lastClientMouseY = e.clientY;
      };
      document.addEventListener("mousemove", this.boundOnMouseMove);
      this.boundOnKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "e" && e.key !== "E") return;
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target?.isContentEditable
        ) {
          log.info("[fee-coeur] E pressed but ignored (typing in input)");
          return;
        }
        if (
          !this.mapContainer ||
          !this.app ||
          this.lastClientMouseX < 0
        ) {
          log.warn(
            `[fee-coeur] E pressed but not ready: mapContainer=${!!this.mapContainer} app=${!!this.app} mouseX=${this.lastClientMouseX}`,
          );
          return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = this.lastClientMouseX - rect.left;
        const canvasY = this.lastClientMouseY - rect.top;
        const zoom = this.mapContainer.scale.x || 1;
        const worldX = (canvasX - this.mapContainer.x) / zoom;
        const worldY = (canvasY - this.mapContainer.y) / zoom;
        log.info(
          `[fee-coeur] spawning at world=(${worldX.toFixed(1)}, ${worldY.toFixed(1)}) canvas=(${canvasX.toFixed(0)}, ${canvasY.toFixed(0)}) zoom=${zoom.toFixed(2)}`,
        );
        void spawnFeeCoeurAt({
          container: this.mapContainer,
          app: this.app,
          x: worldX,
          y: worldY,
        }).then((ok) => {
          log.info(`[fee-coeur] spawn returned ${ok}`);
        });
      };
      document.addEventListener("keydown", this.boundOnKeyDown);
      log.info("[fee-coeur] keydown listener wired (press E over the map)");

      // Memory snapshot probe — call `__memSnapshot()` from DevTools to
      // dump every tracked counter + JS heap. Returns the snapshot
      // object so it can be diff'd against a stored prior snapshot.
      const wm = window as unknown as {
        __memSnapshot?: () => MemSnapshot;
      };
      wm.__memSnapshot = () => {
        const snap = takeMemSnapshot(this.memSources());
        // eslint-disable-next-line no-console
        console.log("[memSnapshot]", formatMemSnapshot(snap));
        return snap;
      };
    }
  }

  /** Build the source bag used by `takeMemSnapshot` and the window helper. */
  private memSources(): MemSources {
    return {
      atlasLoader: this.atlasLoader,
      tileSpriteRenderer: this.mapHandler?.getTileSpriteRenderer() ?? null,
      playerStripRenderer: this.playerStripRenderer,
      pickingSystem: this.pickingSystem,
    };
  }

  async loadMapFromData(
    mapData: MapData,
    direction?: TransitionDirection
  ): Promise<void> {
    if (
      !this.mapContainer ||
      !this.mapHandler ||
      !this.atlasLoader ||
      !this.app
    ) {
      return;
    }

    // Snapshot every tracked counter BEFORE map cleanup runs. We log a
    // diff at the end so per-map growth shows up as a one-line report
    // in the dev console; consistently-non-zero deltas across multiple
    // map changes are the canonical leak signature.
    const memBefore: MemSnapshot = takeMemSnapshot(this.memSources());

    // Non-blocking snapshot of the old map; new tiles render behind it.
    this.mapTransition?.startTransition(direction);

    this.currentMapData = mapData;
    this.cellDataMap.clear();

    for (const cell of mapData.cells) {
      this.cellDataMap.set(cell.id, cell);
    }

    // PlayerRenderer caches mapWidth at construction. Without this
    // push, non-default-size maps animate sprites on the previous
    // map's grid (cell→pixel uses width-based brick stride), so the
    // sprite "runs everywhere" after a teleport / zaap.
    this.worldActors.setMapDimensions(mapData.width);

    this.mapContainer.x = 0;
    this.mapContainer.y = 0;

    this.picking.clearTiles();
    // Drop alpha-map cache for sources from the prior map. Each cached
    // entry holds a Uint8Array of pixel-alpha data (1-3MB per character
    // sprite source); without this clear they accumulate forever
    // because TextureSource uids are monotonic — old uids never reappear.
    this.pickingSystem?.clearAlphaCache();
    // Drop the atlas-loader's per-tile GPU sources, static-base textures,
    // frame-strip cache, and animation metadata accumulated by the prior
    // map + its prefetched neighbours. Without this, every Pixi
    // `ExternalSource` (autoGarbageCollect=false) and its wasm wgpu
    // texture stay pinned both Pixi-side and inside `VelloRenderer.textures`,
    // so RAM climbs ~hundreds of MB per map walk. clearCache() retires
    // both via the existing 250ms+2rAF deferred-destroy path
    // (`freeRenderTexture`). The active tile pipeline (TileSpriteRenderer)
    // has its own refcounted cache and is unaffected.
    this.atlasLoader.clearCache();
    this.debugOverlay?.clear();
    this.gridOverlay?.clear();

    // Drop any stale tactic state from the prior map so the fresh render
    // uses the normal ground_/objects_ prefixes. Re-applied below if the
    // player was in tactic mode before the transition.
    this.mapHandler.clearTacticState();

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    this.atlasLoader.setZoom(zoom);
    // Drain the character-sprite cache on map change. Each map has a
    // distinct NPC roster; without this drain the cache grows
    // unbounded across map transitions and accumulated wgpu textures
    // (re-created per look × per anim × per zoom) push the macOS
    // compositor past the WindowServer watchdog threshold after a few
    // map walks — the canonical "rebooted 10 times" symptom.
    // Re-rendering on demand is fast since the SWF bundles stay
    // loaded in WASM (per `feedback_no_animation_preload`).
    this.characterSpriteLoader.clearForMapChange();
    this.characterSpriteLoader.setZoom(zoom);
    await this.mapHandler.renderMap(
      mapData,
      this.mapContainer,
      zoom,
      this.getViewport()
    );

    this.positionGridBelowObject2();

    this.gridOverlay?.setMapData(
      mapData.cells,
      mapData.width,
      mapData.height,
      mapData.triggerCellIds ?? []
    );
    this.debugOverlay?.setMapData(mapData.cells, mapData.width, mapData.height);

    // Tactic mode survives map changes: once the fresh terrain is drawn,
    // re-apply the tactic rewrite so a mid-fight teleport keeps the player
    // in the tactic view they toggled into.
    if (this.tacticalMode) {
      await this.mapHandler.enterTacticMode(
        mapData,
        this.mapContainer,
        zoom,
        this.getViewport()
      );
    }
    // Map is ready — world actor container gets re-created on MAP_ACTORS.

    // After-map-change snapshot. Reports only positive deltas (growth) —
    // the goal is "this map change leaked X" not "after the change we
    // have Y total". Empty report means the per-map invariant held.
    const memAfter = takeMemSnapshot(this.memSources());
    const diff = diffMemSnapshot(memBefore, memAfter);
    const leakReport = formatLeakReport(diff);
    if (leakReport !== "(no growth)") {
      log.info(`[mem] map=${mapData.id} grew: ${leakReport}`);
    }
  }

  /**
   * Slot the grid overlay between Object1 and Object2 layers.
   * Mirrors ExternalContainer.as original depths: Ground=200, Object1=300,
   * Grid=400, Object2=800 — grid sits above walkable tiles, below foreground.
   */
  private positionGridBelowObject2(): void {
    if (!this.gridOverlay || !this.mapContainer) {
      return;
    }

    const gridContainer = this.gridOverlay.getContainer();

    // mapContainer.sortableChildren is on and every root layer
    // (including the grid) has an explicit zIndex, so order is
    // determined by those indices. We only need to make sure the
    // grid container IS a child of mapContainer.
    if (!this.mapContainer.children.includes(gridContainer)) {
      this.mapContainer.addChild(gridContainer);
    }
  }

  /**
   * Prepare world actors for the new map.
   * Destroys old actor container + renderer and creates fresh ones.
   * Called by GameClient right before adding MAP_ACTORS.
   */
  prepareWorldActors(): void {
    this.worldActors.reset();
  }

  /**
   * Reveal the map container after map + actors are ready.
   * Called by GameClient after MAP_ACTORS have been added.
   * Crossfades old snapshot out while unblurring the new map.
   */
  async revealMap(): Promise<void> {
    await this.mapTransition?.reveal();
  }

  /**
   * Load adjacent map data into the cache for background prefetching.
   */
  loadAdjacentMaps(
    maps: Array<{ mapId: number; dx: number; dy: number; mapData: MapData }>
  ): void {
    this.adjacentMapCache?.loadAdjacentMaps(maps);
  }

  /**
   * Get the transition direction for a target map from the adjacent cache.
   */
  getAdjacentDirection(mapId: number): TransitionDirection | null {
    return this.adjacentMapCache?.getDirection(mapId) ?? null;
  }

  /** Set the player character ID (used for tracking). */
  setDebugPlayerId(_id: number): void {
    // Reserved for future use
  }

  setPathfinding(pathfinding: DofusPathfinding | null): void {
    this.pathfinding = pathfinding;
  }

  /** Accessor for callers who need to compute paths against the
   *  current map (e.g. GameSession when resolving a cell click). */
  getPathfinding(): DofusPathfinding | null {
    return this.pathfinding;
  }

  // ============================================================================
  // World Actor Methods (Roleplay Mode)
  // ============================================================================

  addWorldActor(data: WorldActorData): Promise<void> {
    return this.worldActors.add(data);
  }

  /**
   * Public handle on the world-actor PlayerRenderer — the renderer that
   * actually holds every on-screen fighter during combat. Callers who
   * need per-fighter cell lookups (e.g. resolving the caster cell for a
   * spell animation) should go through this rather than the empty
   * FightUI PlayerRenderer.
   */
  getWorldActorRenderer() {
    return this.worldActors.getRenderer();
  }

  /** Look changes on equip/unequip re-render the actor with new accessories. */
  updateActorLook(id: number, look: string): void {
    this.worldActors.updateLook(id, look);
  }

  removeWorldActor(id: number): void {
    this.worldActors.remove(id);
  }

  moveWorldActor(id: number, path: number[]): Promise<void> {
    return this.worldActors.move(id, path);
  }

  /** Snap an actor to a cell without animating. Used by the GIC
   *  handler when the server pushes placement / coord changes that
   *  carry no movement path. */
  teleportWorldActor(id: number, cellId: number): void {
    this.worldActors.teleport(id, cellId);
  }

  clearWorldActors(): void {
    this.worldActors.clear();
  }

  private async loadInteractiveObjects(): Promise<void> {
    try {
      const response = await fetch("/assets/data/interactive-objects.json");
      const data = await response.json();

      const interactiveObjects = data.interactiveObjects || {};

      for (const obj of Object.values(
        interactiveObjects
      ) as InteractiveObjectData[]) {
        if (obj.gfxIds && Array.isArray(obj.gfxIds)) {
          for (const gfxId of obj.gfxIds) {
            this.interactiveGfxIds.add(gfxId);
            this.interactiveObjectsData.set(gfxId, obj);
          }
        }
      }
    } catch (error) {
      log.error("Failed to load interactive objects:", error);
    }
  }

  private isInteractiveTile(tileId: number): boolean {
    return this.interactiveGfxIds.has(tileId);
  }

  /**
   * Get the current viewport bounds in map coordinates for culling
   */
  private getViewport(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    if (!this.mapContainer || !this.app) {
      return null;
    }

    const zoom = this.interactionHandler?.getZoom() ?? this.engine.getZoom();
    const containerX = this.mapContainer.x;
    const containerY = this.mapContainer.y;
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;

    // Convert screen bounds to map coordinates
    return {
      x: -containerX / zoom,
      y: -containerY / zoom,
      width: screenWidth / zoom,
      height: screenHeight / zoom,
    };
  }

  // Called via BattlefieldBootstrapContext from the interaction handler.
  handleGroundClick(mapX: number, mapY: number): void {
    if (!this.currentMapData) {
      return;
    }

    const mapScale = computeMapScale(
      this.currentMapData.width,
      this.currentMapData.height
    );
    const cell = findCellAtPosition(
      mapX,
      mapY,
      this.currentMapData.cells,
      this.currentMapData.width,
      mapScale
    );

    if (cell?.walkable) {
      this.onCellClickCallback?.(cell.id);
    }
  }

  setOnCellClick(callback: (cellId: number) => void): void {
    this.onCellClickCallback = callback;
  }

  // Called via BattlefieldBootstrapContext. Resolves the cell under the
  // cursor once per pointermove tick and fans out to the registered
  // hover callback only when the cell ID actually changes — subscribers
  // don't want N calls per second for the same cell.
  handleGroundHover(mapX: number, mapY: number): void {
    if (!this.currentMapData) {
      return;
    }
    const mapScale = computeMapScale(
      this.currentMapData.width,
      this.currentMapData.height
    );
    const cell = findCellAtPosition(
      mapX,
      mapY,
      this.currentMapData.cells,
      this.currentMapData.width,
      mapScale
    );
    const cellId = cell?.walkable ? cell.id : null;
    if (cellId === this.lastHoveredCellId) {
      return;
    }
    this.lastHoveredCellId = cellId;
    // Canonical hover hit area for fighters is the FULL diamond cell
    // they stand on (`%1D%11%1C.as:162` attaches `onRollOver` to each
    // `InteractionCell` MovieClip, not to the fighter sprite). Drive
    // the picking system's via-cell fighter hover off the same event
    // so a sprite-pixel miss next to the fighter still triggers the
    // hover effects — but ONLY in combat. Outside combat the world
    // map's regular sprite-pixel hover is canonical (the cell-level
    // InteractionCell only existed in fight scenes), and firing
    // `setHoverByCell` from the world map double-triggers the same
    // sprite hover from a coarser hitbox, breaking the hover feel
    // for nearby NPCs / interactive objects.
    const fightActive =
      this.lastFightMode === "placement" ||
      this.lastFightMode === "fighting" ||
      this.lastFightMode === "spectating";
    if (fightActive) {
      this.picking.setHoverByCell(cellId);
    } else {
      // Make sure no stale via-cell hover lingers from the last fight.
      this.picking.setHoverByCell(null);
    }
    this.onCellHoverCallback?.(cellId);
  }

  setOnCellHover(callback: (cellId: number | null) => void): void {
    this.onCellHoverCallback = callback;
  }

  /**
   * Hover-on-self callback. Fires `true` when the user rolls over their
   * own avatar in fight mode and `false` on roll-out. Mirrors canonical
   * Sprite._rollOver / _rollOut so consumers (e.g. MP-range overlay)
   * only paint while the user is actually pointing at their fighter.
   */
  setOnSelfHover(callback: (hovered: boolean) => void): void {
    this.picking.setOnSelfHover(callback);
  }

  getApp(): Application | null {
    return this.app;
  }

  getBaseZoom(): number {
    return this.engine.getBaseZoom();
  }

  handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  destroy(): void {
    if (this.boundOnKeyDown) {
      document.removeEventListener("keydown", this.boundOnKeyDown);
      this.boundOnKeyDown = null;
    }
    if (this.boundOnMouseMove) {
      document.removeEventListener("mousemove", this.boundOnMouseMove);
      this.boundOnMouseMove = null;
    }
    // Drop any in-flight fée-cœur sprites so their Pixi children don't
    // outlive the scene's mapContainer.
    void import("@/game/render/fee-coeur").then(({ clearFeeCoeur }) =>
      clearFeeCoeur()
    );

    // Clean up map transition and adjacent cache
    this.mapTransition?.destroy();
    this.mapTransition = null;
    this.adjacentMapCache?.destroy();
    this.adjacentMapCache = null;

    this.zoom.destroy();
    hideContextMenu();

    if (this.sceneTickerCallback) {
      Ticker.shared.remove(this.sceneTickerCallback);
      this.sceneTickerCallback = null;
    }

    this.scene.clear();

    this.fightActorUnsubscribe?.();
    this.fightActorUnsubscribe = null;
    this.tacticalUnsubscribe?.();
    this.tacticalUnsubscribe = null;

    this.fightUI?.destroy();
    this.fightUI = null;

    this.rendererRegistry.clear();

    // World actor container is objectLayer2 owned by mapHandler; we just drop the renderer.
    this.worldActors.destroy();

    this.debugOverlay?.destroy();
    this.debugOverlay = null;
    this.gridOverlay?.destroy();
    this.gridOverlay = null;

    this.interactionHandler?.destroy();
    this.pickingSystem?.destroy();
    this.atlasLoader?.clearCache();
    this.mapHandler?.clearCache();

    // Strip renderer owns per-player sprites + their wgpu textures.
    this.playerStripRenderer?.destroy();
    this.playerStripRenderer = null;

    // The canvas is owned by the React component and remains in the
    // DOM until the parent unmounts. Read once to satisfy TS noUnused.
    void this.canvas;

    this.engine.destroy();
  }

  toggleDebug(): boolean {
    return this.debugOverlay?.toggle() ?? false;
  }

  toggleGridOverlay(): boolean {
    return this.gridOverlay?.toggle() ?? false;
  }

  toggleTransparency(): boolean {
    this.transparencyMode = !this.transparencyMode;
    this.applyTransparencyMode();
    return this.transparencyMode;
  }

  private applyTransparencyMode(): void {
    // Ghost view boosts player zIndex above Object2 + reduces alpha; off → cell-depth interleave.
    this.worldActors.getRenderer()?.setGhostView(this.transparencyMode);
  }

  // Only getPlayerRenderer is reachable externally; the rest of the
  // fight API lives on FightUI directly.

  getPlayerRenderer(): PlayerRenderer | null {
    return this.fightUI?.getPlayerRenderer() ?? null;
  }
}
