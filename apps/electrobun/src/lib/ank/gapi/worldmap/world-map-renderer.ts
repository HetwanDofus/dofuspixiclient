import {
  type Application,
  Assets,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
} from "pixi.js";

import type {
  HintGroup,
  HintManifest,
  HintSpriteData,
  HintsData,
  HintsLayering,
  MapCoordinates,
  WorldMapManifest,
} from "@/types/worldmap";
import { HINT_COLORS, WORLDMAP_CONSTANTS } from "@/types/worldmap";

import { animateSprite, animateTileSurface } from "./animations";
import {
  filterHintsByArea,
  findMapAtCoord,
  loadWorldMapData,
  mapCoordToPixel,
  pixelToMapCoord,
} from "./world-map-data";

interface HintSprite extends Sprite, HintSpriteData {}

interface WorldMapRendererConfig {
  app: Application;
  parentContainer?: Container;
  onTeleport?: (mapId: number) => void;
}

export class WorldMapRenderer {
  private app: Application;
  private root: Container;
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

  private gridContainer: Container;
  private gridGraphics: Graphics;
  private showGrid = true;

  private positionMarker: Graphics;

  private hintGroups = new Map<string, HintGroup>();
  private collapseTimers = new Map<string, number>();
  private activeGroupKey: string | null = null;
  private groupShadows = new Map<string, Sprite[]>();
  private viewWidth: number;
  private viewHeight: number;
  private onTeleport?: (mapId: number) => void;
  private dragDistance = 0;
  private pointerDownPos = { x: 0, y: 0 };
  private lastClickTime = 0;
  private lastClickPos = { x: 0, y: 0 };

