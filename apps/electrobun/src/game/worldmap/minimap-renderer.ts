import type { Application } from "pixi.js";
import {
  Container,
  ImageSource,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";

import {
  loadHintsBundle,
  loadWorldmapBundle,
  renderHintIcon,
  renderWorldmapChunk,
} from "@/game/render/worldmap-swf-renderer";
import { uploadAndCloseBitmap } from "@/game/render/vello-loader";
import type {
  HintsLayering,
  MapCoordinates,
  WorldMapManifest,
} from "@/game/types/worldmap";
import { WORLDMAP_CONSTANTS } from "@/game/types/worldmap";
import {
  filterHintsByArea,
  findMapAtCoord,
  loadWorldMapData,
  mapCoordToPixel,
  pixelToMapCoord,
} from "@/game/worldmap/world-map-data";

interface MinimapRendererConfig {
  app: Application;
  parentContainer?: Container;
  centerOnMapId?: number;
  centerOnCoordinates?: { x: number; y: number };
}

export class MinimapRenderer {
  /**
   * The slot's Pixi renderer (the secondary Application that
   * `usePixiSlot` mounts into the banner-circle viewport). Passed to
   * `ExternalSource({ renderer })` so the wrapper texture is bound to
   * the same Pixi instance that will draw the sprite — using
   * `getPixiRenderer()` here would wire the texture to the main
   * battlefield app instead, which never reads it.
   */
  private worldContainer: Container;
  private mapContainer: Container;
  private hintsContainer: Container;
  private positionMarker: Graphics;

  private manifest: WorldMapManifest | null = null;
  private hintsLayering: HintsLayering | null = null;
  private mapCoordinates: MapCoordinates | null = null;

  private currentSuperarea = 0;

  /**
   * One sprite + ExternalSource + Vello GPUTexture per worldmap chunk.
   * Texture lifetime is hand-managed — we own the textureId returned by
   * `renderWorldmapChunk` and MUST call `freeRenderTexture` on destroy
   * (patched wgpu's `Drop for WebTexture` is a no-op; see
   * `feedback_pixi_wgpu_texture_lifetime`).
   */
  private tileSprites: Sprite[] = [];
  private hintSprites: Sprite[] = [];

  private centerMapId?: number;
  private initialCenterCoordinates?: { x: number; y: number };
  private animationFrame: number | null = null;

  constructor(config: MinimapRendererConfig) {
    this.centerMapId = config.centerOnMapId;
    this.initialCenterCoordinates = config.centerOnCoordinates;

    this.worldContainer = new Container();
    this.mapContainer = new Container();
    this.hintsContainer = new Container();
    this.positionMarker = new Graphics();

    this.worldContainer.addChild(this.mapContainer);
    this.worldContainer.addChild(this.positionMarker);
    this.worldContainer.addChild(this.hintsContainer);

    const parent = config.parentContainer ?? config.app.stage;
    parent.addChild(this.worldContainer);
  }

  async loadWorldMap(superarea: number = 0): Promise<void> {
    this.currentSuperarea = superarea;

    const [data] = await Promise.all([
      loadWorldMapData(superarea),
      loadWorldmapBundle(superarea),
      loadHintsBundle(),
    ]);
    this.manifest = data.manifest;
    this.hintsLayering = data.hintsLayering;
    this.mapCoordinates = data.mapCoordinates;

    this.renderMap();
    this.renderHints();

    if (this.centerMapId && this.mapCoordinates) {
      this.centerOnMap(this.centerMapId);
    } else if (this.initialCenterCoordinates) {
      this.centerOnCoordinates(
        this.initialCenterCoordinates.x,
        this.initialCenterCoordinates.y
      );
    }
  }

  /**
   * Walk the chunk bounds rect and emit one Pixi sprite per declared
   * `X_Y` export in the worldmap SWF. Missing exports (ocean cells,
   * unmapped regions) return null from `renderWorldmapChunk` and are
   * silently skipped.
   *
   * Resolution=1 matches the SWF's native 742×432 chunk size — the
   * banner-circle viewport is small (~80 px diameter) and we further
   * downscale via the viewport's `scale = 0.5`, so a 1:1 chunk render
   * is sampled DOWN at composition time (smooth linear filter handled
   * by the GPU). The full minimap covers ~9×12 chunks for Amakna; at
   * resolution 1 that's ~6678×5184 GPU pixels distributed across
   * sprites — bounded and acceptable.
   */
  private renderMap(): void {
    if (!this.manifest) {
      return;
    }
    this.disposeTileSprites();

    const { DISPLAY_WIDTH, DISPLAY_HEIGHT } = WORLDMAP_CONSTANTS;
    const { bounds } = this.manifest;

    for (let cx = bounds.xMin; cx <= bounds.xMax; cx++) {
      for (let cy = bounds.yMin; cy <= bounds.yMax; cy++) {
        const result = renderWorldmapChunk(this.currentSuperarea, cx, cy, 1);
        if (!result) {
          continue;
        }
        const source = new ImageSource({
          resource: result.bitmap,
          width: result.width,
          height: result.height,
          label: `worldmap-${this.currentSuperarea}-${cx}_${cy}`,
          alphaMode: "premultiply-alpha-on-upload",
          scaleMode: "linear",
          autoGarbageCollect: false,
        });
        // Minimap has its own Pixi app — no easy renderer ref here.
      // Fall back to destroy-event close (bitmap stays alive until
      // the chunk source is destroyed by map navigation). Worldmap
      // chunks are long-lived and few; memory cost is bounded.
      uploadAndCloseBitmap(null, source, result.bitmap);

        // Vello wraps every render with a 1-px transparent AA pad on
        // each side (rust/vello-wasm/src/lib.rs:801). A Pixi `frame`
        // Rectangle does NOT clamp the GPU sampler — at the sprite's
        // edge the linear filter still samples on a half-texel
        // boundary that straddles the last content pixel and the pad
        // pixel one over, dropping seam alpha to ~50% and producing
        // visible "separation lines" between chunks. The fix is to
        // inset the frame by an *additional* half-texel on every
        // side so the sampler at sprite UV (0, 0) reads the content
        // texel's CENTER (continuous source 1.5) rather than its
        // boundary (continuous source 1.0).
        const AA_PAD = 1;
        const HALF_TEXEL = 0.5;
        const inset = AA_PAD + HALF_TEXEL;
        const contentW = Math.max(1, result.width - 2 * inset);
        const contentH = Math.max(1, result.height - 2 * inset);
        const texture = new Texture({
          source,
          frame: new Rectangle(inset, inset, contentW, contentH),
        });
        const sprite = new Sprite(texture);
        // SWF (0,0) sits at source texel (anchorX, anchorY). After the
        // half-texel inset crop, the SWF origin is at frame-relative
        // (anchorX - inset, anchorY - inset). For chunks where the SWF
        // origin is at the bbox top-left (texel (1, 1)) this evaluates
        // to (-0.5, -0.5) — a negative anchor, which Pixi handles
        // (places the SWF origin half a source-pixel to the upper-left
        // of `sprite.x/y`). The half-pixel shift is consistent across
        // every chunk so tiling alignment is preserved; the absolute
        // worldmap origin just shifts by ~0.5 display px.
        sprite.anchor.set(
          (result.anchorX - inset) / contentW,
          (result.anchorY - inset) / contentH,
        );
        sprite.x = (cx - bounds.xMin) * DISPLAY_WIDTH;
        sprite.y = (cy - bounds.yMin) * DISPLAY_HEIGHT;
        // Force the sprite to display at exactly DISPLAY_WIDTH ×
        // DISPLAY_HEIGHT — the half-texel inset shrunk the frame by
        // 1 source px in each axis, so without this override the
        // sprite would render 1 display px short and leave a visible
        // gap between neighbouring chunks. With the override Pixi
        // scales the frame by ~1.0017× (imperceptible) and chunks
        // tile pixel-perfect at integer DISPLAY_WIDTH boundaries.
        sprite.width = DISPLAY_WIDTH;
        sprite.height = DISPLAY_HEIGHT;

        this.tileSprites.push(sprite);
        this.mapContainer.addChild(sprite);
      }
    }
  }

  private renderHints(): void {
    if (!this.hintsLayering || !this.manifest) {
      return;
    }

    this.disposeHintSprites();

    const { bounds } = this.manifest;
    const enabledCategories = new Set<number>([1, 2, 3, 4, 5, 6]);

    const filteredHints = filterHintsByArea(
      this.hintsLayering,
      this.mapCoordinates ?? {},
      enabledCategories,
      this.currentSuperarea
    );

    const targetSize = 30;

    for (const { overlay, hint } of filteredHints) {
      const result = renderHintIcon(hint.gfxID, 1);
      if (!result) {
        continue;
      }
      const source = new ImageSource({
        resource: result.bitmap,
        width: result.width,
        height: result.height,
        label: `hint-${hint.gfxID}`,
        alphaMode: "premultiply-alpha-on-upload",
        scaleMode: "linear",
        autoGarbageCollect: false,
      });
      // Minimap has its own Pixi app — no easy renderer ref here.
      // Fall back to destroy-event close (bitmap stays alive until
      // the chunk source is destroyed by map navigation). Worldmap
      // chunks are long-lived and few; memory cost is bounded.
      uploadAndCloseBitmap(null, source, result.bitmap);
      // Same half-texel inset as the chunk path. See the chunk render
      // for the full rationale: a plain `frame` crop leaves the linear
      // sampler bleeding into the AA pad on UV (0, 0) / (1, 1); insetting
      // by +0.5 source pixels parks sampling at content texel centres.
      const AA_PAD = 1;
      const HALF_TEXEL = 0.5;
      const inset = AA_PAD + HALF_TEXEL;
      const contentW = Math.max(1, result.width - 2 * inset);
      const contentH = Math.max(1, result.height - 2 * inset);
      const texture = new Texture({
        source,
        frame: new Rectangle(inset, inset, contentW, contentH),
      });
      const sprite = new Sprite(texture);
      // SWF (0,0) is the hint's authored pin. After the half-texel
      // inset crop, the pin sits at frame-relative
      // (anchorX - inset, anchorY - inset). Normalize to 0..1 anchor
      // space so `sprite.x/y` lands the pin on the map cell centre.
      sprite.anchor.set(
        (result.anchorX - inset) / contentW,
        (result.anchorY - inset) / contentH,
      );

      const [pixelX, pixelY] = mapCoordToPixel(
        overlay.x,
        overlay.y,
        bounds.xMin,
        bounds.yMin
      );
      sprite.x = pixelX;
      sprite.y = pixelY;

      const maxDim = Math.max(contentW, contentH);
      const hintScale = maxDim > 0 ? targetSize / maxDim : 1;
      sprite.scale.set(hintScale);

      this.hintSprites.push(sprite);
      this.hintsContainer.addChild(sprite);
    }
  }

  centerOnMap(mapId: number, animate = false): void {
    if (!this.mapCoordinates || !this.manifest) {
      return;
    }

    const mapCoord = this.mapCoordinates[mapId.toString()];

    if (!mapCoord) {
      return;
    }

    const { bounds } = this.manifest;
    const [pixelX, pixelY] = mapCoordToPixel(
      mapCoord.x,
      mapCoord.y,
      bounds.xMin,
      bounds.yMin
    );

    if (animate) {
      this.animateCenter(pixelX, pixelY);
    } else {
      this.applyCenter(pixelX, pixelY);
    }
  }

  centerOnCoordinates(x: number, y: number): void {
    if (!this.manifest) {
      return;
    }

    const { bounds } = this.manifest;
    const [pixelX, pixelY] = mapCoordToPixel(x, y, bounds.xMin, bounds.yMin);

    this.applyCenter(pixelX, pixelY);
  }

  private applyCenter(pixelX: number, pixelY: number): void {
    this.worldContainer.x = -pixelX;
    this.worldContainer.y = -pixelY;
    this.drawPositionMarker(pixelX, pixelY);
  }

  private animateCenter(targetX: number, targetY: number): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    const startX = -this.worldContainer.x;
    const startY = -this.worldContainer.y;
    const startTime = performance.now();
    const duration = 300;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) ** 3;

      const currentX = startX + (targetX - startX) * eased;
      const currentY = startY + (targetY - startY) * eased;

      this.worldContainer.x = -currentX;
      this.worldContainer.y = -currentY;
      this.drawPositionMarker(currentX, currentY);

      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(animate);
      } else {
        this.animationFrame = null;
      }
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  private drawPositionMarker(pixelX: number, pixelY: number): void {
    const cellW =
      WORLDMAP_CONSTANTS.DISPLAY_WIDTH / WORLDMAP_CONSTANTS.CHUNK_SIZE;
    const cellH =
      WORLDMAP_CONSTANTS.DISPLAY_HEIGHT / WORLDMAP_CONSTANTS.CHUNK_SIZE;

    this.positionMarker.clear();
    // Pink filled rectangle matching one map cell, like original Dofus
    this.positionMarker.rect(
      pixelX - cellW / 2,
      pixelY - cellH / 2,
      cellW,
      cellH
    );
    this.positionMarker.fill({ color: 0xff0000, alpha: 0.5 });
    this.positionMarker.stroke({ color: 0xff0000, width: 1, alpha: 0.5 });
  }

  /**
   * Convert a global screen point to a map ID by tracing through the minimap's transforms.
   */
  getMapIdAtPoint(globalX: number, globalY: number): number | null {
    if (!this.manifest || !this.mapCoordinates) {
      return null;
    }

    const localPoint = this.worldContainer.toLocal({ x: globalX, y: globalY });
    const { bounds } = this.manifest;
    const gameCoord = pixelToMapCoord(
      localPoint.x,
      localPoint.y,
      bounds.xMin,
      bounds.yMin
    );
    return findMapAtCoord(gameCoord.x, gameCoord.y, this.mapCoordinates);
  }

  show(): void {
    this.worldContainer.visible = true;
  }

  hide(): void {
    this.worldContainer.visible = false;
  }

  /**
   * Tear down all live Vello-allocated chunk textures. The patched
   * wgpu's `Drop for WebTexture` is a no-op; without this call every
   * worldmap reload (loadWorldMap → renderMap) would leak the previous
   * chunk textures permanently. Mirrors the tile-sprite-renderer +
   * fighter-portrait-renderer contracts.
   */
  private disposeTileSprites(): void {
    for (const sprite of this.tileSprites) {
      const source = sprite.texture?.source as ImageSource | undefined;
      sprite.destroy();
      if (source && typeof source.destroy === "function") {
        try {
          source.destroy();
        } catch {}
      }
    }
    this.tileSprites = [];
    this.mapContainer.removeChildren();
  }

  private disposeHintSprites(): void {
    for (const sprite of this.hintSprites) {
      const source = sprite.texture?.source as ImageSource | undefined;
      sprite.destroy();
      if (source && typeof source.destroy === "function") {
        try {
          source.destroy();
        } catch {}
      }
    }
    this.hintSprites = [];
    this.hintsContainer.removeChildren();
  }

  destroy(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }

    this.disposeTileSprites();
    this.disposeHintSprites();
    this.worldContainer.destroy({ children: true, texture: false });
  }
}
