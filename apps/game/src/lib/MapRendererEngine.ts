import { Application, Container, Sprite, AnimatedSprite, Assets, Texture, RenderTexture, Rectangle, TextureSource, Ticker, Graphics, Text, TextStyle, ColorMatrixFilter, extensions } from 'pixi.js';
import { GameWorld } from './GameWorld';
import { SpriteRenderSystem } from './SpriteRenderSystem';
import { RegionAtlasLoader, type WebpManifest } from './region-atlas-loader';
import { PixelPerfectPickingSystem, type PickableObject, type PickResult } from './PickingSystem';
import { ZaapContextMenu } from './ZaapContextMenu';
import { Banner } from './hud/banner';

import { LayoutSystem } from '@pixi/layout';

// Manually register LayoutSystem extension
extensions.add(LayoutSystem);

TextureSource.defaultOptions.scaleMode = 'linear';       // LINEAR sampling for smooth scaling
TextureSource.defaultOptions.autoGenerateMipmaps = false; // Disable mipmaps (incompatible with MSAA antialiasing)

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

// Logical Dofus 1.29 constants in *original* 1x space.
//
// Textures themselves are exported at 1.5x/2x/3x, and we compute their
// per-scale pixel ratio at runtime from the manifest/atlas metadata. All map
// math (cell positions, map scale, camera clamping) stays in this 1x logical
// space so that behavior matches the old Svelte renderer and the original
// Flash client exactly.
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
  private stressContainer: Container | null = null;
  private banner: Banner | null = null;
  private manifest: TilesManifest | null = null;
  private textureCache: Map<string, any> = new Map();
  private cachedMapTexture: RenderTexture | null = null;
  private cachedMapSprite: Sprite | null = null;

  // Region-based atlas loader
  private regionLoader: RegionAtlasLoader | null = null;
  private regionManifest: WebpManifest | null = null;

  // Character sprite tracking
  private currentCharacterScale: number | null = null;
  private characterTextureCache = new Map<number, Map<string, Texture[]>>();

  // Game logic
  private gameWorld: GameWorld;
  private renderSystem: SpriteRenderSystem;

	  private fps = 0;
	  private frameCount = 0;
	  private lastFpsUpdate = Date.now();
	      // Visual zoom applied on top of logical 1x Dofus space.
	      //
	      // We split zoom into two factors (mirroring the old Svelte renderer):
	      //   - baseZoom: how much the canvas is scaled relative to the
	      //               742x432 logical display, based purely on the DOM
	      //               container size ("gameScale" in Svelte).
	      //   - zoomLevels[...] (user zoom multiplier): extra zoom on top of that
	      //               base scale.
	      //
	      // Effective container scale is:
	      //     currentZoom = baseZoom * zoomLevels[currentZoomIndex]
	      //
	      // This guarantees that when the user zooms back to the default level
	      // (multiplier = 1), the map once again exactly fills the canvas and we
	      // never get letterboxing / "outside the map" gaps after a
	      // zoom→unzoom cycle.
		  private baseZoom = 1;                   // scale derived from container size
		  private currentZoom = 1;                // effective scale = baseZoom * multiplier
		  private zoomLevels = [1, 1.5, 2, 3];    // user zoom multipliers
	  private currentZoomIndex = 0;            // index into zoomLevels (0 => multiplier 1)
  private currentTileScale: number | null = null;
  private lastFrameTimeMs = 0;
  private lastDrawCalls = 0;
  private currentMapData: MapData | null = null;
	  private currentMapScale: { scale: number; offsetX: number; offsetY: number } | null = null;
  private mapBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  private spriteCount = 0;
  private animatedSprites: AnimatedSprite[] = [];
  private animatedLayer: Container | null = null;

  // Debug overlay
  private debugOverlay: Container | null = null;
  private debugVisible = false;
  private debugText: Text | null = null;
  private debugDiamond: Graphics | null = null;
  private debugPickHighlight: Graphics | null = null;
  private debugPickingTextureSprite: Sprite | null = null;
  private showPickingTexture = false;
  private debugPickingCursor: Graphics | null = null;
  private hoveredCell: MapCell | null = null;

  // Pixel-perfect picking system
  private pickingSystem: PixelPerfectPickingSystem | null = null;
  private hoveredObject: PickResult | null = null;
  private lastPickedObject: PickResult | null = null;
  private interactiveGfxIds: Set<number> = new Set();
  private interactiveObjectsData: Map<number, any> = new Map(); // gfxId -> interactive object info
  private pickableIdToGfxId: Map<number, number> = new Map(); // pickableId -> gfxId
  private nextPickableId = 1; // Sequential ID counter (starts at 1, 0 is reserved for "no object")

  // Context menu
  private currentContextMenu: ZaapContextMenu | null = null;

  private isDragging = false;
  private lastPointerPos = { x: 0, y: 0 };
  private resizeObserver: ResizeObserver | null = null;
  private userControlledZoom = false; // Track if user manually set zoom
  private lastContainerSize = { width: 0, height: 0 }; // Track actual container size changes

  constructor(container: HTMLElement) {
    this.container = container;
    this.gameWorld = new GameWorld();
    this.renderSystem = new SpriteRenderSystem(this.gameWorld);
  }

  async init() {
    this.app = new Application();

    // Calculate canvas size to fit container while maintaining aspect ratio
    const { width, height, zoom } = this.calculateCanvasSize();

	    // Set initial base zoom and effective zoom. At startup we consider the
	    // user zoom multiplier to be 1, so the effective scale is just the
	    // canvas scale derived from container size.
	    this.baseZoom = zoom;
	    this.currentZoomIndex = 0; // zoomLevels[0] === 1
	    this.currentZoom = this.baseZoom * this.zoomLevels[this.currentZoomIndex];
    this.lastContainerSize = {
      width: this.container.clientWidth || 1113,
      height: this.container.clientHeight || 648
    };

	    // Configure the Pixi application with global antialiasing enabled.
	    //
	    //  - resolution / autoDensity: match canvas pixels to device pixels.
	    //  - antialias: true        → enable MSAA for smooth edges.
	    //  - roundPixels: true      → snap world coordinates to whole pixels
	    //                             in the final render pass (important when
	    //                             the map container itself is scaled).
	    //  - preference: 'webgpu'   → keep using the WebGPU backend as requested.
	    await this.app.init({
	      width,
	      height,
	      backgroundColor: 0x000000,
	      resolution: window.devicePixelRatio || 2,
	      autoDensity: true,
	      antialias: true,
	      roundPixels: true,
	      preference: 'webgpu',
	      layout: {
	        autoUpdate: true,
	        enableDebug: false,
	        throttle: 0, // No throttling for immediate updates
	      },
	    });

	    // Extra safety: make sure the underlying renderer also has pixel rounding
	    // enabled, as this controls how scaled world coordinates are snapped to
	    // the final pixel grid in WebGPU.
	    try {
	      const rendererAny: any = this.app.renderer;
	      if (rendererAny) {
	        rendererAny.roundPixels = true;
	      }
	    } catch {
	      // Non-fatal if this fails; sprite-level rounding + CSS pixelation still apply.
	    }

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

    // Configure stage layout for @pixi/layout to work
    (this.app.stage as any).layout = {
      width: this.app.screen.width,
      height: this.app.screen.height
    };

    // Debug: Verify LayoutSystem is properly configured
    const layoutSystem = (this.app.renderer as any).layout;
    if (layoutSystem) {
      console.log('✅ LayoutSystem configured:', {
        autoUpdate: layoutSystem.autoUpdate,
        throttle: layoutSystem.throttle,
        debug: layoutSystem.debug
      });
    } else {
      console.error('❌ LayoutSystem not found on renderer!');
    }

    // Create map container
    this.mapContainer = new Container();
    this.app.stage.addChild(this.mapContainer);

    // Create and initialize the banner
    this.banner = new Banner(this.app, MAP_CONSTANTS.DISPLAY_HEIGHT);
    this.banner.init(width, zoom);
    this.app.stage.addChild(this.banner.getGraphics());

    // Load interactive objects database to filter what we register for picking
    await this.loadInteractiveObjects();

    // Initialize pixel-perfect picking system
    this.pickingSystem = new PixelPerfectPickingSystem(this.app.renderer, 16); // 16ms throttle (~60fps)
    console.log(`Initializing picking texture with canvas size: ${width}x${height}, renderer size: ${this.app.renderer.width}x${this.app.renderer.height}`);
    this.pickingSystem.initializeTexture(width, height);

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
    // Picking texture visualization toggle with 'Y' key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        this.toggleDebugOverlay();
      } else if (e.key === 'y' || e.key === 'Y') {
        this.togglePickingTextureDisplay();
      } else if (e.key === 'p' || e.key === 'P') {
        this.dumpDebugImages();
      }
    });

    console.log('MapRendererEngine initialized');
  }

  /**
   * Load interactive objects database
   */
  private async loadInteractiveObjects(): Promise<void> {
    try {
      const response = await fetch('/assets/data/interactive-objects.json');
      const data = await response.json();

      // Extract all gfxIds from interactive objects
      const interactiveObjects = data.interactiveObjects || {};
      for (const obj of Object.values(interactiveObjects) as any[]) {
        if (obj.gfxIds && Array.isArray(obj.gfxIds)) {
          for (const gfxId of obj.gfxIds) {
            this.interactiveGfxIds.add(gfxId);
            // Store object info for gfxId lookup
            this.interactiveObjectsData.set(gfxId, obj);
          }
        }
      }

      console.log(`Loaded ${this.interactiveGfxIds.size} interactive GFX IDs`);
    } catch (error) {
      console.error('Failed to load interactive objects:', error);
    }
  }

  /**
   * Check if a tile ID is interactive
   */
  private isInteractiveTile(tileId: number): boolean {
    return this.interactiveGfxIds.has(tileId);
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

  /**
   * Toggle picking texture visualization (press Y)
   */
  togglePickingTextureDisplay(): void {
    this.showPickingTexture = !this.showPickingTexture;

    if (!this.debugPickingTextureSprite && this.showPickingTexture && this.pickingSystem) {
      // Create sprite on first toggle
      const pickingTexture = this.pickingSystem.getPickingTexture();
      if (pickingTexture && this.app) {
        this.debugPickingTextureSprite = new Sprite(pickingTexture);
        this.debugPickingTextureSprite.alpha = 0.8;
        this.debugPickingTextureSprite.scale.set(0.3); // Scale down to 30% size
        this.debugPickingTextureSprite.position.set(10, 10); // Top-left corner
        this.debugPickingTextureSprite.zIndex = 10000; // Render on top
        this.app.stage.addChild(this.debugPickingTextureSprite);
      }
    }

    if (this.debugPickingTextureSprite) {
      this.debugPickingTextureSprite.visible = this.showPickingTexture;

      // Update texture to latest version
      if (this.showPickingTexture && this.pickingSystem) {
        const pickingTexture = this.pickingSystem.getPickingTexture();
        if (pickingTexture) {
          this.debugPickingTextureSprite.texture = pickingTexture;
        }
      }
    }

    console.log(`Picking texture visualization: ${this.showPickingTexture ? 'ON' : 'OFF'}`);
  }

  /**
   * Debug dump: Save main render and picking texture with cursor markers
   */
  private dumpDebugImages(): void {
    if (!this.app || !this.lastPointerPos) return;

    const mouseX = this.lastPointerPos.x;
    const mouseY = this.lastPointerPos.y;

    console.log(`Dumping debug images at mouse position (${mouseX}, ${mouseY})`);

    // 1. Capture main canvas with cursor marker
    this.dumpMainCanvasWithCursor(mouseX, mouseY);

    // 2. Capture picking texture with cursor marker
    this.dumpPickingTextureWithCursor(mouseX, mouseY);

    // 3. Dump picking texture pixel data as JSON
    this.dumpPickingTexturePixelData();
  }

  private dumpMainCanvasWithCursor(mouseX: number, mouseY: number): void {
    if (!this.app?.canvas) return;

    // Create an offscreen canvas to draw on
    const offCanvas = document.createElement('canvas');
    offCanvas.width = this.app.canvas.width;
    offCanvas.height = this.app.canvas.height;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) return;

    // Draw the main canvas
    ctx.drawImage(this.app.canvas, 0, 0);

    // Draw red circle at mouse position
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, 20, 0, Math.PI * 2);
    ctx.fill();

    // Draw crosshair
    ctx.strokeStyle = 'rgba(255, 0, 0, 1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mouseX - 30, mouseY);
    ctx.lineTo(mouseX + 30, mouseY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mouseX, mouseY - 30);
    ctx.lineTo(mouseX, mouseY + 30);
    ctx.stroke();

    // Download as image
    offCanvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `game-main-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        console.log('Saved main canvas image');
      }
    });
  }

  private dumpPickingTextureWithCursor(mouseX: number, mouseY: number): void {
    if (!this.pickingSystem || !this.app) return;

    const pickingTexture = this.pickingSystem.getPickingTexture();
    if (!pickingTexture) return;

    // Extract picking texture pixels
    const pickingPixels = this.app.renderer.extract.pixels(pickingTexture);
    const texturePixels = (pickingPixels as any)?.pixels || pickingPixels;
    const textureWidth = (pickingPixels as any)?.width || pickingTexture.width;
    const textureHeight = (pickingPixels as any)?.height || pickingTexture.height;

    // Create canvas for picking texture
    const offCanvas = document.createElement('canvas');
    offCanvas.width = textureWidth;
    offCanvas.height = textureHeight;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) return;

    // Convert pixel data to image
    const imageData = ctx.createImageData(textureWidth, textureHeight);
    imageData.data.set(texturePixels);
    ctx.putImageData(imageData, 0, 0);

    // Scale cursor position to picking texture space
    const scaleX = textureWidth / (this.app.renderer.width || 1);
    const scaleY = textureHeight / (this.app.renderer.height || 1);
    const texMouseX = mouseX * scaleX;
    const texMouseY = mouseY * scaleY;

    // Draw red circle at mouse position
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.beginPath();
    ctx.arc(texMouseX, texMouseY, 15, 0, Math.PI * 2);
    ctx.fill();

    // Draw crosshair
    ctx.strokeStyle = 'rgba(255, 0, 0, 1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(texMouseX - 25, texMouseY);
    ctx.lineTo(texMouseX + 25, texMouseY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(texMouseX, texMouseY - 25);
    ctx.lineTo(texMouseX, texMouseY + 25);
    ctx.stroke();

    // Download as image
    offCanvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `game-picking-texture-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        console.log('Saved picking texture image');
      }
    });
  }

  private dumpPickingTexturePixelData(): void {
    if (!this.pickingSystem || !this.app) return;

    const pickingTexture = this.pickingSystem.getPickingTexture();
    if (!pickingTexture) return;

    // Extract picking texture pixels
    const pickingPixels = this.app.renderer.extract.pixels(pickingTexture);
    const texturePixels = (pickingPixels as any)?.pixels || pickingPixels;
    const textureWidth = (pickingPixels as any)?.width || pickingTexture.width;
    const textureHeight = (pickingPixels as any)?.height || pickingTexture.height;

    // Collect all non-zero pixels for analysis
    const nonZeroPixels: Array<{ x: number; y: number; r: number; g: number; b: number; a: number; id: number }> = [];

    for (let i = 0; i < texturePixels.length; i += 4) {
      const r = texturePixels[i];
      const g = texturePixels[i + 1];
      const b = texturePixels[i + 2];
      const a = texturePixels[i + 3];

      if (r > 0 || g > 0 || b > 0 || a > 0) {
        const pixelIndex = i / 4;
        const x = pixelIndex % textureWidth;
        const y = Math.floor(pixelIndex / textureWidth);

        // Decode ID from RGB using the same scheme as PixelPerfectPickingSystem:
        //   r =  id        & 0xFF
        //   g = (id >> 8)  & 0xFF
        //   b = (id >> 16) & 0xFF
        // => id = r | (g << 8) | (b << 16)
        const decodedId = r | (g << 8) | (b << 16);

        nonZeroPixels.push({ x, y, r, g, b, a, id: decodedId });
      }
    }

    // Create JSON data
    const debugData = {
      timestamp: new Date().toISOString(),
      textureWidth,
      textureHeight,
      totalPixels: texturePixels.length / 4,
      nonZeroPixelCount: nonZeroPixels.length,
      pixelSamples: nonZeroPixels.slice(0, 100), // First 100 non-zero pixels
      allPixels: nonZeroPixels // All non-zero pixels
    };

    // Download as JSON
    const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `game-picking-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log(`Saved picking texture data: ${nonZeroPixels.length} non-zero pixels`);
  }

  private calculateCanvasSize(): { width: number; height: number; zoom: number } {
    const containerWidth = this.container.clientWidth || 1113;
    const containerHeight = this.container.clientHeight || 648;

    const { DISPLAY_WIDTH, DISPLAY_HEIGHT } = MAP_CONSTANTS;

    // Calculate zoom to fit container while maintaining aspect ratio
    const scaleX = containerWidth / DISPLAY_WIDTH;
    const scaleY = containerHeight / (DISPLAY_HEIGHT + 125); // Add 150px in logical space

    // Use the smaller scale to ensure map fits entirely
    // Clamp between 0.5 and 3 for reasonable quality range
    const zoom = Math.max(0.5, Math.min(3, Math.min(scaleX, scaleY)));

    return {
      width: Math.floor(DISPLAY_WIDTH * zoom),
      height: Math.floor((DISPLAY_HEIGHT + 125) * zoom), // Total height includes 150px scaled
      zoom: zoom
    };
  }

  private async handleResize() {
    if (!this.app || !this.app.canvas) return;

    const containerWidth = this.container.clientWidth || 1113;
    const containerHeight = this.container.clientHeight || 648;

    // Check if container size actually changed (ignore spurious resize events)
    const sizeChanged = Math.abs(containerWidth - this.lastContainerSize.width) > 5 ||
                        Math.abs(containerHeight - this.lastContainerSize.height) > 5;

    if (!sizeChanged) {
      return;
    }

    this.lastContainerSize = { width: containerWidth, height: containerHeight };

    const { width, height, zoom } = this.calculateCanvasSize();

    if (width > 0 && height > 0) {
      // Resize the renderer
      this.app.renderer.resize(width, height);

      // Update stage layout dimensions
      if ((this.app.stage as any).layout) {
        (this.app.stage as any).layout.width = this.app.screen.width;
        (this.app.stage as any).layout.height = this.app.screen.height;
      }

      // Resize picking texture
      if (this.pickingSystem) {
        this.pickingSystem.initializeTexture(width, height);
      }

      // Update banner size
      if (this.banner) {
        this.banner.resize(width, zoom);
      }

      // Also set canvas element size explicitly
      if (this.app.canvas) {
        this.app.canvas.style.width = `${width}px`;
        this.app.canvas.style.height = `${height}px`;
      }

	      // Update zoom if map is loaded
	      if (this.currentMapData && this.mapContainer) {
	        // Recompute base zoom from container size but preserve the user's
	        // relative zoom level (currentZoomIndex). This mirrors the old
	        // Svelte behaviour where `gameScale` changes on resize but `zoom`
	        // stays the same.
	        this.userControlledZoom = false;
	        this.baseZoom = zoom;
	
	        // Effective zoom after resize
	        const multiplier = this.zoomLevels[this.currentZoomIndex] ?? 1;
	        this.currentZoom = this.baseZoom * multiplier;
	
	        // Texture scale is independent from DOM/canvas size (we currently
	        // always use 1.5x assets), so no need to rebuild the map here unless
	        // we change getTargetScaleForZoom() in the future.
	        this.mapContainer.scale.set(this.currentZoom);
	        this.clampCameraToBounds();
	      }
    }
  }

	  // Get current viewport size in CSS pixels, matching what pointer events use
	  private getViewportSize(): { width: number; height: number } {
	    if (this.app && this.app.canvas) {
	      const rect = this.app.canvas.getBoundingClientRect();
	      return { width: rect.width, height: rect.height };
	    }
	    if (this.app && this.app.renderer) {
	      return {
	        width: this.app.renderer.width,
	        height: this.app.renderer.height,
	      };
	    }
	    const { DISPLAY_WIDTH, DISPLAY_HEIGHT } = MAP_CONSTANTS;
	    return { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT };
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
	    this.userControlledZoom = true; // User manually changed zoom

	    // Mark picking system dirty since transform will change
	    if (this.pickingSystem) {
	      this.pickingSystem.markDirty();
	    }
	    const newMultiplier = this.zoomLevels[newIndex]!;
	    this.setZoom(newMultiplier, anchorX, anchorY);
  }

  private handlePointerDown(e: any) {
    // Close any open context menu if clicking outside of it
    if (this.currentContextMenu?.isOpen()) {
      const menuBounds = this.currentContextMenu.getContainer().getBounds();
      if (
        e.global.x < menuBounds.left ||
        e.global.x > menuBounds.right ||
        e.global.y < menuBounds.top ||
        e.global.y > menuBounds.bottom
      ) {
        this.currentContextMenu.hide();
      }
    }

    // Check for pixel-perfect pick before starting drag
    if (this.pickingSystem && this.mapContainer) {
      // Use screen coordinates for bounding box check (getBounds() returns global coords)
      const pickResult = this.pickingSystem.pick(
        e.global.x,
        e.global.y,
        this.mapContainer,
        true // Force update on click
      );

      if (pickResult) {
        this.lastPickedObject = pickResult;
        console.log(`Clicked on object ID: ${pickResult.object.id} at (${pickResult.x}, ${pickResult.y})`);

        // Check if it's a zaap and show context menu
        if (this.isZaap(pickResult.object.id)) {
          this.showZaapContextMenu(e.global.x, e.global.y);
          return; // Don't start dragging if we clicked a zaap
        }

        return; // Don't start dragging if we clicked an object
      }
    }

    this.isDragging = true;
    this.lastPointerPos = { x: e.global.x, y: e.global.y };
  }

  private handlePointerMove(e: any) {
    // Update debug cursor on picking texture overlay
    if (this.showPickingTexture && this.debugPickingTextureSprite) {
      if (!this.debugPickingCursor) {
        this.debugPickingCursor = new Graphics();
        this.debugPickingCursor.circle(0, 0, 3);
        this.debugPickingCursor.fill({ color: 0x00FF00 }); // Green dot
        this.debugPickingCursor.zIndex = 10001;
        this.app!.stage.addChild(this.debugPickingCursor);
      }

      // Position cursor at mouse location scaled to picking texture overlay
      const scale = this.debugPickingTextureSprite.scale.x;
      const offsetX = this.debugPickingTextureSprite.x;
      const offsetY = this.debugPickingTextureSprite.y;
      this.debugPickingCursor.position.set(
        offsetX + e.global.x * scale,
        offsetY + e.global.y * scale
      );
      this.debugPickingCursor.visible = true;
    } else if (this.debugPickingCursor) {
      this.debugPickingCursor.visible = false;
    }

    // Update pixel-perfect hover detection
    if (this.pickingSystem && this.mapContainer && !this.isDragging) {
      // Use screen coordinates for bounding box check (getBounds() returns global coords)
      const pickResult = this.pickingSystem.pick(
        e.global.x,
        e.global.y,
        this.mapContainer,
        false // Use throttling for hover
      );

      // Update hovered object state
      const prevHovered = this.hoveredObject;
      this.hoveredObject = pickResult;

      // Apply hover effects
      if (prevHovered?.object.id !== pickResult?.object.id) {
        // Remove hover effect from previous object
        if (prevHovered) {
          const prevSprite = prevHovered.object.sprite;
          prevSprite.filters = null; // Remove filters
          console.log('Hover ended');
        }

        // Apply hover effect to new object
        if (pickResult) {
          const sprite = pickResult.object.sprite;

          const colorMatrix = new ColorMatrixFilter();
          colorMatrix.matrix = [
            0.6, 0,   0,   0, 0.3,
            0,   0.6, 0,   0, 0.3,
            0,   0,   0.6, 0, 0.3,
            0,   0,   0,   1, 0
          ];
          colorMatrix.resolution = window.devicePixelRatio; // Match screen resolution
          sprite.filters = [colorMatrix];

          console.log(`Hovering interactive object ID: ${pickResult.object.id}`);
        }

        // Change cursor
        if (this.app?.canvas) {
          this.app.canvas.style.cursor = pickResult ? 'pointer' : 'default';
        }

        // Redraw debug overlay when hover changes
        if (this.debugVisible && this.currentMapData) {
          const mapScale = this.computeMapScale(this.currentMapData.width, this.currentMapData.height);
          this.redrawDebugInfo(mapScale);
        }
      }
    }

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

    // Mark picking system dirty when camera moves
    if (this.pickingSystem) {
      this.pickingSystem.markDirty();
    }
  }

  private handlePointerUp() {
    this.isDragging = false;
  }

  private async setZoom(newZoom: number, anchorX?: number, anchorY?: number) {
	    if (!this.mapContainer) return;
	
	    const targetZoom = this.baseZoom * newZoom;
	    if (targetZoom === this.currentZoom) return;
	
	    const oldZoom = this.currentZoom || this.baseZoom;
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

	    this.currentZoom = targetZoom;

    // Check if we need to switch texture scale for sharper rendering
    const newTargetScale = this.getTargetScaleForZoom();
    const needsRebuild = this.currentTileScale !== null && this.currentTileScale !== newTargetScale;

    // Scale the container
    container.scale.set(this.currentZoom);

    // Rebuild map with new texture scale if needed
    if (needsRebuild && this.manifest && this.currentMapData) {
      console.log(`Zoom changed texture scale from ${this.currentTileScale}x to ${newTargetScale}x - rebuilding map`);
      this.textureCache.clear();
      await this.renderMap(this.currentMapData);
    } else if (this.currentTileScale === null && this.manifest && this.currentMapData) {
      // Initial load
      this.textureCache.clear();
      await this.renderMap(this.currentMapData);
    }

    // Rebuild character sprites if scale changed
    if (needsRebuild && this.stressContainer && this.stressContainer.children.length > 0) {
      console.log(`Rebuilding character sprites from ${this.currentCharacterScale}x to ${newTargetScale}x`);
      const spriteCount = this.stressContainer.children.length;
      await this.reloadCharacterSprites(newTargetScale, spriteCount);
    } else if (this.currentCharacterScale === null && this.stressContainer) {
      console.log(`Initial character sprites load at ${newTargetScale}x`);
      const spriteCount = this.stressContainer.children.length;
      await this.reloadCharacterSprites(newTargetScale, spriteCount);
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
			
			    const { width: viewportWidth, height: viewportHeight } = this.getViewportSize();
			    const zoom = this.mapContainer.scale.x || 1;
			
			    // Clamp against the *logical* Dofus display area (742x432), exactly
			    // like the original client and the old Svelte MapRenderer. The map
			    // content itself may be rendered at 1.5x/2x/3x internally, but in
			    // screen space we never allow panning beyond this logical window
			    // scaled by the current zoom.
			    const { DISPLAY_WIDTH, DISPLAY_HEIGHT } = MAP_CONSTANTS;
			    const mapWidth = DISPLAY_WIDTH * zoom;
			    const mapHeight = DISPLAY_HEIGHT * zoom;
			
			    let x = this.mapContainer.x;
			    let y = this.mapContainer.y;
			
			    const minX = Math.min(0, viewportWidth - mapWidth);
			    const maxX = 0;
			    if (x < minX) x = minX;
			    else if (x > maxX) x = maxX;
			
			    const minY = Math.min(0, viewportHeight - mapHeight);
			    const maxY = 0;
			    if (y < minY) y = minY;
			    else if (y > maxY) y = maxY;
			
			    this.mapContainer.x = x;
			    this.mapContainer.y = y;
			  }

	      // Decide which atlas scale to use for tiles/characters.
	      //
	      // IMPORTANT: this is based **only** on the user zoom multiplier
	      // (zoomLevels[currentZoomIndex]), *not* on baseZoom/container size.
	      // That way layout math stays in 1x logical Dofus space and swapping
	      // between 1.5x/2x/3x atlases never changes positions, only sharpness.
	      //
	      // Heuristic (mirrors old TileLoader behaviour):
	      //   - multiplier <= ~1.5  → prefer 1.5x assets
	      //   - multiplier around 2 → prefer 2x assets
	      //   - multiplier >= ~2.5 → prefer 3x assets
	      //
	      // Per‑tile we still clamp to the best available scale via
	      // getBestAvailableScale(), so tiles missing a variant will gracefully
	      // fall back to the nearest lower scale.
		  private getTargetScaleForZoom(): number {
		    // With 6x assets, select texture scale based on effective zoom
		    const effectiveZoom = this.currentZoom || this.baseZoom || 1;

		    // Map zoom levels to texture scales for crisp rendering:
		    // - zoom <= 1.2 → use 2x assets (supersample factor 2)
		    // - zoom 1.2-2.5 → use 4x assets (supersample factor 4)
		    // - zoom > 2.5 → use 6x assets (supersample factor 6)
		    if (effectiveZoom <= 1.2) return 2;
		    if (effectiveZoom <= 2.5) return 4;
		    return 6;
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
    if (this.assetMode === 'unified') {
      // Load unified manifest with all tiles
      const response = await fetch('/assets/maps/tiles/manifest.json');
      this.regionManifest = await response.json();
      this.manifest = this.regionManifest as unknown as TilesManifest;

      if (this.regionManifest) {
        console.log('Unified manifest loaded with', Object.keys(this.regionManifest.tiles).length, 'tiles');
      }

      // Initialize region loader
      if (this.app) {
        this.regionLoader = new RegionAtlasLoader(this.app.renderer, '/assets/maps/tiles');
      }
    } else if (this.assetMode === 'individual') {
      // Individual tile JSON mode - no unified manifest needed
      // Initialize region loader for on-demand tile JSON loading
      if (this.app) {
        this.regionLoader = new RegionAtlasLoader(this.app.renderer, '/assets/maps/tiles');
      }

      // Create a minimal manifest structure for compatibility
      this.regionManifest = {
        version: 2,
        format: 'individual',
        scales: [1], // Will be determined per-tile based on supersample
        tiles: {},
      };
      this.manifest = this.regionManifest as unknown as TilesManifest;
      console.log('Individual tile JSON mode enabled (tiles will be loaded on demand)');
    } else if (this.assetMode === 'regions') {
      // Load region-based WebP manifest
      const response = await fetch('/assets/maps/tilesv4/manifest.json');
      this.regionManifest = await response.json();
      // Also set legacy manifest for compatibility
      this.manifest = this.regionManifest as unknown as TilesManifest;
      console.log('Region manifest loaded with scales:', this.regionManifest?.scales);

      // Initialize region loader
      if (this.app) {
        this.regionLoader = new RegionAtlasLoader(this.app.renderer, '/assets/maps/tiles');
      }
    }
  }

  async loadMap(mapId: number) {
    if (!this.app || !this.mapContainer) return;

    console.log(`Loading map ${mapId}...`);

    const response = await fetch(`/assets/maps/${mapId}.json`);
    const mapData: MapData = await response.json();

    console.log(`Map ${mapId} loaded:`, mapData.width, 'x', mapData.height);

    this.currentMapData = mapData;

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
	    const {
	      DISPLAY_WIDTH,
	      DISPLAY_HEIGHT,
	      CELL_WIDTH,
	      CELL_HEIGHT,
	      DEFAULT_WIDTH,
	      DEFAULT_HEIGHT,
	    } = MAP_CONSTANTS;

	    // Match the original /apps/client behavior exactly.
	    //
	    //  - Default-size maps (15x17) use the full display with scale 1 and no offset.
	    //  - Maps larger than default in *both* dimensions are uniformly scaled so that
	    //    the bigger side fits within DISPLAY_WIDTH/DISPLAY_HEIGHT.
	    //  - Maps that are only larger in one dimension are not scaled; they are
	    //    simply centered within the fixed 742x432 display area.
	    if (mapHeight === DEFAULT_HEIGHT && mapWidth === DEFAULT_WIDTH) {
	      return { scale: 1, offsetX: 0, offsetY: 0 };
	    }

	    let scale = 1;
	    let actualWidth: number;
	    let actualHeight: number;

	    if (mapHeight > DEFAULT_HEIGHT && mapWidth > DEFAULT_WIDTH) {
	      const totalWidth = (mapWidth - 1) * CELL_WIDTH;
	      const totalHeight = (mapHeight - 1) * CELL_HEIGHT;

	      scale =
	        mapHeight > mapWidth
	          ? DISPLAY_WIDTH / totalWidth
	          : DISPLAY_HEIGHT / totalHeight;

	      actualWidth = Math.floor(totalWidth * scale);
	      actualHeight = Math.floor(totalHeight * scale);
	    } else {
	      scale = 1;
	      actualWidth = (mapWidth - 1) * CELL_WIDTH;
	      actualHeight = (mapHeight - 1) * CELL_HEIGHT;
	    }

	    if (actualWidth === DISPLAY_WIDTH && actualHeight === DISPLAY_HEIGHT) {
	      return { scale, offsetX: 0, offsetY: 0 };
	    }

	    const offsetX = (DISPLAY_WIDTH - actualWidth) / 2;
	    const offsetY = (DISPLAY_HEIGHT - actualHeight) / 2;

	    return {
	      scale,
	      offsetX: Math.trunc(offsetX),
	      offsetY: Math.trunc(offsetY),
	    };
	  }

  private async renderMap(mapData: MapData) {
    if (!this.mapContainer || !this.manifest) return;

    // Preserve stress container during map rebuild (for zoom rebuilds)
    const preservedStressContainer = this.stressContainer;
    if (preservedStressContainer && this.mapContainer.children.includes(preservedStressContainer)) {
      this.mapContainer.removeChild(preservedStressContainer);
    }

    // Clear old layers before creating new ones (critical for zoom rebuilds)
    this.mapContainer.removeChildren();
    this.spriteCount = 0;

    // Clear pickable objects from previous map
    this.clearPickableObjects();

	    const { width: mapWidth, height: mapHeight, cells, backgroundNum } = mapData;
	    const mapScale = this.computeMapScale(mapWidth, mapHeight);
	    this.currentMapScale = mapScale;

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
	    const scaleDir = this.currentTileScale === 1.5 ? '1.5x' : this.currentTileScale === 2 ? '2x' : '3x';
	    console.log(
	      `[MapRendererEngine] Rebuilt map at tile scale ${scaleDir} (multiplier=${this.zoomLevels[this.currentZoomIndex] ?? 1}, zoom=${this.currentZoom.toFixed(3)})`,
	    );

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

        // Scale background to fill BOTH map width and height (use max to ensure coverage)
        const totalMapWidth = (mapWidth - 1) * MAP_CONSTANTS.CELL_WIDTH;
        const totalMapHeight = (mapHeight - 1) * MAP_CONSTANTS.CELL_HEIGHT;
        const actualMapWidth = totalMapWidth * mapScale.scale;
        const actualMapHeight = totalMapHeight * mapScale.scale;

        const scaleX = fullPxWidth > 0 ? actualMapWidth / fullPxWidth : mapScale.scale;
        const scaleY = fullPxHeight > 0 ? actualMapHeight / fullPxHeight : mapScale.scale;
        // Use the larger scale to ensure background covers entire map
        const bgScale = Math.max(scaleX, scaleY);

        // Get base offsets from manifest (usually 0 for backgrounds, but account for them)
        const bgBaseX = bgTile?.offsetX ?? 0;
        const bgBaseY = bgTile?.offsetY ?? 0;

        bgSprite.scale.set(bgScale, bgScale);
        bgSprite.anchor.set(0, 0);

        // Apply offsets and trim adjustment
        // Use consistent Math.round() to match tile positioning
        const bgTopLeftX = Math.round((bgBaseX + trimXLogical) * mapScale.scale + mapScale.offsetX);
        const bgTopLeftY = Math.round((bgBaseY + trimYLogical) * mapScale.scale + mapScale.offsetY);

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

        const sprite = await this.createTileSprite(cell.ground, 'ground');
        if (sprite) {
          // After sprite is loaded, tile metadata is available
          const targetFrame = this.getFrameIndexForTile(cell.ground, 'ground', cell.id, groundSlope);
          const isSlope = this.isSlopeTile(cell.ground, 'ground');
          const groundRot = isSlope && groundSlope !== 1 ? 0 : cell.layerGroundRot;

          // Load correct frame if not frame 0
          const finalSprite = targetFrame > 0 ? await this.createTileSprite(cell.ground, 'ground', targetFrame) : sprite;
          if (finalSprite) {
            this.positionSprite(finalSprite, cell.ground, 'ground', basePosition, groundRot, cell.layerGroundFlip, cell.id, mapScale);
            groundLayer.addChild(finalSprite);
            this.spriteCount++;
            debugGroundCount++;
          }
        }
      }

      // Layer 1 (objects) - rotation only applies when groundSlope == 1
      if (cell.layer1 > 0) {
        const groundSlope = cell.groundSlope ?? 1;
        const objRot = groundSlope === 1 ? cell.layerObject1Rot : 0;

        const sprite = await this.createTileSprite(cell.layer1, 'objects');
        if (sprite) {
          const targetFrame = this.getFrameIndexForTile(cell.layer1, 'objects', cell.id, groundSlope);
          const finalSprite = targetFrame > 0 ? await this.createTileSprite(cell.layer1, 'objects', targetFrame) : sprite;
          if (finalSprite) {
            this.positionSprite(finalSprite, cell.layer1, 'objects', basePosition, objRot, cell.layerObject1Flip, cell.id, mapScale);
            objectLayer1.addChild(finalSprite);
            this.spriteCount++;
            debugLayer1Count++;

            // Register interactive object for pixel-perfect picking (only if it's actually interactive)
            if (this.isInteractiveTile(cell.layer1)) {
              const pickableId = this.nextPickableId++;
              this.registerPickableObject(pickableId, finalSprite, cell.layer1);
            }
          }
        }
      }

      // Layer 2 (objects) - NO rotation, only flip
      if (cell.layer2 > 0) {
        const groundSlope = cell.groundSlope ?? 1;

        // Load frame 0 first to get metadata
        const sprite = await this.createTileSprite(cell.layer2, 'objects');
        if (sprite) {
          // Check if this is an animated tile
          if (this.isAnimatedTile(cell.layer2, 'objects')) {
            const animSprite = await this.createAnimatedTileSprite(cell.layer2, 'objects');
            if (animSprite) {
              this.positionSprite(animSprite, cell.layer2, 'objects', basePosition, 0, cell.layerObject2Flip, cell.id, mapScale);
              animatedLayer.addChild(animSprite);
              this.animatedSprites.push(animSprite);
              this.spriteCount++;

              // Register animated interactive object for pixel-perfect picking (only if it's actually interactive)
              if (this.isInteractiveTile(cell.layer2)) {
                const pickableId = this.nextPickableId++;
                this.registerPickableObject(pickableId, animSprite, cell.layer2);
              }
            }
          } else {
            const targetFrame = this.getFrameIndexForTile(cell.layer2, 'objects', cell.id, groundSlope);
            const finalSprite = targetFrame > 0 ? await this.createTileSprite(cell.layer2, 'objects', targetFrame) : sprite;
            if (finalSprite) {
              this.positionSprite(finalSprite, cell.layer2, 'objects', basePosition, 0, cell.layerObject2Flip, cell.id, mapScale);
              objectLayer2.addChild(finalSprite);
              this.spriteCount++;
              debugLayer2Count++;

              // Register interactive object for pixel-perfect picking (only if it's actually interactive)
              if (this.isInteractiveTile(cell.layer2)) {
                const pickableId = this.nextPickableId++;
                this.registerPickableObject(pickableId, finalSprite, cell.layer2);
              }
            }
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

    // Log picking system stats
    if (this.pickingSystem) {
      const pickableCount = this.pickingSystem.getPickableObjects().length;
      console.log(`Registered ${pickableCount} pickable objects (layer1: ${debugLayer1Count}, layer2: ${debugLayer2Count})`);
    }

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

    // Re-add stress container AFTER map is rendered so it appears on top
    if (preservedStressContainer) {
      this.mapContainer.addChild(preservedStressContainer);
    }

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

    // Highlight for pixel-perfect picked object
    this.debugPickHighlight = new Graphics();
    this.debugOverlay.addChild(this.debugPickHighlight);

    // Picking texture visualization will be added to stage on first toggle

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

    // Draw pixel-perfect pick highlight
    if (this.debugPickHighlight) {
      this.debugPickHighlight.clear();
      if (this.hoveredObject && this.hoveredObject.object.sprite) {
        const sprite = this.hoveredObject.object.sprite;
        const bounds = sprite.getBounds();

        // Draw yellow rectangle around picked sprite
        this.debugPickHighlight.rect(bounds.x, bounds.y, bounds.width, bounds.height);
        this.debugPickHighlight.stroke({ width: 3, color: 0xFFFF00 });
        this.debugPickHighlight.fill({ color: 0xFFFF00, alpha: 0.1 });
      }
    }

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

    // Add pixel-perfect picking info
    if (this.hoveredObject) {
      lines.push('');
      lines.push(`[Picking] Object ID: ${this.hoveredObject.object.id}`);
      const tileId = Math.floor(this.hoveredObject.object.id / 1000000);
      const cellId = this.hoveredObject.object.id % 1000000;
      const isLayer2 = cellId > 500000;
      lines.push(`  Tile: ${tileId}, Cell: ${isLayer2 ? cellId - 500000 : cellId}`);
      lines.push(`  Layer: ${isLayer2 ? '2' : '1'}`);
    }

    this.debugText.text = lines.join('\n');

    // Position text on left if approaching right edge of viewport, otherwise on right
    const viewport = this.getViewportSize();
    const cellScreenX = (screenX + hw) * this.currentZoom + this.mapContainer.x;
    const distanceFromRightEdge = viewport.width - cellScreenX;

    // Switch to left side if within 200px of right edge
    if (distanceFromRightEdge < 200) {
      this.debugText.x = screenX - this.debugText.width - 10;
    } else {
      this.debugText.x = screenX + hw * 2 + 10;
    }
    this.debugText.y = screenY;
  }

  /**
   * Get tile frame count
   */
  private getTileFrameCount(tileId: number, type: 'ground' | 'objects'): number {
    const tile = this.getTileData(tileId, type);
    return tile?.frameCount ?? 0;
  }

  /**
   * Get tile behavior string
   */
  private getTileBehavior(tileId: number, type: 'ground' | 'objects'): string | null {
    const tile = this.getTileData(tileId, type);
    return tile?.behavior ?? null;
  }

  // Asset loading mode: 'unified' = unified manifest with WebP atlases, 'regions' = region-based WebP atlases, 'individual' = individual tile JSONs + WebP files
  private assetMode: 'unified' | 'regions' | 'individual' = 'unified';

  private async createTileSprite(tileId: number, type: 'ground' | 'objects', frameIndex: number = 0): Promise<Sprite | null> {
    const tileKey = `${type}_${tileId}`;

    // In individual mode, we don't need to check the manifest first
    // The regionLoader will load the tile JSON on demand
    if (this.assetMode === 'individual' && this.regionLoader && this.regionManifest) {
      const targetScale = this.getTargetScaleForZoom();
      const cacheKey = `${type}:${tileId}:${targetScale}:frame${frameIndex}`;

      if (this.textureCache.has(cacheKey)) {
        const cachedTexture = this.textureCache.get(cacheKey);
        const sprite = new Sprite(cachedTexture);
        sprite.anchor.set(0, 0);
        sprite.roundPixels = true;
        return sprite;
      }

      try {
        // Load tile on demand - regionLoader will fetch the individual JSON
        const texture = await this.regionLoader.loadFrame(this.regionManifest, tileKey, frameIndex, targetScale);
        if (texture) {
          const source: any = (texture as any).source;
          if (source) {
            source.scaleMode = 'nearest';
          }
          this.textureCache.set(cacheKey, texture);
          const sprite = new Sprite(texture);
          sprite.anchor.set(0, 0);
          sprite.roundPixels = true;
          return sprite;
        }
      } catch (err) {
        console.warn(`Failed to load individual tile ${tileKey}:${frameIndex}`, err);
      }
      return null;
    }

    // For other modes, we need the manifest
    if (!this.manifest) return null;

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
	      // Favour pixel-perfect rendering for tiles
	      sprite.roundPixels = true;
	      return sprite;
    }

    // Unified or region-based WebP atlas loading (most efficient)
    if ((this.assetMode === 'unified' || this.assetMode === 'regions') && this.regionLoader && this.regionManifest) {
      try {
        const texture = await this.regionLoader.loadFrame(this.regionManifest, tileKey, frameIndex, chosenScale);
        if (texture) {
	          // Ensure nearest-neighbour sampling even if loader defaults change.
	          const source: any = (texture as any).source;
	          if (source) {
	            source.scaleMode = 'nearest';
	          }
          this.textureCache.set(cacheKey, texture);
	          const sprite = new Sprite(texture);
	          sprite.anchor.set(0, 0);
	          sprite.roundPixels = true;
	          return sprite;
        }
      } catch (err) {
        console.warn(`Failed to load atlas for ${tileKey}:${frameIndex}`, err);
      }
      return null;
    }

    // Should not reach here in unified, individual, or regions mode
    return null;
  }

  /**
   * Get tile metadata from manifest (returns null if not loaded yet)
   */
  private getTileData(tileId: number, type: 'ground' | 'objects'): TileData | null {
    if (!this.manifest) return null;
    const tileKey = `${type}_${tileId}`;
    return this.manifest.tiles[tileKey] || null;
  }

  /**
   * Check if a tile is a slope tile (uses groundSlope for frame selection)
   */
  private isSlopeTile(tileId: number, type: 'ground' | 'objects'): boolean {
    const tile = this.getTileData(tileId, type);
    if (!tile) return false;
    return tile.behavior === 'slope' && tile.frameCount > 1;
  }

  /**
   * Get the frame index to use for a tile based on its behavior
   */
  private getFrameIndexForTile(tileId: number, type: 'ground' | 'objects', cellId: number, groundSlope: number): number {
    const tile = this.getTileData(tileId, type);
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
    const tile = this.getTileData(tileId, type);
    return tile?.behavior === 'animated' && (tile?.frameCount ?? 0) > 1;
  }

  /**
   * Create an AnimatedSprite for an animated tile
   */
  private async createAnimatedTileSprite(tileId: number, type: 'ground' | 'objects'): Promise<AnimatedSprite | null> {
    const tileKey = `${type}_${tileId}`;
    const tile = this.getTileData(tileId, type);

    if (!tile) {
      console.warn(`Cannot load animated tile: tile metadata not found for ${tileKey}`);
      return null;
    }

    // Individual or Region-based WebP atlas loading
    if (!this.regionLoader || !this.regionManifest) {
      console.warn(`Cannot load animated tile: regionLoader not initialized`);
      return null;
    }

    try {
      const targetScale = this.getTargetScaleForZoom();
      const textures = await this.regionLoader.loadAnimationFrames(this.regionManifest, tileKey, targetScale);

      if (textures.length === 0) return null;

      const animSprite = new AnimatedSprite(textures);
      animSprite.anchor.set(0, 0);

      // Set animation properties from tile metadata
      const fps = tile.fps ?? 24;
      animSprite.animationSpeed = 1; // Advance 1 frame per ticker update for 24fps
      animSprite.loop = tile.loop !== false;

      if (tile.autoplay !== false) {
        animSprite.play();
      }

      return animSprite;
    } catch (err) {
      console.warn(`Failed to load animated tile: ${tileKey}`, err);
      return null;
    }
  }

	  private normalizeRotation(rotation: number): number {
	    const r = rotation % 4;
	    return r < 0 ? r + 4 : r;
	  }

	  private computePhpLikeOffsets(tile: TileData, rotation: number, flip: boolean): { offsetX: number; offsetY: number; width: number; height: number } {
	    const baseWidth = tile.width;
	    const baseHeight = tile.height;
	    const baseOffsetX = tile.offsetX;
	    const baseOffsetY = tile.offsetY;
	
	    const r = this.normalizeRotation(rotation);
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
	    const r = this.normalizeRotation(rotation);
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

	  private positionSprite(
	    sprite: Sprite,
	    tileId: number,
	    type: 'ground' | 'objects',
	    position: { x: number; y: number },
	    rotation: number,
	    flip: boolean,
	    cellId: number,
	    mapScale: { scale: number; offsetX: number; offsetY: number },
	  ) {
	    if (!this.manifest) return;
	
	    const tileKey = `${type}_${tileId}`;
	    const tile = this.manifest.tiles[tileKey];
	    if (!tile) return;
	
	    const r = this.normalizeRotation(rotation);
	
	    // --- Logical (1x) dimensions & offsets ---------------------------------
	    // Match the old Svelte MapRenderer exactly: use tile.width/height and
	    // PHP-like offsets in 1x logical space, independent of the texture scale.
	    const baseWidth = tile.width || sprite.width;
	    const baseHeight = tile.height || sprite.height;
	
	    const { offsetX, offsetY } = this.computePhpLikeOffsets(tile, r, flip);
	
	    // --- Texture / atlas metadata (pixel space, possibly trimmed) ----------
	    const tex: any = sprite.texture as any;
	    const origWpx: number = tex._origW || sprite.texture.width;
	    const origHpx: number = tex._origH || sprite.texture.height;
	    const trimXPx: number = tex._trimX || 0;
	    const trimYPx: number = tex._trimY || 0;
	    const textureScale: number = tex._scale || 1;
	
	    // Pixels-per-logical-unit for this tile at the chosen asset scale.
	    // Prefer computing it directly from manifest width/height; fall back
	    // to the stored texture scale when metadata is missing.
	    const assetScaleX = baseWidth > 0 && origWpx > 0 ? origWpx / baseWidth : textureScale || 1;
	    const assetScaleY = baseHeight > 0 && origHpx > 0 ? origHpx / baseHeight : textureScale || 1;

	    console.log(`Positioning ${tile.id}: baseWidth=${baseWidth}, origWpx=${origWpx}, assetScaleX=${assetScaleX}, textureScale=${textureScale}`);
	
	    // Convert trim from pixel space back into logical (1x) space so that all
	    // subsequent math stays in the same unit system as the old renderer.
	    const trimXLogical = trimXPx / assetScaleX;
	    const trimYLogical = trimYPx / assetScaleY;
	
	    // --- Rotation / flip scaling (still in logical units) ------------------
	    let scaleX = 1;
	    let scaleY = 1;
	    if (r === 1 || r === 3) {
	      scaleX = ROT_SCALE_X;
	      scaleY = ROT_SCALE_Y;
	    }
	    if (flip) {
	      scaleX *= -1;
	    }
	
	    const globalScale = mapScale.scale;
	    const finalScaleX = scaleX * globalScale;
	    const finalScaleY = scaleY * globalScale;
	
	    // Compute transformed minimum in logical space using the *logical*
	    // width/height, exactly like the old Svelte implementation.
	    const { minX, minY } = this.computeTransformedMin(
	      baseWidth,
	      baseHeight,
	      r,
	      finalScaleX,
	      finalScaleY,
	    );
	
	    // Apply rotation. Scale on the sprite is the logical scale divided by
	    // the asset pixel scale so that the final screen size matches what the
	    // old 1x renderer would produce.
	    sprite.angle = r * 90;
	    const spriteScaleX = finalScaleX / assetScaleX;
	    const spriteScaleY = finalScaleY / assetScaleY;
	    sprite.scale.set(spriteScaleX, spriteScaleY);
	
	    // Top-left of the *logical* (uncropped) tile before global scaling.
	    const topLeftBaseX = position.x + offsetX;
	    const topLeftBaseY = position.y + offsetY;
	
	    // Apply global map scale + offset (MapScale::applyToImage equivalent)
	    const topLeftScaledX = topLeftBaseX * globalScale + mapScale.offsetX;
	    const topLeftScaledY = topLeftBaseY * globalScale + mapScale.offsetY;
	
	    // Cropping shifts the origin of the texture relative to the logical
	    // tile rectangle by (trimXLogical, trimYLogical). We need to rotate that
	    // offset with the same final scale so that the visible part of the
	    // trimmed texture lines up with where the full 1x tile would have been.
	    const angleRad = (this.normalizeRotation(rotation) * Math.PI) / 2;
	    const cos = Math.cos(angleRad);
	    const sin = Math.sin(angleRad);
	
	    const trimScaledX = trimXLogical * finalScaleX;
	    const trimScaledY = trimYLogical * finalScaleY;
	    const deltaX = trimScaledX * cos - trimScaledY * sin;
	    const deltaY = trimScaledX * sin + trimScaledY * cos;
	
	    // Final sprite position: old top-left minus transformed minimum, plus
	    // the rotated trim offset so that cropping is invisible in world space.
	    sprite.x = Math.round(topLeftScaledX - minX + deltaX);
	    sprite.y = Math.round(topLeftScaledY - minY + deltaY);
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

    // Create or reuse stress container
    if (!this.stressContainer) {
      this.stressContainer = new Container();
      this.mapContainer.addChild(this.stressContainer);
    }
    const stressContainer = this.stressContainer;

    console.log('Map bounds:', this.mapBounds);
    console.log('Map container position:', { x: this.mapContainer.x, y: this.mapContainer.y });
    console.log('Map container scale:', { x: this.mapContainer.scale.x, y: this.mapContainer.scale.y });

    const spriteIds = [10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91];
    const animationTypes = ['walk', 'static', 'emote1'];
    const directions = ['R', 'L', 'F', 'B'];

    const textureCache = new Map<number, Map<string, Texture[]>>();

    console.log('Pre-loading character textures...');

    // Choose scale based on current zoom (same as map tiles)
    const targetScale = this.getTargetScaleForZoom();
    const scaleDir = targetScale === 1.5 ? '1.5x' : targetScale === 2 ? '2x' : '3x';
    const assetScale = targetScale;
    const displayScale = 1 / assetScale; // Scale down to compensate for upscaled assets

    this.currentCharacterScale = targetScale;
    console.log(`Loading character sprites at scale: ${scaleDir} (zoom: ${this.currentZoom})`);

    for (const spriteId of spriteIds) {
      try {
        // Load the scale-specific manifest with region data
        const manifestResponse = await fetch(`/assets/sprites/characters/char_${spriteId}/${scaleDir}/manifest.json`);
        if (!manifestResponse.ok) continue;

        const manifest = await manifestResponse.json();
        const spriteAnimations = new Map<string, Texture[]>();

        // Map old animation keys to new format
        // Old: 'walk_R', 'static_L', 'emote1_F'
        // New: 'walkR', 'staticL', 'emote1F'
        for (const animType of animationTypes) {
          for (const dir of directions) {
            const animKey = `${animType}_${dir}`;
            const animName = `${animType}${dir}`; // New format without underscore

            // Find animation in manifest
            const anim = manifest.animations?.find((a: any) => a.name === animName);
            if (!anim) continue;

            try {
              // Check if already cached at this scale
              const cacheKey = `${spriteId}_${animKey}_${scaleDir}`;
              if (this.characterTextureCache.has(spriteId)) {
                const cachedAnims = this.characterTextureCache.get(spriteId)!;
                if (cachedAnims.has(animKey)) {
                  spriteAnimations.set(animKey, cachedAnims.get(animKey)!);
                  continue;
                }
              }

              // Load the sprite sheet atlas
              const atlasPath = `/assets/sprites/characters/char_${spriteId}/${scaleDir}/${anim.spriteSheet}`;
              const atlasTexture = await Assets.load(atlasPath);

              // Load all frames from sprite sheet (fast now - no reconstruction needed!)
              const animFrames: Texture[] = [];

              for (let frameIdx = 0; frameIdx < anim.frames.length; frameIdx++) {
                const frameData = anim.frames[frameIdx];
                if (!frameData) {
                  console.warn(`Skipping frame ${frameIdx} for ${animName} - no frame data`);
                  continue;
                }

                // Simple texture extraction from sprite sheet atlas
                const frameTexture = new Texture({
                  source: atlasTexture.source,
                  frame: new Rectangle(frameData.x, frameData.y, frameData.w, frameData.h),
                });

                animFrames.push(frameTexture);
              }

              // Debug first sprite
              if (spriteId === spriteIds[0] && animKey === 'walk_R') {
                console.log('Loaded animation:', {
                  spriteId,
                  animName,
                  frameCount: animFrames.length,
                  firstFrameSize: animFrames[0] ? { w: animFrames[0].width, h: animFrames[0].height } : null
                });
              }

              if (animFrames.length > 0) {
                spriteAnimations.set(animKey, animFrames);
              }
            } catch (err) {
              // Skip failed animations
              console.warn(`Failed to load animation ${animName} for sprite ${spriteId}:`, err);
            }
          }
        }

        if (spriteAnimations.size > 0) {
          textureCache.set(spriteId, spriteAnimations);
        }
      } catch (err) {
        console.error(`Failed to load sprite ${spriteId}:`, err);
      }
    }

    // Store texture cache in class property for zoom rebuilds
    this.characterTextureCache = textureCache;

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
        const [animKey, textures] = availableAnimations[Math.floor(Math.random() * availableAnimations.length)];

        // Create animated sprite with all frames
        const sprite = textures.length > 1
          ? new AnimatedSprite(textures)
          : new Sprite(textures[0]);

        sprite.anchor.set(0.5, 1);

        if (sprite instanceof AnimatedSprite) {
          sprite.animationSpeed = 1.0; // 60fps
          sprite.play();
        }

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
        this.gameWorld.addComponent(eid, 'Scale', { x: displayScale, y: displayScale });
        this.gameWorld.addComponent(eid, 'Rotation', { angle: 0 });
        this.gameWorld.addComponent(eid, 'ZIndex', { value: i });

        // Register sprite with render system
        this.renderSystem.registerSprite(eid, sprite);
        stressContainer.addChild(sprite);

        // Immediately set initial position instead of waiting for render system update
        sprite.x = x;
        sprite.y = y;
        sprite.scale.set(displayScale, displayScale);

        // Debug log first sprite
        if (i === 0) {
          console.log('First sprite debug:', {
            frameCount: textures.length,
            firstFrameSize: textures[0] ? { w: textures[0].width, h: textures[0].height } : null,
            spriteX: sprite.x,
            spriteY: sprite.y,
            spriteWidth: sprite.width,
            spriteHeight: sprite.height,
            spriteVisible: sprite.visible,
            spriteAlpha: sprite.alpha,
            isPlaying: sprite.playing,
            position: { x, y },
            containerChildren: stressContainer.children.length
          });
        }
      } catch (err) {
        console.error('Error creating sprite:', err);
      }
    }

    console.log(`Spawned ${count} stress test sprites`);
  }

  private async reloadCharacterSprites(targetScale: number, count: number) {
    if (!this.stressContainer) return;

    // Clear old character texture cache to free memory
    this.characterTextureCache.clear();

    // Clear existing sprites
    this.stressContainer.removeChildren();

    // Reload character sprites by calling spawnStressTestSprites
    // It will detect the existing container and add to it
    await this.spawnStressTestSprites(count);

    console.log(`Reloaded ${count} character sprites at ${targetScale}x scale`);
  }

  /**
   * Check if a pickable object is a zaap
   */
  private isZaap(pickableId: number): boolean {
    const gfxId = this.pickableIdToGfxId.get(pickableId);
    if (!gfxId) return false;
    const objInfo = this.interactiveObjectsData.get(gfxId);
    return objInfo?.type === 3;
  }

  /**
   * Show the zaap context menu at the specified position
   */
  private showZaapContextMenu(x: number, y: number): void {
    // Destroy old menu if it exists
    if (this.currentContextMenu) {
      this.currentContextMenu.destroy();
    }

    // Create new menu with Use button callback
    const onUse = () => {
      console.log('Zaap: Use action triggered');
      // TODO: Add zaap teleport logic here
    };

    this.currentContextMenu = new ZaapContextMenu(onUse);
    if (this.app && this.app.stage) {
      this.currentContextMenu.show(x, y, this.app.stage);
    }
  }

  /**
   * Register an interactive object for pixel-perfect picking
   * @param id - Unique identifier for the object (must be > 0)
   * @param sprite - The PixiJS sprite to register
   * @param gfxId - The graphics ID of the object (for type lookup)
   * @param bounds - Optional pre-computed bounding box for optimization
   */
  registerPickableObject(id: number, sprite: Sprite, gfxId?: number, bounds?: { x: number; y: number; width: number; height: number }): void {
    if (!this.pickingSystem) {
      console.warn('PickingSystem not initialized');
      return;
    }

    if (id <= 0) {
      console.warn('Object ID must be greater than 0 (0 is reserved for no object)');
      return;
    }

    if (gfxId !== undefined) {
      this.pickableIdToGfxId.set(id, gfxId);
    }

    this.pickingSystem.registerObject({ id, sprite, bounds });
  }

  /**
   * Unregister an interactive object
   * @param id - The object ID to unregister
   */
  unregisterPickableObject(id: number): void {
    if (!this.pickingSystem) return;
    this.pickingSystem.unregisterObject(id);
  }

  /**
   * Clear all pickable objects
   */
  clearPickableObjects(): void {
    if (!this.pickingSystem) return;
    this.pickingSystem.clear();
  }

  /**
   * Get the currently hovered object (if any)
   */
  getHoveredObject(): PickResult | null {
    return this.hoveredObject;
  }

  /**
   * Get the last clicked object (if any)
   */
  getLastPickedObject(): PickResult | null {
    return this.lastPickedObject;
  }

  /**
   * Force update the picking system (useful after scene changes)
   */
  updatePickingSystem(): void {
    if (!this.pickingSystem) return;
    this.pickingSystem.markDirty();
  }

  getStats() {
    const memory = (performance as any).memory?.usedJSHeapSize / 1024 / 1024 || 0;

    return {
      fps: this.fps,
      sprites: this.renderSystem.getSpriteCount(),
      drawCalls: this.lastDrawCalls,
      renderTime: this.lastFrameTimeMs,
      memory,
      pickableObjects: this.pickingSystem?.getPickableObjects().length || 0,
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

    // Destroy picking system
    if (this.pickingSystem) {
      this.pickingSystem.destroy();
      this.pickingSystem = null;
    }

    // Destroy banner
    if (this.banner) {
      this.banner.destroy();
      this.banner = null;
    }
  }
}
