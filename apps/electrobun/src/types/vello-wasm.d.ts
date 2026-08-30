/**
 * Type-only facade for the generated `vello-wasm` package.
 *
 * The runtime module is still supplied by the sibling Vello checkout through
 * `vite.config.ts`. Keeping the API consumed by this client here makes editor
 * and CI type-checking independent from generated wasm-pack output.
 */
export class VelloRenderer {
  private constructor();

  static init(): Promise<{
    renderer: VelloRenderer;
    adapter: GPUAdapter;
    device: GPUDevice;
    maxTextureSize?: number;
  }>;

  createAtlas(width: number, height: number): unknown;
  flushFrames(atlasTextureId: number): void;
  freeAsset(id: number): void;
  freeTexture(textureId: number): void;
  getAnimationInfo(assetId: number, animation: string): unknown;
  getAnimationMeta(
    assetId: number,
    animation: string,
    resolution: number,
    accessoryInfo?: Uint32Array | null
  ): unknown;
  getFrameSize(
    assetId: number,
    animation: string,
    frameIndex: number,
    resolution: number
  ): Uint32Array;
  loadAsset(id: number, data: Uint8Array): boolean;
  queueFrame(
    assetId: number,
    animation: string,
    frameIndex: number,
    resolution: number,
    colors: Uint32Array | null | undefined,
    accessoryInfo: Uint32Array | null | undefined,
    destinationX: number,
    destinationY: number
  ): unknown;
  renderAnimationStrip(
    assetId: number,
    animation: string,
    resolution: number,
    colors?: Uint32Array | null,
    accessoryInfo?: Uint32Array | null
  ): unknown;
  renderFrame(
    assetId: number,
    animation: string,
    frameIndex: number,
    resolution: number,
    colors?: Uint32Array | null,
    accessoryInfo?: Uint32Array | null
  ): unknown;
  renderZoneMaskFrame(
    assetId: number,
    animation: string,
    frameIndex: number,
    resolution: number,
    accessoryInfo?: Uint32Array | null
  ): unknown;
}

// biome-ignore lint/style/noDefaultExport: mirrors the generated wasm-bindgen module.
export default function initVelloWasm(
  moduleOrPath?:
    | string
    | URL
    | Request
    | Response
    | ArrayBuffer
    | WebAssembly.Module
): Promise<unknown>;
