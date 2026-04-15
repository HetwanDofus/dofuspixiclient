import type { Texture } from "pixi.js";

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
  /** True if this texture was loaded at a fallback resolution (not the requested one) */
  _isFallback?: boolean;
  _requestedScale?: number;
}
