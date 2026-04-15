/**
 * Vello WASM renderer integration for Pixi.js.
 *
 * Provides zero-copy GPU texture sharing between Vello (vector renderer)
 * and Pixi.js (sprite compositor). Both share the same GPUDevice.
 *
 * Usage:
 *   const vello = await initVello();
 *   // Pass vello.gpu to Pixi.js: app.init({ gpu: vello.gpu })
 *   // Later:
 *   const tex = vello.renderFrame(assetId, "tile", 0, 1.0);
 *   const pixiTex = new Texture({ source: new ExternalSource({ resource: tex.texture, renderer }) });
 */

import wasmInit, { VelloRenderer } from "vello-wasm";

export interface VelloGpu {
  adapter: GPUAdapter;
  device: GPUDevice;
}

export interface VelloFrameResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
}

export interface VelloAnimationInfo {
  fps: number;
  frameCount: number;
  offsetX: number;
  offsetY: number;
  hasBaseFrame: boolean;
  baseZOrder: number;
}

let renderer: VelloRenderer | null = null;
let gpu: VelloGpu | null = null;
let maxTextureSize = 8192;

/**
 * Initialize the Vello WASM renderer.
 * Returns the GPU handles that should be passed to Pixi.js.
 *
 * Call this BEFORE Pixi.js Application.init() so both share the same GPUDevice.
 */
export async function initVello(wasmUrl?: string): Promise<{
  renderer: VelloRenderer;
  gpu: VelloGpu;
}> {
  // Initialize WASM module
  if (wasmUrl) {
    await wasmInit(wasmUrl);
  } else {
    await wasmInit();
  }

  // Create Vello renderer (which creates the shared GPUDevice)
  const result = await VelloRenderer.init();

  renderer = result.renderer as VelloRenderer;
  gpu = {
    adapter: result.adapter as GPUAdapter,
    device: result.device as GPUDevice,
  };
  maxTextureSize = (result.maxTextureSize as number) || 8192;

  return { renderer, gpu };
}

/**
 * Get the shared GPU handles for Pixi.js initialization.
 */
export function getVelloGpu(): VelloGpu | null {
  return gpu;
}

/**
 * Get the Vello renderer instance.
 */
export function getVelloRenderer(): VelloRenderer | null {
  return renderer;
}

export function getMaxTextureSize(): number {
  return maxTextureSize;
}

/**
 * Load a .dofasset file from a URL into the Vello renderer.
 */
export async function loadDofAsset(id: number, url: string): Promise<boolean> {
  if (!renderer) {
    throw new Error("Vello not initialized");
  }

  const response = await fetch(url);
  const data = new Uint8Array(await response.arrayBuffer());
  return renderer.loadAsset(id, data);
}

/**
 * Load a .dofasset file from raw bytes.
 */
export function loadDofAssetFromBytes(id: number, data: Uint8Array): boolean {
  if (!renderer) {
    throw new Error("Vello not initialized");
  }

  return renderer.loadAsset(id, data);
}

/**
 * Render a frame and return the GPU texture for Pixi.js.
 * Optionally accepts colors [c1,c2,c3] as 0xRRGGBB and accessory IDs.
 */
export function renderFrame(
  assetId: number,
  animation: string,
  frameIndex: number,
  resolution: number,
  colors?: number[],
  accessoryIds?: number[]
): VelloFrameResult | null {
  if (!renderer) {
    return null;
  }

  const result = renderer.renderFrame(
    assetId,
    animation,
    frameIndex,
    resolution,
    colors ? new Uint32Array(colors) : undefined,
    accessoryIds ? new Uint32Array(accessoryIds) : undefined
  );
  if (!result) {
    return null;
  }

  return result as VelloFrameResult;
}

/**
 * Render a zone mask frame. Returns the zone mask GPU texture.
 * Zone pixels: R=zone1, G=zone2, B=zone3. Non-zone: opaque black.
 * Accessories rendered as opaque black occluders.
 */
export function renderZoneMaskFrame(
  assetId: number,
  animation: string,
  frameIndex: number,
  resolution: number,
  accessoryIds?: number[]
): VelloFrameResult | null {
  if (!renderer) {
    return null;
  }

  const result = renderer.renderZoneMaskFrame(
    assetId,
    animation,
    frameIndex,
    resolution,
    accessoryIds ? new Uint32Array(accessoryIds) : undefined
  );
  if (!result) {
    return null;
  }

  return result as VelloFrameResult;
}

/**
 * Get animation info for an asset.
 */
export function getAnimationInfo(
  assetId: number,
  animation: string
): VelloAnimationInfo | null {
  if (!renderer) {
    return null;
  }

  return renderer.getAnimationInfo(
    assetId,
    animation
  ) as VelloAnimationInfo | null;
}

/**
 * Free a rendered texture.
 */
export function freeTexture(textureId: number): void {
  renderer?.freeTexture(textureId);
}

/**
 * Free a loaded asset.
 */
export function freeAsset(assetId: number): void {
  renderer?.freeAsset(assetId);
}
