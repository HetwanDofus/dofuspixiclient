import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import type { PickableObject, PickResult } from '@/types';
import { PickingIdFilter } from './picking-id-filter';

export class PickingSystem {
  private renderer: Renderer;
  private pickingTexture: RenderTexture | null = null;
  private pickingContainer: Container | null = null;
  private pickableObjects: Map<number, PickableObject> = new Map();
  private idToPickingSprites: Map<number, Sprite> = new Map();
  private colorToId: Map<string, number> = new Map();

  private lastPickTime = 0;
  private minPickInterval: number;
  private textureWidth = 0;
  private textureHeight = 0;

  private cachedPixels: Uint8Array | null = null;
  private cachedPickPosition = { x: -1, y: -1 };
  private cachedPickResult: PickResult | null = null;

  constructor(renderer: Renderer, minPickInterval = 16) {
    this.renderer = renderer;
    this.minPickInterval = minPickInterval;
  }

  initializeTexture(width: number, height: number): void {
    if (this.pickingTexture && this.textureWidth === width && this.textureHeight === height) {
      return;
    }

    if (this.pickingTexture) {
      this.pickingTexture.destroy(true);
    }

    this.pickingTexture = RenderTexture.create({
      width,
      height,
      resolution: 1,
    });

    this.textureWidth = width;
    this.textureHeight = height;
    this.cachedPixels = null;
  }

  registerObject(object: PickableObject): void {
    this.pickableObjects.set(object.id, object);
    this.cachedPixels = null;
  }

  unregisterObject(id: number): void {
    this.pickableObjects.delete(id);

    const sprite = this.idToPickingSprites.get(id);

    if (sprite) {
      sprite.destroy();
      this.idToPickingSprites.delete(id);
    }

    this.cachedPixels = null;
  }

  clear(): void {
    this.pickableObjects.clear();

    for (const sprite of this.idToPickingSprites.values()) {
      sprite.destroy();
    }

    this.idToPickingSprites.clear();
    this.cachedPixels = null;
  }

  private rebuildPickingTexture(worldContainer: Container): void {
    if (!this.pickingTexture) {
      return;
    }

    if (!this.pickingContainer) {
      this.pickingContainer = new Container();
    } else {
      this.pickingContainer.removeChildren();
    }

    for (const sprite of this.idToPickingSprites.values()) {
      sprite.destroy();
    }

    this.idToPickingSprites.clear();
    this.colorToId.clear();

    for (const [id, object] of this.pickableObjects) {
      const sprite = object.sprite;

      if (!sprite.visible || sprite.alpha === 0) {
        continue;
      }

      const r = id & 0xFF;
      const g = (id >> 8) & 0xFF;
      const b = (id >> 16) & 0xFF;

      const colorKey = `${r},${g},${b}`;
      this.colorToId.set(colorKey, id);

      const pickingSprite = new Sprite(sprite.texture);

      pickingSprite.anchor.copyFrom(sprite.anchor);
      pickingSprite.position.copyFrom(sprite.position);
      pickingSprite.scale.copyFrom(sprite.scale);
      pickingSprite.rotation = sprite.rotation;
      pickingSprite.skew.copyFrom(sprite.skew);
      pickingSprite.zIndex = sprite.zIndex || 0;

      const pickingFilter = new PickingIdFilter(r, g, b);
      pickingSprite.filters = [pickingFilter];
      pickingSprite.blendMode = 'normal';

      this.idToPickingSprites.set(id, pickingSprite);
      this.pickingContainer.addChild(pickingSprite);
    }

    this.pickingContainer.sortableChildren = true;

    this.pickingContainer.position.copyFrom(worldContainer.position);
    this.pickingContainer.scale.copyFrom(worldContainer.scale);
    this.pickingContainer.rotation = worldContainer.rotation;

    this.renderer.render({
      container: this.pickingContainer,
      target: this.pickingTexture,
      clear: true,
      clearColor: [0, 0, 0, 0],
    });

    const extractResult = this.renderer.extract.pixels(this.pickingTexture);
    const extractedPixels = (extractResult as { pixels: Uint8ClampedArray })?.pixels || extractResult;

    const extractedWidth = (extractResult as { width: number })?.width || this.textureWidth;
    const extractedHeight = (extractResult as { height: number })?.height || this.textureHeight;

    if (extractedWidth !== this.textureWidth || extractedHeight !== this.textureHeight) {
      this.textureWidth = extractedWidth;
      this.textureHeight = extractedHeight;
    }

    if (extractedPixels instanceof Uint8ClampedArray) {
      this.cachedPixels = extractedPixels as unknown as Uint8Array;
    } else if (extractedPixels) {
      this.cachedPixels = new Uint8Array(extractedPixels as ArrayLike<number>);
    } else {
      this.cachedPixels = null;
    }

    this.colorToId.clear();

    for (const id of this.pickableObjects.keys()) {
      const r = id & 0xFF;
      const g = (id >> 8) & 0xFF;
      const b = (id >> 16) & 0xFF;
      const colorKey = `${r},${g},${b}`;
      this.colorToId.set(colorKey, id);
    }
  }

