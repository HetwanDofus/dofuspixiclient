import type { Container } from "pixi.js";

import type { MapData } from "@/game/datacenter/map";
import type { AtlasLoader } from "@/game/render/atlas-loader";
import type { MapHandler } from "@/game/scene/map/handler";
import { createLogger } from "@/utils/logger";

const log = createLogger("BattlefieldZoom");

/** Debounce window before a zoom change triggers a render. */
const DEBOUNCE_MS = 100;

/** Floating-point tolerance for detecting "zoom didn't really change". */
const ZOOM_EPSILON = 0.001;

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BattlefieldZoomDeps {
  mapHandler(): MapHandler | null;
  mapContainer(): Container | null;
  atlasLoader(): AtlasLoader | null;
  currentMapData(): MapData | null;
  getViewport(): Viewport | null;
  onBeforeRebuild(): void;
  onAfterRender(zoom: number): void;
}

/**
 * Handles zoom-change debouncing and the texture-swap-or-rebuild decision tree.
 *
 * Incoming zoom changes are debounced so the user can scroll the wheel freely
 * without triggering a render storm. When a render fires, we try the cheap
 * texture-swap path first (reuses existing Pixi sprites); only fall back to a
 * full MapHandler rebuild if the swap fails.
 *
 * Re-entrancy: if a zoom request arrives while a render is in flight, we stash
 * it as `pendingZoom` and process it right after the in-flight render finishes.
 */
export class BattlefieldZoom {
  private isRendering = false;
  private pendingZoom: number | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: BattlefieldZoomDeps) {}

  /** External entry — call when the user requests a new zoom level. */
  request(zoom: number): void {
    this.pendingZoom = zoom;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;

      if (this.pendingZoom !== null) {
        void this.execute(this.pendingZoom);
        this.pendingZoom = null;
      }
    }, DEBOUNCE_MS);
  }

  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Force-apply a zoom immediately (bypassing debounce + epsilon checks).
   * Used by the resize-end handler, where the pixel-level resolution changed
   * even though the zoom number didn't.
   */
  async forceRender(zoom: number): Promise<void> {
    await this.execute(zoom, { bypassEpsilon: true });
  }

  private async execute(
    zoom: number,
    { bypassEpsilon = false }: { bypassEpsilon?: boolean } = {}
  ): Promise<void> {
    const mapData = this.deps.currentMapData();
    const mapHandler = this.deps.mapHandler();
    const mapContainer = this.deps.mapContainer();
    const atlasLoader = this.deps.atlasLoader();

    if (!mapData || !mapHandler || !mapContainer || !atlasLoader) {
      return;
    }

    if (this.isRendering) {
      this.pendingZoom = zoom;
      return;
    }

    if (
      !bypassEpsilon &&
      Math.abs(atlasLoader.getZoom() - zoom) <= ZOOM_EPSILON
    ) {
      return;
    }

    this.isRendering = true;

    try {
      if (mapHandler.hasSpriteRefs()) {
        log.debug("Texture-swap zoom:", zoom);
        mapContainer.scale.set(zoom);

        if (await mapHandler.updateTexturesForZoom(zoom)) {
          return;
        }
        // Texture swap failed — fall through to full rebuild.
      }

      atlasLoader.setZoom(zoom);
      log.debug("Full re-render at zoom:", zoom);

      this.deps.onBeforeRebuild();
      mapHandler.clearCache();

      await mapHandler.renderMap(
        mapData,
        mapContainer,
        zoom,
        this.deps.getViewport()
      );
    } catch (error) {
      log.error("Render error:", error);
    } finally {
      this.isRendering = false;
      this.deps.onAfterRender(zoom);

      if (this.pendingZoom !== null && this.pendingZoom !== zoom) {
        const nextZoom = this.pendingZoom;
        this.pendingZoom = null;
        // Break the call stack to avoid deep recursion.
        setTimeout(() => void this.execute(nextZoom), 0);
      }
    }
  }
}
