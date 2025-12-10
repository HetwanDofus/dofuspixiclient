import { Application, Container, Sprite, AnimatedSprite, Assets, Texture, RenderTexture, TextureSource, Ticker, Graphics, Text, TextStyle } from 'pixi.js';
import 'pixi.js/ktx2';
import { GameWorld } from './GameWorld';
import { SpriteRenderSystem } from './SpriteRenderSystem';
import { RegionAtlasLoader, type WebpManifest } from './region-atlas-loader';

TextureSource.defaultOptions.scaleMode = 'nearest';      // NEAREST sampling
TextureSource.defaultOptions.mipmapFilter = 'nearest';   // NEAREST between mip levels
TextureSource.defaultOptions.autoGenerateMipmaps = false;

const GAME_WIDTH = 1049;
const GAME_HEIGHT = 786;

const ROT_SCALE_X = 51.85 / 100;
const ROT_SCALE_Y = 192.86 / 100;

interface MapData {
  id: number;
  width: number;
  height: number;
  backgroundNum?: number;
  cells: MapCell[];
}

interface MapCell {
  id: number;
  ground: number;
  layer1: number;
  layer2: number;
  groundLevel: number;
  groundSlope?: number;
  layerGroundRot: number;
  layerGroundFlip: boolean;
  layerObject1Rot: number;
  layerObject1Flip: boolean;
  layerObject2Rot: number;
  layerObject2Flip: boolean;
}

interface AtlasFrame {
  frame: number;
  x: number;
  y: number;
  w: number;
  h: number;
  trimX?: number;
  trimY?: number;
  origW?: number;
  origH?: number;
  atlas?: number; // For multi-atlas tiles
}

interface AtlasData {
  width: number;
  height: number;
  file: string;
  files?: string[]; // For multi-atlas tiles
  frames: AtlasFrame[];
}

interface TileData {
  id: number;
  type: 'ground' | 'objects';
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  frameCount: number;
  behavior: string | null;
  fps: number | null;
  autoplay: boolean | null;
  loop: boolean | null;
  atlases: Record<string, AtlasData>;
}

interface TilesManifest {
  scales: number[];
  tiles: Record<string, TileData>;
}

const MAP_CONSTANTS = {
  DISPLAY_WIDTH: 742,
  DISPLAY_HEIGHT: 432,
  CELL_WIDTH: 53,
  CELL_HEIGHT: 27,
  CELL_HALF_WIDTH: 26.5,
  CELL_HALF_HEIGHT: 13.5,
  DEFAULT_WIDTH: 15,
  DEFAULT_HEIGHT: 17,
};

export class MapRendererEngine {
  private container: HTMLElement;
  private app: Application | null = null;
  private mapContainer: Container | null = null;
  private manifest: TilesManifest | null = null;
  private textureCache: Map<string, any> = new Map();
  private cachedMapTexture: RenderTexture | null = null;
  private cachedMapSprite: Sprite | null = null;

  // Region-based atlas loader
  private regionLoader: RegionAtlasLoader | null = null;
  private regionManifest: WebpManifest | null = null;

  // Game logic
  private gameWorld: GameWorld;
  private renderSystem: SpriteRenderSystem;

  private fps = 0;
  private frameCount = 0;
  private lastFpsUpdate = Date.now();
  private currentZoom = 1.5;
  private minZoom = 1.5;
  private zoomLevels = [1.5, 2, 2.5, 3];
  private currentZoomIndex = 0;
  private currentTileScale: number | null = null;
  private lastFrameTimeMs = 0;
  private lastDrawCalls = 0;
  private currentMapData: MapData | null = null;
  private mapBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  private spriteCount = 0;
  private animatedSprites: AnimatedSprite[] = [];
  private animatedLayer: Container | null = null;

  // Debug overlay
  private debugOverlay: Container | null = null;
  private debugVisible = false;
  private debugText: Text | null = null;
  private debugDiamond: Graphics | null = null;
  private hoveredCell: MapCell | null = null;

