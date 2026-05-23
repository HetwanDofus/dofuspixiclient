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
  // Collect ImageBitmaps to transfer (zero-copy across the worker boundary).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages = (result.pages ?? []) as Array<{ combinedBitmap: ImageBitmap }>;
  const transferables: Transferable[] = pages
    .map((p) => p.combinedBitmap)
    .filter((b): b is ImageBitmap => b instanceof ImageBitmap);
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
