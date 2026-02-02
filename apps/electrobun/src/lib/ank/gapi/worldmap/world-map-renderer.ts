import {
  Application,
  Container,
  Sprite,
  Graphics,
  Text,
  TextStyle,
  Assets,
} from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import type {
  WorldMapManifest,
  HintManifest,
  HintsData,
  HintsLayering,
  MapCoordinates,
  HintSpriteData,
  HintGroup,
} from '@/types/worldmap';
import { WORLDMAP_CONSTANTS, HINT_COLORS } from '@/types/worldmap';
import { loadWorldMapData, mapCoordToPixel, filterHintsByArea } from './world-map-data';
import { animateSprite, animateTileSurface } from './animations';

interface HintSprite extends Sprite, HintSpriteData {}

interface WorldMapRendererConfig {
  app: Application;
  parentContainer?: Container;
}

export class WorldMapRenderer {
  private app: Application;
  private worldContainer: Container;
  private mapContainer: Container;
  private hintsContainer: Container;
  private uiContainer: Container;

  private tooltip: Container;
  private tooltipText: Text;
  private tooltipBg: Graphics;

  private manifest: WorldMapManifest | null = null;
  private hintsData: HintsData | null = null;
  private hintManifest: HintManifest | null = null;
  private hintsLayering: HintsLayering | null = null;
  private mapCoordinates: MapCoordinates | null = null;

  private enabledCategories = new Set<number>([1, 2, 3, 4, 5, 6]);
  private currentSuperarea = 0;
  private currentZoom: number = WORLDMAP_CONSTANTS.DEFAULT_ZOOM;

  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  private hintGroups = new Map<string, HintGroup>();
  private collapseTimers = new Map<string, number>();

