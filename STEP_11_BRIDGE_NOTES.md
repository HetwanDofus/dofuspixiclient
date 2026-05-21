# Step 11 — Bridge Architecture Notes

Companion to `RENDER_SCALING_PLAN.md`. This file documents WHY the
OffscreenCanvas bitmap bridge code (`rust/vello-wasm/src/bitmap_bridge.rs`)
still exists despite the body-atlas render path NOT using it, and
what dead-ends we walked through getting here.

It also records the final shape of the deferred-destroy mechanism in
the patched wgpu fork so the next person doesn't unwind it.

---

## TL;DR

- Vello and Pixi share a single `GPUDevice` via the patched wgpu
  fork (`rust/wgpu/`). Vello renders into a `wgpu::Texture`; Pixi
  consumes it directly via `ExternalSource`. Zero copy.
- The patched fork USED to leak every `wgpu::Texture`/`wgpu::Buffer`
  because `Drop` was a no-op (defensive against
  use-after-destroy). Step 11's actual fix was to add a
  **deferred-destroy queue** to the fork: drops push handles onto
  a thread-local queue, and `tickDeferredDestroys` (called once per
  Pixi tick) calls `GPUTexture.destroy()` / `GPUBuffer.destroy()`
  on entries that are at least N ticks old (past WebGPU's
  submission completion window).
- The bridge code in `bitmap_bridge.rs` is **kept on the shelf**
  for the day we want to drop the patched fork entirely and run
  Vello + Pixi on separate `GPUDevice`s. It's also still wired
  into the `renderSwfStripRangeAccessorizedBitmap` spike entry
  used by performance measurements.

---

## Architecture decisions we walked into and out of

### Round 1 — Original direct path (pre-Step-11)

- Vello renders into a `wgpu::Texture` allocated in
  `VelloRenderer::textures`.
- `extract_gpu_texture` hands the raw `GPUTexture` JS handle to
  the TypeScript side.
- Pixi wraps it in an `ExternalSource` over the shared device.
  Zero-copy sampling.
- On retire, JS calls `freeRenderTexture(id)` which removes from
  the Rust HashMap.

**Symptom**: GPU memory climbed to 4+ GB at 400 bots and never
recovered. The patched fork's `Drop for WebTexture` was a no-op so
the underlying `GPUTexture.destroy()` was never called. We added
explicit `tex.destroy()` inside `free_render_texture`, which
helped for textures we owned directly — but Vello internally
allocates many staging textures and buffers per render, and those
are dropped at the end of Vello's own scopes. Those leaks bloated
GPU memory linearly with cumulative bake count.

### Round 2 — Naive Drop fix (failed)

