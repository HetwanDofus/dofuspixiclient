import type { Application } from 'pixi.js';
import { Assets, Container, Sprite } from 'pixi.js';
import type {
  WorldMapManifest,
  HintManifest,
  HintsLayering,
  MapCoordinates,
} from '@/types/worldmap';
import { loadWorldMapData, mapCoordToPixel, filterHintsByArea } from './world-map-data';

interface MinimapRendererConfig {
  app: Application;
  parentContainer?: Container;
  zoom?: number;
  centerOnMapId?: number;
  centerOnCoordinates?: { x: number; y: number };
}

export class MinimapRenderer {
  private worldContainer: Container;
  private mapContainer: Container;
  private hintsContainer: Container;

  private manifest: WorldMapManifest | null = null;
  private hintManifest: HintManifest | null = null;
  private hintsLayering: HintsLayering | null = null;
  private mapCoordinates: MapCoordinates | null = null;

  private currentSuperarea = 0;
  private currentZoom: number;

  private tileSprites: Sprite[] = [];
  private hintSprites: Sprite[] = [];

  private centerMapId?: number;
  private initialCenterCoordinates?: { x: number; y: number };

  constructor(config: MinimapRendererConfig) {
    this.currentZoom = config.zoom ?? 300;
    this.centerMapId = config.centerOnMapId;
    this.initialCenterCoordinates = config.centerOnCoordinates;

    this.worldContainer = new Container();
    this.mapContainer = new Container();
    this.hintsContainer = new Container();

    this.worldContainer.addChild(this.mapContainer);
    this.worldContainer.addChild(this.hintsContainer);

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
        const texture = await Assets.load(texturePath);

        if (!texture) {
          return;
        }

        // Enable mipmaps for smooth downscaling
        if (texture.source) {
          texture.source.autoGenerateMipmaps = true;
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

  private centerOnMap(mapId: number): void {
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

    this.applyCenter(pixelX, pixelY);
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
    const scale = this.currentZoom / 100;

    this.worldContainer.scale.set(scale);
    this.worldContainer.x = -pixelX * scale;
    this.worldContainer.y = -pixelY * scale;
  }

  show(): void {
    this.worldContainer.visible = true;
  }

  hide(): void {
    this.worldContainer.visible = false;
  }

  destroy(): void {
    this.worldContainer.destroy({ children: true, texture: false });
  }
}
