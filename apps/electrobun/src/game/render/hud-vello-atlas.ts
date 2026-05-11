/**
 * HudVelloAtlas — single shared OffscreenCanvas + secondary Pixi
 * `Application` that all HUD consumers (spell-icon-renderer,
 * fighter-portrait-renderer, future status-effect / damage-number
 * renderers) borrow to paint a frame and snapshot the result as an
 * `ImageBitmap`.
 *
 * **Why a secondary Pixi app, not a Vello-attached canvas:** Vello
 * writes its final image via `STORAGE_BINDING`, which WebGPU only
 * allows on `Rgba8Unorm`. On every Mac the browser's preferred
 * canvas format is `Bgra8Unorm`, so configuring an
 * `attachCanvasSurface(canvas, rgba8unorm)` made `getCurrentTexture`
 * emit the canonical "different format than preferred" perf
 * warning on every HUD asset render (and Chromium did a per-frame
 * driver-level format conversion behind the scenes).
 *
 * Instead we run Vello render-to-texture (off-screen Rgba8Unorm
 * storage texture, no swap chain) and then have a dedicated
 * Pixi `Application` blit that texture onto an OffscreenCanvas that
 * Pixi configures with its OWN preferred format (Bgra8Unorm on Mac).
 * The blit is a single sprite render — purely GPU, zero readback —
 * and `createImageBitmap` on the canvas is the same browser-side
 * GPU snapshot path the old surface implementation used.
 *
 * **Why a separate Pixi app:** the main battlefield Pixi `Application`
 * owns its own canvas/stage and renders the game world every frame.
 * Routing HUD blits through it would force per-asset stage churn and
 * leak HUD content into the live frame. A dedicated atlas
 * `Application` is offscreen (OffscreenCanvas, not in the DOM), shares
 * the underlying `GPUDevice` (via `getVelloGpu()`), and renders only
 * on demand.
 *
 * **Concurrency:** Every render serializes through `this.queue`. Two
 * concurrent dispatches against the same atlas canvas would race on
 * whose pixels `createImageBitmap` captures.
 *
 * **Sizing:** the atlas canvas grows monotonically to fit the largest
 * `(width, height)` requested. Shrinking is avoided to dodge Pixi
 * resize thrash.
 */

import {
  Application,
  ExternalSource,
  Sprite,
  Texture,
} from "pixi.js";

import { createLogger } from "@/utils/logger";

import {
  freeRenderTexture,
  getVelloGpu,
  type VelloSwfFrameResult,
} from "./vello-loader";

const log = createLogger("HudVelloAtlas");

/** Initial canvas size; grows on demand. 256² fits any current HUD asset. */
const INITIAL_SIZE = 256;

/**
 * Dispatch shape — caller renders one HUD asset via any
 * texture-output WASM entry point (`renderSwfSpellIcon`,
 * `renderSwfRoot`, …) and returns the result (or null if the
 * underlying SWF couldn't be resolved / Vello halted).
 */
export type HudRenderDispatch = () => VelloSwfFrameResult | null;

class HudVelloAtlas {
  private app: Application | null = null;
  private canvas: OffscreenCanvas | null = null;
  private currentW = 0;
  private currentH = 0;
  /** Tail of the serialization chain — every render appends to it. */
  private queue: Promise<unknown> = Promise.resolve();
  private readyPromise: Promise<boolean> | null = null;

  /**
   * Lazily construct the secondary Pixi `Application` on first use.
   * Returns false when the shared WebGPU device isn't ready or Pixi
   * init fails (caller bails to null).
   */
  private ensureReady(): Promise<boolean> {
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.readyPromise = (async () => {
      const gpu = getVelloGpu();
      if (!gpu) {
        log.warn("ensureReady: Vello GPU device not initialized");
        return false;
      }
      const canvas = new OffscreenCanvas(INITIAL_SIZE, INITIAL_SIZE);
      const app = new Application();
      try {
        await app.init({
          canvas: canvas as unknown as HTMLCanvasElement,
          width: INITIAL_SIZE,
          height: INITIAL_SIZE,
          backgroundAlpha: 0,
          preference: "webgpu",
          // Adopt the shared Vello GPUDevice so Vello-produced
          // GPUTextures wrap cleanly as `ExternalSource` here.
          gpu,
          autoStart: false,
          antialias: false,
          autoDensity: false,
          resolution: 1,
        });
      } catch (err) {
        log.warn(`Pixi atlas init failed: ${String(err)}`);
        return false;
      }
      this.app = app;
      this.canvas = canvas;
      this.currentW = INITIAL_SIZE;
      this.currentH = INITIAL_SIZE;
      return true;
    })();
    return this.readyPromise;
  }

