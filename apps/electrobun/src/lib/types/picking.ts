import type { Container, Sprite } from 'pixi.js';

export interface PickableBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PickableObject {
  id: number;
  sprite: Sprite;
  bounds?: PickableBounds;
  parentContainer?: Container;
}

export interface PickResult {
  object: PickableObject;
  x: number;
  y: number;
}
