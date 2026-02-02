import { component, field } from '@lastolivegames/becsy';
import type { Sprite, AnimatedSprite, Container } from 'pixi.js';

export type DisplayObject = Sprite | AnimatedSprite | Container;

@component export class Renderable {
  @field.object declare sprite: DisplayObject | null;
  @field.boolean declare visible: boolean;
  @field.float32 declare alpha: number;
}

@component export class Animated {
  @field.float32 declare fps: number;
  @field.boolean declare loop: boolean;
  @field.boolean declare autoplay: boolean;
}

@component export class Interactive {
  @field.uint32 declare pickableId: number;
  @field.uint32 declare gfxId: number;
}