  private isDragging = false;
  private lastPointerPos = { x: 0, y: 0 };
  private resizeObserver: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.gameWorld = new GameWorld();
    this.renderSystem = new SpriteRenderSystem(this.gameWorld);
  }

  async init() {
    this.app = new Application();

    // Calculate canvas size to fit container while maintaining aspect ratio
    const { width, height, zoom } = this.calculateCanvasSize();

    // Set initial zoom
    this.currentZoom = zoom;
    this.minZoom = 1.5;

    await this.app.init({
      width,
      height,
      backgroundColor: 0x000000,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgpu',
    });

    if (this.app.canvas && this.container) {
      this.container.appendChild(this.app.canvas);
    }

    // Hook into render to measure performance
    if (this.app) {
      const appAny: any = this.app;
      const originalRender = appAny.render?.bind(appAny);
      if (typeof originalRender === 'function') {
        appAny.render = (...args: any[]) => {
          this.lastDrawCalls = 0;
          const start = performance.now();
          originalRender(...args);
          const end = performance.now();
          this.lastFrameTimeMs = end - start;
        };
      }

      const rendererAny: any = appAny.renderer;
      const batchPipe: any = rendererAny?.renderPipes?.batch;
      if (batchPipe && typeof batchPipe.execute === 'function') {
        const originalExecute = batchPipe.execute.bind(batchPipe);
        batchPipe.execute = (batch: any, ...rest: any[]) => {
          if (batch && batch.renderPipeId === 'batch' && batch.size > 0) {
            this.lastDrawCalls++;
          }
          return originalExecute(batch, ...rest);
        };
      }
    }

    // Create map container
    this.mapContainer = new Container();
    this.app.stage.addChild(this.mapContainer);

    // Enable interactivity
    this.app.stage.eventMode = 'static';
    this.mapContainer.eventMode = 'static';

    if (this.app.canvas) {
      this.app.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
    }

    this.app.stage.on('pointerdown', (e) => this.handlePointerDown(e));
    this.app.stage.on('pointermove', (e) => this.handlePointerMove(e));
    this.app.stage.on('pointerup', () => this.handlePointerUp());
    this.app.stage.on('pointerupoutside', () => this.handlePointerUp());

    // Game update loop - sync ECS state to render
    this.app.ticker.add((ticker) => {
      // Update sprite positions from game world
      this.renderSystem.update();

      this.frameCount++;
      const now = Date.now();
      if (now - this.lastFpsUpdate >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsUpdate = now;
      }
    });

    // Handle container resize using ResizeObserver
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
    this.resizeObserver.observe(this.container);

    // Also handle window resize as fallback
    window.addEventListener('resize', () => {
      this.handleResize();
    });

    // Debug overlay toggle with 'D' key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        this.toggleDebugOverlay();
      }
    });

    console.log('MapRendererEngine initialized');
  }

  /**
   * Toggle debug overlay showing cell IDs and tile info
   */
  toggleDebugOverlay(): void {
    this.debugVisible = !this.debugVisible;
    if (this.debugOverlay) {
      this.debugOverlay.visible = this.debugVisible;
    }
    console.log(`Debug overlay: ${this.debugVisible ? 'ON' : 'OFF'}`);
  }

  private calculateCanvasSize(): { width: number; height: number; zoom: number } {
    const containerWidth = this.container.clientWidth || 1113;
    const containerHeight = this.container.clientHeight || 648;

    const { DISPLAY_WIDTH, DISPLAY_HEIGHT } = MAP_CONSTANTS;

    // Calculate zoom to fit container while maintaining aspect ratio
    const scaleX = containerWidth / DISPLAY_WIDTH;
    const scaleY = containerHeight / DISPLAY_HEIGHT;

    // Use the smaller scale to ensure map fits entirely
    // Clamp between 0.5 and 3 for reasonable quality range
    const zoom = Math.max(0.5, Math.min(3, Math.min(scaleX, scaleY)));

    return {
      width: Math.floor(DISPLAY_WIDTH * zoom),
      height: Math.floor(DISPLAY_HEIGHT * zoom),
      zoom: zoom
    };
  }

  private handleResize() {
    if (!this.app || !this.app.canvas) return;

    const { width, height, zoom } = this.calculateCanvasSize();

    if (width > 0 && height > 0) {
      // Resize the renderer
      this.app.renderer.resize(width, height);

      // Also set canvas element size explicitly
      if (this.app.canvas) {
        this.app.canvas.style.width = `${width}px`;
        this.app.canvas.style.height = `${height}px`;
      }

      // Update zoom if changed and map is loaded
      if (this.currentMapData) {
        this.currentZoom = zoom;
        this.mapContainer.scale.set(zoom);

        // Only rebuild map if texture scale changes (e.g., switching from 1.5x to 2x assets)
        const newTargetScale = this.getTargetScaleForZoom();
        if (this.currentTileScale !== newTargetScale) {
          this.textureCache.clear();
          this.currentTileScale = newTargetScale;
          this.renderMap(this.currentMapData);
        }

        this.clampCameraToBounds();
      }
    }
  }

  // Get current viewport size - use canvas/renderer size, not container
  private getViewportSize(): { width: number; height: number } {
    if (this.app && this.app.renderer) {
      return {
        width: this.app.renderer.width,
        height: this.app.renderer.height
      };
    }
    // Fallback to map size at 1.5x zoom
    const { DISPLAY_WIDTH, DISPLAY_HEIGHT } = MAP_CONSTANTS;
    return {
      width: Math.floor(DISPLAY_WIDTH * 1.5),
      height: Math.floor(DISPLAY_HEIGHT * 1.5)
    };
  }

  handleWheel(e: WheelEvent) {
    e.preventDefault();
    if (!this.app || !this.app.canvas) return;

    const rect = this.app.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Step through discrete zoom levels
    const direction = e.deltaY < 0 ? 1 : -1;
    this.stepZoom(direction, mouseX, mouseY);
  }

  handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (!this.app || !this.app.canvas) return;

    const rect = this.app.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const direction = e.shiftKey ? -1 : 1;
    this.stepZoom(direction, mouseX, mouseY);
  }

  private stepZoom(direction: number, anchorX?: number, anchorY?: number) {
    const newIndex = Math.max(0, Math.min(this.zoomLevels.length - 1, this.currentZoomIndex + direction));
    if (newIndex === this.currentZoomIndex) return;

    this.currentZoomIndex = newIndex;
    this.setZoom(this.zoomLevels[newIndex]!, anchorX, anchorY);
  }

  private handlePointerDown(e: any) {
    this.isDragging = true;
    this.lastPointerPos = { x: e.global.x, y: e.global.y };
  }

  private handlePointerMove(e: any) {
    // Update debug overlay on hover
    if (this.debugVisible) {
      this.updateDebugOverlay(e.global.x, e.global.y);
    }

    if (!this.isDragging || !this.mapContainer) return;

    const dx = e.global.x - this.lastPointerPos.x;
    const dy = e.global.y - this.lastPointerPos.y;

    this.mapContainer.x += dx;
    this.mapContainer.y += dy;

    this.lastPointerPos = { x: e.global.x, y: e.global.y };
    this.clampCameraToBounds();
  }

  private handlePointerUp() {
    this.isDragging = false;
  }

  private async setZoom(newZoom: number, anchorX?: number, anchorY?: number) {
    if (!this.mapContainer || newZoom === this.currentZoom) return;

    const oldZoom = this.currentZoom;
    const container = this.mapContainer;

    const hasAnchor = anchorX !== undefined && anchorY !== undefined;
    let localX = 0;
    let localY = 0;
    let screenX = 0;
    let screenY = 0;

    if (hasAnchor) {
      screenX = anchorX as number;
      screenY = anchorY as number;
      // Convert screen coordinates to local container coordinates BEFORE zoom
      localX = (screenX - container.x) / oldZoom;
      localY = (screenY - container.y) / oldZoom;
    }

    this.currentZoom = newZoom;
    container.scale.set(this.currentZoom);

    // Only rebuild the static map (and thus swap atlas scales) when the
    // desired texture scale actually changes. This avoids re-creating all
    // sprites on every tiny zoom step and gives a big performance win while
    // still switching to higher-res atlases when needed.
    let shouldRebuildMap = false;
    if (this.manifest) {
      const newTargetScale = this.getTargetScaleForZoom();
      if (this.currentTileScale === null || newTargetScale !== this.currentTileScale) {
        shouldRebuildMap = true;
      }
    }

    if (shouldRebuildMap) {
      this.textureCache.clear();
      if (this.currentMapData) {
        await this.renderMap(this.currentMapData);
      }
    }

    if (hasAnchor) {
      // Keep the anchor point fixed on screen as we zoom
      // Formula: container.position = screen_point - local_point * new_zoom
      container.x = screenX - localX * this.currentZoom;
      container.y = screenY - localY * this.currentZoom;
    }

    this.clampCameraToBounds();
  }

  private clampCameraToBounds() {
    if (!this.mapContainer) return;

    const zoom = this.currentZoom;
    const { DISPLAY_WIDTH, DISPLAY_HEIGHT } = MAP_CONSTANTS;

    // Map dimensions at current zoom
    const mapWidth = DISPLAY_WIDTH * zoom;
    const mapHeight = DISPLAY_HEIGHT * zoom;

    const { width: viewportWidth, height: viewportHeight } = this.getViewportSize();

    // Horizontal clamping
    let minContainerX: number;
    let maxContainerX: number;
    if (mapWidth <= viewportWidth) {
      // Center horizontally if map fits
      const centeredX = (viewportWidth - mapWidth) / 2;
      minContainerX = maxContainerX = centeredX;
    } else {
      // Allow panning if map is larger than viewport
      maxContainerX = 0;
      minContainerX = viewportWidth - mapWidth;
    }

    // Vertical clamping
    let minContainerY: number;
    let maxContainerY: number;
    if (mapHeight <= viewportHeight) {
      // Center vertically if map fits
      const centeredY = (viewportHeight - mapHeight) / 2;
      minContainerY = maxContainerY = centeredY;
    } else {
      // Allow panning if map is larger than viewport
      maxContainerY = 0;
      minContainerY = viewportHeight - mapHeight;
    }

    this.mapContainer.x = Math.min(Math.max(this.mapContainer.x, minContainerX), maxContainerX);
    this.mapContainer.y = Math.min(Math.max(this.mapContainer.y, minContainerY), maxContainerY);
  }

  private getTargetScaleForZoom(): number {
    if (!this.manifest || !Array.isArray(this.manifest.scales) || this.manifest.scales.length === 0) {
      return 1.5;
    }

    // Map zoom levels to atlas scales: 1.5→1.5x, 2→2x, 2.5→3x, 3→3x
    const scales = [...this.manifest.scales].sort((a, b) => a - b);

    // Find the best scale that matches or exceeds current zoom
    for (const s of scales) {
      if (s >= this.currentZoom) return s;
    }
    return scales[scales.length - 1] ?? 1.5;
  }

  private getBestAvailableScale(tile: TileData, targetScale: number): number {
    const scales: number[] = Object.keys(tile.atlases)
      .map((k) => Number(k))
      .filter((s) => !Number.isNaN(s))
      .sort((a, b) => a - b);

    if (scales.length === 0) return targetScale || 1;

    let best: number | null = null;
    for (const scale of scales) {
      if (scale <= targetScale) {
        if (best === null || scale > best) best = scale;
      }
    }

    if (best !== null) return best;
    return scales[0];
  }

  async loadManifest() {
    if (this.assetMode === 'regions') {
      // Load region-based WebP manifest
      const response = await fetch('/assets/maps/tilesv4/manifest.json');
      this.regionManifest = await response.json();
      // Also set legacy manifest for compatibility
      this.manifest = this.regionManifest as unknown as TilesManifest;
      console.log('Region manifest loaded with scales:', this.regionManifest?.scales);

      // Initialize region loader
      if (this.app) {
        this.regionLoader = new RegionAtlasLoader(this.app.renderer, '/assets/maps/tilesv4');
      }
    } else {
      const response = await fetch('/assets/maps/tilesv2/manifest.json');
      this.manifest = await response.json();
      console.log('Manifest loaded with scales:', this.manifest?.scales);
    }
  }

  async loadMap(mapId: number) {
    if (!this.app || !this.mapContainer) return;

    console.log(`Loading map ${mapId}...`);

    const response = await fetch(`/assets/maps/${mapId}.json`);
    const mapData: MapData = await response.json();

    console.log(`Map ${mapId} loaded:`, mapData.width, 'x', mapData.height);

    this.currentMapData = mapData;
    this.mapContainer.removeChildren();
    this.spriteCount = 0;

    // Reset transform before rendering a new map
    this.mapContainer.x = 0;
    this.mapContainer.y = 0;

    // Maintain current zoom from container size
    // (already set in init() based on container dimensions)

    if (this.cachedMapTexture) {
      this.cachedMapTexture.destroy(true);
      this.cachedMapTexture = null;
      this.cachedMapSprite = null;
    }

    await this.renderMap(mapData);

    console.log('Map rendered successfully, bounds:', this.mapBounds);
  }

  private getCellPosition(cellId: number, mapWidth: number, groundLevel: number): { x: number; y: number } {
    const { CELL_WIDTH, CELL_HALF_WIDTH, CELL_HALF_HEIGHT } = MAP_CONSTANTS;
    const LEVEL_HEIGHT = 20;

    let loc14 = mapWidth - 1;
    let loc9 = -1;
    let loc10 = 0;
    let loc11 = 0;

    for (let id = 0; id <= cellId; id++) {
      if (loc9 === loc14) {
        loc9 = 0;
        loc10 += 1;

        if (loc11 === 0) {
          loc11 = CELL_HALF_WIDTH;
          loc14 -= 1;
        } else {
          loc11 = 0;
          loc14 += 1;
        }
      } else {
        loc9 += 1;
      }
    }

    const x = Math.floor(loc9 * CELL_WIDTH + loc11);
    const y = Math.floor(loc10 * CELL_HALF_HEIGHT - LEVEL_HEIGHT * (groundLevel - 7));

    return { x, y };
  }

  private computeMapScale(mapWidth: number, mapHeight: number): { scale: number; offsetX: number; offsetY: number } {
    const { DISPLAY_WIDTH, DISPLAY_HEIGHT, CELL_WIDTH, CELL_HEIGHT, DEFAULT_WIDTH, DEFAULT_HEIGHT } = MAP_CONSTANTS;

    if (mapWidth <= DEFAULT_WIDTH && mapHeight <= DEFAULT_HEIGHT) {
      const actualWidth = (mapWidth - 1) * CELL_WIDTH;
      const actualHeight = (mapHeight - 1) * CELL_HEIGHT;

      const offsetX = Math.floor((DISPLAY_WIDTH - actualWidth) / 2);
      const offsetY = Math.floor((DISPLAY_HEIGHT - actualHeight) / 2);

      return { scale: 1, offsetX, offsetY };
    }

    const totalWidth = (mapWidth - 1) * CELL_WIDTH;
    const totalHeight = (mapHeight - 1) * CELL_HEIGHT;

    const scale = mapHeight > mapWidth
      ? DISPLAY_WIDTH / totalWidth
      : DISPLAY_HEIGHT / totalHeight;

    const actualWidth = Math.floor(totalWidth * scale);
    const actualHeight = Math.floor(totalHeight * scale);

    const offsetX = Math.floor((DISPLAY_WIDTH - actualWidth) / 2);
    const offsetY = Math.floor((DISPLAY_HEIGHT - actualHeight) / 2);

    return { scale, offsetX, offsetY };
  }

  private async renderMap(mapData: MapData) {
    if (!this.mapContainer || !this.manifest) return;

    const { width: mapWidth, height: mapHeight, cells, backgroundNum } = mapData;
    const mapScale = this.computeMapScale(mapWidth, mapHeight);

    // Debug: count how many sprites we actually create per layer
    // This helps verify whether Layer 1 (objects) is being instantiated at all.
    let debugGroundCount = 0;
    let debugLayer1Count = 0;
    let debugLayer2Count = 0;

    // Apply current zoom to map container
    this.mapContainer.scale.set(this.currentZoom);

    // Record the texture scale implied by the current zoom so that we can
    // decide later whether a zoom change actually requires rebuilding the
    // map with different atlas resolutions.
    this.currentTileScale = this.getTargetScaleForZoom();

    const backgroundLayer = new Container();

    if (backgroundNum && backgroundNum > 0) {
      const bgSprite = await this.createTileSprite(backgroundNum, 'ground');
      if (bgSprite && this.manifest) {
        const bgTileKey = `ground_${backgroundNum}`;
        const bgTile = this.manifest.tiles[bgTileKey];

        const tex: any = bgSprite.texture as any;
        const frame: AtlasFrame | undefined = tex._frameInfo as AtlasFrame | undefined;
        const textureScale: number = tex._scale || 1;

        // Get full untrimmed dimensions
        const fullPxWidth = frame ? (frame.origW ?? frame.w) : bgSprite.texture.width;
        const fullPxHeight = frame ? (frame.origH ?? frame.h) : bgSprite.texture.height;

        // Calculate asset scale (pixels per logical unit)
        const bgTileWidth = bgTile?.width ?? fullPxWidth;
        const bgTileHeight = bgTile?.height ?? fullPxHeight;
        const assetScaleX = (bgTileWidth > 0 && fullPxWidth > 0) ? fullPxWidth / bgTileWidth : textureScale;
        const assetScaleY = (bgTileHeight > 0 && fullPxHeight > 0) ? fullPxHeight / bgTileHeight : textureScale;

        // Get trim offsets and convert to logical units
        const trimXPx = frame?.trimX ?? 0;
        const trimYPx = frame?.trimY ?? 0;
        const trimXLogical = trimXPx / assetScaleX;
        const trimYLogical = trimYPx / assetScaleY;

        // Scale background to fill the map width
        const totalMapWidth = (mapWidth - 1) * MAP_CONSTANTS.CELL_WIDTH;
        const actualMapWidth = totalMapWidth * mapScale.scale;
        const bgScale = fullPxWidth > 0 ? actualMapWidth / fullPxWidth : mapScale.scale;

        // Get base offsets from manifest (usually 0 for backgrounds, but account for them)
        const bgBaseX = bgTile?.offsetX ?? 0;
        const bgBaseY = bgTile?.offsetY ?? 0;

        bgSprite.scale.set(bgScale, bgScale);
        bgSprite.anchor.set(0, 0);

        // Apply offsets and trim adjustment
        // Use consistent floor() to prevent seams
        const bgTopLeftX = Math.floor((bgBaseX + trimXLogical) * mapScale.scale + mapScale.offsetX);
        const bgTopLeftY = Math.floor((bgBaseY + trimYLogical) * mapScale.scale + mapScale.offsetY);

        bgSprite.x = bgTopLeftX;
        bgSprite.y = bgTopLeftY;

        backgroundLayer.addChild(bgSprite);
        this.spriteCount++;

        const bgWidthWorld = fullPxWidth * bgScale;
        const bgHeightWorld = fullPxHeight * bgScale;
        // Background contributes to bounds, but final map bounds will be
        // computed from the union of all layers below.
      }
    }

    const groundLayer = new Container();
    groundLayer.sortableChildren = true;
    const objectLayer1 = new Container();
    objectLayer1.sortableChildren = true;
    const objectLayer2 = new Container();
    objectLayer2.sortableChildren = true;
    const animatedLayer = new Container();
    animatedLayer.sortableChildren = true;

    // Clear previous animated sprites and filters
    for (const sprite of this.animatedSprites) {
      sprite.stop();
      sprite.destroy();
    }
    this.animatedSprites = [];

    const sortedCells = [...cells].sort((a, b) => {
      const posA = this.getCellPosition(a.id, mapWidth, a.groundLevel);
      const posB = this.getCellPosition(b.id, mapWidth, b.groundLevel);
      return posA.y + posA.x - (posB.y + posB.x);
    });

    for (const cell of sortedCells) {
      const basePosition = this.getCellPosition(cell.id, mapWidth, cell.groundLevel);

      // Ground tile with frame selection based on behavior
      if (cell.ground > 0) {
        const groundSlope = cell.groundSlope ?? 1;
        // Get correct frame based on tile behavior (slope, random, animated, static)
        const targetFrame = this.getFrameIndexForTile(cell.ground, 'ground', cell.id, groundSlope);
        // For slopes, no rotation; otherwise use layerGroundRot
        const groundRot = this.isSlopeTile(cell.ground, 'ground') && groundSlope !== 1 ? 0 : cell.layerGroundRot;

        const sprite = await this.createTileSprite(cell.ground, 'ground', targetFrame);
        if (sprite) {
          this.positionSprite(sprite, cell.ground, 'ground', basePosition, groundRot, cell.layerGroundFlip, cell.id, mapScale);
          groundLayer.addChild(sprite);
          this.spriteCount++;
          debugGroundCount++;
        }
      }

      // Layer 1 (objects) - rotation only applies when groundSlope == 1
      if (cell.layer1 > 0) {
        const groundSlope = cell.groundSlope ?? 1;
        const objRot = groundSlope === 1 ? cell.layerObject1Rot : 0;
        // Get correct frame based on tile behavior (random, animated, static)
        const targetFrame = this.getFrameIndexForTile(cell.layer1, 'objects', cell.id, groundSlope);

        const sprite = await this.createTileSprite(cell.layer1, 'objects', targetFrame);
        if (sprite) {
          this.positionSprite(sprite, cell.layer1, 'objects', basePosition, objRot, cell.layerObject1Flip, cell.id, mapScale);
          objectLayer1.addChild(sprite);
          this.spriteCount++;
          debugLayer1Count++;
        }
      }

      // Layer 2 (objects) - NO rotation, only flip
      if (cell.layer2 > 0) {
        const groundSlope = cell.groundSlope ?? 1;

        // Check if this is an animated tile
        if (this.isAnimatedTile(cell.layer2, 'objects')) {
          const animSprite = await this.createAnimatedTileSprite(cell.layer2, 'objects');
          if (animSprite) {
            this.positionSprite(animSprite, cell.layer2, 'objects', basePosition, 0, cell.layerObject2Flip, cell.id, mapScale);
            animatedLayer.addChild(animSprite);
            this.animatedSprites.push(animSprite);
            this.spriteCount++;
          }
        } else {
          // Get correct frame based on tile behavior (random, static)
          const targetFrame = this.getFrameIndexForTile(cell.layer2, 'objects', cell.id, groundSlope);

          const sprite = await this.createTileSprite(cell.layer2, 'objects', targetFrame);
          if (sprite) {
            this.positionSprite(sprite, cell.layer2, 'objects', basePosition, 0, cell.layerObject2Flip, cell.id, mapScale);
            objectLayer2.addChild(sprite);
            this.spriteCount++;
            debugLayer2Count++;
          }
        }
      }
    }

    // Log summary of how many sprites were created for each layer.
    // If layer1 count stays at 0 on maps that clearly have layer1 tiles,
    // the issue is in sprite creation / manifest lookups rather than positioning.
    console.log('Map sprite counts', {
      mapId: mapData.id,
      ground: debugGroundCount,
      layer1: debugLayer1Count,
      layer2: debugLayer2Count,
    });

    // Add all layers to map container
    this.mapContainer.addChild(backgroundLayer);
    this.mapContainer.addChild(groundLayer);
    this.mapContainer.addChild(objectLayer1);
    this.mapContainer.addChild(objectLayer2);
    // Animated layer goes on top
    this.mapContainer.addChild(animatedLayer);
    this.animatedLayer = animatedLayer;

    // Calculate bounds directly from the map container to get stable extents
    // for camera clamping. Use getLocalBounds() to stay in the same coordinate
    // space as the tile positions we computed during layout.
    const bounds = this.mapContainer.getLocalBounds();

    if (bounds.width > 0 && bounds.height > 0) {
      this.mapBounds = {
        minX: bounds.x,
        maxX: bounds.x + bounds.width,
        minY: bounds.y,
        maxY: bounds.y + bounds.height,
      };
    } else {
      this.mapBounds = null;
    }

    // Create debug overlay
    this.createDebugOverlay(cells, mapWidth, mapScale);

    this.clampCameraToBounds();
  }

  /**
   * Create debug overlay container (hover-based)
   */
  private createDebugOverlay(
    cells: MapCell[],
    mapWidth: number,
    mapScale: { scale: number; offsetX: number; offsetY: number }
  ): void {
    // Remove old overlay
    if (this.debugOverlay) {
      this.debugOverlay.destroy({ children: true });
    }

    this.debugOverlay = new Container();
    this.debugOverlay.visible = this.debugVisible;

    // Diamond highlight for hovered cell
    this.debugDiamond = new Graphics();
    this.debugOverlay.addChild(this.debugDiamond);

    // Text for cell info
    const textStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 12,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
    });
    this.debugText = new Text({ text: '', style: textStyle });
    this.debugOverlay.addChild(this.debugText);

    this.mapContainer.addChild(this.debugOverlay);
  }

  /**
   * Update debug overlay for hovered cell
   */
  private updateDebugOverlay(mouseX: number, mouseY: number): void {
    if (!this.debugVisible || !this.debugOverlay || !this.currentMapData) return;

    const mapWidth = this.currentMapData.width;
    const cells = this.currentMapData.cells;
    const mapScale = this.computeMapScale(mapWidth, this.currentMapData.height);

    // Convert screen coords to map coords
    const mapX = (mouseX - this.mapContainer.x) / this.currentZoom;
    const mapY = (mouseY - this.mapContainer.y) / this.currentZoom;

    // Find which cell is under the mouse
    const hoveredCell = this.findCellAtPosition(mapX, mapY, cells, mapWidth, mapScale);

    if (hoveredCell !== this.hoveredCell) {
      this.hoveredCell = hoveredCell;
      this.redrawDebugInfo(mapScale);
    }
  }

  /**
   * Find cell at given map position
   */
  private findCellAtPosition(
    mapX: number,
    mapY: number,
    cells: MapCell[],
    mapWidth: number,
    mapScale: { scale: number; offsetX: number; offsetY: number }
  ): MapCell | null {
    const { CELL_WIDTH, CELL_HALF_WIDTH, CELL_HALF_HEIGHT } = MAP_CONSTANTS;

    for (const cell of cells) {
      const pos = this.getCellPosition(cell.id, mapWidth, cell.groundLevel);
      const screenX = pos.x * mapScale.scale + mapScale.offsetX;
      const screenY = pos.y * mapScale.scale + mapScale.offsetY;

      // Check if point is inside diamond
      const relX = mapX - screenX;
      const relY = mapY - screenY;

      const hw = CELL_HALF_WIDTH * mapScale.scale;
      const hh = CELL_HALF_HEIGHT * mapScale.scale;

      // Diamond bounds check using cross product
      const cx = hw;
      const cy = hh;
      const dx = relX - cx;
      const dy = relY - cy;

      if (Math.abs(dx / hw) + Math.abs(dy / hh) <= 1) {
        return cell;
      }
    }
    return null;
  }

  /**
   * Redraw debug info for current hovered cell
   */
  private redrawDebugInfo(mapScale: { scale: number; offsetX: number; offsetY: number }): void {
    if (!this.debugDiamond || !this.debugText || !this.currentMapData) return;

    const { CELL_WIDTH, CELL_HALF_WIDTH, CELL_HALF_HEIGHT } = MAP_CONSTANTS;

    this.debugDiamond.clear();
    this.debugText.text = '';

    if (!this.hoveredCell) return;

    const cell = this.hoveredCell;
    const pos = this.getCellPosition(cell.id, this.currentMapData.width, cell.groundLevel);
    const screenX = pos.x * mapScale.scale + mapScale.offsetX;
    const screenY = pos.y * mapScale.scale + mapScale.offsetY;

    const hw = CELL_HALF_WIDTH * mapScale.scale;
    const hh = CELL_HALF_HEIGHT * mapScale.scale;

    // Draw diamond highlight
    this.debugDiamond.poly([
      { x: screenX + hw, y: screenY },
      { x: screenX + hw * 2, y: screenY + hh },
      { x: screenX + hw, y: screenY + hh * 2 },
      { x: screenX, y: screenY + hh },
    ]);
    this.debugDiamond.stroke({ width: 2, color: 0x00ff00 });
    this.debugDiamond.fill({ color: 0x00ff00, alpha: 0.15 });

    // Build info text
    const lines: string[] = [`Cell #${cell.id}`];
    if (cell.ground > 0) {
      const behavior = this.getTileBehavior(cell.ground, 'ground');
      const frameCount = this.getTileFrameCount(cell.ground, 'ground');
      lines.push(`Ground: ${cell.ground} (${behavior ?? 'unknown'}, ${frameCount} frames)`);
    }
    if (cell.layer1 > 0) {
      const behavior = this.getTileBehavior(cell.layer1, 'objects');
      const frameCount = this.getTileFrameCount(cell.layer1, 'objects');
      lines.push(`Layer1: ${cell.layer1} (${behavior ?? 'unknown'}, ${frameCount} frames)`);
    }
    if (cell.layer2 > 0) {
      const behavior = this.getTileBehavior(cell.layer2, 'objects');
      const frameCount = this.getTileFrameCount(cell.layer2, 'objects');
      lines.push(`Layer2: ${cell.layer2} (${behavior ?? 'unknown'}, ${frameCount} frames)`);
    }
    if (cell.groundSlope && cell.groundSlope !== 1) {
      lines.push(`Slope: ${cell.groundSlope}`);
    }

    this.debugText.text = lines.join('\n');
    this.debugText.x = screenX + hw * 2 + 10;
    this.debugText.y = screenY;
  }

  /**
   * Get tile frame count
   */
  private getTileFrameCount(tileId: number, type: 'ground' | 'objects'): number {
    if (!this.manifest) return 0;
    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];
    return tile?.frameCount ?? 0;
  }

  /**
   * Get tile behavior string
   */
  private getTileBehavior(tileId: number, type: 'ground' | 'objects'): string | null {
    if (!this.manifest) return null;
    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];
    return tile?.behavior ?? null;
  }

  // Asset loading mode: 'regions' = region-based WebP atlases, 'individual' = individual WebP files, 'ktx2' = KTX2 atlases
  private assetMode: 'regions' | 'individual' | 'ktx2' = 'regions';

  private async createTileSprite(tileId: number, type: 'ground' | 'objects', frameIndex: number = 0): Promise<Sprite | null> {
    if (!this.manifest) return null;

    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];

    if (!tile) {
      return null;
    }

    const targetScale = this.getTargetScaleForZoom();
    const chosenScale = this.getBestAvailableScale(tile, targetScale);
    const scaleKey = chosenScale === 1.5 ? '1.5x' : chosenScale === 2 ? '2x' : '3x';

    // Cache key includes frame index for multi-frame tiles
    const cacheKey = `${type}:${tileId}:${chosenScale}:frame${frameIndex}`;

    if (this.textureCache.has(cacheKey)) {
      const cachedTexture = this.textureCache.get(cacheKey);
      const sprite = new Sprite(cachedTexture);
      sprite.anchor.set(0, 0);
      return sprite;
    }

    // Region-based WebP atlas loading (most efficient)
    if (this.assetMode === 'regions' && this.regionLoader && this.regionManifest) {
      try {
        const texture = await this.regionLoader.loadFrame(this.regionManifest, tileKey, frameIndex, chosenScale);
        if (texture) {
          this.textureCache.set(cacheKey, texture);
          const sprite = new Sprite(texture);
          sprite.anchor.set(0, 0);
          return sprite;
        }
      } catch (err) {
        console.warn(`Failed to load region atlas for ${tileKey}:${frameIndex}`, err);
      }
      return null;
    }

    // Load individual WebP files directly (for debugging)
    if (this.assetMode === 'individual') {
      const typeDir = type === 'ground' ? 'grounds' : 'objects';
      const texturePath = `/assets/maps/tilesv3/${typeDir}/${scaleKey}/tile_${tileId}/${tileId}_${frameIndex}.webp`;

      try {
        const texture = await Assets.load(texturePath);
        (texture as any)._scale = chosenScale;
        this.textureCache.set(cacheKey, texture);

        const sprite = new Sprite(texture);
        sprite.anchor.set(0, 0);
        return sprite;
      } catch (err) {
        console.warn(`Failed to load WebP: ${texturePath}`, err);
        return null;
      }
    }

    // Load from KTX2 atlas
    const atlas = tile.atlases[String(chosenScale)];
    if (!atlas) {
      return null;
    }

    // Select frame from atlas
    const frames = atlas.frames;
    const frameToUse = frameIndex < frames.length ? frames[frameIndex] : frames[0];

    // Determine which atlas file to load (for multi-atlas tiles)
    let texturePath: string;
    if (atlas.files && frameToUse.atlas !== undefined) {
      texturePath = `/assets/maps/tilesv2/${atlas.files[frameToUse.atlas]}`;
    } else {
      texturePath = `/assets/maps/tilesv2/${atlas.file}`;
    }

    try {
      const atlasTexture = await Assets.load({
        src: texturePath,
        data: {
          width: atlas.width,
          height: atlas.height,
        },
      });

      const texture = new Texture({
        source: atlasTexture.source,
        frame: {
          x: frameToUse.x,
          y: frameToUse.y,
          width: frameToUse.w,
          height: frameToUse.h,
        },
      });

      (texture as any)._frameInfo = frameToUse;
      (texture as any)._scale = chosenScale;

      this.textureCache.set(cacheKey, texture);

      const sprite = new Sprite(texture);
      sprite.anchor.set(0, 0);
      return sprite;
    } catch (err) {
      console.warn(`Failed to load texture: ${texturePath}`, err);
      return null;
    }
  }

  /**
   * Check if a tile is a slope tile (uses groundSlope for frame selection)
   */
  private isSlopeTile(tileId: number, type: 'ground' | 'objects'): boolean {
    if (!this.manifest) return false;

    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];

    if (!tile) return false;

    return tile.behavior === 'slope' && tile.frameCount > 1;
  }

  /**
   * Get the frame index to use for a tile based on its behavior
   */
  private getFrameIndexForTile(tileId: number, type: 'ground' | 'objects', cellId: number, groundSlope: number): number {
    if (!this.manifest) return 0;

    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];

    if (!tile || tile.frameCount <= 1) return 0;

    // Slope tiles: use groundSlope value (1 = flat/frame 0, 2-15 = slope frames 1-14)
    if (tile.behavior === 'slope') {
      return groundSlope > 1 ? groundSlope - 1 : 0;
    }

    // Random tiles: pick a random frame based on cellId (deterministic)
    if (tile.behavior === 'random') {
      // Simple hash based on cell ID for deterministic "random" selection
      return cellId % tile.frameCount;
    }

    // Animated tiles: for now just return frame 0, animation would be handled separately
    // Static tiles: frame 0
    return 0;
  }

  /**
   * Check if a tile is animated
   */
  private isAnimatedTile(tileId: number, type: 'ground' | 'objects'): boolean {
    if (!this.manifest) return false;
    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];
    return tile?.behavior === 'animated' && tile.frameCount > 1;
  }

  /**
   * Create an AnimatedSprite for an animated tile
   */
  private async createAnimatedTileSprite(tileId: number, type: 'ground' | 'objects'): Promise<AnimatedSprite | null> {
    if (!this.manifest) return null;

    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];
    if (!tile || tile.behavior !== 'animated' || tile.frameCount <= 1) return null;

    const targetScale = this.getTargetScaleForZoom();
    const chosenScale = this.getBestAvailableScale(tile, targetScale);
    const scaleKey = chosenScale === 1.5 ? '1.5x' : chosenScale === 2 ? '2x' : '3x';

    // Load all frames as textures
    const frameTextures: Texture[] = [];

    // Region-based WebP atlas loading
    if (this.assetMode === 'regions' && this.regionLoader && this.regionManifest) {
      try {
        const textures = await this.regionLoader.loadAnimationFrames(this.regionManifest, tileKey, chosenScale);
        frameTextures.push(...textures);
      } catch (err) {
        console.warn(`Failed to load animated tile from region atlas: ${tileKey}`, err);
        return null;
      }
    } else if (this.assetMode === 'individual') {
      const typeDir = type === 'ground' ? 'grounds' : 'objects';
      for (let i = 0; i < tile.frameCount; i++) {
        const texturePath = `/assets/maps/tilesv3/${typeDir}/${scaleKey}/tile_${tileId}/${tileId}_${i}.webp`;
        try {
          const texture = await Assets.load(texturePath);
          (texture as any)._scale = chosenScale;
          frameTextures.push(texture);
        } catch (err) {
          console.warn(`Failed to load animated frame: ${texturePath}`);
          break;
        }
      }
    } else {
      // Load from KTX2 atlas
      const atlas = tile.atlases[String(chosenScale)];
      if (!atlas) return null;

      // Load the atlas texture
      const texturePath = `/assets/maps/tilesv2/${atlas.file}`;
      try {
        const atlasTexture = await Assets.load({
          src: texturePath,
          data: { width: atlas.width, height: atlas.height },
        });

        for (const frame of atlas.frames) {
          const texture = new Texture({
            source: atlasTexture.source,
            frame: { x: frame.x, y: frame.y, width: frame.w, height: frame.h },
          });
          (texture as any)._scale = chosenScale;
          frameTextures.push(texture);
        }
      } catch (err) {
        console.warn(`Failed to load animated atlas: ${texturePath}`);
        return null;
      }
    }

    if (frameTextures.length === 0) return null;

    const animSprite = new AnimatedSprite(frameTextures);
    animSprite.anchor.set(0, 0);

    // Set animation properties
    const fps = tile.fps ?? 12;
    animSprite.animationSpeed = fps / 60; // PixiJS uses 60fps as base
    animSprite.loop = tile.loop !== false;

    if (tile.autoplay !== false) {
      animSprite.play();
    }

    return animSprite;
  }

  private computePhpLikeOffsets(tile: TileData, rotation: number, flip: boolean): { offsetX: number; offsetY: number; width: number; height: number } {
    const baseWidth = tile.width;
    const baseHeight = tile.height;
    const baseOffsetX = tile.offsetX;
    const baseOffsetY = tile.offsetY;

    const r = rotation % 4;
    let width = baseWidth;
    let height = baseHeight;
    let offsetX = baseOffsetX;
    let offsetY = baseOffsetY;

    if (r === 2) {
      offsetX = -baseOffsetX - baseWidth;
      offsetY = -baseOffsetY - baseHeight;
    } else if (r === 1 || r === 3) {
      width = Math.ceil(baseHeight * 1.9286);
      height = Math.ceil(baseWidth * 0.5185);

      if (r === 1) {
        offsetX = Math.ceil(baseOffsetY * -1.9286 - width);
        offsetY = Math.floor(baseOffsetX * 0.5185);
      } else {
        offsetX = Math.floor(baseOffsetY * 1.9286);
        offsetY = Math.ceil(baseOffsetX * -0.5185 - height);
      }
    }

    if (flip) {
      offsetX = -offsetX - width;
    }

    return { offsetX, offsetY, width, height };
  }

  private computeTransformedMin(width: number, height: number, rotation: number, scaleX: number, scaleY: number): { minX: number; minY: number } {
    const r = rotation % 4;
    const angleRad = (r * Math.PI) / 2;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    const points = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
    ];

    let minX = Infinity;
    let minY = Infinity;

    for (const p of points) {
      const sx = p.x * scaleX;
      const sy = p.y * scaleY;
      const xr = sx * cos - sy * sin;
      const yr = sx * sin + sy * cos;
      if (xr < minX) minX = xr;
      if (yr < minY) minY = yr;
    }

    return { minX, minY };
  }

  private positionSprite(sprite: Sprite, tileId: number, type: 'ground' | 'objects', position: { x: number; y: number }, rotation: number, flip: boolean, cellId: number, mapScale: { scale: number; offsetX: number; offsetY: number }) {
    if (!this.manifest) return;

    const tileKey = `${type}_${tileId}`;
    const tile = this.manifest.tiles[tileKey];

    if (!tile) return;

    const r = rotation % 4;
    const baseWidth = tile.width;
    const baseHeight = tile.height;

    // Get texture info to determine asset scale
    const tex: any = sprite.texture as any;
    const textureScale: number = tex._scale || 1;

    // Compute rotation/flip-adjusted offsets using PHP-like algorithm
    const { offsetX, offsetY } = this.computePhpLikeOffsets(tile, r, flip);

    // Compute scale factors for rotation (anisotropic for 90°/270°)
    let scaleX = 1;
    let scaleY = 1;
    if (r === 1 || r === 3) {
      scaleX = ROT_SCALE_X;
      scaleY = ROT_SCALE_Y;
    }
    if (flip) {
      // Flip like Flash: negate x scale around the same origin
      scaleX *= -1;
    }

    // Apply global map scale for oversized maps
    const globalScale = mapScale.scale;
    const finalScaleX = scaleX * globalScale;
    const finalScaleY = scaleY * globalScale;

    // Compute the top-left of the transformed sprite (after scale + rotation)
    // relative to its local (0,0) origin
    const { minX, minY } = this.computeTransformedMin(
      baseWidth,
      baseHeight,
      r,
      finalScaleX,
      finalScaleY
    );

    // Sprite scale: convert from logical scaled units to pixel units
    // This accounts for the fact that the sprite's texture is already at textureScale
    const spriteScaleX = finalScaleX / textureScale;
    const spriteScaleY = finalScaleY / textureScale;

    // Apply to sprite
    sprite.angle = r * 90;
    sprite.scale.set(spriteScaleX, spriteScaleY);

    // Top-left before global scaling
    const topLeftBaseX = position.x + offsetX;
    const topLeftBaseY = position.y + offsetY;

    // Apply global map scale + offset (MapScale::applyToImage equivalent)
    const topLeftScaledX = topLeftBaseX * globalScale + mapScale.offsetX;
    const topLeftScaledY = topLeftBaseY * globalScale + mapScale.offsetY;

    // Compensate for rotated/scaled sprite bounds
    // minX/minY are calculated at finalScale, so we use them directly
    sprite.x = Math.round(topLeftScaledX - minX);
    sprite.y = Math.round(topLeftScaledY - minY);
    sprite.zIndex = cellId; // Isometric depth sorting
  }

  private generateRandomName(): string {
    const firstParts = ["Kal", "Mor", "Dar", "Fel", "Zal", "Gor", "Bor", "Tor", "Val", "Xal"];
    const secondParts = ["dor", "gar", "mar", "tar", "var", "zar", "thor", "drok", "grim", "lok"];
    const first = firstParts[Math.floor(Math.random() * firstParts.length)];
    const second = secondParts[Math.floor(Math.random() * secondParts.length)];
    return `${first}${second}`;
  }

  async spawnStressTestSprites(count: number = 1000) {
    if (!this.app) {
      console.error('Cannot spawn sprites: app not initialized');
      return;
    }

    // Create a container if we don't have a map loaded
    if (!this.mapContainer) {
      this.mapContainer = new Container();
      this.app.stage.addChild(this.mapContainer);
    }

    console.log(`Spawning ${count} stress test sprites...`);

    const stressContainer = new Container();
    this.mapContainer.addChild(stressContainer);

    const spriteIds = [10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91];
    const animationTypes = ['walk', 'static', 'emote1'];
    const directions = ['R', 'L', 'F', 'B'];

    const textureCache = new Map<number, Map<string, Texture>>();

    console.log('Pre-loading character textures...');
    for (const spriteId of spriteIds) {
      try {
        const manifestResponse = await fetch(`/assets/charactersv2/${spriteId}/manifest.json`);
        if (!manifestResponse.ok) continue;

        const manifest = await manifestResponse.json();
        const spriteAnimations = new Map<string, Texture>();
        const scale = manifest.scales?.[0] || 10;

        for (const animType of animationTypes) {
          for (const dir of directions) {
            const animKey = `${animType}_${dir}`;
            const anim = manifest.animations?.[animKey];
            if (!anim || !anim.frames || anim.frames.length === 0) continue;

            try {
              const firstFrame = anim.frames[0];
              const atlasIndex = firstFrame.atlas;
              const atlas = manifest.atlases?.find((a: any) => a.index === atlasIndex);
              if (!atlas) continue;

              const atlasFile = atlas.files[scale.toString()];
              if (!atlasFile) continue;

              const position = firstFrame.positions?.[scale.toString()];
              if (!position) continue;

              const atlasFileName = atlasFile.replace('.png', '.ktx2');
              const atlasPath = `/assets/charactersv2/${spriteId}/${atlasFileName}`;

              const atlasTexture = await Assets.load({
                src: atlasPath,
                data: { width: atlas.width, height: atlas.height },
              });

              const texture = new Texture({
                source: atlasTexture.source,
                frame: { x: position.x, y: position.y, width: position.w, height: position.h },
              });

              spriteAnimations.set(animKey, texture);
            } catch (err) {
              // Skip failed animations
            }
          }
        }

        if (spriteAnimations.size > 0) {
          textureCache.set(spriteId, spriteAnimations);
        }
      } catch (err) {
        console.error(`Failed to load sprite ${spriteId}`);
      }
    }

    console.log(`Loaded ${textureCache.size} character textures`);

    if (textureCache.size === 0) {
      console.warn('No character textures loaded - creating simple placeholder sprites instead');
      // Create simple colored squares as placeholders
      for (let i = 0; i < count; i++) {
        const colors = [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF];
        const color = colors[i % colors.length];

        const sprite = new Sprite();
        sprite.tint = color;
        sprite.width = 32;
        sprite.height = 32;
        sprite.anchor.set(0.5, 0.5);

        let x = Math.random() * 800;
        let y = Math.random() * 600;
        if (this.mapBounds) {
          const { minX, maxX, minY, maxY } = this.mapBounds;
          x = minX + Math.random() * (maxX - minX);
          y = minY + Math.random() * (maxY - minY);
        }

        const eid = this.gameWorld.createEntity(i);
        this.gameWorld.addComponent(eid, 'Position', { x, y });
        this.gameWorld.addComponent(eid, 'Scale', { x: 1, y: 1 });
        this.gameWorld.addComponent(eid, 'Rotation', { angle: 0 });
        this.gameWorld.addComponent(eid, 'ZIndex', { value: i });

        this.renderSystem.registerSprite(eid, sprite);
        stressContainer.addChild(sprite);
      }
      console.log(`Spawned ${count} placeholder stress test sprites`);
      return;
    }

    const characterTypes = Array.from(textureCache.entries());

    for (let i = 0; i < count; i++) {
      const characterIndex = i % characterTypes.length;
      const [spriteId, animationsMap] = characterTypes[characterIndex];
      const availableAnimations = Array.from(animationsMap.entries());

      try {
        const [animKey, texture] = availableAnimations[Math.floor(Math.random() * availableAnimations.length)];

        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);

        let x = Math.random() * 800;
        let y = Math.random() * 600;
        if (this.mapBounds) {
          const { minX, maxX, minY, maxY } = this.mapBounds;
          x = minX + Math.random() * (maxX - minX);
          y = minY + Math.random() * (maxY - minY);
        }

        // Create game entity
        const eid = this.gameWorld.createEntity(i);
        this.gameWorld.addComponent(eid, 'Position', { x, y });
        this.gameWorld.addComponent(eid, 'Scale', { x: 0.1, y: 0.1 });
        this.gameWorld.addComponent(eid, 'Rotation', { angle: 0 });
        this.gameWorld.addComponent(eid, 'ZIndex', { value: i });

        // Register sprite with render system
        this.renderSystem.registerSprite(eid, sprite);
        stressContainer.addChild(sprite);
      } catch (err) {
        console.error('Error creating sprite:', err);
      }
    }

    console.log(`Spawned ${count} stress test sprites`);
  }

  getStats() {
    const memory = (performance as any).memory?.usedJSHeapSize / 1024 / 1024 || 0;

    return {
      fps: this.fps,
      sprites: this.renderSystem.getSpriteCount(),
      drawCalls: this.lastDrawCalls,
      renderTime: this.lastFrameTimeMs,
      memory,
    };
  }

  destroy() {
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }
    this.mapContainer = null;
    this.currentMapData = null;
    this.textureCache.clear();
    this.regionLoader?.clearCache();
    this.regionLoader = null;
    this.regionManifest = null;
    this.renderSystem.destroy();
    this.gameWorld.destroy();
  }
}
