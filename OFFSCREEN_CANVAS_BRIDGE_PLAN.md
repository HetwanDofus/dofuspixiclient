# OffscreenCanvas bridge: drop the patched wgpu fork

## Goal

Replace the patched-wgpu / shared-`GPUDevice` bridge between Vello WASM and Pixi
with a standard `OffscreenCanvas` + `transferToImageBitmap` bridge. End state:

- `rust/wgpu` (vendored fork) is deleted; vello-wasm depends on upstream wgpu
  from crates.io.
- Vello and Pixi each own their own `GPUDevice`. No cross-library handle
  sharing.
- Anim-swap hand-off goes Vello (WASM) → `OffscreenCanvas` it owns →
  `ImageBitmap` (GPU-resident) → Pixi `ImageSource`.
- Per-frame steady state is unchanged: Pixi samples its own atlas, Vello sleeps.

## Why this matters

The fork is the largest single piece of infrastructure debt in this codebase.
Every Vello / wgpu release forces a rebase. The OffscreenCanvas approach uses
only standard browser + wgpu APIs and removes that recurring cost. Performance
delta is one cross-device GPU copy (~tens of microseconds for a typical strip)
per anim swap, which is far below the noise floor of the current pipeline.

## What the patch actually does today

Three private fields flipped to `pub` in
`rust/wgpu/src/backend/webgpu.rs`:

- `Device.inner: webgpu_sys::GpuDevice`
- `Adapter.inner: webgpu_sys::GpuAdapter`
- `Texture.inner: webgpu_sys::GpuTexture`

`rust/vello-wasm/src/lib.rs:25-37` reaches into those fields and re-exports
the raw JS handles:

```rust
fn extract_gpu_device(device: &wgpu::Device) -> JsValue {
    device.inner.as_webgpu().inner.clone().into()
}
fn extract_gpu_adapter(adapter: &wgpu::Adapter) -> JsValue { /* … */ }
fn extract_gpu_texture(texture: &wgpu::Texture) -> JsValue { /* … */ }
```

`apps/electrobun/src/game/render/vello-loader.ts:111-118` returns those handles
to JS. `apps/electrobun/src/game/render/engine.ts:154-178` then has Pixi adopt
Vello's `{adapter, device}` via `Application.init({ gpu })`, so Pixi can wrap
Vello's `GPUTexture` as an `ExternalSource` (zero-copy sampling).

**Drop the patch ⇒ none of those `inner` fields are reachable ⇒ no JS handles
to hand out ⇒ Pixi cannot adopt Vello's device or consume Vello's textures
directly.** The replacement plan must route the handoff through a primitive
that doesn't require touching wgpu internals. That primitive is `ImageBitmap`.

## Target architecture

### Vello WASM (Rust)

Each render entry point that today returns a `GPUTexture` instead returns an
`ImageBitmap`. Internally:

1. Pull an `OffscreenCanvas` of the right size out of a small pool keyed by
   power-of-two dimensions (re-use across calls; do NOT allocate per render).
2. Mint a `wgpu::Surface` for it via upstream wgpu's
   `SurfaceTarget::OffscreenCanvas`.
3. Configure the surface (`Rgba8UnormSrgb`, `RENDER_ATTACHMENT |
   COPY_DST`).
4. `surface.get_current_texture()` → render Vello scene into its view.
5. `surface_texture.present()`.
6. From JS-bindings side: call `canvas.transferToImageBitmap()` and return the
   resulting `web_sys::ImageBitmap` to JS.

Sketch:

```rust
// vello-wasm — new helper, replaces extract_gpu_texture in every render path
fn render_into_bitmap(
    instance: &wgpu::Instance,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    renderer: &mut vello::Renderer,
    canvas_pool: &mut CanvasPool,
    scene: &vello::Scene,
    width: u32,
    height: u32,
    params: &vello::RenderParams,
) -> Result<web_sys::ImageBitmap, JsValue> {
    let (canvas, surface) = canvas_pool.acquire(instance, device, width, height)?;
    let frame = surface.get_current_texture().map_err(/* … */)?;
    let view = frame.texture.create_view(&Default::default());
    renderer
        .render_to_texture(device, queue, scene, &view, params)
        .map_err(/* … */)?;
    frame.present();
    let bitmap = canvas.transfer_to_image_bitmap()?;
    Ok(bitmap)
}
```