  constructor(config: WorldMapRendererConfig) {
    this.app = config.app;
    this.root = config.parentContainer ?? this.app.stage;
    this.viewWidth = this.app.screen.width;
    this.viewHeight = this.app.screen.height;

    this.worldContainer = new Container();
    this.mapContainer = new Container();
    this.gridContainer = new Container();
    this.gridGraphics = new Graphics();
    this.gridContainer.addChild(this.gridGraphics);
    this.hintsContainer = new Container();
    this.uiContainer = new Container();

    this.positionMarker = new Graphics();

    this.worldContainer.addChild(this.mapContainer);
    this.worldContainer.addChild(this.gridContainer);
    this.worldContainer.addChild(this.hintsContainer);
    this.worldContainer.addChild(this.positionMarker);

    this.root.addChild(this.worldContainer);
    this.root.addChild(this.uiContainer);

    this.tooltip = new Container();
    this.tooltip.visible = false;

    this.tooltipBg = new Graphics();
    this.tooltip.addChild(this.tooltipBg);

    this.tooltipText = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "bitMini6",
        fontSize: 14,
        fill: 0xffffff,
      }),
    });
    this.tooltipText.x = 8;
    this.tooltipText.y = 6;
    this.tooltip.addChild(this.tooltipText);

    this.root.addChild(this.tooltip);

    this.onTeleport = config.onTeleport;
    this.setupControls();
  }

  private setupControls(): void {
    this.worldContainer.eventMode = "static";
    this.root.eventMode = "static";

    this.setupZoomControl();
    this.setupDragControl();
    this.setupGroupTracking();
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
      this.clampPosition();
    };

    this.app.canvas?.addEventListener("wheel", this.wheelHandler, {
      passive: false,
    });
  }

  private clampPosition(): void {
    if (!this.manifest) return;
    const mapSize = this.manifest.grid_size * this.manifest.tile_size;
    const scale = this.currentZoom / 100;
    const scaledW = mapSize * scale;
    const scaledH = mapSize * scale;

    // Don't let the map leave the viewport entirely — keep at least half visible
    const minX = this.viewWidth - scaledW;
    const minY = this.viewHeight - scaledH;
    const maxX = 0;
    const maxY = 0;

    this.worldContainer.x = Math.max(
      minX,
      Math.min(maxX, this.worldContainer.x)
    );
    this.worldContainer.y = Math.max(
      minY,
      Math.min(maxY, this.worldContainer.y)
    );
  }

  private isPointOverUI(x: number, y: number): boolean {
    if (!this.uiContainer.visible) return false;
    const bounds = this.uiContainer.getBounds();
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  private setupDragControl(): void {
    this.root.on("pointerdown", (e) => {
      // Don't start drag when clicking on the category UI panel
      if (this.isPointOverUI(e.global.x, e.global.y)) return;

      this.isDragging = true;
      this.dragDistance = 0;
      this.pointerDownPos.x = e.global.x;
      this.pointerDownPos.y = e.global.y;
      this.dragStart.x = e.global.x - this.worldContainer.x;
      this.dragStart.y = e.global.y - this.worldContainer.y;

      if (this.app.canvas) {
        this.app.canvas.style.cursor = "grabbing";
      }
    });

    this.root.on("pointermove", (e) => {
      if (!this.isDragging) return;
      const dx = e.global.x - this.pointerDownPos.x;
      const dy = e.global.y - this.pointerDownPos.y;
      this.dragDistance = Math.sqrt(dx * dx + dy * dy);
      this.worldContainer.x = e.global.x - this.dragStart.x;
      this.worldContainer.y = e.global.y - this.dragStart.y;
      this.clampPosition();
    });

    const stopDrag = (e?: { global: { x: number; y: number } }) => {
      const wasDrag = this.dragDistance > 5;
      this.isDragging = false;
      if (this.app.canvas) {
        this.app.canvas.style.cursor = "default";
      }

      // Manual double-click detection (not a drag)
      if (!wasDrag && e) {
        const now = performance.now();
        const dx = e.global.x - this.lastClickPos.x;
        const dy = e.global.y - this.lastClickPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (now - this.lastClickTime < 400 && dist < 20) {
          this.handleDoubleClick(e.global.x, e.global.y);
          this.lastClickTime = 0;
        } else {
          this.lastClickTime = now;
          this.lastClickPos.x = e.global.x;
          this.lastClickPos.y = e.global.y;
        }
      }
    };

    this.root.on("pointerup", (e) => stopDrag(e));
    this.root.on("pointerupoutside", () => stopDrag());
  }

  private handleDoubleClick(screenX: number, screenY: number): void {
    if (!this.manifest || !this.mapCoordinates || !this.onTeleport) return;

    const { bounds } = this.manifest;

    // Convert screen position to world-container-local coordinates
    const localX =
      (screenX - this.worldContainer.x) / this.worldContainer.scale.x;
    const localY =
      (screenY - this.worldContainer.y) / this.worldContainer.scale.y;

    // Convert pixel to game map coordinates
    const coord = pixelToMapCoord(localX, localY, bounds.xMin, bounds.yMin);

    const mapId = findMapAtCoord(coord.x, coord.y, this.mapCoordinates);
    if (mapId != null) {
      this.onTeleport(mapId);
    }
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
    this.drawGrid();
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

  setViewSize(w: number, h: number): void {
    this.viewWidth = w;
    this.viewHeight = h;
  }

  private centerMap(): void {
    if (!this.manifest) {
      return;
    }

    const mapSize = this.manifest.grid_size * this.manifest.tile_size;

    // Auto-fit: calculate zoom so the map fills the available height
    const fitZoom = (this.viewHeight / mapSize) * 100;
    this.currentZoom = Math.max(
      WORLDMAP_CONSTANTS.MIN_ZOOM,
      Math.min(fitZoom, WORLDMAP_CONSTANTS.MAX_ZOOM)
    );

    const scale = this.currentZoom / 100;
    this.worldContainer.scale.set(scale);
    this.worldContainer.x = (this.viewWidth - mapSize * scale) / 2;
    this.worldContainer.y = (this.viewHeight - mapSize * scale) / 2;
  }

  private drawGrid(): void {
    if (!this.manifest) return;

    this.gridGraphics.clear();
    if (!this.showGrid) return;

    const { bounds } = this.manifest;
    const { DISPLAY_WIDTH, DISPLAY_HEIGHT, CHUNK_SIZE } = WORLDMAP_CONSTANTS;

    // Bounds are inclusive — each chunk is one SWF sprite rendered at DISPLAY_WIDTH × DISPLAY_HEIGHT
    const chunksX = bounds.xMax - bounds.xMin + 1;
    const chunksY = bounds.yMax - bounds.yMin + 1;

    // Each chunk is exactly DISPLAY_WIDTH × DISPLAY_HEIGHT pixels in tile space
    const totalW = chunksX * DISPLAY_WIDTH;
    const totalH = chunksY * DISPLAY_HEIGHT;

    // Pixels per game-map cell within a chunk
    const cellW = DISPLAY_WIDTH / CHUNK_SIZE;
    const cellH = DISPLAY_HEIGHT / CHUNK_SIZE;

    const totalCellsX = chunksX * CHUNK_SIZE;
    const totalCellsY = chunksY * CHUNK_SIZE;

    const gridColor = 0x000000;
    const gridAlpha = 0.12;

    // Vertical lines
    for (let i = 0; i <= totalCellsX; i++) {
      const x = i * cellW;
      this.gridGraphics.rect(x, 0, 1, totalH);
      this.gridGraphics.fill({ color: gridColor, alpha: gridAlpha });
    }

    // Horizontal lines
    for (let j = 0; j <= totalCellsY; j++) {
      const y = j * cellH;
      this.gridGraphics.rect(0, y, totalW, 1);
      this.gridGraphics.fill({ color: gridColor, alpha: gridAlpha });
    }
  }

  toggleGrid(): boolean {
    this.showGrid = !this.showGrid;
    this.drawGrid();
    return this.showGrid;
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
    textures: Record<string, import("pixi.js").Texture>
  ): void {
    if (!this.hintManifest) {
      return;
    }

    const sprites: HintSprite[] = [];

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
      sprite.eventMode = "static";
      sprite.cursor = "pointer";

      sprites.push(sprite);
      this.hintsContainer.addChild(sprite);
    }

    if (sprites.length === 0) {
      return;
    }

    const group: HintGroup = {
      sprites,
      hitArea: null,
      visualCircle: null,
      isSpread: false,
    };

    this.hintGroups.set(posKey, group);

    if (sprites.length > 1) {
      this.setupMultiHintInteractions(posKey, sprites);
    } else {
      this.setupSingleHintInteractions(sprites[0]);
    }
  }

  private setupMultiHintInteractions(
    posKey: string,
    sprites: HintSprite[]
  ): void {
    // Sprite pointerover triggers spread + tooltip.
    // Collapse is handled by the global pointermove on worldContainer (setupGroupTracking).
    for (const sprite of sprites) {
      sprite.on("pointerover", (e) => {
        this.activeGroupKey = posKey;
        this.spreadHints(posKey);
        this.showTooltip(sprite.hintData.name, e.global.x, e.global.y);
      });

      sprite.on("pointermove", (e) => {
        this.updateTooltipPosition(e.global.x, e.global.y);
      });

      sprite.on("pointerout", () => {
        this.hideTooltip();
      });
    }
  }

  /** Global pointermove: collapse the active group when cursor moves far enough away. */
  private setupGroupTracking(): void {
    this.worldContainer.on("globalpointermove", (e) => {
      if (!this.activeGroupKey) return;

      const group = this.hintGroups.get(this.activeGroupKey);
      if (!group || !group.isSpread) {
        this.activeGroupKey = null;
        return;
      }

      const firstSprite = group.sprites[0] as HintSprite;

      // Convert group center to screen coordinates
      const centerScreen = this.worldContainer.toGlobal({
        x: firstSprite.baseX,
        y: firstSprite.baseY,
      });
      const dx = e.global.x - centerScreen.x;
      const dy = e.global.y - centerScreen.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Collapse when cursor is more than 150 screen pixels from group center
      if (dist > 150) {
        this.collapseHints(this.activeGroupKey);
        this.hideTooltip();
        this.activeGroupKey = null;
      }
    });
  }

  private setupSingleHintInteractions(sprite: HintSprite): void {
    sprite.on("pointerover", (e) => {
      this.showTooltip(sprite.hintData.name, e.global.x, e.global.y);
    });

    sprite.on("pointermove", (e) => {
      this.updateTooltipPosition(e.global.x, e.global.y);
    });

    sprite.on("pointerout", () => {
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

    const shadows: Sprite[] = [];
    const firstIdx = this.hintsContainer.getChildIndex(group.sprites[0]);

    group.sprites.forEach((sprite, index) => {
      const targetX =
        baseX + (index - (group.sprites.length - 1) / 2) * cardSpacing;
      const rotation = -maxRotation + index * angleStep;

      // Create a shadow sprite: a blurred, darkened copy offset behind the original
      const shadow = new Sprite(sprite.texture);
      shadow.anchor.copyFrom(sprite.anchor);
      shadow.scale.copyFrom(sprite.scale);
      shadow.x = sprite.x + 2;
      shadow.y = sprite.y + 2;
      shadow.alpha = 0.4;
      shadow.tint = 0x000000;
      shadow.filters = [new BlurFilter({ strength: 3, quality: 2 })];
      shadow.eventMode = "none";
      this.hintsContainer.addChildAt(shadow, firstIdx);
      shadows.push(shadow);

      animateSprite(shadow, targetX + 2, baseY + 2, 150, rotation);
      animateSprite(sprite, targetX, baseY, 150, rotation);
    });

    this.groupShadows.set(groupKey, shadows);
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

      // Remove shadow sprites
      const shadows = this.groupShadows.get(groupKey);
      if (shadows) {
        for (const s of shadows) {
          s.destroy();
        }
        this.groupShadows.delete(groupKey);
      }

      group.sprites.forEach((sprite, index) => {
        const hintSprite = sprite as HintSprite;
        animateSprite(
          sprite,
          hintSprite.baseX + index * 2,
          hintSprite.baseY + index * 2,
          150,
          0
        );
      });

      this.collapseTimers.delete(groupKey);
    }, 250);

    this.collapseTimers.set(groupKey, timer);
  }

  private clearHintGroups(): void {
    this.collapseTimers.forEach((timer) => void clearTimeout(timer));
    this.collapseTimers.clear();
    this.groupShadows.forEach((shadows) => {
      for (const s of shadows) s.destroy();
    });
    this.groupShadows.clear();
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
      text: "Categories",
      style: new TextStyle({
        fontFamily: "Arial",
        fontSize: 18,
        fontWeight: "bold",
        fill: 0xffffff,
      }),
    });
    title.x = 20;
    title.y = 20;
    this.uiContainer.addChild(title);

    const categoryStyle = new TextStyle({
      fontFamily: "Arial",
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
      checkbox.cursor = "pointer";

      checkbox.on("pointerdown", () => {
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

    // Grid toggle — below categories
    const gridYPos = 50 + this.hintsData.categories.length * 30 + 10;

    const gridCheckbox = new Graphics();
    gridCheckbox.rect(20, gridYPos, 20, 20);
    gridCheckbox.fill({ color: this.showGrid ? 0x44ff44 : 0x444444 });
    gridCheckbox.stroke({ color: 0xffffff, width: 1 });
    gridCheckbox.interactive = true;
    gridCheckbox.cursor = "pointer";
    gridCheckbox.on("pointerdown", () => {
      this.toggleGrid();
      this.createCategoryUI();
    });
    this.uiContainer.addChild(gridCheckbox);

    const gridLabel = new Text({
      text: "Grille",
      style: categoryStyle,
    });
    gridLabel.x = 50;
    gridLabel.y = gridYPos + 2;
    this.uiContainer.addChild(gridLabel);

    // Resize panel bg to fit
    const totalH = gridYPos + 30 + 10;
    panelBg.clear();
    panelBg.rect(10, 10, 250, totalH - 10);
    panelBg.fill({ color: 0x000000, alpha: 0.7 });
    panelBg.stroke({ color: 0x666666, width: 2 });
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

    if (tooltipX + this.tooltip.width > this.viewWidth) {
      tooltipX = x - this.tooltip.width - offset;
    }

    if (tooltipY + this.tooltip.height > this.viewHeight) {
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
    this.hideTooltip();

    // Collapse any spread group immediately (without destroying group data)
    if (this.activeGroupKey) {
      const group = this.hintGroups.get(this.activeGroupKey);
      if (group?.isSpread) {
        group.isSpread = false;

        const shadows = this.groupShadows.get(this.activeGroupKey);
        if (shadows) {
          for (const s of shadows) s.destroy();
          this.groupShadows.delete(this.activeGroupKey);
        }

        group.sprites.forEach((sprite, index) => {
          const hs = sprite as HintSprite;
          sprite.x = hs.baseX + index * 2;
          sprite.y = hs.baseY + index * 2;
          sprite.rotation = 0;
        });
      }
      this.activeGroupKey = null;
    }

    // Clear pending collapse timers but keep hintGroups intact
    this.collapseTimers.forEach((timer) => clearTimeout(timer));
    this.collapseTimers.clear();
  }

  /** Center the view on a specific map ID. */
  centerOnMapId(mapId: number): void {
    if (!this.manifest || !this.mapCoordinates) return;

    const coord = this.mapCoordinates[mapId.toString()];
    if (!coord) return;

    const { bounds } = this.manifest;
    const [pixelX, pixelY] = mapCoordToPixel(
      coord.x,
      coord.y,
      bounds.xMin,
      bounds.yMin
    );

    const scale = this.currentZoom / 100;
    this.worldContainer.x = this.viewWidth / 2 - pixelX * scale;
    this.worldContainer.y = this.viewHeight / 2 - pixelY * scale;
    this.clampPosition();
    this.drawPositionMarker(pixelX, pixelY);
  }

  private drawPositionMarker(pixelX: number, pixelY: number): void {
    const cellW = WORLDMAP_CONSTANTS.DISPLAY_WIDTH / WORLDMAP_CONSTANTS.CHUNK_SIZE;
    const cellH = WORLDMAP_CONSTANTS.DISPLAY_HEIGHT / WORLDMAP_CONSTANTS.CHUNK_SIZE;

    this.positionMarker.clear();
    this.positionMarker.rect(
      pixelX - cellW / 2,
      pixelY - cellH / 2,
      cellW,
      cellH
    );
    this.positionMarker.fill({ color: 0xff0000, alpha: 0.5 });
    this.positionMarker.stroke({ color: 0xff0000, width: 1, alpha: 0.5 });
  }

  destroy(): void {
    if (this.wheelHandler) {
      this.app.canvas?.removeEventListener("wheel", this.wheelHandler);
    }

    this.clearHintGroups();
    this.worldContainer.destroy({ children: true, texture: false });
    this.uiContainer.destroy({ children: true, texture: false });
    this.tooltip.destroy({ children: true, texture: false });
  }
}
