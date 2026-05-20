/**
 * SPIKE: measure cross-device Vello → OffscreenCanvas → ImageBitmap → Pixi
 * bridge cost.
 *
 * Wires a `window.__spike(options?)` global. Run from devtools while
 * inside a loaded battlefield (so the player SWF bundles are loaded
 * in the Vello WASM cache):
 *
 *   await __spike()
 *   await __spike({ iterations: 500, bundle: 'player10', exportName: 'walkR' })
 *
 * The harness:
 *   1. Spawns an INDEPENDENT Pixi `Application` with its OWN
 *      `GPUDevice` — does NOT adopt Vello's via `getVelloGpu()`. This
 *      is the post-fork target state (Vello and Pixi on separate
 *      WebGPU devices, bridged by ImageBitmap).
 *   2. Calls `renderSwfStripRangeAccessorizedBitmap` N times,
 *      timing `vello_ms` = Rust-side render + blit + transferToImageBitmap.
 *   3. For each result, builds a Pixi `Texture` from the
 *      `ImageBitmap`, renders it into a small `RenderTexture`, and
 *      awaits `device.queue.onSubmittedWorkDone()`. Times this whole
 *      stretch as `upload_ms` — the cross-device GPU import we're
 *      trying to characterize.
 *   4. Reports p50/p95/p99/mean for both buckets.
 *
 * Acceptance for moving forward with the Option B migration:
 *   - `vello_ms` p99 within ~10% of the production `renderSwfStripRangeAccessorized`
 *     path's measurement (the blit + canvas surface cost should be ~tens of μs).
 *   - `upload_ms` p99 < 1 ms (= GPU-direct import working).
 *   - No GC sawtooth in DevTools Memory across iterations.
 *
 * If `upload_ms` is multi-ms, Chromium isn't doing the GPU-direct
 * cross-device import — fall back to Option C (CPU readback) for
 * per-swap paths or keep the patched fork.
 *
 * Delete this file (and the Rust twin `renderSwfStripRangeAccessorizedBitmap`)
 * once the spike has informed the path forward.
 */

import { Application, ImageSource, RenderTexture, Sprite, Texture } from "pixi.js";

import {
  getVelloRenderer,
  swfAnimFrameCount,
  whenVelloReady,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("SpikeBitmapBridge");

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

interface SpikeResult {
  iterations: number;
  velloMs: Percentiles;
  uploadMs: Percentiles;
  notes: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * (sorted.length - 1)),
  );
  return sorted[idx];
}