`CanvasPool` is a small `HashMap<(u32, u32), Vec<(OffscreenCanvas, Surface)>>`
that keeps a few surfaces per size bucket. Strip sizes already cluster into a
handful of buckets in `player-strip-renderer.ts`, so the pool stays small.

### Pixi side (TypeScript)

`apps/electrobun/src/game/render/vello-loader.ts`:

- Result objects lose the `texture: GPUTexture, textureId: number` pair and
  gain `bitmap: ImageBitmap`.
- Drop `trackRenderTexture`, `freeRenderTexture`, `liveRenderTextureIds`, the
  whole render-watchdog texture-count plumbing. Replace with a much simpler
  `liveBitmapCount` if you still want the gauge.

`apps/electrobun/src/game/render/player-strip-renderer.ts`:

```ts
// old
const source = new ExternalSource({
  resource: strip.texture,
  renderer: this.pixiRenderer,
  // …
});

// new
const source = new ImageSource({ resource: strip.bitmap });
// retire path:
setTimeout(() => {
  try { oldSource.destroy(); } catch {}
  try { oldBitmap.close(); } catch {}
}, RETIRE_DELAY_MS);
```

`apps/electrobun/src/game/render/engine.ts:154-178`:

Delete the `getVelloGpu()` import + the `{ ...(sharedGpu ? { gpu: sharedGpu } : {}) }`
spread. Pixi requests its own adapter/device normally.

## Why the cost is small

| | Today (shared device) | Proposed (bridge) |
|---|---|---|
| Per-frame steady state | Pixi samples atlas | Pixi samples atlas (unchanged) |
| Per-anim-swap | 0 copies | 1 GPU-side cross-device import |
| Typical strip size | ~512×128 RGBA = 256 KB | same |
| Burst case (200 swaps) | 0 | ~50 MB cross-device = ~0.5–1 ms on Apple Silicon |
| Vello/wgpu upgrade cost | rebase fork | `cargo update` |

On Chrome and Safari ≥ 17, `transferToImageBitmap()` on a WebGPU-backed
`OffscreenCanvas` produces a GPU-resident bitmap, and Pixi's
`copyExternalImageToTexture` on its own device imports it GPU-side. No CPU
readback in the happy path.

## Validation spike (do this first, ~1 day)

Before deleting the fork, prove the bridge round-trip works and measures
clean. One throwaway script next to `apps/electrobun/src/game/render/`:

```ts
async function spike() {
  const t0 = performance.now();
  const bitmap = await callNewVelloRenderReturningBitmap(/* one strip */);
  const t1 = performance.now();
  const source = new ImageSource({ resource: bitmap });
  const tex = new Texture({ source });
  // force upload
  pixiRenderer.texture.bind(tex.source, 0);
  await new Promise(r => requestAnimationFrame(r));
  const t2 = performance.now();
  console.log({ vello_ms: t1 - t0, upload_ms: t2 - t1 });
}
```

Run this 1000× and log p50/p95/p99 for `vello_ms` and `upload_ms`. Acceptance:

- `vello_ms` p99 within ~10 % of the patched-fork path's measurement.
- `upload_ms` p99 < 1 ms.
- No GC sawtooth in DevTools Memory after 10 000 iterations (bitmaps closed
  cleanly).

If `upload_ms` looks like CPU readback (several ms per call), abort and re-
plan; that would mean the browser is round-tripping through CPU. Check
chrome://gpu and `chrome://tracing` to confirm before giving up — usually a
canvas format mismatch (e.g., not `rgba8unorm-srgb`) causes the slow path.

## Migration steps (after the spike validates)

In order:

1. **Branch.** `git switch -c bridge/offscreen-canvas`.
2. **`rust/vello-wasm/Cargo.toml`** — replace
   `wgpu = { path = "../wgpu" }` with `wgpu = "<upstream version vello pins>"`.
   Same for any other `path =` references to the fork.
3. **Delete** `rust/wgpu/` entirely.
4. **`rust/vello-wasm/src/lib.rs`** —
   - Delete `extract_gpu_device`, `extract_gpu_adapter`, `extract_gpu_texture`
     (lines 25-37 plus any callers building `{ device, adapter, texture }` JS
     objects).
   - Delete the `surfaces: HashMap<u32, wgpu::Surface<'static>>` map at line
     189 and its accessors — they were the WASM-binding path for the shared-
     canvas trick.
   - Add `CanvasPool` (sketch above).
   - In every render entry point that builds the result JsObject, replace the
     `result.set("texture", extract_gpu_texture(&tex))` line with
     `result.set("bitmap", &bitmap)` where `bitmap: web_sys::ImageBitmap`
     comes back from `render_into_bitmap(...)`.
