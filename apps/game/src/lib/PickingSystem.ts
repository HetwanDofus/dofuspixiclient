import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js';

import { PickingIdFilter } from './PickingIdFilter';

/**
   * Pickable object interface - represents any interactive sprite/entity
   */
export interface PickableObject {
  id: number;           // Unique identifier
  sprite: Sprite;       // The PixiJS sprite
  bounds?: {            // Optional pre-computed bounding box for optimization
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Pick result containing the picked object and position
 */
export interface PickResult {
  object: PickableObject;
  x: number;            // Pick position in world space
  y: number;            // Pick position in world space
}

/**
 * PixelPerfectPickingSystem - Implements subframe color-based picking
 *
 * How it works:
 * 1. Maintains a hidden render texture where each object is drawn with a unique color
 * 2. When picking, reads the pixel at the mouse position from this texture
 * 3. Decodes the color back to object ID for instant lookup
 * 4. Uses bounding box optimization to avoid expensive pixel-perfect checks
 */
export class PixelPerfectPickingSystem {
  private renderer: Renderer;
  private pickingTexture: RenderTexture | null = null;
  private pickingContainer: Container | null = null;
  private pickableObjects: Map<number, PickableObject> = new Map();
  private idToPickingSprites: Map<number, Sprite> = new Map();
  private colorToId: Map<string, number> = new Map(); // Color (as "r,g,b") -> Object ID

  // Performance optimization settings
  private lastPickTime = 0;
  private minPickInterval = 16; // Minimum 16ms between picks (~60fps max)
  private textureWidth = 0;
  private textureHeight = 0;

  // Cached pixel data to avoid frequent extraction
  private cachedPixels: Uint8Array | null = null;

  // Cached pick result to avoid redundant picks
  private cachedPickPosition = { x: -1, y: -1 };
  private cachedPickResult: PickResult | null = null;

  constructor(renderer: Renderer, minPickInterval = 16) {
    this.renderer = renderer;
    this.minPickInterval = minPickInterval;
  }

  /**
   * Initialize or resize the picking texture
   */
  initializeTexture(width: number, height: number): void {
    // Only recreate if size changed
    if (this.pickingTexture && this.textureWidth === width && this.textureHeight === height) {
      return;
    }

    // Destroy old texture
    if (this.pickingTexture) {
      this.pickingTexture.destroy(true);
    }

    // Create new render texture for ID picking
    this.pickingTexture = RenderTexture.create({
      width,
      height,
      resolution: 1, // No need for high-res, we only care about pixel colors
    });

    this.textureWidth = width;
    this.textureHeight = height;
  
    this.cachedPixels = null; // Invalidate pixel cache on resize
  }

  /**
   * Register a pickable object
   */
  registerObject(object: PickableObject): void {
    this.pickableObjects.set(object.id, object);
  
    this.cachedPixels = null; // Invalidate pixel cache
  }

  /**
   * Unregister a pickable object
   */
  unregisterObject(id: number): void {
    this.pickableObjects.delete(id);

    // Clean up picking sprite
    const sprite = this.idToPickingSprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.idToPickingSprites.delete(id);
    }

  
    this.cachedPixels = null; // Invalidate pixel cache
  }

  /**
   * Clear all pickable objects
   */
  clear(): void {
    this.pickableObjects.clear();

    // Destroy all picking sprites
    for (const sprite of this.idToPickingSprites.values()) {
      sprite.destroy();
    }
    this.idToPickingSprites.clear();

  
    this.cachedPixels = null; // Invalidate pixel cache
  }

  /**
   * Rebuild the picking texture with color-coded objects
   */
  private rebuildPickingTexture(worldContainer: Container): void {
    if (!this.pickingTexture) {
      return;
    }

    // Create picking container if needed
    if (!this.pickingContainer) {
      this.pickingContainer = new Container();
    } else {
      // Clear existing children
      this.pickingContainer.removeChildren();
    }

    // Destroy old picking sprites and clear color mapping
    for (const sprite of this.idToPickingSprites.values()) {
      sprite.destroy();
    }
    this.idToPickingSprites.clear();
    this.colorToId.clear();

    // Create color-coded sprites for each pickable object
    for (const [id, object] of this.pickableObjects) {
      const sprite = object.sprite;

      // Skip invisible or fully transparent sprites
      if (!sprite.visible || sprite.alpha === 0) {
        continue;
      }

      // Assign a unique color to this object (use object ID as color value)
      // Simple scheme: pack ID into RGB channels:
      //   r =  id        & 0xFF
      //   g = (id >> 8)  & 0xFF
      //   b = (id >> 16) & 0xFF
      const r = (id & 0xFF);
      const g = ((id >> 8) & 0xFF);
      const b = ((id >> 16) & 0xFF);

      // Store the color -> ID mapping
      const colorKey = `${r},${g},${b}`;
      this.colorToId.set(colorKey, id);

      // Create a new sprite with the same texture
      const pickingSprite = new Sprite(sprite.texture);

      // Copy all sprite properties to match the original
      pickingSprite.anchor.copyFrom(sprite.anchor);
      pickingSprite.position.copyFrom(sprite.position);
      pickingSprite.scale.copyFrom(sprite.scale);
      pickingSprite.rotation = sprite.rotation;
      pickingSprite.skew.copyFrom(sprite.skew);
      pickingSprite.zIndex = sprite.zIndex || 0;

      // Override the ColorMatrixFilter with a custom shader that writes a
      // flat ID color in RGB and preserves the original per-pixel alpha
      // from the texture. This makes the picking buffer independent of
      // the sprite's source RGB values and premultiplication.
      const pickingFilter = new PickingIdFilter(r, g, b);
      pickingSprite.filters = [pickingFilter];

      pickingSprite.blendMode = 'normal';

      this.idToPickingSprites.set(id, pickingSprite);
      this.pickingContainer.addChild(pickingSprite);
    }

    // Enable sorting to match main render order
    this.pickingContainer.sortableChildren = true;

    // Apply world container's transform so sprites render at their actual positions
    this.pickingContainer.position.copyFrom(worldContainer.position);
    this.pickingContainer.scale.copyFrom(worldContainer.scale);
    this.pickingContainer.rotation = worldContainer.rotation;

    // Render to picking texture with explicit clear color
    this.renderer.render({
      container: this.pickingContainer,
      target: this.pickingTexture,
      clear: true,
      clearColor: [0, 0, 0, 0], // Clear to transparent black
    });

    // Extract and cache pixels immediately after rendering
    // This avoids the "willReadFrequently" warning by extracting once per rebuild
    const extractResult = this.renderer.extract.pixels(this.pickingTexture);

    // PixiJS v8 returns an object with {pixels: Uint8ClampedArray, width, height}
    const extractedPixels = (extractResult)?.pixels || extractResult;

    // Update texture dimensions from actual extracted size
    const extractedWidth = (extractResult)?.width || this.textureWidth;
    const extractedHeight = (extractResult)?.height || this.textureHeight;
    
    if (extractedWidth !== this.textureWidth || extractedHeight !== this.textureHeight) {
      this.textureWidth = extractedWidth;
      this.textureHeight = extractedHeight;
    }

    // Convert to Uint8Array if needed
    if (extractedPixels instanceof Uint8ClampedArray) {
      this.cachedPixels = extractedPixels as unknown as Uint8Array;
    } else if (extractedPixels) {
      // Might be a regular array or other type, convert it
      this.cachedPixels = new Uint8Array(extractedPixels);
    } else {
      this.cachedPixels = null;
    }

    // Build colorToId map: each object ID maps directly to a color
    // Use ID as the color value directly
    this.colorToId.clear();

    for (const id of this.pickableObjects.keys()) {
      const r = (id & 0xFF);
      const g = ((id >> 8) & 0xFF);
      const b = ((id >> 16) & 0xFF);
      const colorKey = `${r},${g},${b}`;
      this.colorToId.set(colorKey, id);
    }

    // Debug: Sample some pixels to see if anything was rendered
    if (this.cachedPixels) {
      // Log all non-zero pixels for analysis
      const nonZeroPixels: string[] = [];
      for (let i = 0; i < this.cachedPixels.length; i += 4) {
        const r = this.cachedPixels[i];
        const g = this.cachedPixels[i + 1];
        const b = this.cachedPixels[i + 2];
        const a = this.cachedPixels[i + 3];

        if (r > 0 || g > 0 || b > 0 || a > 0) {
          const pixelIndex = i / 4;
          const x = pixelIndex % this.textureWidth;
          const y = Math.floor(pixelIndex / this.textureWidth);
          nonZeroPixels.push(`${x},${y},${r},${g},${b},${a}`);
        }
      }
    }

  
  }

  /**
   * Pick object at screen position (throttled for performance)
   *
   * @param x - Screen x coordinate
   * @param y - Screen y coordinate
   * @param worldContainer - The world container to transform coordinates
   * @param forceUpdate - Force update even if within throttle interval
   * @returns PickResult or null if nothing was picked
   */
  pick(x: number, y: number, worldContainer: Container, forceUpdate = false): PickResult | null {
    const now = performance.now();

    // Throttle picks for performance (unless forced)
    if (!forceUpdate && (now - this.lastPickTime) < this.minPickInterval) {
      // Return cached result if picking same position
      if (this.cachedPickPosition.x === x && this.cachedPickPosition.y === y) {
        return this.cachedPickResult;
      }
      return this.cachedPickResult;
    }

    // Update last pick time
    this.lastPickTime = now;
    this.cachedPickPosition = { x, y };

    // Skip bounding box optimization for now - go straight to pixel-perfect
    // This is slower but more reliable
    return this.pixelPerfectPick(x, y, worldContainer);
  }

  /**
   * Perform pixel-perfect picking using the color-coded render texture
   */
  private pixelPerfectPick(
    x: number,
    y: number,
    worldContainer: Container
  ): PickResult | null {
    if (!this.pickingTexture) {
      this.cachedPickResult = null;
      return null;
    }

    // Rebuild picking texture if needed (also updates cachedPixels)
    this.rebuildPickingTexture(worldContainer);

    // Use cached pixels instead of extracting every time
    if (!this.cachedPixels) {
      this.cachedPickResult = null;
      return null;
    }

    const pixels = this.cachedPixels;

    // Global coordinates from PixiJS are already in the texture coordinate system
    // since the texture was rendered with the same container transforms applied
    const px = Math.floor(x);
    const py = Math.floor(y);

    // Bounds check
    if (px < 0 || px >= this.textureWidth || py < 0 || py >= this.textureHeight) {
      this.cachedPickResult = null;
      
      return null;
    }

    const offset = (py * this.textureWidth + px) * 4; // 4 bytes per pixel (RGBA)

    // Read RGBA values from the picking texture
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const a = pixels[offset + 3];

    // Treat any fully transparent pixel as empty space
    if (a === 0) {
      this.cachedPickResult = null;

      return null;
    }

    // Decode ID directly from RGB channels using the same scheme used when encoding.
    //
    // The ColorMatrixFilter used when building the picking texture writes a
    // *constant* RGB color for each object (based on its ID) and only preserves
    // the original per-pixel alpha in the A channel. That means the stored R,G,B
    // values are already the exact ID bytes we encoded, regardless of alpha.
    //
    // However, depending on filtering, compression and precision, some edge pixels
    // (especially on WEBP textures with half-transparency) can end up as
    // RGB(0,0,0) with a non-zero alpha. In that case we fall back to searching a
    // small neighborhood for the nearest non-zero ID color.
    const decodedR = r;
    const decodedG = g;
    const decodedB = b;

    // First try the raw value at the exact pixel
    let pickedId = decodedR | (decodedG << 8) | (decodedB << 16);

    // If we got ID 0 but alpha > 0, this is an "ambiguous" pixel: something was
    // drawn here (a > 0) but the RGB channels do not contain a valid encoded ID.
    // This happens mainly on semi-transparent edges where color information is
    // lost. To make picking more robust, search a small area around the cursor
    // for the nearest pixel that *does* contain a valid ID color.
    if (pickedId === 0 && a > 0) {
      const maxRadius = 4;
      let fallbackId = 0;
      let fallbackPos: { x: number; y: number } | null = null;

      outer: for (let radius = 1; radius <= maxRadius; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;

            const nx = px + dx;
            const ny = py + dy;

            if (nx < 0 || nx >= this.textureWidth || ny < 0 || ny >= this.textureHeight) {
              continue;
            }

            const nOffset = (ny * this.textureWidth + nx) * 4;
            const nr = pixels[nOffset];
            const ng = pixels[nOffset + 1];
            const nb = pixels[nOffset + 2];
            const na = pixels[nOffset + 3];

            // Skip fully transparent neighbors
            if (na === 0) continue;

            // Skip neighbors that are also RGB(0,0,0) – they don't encode an ID
            if (nr === 0 && ng === 0 && nb === 0) continue;

            const neighborId = nr | (ng << 8) | (nb << 16);

            if (neighborId && this.pickableObjects.has(neighborId)) {
              fallbackId = neighborId;
              fallbackPos = { x: nx, y: ny };
              break outer;
            }
          }
        }
      }

      if (fallbackId) {
        pickedId = fallbackId;
      }
    }