We tried the obvious: replace the patched fork's `Drop for
WebTexture` no-op with `self.inner.destroy()`. Did the same for
`WebBuffer`.

**Result**: Chromium validator threw
`"Destroyed texture used in a submit"` errors at
`Queue.Submit([[CommandBuffer]])`. Cause: Vello's compute pipeline
creates intermediate `wgpu::Texture` wrappers whose Rust scopes
end AFTER the command buffer encoding but BEFORE the queue.submit
that uses them. Destroying immediately on Rust drop meant the
texture was gone by the time the GPU tried to execute the
command buffer.

The WebGPU spec says `destroy()` is permitted under in-flight
commands, but Chromium's validator rejects the affected submission
in practice. Rendering started dropping shapes wherever this race
hit. **Reverted.**

### Round 3 — Full bitmap bridge (worked, but worse than direct)

Per the original plan, we attempted full fork removal: route
Vello's output through a `Bgra8Unorm` `OffscreenCanvas`,
`transferToImageBitmap`, hand the bitmap to Pixi via `ImageSource`.
`bitmap_bridge.rs` was the spike, then promoted to the live body
atlas path.

This works correctly and produces identical pixels (after some
shader gymnastics — see "Alpha mode trauma" below). But:

1. **Memory doubled.** Each body atlas peaked at 12 MB instead of
   6 MB because the `ImageBitmap` and Pixi-managed GPU texture were
   alive simultaneously until retire. Fixed by forcing eager
   upload (`pixi.texture.initSource(source)`) and immediately
   calling `bitmap.close()`. Brought it back to 6 MB per atlas.

2. **FPS dips up to 335 ms.** Each bake added 4 GPU sync points
   (`surface.present()` + `transferToImageBitmap` +
   `copyExternalImageToTexture` + the extra blit pass). A burst of
   10-15 bakes per rAF could stall the main thread for 200-300 ms.
   These were per-bake costs, not per-frame — but at 200-400 bots
   spawning, bakes burst in clumps that the existing bake-queue
   budget (12 ms) couldn't smooth out.

3. **No net memory win.** Vello internals still leaked through
   the same patched fork because Vello and Pixi still shared the
   device (the bridge was just routing the OUTPUT differently;
   Vello's INTERNAL allocations didn't change). Cap stayed at
   3.5 GB at 200 bots.

The bridge would have been load-bearing for full fork removal
(separate devices for Vello and Pixi). Since we didn't commit to
fork removal, the bridge cost was pure overhead.

### Alpha mode trauma (lessons inside the bridge round)

We hit white halos at AA edges, twice, from opposite causes:

1. **Round 3a**: Pixi `alphaMode = "no-premultiply-alpha"` +
   shader passes through sampled values + Pixi NPM blend.
   Symptom: halos because `transferToImageBitmap` from a
   `"premultiplied"`-mode canvas tags the bitmap premultiplied,
   `copyExternalImageToTexture` then UNPREMULTIPLIES on upload
   (divides by alpha) corrupting straight data into
   "double-straight". Pixi's premultiplied blend formula then
   over-brightens AA edges.

2. **Round 3b**: Pixi `alphaMode = "premultiplied-alpha"` + shader
   un-premultiplies on input, recolors, re-premultiplies at output.
   Symptom: also halos. We were un-premultiplying then re-multiplying
   STRAIGHT data, which cancelled to a no-op — feeding straight
   values into Pixi's PMA blend formula over-brightens AA edges.

The fix that worked (before the revert): keep alphaMode
"premultiplied-alpha" (so the upload sees `dest.premultipliedAlpha
= source.premultipliedAlpha = true` and skips conversion), sample
straight in shader, premultiply ONLY at output.

The fix that ALSO worked (and is the current code): direct
`ExternalSource` over the Vello `GPUTexture` (no bridge), Pixi
`alphaMode = "no-premultiply-alpha"` triggers NPM blend, shader
just passes through. This is the legacy path the bridge was
trying to replace.

**Vello's output format** (definitive answer): straight alpha. See
`vello_shaders/fine.wgsl:1278`, which explicitly un-premultiplies
internal premul values before the final `textureStore`.

### Round 4 — Direct path + mesh reuse (where we landed)

Two changes combined:

1. **Reverted body atlas to direct `ExternalSource` path.** Vello
   renders into `wgpu::Texture` (kept in `self.textures` HashMap),
   Pixi samples directly over the shared device. No blit, no
   present, no `transferToImageBitmap`, no `copyExternalImageToTexture`.
   Bake cost drops back to ~5-10 ms (from ~15-25 ms with the
   bridge).

2. **`BodyBandMesh.setStrip()` reuse on anim change** in
   `PlayerStripRendererV2.tryCommit`. Instead of destroy+create
   Mesh+Shader+Geometry per anim transition, call `setStrip()` on
   the existing mesh to swap textures + UVs. Saves ~4 Shader +
   4 Geometry + 4 BindGroup allocations per anim transition,
   times ~200 bots, times anim transition frequency. Eliminates
   the bulk of Pixi-side per-anim churn.

### Round 5 — Deferred-destroy queue attempt (FAILED, reverted)

Attempted to add a queued-destroy mechanism inside the patched fork
so Vello-internal `wgpu::Texture`/`wgpu::Buffer` allocations would
release VRAM ~2 ticks after Rust's Arc count hits 0
(`rust/wgpu/src/backend/webgpu/deferred_destroy.rs`).

**Why it failed**: the same JS `GPUTexture` handle is shared
between:

- The Rust-side `wgpu::Texture` (via `extract_gpu_texture`'s
  `.clone()` of the inner JsValue), AND
- Pixi's `ExternalSource.resource` which holds a separate JS-side
  reference to the same handle.

The two references are independent. The Rust Arc<WebTexture> drops
on its own schedule (after `freeRenderTexture` removes it from the
HashMap). Pixi continues to issue draw calls referencing the GPU
handle for an indeterminate window after that — it doesn't know
the Rust Arc dropped. If our deferred queue calls
`GPUTexture.destroy()` between Pixi's last use and Pixi noticing
the source was destroyed, Pixi's submit fails validation:

```
Destroyed texture [Texture "vello_swf_frame"] used in a submit.
 - While calling [Queue].Submit([[CommandBuffer]])
