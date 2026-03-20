import type { Application } from 'pixi.js';
import { Assets, Container, Graphics, Sprite } from 'pixi.js';
import type {
  WorldMapManifest,
  HintManifest,
  HintsLayering,
  MapCoordinates,
} from '@/types/worldmap';
import { WORLDMAP_CONSTANTS } from '@/types/worldmap';
import { loadWorldMapData, mapCoordToPixel, pixelToMapCoord, findMapAtCoord, filterHintsByArea } from './world-map-data';

interface MinimapRendererConfig {
  app: Application;
  parentContainer?: Container;
  centerOnMapId?: number;
  centerOnCoordinates?: { x: number; y: number };
}

export class MinimapRenderer {
  private worldContainer: Container;
  private mapContainer: Container;
  private hintsContainer: Container;
  private positionMarker: Graphics;

  private manifest: WorldMapManifest | null = null;
  private hintManifest: HintManifest | null = null;
  private hintsLayering: HintsLayering | null = null;
  private mapCoordinates: MapCoordinates | null = null;

  private currentSuperarea = 0;

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
    this.worldContainer.addChild(this.hintsContainer);
    this.worldContainer.addChild(this.positionMarker);

    const parent = config.parentContainer ?? config.app.stage;
    parent.addChild(this.worldContainer);
  }

  async loadWorldMap(superarea: number = 0): Promise<void> {
    this.currentSuperarea = superarea;

    const data = await loadWorldMapData(superarea);
    this.manifest = data.manifest;
    this.hintManifest = data.hintManifest;
    this.hintsLayering = data.hintsLayering;
    this.mapCoordinates = data.mapCoordinates;

    await this.renderMap();
    await this.renderHints();

    if (this.centerMapId && this.mapCoordinates) {
      this.centerOnMap(this.centerMapId);
    } else if (this.initialCenterCoordinates) {
      this.centerOnCoordinates(
        this.initialCenterCoordinates.x,
        this.initialCenterCoordinates.y
      );
    }
  }

  private async renderMap(): Promise<void> {
    if (!this.manifest) {
      return;
    }

    this.mapContainer.removeChildren();
    this.tileSprites = [];

    const { tile_size, tiles, worldmap } = this.manifest;

    const tilePromises = tiles.map(async (tileInfo) => {
      const texturePath = `/assets/maps/world/${worldmap}/${tileInfo.file}`;

      try {
        const texture = await Assets.load({
          src: texturePath,
          data: { autoGenerateMipmaps: true },
        });

        if (!texture) {
          return;
        }

        if (texture.source) {
          texture.source.autoGenerateMipmaps = true;
          texture.source.scaleMode = 'linear';
          texture.source.updateMipmaps();
        }

        const sprite = new Sprite(texture);
        sprite.x = tileInfo.x * tile_size;
        sprite.y = tileInfo.y * tile_size;

        this.tileSprites.push(sprite);
        this.mapContainer.addChild(sprite);
      } catch {
        // Skip failed tiles
      }
    });

    await Promise.all(tilePromises);
  }

  private async renderHints(): Promise<void> {
    if (!this.hintsLayering || !this.manifest || !this.hintManifest) {
      return;
    }

    this.hintsContainer.removeChildren();
    this.hintSprites = [];

    const { bounds } = this.manifest;
    const enabledCategories = new Set<number>([1, 2, 3, 4, 5, 6]);

    const filteredHints = filterHintsByArea(
      this.hintsLayering,
      this.mapCoordinates ?? {},
      enabledCategories,
      this.currentSuperarea
    );

    const hintUrls = new Set<string>();

    const hintsToRender: Array<{
      pixelX: number;
      pixelY: number;
      hintInfo: {
        file: string;
        width: number;
        height: number;
        offsetX: number;
        offsetY: number;
      };
      texturePath: string;
    }> = [];

    for (const { overlay, hint } of filteredHints) {
      const gfxID = hint.gfxID.toString();
      const hintInfo = this.hintManifest.graphics[gfxID];

      if (!hintInfo) {
        continue;
      }

      const [pixelX, pixelY] = mapCoordToPixel(
        overlay.x,
        overlay.y,
        bounds.xMin,
        bounds.yMin
      );

      const texturePath = `/assets/maps/hints/${hintInfo.file}`;

      hintsToRender.push({ pixelX, pixelY, hintInfo, texturePath });
      hintUrls.add(texturePath);
    }

    if (hintUrls.size === 0) {
      return;
    }

    const loadedTextures = await Assets.load([...hintUrls]);

    // Enable mipmaps on hint textures for smooth downscaling
    for (const texture of Object.values(loadedTextures)) {
      if (texture?.source) {
        texture.source.autoGenerateMipmaps = true;
        texture.source.updateMipmaps();
      }
    }

    const hintScale = 1.2 / (this.hintManifest.supersample || 1);

    for (const hintData of hintsToRender) {
      const texture = loadedTextures[hintData.texturePath];

      if (!texture) {
        continue;
      }

      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0.5);

      sprite.x = hintData.pixelX + hintData.hintInfo.offsetX + hintData.hintInfo.width / 2;
      sprite.y = hintData.pixelY + hintData.hintInfo.offsetY + hintData.hintInfo.height / 2;
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
    const cellW = WORLDMAP_CONSTANTS.DISPLAY_WIDTH / WORLDMAP_CONSTANTS.CHUNK_SIZE;
    const cellH = WORLDMAP_CONSTANTS.DISPLAY_HEIGHT / WORLDMAP_CONSTANTS.CHUNK_SIZE;

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
    const gameCoord = pixelToMapCoord(localPoint.x, localPoint.y, bounds.xMin, bounds.yMin);
    return findMapAtCoord(gameCoord.x, gameCoord.y, this.mapCoordinates);
  }

  show(): void {
    this.worldContainer.visible = true;
  }

  hide(): void {
    this.worldContainer.visible = false;
  }

  destroy(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.worldContainer.destroy({ children: true, texture: false });
  }
}