    // ID 0 is reserved for "no object"; any non-positive or missing ID means no hit
    if (!pickedId) {
      this.cachedPickResult = null;

      return null;
    }

    // Look up object
    const object = this.pickableObjects.get(pickedId);
    if (!object) {
      this.cachedPickResult = null;
      
      return null;
    }

    console.log(`  -> Found object ID ${pickedId}: ${object.sprite.constructor.name}`);

    this.cachedPickResult = {
      object,
      x,
      y,
    };
    
    return this.cachedPickResult;
  }

  /**
   * Force a rebuild of the picking texture on next pick
   */
  markDirty(): void {
  
    this.cachedPixels = null; // Invalidate pixel cache
  }

  /**
   * Get all registered pickable objects
   */
  getPickableObjects(): PickableObject[] {
    return Array.from(this.pickableObjects.values());
  }

  /**
   * Get object by ID
   */
  getObject(id: number): PickableObject | undefined {
    return this.pickableObjects.get(id);
  }

  /**
   * Get the picking texture for visualization/debugging
   */
  getPickingTexture(): RenderTexture | null {
    return this.pickingTexture;
  }

  /**
   * Get the picking container for debugging
   */
  getPickingContainer(): Container | null {
    return this.pickingContainer;
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    // Destroy picking texture
    if (this.pickingTexture) {
      this.pickingTexture.destroy(true);
      this.pickingTexture = null;
    }

    // Destroy picking container
    if (this.pickingContainer) {
      this.pickingContainer.destroy({ children: true });
      this.pickingContainer = null;
    }

    // Destroy all picking sprites
    for (const sprite of this.idToPickingSprites.values()) {
      sprite.destroy();
    }
    this.idToPickingSprites.clear();

    // Clear objects
    this.pickableObjects.clear();

    // Clear cached pixel data
    this.cachedPixels = null;
  }
}
