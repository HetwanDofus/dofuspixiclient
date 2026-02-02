import type { Sprite } from 'pixi.js';
import type { TileData } from '@/types/tile';

export interface SpriteTransform {
  rotation: number;
  flip: boolean;
  scaleX: number;
  scaleY: number;
}

export function normalizeRotation(rotation: number): number {
  const r = rotation % 4;
  return r < 0 ? r + 4 : r;
}

export function computePhpLikeOffsets(
  tile: TileData,
  rotation: number,
  flip: boolean
): { offsetX: number; offsetY: number; width: number; height: number } {
  const baseWidth = tile.width;
  const baseHeight = tile.height;
  const baseOffsetX = tile.offsetX;
  const baseOffsetY = tile.offsetY;

  const r = normalizeRotation(rotation);
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

export function computeTransformedMin(
  width: number,
  height: number,
  rotation: number,
  scaleX: number,
  scaleY: number
): { minX: number; minY: number } {
  const r = normalizeRotation(rotation);
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

    if (xr < minX) {
      minX = xr;
    }

    if (yr < minY) {
      minY = yr;
    }
  }

  return { minX, minY };
}
