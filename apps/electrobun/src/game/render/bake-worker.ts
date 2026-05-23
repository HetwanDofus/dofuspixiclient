/**
 * Opt-9 worker entry: parallel class atlas baker.
 *
 * Each worker owns its own Vello WASM instance + WebGPU device. It
 * receives SWF bundle bytes from the main thread via `loadBundle`
 * messages, then handles `bakeClassAtlas` requests by calling
 * `VelloRenderer.renderSwfClassAtlas` and posting the result back with
 * `ImageBitmap`s transferred via the `Transferable` list.
 *
 * Crucially this worker does NOT share Pixi state with the main thread.
 * Pixi runs on the main thread; the worker's only output is an
 * `ImageBitmap` per atlas page, which the main thread imports into
 * Pixi's GPUTexture via `copyExternalImageToTexture` (the same path
 * the bridge step already uses for main-thread bakes).
 *
 * Message protocol:
 * - `{type:"init", wasmUrl}` → init the WASM module + a Vello instance + GPU device.
 *   Responds with `{type:"ready"}` when both succeed, or `{type:"error", message}`.
 * - `{type:"loadBundle", name, bytes}` (transferable `bytes`) → load the SWF bundle
 *   into this worker's VelloRenderer. Idempotent. Responds with
 *   `{type:"bundleLoaded", name}`.
 * - `{type:"bakeClassAtlas", reqId, bundle, resolution}` → bake a class atlas.
 *   Responds with `{type:"bakeResult", reqId, result}` where `result.pages[i].combinedBitmap`
 *   is an `ImageBitmap` transferred in the response.
 */

import wasmInit, { VelloRenderer } from "vello-wasm";

// The project's tsconfig doesn't include the WebWorker lib so
// `DedicatedWorkerGlobalScope` isn't in scope here. Existing
// `stress-worker.ts` works around this the same way — cast `self` to
// the minimum shape we need.
interface WorkerSelf {
  onmessage: ((e: MessageEvent<BakeWorkerInMsg>) => void) | null;
  postMessage(msg: unknown, transferables?: Transferable[]): void;
}
const workerSelf = self as unknown as WorkerSelf;

interface BakeWorkerInitMsg {
  type: "init";
  wasmUrl?: string;
}
interface BakeWorkerLoadBundleMsg {
  type: "loadBundle";
  name: string;
  bytes: Uint8Array;
}
interface BakeWorkerBakeMsg {
  type: "bakeClassAtlas";
  reqId: number;
  bundle: string;
  resolution: number;
}
type BakeWorkerInMsg =
  | BakeWorkerInitMsg
  | BakeWorkerLoadBundleMsg
  | BakeWorkerBakeMsg;

let renderer: VelloRenderer | null = null;
const loaded = new Set<string>();

async function handleInit(msg: BakeWorkerInitMsg): Promise<void> {
  // Use the wasm-bindgen v0.2.117 object-arg form. When `wasmUrl` is
  // not supplied, omit the call entirely so the JS shim auto-resolves
  // relative to `import.meta.url` — this is the worker's bundled URL,
  // which Vite emits next to `*_bg.wasm`, so resolution succeeds out
  // of the box.
  if (msg.wasmUrl) {
    await wasmInit({ module_or_path: msg.wasmUrl });
  } else {
    await wasmInit();
  }
  const result = await VelloRenderer.init();
  renderer = result.renderer as VelloRenderer;
  workerSelf.postMessage({ type: "ready" });
}

function handleLoadBundle(msg: BakeWorkerLoadBundleMsg): void {
  if (!renderer) throw new Error("bake-worker: not initialised");
  if (!loaded.has(msg.name)) {
    renderer.loadSwfBundle(msg.name, msg.bytes);
    loaded.add(msg.name);
  }
  workerSelf.postMessage({
    type: "bundleLoaded",
    name: msg.name,
  });
}

/**
 * Threshold above which an atlas alpha sample counts as "on body"
 * for pixel-perfect picking. MUST match `character-cache.ts`'s
 * `SILHOUETTE_ALPHA_THRESHOLD` — both encode the same fringe-
 * rejection contract.
 */
const SILHOUETTE_ALPHA_THRESHOLD = 10;

/**
 * Lift the alpha plane out of a freshly-baked page bitmap into a
 * tightly-packed `Uint8Array(width * height)`. Done inside the
 * worker so the 30-40ms `getImageData(4096×N)` cost and the
 * ~64MB transient buffer never touch the main thread. Returns null
 * if `OffscreenCanvas` is missing (every modern Chromium/Safari
 * worker has it — fallback is the main-thread path in
 * `character-cache.ts`).
 */
