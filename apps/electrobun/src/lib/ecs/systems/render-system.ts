import { System, system } from '@lastolivegames/becsy';
import type { Sprite } from 'pixi.js';
import { Position, Scale, Rotation, ZIndex, Renderable } from '@/ecs/components';

interface TrackedSprite {
  lastX: number;
  lastY: number;
  lastScaleX: number;
  lastScaleY: number;
  lastRotation: number;
  lastZIndex: number;
  lastVisible: boolean;
  lastAlpha: number;
}

@system export class RenderSystem extends System {
  private renderables = this.query(q => q.current.with(Renderable, Position).write);
  private trackedSprites: WeakMap<Sprite, TrackedSprite> = new WeakMap();

  execute(): void {
    for (const entity of this.renderables.current) {
      const renderable = entity.read(Renderable);
      const sprite = renderable.sprite as Sprite | null;

      if (!sprite) {
        continue;
      }

      const position = entity.read(Position);
      let scaleX = 1, scaleY = 1, rotation = 0, zIndex = 0;

      if (entity.has(Scale)) {
        const scale = entity.read(Scale);
        scaleX = scale.x;
        scaleY = scale.y;
      }
      if (entity.has(Rotation)) {
        rotation = entity.read(Rotation).angle;
      }
      if (entity.has(ZIndex)) {
        zIndex = entity.read(ZIndex).value;
      }

      let tracked = this.trackedSprites.get(sprite);
      if (!tracked) {
        tracked = {
          lastX: NaN, lastY: NaN,
          lastScaleX: NaN, lastScaleY: NaN,
          lastRotation: NaN, lastZIndex: NaN,
          lastVisible: !renderable.visible, lastAlpha: NaN,
        };
        this.trackedSprites.set(sprite, tracked);
      }

      if (tracked.lastX !== position.x || tracked.lastY !== position.y) {
        sprite.x = position.x;
        sprite.y = position.y;
        tracked.lastX = position.x;
        tracked.lastY = position.y;
      }
      if (tracked.lastScaleX !== scaleX || tracked.lastScaleY !== scaleY) {
        sprite.scale.set(scaleX, scaleY);
        tracked.lastScaleX = scaleX;
        tracked.lastScaleY = scaleY;
      }
      if (tracked.lastRotation !== rotation) {
        sprite.angle = rotation;
        tracked.lastRotation = rotation;
      }
      if (tracked.lastZIndex !== zIndex) {
        sprite.zIndex = zIndex;
        tracked.lastZIndex = zIndex;
      }
      if (tracked.lastVisible !== renderable.visible) {
        sprite.visible = renderable.visible;
        tracked.lastVisible = renderable.visible;
      }
      if (tracked.lastAlpha !== renderable.alpha) {
        sprite.alpha = renderable.alpha;
        tracked.lastAlpha = renderable.alpha;
      }
    }
  }
}
