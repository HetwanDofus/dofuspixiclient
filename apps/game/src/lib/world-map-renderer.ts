import type { Application } from 'pixi.js';
import { Assets, Container, Graphics, Rectangle, Sprite, Text, TextStyle } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';

interface WorldMapManifest {
  worldmap: string;
  grid_size: number;
  tile_size: number;
  format: string;
  bounds: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  tiles: Array<{
    x: number;
    y: number;
    file: string;
  }>;
}

interface HintManifest {
  supersample: number;
  graphics: {
    [gfxID: string]: {
      file: string;
      width: number;
      height: number;
      offsetX: number;
      offsetY: number;
    };
  };
}

interface HintsData {
  categories: Array<{
    id: number;
    name: string;
    color: string;
  }>;
  hints_by_map: {
    [mapID: string]: Array<{
      name: string;
      categoryID: number;
      category: string;
      color: string;
      gfxID: number;
    }>;
  };
}

interface HintsLayering {
  hint_overlays: Array<{
    x: number;
    y: number;
    hints: Array<{
      name: string;
      categoryID: number;
      gfxID: number;
      mapID: number;
    }>;
  }>;
}

interface MapCoordinates {
  [mapID: string]: {
    x: number;
    y: number;
    sua: number;
  };
}

interface WorldMapConfig {
  app: Application;
  minimapMode?: boolean;
  minimapZoom?: number;
  centerOnMapId?: number;
  centerOnCoordinates?: { x: number; y: number };
  parentContainer?: Container;
}

interface HintGroup {
  sprites: Sprite[];
  hitArea: Graphics | null;
  visualCircle: Graphics | null;
  isSpread: boolean;
}

interface HintSpriteMetadata {
  baseX: number;
  baseY: number;
  hintData: {
    name: string;
    categoryID: number;
    gfxID: number;
    mapID: number;
  };
  groupKey: string;
}

interface HitAreaMetadata {
  baseX: number;
  baseY: number;
  stackSize: number;
}

type HintSprite = Sprite & HintSpriteMetadata;
type HitAreaGraphics = Graphics & HitAreaMetadata;

export class WorldMapRenderer {
  private app: Application;
  private mapContainer: Container;
  private hintsContainer: Container;
  private uiContainer: Container;
  private worldContainer: Container;
  private tooltip: Container;
  private tooltipText: Text;
  private tooltipBg: Graphics;

  private enabledCategories: Set<number> = new Set();
  private worldMapManifest: WorldMapManifest | null = null;
  private hintsData: HintsData | null = null;
  private hintManifest: HintManifest | null = null;
  private hintsLayering: HintsLayering | null = null;
  private mapCoordinates: MapCoordinates | null = null;

  private currentSuperarea = 0;
  private currentZoom = 50;
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  private hintGroups: Map<string, HintGroup> = new Map();
  private collapseTimers: Map<string, number> = new Map();
  private tileSprites: Map<string, Sprite> = new Map();

  private readonly DISPLAY_WIDTH = 742;
  private readonly DISPLAY_HEIGHT = 432;
  private readonly WORLD_MAP_CHUNK_SIZE = 15;
  private readonly WORLDMAP_SCALE = 1.0;
  private readonly CULL_PADDING = 200;

  private minimapMode: boolean;
  private centerMapId?: number;
  private centerCoordinates?: { x: number; y: number };