```

Volume: hundreds of these per frame at startup, until Chromium
hit its console-spam cap. Reverted Drop back to no-op.

**Takeaway**: the patched fork's no-op Drop is *load-bearing for
the Vello+Pixi shared-device architecture*. The only way to safely
auto-destroy on Rust Drop is to either (a) ensure Pixi gives up its
ExternalSource handle in lockstep with the Rust Arc (not feasible
without changes to Pixi), or (b) drop the fork entirely and use
the bridge so Pixi has its own GPUTexture lifecycle independent of
Vello's (the original Step-11 endgame).

### Round 6 — Tighter cap + accept the leak (current state)

The Vello-internal leak under the patched fork's no-op Drop is real
but **bounded by total bakes done**, not by bot count. After warmup
(~5-10k bakes), it plateaus.

The user-facing decision: lowered `DEFAULT_BYTES_CAP` to **1 GB**.
That's just enough to hold the body atlas working set (~830 MB) +
accessories (~250 MB) with minimal eviction. Combined with the
Vello internal leak ceiling (~700-800 MB) and ~700 MB of Pixi /
browser overhead, total process memory targets **~2.5 GB at 200
bots** which matches the project's hard limit.

If you need to go lower:
- Drop the patched fork (the bridge endgame, see below). The leak
  goes away entirely.
- Reduce stress-test gear pool diversity — fewer unique
  (class, dir, anim) tuples = smaller working set = smaller cap
  needed.
- Trim the accessory animType pool.

---

## Why we kept `bitmap_bridge.rs`

1. **It's the only landing pad for full fork removal.** If we ever
   commit to dropping the patched wgpu (e.g., upgrading wgpu past
   a version we can't keep patching, or if the deferred-destroy
   queue's bookkeeping becomes a maintenance pain), the bridge is
   the only practical way to hand pixels from Vello-on-its-own-device
   to Pixi-on-its-own-device. WebGPU has no cross-device texture
   copy; ImageBitmap via canvas is the standard interchange.

2. **`renderSwfStripRangeAccessorizedBitmap`** (the perf-measurement
   spike) still uses the bridge end-to-end. That entry exists so
   we can measure the actual cost of the bridge vs the direct
   path in any future profiling session, without needing to
   rewrite anything.

3. **Cost of removal is high, value of removal is zero today.**
   Deleting `bitmap_bridge.rs` saves ~150 LOC of Rust + the
   `BridgeCanvasPool` plumbing. None of it runs in the live render
   path. Keeping it costs nothing.

4. **Documents the architectural alternative.** Anyone reading the
   code who wonders "why don't we just use OffscreenCanvas?" can
   see exactly how it would be wired, and can read this file to
   learn why we don't.

---

## What's in the live render path today

```
Vello render
   │
   ▼
wgpu::Texture (Rgba8Unorm, in VelloRenderer.textures HashMap)
   │
   ▼ extract_gpu_texture (clones the JS GPUTexture handle)
   │
   ▼
JS receives raw GPUTexture
   │
   ▼ buildPixiTexture()
   │
Pixi ExternalSource { resource: GPUTexture }
  + alphaMode = "no-premultiply-alpha" → NPM blend
   │
   ▼
BodyBandMesh / Sprite / etc. samples it
   │
   ▼
... time passes, bot anim swaps ...
   │
   ▼
Retire queue (2 Pixi-ticker ticks delay)
   │
   ▼
ExternalSource.destroy() / Pixi Texture.destroy(true) /
   freeRenderTexture(id)
   │
   ▼ Rust side: remove from HashMap; wgpu::Texture drops
   │
   ▼ Patched fork Drop:
   │  deferred_destroy::record_texture_drop(&self.inner)
   │
   ▼ (next 2 Pixi ticks pass)
   │
   ▼ tickDeferredDestroys(2, 256)
   │
   ▼ GPUTexture.destroy()
   │
VRAM released
```

Vello's internal allocations follow the same path: they're
`wgpu::Texture` / `wgpu::Buffer` whose Rust scopes drop at the end
of `render_to_texture`, and the patched-fork's Drop handler queues
them for deferred destroy. They land at `GPUTexture.destroy()` ~2
ticks later, after their command buffer has finished executing.

---

## How to remove the bridge (if we ever want to)

If `bitmap_bridge.rs` and `BridgeCanvasPool` ever start to bit-rot
or block a wgpu upgrade:

1. Delete `renderSwfStripRangeAccessorizedBitmap` (Rust + the
   TypeScript spike harness in
   `apps/electrobun/src/game/render/spike-bitmap-bridge.ts`).
2. Delete `bitmap_bridge.rs` and its `mod bitmap_bridge` in
   `vello-wasm/src/lib.rs`.
3. Delete the `blit_bgra_pipeline` + `bridge_canvas_pool` fields
   on `VelloRenderer`.

Nothing else touches the bridge.

---

## How to drop the patched fork (the original Step-11 goal)

Still possible, just expensive. The blockers:

- `extract_gpu_*` helpers depend on the fork's `as_webgpu()`
  accessor which exposes the underlying JS `GPUTexture` /
  `GPUAdapter` / `GPUDevice` handles. Upstream wgpu doesn't expose
  these.
- The deferred-destroy module would need to live somewhere else
  (vello-wasm crate, or a separate `wgpu-webgpu-ext` crate).
- Every render entry point would need to bridge (Vello renders →
  bitmap → Pixi ImageSource) because Vello-on-upstream-wgpu and
  Pixi-on-its-own-device can't share textures.

Per-bake cost increase: ~3 ms each. Per-frame cost: zero (the
bridge work happens during bakes, not during composition).
Warmup latency: extends by ~3 ms × N bakes (~30-60 s for 200 bots).
Memory: probably no change (deferred-destroy queue already bounds
the leak).

Estimated effort: 1-2 days of focused work. Not currently
prioritised because the deferred-destroy queue gives us bounded
memory without paying the per-bake bridge cost.
