import { Application, Container, Sprite, Texture, Graphics, Text, TextStyle, Assets } from 'pixi.js';
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

export class WorldMapRenderer {
  private app: Application | null = null;
  private container: HTMLElement;
  private mapContainer: Container | null = null;
  private hintsContainer: Container | null = null;
  private uiContainer: Container | null = null;
  private enabledCategories: Set<number> = new Set();
  private worldMapManifest: WorldMapManifest | null = null;
  private hintsData: HintsData | null = null;
  private hintManifest: HintManifest | null = null;
  private hintsLayering: HintsLayering | null = null;
  private mapCoordinates: MapCoordinates | null = null;
  private currentSuperarea = 0; // 0 = Amakna, 3 = Incarnam
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private worldContainer: Container | null = null;
  private tooltip: Container | null = null;
  private tooltipText: Text | null = null;
  private tooltipBg: Graphics | null = null;
  private currentZoom = 50; // Default zoom level from Dofus (50 = 0.5x scale)
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private hintGroups: Map<string, { sprites: Sprite[], hitArea: Graphics | null, visualCircle: Graphics | null, isSpread: boolean }> = new Map();
  private collapseTimers: Map<string, number> = new Map();

  private readonly DISPLAY_WIDTH = 742;
  private readonly DISPLAY_HEIGHT = 432;
  private readonly WORLD_MAP_CHUNK_SIZE = 15;
  private readonly WORLDMAP_SCALE = 1.0;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async init(): Promise<void> {
    this.app = new Application();
    await this.app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0xe5e5b9,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: false,
    });

    this.container.appendChild(this.app.canvas);

    // World container for pan/zoom
    this.worldContainer = new Container();
    this.mapContainer = new Container();
    this.hintsContainer = new Container();
    this.uiContainer = new Container();

    this.worldContainer.addChild(this.mapContainer);
    this.worldContainer.addChild(this.hintsContainer);

    this.app.stage.addChild(this.worldContainer);
    this.app.stage.addChild(this.uiContainer);

    // Create tooltip
    this.createTooltip();

    // Handle window resize
    window.addEventListener('resize', this.handleResize.bind(this));

    // Setup pan/zoom controls
    this.setupControls();

    // Enable all categories by default
    this.enabledCategories = new Set([1, 2, 3, 4, 5, 6]);
  }

  private handleResize(): void {
    if (!this.app) return;
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
  }

  private setupControls(): void {
    if (!this.app || !this.worldContainer) return;

    // Make world container interactive
    this.worldContainer.eventMode = 'static';
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;

    // Mouse wheel zoom - Dofus style (±5 per scroll)
    this.wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.worldContainer || !this.worldMapManifest) return;

      // Change zoom by ±5 (matching Dofus behavior)
      const zoomDelta = e.deltaY > 0 ? -5 : 5;
      const newZoom = this.currentZoom + zoomDelta;

      // Limit zoom levels (10 = 0.1x to 200 = 2x)
      if (newZoom < 10 || newZoom > 200) return;

      // Store mouse position before zoom
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      const worldPos = {
        x: (mouseX - this.worldContainer.x) / this.worldContainer.scale.x,
        y: (mouseY - this.worldContainer.y) / this.worldContainer.scale.y,
      };

      // Apply new zoom
      this.currentZoom = newZoom;
      const newScale = this.currentZoom / 100;
      this.worldContainer.scale.set(newScale);

      // Adjust position to zoom towards mouse cursor
      this.worldContainer.x = mouseX - worldPos.x * newScale;
      this.worldContainer.y = mouseY - worldPos.y * newScale;
    };

    // Attach to both container and canvas for better coverage
    this.container.addEventListener('wheel', this.wheelHandler, { passive: false });

    // Also attach to app.canvas when it's available
    if (this.app?.canvas) {
      this.app.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    // Mouse drag to pan
    this.app.stage.on('pointerdown', (e) => {
      // Ignore if clicking on UI elements
      if (this.uiContainer?.children.some(child => child.containsPoint(e.global))) {
        return;
      }

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

  async loadWorldMap(superarea: number = 0): Promise<void> {
    this.currentSuperarea = superarea;
    const worldMapName = superarea === 0 ? 'amakna' : 'incarnam';

    // Load manifests
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

    if (mapData && mapData.maps) {
      this.mapCoordinates = mapData.maps;
    }

    await this.renderWorldMap();
    await this.renderHints();
    this.createCategoryUI();
  }

  private async renderWorldMap(): Promise<void> {
    if (!this.mapContainer || !this.worldMapManifest) return;

    this.mapContainer.removeChildren();

    const { tile_size, tiles } = this.worldMapManifest;
    const worldMapName = this.worldMapManifest.worldmap;

    // Center the map immediately
    this.centerMap();

    // Load and display each tile as soon as it's ready
    const tilePromises = tiles.map(async (tileInfo) => {
      const texturePath = `/assets/maps/world/${worldMapName}/${tileInfo.file}`;

      try {
        const texture = await Assets.load(texturePath);

        if (texture && this.mapContainer) {
          const sprite = new Sprite(texture);
          sprite.x = tileInfo.x * tile_size;

          // Store original Y position for replaying animation
          const finalY = tileInfo.y * tile_size;
          (sprite as any).originalY = finalY;

          // Surfacing animation - start below and fade in
          sprite.alpha = 0;
          sprite.y = finalY + 20; // Start 20px below

          this.mapContainer.addChild(sprite);

          // Animate to final position
          this.animateTileSurface(sprite, finalY);
        }
      } catch (error) {
        console.warn(`Failed to load tile ${tileInfo.file}:`, error);
      }
    });

    // Wait for all tiles to load before returning
    await Promise.all(tilePromises);
  }

  private animateTileSurface(sprite: Sprite, targetY: number): void {
    const startY = sprite.y;
    const startTime = Date.now();
    const duration = 200; // 200ms animation

    const animate = () => {
      // Stop animation if canvas is hidden
      if (this.app?.canvas?.style.display === 'none') {
        sprite.y = targetY;
        sprite.alpha = 1;
        return;
      }

      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - (1 - progress) ** 3;

      sprite.y = startY + (targetY - startY) * eased;
      sprite.alpha = eased;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }

  private centerMap(): void {
    if (!this.app || !this.worldContainer || !this.worldMapManifest) return;

    const mapWidth = this.worldMapManifest.grid_size * this.worldMapManifest.tile_size;
    const mapHeight = this.worldMapManifest.grid_size * this.worldMapManifest.tile_size;

    // Apply zoom (zoom value / 100 = scale, e.g., 50 = 0.5x)
    const scale = this.currentZoom / 100;

    this.worldContainer.scale.set(scale);
    this.worldContainer.x = (this.app.screen.width - mapWidth * scale) / 2;
    this.worldContainer.y = (this.app.screen.height - mapHeight * scale) / 2;
  }

  private async renderHints(): Promise<void> {
    if (!this.hintsContainer || !this.hintsLayering || !this.worldMapManifest || !this.hintManifest) return;

    this.hintsContainer.removeChildren();
    this.hintGroups.clear();

    // Clear all collapse timers when re-rendering
    this.collapseTimers.forEach(timer => clearTimeout(timer));
    this.collapseTimers.clear();

    const { bounds } = this.worldMapManifest;
    const chunkXMin = bounds.xMin;
    const chunkYMin = bounds.yMin;

    // Collect all hint sprites to load
    const hintsToRender: Array<{
      hint: any;
      overlayX: number;
      overlayY: number;
      pixelX: number;
      pixelY: number;
      gfxID: string;
      hintInfo: any;
      texturePath: string;
    }> = [];

    const hintUrls: string[] = [];

    // Iterate through hint overlays (already sorted by Y coordinate for painter's algorithm)
    for (const overlay of this.hintsLayering.hint_overlays) {
      const overlayX = overlay.x;
      const overlayY = overlay.y;

      // Draw all hints at this overlay location
      for (const hint of overlay.hints) {
        const mapID = hint.mapID.toString();

        // Filter by superarea if coordinates are available
        if (this.mapCoordinates && this.mapCoordinates[mapID]) {
          if (this.mapCoordinates[mapID].sua !== this.currentSuperarea) {
            continue;
          }
        }

        // Filter by enabled categories
        if (!this.enabledCategories.has(hint.categoryID)) continue;

        // Convert overlay coordinates (game map coords) to pixel position
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

    // Load all hint textures in parallel
    if (hintUrls.length > 0) {
      const loadedTextures = await Assets.load(hintUrls);

      // Group hints by position
      const positionGroups = new Map<string, typeof hintsToRender>();
      for (const hintData of hintsToRender) {
        const posKey = `${Math.round(hintData.pixelX)},${Math.round(hintData.pixelY)}`;
        if (!positionGroups.has(posKey)) {
          positionGroups.set(posKey, []);
        }
        positionGroups.get(posKey)!.push(hintData);
      }

      // Create sprites from loaded textures
      for (const [posKey, groupData] of positionGroups.entries()) {
        const sprites: Sprite[] = [];

        // If multiple hints, create visual circle and hit area FIRST (so they render behind sprites)
        let visualCircle: Graphics | null = null;
        let hitArea: Graphics | null = null;

        if (groupData.length > 1) {
          // Visual box (behind everything)
          visualCircle = new Graphics();
          visualCircle.eventMode = 'none'; // Not interactive
          visualCircle.visible = false; // Hidden by default
          this.hintsContainer.addChild(visualCircle);

          // Hit area (behind sprites but interactive)
          hitArea = new Graphics();
          hitArea.eventMode = 'static';
          hitArea.cursor = 'pointer';
          hitArea.alpha = 0; // Invisible
          this.hintsContainer.addChild(hitArea);
        }

        for (let i = 0; i < groupData.length; i++) {
          const hintData = groupData[i];
          const texture = loadedTextures[hintData.texturePath];

          if (!texture) continue;

          const sprite = new Sprite(texture);

          // Set anchor to center for proper rotation
          sprite.anchor.set(0.5, 0.5);

          // Calculate position: when anchor is centered, we need to adjust for sprite dimensions
          // offsetX/offsetY compensate for the difference between top-left anchor and centered anchor
          const halfWidth = hintData.hintInfo.width / 2;
          const halfHeight = hintData.hintInfo.height / 2;
          const baseX = hintData.pixelX + hintData.hintInfo.offsetX + halfWidth;
          const baseY = hintData.pixelY + hintData.hintInfo.offsetY + halfHeight;

          (sprite as any).baseX = baseX;
          (sprite as any).baseY = baseY;

          // If multiple hints, stack them like a deck with slight offset
          if (groupData.length > 1) {
            const stackOffset = 2; // Small offset for stacking effect
            sprite.x = baseX + i * stackOffset;
            sprite.y = baseY + i * stackOffset;
          } else {
            sprite.x = baseX;
            sprite.y = baseY;
          }

          // Scale hints accounting for supersample
          // Base scale of 1.2 for visibility, divided by supersample to get correct size
          const hintScale = 1.2 / (this.hintManifest.supersample || 1);
          sprite.scale.set(hintScale);

          // Make sprite interactive for tooltips
          sprite.eventMode = 'static';
          sprite.cursor = 'pointer';

          // Store hint data for tooltips/interaction
          (sprite as any).hintData = hintData.hint;
          (sprite as any).groupKey = posKey;

          sprites.push(sprite);
          this.hintsContainer.addChild(sprite);
        }

        // Store group if multiple hints at same position
        if (sprites.length > 1 && hitArea && visualCircle) {
          const firstSprite = sprites[0];
          const baseX = (firstSprite as any).baseX;
          const baseY = (firstSprite as any).baseY;

          // Store hit area position (will be updated when spread)
          (hitArea as any).baseX = baseX;
          (hitArea as any).baseY = baseY;
          (hitArea as any).stackSize = groupData.length;

          // Draw initial hit area covering the stacked deck
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

          // Hit area hover behavior
          hitArea.on('pointerover', () => {
            this.spreadHints(posKey);
          });

          hitArea.on('pointerout', (e) => {
            // Only collapse if not moving to a sprite in the group
            const movingToSprite = sprites.some(s => s.containsPoint(e.global));
            if (!movingToSprite) {
              this.collapseHints(posKey);
              this.hideTooltip();
            }
          });

          // Add sprite hover behavior - both spreading and tooltips
          for (const sprite of sprites) {
            sprite.on('pointerover', (e) => {
              // Trigger spreading when hovering any sprite in the group
              this.spreadHints(posKey);
              this.showTooltip((sprite as any).hintData.name, e.global.x, e.global.y);
            });

            sprite.on('pointermove', (e) => {
              this.updateTooltipPosition(e.global.x, e.global.y);
            });

            sprite.on('pointerout', (e) => {
              // Only collapse if not over another sprite or the hit area
              const stillOverSprite = sprites.some(s => s !== sprite && s.containsPoint(e.global));
              const stillOverHitArea = hitArea && hitArea.containsPoint(e.global);

              if (!stillOverSprite && !stillOverHitArea) {
                this.collapseHints(posKey);
              }

              // Only hide tooltip if not over another sprite in the group
              if (!stillOverSprite) {
                this.hideTooltip();
              }
            });
          }
        } else {
          // Single hint - normal behavior
          const sprite = sprites[0];
          this.hintGroups.set(posKey, { sprites, hitArea: null, visualCircle: null, isSpread: false });

          sprite.on('pointerover', (e) => {
            this.showTooltip((sprite as any).hintData.name, e.global.x, e.global.y);
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
  }

  private spreadHints(groupKey: string): void {
    // Cancel any pending collapse
    const timer = this.collapseTimers.get(groupKey);
    if (timer) {
      clearTimeout(timer);
      this.collapseTimers.delete(groupKey);
    }

    const group = this.hintGroups.get(groupKey);
    if (!group || group.sprites.length <= 1 || group.isSpread) return;

    group.isSpread = true;

    // Get base position (original hint position)
    const firstSprite = group.sprites[0];
    const baseX = (firstSprite as any).baseX;
    const baseY = (firstSprite as any).baseY;

    // Card fan style - spread horizontally with rotation
    const cardSpacing = 30; // Horizontal spacing between cards
    const maxRotation = 15; // Max rotation angle in degrees
    const angleStep = group.sprites.length > 1 ? (maxRotation * 2) / (group.sprites.length - 1) : 0;

    group.sprites.forEach((sprite, index) => {
      const targetX = baseX + (index - (group.sprites.length - 1) / 2) * cardSpacing;
      const targetY = baseY;

      // Calculate rotation (fan effect)
      const rotation = -maxRotation + index * angleStep;

      // Add drop shadow when spreading
      if (!sprite.filters) {
        const dropShadow = new DropShadowFilter({
          offset: { x: 2, y: 2 },
          blur: 4,
          alpha: 0.5,
        });
        sprite.filters = [dropShadow];
      }

      // Animate spread
      this.animateSprite(sprite, targetX, targetY, 150, rotation);
    });

    // Hit area covering all fanned cards - tight fit
    if (group.hitArea) {
      const totalWidth = (group.sprites.length - 1) * 30 + 30; // Width of spread + sprite width
      const hitHeight = 40; // Tighter height

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
    // Clear any existing timer
    const existingTimer = this.collapseTimers.get(groupKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule collapse after delay (250ms to prevent flickering)
    const timer = window.setTimeout(() => {
      const group = this.hintGroups.get(groupKey);
      if (!group || !group.isSpread) return;

      group.isSpread = false;

      group.sprites.forEach((sprite, index) => {
        // Remove drop shadow when collapsing
        sprite.filters = null;

        // Animate back to stacked position with no rotation
        const stackOffset = 2;
        const baseX = (sprite as any).baseX;
        const baseY = (sprite as any).baseY;
        this.animateSprite(
          sprite,
          baseX + index * stackOffset,
          baseY + index * stackOffset,
          150,
          0 // Reset rotation to 0
        );
      });

      // Shrink hit area back to stacked deck size
      if (group.hitArea) {
        const baseX = (group.hitArea as any).baseX;
        const baseY = (group.hitArea as any).baseY;
        const stackSize = (group.hitArea as any).stackSize || 1;

        group.hitArea.clear();

        // Draw hit area covering the stacked deck
        const stackOffset = 2;
        const deckSize = 20 + (stackSize - 1) * stackOffset;
        group.hitArea.rect(
          baseX - 10,
          baseY - 10,
          deckSize,
          deckSize
        );
        group.hitArea.fill({ color: 0xff0000, alpha: 0 }); // Invisible
        group.hitArea.eventMode = 'static'; // Keep interactive
      }

      this.collapseTimers.delete(groupKey);
    }, 250);

    this.collapseTimers.set(groupKey, timer);
  }

  private animateSprite(sprite: Sprite, targetX: number, targetY: number, duration: number, targetRotation: number = 0): void {
    const startX = sprite.x;
    const startY = sprite.y;
    const startRotation = sprite.rotation;
    const targetRotationRad = (targetRotation * Math.PI) / 180; // Convert degrees to radians
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
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
    // Convert game map to chunk coordinate (float)
    const chunkX = gameMapX / this.WORLD_MAP_CHUNK_SIZE;
    const chunkY = gameMapY / this.WORLD_MAP_CHUNK_SIZE;

    // Calculate offset from minimum chunk bounds
    const offsetX = chunkX - chunkXMin;
    const offsetY = chunkY - chunkYMin;

    // Convert directly to pixels (top-left corner)
    const pixelX = Math.round(offsetX * this.DISPLAY_WIDTH * this.WORLDMAP_SCALE);
    const pixelY = Math.round(offsetY * this.DISPLAY_HEIGHT * this.WORLDMAP_SCALE);

    // Add half a map cell to center within it
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

    // Create checkboxes for each category
    const categoryStyle = new TextStyle({
      fontFamily: 'Arial',
      fontSize: 14,
      fill: 0xffffff,
    });

    this.hintsData.categories.forEach((category, index) => {
      const yPos = 50 + index * 30;

      // Checkbox background
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

      // Category label
      const label = new Text({
        text: category.name,
        style: categoryStyle
      });
      label.x = 50;
      label.y = yPos + 2;
      this.uiContainer.addChild(label);

      // Color indicator
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
    if (!this.app) return;

    this.tooltip = new Container();
    this.tooltip.visible = false;

    this.tooltipBg = new Graphics();
    this.tooltip.addChild(this.tooltipBg);

    const tooltipStyle = new TextStyle({
      fontFamily: 'bitMini6',
      fontSize: 14,
      fill: 0xffffff,
    });

    this.tooltipText = new Text({ text: '', style: tooltipStyle });
    this.tooltipText.x = 8;
    this.tooltipText.y = 6;
    this.tooltip.addChild(this.tooltipText);

    this.app.stage.addChild(this.tooltip);
  }

  private showTooltip(text: string, x: number, y: number): void {
    if (!this.tooltip || !this.tooltipText || !this.tooltipBg) return;

    this.tooltipText.text = text;

    // Redraw background to fit text
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
    if (!this.tooltip || !this.app) return;

    const offsetX = 15;
    const offsetY = 15;

    // Position tooltip, keeping it on screen
    let tooltipX = x + offsetX;
    let tooltipY = y + offsetY;

    // Check right edge
    if (tooltipX + this.tooltip.width > this.app.screen.width) {
      tooltipX = x - this.tooltip.width - offsetX;
    }

    // Check bottom edge
    if (tooltipY + this.tooltip.height > this.app.screen.height) {
      tooltipY = y - this.tooltip.height - offsetY;
    }

    this.tooltip.x = tooltipX;
    this.tooltip.y = tooltipY;
  }

  private hideTooltip(): void {
    if (this.tooltip) {
      this.tooltip.visible = false;
    }
  }

  show(): void {
    if (!this.app) return;

    // Show the canvas FIRST
    if (this.app.canvas) {
      this.app.canvas.style.display = 'block';
    }

    // Ensure renderer has correct size
    this.app.renderer.resize(window.innerWidth, window.innerHeight);

    // Start the ticker to resume rendering
    this.app.start();

    // Force an immediate render to show the first frame
    this.app.render();
  }

  hide(): void {
    // Stop the ticker to pause rendering
    if (this.app) {
      this.app.stop();
    }

    // Hide the canvas but keep everything in memory
    if (this.app?.canvas) {
      this.app.canvas.style.display = 'none';
    }

    // Clear any active collapse timers
    this.collapseTimers.forEach(timer => clearTimeout(timer));
    this.collapseTimers.clear();

    // Collapse all hint groups
    this.hintGroups.forEach((group) => {
      if (group.isSpread) {
        group.isSpread = false;
        group.sprites.forEach((sprite, index) => {
          sprite.filters = null;
          const stackOffset = 2;
          const baseX = (sprite as any).baseX;
          const baseY = (sprite as any).baseY;
          sprite.x = baseX + index * stackOffset;
          sprite.y = baseY + index * stackOffset;
          sprite.rotation = 0;
        });
        if (group.visualCircle) {
          group.visualCircle.visible = false;
        }
      }
    });
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleResize.bind(this));

    // Remove wheel event listeners
    if (this.wheelHandler) {
      this.container.removeEventListener('wheel', this.wheelHandler);
      if (this.app?.canvas) {
        this.app.canvas.removeEventListener('wheel', this.wheelHandler);
      }
    }

    // Clear all collapse timers
    this.collapseTimers.forEach(timer => clearTimeout(timer));
    this.collapseTimers.clear();

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
    }
  }
}
