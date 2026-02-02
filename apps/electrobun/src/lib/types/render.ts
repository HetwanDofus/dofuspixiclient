import type { Texture } from 'pixi.js';

export interface CanvasSize {
  width: number;
  height: number;
  zoom: number;
}

export interface PointerPosition {
  x: number;
  y: number;
}

export interface RenderStats {
  fps: number;
  spriteCount: number;
  drawCalls: number;
  frameTimeMs: number;
  memoryMB?: number;
}

export interface ExtendedTexture extends Texture {
  _scale?: number;
  _supersample?: number;
  _origW?: number;
  _origH?: number;
  _trimX?: number;
  _trimY?: number;
  /** True if this texture was loaded from a fallback resolution (not the requested one) */
  _isFallback?: boolean;
  _requestedScale?: number;
  /** True if this texture was loaded from an SVG file */
  _isSvg?: boolean;
}