  pick(x: number, y: number, worldContainer: Container, forceUpdate = false): PickResult | null {
    const now = performance.now();

    if (!forceUpdate && (now - this.lastPickTime) < this.minPickInterval) {
      if (this.cachedPickPosition.x === x && this.cachedPickPosition.y === y) {
        return this.cachedPickResult;
      }
      return this.cachedPickResult;
    }

    this.lastPickTime = now;
    this.cachedPickPosition = { x, y };

    return this.pixelPerfectPick(x, y, worldContainer);
  }

  private pixelPerfectPick(x: number, y: number, worldContainer: Container): PickResult | null {
    if (!this.pickingTexture) {
      this.cachedPickResult = null;
      return null;
    }

    this.rebuildPickingTexture(worldContainer);

    if (!this.cachedPixels) {
      this.cachedPickResult = null;
      return null;
    }

    const pixels = this.cachedPixels;

    const px = Math.floor(x);
    const py = Math.floor(y);

    if (px < 0 || px >= this.textureWidth || py < 0 || py >= this.textureHeight) {
      this.cachedPickResult = null;
      return null;
    }

    const offset = (py * this.textureWidth + px) * 4;

    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const a = pixels[offset + 3];

    if (a === 0) {
      this.cachedPickResult = null;
      return null;
    }

    let pickedId = r | (g << 8) | (b << 16);

    if (pickedId === 0 && a > 0) {
      pickedId = this.searchNeighborhood(px, py, pixels);
    }

    if (!pickedId) {
      this.cachedPickResult = null;
      return null;
    }

    const object = this.pickableObjects.get(pickedId);

    if (!object) {
      this.cachedPickResult = null;
      return null;
    }

    this.cachedPickResult = { object, x, y };
    return this.cachedPickResult;
  }

  private searchNeighborhood(px: number, py: number, pixels: Uint8Array): number {
    const maxRadius = 4;

    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) {
            continue;
          }

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

          if (na === 0) {
            continue;
          }

          if (nr === 0 && ng === 0 && nb === 0) {
            continue;
          }

          const neighborId = nr | (ng << 8) | (nb << 16);

          if (neighborId && this.pickableObjects.has(neighborId)) {
            return neighborId;
          }
        }
      }
    }

    return 0;
  }

  markDirty(): void {
    this.cachedPixels = null;
  }

  getPickableObjects(): PickableObject[] {
    return Array.from(this.pickableObjects.values());
  }

  getObject(id: number): PickableObject | undefined {
    return this.pickableObjects.get(id);
  }

  getPickingTexture(): RenderTexture | null {
    return this.pickingTexture;
  }

  getPickingContainer(): Container | null {
    return this.pickingContainer;
  }

  destroy(): void {
    if (this.pickingTexture) {
      this.pickingTexture.destroy(true);
      this.pickingTexture = null;
    }

    if (this.pickingContainer) {
      this.pickingContainer.destroy({ children: true });
      this.pickingContainer = null;
    }

    for (const sprite of this.idToPickingSprites.values()) {
      sprite.destroy();
    }

    this.idToPickingSprites.clear();
    this.pickableObjects.clear();
    this.cachedPixels = null;
  }
}