function extractPageAlphaInWorker(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Uint8Array | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, width, height);
  const rgba = img.data;
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) {
    out[i] = rgba[j];
  }
  return out;
}

/**
 * Union all bands' cell-(0,0) sub-rects from the page alpha into
 * one `frameWidth × frameHeight` silhouette. Mirrors
 * `buildVariantSilhouette` in `character-cache.ts` — keep both in
 * sync. Worker-side computation lets us ship the per-variant
 * silhouettes alongside the bitmap as transferable buffers,
 * eliminating ~50ms per landed class atlas of main-thread work.
 */
function buildVariantSilhouetteInWorker(
  pageAlpha: Uint8Array,
  pageW: number,
  pageH: number,
  frameW: number,
  frameH: number,
  bands: ReadonlyArray<{ atlasX: number; atlasY: number }>,
): Uint8Array {
  const out = new Uint8Array(frameW * frameH);
  for (const band of bands) {
    const baseX = band.atlasX;
    const baseY = band.atlasY;
    for (let y = 0; y < frameH; y++) {
      const py = baseY + y;
      if (py < 0 || py >= pageH) continue;
      const pageRow = py * pageW;
      const outRow = y * frameW;
      for (let x = 0; x < frameW; x++) {
        if (out[outRow + x]) continue;
        const px = baseX + x;
        if (px < 0 || px >= pageW) continue;
        if (pageAlpha[pageRow + px] > SILHOUETTE_ALPHA_THRESHOLD) {
          out[outRow + x] = 255;
        }
      }
    }
  }
  return out;
}

function handleBake(msg: BakeWorkerBakeMsg): void {
  if (!renderer) throw new Error("bake-worker: not initialised");
  // `renderSwfClassAtlas` returns a JsValue object; the runtime
  // surface is `{ pages: [{ combinedBitmap: ImageBitmap, ... }, ...], variants: [...] }`.
  // We forward it as-is; the main thread types this as
  // `VelloSwfClassAtlasResult` (declared in `vello-loader.ts`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = (
    renderer as unknown as {
      renderSwfClassAtlas: (b: string, r: number) => unknown;
    }
  ).renderSwfClassAtlas(msg.bundle, msg.resolution);
  if (!result) {
    workerSelf.postMessage({
      type: "bakeResult",
      reqId: msg.reqId,
      result: null,
    });
    return;
  }
  // Extract page alpha + per-variant silhouettes BEFORE we transfer
  // the ImageBitmaps. Once transferred, the worker can no longer
  // read them, so this is a one-shot window. Attach the silhouette
  // bytes onto each variant in-place so the main thread sees them
  // as part of the bake result. The Uint8Array buffers ride along
  // in the transferables list (zero-copy across the worker
  // boundary).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages = (result.pages ?? []) as Array<{
    combinedBitmap: ImageBitmap;
    atlasWidth: number;
    atlasHeight: number;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const variants = (result.variants ?? []) as Array<any>;
  const pageAlphas: (Uint8Array | null)[] = pages.map((p) =>
    extractPageAlphaInWorker(p.combinedBitmap, p.atlasWidth, p.atlasHeight),
  );
  const silhouetteBuffers: ArrayBufferLike[] = [];
  for (const v of variants) {
    const pageAlpha = pageAlphas[v.pageIndex];
    const page = pages[v.pageIndex];
    if (!pageAlpha || !page) {
      v.silhouette = undefined;
      continue;
    }
    const sil = buildVariantSilhouetteInWorker(
      pageAlpha,
      page.atlasWidth,
      page.atlasHeight,
      v.frameWidth,
      v.frameHeight,
      v.bands,
    );
    v.silhouette = sil;
    silhouetteBuffers.push(sil.buffer);
  }
  // Collect ImageBitmaps to transfer (zero-copy across the worker boundary).
  const transferables: Transferable[] = pages
    .map((p) => p.combinedBitmap)
    .filter((b): b is ImageBitmap => b instanceof ImageBitmap);
  // Append silhouette buffers so they ride zero-copy too. Note
  // `transferables` includes the silhouette `ArrayBuffer`s, which is
  // safe because each is created here (we own the buffer; nothing
  // else in the worker references them after this).
  for (const buf of silhouetteBuffers) {
    transferables.push(buf as Transferable);
  }
  workerSelf.postMessage(
    {
      type: "bakeResult",
      reqId: msg.reqId,
      result,
    },
    transferables,
  );
}

workerSelf.onmessage = (e: MessageEvent<BakeWorkerInMsg>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
        void handleInit(msg);
        return;
      case "loadBundle":
        handleLoadBundle(msg);
        return;
      case "bakeClassAtlas":
        handleBake(msg);
        return;
    }
  } catch (err) {
    workerSelf.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