  /**
   * Render `dispatch` (a Vello texture-output call) onto the shared
   * atlas canvas via a Pixi GPU blit, then snapshot the painted
   * region as an `ImageBitmap`. Returns null when the dispatch
   * couldn't resolve a SWF or the atlas init failed.
   */
  render(
    width: number,
    height: number,
    dispatch: HudRenderDispatch,
  ): Promise<ImageBitmap | null> {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const next = this.queue.then(async () => {
      const ok = await this.ensureReady();
      if (!ok || !this.app || !this.canvas) {
        return null;
      }
      // Grow-only resize so a fixed atlas instance handles every
      // HUD size the session asks for.
      if (w > this.currentW || h > this.currentH) {
        const nw = Math.max(w, this.currentW);
        const nh = Math.max(h, this.currentH);
        this.app.renderer.resize(nw, nh);
        this.currentW = nw;
        this.currentH = nh;
      }
      const result = dispatch();
      if (!result) {
        return null;
      }
      const { texture, textureId } = result;
      let source: ExternalSource | null = null;
      try {
        source = new ExternalSource({
          resource: texture,
          renderer: this.app.renderer,
          width: result.width,
          height: result.height,
          label: "hud-atlas-input",
        });
        source.alphaMode = "no-premultiply-alpha";
        source.format = "rgba8unorm";
        source.scaleMode = "linear";
        source.autoGarbageCollect = false;
        const tex = new Texture({ source });
        const sprite = new Sprite(tex);
        sprite.anchor.set(0, 0);
        this.app.stage.removeChildren();
        this.app.stage.addChild(sprite);
        // Pixi blits the rgba8unorm sample into the bgra8unorm
        // canvas backing — purely GPU. Format mismatch lives in the
        // ExternalSource (sampled) → render target write, which is
        // canonical Pixi behaviour (no warning).
        this.app.renderer.render({
          container: this.app.stage,
          clear: true,
        });
        sprite.destroy();
        return await createImageBitmap(this.canvas, 0, 0, w, h);
      } catch (err) {
        log.warn(`render failed (${w}x${h}): ${String(err)}`);
        return null;
      } finally {
        if (source) {
          try {
            source.destroy();
          } catch {}
        }
        // The Vello texture has done its job — the pixels live on
        // the Pixi canvas now, so free the source GPU texture.
        freeRenderTexture(textureId);
      }
    });
    this.queue = next;
    return next;
  }

  /** For diagnostics — current canvas dims. */
  getCurrentSize(): { width: number; height: number } {
    return { width: this.currentW, height: this.currentH };
  }

  /**
   * Tear down the secondary Pixi app. Called on Battlefield destroy.
   */
  destroy(): void {
    if (this.app) {
      try {
        this.app.destroy(false, { children: true, texture: false });
      } catch {}
      this.app = null;
    }
    this.canvas = null;
    this.currentW = 0;
    this.currentH = 0;
    this.queue = Promise.resolve();
    this.readyPromise = null;
  }
}

let instance: HudVelloAtlas | null = null;

/**
 * Process-wide HUD atlas singleton. Lazily constructed on first
 * access; the underlying Pixi Application initializes lazily on first
 * `render` call.
 */
export function getHudVelloAtlas(): HudVelloAtlas {
  if (!instance) {
    instance = new HudVelloAtlas();
  }
  return instance;
}

/**
 * Helper for cached HUD asset renderers. Paints `dispatch` (a Vello
 * texture-output call) onto the shared atlas canvas via a Pixi GPU
 * blit, snapshots the painted region into an `ImageBitmap`, draws
 * the bitmap into a fresh 2D `<canvas>` of the same dims, and
 * returns the canvas. The bitmap is closed before return so the
 * only persistent resource per cached entry is one CPU-backed 2D
 * canvas.
 */
export async function renderHudAssetToCanvas(
  width: number,
  height: number,
  dispatch: HudRenderDispatch,
): Promise<HTMLCanvasElement | null> {
  const atlas = getHudVelloAtlas();
  const bitmap = await atlas.render(width, height, dispatch);
  if (!bitmap) {
    return null;
  }
  try {
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(bitmap, 0, 0);
    return out;
  } finally {
    bitmap.close();
  }
}