5. **`apps/electrobun/src/game/render/vello-loader.ts`** —
   - Update `VelloSwfStripResult`, `VelloSwfFrameResult`, etc. types: drop
     `texture: GPUTexture` and `textureId: number`, add `bitmap: ImageBitmap`.
   - Delete `trackRenderTexture`, `freeRenderTexture`,
     `liveRenderTextureIds`. Add `liveBitmapCount` if the watchdog still
     wants a gauge.
   - `whenVelloReady()` / `initVello()` no longer return `gpu`. Update the
     return type to just `{ renderer }`.
6. **`apps/electrobun/src/game/render/engine.ts`** —
   - Remove the `getVelloGpu()` import and the `sharedGpu` spread into
     `Application.init`.
7. **`apps/electrobun/src/game/render/player-strip-renderer.ts`** —
   - Swap `ExternalSource({ resource: strip.texture, … })` for
     `ImageSource({ resource: strip.bitmap })`.
   - Swap the retire path: `freeRenderTexture(oldTextureId)` →
     `oldBitmap.close()`.
   - Apply the same swap to every other renderer that consumes a result
     object: `tile-vello-renderer.ts`, `fighter-portrait-renderer.ts`,
     `spell-icon-renderer.ts`, `worldmap-swf-renderer.ts`,
     `hud-vello-atlas.ts`, `frame-atlas.ts`.
8. **Build + smoke test:**
   `just wasm && just client`. Walk into a stress-test map. Confirm 200 actors
   render correctly, animations cycle, anim swaps don't visibly hitch.
9. **Compare FPS to pre-change baseline** on the same hardware + map.
   Should be within ±5 %.

## Files touched (search anchors for next session)

- `rust/wgpu/` — delete
- `rust/vello-wasm/Cargo.toml`
- `rust/vello-wasm/src/lib.rs`
- `apps/electrobun/src/game/render/vello-loader.ts`
- `apps/electrobun/src/game/render/engine.ts`
- `apps/electrobun/src/game/render/player-strip-renderer.ts`
- `apps/electrobun/src/game/render/tile-vello-renderer.ts`
- `apps/electrobun/src/game/render/fighter-portrait-renderer.ts`
- `apps/electrobun/src/game/render/spell-icon-renderer.ts`
- `apps/electrobun/src/game/render/worldmap-swf-renderer.ts`
- `apps/electrobun/src/game/render/hud-vello-atlas.ts`
- `apps/electrobun/src/game/render/frame-atlas.ts`
- `apps/electrobun/src/game/render/render-watchdog.ts` (texture-count gauges)

## Risks / unknowns to confirm during the spike

1. **`OffscreenCanvas` + WebGPU + `transferToImageBitmap` on every target
   browser you ship to.** Electrobun is Chromium so this should be fine. If
   you ever ship to Safari < 17 or Firefox without WebGPU stable, document
   it.
2. **Surface lifecycle after `transferToImageBitmap`.** The canvas
   bitmap is detached; next render needs `surface.get_current_texture()`
   on the same `OffscreenCanvas`. Confirm wgpu doesn't refuse to give you a
   new frame on a canvas whose previous bitmap was transferred out — pool
   the canvases if it does (keep N canvases per size bucket, rotate).
3. **`ImageBitmap` retire timing.** `bitmap.close()` while Pixi is still
   sampling the source = artifacts. Keep the existing 2-tick delay.
4. **`hud-vello-atlas.ts`** and other long-lived atlas surfaces — they reuse
   a render target across many writes. The OffscreenCanvas pool needs to
   support that pattern (write multiple times to the same canvas, transfer
   once when the atlas is "ready"), or those renderers move to a different
   pattern. Inspect each call site for atlas-style use before assuming the
   pool design.

## Fallback if validation fails

If the spike shows the bridge is unexpectedly slow on a target browser, the
fork stays. Document the measurement, do not delete `rust/wgpu/`. Re-evaluate
when wgpu upstream lands the experimental "wrap external GPUDevice" API
(tracked in wgpu issues — there is ongoing work on `Instance::from_webgpu`
that would replace the patch with upstream support).