  constructor(config: WorldMapRendererConfig) {
    this.app = config.app;

    this.worldContainer = new Container();
    this.mapContainer = new Container();
    this.hintsContainer = new Container();
    this.uiContainer = new Container();

    this.worldContainer.addChild(this.mapContainer);
    this.worldContainer.addChild(this.hintsContainer);

    const parent = config.parentContainer ?? this.app.stage;
    parent.addChild(this.worldContainer);
    parent.addChild(this.uiContainer);

    this.tooltip = new Container();
    this.tooltip.visible = false;

    this.tooltipBg = new Graphics();
    this.tooltip.addChild(this.tooltipBg);

    this.tooltipText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'bitMini6',
        fontSize: 14,
        fill: 0xffffff,
      }),
    });
    this.tooltipText.x = 8;
    this.tooltipText.y = 6;
    this.tooltip.addChild(this.tooltipText);

    this.app.stage.addChild(this.tooltip);

    this.setupControls();
  }

  private setupControls(): void {
    this.worldContainer.eventMode = 'static';
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;

    this.setupZoomControl();
    this.setupDragControl();
  }

  private setupZoomControl(): void {
    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();

      if (!this.manifest) {
        return;
      }

      const { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } = WORLDMAP_CONSTANTS;

      let zoomDelta = -ZOOM_STEP;
      if (e.deltaY < 0) {
        zoomDelta = ZOOM_STEP;
      }

      const newZoom = this.currentZoom + zoomDelta;

      if (newZoom < MIN_ZOOM || newZoom > MAX_ZOOM) {
        return;
      }

      const worldPos = {
        x: (e.clientX - this.worldContainer.x) / this.worldContainer.scale.x,
        y: (e.clientY - this.worldContainer.y) / this.worldContainer.scale.y,
      };

      this.currentZoom = newZoom;
      const newScale = this.currentZoom / 100;

      this.worldContainer.scale.set(newScale);
      this.worldContainer.x = e.clientX - worldPos.x * newScale;
      this.worldContainer.y = e.clientY - worldPos.y * newScale;
    };

    this.app.canvas?.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  private setupDragControl(): void {
    this.app.stage.on('pointerdown', (e) => {
      this.isDragging = true;
      this.dragStart.x = e.global.x - this.worldContainer.x;
      this.dragStart.y = e.global.y - this.worldContainer.y;

      if (this.app.canvas) {
        this.app.canvas.style.cursor = 'grabbing';
      }
    });

    this.app.stage.on('pointermove', (e) => {
      if (!this.isDragging) {
        return;
      }

      this.worldContainer.x = e.global.x - this.dragStart.x;
      this.worldContainer.y = e.global.y - this.dragStart.y;
    });

    const stopDrag = () => {
      this.isDragging = false;

      if (this.app.canvas) {
        this.app.canvas.style.cursor = 'default';
      }
    };

    this.app.stage.on('pointerup', stopDrag);
    this.app.stage.on('pointerupoutside', stopDrag);
  }

  async loadWorldMap(superarea: number = 0): Promise<void> {
    this.currentSuperarea = superarea;

    const data = await loadWorldMapData(superarea);
    this.manifest = data.manifest;
    this.hintsData = data.hintsData;
    this.hintManifest = data.hintManifest;
    this.hintsLayering = data.hintsLayering;
    this.mapCoordinates = data.mapCoordinates;

    await this.renderMap();
    await this.renderHints();
    this.createCategoryUI();
  }

  private async renderMap(): Promise<void> {
    if (!this.manifest) {
      return;
    }

    this.mapContainer.removeChildren();
    this.centerMap();

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

        const finalY = tileInfo.y * tile_size;
        sprite.alpha = 0;
        sprite.y = finalY + 20;

        this.mapContainer.addChild(sprite);
        animateTileSurface(sprite, finalY, 200);
      } catch {
        // Skip failed tiles
      }
    });

    await Promise.all(tilePromises);
  }

  private centerMap(): void {
    if (!this.manifest) {
      return;
    }

    const mapSize = this.manifest.grid_size * this.manifest.tile_size;
    const scale = this.currentZoom / 100;

    this.worldContainer.scale.set(scale);
    this.worldContainer.x = (this.app.screen.width - mapSize * scale) / 2;
    this.worldContainer.y = (this.app.screen.height - mapSize * scale) / 2;
  }

  private async renderHints(): Promise<void> {
    if (!this.hintsLayering || !this.manifest || !this.hintManifest) {
      return;
    }

    this.hintsContainer.removeChildren();
    this.clearHintGroups();

    const { bounds } = this.manifest;

    const filteredHints = filterHintsByArea(
      this.hintsLayering,
      this.mapCoordinates ?? {},
      this.enabledCategories,
      this.currentSuperarea
    );

    const hintUrls = new Set<string>();

    const hintsToRender: Array<{
      hint: { name: string; categoryID: number; gfxID: number; mapID: number };
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

      hintsToRender.push({ hint, pixelX, pixelY, hintInfo, texturePath });
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

    const positionGroups = this.groupHintsByPosition(hintsToRender);

    for (const [posKey, groupData] of positionGroups) {
      this.createHintGroup(posKey, groupData, loadedTextures);
    }
  }

  private groupHintsByPosition(
    hints: Array<{
      hint: { name: string; categoryID: number; gfxID: number; mapID: number };
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
    }>
  ): Map<string, typeof hints> {
    const groups = new Map<string, typeof hints>();

    for (const hintData of hints) {
      const posKey = `${Math.round(hintData.pixelX)},${Math.round(hintData.pixelY)}`;
      const group = groups.get(posKey) ?? [];

      group.push(hintData);
      groups.set(posKey, group);
    }

    return groups;
  }

  private createHintGroup(
    posKey: string,
    groupData: Array<{
      hint: { name: string; categoryID: number; gfxID: number; mapID: number };
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
    }>,
    textures: Record<string, import('pixi.js').Texture>
  ): void {
    if (!this.hintManifest) {
      return;
    }

    const sprites: HintSprite[] = [];
    let hitArea: Graphics | null = null;

    if (groupData.length > 1) {
      hitArea = new Graphics();
      hitArea.eventMode = 'static';
      hitArea.cursor = 'pointer';
      hitArea.alpha = 0;
      this.hintsContainer.addChild(hitArea);
    }

    for (let i = 0; i < groupData.length; i++) {
      const hintData = groupData[i];
      const texture = textures[hintData.texturePath];

      if (!texture) {
        continue;
      }

      const sprite = new Sprite(texture) as HintSprite;
      sprite.anchor.set(0.5, 0.5);

      const halfWidth = hintData.hintInfo.width / 2;
      const halfHeight = hintData.hintInfo.height / 2;
      const baseX = hintData.pixelX + hintData.hintInfo.offsetX + halfWidth;
      const baseY = hintData.pixelY + hintData.hintInfo.offsetY + halfHeight;

      sprite.baseX = baseX;
      sprite.baseY = baseY;
      sprite.hintData = hintData.hint;
      sprite.groupKey = posKey;

      if (groupData.length > 1) {
        sprite.x = baseX + i * 2;
        sprite.y = baseY + i * 2;
      } else {
        sprite.x = baseX;
        sprite.y = baseY;
      }

      const hintScale = 1.2 / (this.hintManifest.supersample || 1);
      sprite.scale.set(hintScale);
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';

      sprites.push(sprite);
      this.hintsContainer.addChild(sprite);
    }

    if (sprites.length === 0) {
      return;
    }

    const group: HintGroup = {
      sprites,
      hitArea,
      visualCircle: null,
      isSpread: false,
    };

    this.hintGroups.set(posKey, group);

    if (sprites.length > 1 && hitArea) {
      this.setupMultiHintInteractions(posKey, sprites, hitArea);
    } else {
      this.setupSingleHintInteractions(sprites[0]);
    }
  }

  private setupMultiHintInteractions(
    posKey: string,
    sprites: HintSprite[],
    hitArea: Graphics
  ): void {
    const firstSprite = sprites[0];
    const deckSize = 20 + (sprites.length - 1) * 2;

    hitArea.rect(firstSprite.baseX - 10, firstSprite.baseY - 10, deckSize, deckSize);
    hitArea.fill({ color: 0xff0000, alpha: 0 });

    hitArea.on('pointerover', () => {
      this.spreadHints(posKey);
    });

    hitArea.on('pointerout', (e) => {
      const isOverAnySprite = sprites.some((s) => s.containsPoint(e.global));

      if (!isOverAnySprite) {
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
        const stillOverOther = sprites.some(
          (s) => s !== sprite && s.containsPoint(e.global)
        );

        if (!stillOverOther && !hitArea.containsPoint(e.global)) {
          this.collapseHints(posKey);
        }

        if (!stillOverOther) {
          this.hideTooltip();
        }
      });
    }
  }

  private setupSingleHintInteractions(sprite: HintSprite): void {
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

  private spreadHints(groupKey: string): void {
    const timer = this.collapseTimers.get(groupKey);

    if (timer) {
      clearTimeout(timer);
      this.collapseTimers.delete(groupKey);
    }

    const group = this.hintGroups.get(groupKey);

    if (!group || group.sprites.length <= 1 || group.isSpread) {
      return;
    }

    group.isSpread = true;

    const firstSprite = group.sprites[0] as HintSprite;
    const baseX = firstSprite.baseX;
    const baseY = firstSprite.baseY;

    const cardSpacing = 30;
    const maxRotation = 15;
    const angleStep = (maxRotation * 2) / (group.sprites.length - 1);

    group.sprites.forEach((sprite, index) => {
      const targetX = baseX + (index - (group.sprites.length - 1) / 2) * cardSpacing;
      const rotation = -maxRotation + index * angleStep;

      if (!sprite.filters) {
        sprite.filters = [
          new DropShadowFilter({
            offset: { x: 2, y: 2 },
            blur: 4,
            alpha: 0.5,
          }),
        ];
      }

      animateSprite(sprite, targetX, baseY, 150, rotation);
    });

    if (group.hitArea) {
      const totalWidth = (group.sprites.length - 1) * 30 + 30;

      group.hitArea.clear();
      group.hitArea.rect(baseX - totalWidth / 2, baseY - 20, totalWidth, 40);
      group.hitArea.fill({ color: 0xff0000, alpha: 0 });
    }
  }

  private collapseHints(groupKey: string): void {
    const existingTimer = this.collapseTimers.get(groupKey);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      const group = this.hintGroups.get(groupKey);

      if (!group || !group.isSpread) {
        return;
      }

      group.isSpread = false;

      group.sprites.forEach((sprite, index) => {
        sprite.filters = null;

        const hintSprite = sprite as HintSprite;
        animateSprite(
          sprite,
          hintSprite.baseX + index * 2,
          hintSprite.baseY + index * 2,
          150,
          0
        );
      });

      if (group.hitArea) {
        const firstSprite = group.sprites[0] as HintSprite;
        const deckSize = 20 + (group.sprites.length - 1) * 2;

        group.hitArea.clear();
        group.hitArea.rect(
          firstSprite.baseX - 10,
          firstSprite.baseY - 10,
          deckSize,
          deckSize
        );
        group.hitArea.fill({ color: 0xff0000, alpha: 0 });
      }

      this.collapseTimers.delete(groupKey);
    }, 250);

    this.collapseTimers.set(groupKey, timer);
  }

  private clearHintGroups(): void {
    this.collapseTimers.forEach((timer) => void clearTimeout(timer));
    this.collapseTimers.clear();
    this.hintGroups.clear();
  }

  private createCategoryUI(): void {
    if (!this.hintsData) {
      return;
    }

    this.uiContainer.removeChildren();

    const panelBg = new Graphics();
    panelBg.rect(10, 10, 250, 250);
    panelBg.fill({ color: 0x000000, alpha: 0.7 });
    panelBg.stroke({ color: 0x666666, width: 2 });
    this.uiContainer.addChild(panelBg);

    const title = new Text({
      text: 'Categories',
      style: new TextStyle({
        fontFamily: 'Arial',
        fontSize: 18,
        fontWeight: 'bold',
        fill: 0xffffff,
      }),
    });
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
      const isEnabled = this.enabledCategories.has(category.id);

      const checkbox = new Graphics();
      checkbox.rect(20, yPos, 20, 20);

      if (isEnabled) {
        checkbox.fill({ color: 0x44ff44 });
      } else {
        checkbox.fill({ color: 0x444444 });
      }

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
        style: categoryStyle,
      });
      label.x = 50;
      label.y = yPos + 2;
      this.uiContainer.addChild(label);

      const colorIndicator = new Graphics();
      colorIndicator.circle(230, yPos + 10, 6);
      colorIndicator.fill({ color: HINT_COLORS[category.color] ?? 0xffffff });
      this.uiContainer.addChild(colorIndicator);
    });
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
    const offset = 15;

    let tooltipX = x + offset;
    let tooltipY = y + offset;

    if (tooltipX + this.tooltip.width > this.app.screen.width) {
      tooltipX = x - this.tooltip.width - offset;
    }

    if (tooltipY + this.tooltip.height > this.app.screen.height) {
      tooltipY = y - this.tooltip.height - offset;
    }

    this.tooltip.x = tooltipX;
    this.tooltip.y = tooltipY;
  }

  private hideTooltip(): void {
    this.tooltip.visible = false;
  }

  show(): void {
    this.worldContainer.visible = true;
    this.uiContainer.visible = true;
  }

  hide(): void {
    this.worldContainer.visible = false;
    this.uiContainer.visible = false;
    this.clearHintGroups();
  }

  destroy(): void {
    if (this.wheelHandler) {
      this.app.canvas?.removeEventListener('wheel', this.wheelHandler);
    }

    this.clearHintGroups();
    this.worldContainer.destroy({ children: true, texture: false });
    this.uiContainer.destroy({ children: true, texture: false });
    this.tooltip.destroy({ children: true, texture: false });
  }
}
