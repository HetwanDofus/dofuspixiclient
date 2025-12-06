import type { Sprite } from 'pixi.js';
import type { GameWorld } from './GameWorld';

interface SpriteEntity {
  eid: number;
  sprite: Sprite;
  lastPosition?: { x: number; y: number };
  lastScale?: { x: number; y: number };
  lastRotation?: number;
  lastZIndex?: number;
}

export class SpriteRenderSystem {
  private gameWorld: GameWorld;
  private spriteEntityMap: Map<number, SpriteEntity> = new Map(); // eid -> SpriteEntity
  private spritesByTile: Map<number, Sprite[]> = new Map(); // tileId -> sprites for culling

  constructor(gameWorld: GameWorld) {
    this.gameWorld = gameWorld;
  }

  registerSprite(eid: number, sprite: Sprite): void {
    this.spriteEntityMap.set(eid, {
      eid,
      sprite,
    });
  }

  unregisterSprite(eid: number): void {
    const entity = this.spriteEntityMap.get(eid);
    if (entity) {
      entity.sprite.destroy(true);
      this.spriteEntityMap.delete(eid);
    }
  }

  /**
   * Update all sprite positions, scales, rotations from game world
   * Call this every frame before rendering
   */
  update(): void {
    for (const [eid, spriteEntity] of this.spriteEntityMap) {
      const position = this.gameWorld.getComponent(eid, 'Position');
      const scale = this.gameWorld.getComponent(eid, 'Scale');
      const rotation = this.gameWorld.getComponent(eid, 'Rotation');
      const zIndex = this.gameWorld.getComponent(eid, 'ZIndex');

      const sprite = spriteEntity.sprite;

      // Only update if changed (reduces unnecessary updates)
      if (position && (spriteEntity.lastPosition?.x !== position.x || spriteEntity.lastPosition?.y !== position.y)) {
        sprite.x = position.x;
        sprite.y = position.y;
        spriteEntity.lastPosition = { x: position.x, y: position.y };
      }

      if (scale && (spriteEntity.lastScale?.x !== scale.x || spriteEntity.lastScale?.y !== scale.y)) {
        sprite.scale.set(scale.x, scale.y);
        spriteEntity.lastScale = { x: scale.x, y: scale.y };
      }

      if (rotation && spriteEntity.lastRotation !== rotation.angle) {
        sprite.angle = rotation.angle;
        spriteEntity.lastRotation = rotation.angle;
      }

      if (zIndex && spriteEntity.lastZIndex !== zIndex.value) {
        sprite.zIndex = zIndex.value;
        spriteEntity.lastZIndex = zIndex.value;
      }
    }
  }

  /**
   * Get all sprites for rendering
   */
  getSprites(): Sprite[] {
    return Array.from(this.spriteEntityMap.values()).map((e) => e.sprite);
  }

  /**
   * Get sprite count
   */
  getSpriteCount(): number {
    return this.spriteEntityMap.size;
  }

  /**
   * Register tile for culling tracking
   */
  registerTile(tileId: number, sprite: Sprite): void {
    if (!this.spritesByTile.has(tileId)) {
      this.spritesByTile.set(tileId, []);
    }
    this.spritesByTile.get(tileId)!.push(sprite);
  }

  /**
   * Get visible sprites for a specific tile region
   */
  getSpritesForTile(tileId: number): Sprite[] {
    return this.spritesByTile.get(tileId) || [];
  }

  destroy(): void {
    for (const spriteEntity of this.spriteEntityMap.values()) {
      spriteEntity.sprite.destroy(true);
    }
    this.spriteEntityMap.clear();
    this.spritesByTile.clear();
  }
}
