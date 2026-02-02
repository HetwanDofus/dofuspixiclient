import { component, field } from '@lastolivegames/becsy';

@component export class TileId {
  @field.uint32 declare value: number;
}

@component export class TileType {
  @field.uint8 declare value: number;
}

export const TILE_LAYER = {
  GROUND: 0,
  OBJECT_1: 1,
  OBJECT_2: 2,
} as const;

export type TileLayer = typeof TILE_LAYER[keyof typeof TILE_LAYER];