function stats(samples: number[]): Percentiles {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Spawn an independent Pixi WebGPU `Application` with its OWN
 * `GPUDevice`. Does NOT pass `gpu` into init — we want the
 * cross-device path Pixi will use post-fork.
 */
async function spawnIndependentPixi(): Promise<Application | null> {
  const canvas = new OffscreenCanvas(64, 64);
  const app = new Application();
  try {
    await app.init({
      canvas: canvas as unknown as HTMLCanvasElement,
      width: 64,
      height: 64,
      backgroundAlpha: 0,
      preference: "webgpu",
      autoStart: false,
      antialias: false,
      autoDensity: false,
      resolution: 1,
    });
  } catch (e) {
    log.error(`spawnIndependentPixi: app.init failed: ${String(e)}`);
    return null;
  }
  return app;
}

type SpikeOptions = {
  iterations?: number;
  bundle?: string;
  exportName?: string;
  resolution?: number;
};

export async function runBitmapBridgeSpike(
  options: SpikeOptions = {},
): Promise<SpikeResult | null> {
  const iterations = options.iterations ?? 200;
  const bundle = options.bundle ?? "sprite-10";
  const exportName = options.exportName ?? "walkR";
  const resolution = options.resolution ?? 1.0;
  const WARMUP = 5;

  await whenVelloReady();
  const renderer = getVelloRenderer();
  if (!renderer) {
    log.error("vello renderer not ready");
    return null;
  }

  const frameCount = swfAnimFrameCount(bundle, exportName);
  if (frameCount === 0) {
    log.error(
      `bundle '${bundle}' export '${exportName}' not loaded — enter a battle once (so the player bundle gets fetched + cached) before running the spike.`,
    );
    return null;
  }

  const notes: string[] = [];
  notes.push(`bundle=${bundle} export=${exportName} frames=${frameCount}`);
  notes.push(`resolution=${resolution} iterations=${iterations} warmup=${WARMUP}`);

  const app = await spawnIndependentPixi();
  if (!app) return null;
  notes.push(`pixi backend: ${app.renderer.type}`);

  const device = (
    app.renderer as unknown as { gpu?: { device?: GPUDevice } }
  ).gpu?.device;
  if (!device) {
    log.warn(
      "Pixi WebGPU device not exposed at renderer.gpu.device — upload_ms will not include GPU sync wait",
    );
  }
  notes.push(`gpu device handle: ${device ? "found" : "missing"}`);

  const rt = RenderTexture.create({ width: 64, height: 64 });

  const velloMs: number[] = [];
  const uploadMs: number[] = [];
  let bitmapFailures = 0;

  // Type-cast the WASM method shape since wasm-bindgen's .d.ts uses `any`.
  const wasm = renderer as unknown as {
    renderSwfStripRangeAccessorizedBitmap(
      bundle: string,
      exportName: string,
      start: number,
      count: number,
      totalFrameCount: number,
      resolution: number,
      accSlots: Uint32Array,
      accBundles: string[],
      accExports: string[],
      accAnimTypes: Uint32Array,
      charDirSuffix: string,
      applyBFix: boolean,
    ): {
      bitmap: ImageBitmap;
      width: number;
      height: number;
      frameWidth: number;
      frameHeight: number;
      gridCols: number;
      frameCount: number;
      anchorX: number;
      anchorY: number;
    } | null;
  };

  for (let i = 0; i < iterations + WARMUP; i++) {
    const t0 = performance.now();
    const result = wasm.renderSwfStripRangeAccessorizedBitmap(
      bundle,
      exportName,
      0,
      frameCount,
      frameCount,
      resolution,
      new Uint32Array(0),
      [],
      [],
      new Uint32Array(0),
      "R",
      false,
    );
    const t1 = performance.now();
    if (!result || !result.bitmap) {
      bitmapFailures += 1;
      continue;
    }

    const source = new ImageSource({ resource: result.bitmap });
    const tex = new Texture({ source });
    const sprite = new Sprite(tex);
    sprite.scale.set(
      Math.min(1, 64 / Math.max(1, tex.width)),
      Math.min(1, 64 / Math.max(1, tex.height)),
    );
    app.renderer.render({ container: sprite, target: rt });
    if (device) {
      await device.queue.onSubmittedWorkDone();
    }
    const t2 = performance.now();

    if (i >= WARMUP) {
      velloMs.push(t1 - t0);
      uploadMs.push(t2 - t1);
    }

    try {
      sprite.destroy();
    } catch {}
    try {
      tex.destroy(true);
    } catch {}
    try {
      source.destroy();
    } catch {}
    try {
      result.bitmap.close();
    } catch {}

    if (i % 50 === 49) {
      // Yield so any pending paint / GC can run between batches.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  notes.push(`bitmap failures: ${bitmapFailures}`);

  try {
    rt.destroy(true);
  } catch {}
  try {
    app.destroy(false, { children: true, texture: true });
  } catch {}

  const out: SpikeResult = {
    iterations: velloMs.length,
    velloMs: stats(velloMs),
    uploadMs: stats(uploadMs),
    notes,
  };
  // eslint-disable-next-line no-console
  console.log("[spike-bitmap-bridge] notes:", out.notes);
  // eslint-disable-next-line no-console
  console.table({
    velloMs: out.velloMs,
    uploadMs: out.uploadMs,
  });
  return out;
}

if (typeof window !== "undefined") {
  (
    window as unknown as { __spike?: typeof runBitmapBridgeSpike }
  ).__spike = runBitmapBridgeSpike;
}