  constructor(config: WorldMapConfig) {
    this.app = config.app;
    this.minimapMode = config.minimapMode ?? false;
    this.centerMapId = config.centerOnMapId;
    this.centerCoordinates = config.centerOnCoordinates;

    if (this.minimapMode && config.minimapZoom) {
      this.currentZoom = config.minimapZoom;
    }

    this.worldContainer = new Container();
    this.mapContainer = new Container();
    this.hintsContainer = new Container();
    this.uiContainer = new Container();
    this.tooltip = new Container();
    this.tooltipBg = new Graphics();
    this.tooltipText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'bitMini6',
        fontSize: 14,
        fill: 0xffffff,
      })
    });

    this.worldContainer.addChild(this.mapContainer);
    this.worldContainer.addChild(this.hintsContainer);

    const parent = config.parentContainer || this.app.stage;
    parent.addChild(this.worldContainer);
    parent.addChild(this.uiContainer);

    this.createTooltip();
    this.setupControls();

    this.enabledCategories = new Set([1, 2, 3, 4, 5, 6]);

    if (this.minimapMode) {
      this.uiContainer.visible = false;
    }
  }

  async loadWorldMap(superarea: number = 0): Promise<void> {
    this.currentSuperarea = superarea;
    const worldMapName = superarea === 0 ? 'amakna' : 'incarnam';

    const [worldManifest, hintsData, hintManifest, hintsLayering, mapData] = await Promise.all([
      fetch(`/assets/maps/world/${worldMapName}/manifest.json`).then(r => r.json()),
      fetch('/assets/data/hints-data.json').then(r => r.json()),
      fetch('/assets/maps/hints/manifest.json').then(r => r.json()),
      fetch('/assets/data/hints-layering.json').then(r => r.json()),
      fetch('/assets/data/map-data.json').then(r => r.json()),
    ]);

    this.worldMapManifest = worldManifest;
    this.hintsData = hintsData;
    this.hintManifest = hintManifest;
    this.hintsLayering = hintsLayering;

    if (mapData?.maps) {
      this.mapCoordinates = mapData.maps;
    }

    await this.renderWorldMap();
    await this.renderHints();

    if (!this.minimapMode) {
      this.createCategoryUI();
    }

    if (this.minimapMode) {
      if (this.centerMapId && this.mapCoordinates) {
        this.centerOnMap(this.centerMapId);
      } else if (this.centerCoordinates) {
        this.centerOnCoordinates(this.centerCoordinates.x, this.centerCoordinates.y);
      }
    }
  }

  private setupControls(): void {
    this.worldContainer.eventMode = 'static';
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;

    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.worldContainer || !this.worldMapManifest) return;

      const zoomDelta = e.deltaY > 0 ? -5 : 5;
      const newZoom = Math.max(10, Math.min(200, this.currentZoom + zoomDelta));

      const mouseX = e.clientX;
      const mouseY = e.clientY;

      const worldPos = {
        x: (mouseX - this.worldContainer.x) / this.worldContainer.scale.x,
        y: (mouseY - this.worldContainer.y) / this.worldContainer.scale.y,
      };

      this.currentZoom = newZoom;
      const newScale = this.currentZoom / 100;
      this.worldContainer.scale.set(newScale);

      this.worldContainer.x = mouseX - worldPos.x * newScale;
      this.worldContainer.y = mouseY - worldPos.y * newScale;

      this.cullVisibleContent();
    };

    if (this.app.canvas) {
      this.app.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    this.app.stage.on('pointerdown', (e) => {
      this.isDragging = true;
      this.dragStart.x = e.global.x - (this.worldContainer?.x || 0);
      this.dragStart.y = e.global.y - (this.worldContainer?.y || 0);

      if (this.app?.canvas) {
        this.app.canvas.style.cursor = 'grabbing';
      }
    });

    this.app.stage.on('pointermove', (e) => {
      if (!this.isDragging || !this.worldContainer) return;

      this.worldContainer.x = e.global.x - this.dragStart.x;
      this.worldContainer.y = e.global.y - this.dragStart.y;

      this.cullVisibleContent();
    });

    this.app.stage.on('pointerup', () => {
      this.isDragging = false;
      if (this.app?.canvas) {
        this.app.canvas.style.cursor = 'default';
      }
    });

    this.app.stage.on('pointerupoutside', () => {
      this.isDragging = false;
      if (this.app?.canvas) {
        this.app.canvas.style.cursor = 'default';
      }
    });
  }

  private async renderWorldMap(): Promise<void> {
    if (!this.mapContainer || !this.worldMapManifest) return;

    this.mapContainer.removeChildren();
    this.tileSprites.clear();

    const { tile_size, tiles } = this.worldMapManifest;
    const worldMapName = this.worldMapManifest.worldmap;

    this.centerMap();

    const tilePromises = tiles.map(async (tileInfo) => {
      const texturePath = `/assets/maps/world/${worldMapName}/${tileInfo.file}`;
      const tileKey = `${tileInfo.x},${tileInfo.y}`;

      try {
        const texture = await Assets.load(texturePath);

        if (texture && this.mapContainer) {
          const sprite = new Sprite(texture);
          sprite.x = tileInfo.x * tile_size;
          sprite.y = tileInfo.y * tile_size;

          this.tileSprites.set(tileKey, sprite);
          this.mapContainer.addChild(sprite);

          sprite.visible = false;
        }
      } catch (error) {
        console.warn(`Failed to load tile ${tileInfo.file}:`, error);
      }
    });

    await Promise.all(tilePromises);
    this.cullVisibleContent();
  }

  private centerMap(): void {
    if (!this.app || !this.worldContainer || !this.worldMapManifest) return;

    const mapWidth = this.worldMapManifest.grid_size * this.worldMapManifest.tile_size;
    const mapHeight = this.worldMapManifest.grid_size * this.worldMapManifest.tile_size;

    const scale = this.currentZoom / 100;

    this.worldContainer.scale.set(scale);
    this.worldContainer.x = (this.app.screen.width - mapWidth * scale) / 2;
    this.worldContainer.y = (this.app.screen.height - mapHeight * scale) / 2;
  }

  private centerOnMap(mapId: number): void {
    if (!this.mapCoordinates || !this.worldMapManifest || !this.worldContainer) return;

    const mapCoord = this.mapCoordinates[mapId.toString()];
    if (!mapCoord) {
      console.warn(`Map ${mapId} not found in coordinates`);
      return;
    }

    const { bounds } = this.worldMapManifest;
    const [pixelX, pixelY] = this.mapCoordToPixel(
      mapCoord.x,
      mapCoord.y,
      bounds.xMin,
      bounds.yMin
    );

    const scale = this.currentZoom / 100;
    this.worldContainer.scale.set(scale);

    this.worldContainer.x = this.app.screen.width / 2 - pixelX * scale;
    this.worldContainer.y = this.app.screen.height / 2 - pixelY * scale;

    this.cullVisibleContent();
  }

  private centerOnCoordinates(x: number, y: number): void {
    if (!this.worldMapManifest || !this.worldContainer) return;

    const { bounds } = this.worldMapManifest;
    const [pixelX, pixelY] = this.mapCoordToPixel(
      x,
      y,
      bounds.xMin,
      bounds.yMin
    );

    console.log(`Centering on coordinates (${x}, ${y})`);
    console.log(`Bounds: xMin=${bounds.xMin}, yMin=${bounds.yMin}, xMax=${bounds.xMax}, yMax=${bounds.yMax}`);
    console.log(`Calculated pixel position: (${pixelX}, ${pixelY})`);

    const scale = this.currentZoom / 100;
    this.worldContainer.scale.set(scale);

    // In minimap mode, position coordinate at (0, 0) - parent container will handle centering
    // Otherwise center on app screen
    if (this.minimapMode) {
      this.worldContainer.x = -pixelX * scale;
      this.worldContainer.y = -pixelY * scale;
    } else {
      this.worldContainer.x = this.app.screen.width / 2 - pixelX * scale;
      this.worldContainer.y = this.app.screen.height / 2 - pixelY * scale;
    }

    console.log(`World container position: (${this.worldContainer.x}, ${this.worldContainer.y}), scale: ${scale}`);

    this.cullVisibleContent();
  }

  private cullVisibleContent(): void {
    if (!this.worldContainer || !this.app) return;

    const scale = this.worldContainer.scale.x;

    // In minimap mode, we want to show the entire visible area of the parent container
    // Use a large bounds to ensure everything is visible since the minimap is small
    let viewWidth = this.app.screen.width;
    let viewHeight = this.app.screen.height;

    if (this.minimapMode) {
      // For minimap, use a generous view size (the world map is 742x432)
      viewWidth = 742;
      viewHeight = 432;
    }

    const viewBounds = new Rectangle(
      -this.worldContainer.x / scale - this.CULL_PADDING,
      -this.worldContainer.y / scale - this.CULL_PADDING,
      viewWidth / scale + this.CULL_PADDING * 2,
      viewHeight / scale + this.CULL_PADDING * 2
    );

    this.cullTiles(viewBounds);
    this.cullHints(viewBounds);
  }

  private cullTiles(viewBounds: Rectangle): void {
    for (const sprite of this.tileSprites.values()) {
      const spriteBounds = new Rectangle(
        sprite.x,
        sprite.y,
        sprite.width,
        sprite.height
      );

      sprite.visible = this.rectanglesIntersect(viewBounds, spriteBounds);
    }
  }

  private cullHints(viewBounds: Rectangle): void {
    for (const group of this.hintGroups.values()) {
      const firstSprite = group.sprites[0] as HintSprite | undefined;
      if (!firstSprite) continue;

      const baseX = firstSprite.baseX || firstSprite.x;
      const baseY = firstSprite.baseY || firstSprite.y;
      const hintSize = 50;

      const hintBounds = new Rectangle(
        baseX - hintSize / 2,
        baseY - hintSize / 2,
        hintSize,
        hintSize
      );

      const isVisible = this.rectanglesIntersect(viewBounds, hintBounds);

      for (const sprite of group.sprites) {
        sprite.visible = isVisible;
      }

      if (group.hitArea) {
        group.hitArea.visible = isVisible;
      }
    }
  }

  private rectanglesIntersect(rect1: Rectangle, rect2: Rectangle): boolean {
    return !(
      rect1.x + rect1.width < rect2.x ||
      rect2.x + rect2.width < rect1.x ||
      rect1.y + rect1.height < rect2.y ||
      rect2.y + rect2.height < rect1.y
    );
  }

  private async renderHints(): Promise<void> {
    if (!this.hintsContainer || !this.hintsLayering || !this.worldMapManifest || !this.hintManifest) return;

    this.hintsContainer.removeChildren();
    this.hintGroups.clear();

    for (const timer of this.collapseTimers.values()) {
      clearTimeout(timer);
    }
    this.collapseTimers.clear();

    const { bounds } = this.worldMapManifest;
    const chunkXMin = bounds.xMin;
    const chunkYMin = bounds.yMin;

    const hintsToRender: Array<{
      hint: {
        name: string;
        categoryID: number;
        gfxID: number;
        mapID: number;
      };
      overlayX: number;
      overlayY: number;
      pixelX: number;
      pixelY: number;
      gfxID: string;
      hintInfo: {
        file: string;
        width: number;
        height: number;
        offsetX: number;
        offsetY: number;
      };
      texturePath: string;
    }> = [];

    const hintUrls: string[] = [];

    for (const overlay of this.hintsLayering.hint_overlays) {
      const overlayX = overlay.x;
      const overlayY = overlay.y;

      for (const hint of overlay.hints) {
        const mapID = hint.mapID.toString();

        if (this.mapCoordinates?.[mapID]?.sua !== this.currentSuperarea) {
          continue;
        }

        if (!this.enabledCategories.has(hint.categoryID)) continue;

        const [pixelX, pixelY] = this.mapCoordToPixel(
          overlayX,
          overlayY,
          chunkXMin,
          chunkYMin
        );

        const gfxID = hint.gfxID.toString();
        const hintInfo = this.hintManifest.graphics[gfxID];

        if (!hintInfo) {
          console.warn(`Hint graphic ${gfxID} not found in manifest`);
          continue;
        }

        const texturePath = `/assets/maps/hints/${hintInfo.file}`;

        hintsToRender.push({
          hint,
          overlayX,
          overlayY,
          pixelX,
          pixelY,
          gfxID,
          hintInfo,
          texturePath,
        });

        hintUrls.push(texturePath);
      }
    }

    if (hintUrls.length > 0) {
      const loadedTextures = await Assets.load(hintUrls);

      const positionGroups = new Map<string, typeof hintsToRender>();
      for (const hintData of hintsToRender) {
        const posKey = `${Math.round(hintData.pixelX)},${Math.round(hintData.pixelY)}`;
        const group = positionGroups.get(posKey);
        if (group) {
          group.push(hintData);
        } else {
          positionGroups.set(posKey, [hintData]);
        }
      }

      for (const [posKey, groupData] of positionGroups.entries()) {
        const sprites: HintSprite[] = [];

        let visualCircle: Graphics | null = null;
        let hitArea: HitAreaGraphics | null = null;

        if (groupData.length > 1) {
          visualCircle = new Graphics();
          visualCircle.eventMode = 'none';
          visualCircle.visible = false;
          this.hintsContainer.addChild(visualCircle);

          hitArea = new Graphics() as HitAreaGraphics;
          hitArea.eventMode = 'static';
          hitArea.cursor = 'pointer';
          hitArea.alpha = 0;
          this.hintsContainer.addChild(hitArea);
        }

        for (let i = 0; i < groupData.length; i++) {
          const hintData = groupData[i];
          const texture = loadedTextures[hintData.texturePath];

          if (!texture) continue;

          const sprite = new Sprite(texture) as HintSprite;

          sprite.anchor.set(0.5, 0.5);

          const halfWidth = hintData.hintInfo.width / 2;
          const halfHeight = hintData.hintInfo.height / 2;
          const baseX = hintData.pixelX + hintData.hintInfo.offsetX + halfWidth;
          const baseY = hintData.pixelY + hintData.hintInfo.offsetY + halfHeight;

          sprite.baseX = baseX;
          sprite.baseY = baseY;

          if (groupData.length > 1) {
            const stackOffset = 2;
            sprite.x = baseX + i * stackOffset;
            sprite.y = baseY + i * stackOffset;
          } else {
            sprite.x = baseX;
            sprite.y = baseY;
          }

          const hintScale = 1.2 / (this.hintManifest.supersample || 1);
          sprite.scale.set(hintScale);

          sprite.eventMode = 'static';
          sprite.cursor = 'pointer';

          sprite.hintData = hintData.hint;
          sprite.groupKey = posKey;

          sprites.push(sprite);
          this.hintsContainer.addChild(sprite);
        }

        if (sprites.length > 1 && hitArea && visualCircle) {
          const firstSprite = sprites[0];
          const baseX = firstSprite.baseX;
          const baseY = firstSprite.baseY;

          hitArea.baseX = baseX;
          hitArea.baseY = baseY;
          hitArea.stackSize = groupData.length;

          const stackOffset = 2;
          const deckSize = 20 + (groupData.length - 1) * stackOffset;
          hitArea.rect(
            baseX - 10,
            baseY - 10,
            deckSize,
            deckSize
          );
          hitArea.fill({ color: 0xff0000, alpha: 0 });

          this.hintGroups.set(posKey, { sprites, hitArea, visualCircle, isSpread: false });

          hitArea.on('pointerover', () => {
            this.spreadHints(posKey);
          });

          hitArea.on('pointerout', (e) => {
            const movingToSprite = sprites.some(s => s.containsPoint(e.global));
            if (!movingToSprite) {
              this.collapseHints(posKey);
              this.hideTooltip();
            }
          });

          for (const sprite of sprites) {
            sprite.on('pointerover', (e) => {
              this.spreadHints(posKey);
              this.showTooltip(sprite.hintData.name, e.global.x, e.global.y);
            });

            sprite.on('pointermove', (e) => {
              this.updateTooltipPosition(e.global.x, e.global.y);
            });

            sprite.on('pointerout', (e) => {
              const stillOverSprite = sprites.some(s => s !== sprite && s.containsPoint(e.global));
              const stillOverHitArea = hitArea?.containsPoint(e.global);

              if (!stillOverSprite && !stillOverHitArea) {
                this.collapseHints(posKey);
              }

              if (!stillOverSprite) {
                this.hideTooltip();
              }
            });
          }
        } else {
          const sprite = sprites[0];
          this.hintGroups.set(posKey, { sprites, hitArea: null, visualCircle: null, isSpread: false });

          sprite.on('pointerover', (e) => {
            this.showTooltip(sprite.hintData.name, e.global.x, e.global.y);
          });

          sprite.on('pointermove', (e) => {
            this.updateTooltipPosition(e.global.x, e.global.y);
          });

          sprite.on('pointerout', () => {
            this.hideTooltip();
          });
        }
      }
    }

    this.cullVisibleContent();
  }

  private spreadHints(groupKey: string): void {
    const timer = this.collapseTimers.get(groupKey);
    if (timer) {
      clearTimeout(timer);
      this.collapseTimers.delete(groupKey);
    }

    const group = this.hintGroups.get(groupKey);
    if (!group || group.sprites.length <= 1 || group.isSpread) return;

    group.isSpread = true;

    const firstSprite = group.sprites[0] as HintSprite;
    const baseX = firstSprite.baseX;
    const baseY = firstSprite.baseY;

    const cardSpacing = 30;
    const maxRotation = 15;
    const angleStep = group.sprites.length > 1 ? (maxRotation * 2) / (group.sprites.length - 1) : 0;

    group.sprites.forEach((sprite, index) => {
      const targetX = baseX + (index - (group.sprites.length - 1) / 2) * cardSpacing;
      const targetY = baseY;

      const rotation = -maxRotation + index * angleStep;

      if (!sprite.filters) {
        const dropShadow = new DropShadowFilter({
          offset: { x: 2, y: 2 },
          blur: 4,
          alpha: 0.5,
        });
        sprite.filters = [dropShadow];
      }

      this.animateSprite(sprite, targetX, targetY, 150, rotation);
    });

    if (group.hitArea) {
      const totalWidth = (group.sprites.length - 1) * 30 + 30;
      const hitHeight = 40;

      group.hitArea.clear();
      group.hitArea.rect(
        baseX - totalWidth / 2,
        baseY - hitHeight / 2,
        totalWidth,
        hitHeight
      );
      group.hitArea.fill({ color: 0xff0000, alpha: 0 });
      group.hitArea.eventMode = 'static';
    }
  }

  private collapseHints(groupKey: string): void {
    const existingTimer = this.collapseTimers.get(groupKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      const group = this.hintGroups.get(groupKey);
      if (!group || !group.isSpread) return;

      group.isSpread = false;

      group.sprites.forEach((sprite, index) => {
        const hintSprite = sprite as HintSprite;
        sprite.filters = null;

        const stackOffset = 2;
        const baseX = hintSprite.baseX;
        const baseY = hintSprite.baseY;
        this.animateSprite(
          sprite,
          baseX + index * stackOffset,
          baseY + index * stackOffset,
          150,
          0
        );
      });

      if (group.hitArea) {
        const hitAreaWithMeta = group.hitArea as HitAreaGraphics;
        const baseX = hitAreaWithMeta.baseX;
        const baseY = hitAreaWithMeta.baseY;
        const stackSize = hitAreaWithMeta.stackSize || 1;

        group.hitArea.clear();

        const stackOffset = 2;
        const deckSize = 20 + (stackSize - 1) * stackOffset;
        group.hitArea.rect(
          baseX - 10,
          baseY - 10,
          deckSize,
          deckSize
        );
        group.hitArea.fill({ color: 0xff0000, alpha: 0 });
        group.hitArea.eventMode = 'static';
      }

      this.collapseTimers.delete(groupKey);
    }, 250);

    this.collapseTimers.set(groupKey, timer);
  }

  private animateSprite(sprite: Sprite, targetX: number, targetY: number, duration: number, targetRotation: number = 0): void {
    const startX = sprite.x;
    const startY = sprite.y;
    const startRotation = sprite.rotation;
    const targetRotationRad = (targetRotation * Math.PI) / 180;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const eased = 1 - (1 - progress) ** 3;

      sprite.x = startX + (targetX - startX) * eased;
      sprite.y = startY + (targetY - startY) * eased;
      sprite.rotation = startRotation + (targetRotationRad - startRotation) * eased;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  private mapCoordToPixel(
    gameMapX: number,
    gameMapY: number,
    chunkXMin: number,
    chunkYMin: number
  ): [number, number] {
    const chunkX = gameMapX / this.WORLD_MAP_CHUNK_SIZE;
    const chunkY = gameMapY / this.WORLD_MAP_CHUNK_SIZE;

    const offsetX = chunkX - chunkXMin;
    const offsetY = chunkY - chunkYMin;

    const pixelX = Math.round(offsetX * this.DISPLAY_WIDTH * this.WORLDMAP_SCALE);
    const pixelY = Math.round(offsetY * this.DISPLAY_HEIGHT * this.WORLDMAP_SCALE);

    const mapCellWidth = this.DISPLAY_WIDTH / this.WORLD_MAP_CHUNK_SIZE;
    const mapCellHeight = this.DISPLAY_HEIGHT / this.WORLD_MAP_CHUNK_SIZE;

    return [pixelX + mapCellWidth / 2, pixelY + mapCellHeight / 2];
  }

  private createCategoryUI(): void {
    if (!this.uiContainer || !this.hintsData) return;

    this.uiContainer.removeChildren();

    const panelBg = new Graphics();
    panelBg.rect(10, 10, 250, 250);
    panelBg.fill({ color: 0x000000, alpha: 0.7 });
    panelBg.stroke({ color: 0x666666, width: 2 });
    this.uiContainer.addChild(panelBg);

    const titleStyle = new TextStyle({
      fontFamily: 'Arial',
      fontSize: 18,
      fontWeight: 'bold',
      fill: 0xffffff,
    });

    const title = new Text({ text: 'Categories', style: titleStyle });
    title.x = 20;
    title.y = 20;
    this.uiContainer.addChild(title);

    const categoryStyle = new TextStyle({
      fontFamily: 'Arial',
      fontSize: 14,
      fill: 0xffffff,
    });

    this.hintsData.categories.forEach((category, index) => {
      const yPos = 50 + index * 30;

      const checkbox = new Graphics();
      const isEnabled = this.enabledCategories.has(category.id);
      checkbox.rect(20, yPos, 20, 20);
      checkbox.fill({ color: isEnabled ? 0x44ff44 : 0x444444 });
      checkbox.stroke({ color: 0xffffff, width: 1 });
      checkbox.interactive = true;
      checkbox.cursor = 'pointer';

      checkbox.on('pointerdown', () => {
        if (this.enabledCategories.has(category.id)) {
          this.enabledCategories.delete(category.id);
        } else {
          this.enabledCategories.add(category.id);
        }
        this.renderHints();
        this.createCategoryUI();
      });

      this.uiContainer.addChild(checkbox);

      const label = new Text({
        text: category.name,
        style: categoryStyle
      });
      label.x = 50;
      label.y = yPos + 2;
      this.uiContainer.addChild(label);

      const colorMap: { [key: string]: number } = {
        'Orange': 0xff8800,
        'Blue': 0x4488ff,
        'Green': 0x44ff44,
        'Beige': 0xf5deb3,
        'Red': 0xff4444,
        'Violet': 0x8844ff,
      };

      const colorIndicator = new Graphics();
      colorIndicator.circle(230, yPos + 10, 6);
      colorIndicator.fill({ color: colorMap[category.color] || 0xffffff });
      this.uiContainer.addChild(colorIndicator);
    });
  }

  private createTooltip(): void {
    this.tooltip.visible = false;

    this.tooltip.addChild(this.tooltipBg);

    this.tooltipText.x = 8;
    this.tooltipText.y = 6;
    this.tooltip.addChild(this.tooltipText);

    this.app.stage.addChild(this.tooltip);
  }

  private showTooltip(text: string, x: number, y: number): void {
    this.tooltipText.text = text;

    const padding = 8;
    const width = this.tooltipText.width + padding * 2;
    const height = this.tooltipText.height + padding * 1.5;

    this.tooltipBg.clear();
    this.tooltipBg.rect(0, 0, width, height);
    this.tooltipBg.fill({ color: 0x000000, alpha: 0.7 });
    this.tooltipBg.stroke({ color: 0xffffff, width: 1, alpha: 0.5 });

    this.updateTooltipPosition(x, y);
    this.tooltip.visible = true;
  }

  private updateTooltipPosition(x: number, y: number): void {
    const offsetX = 15;
    const offsetY = 15;

    let tooltipX = x + offsetX;
    let tooltipY = y + offsetY;

    if (tooltipX + this.tooltip.width > this.app.screen.width) {
      tooltipX = x - this.tooltip.width - offsetX;
    }

    if (tooltipY + this.tooltip.height > this.app.screen.height) {
      tooltipY = y - this.tooltip.height - offsetY;
    }

    this.tooltip.x = tooltipX;
    this.tooltip.y = tooltipY;
  }

  private hideTooltip(): void {
    this.tooltip.visible = false;
  }

  show(): void {
    this.worldContainer.visible = true;
    this.uiContainer.visible = !this.minimapMode;
    this.cullVisibleContent();
  }

  public centerOnWorldCoordinates(x: number, y: number): void {
    this.centerOnCoordinates(x, y);
  }

  hide(): void {
    this.worldContainer.visible = false;
    this.uiContainer.visible = false;

    for (const timer of this.collapseTimers.values()) {
      clearTimeout(timer);
    }
    this.collapseTimers.clear();

    for (const group of this.hintGroups.values()) {
      if (group.isSpread) {
        group.isSpread = false;
        group.sprites.forEach((sprite, index) => {
          const hintSprite = sprite as HintSprite;
          sprite.filters = null;
          const stackOffset = 2;
          const baseX = hintSprite.baseX;
          const baseY = hintSprite.baseY;
          sprite.x = baseX + index * stackOffset;
          sprite.y = baseY + index * stackOffset;
          sprite.rotation = 0;
        });
        if (group.visualCircle) {
          group.visualCircle.visible = false;
        }
      }
    }
  }

  destroy(): void {
    // Safely remove wheel listener
    if (this.wheelHandler && this.app) {
      try {
        const canvas = this.app.canvas;
        if (canvas) {
          canvas.removeEventListener('wheel', this.wheelHandler);
        }
      } catch {
        // Canvas might be already destroyed, ignore
      }
    }

    for (const timer of this.collapseTimers.values()) {
      clearTimeout(timer);
    }
    this.collapseTimers.clear();

    // Destroy containers without destroying managed textures
    this.worldContainer.destroy({ children: true, texture: false });
    this.uiContainer.destroy({ children: true, texture: false });
    this.tooltip.destroy({ children: true, texture: false });
  }
}
