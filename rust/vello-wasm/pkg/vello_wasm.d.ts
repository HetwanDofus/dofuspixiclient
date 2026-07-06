/* tslint:disable */
/* eslint-disable */

/**
 * Chroma subsampling format
 */
export enum ChromaSampling {
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420 = 0,
    /**
     * Horizontally subsampled.
     */
    Cs422 = 1,
    /**
     * Not subsampled.
     */
    Cs444 = 2,
    /**
     * Monochrome.
     */
    Cs400 = 3,
}

export class VelloRenderer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Count entries in `acc_subscenes`, optionally per-bundle.
     */
    accessorySubsceneCacheCountFor(bundle_filter?: string | null): number;
    /**
     * DIAG (Phase-3 design): for each DISTINCT look in the current crowd, bake
     * its look at every animation frame and report how much GEOMETRY changes
     * across frames. `distinctGeomHashes == 1` → path_data/draw_data are
     * frame-invariant (fully retainable: geometry resident, only transforms
     * re-upload). `> 1` → geometry changes per frame (morph shape interpolation
     * and/or structural appear/disappear) — those frames can't keep geometry
     * resident as-is. `distinctTxCounts > 1` → shapes appear/disappear (the
     * union/hide case). Requires `realCrowdSetup` first.
     */
    analyzeFrameStability(max_looks: number): any;
    /**
     * OFF-THREAD BAKE — worker side. Walk + vello-encode one look's subs
     * (body bands + accessories) WITHOUT interning to the GPU, returning a
     * flat blob the main thread reconstructs and interns. `acc` matches the
     * per-player `acc` shape from `realCrowdSetup`; `scale` is
     * `resolution / 20` and MUST equal the main crowd's bake scale (the
     * interned geometry is shared across threads only if baked identically).
     * Returns the blob (Uint8Array), or the fallback marker when the look
     * has patch-bearing (gradient/image) subs that must bake on the main
     * TEMP profiling: set per-bake skip mask (bit0=hit-capture, bit1=encode).
     * thread.
     */
    bakeCrowdLook(bundle: string, _export: string, frame: number, flipped: boolean, acc: any, scale: number): Uint8Array;
    /**
     * Batch-copy multiple textures into a destination texture. ONE queue.submit for all copies.
     * `copies` is a flat array: [src_id, dst_x, dst_y, src_id, dst_x, dst_y, ...]
     * All copies go to the same destination texture (the atlas).
     */
    batchCopy(dst_texture_id: number, copies: Float64Array): boolean;
    /**
     * DIAG: the DECIDING test for the 60fps question. Pre-renders each
     * (frame, band) sub-scene ONCE at twip-identity (scale-invariant,
     * uncolored — like body_subscene_cache), then builds the N-char
     * crowd PER ITER by `scene.append`-ing those cached sub-scenes with
     * per-char world transforms (the real per-frame cost). Measures the
     * PER-FRAME build (append) cost vs the naive re-emit (19ms). If this
     * is sub-ms, Vello-direct hits 60fps; recolor is then a separate
     * post-pass. `preMs` is the one-time sub-scene bake.
     */
    benchmarkBatchedAppend(bundle: string, _export: string, n_chars: number, target_dim: number, iters: number, resolution: number): any;
    /**
     * DIAG: "Flash model" feasibility test. Build N characters' body
     * bands (one export, frames varied, positioned in a grid) into ONE
     * Vello scene and render it to a `target_dim²` texture `iters`
     * times. Isolates the Vello RENDER cost (the crux of the "per-frame
     * Vello caps at 30fps" claim) from scene-build cost. JS measures GPU
     * wall via `onSubmittedWorkDone` after this returns.
     */
    benchmarkBatchedChars(bundle: string, _export: string, n_chars: number, target_dim: number, iters: number, resolution: number): any;
    /**
     * DIAG: REALISTIC crowd test. Renders N characters into ONE Vello
     * scene with VARIED gfx (round-robin over `body_specs`), per-char
     * RANDOM zone colours (real recolor), and `acc_per_char` accessories
     * each (round-robin over `acc_specs`). Specs are `"bundle|export"`;
     * unloaded ones are skipped. Renders `iters` times, bridges the
     * result to a bitmap for display. Answers: cost of a realistic
     * varied/colored/accessorized crowd via Vello-direct.
     */
    benchmarkCrowdWithAcc(body_specs: string[], acc_specs: string[], n_chars: number, acc_per_char: number, target_dim: number, iters: number, resolution: number): any;
    /**
     * DIAG: render the ACTUAL on-screen players via Vello-direct using
     * REAL data — real body gfx + real equipped accessories at their
     * REAL mount transforms + correct direction frames (driven through
     * the SAME `render_symbol_with_ctx_tinted_accessorized_bfixed` path
     * the live renderer bakes with), real per-player colors, and real
     * isometric screen positions (Y-sorted, flipped per direction). NO
     * fixed offsets, NO grid stacking. Each look is emitted once into a
     * sub-scene; the crowd is rebuilt per frame via `scene.append` at
     * real positions. Measures the real per-frame cost + displays it.
     *
     * `players`: JS array of {
     *   bundle, export, frame, dir (1-char suffix), flipped (bool),
     *   c1, c2, c3 (packed 0xRRGGBB, 0 = no tint), x, y (map-space px),
     *   acc: [{ bundle, export, slot, animType }]
     * }
     */
    benchmarkRealCrowd(players: any, target_dim_max: number, iters: number, resolution: number): any;
    bodySceneCacheStats(): any;
    /**
     * Count entries in `body_subscene_cache`, optionally filtered to a
     * single bundle. Surfaced for the loader-scene's progress UI so it
     * can report "X / Y subscenes ready" without invoking a heavier
     * stats call.
     */
    bodySubsceneCacheCountFor(bundle_filter?: string | null): number;
    /**
     * Drop every `body_scene_cache` entry. Test/diagnostic hook for
     * validating the persist→clear→load→spawn-warm cycle. Returns the
     * number of entries cleared.
     */
    clearBodySceneCache(): number;
    /**
     * Phase 3c — Drop both long-lived path caches.
     *
     * Use cases:
     *   - Memory-pressure recovery (e.g. WindowServer watchdog firing).
     *   - Cold-vs-warm bench setup: clear → run → measure → clear → run
     *     → measure to compare miss-cost against hit-cost reproducibly.
     *   - Bundle eviction: a downstream codepath that unloads a
     *     `swf_bundles` entry should call this to drop stale shape
     *     commands keyed by symbol IDs that no longer exist.
     *
     * Does NOT touch the per-cast spell instance caches, the static
     * tile scene, or in-flight GPU textures — only the scene + bundle
     * caches that are pure rebuild-on-demand.
     */
    clearPathCache(): void;
    /**
     * Create an atlas texture for packing multiple character frames.
     * Returns { texture: GPUTexture, textureId: number, width, height }.
     * All characters' frames are copied into this single texture via renderFrameToAtlas.
     */
    createAtlas(width: number, height: number): any;
    /**
     * Create a live AVM1 spell instance: allocates an `AvmRenderer`
     * whose tick state will be advanced by per-frame
     * `tickSwfSpellFrame` calls, plus a single output GPU texture sized
     * to the union of all frame bounds (so anchor + canvas stay
     * uniform across the cast). Returns the instance id JS uses to
     * drive subsequent host-var sets, ticks, and dispose. Returns 0
     * on failure.
     */
    createSwfSpellInstance(bundle: string, resolution: number): number;
    /**
     * Atlas layout for the per-actor compositing path: `{cols, cellW, cellH,
     * anchorX, anchorY}`. Actor at `realCrowdSetup` index `i` occupies cell
     * `(i % cols, i / cols)`; its feet are at `(anchorX, anchorY)` inside the
     * `cellW × cellH` cell. The JS makes one Pixi sprite per actor sampling
     * its cell, anchored at the feet, at the actor's world position +
     * `playerZIndex(cellId)`.
     */
    crowdAtlasInfo(): any;
    /**
     * OFF-THREAD BAKE — synchronous fallback for one look (worker pool
     * unavailable, or a look with patch-bearing/gradient subs the blob path
     * can't carry). Bakes + interns inline on the main thread — the proven
     * default path, just callable per-look from JS — then caches the layout
     * under `layoutSig`/`sigKey` and clears the in-flight guard. Returns subs
     * interned.
     */
    crowdBakeLookSync(bundle: string, _export: string, frame: number, flipped: boolean, acc: any, layout_sig: string, sig_key: string, scale: number): number;
    /**
     * Point-in-path hit test against the last crowd tick's actors. `x`/`y` are
     * in crowd-texture pixel space; returns the front-most hit actor's index or
     * `-1` on a miss.
     */
    crowdHitTest(x: number, y: number): number;
    /**
     * DIAG: read + reset the accumulated `internCrowdLook` phase timings.
     */
    crowdInternProf(): any;
    /**
     * DIAG: bake a look and report each sub's patch-kind breakdown, so we know
     * what the off-thread blob path must carry (ramp gradients vs image
     * bitmaps vs glyphs). Returns an array of
     * `{key, isBody, ramp, image, glyph, colorStops}`.
     */
    crowdLookPatchDiag(bundle: string, _export: string, frame: number, flipped: boolean, scale: number): any;
    /**
     * OFF-THREAD BAKE — drain the looks the emit loop couldn't render from
     * cache since the last call. Returns an array of
     * `{bundle, export, frame, flipped, acc:[{bundle,export,slot,animType}],
     * layoutSig, sigKey}`; the JS driver dispatches each to the worker pool
     * and feeds the result back via `internCrowdLook` (or `crowdBakeLookSync`
     * on fallback).
     */
    crowdTakePendingBakes(): any;
    /**
     * LIVE cutover: expose the crowd target as a Pixi-adoptable `{texture: GPUTexture,
     * width, height}` (no readback — same path as `createAtlas`/strips). Pixi wraps it
     * ONCE as an `ExternalSource`; each frame `realCrowdRenderBatched` re-renders into
     * the same texture and the JS side marks the source dirty. The GPUTexture stays
     * valid while the crowd lives (retired by `realCrowdFree`).
     */
    crowdTextureHandle(): any;
    /**
     * LIVE cutover: set every player's current animation frame IN PLACE (flat
     * `[f0,f1,...]`, same order as `realCrowdSetup`). Switches the crowd to the
     * explicit-frame path so render tracks each player's real frame instead of a
     * global clock. The hot per-frame call alongside `crowdUpdatePositions`.
     */
    crowdUpdateFrames(frames: Uint32Array): void;
    /**
     * LIVE cutover: SPARSE per-player look update (anim swap / direction / colour
     * / accessory change). `updates` is a JS array of `{ i, bundle, export,
     * frameCount, fps, flipped, c1, c2, c3, acc[] }` for ONLY the players whose
     * look changed this tick — recomputes that player's cache signature in place
     * WITHOUT clearing `look_cache` (new `(sig, frame)` combos are baked lazily by
     * the next `realCrowdRenderBatched`, old entries persist for reuse). Roster
     * add/remove still requires a fresh `realCrowdSetup`.
     */
    crowdUpdateLooks(updates: any): void;
    /**
     * LIVE cutover: update player positions IN PLACE (flat `[x0,y0,x1,y1,...]`, same
     * order as `realCrowdSetup`) WITHOUT re-setup. Re-`setup` clears the look cache, so
     * per-frame movement must update positions only; the next `realCrowdRenderBatched`
     * places each player at its new x/y. The roster (player SET) must be unchanged — a
     * spawn/despawn requires a fresh `realCrowdSetup`.
     */
    crowdUpdatePositions(xy: Float64Array): void;
    /**
     * Free the AVM1 instance + its output GPU texture. JS must call
     * this when the cast completes; otherwise both the AvmRenderer
     * state (typically a few KB) and the texture (a few hundred KB at
     * typical spell sizes) leak for the renderer's lifetime.
     */
    disposeSwfSpellInstance(instance_id: number): void;
    /**
     * Drain accumulated bake telemetry records.
     *
     * Returns an object `{ drops, records: [{kind, bundle, ms…,
     * subsceneHits, subsceneMisses, pixelArea, subCount,
     * tsRecorded}, …] }`. The returned records are removed from the
     * internal buffer — subsequent calls only see new records.
     *
     * Why this shape (raw records, not pre-aggregated): the per-burst
     * digest (zoom change, full warmup, etc.) needs different bucket
     * boundaries depending on what the caller wants to study. Raw
     * records let JS aggregate per-window. ~120 bytes per record;
     * for a 700-record zoom burst that's ~85 KB round-trip — well
     * under what wasm-bindgen handles in a single tick.
     *
     * `drops` is the count of records that were dropped because the
     * internal buffer reached its 10k cap. Non-zero means the
     * consumer fell behind — start draining more often.
     */
    drainBakeTelemetry(): any;
    /**
     * Dump the `ClassEnumeration` produced by `compute_class_enumeration`
     * for diagnostic sweeps. Returns
     * `{ bundleBFixUsed, exports: [{ exportName, totalFrameCount,
     * hasToggle, exportBFix, slotCountLogical }] }` or `null` if the
     * bundle isn't loaded.
     *
     * Read-only: builds a fresh enumeration without touching
     * `class_enum_cache` (so the diagnostic doesn't accidentally
     * short-circuit a subsequent `renderSwfClassAtlas` call).
     */
    dumpClassEnumeration(bundle: string): any;
    /**
     * Dump full inventory of a loaded SWF bundle for diagnostic sweeps.
     * Returns an array of `{ name, kind, totalFrames, isCharacterAnim }`
     * — one row per named export. `kind` is `"Sprite" | "Shape" |
     * "MorphShape" | "Bitmap"`. `totalFrames` uses the same recursive
     * resolver as `swfAnimFrameCount` (0 for non-Sprite exports).
     * `isCharacterAnim` mirrors the `is_character_anim_name` filter
     * used by `renderSwfClassAtlas`.
     *
     * Caller can roll up the result to answer "of the 110+ named
     * exports, how many go through the class atlas vs the single-
     * variant runtime path?".
     */
    dumpSwfBundleInventory(bundle: string): any;
    /**
     * Render all queued frames in a composite grid, then batch-copy to atlas.
     * 1 Vello render + 1 batch copy = 2 GPU submits total.
     */
    flushFrames(atlas_texture_id: number): void;
    /**
     * Free all cached textures.
     */
    freeAllTextures(): void;
    /**
     * Free a loaded asset.
     */
    freeAsset(id: number): void;
    /**
     * Drop a previously-allocated render output texture by id.
     * Tile-pass outputs are allocated fresh per dispatch; the caller
     * holds a Pixi `Texture` referencing the GPUTexture handle, and
     * frees the underlying storage by id once Pixi has uploaded the
     * next tick's frame. `tex_id` is taken as `f64` since wasm-bindgen
     * marshals JS numbers as f64 — internally cast to u64 to match the
     * `next_texture_id` counter.
     *
     * The patched wgpu fork (`rust/wgpu/`) has a no-op `Drop` for
     * `WebTexture` — see `feedback_pixi_wgpu_texture_lifetime`. So
     * just removing the entry from the map only releases Rust's
     * handle, NOT the GPU storage. We have to call `texture.destroy()`
     * explicitly, which forwards to `GPUTexture.destroy()` on the
     * browser side and frees the actual VRAM. Without this every
     * retired strip leaks ~0.5-1 MB of GPU memory and Path B's cache
     * cap can't bound real memory at all (the JS-side cache evicts
     * + reallocates, but the freed strips stay resident).
     */
    freeRenderTexture(tex_id: number): void;
    /**
     * Free a rendered texture by its ID (returned from renderFrame).
     * The wgpu::Texture is removed from our HashMap and dropped, releasing
     * the reference to the underlying GPUTexture. We do NOT call tex.destroy()
     * because Pixi.js may still have pending GPU commands referencing it.
     * The browser's GC will collect the GPUTexture once all references are gone.
     */
    freeTexture(texture_id: number): void;
    /**
     * Get animation info. Returns { fps, frameCount, offsetX, offsetY, trimX, trimY, ... } or null.
     * `offsetX/Y` is derived from the first frame's net offset (where Flash (0,0) actually
     * lands in the rendered texture). This avoids sub-pixel discrepancies between the SWF
     * metadata and the actual SVG content positioning that cause jitter between animations.
     */
    getAnimationInfo(asset_id: number, animation: string): any;
    /**
     * Get per-animation uniform canvas size + anchor.
     * Returns { width, height, anchorX, anchorY } or null.
     * All frames render at this size — eliminates jitter from per-frame size variation.
     * The game engine draws the canvas at (screenX - anchorX, screenY - anchorY).
     */
    getAnimationMeta(asset_id: number, animation: string, resolution: number, acc_info?: Uint32Array | null): any;
    /**
     * List animation names for an asset.
     */
    getAnimationNames(asset_id: number): string[];
    /**
     * Compute pixel dimensions for a frame at a given resolution.
     * Returns the **uniform** canvas size for the entire animation (not per-frame).
     * This ensures all frames of the same animation render at the same size,
     * eliminating jitter from per-frame size variation.
     * Returns [width, height].
     */
    getFrameSize(asset_id: number, animation: string, _frame_index: number, resolution: number): Uint32Array;
    /**
     * Label of the most recently budget-refused allocation ("" when
     * none yet). Pairs with `gpuLedgerStats` for telemetry.
     */
    gpuLastRefusedLabel(): string;
    /**
     * Allocation-accountant snapshot. `Float64Array`:
     * `[budgetBytes, liveTexBytes, liveBufBytes,
     *   refusalCount, refusedBytes,
     *   allocRateBytesWindow, rateWindowTicks,
     *   pendingTexBytes, pendingBufBytes]`.
     * The rate value is bytes created (tex+buf) over the last
     * `rateWindowTicks` rAF ticks — the flood watchdog signal.
     */
    gpuLedgerStats(): Float64Array;
    /**
     * Initialize the renderer. Returns a JS object `{ renderer, adapter, device }`
     * so JS can pass `{ adapter, device }` to Pixi.js.
     */
    static init(bake_only: boolean): Promise<any>;
    /**
     * OFF-THREAD BAKE — main side. Reconstruct + GPU-intern a look baked by a
     * worker (`bakeCrowdLook` output), then cache its ordered layout under
     * `layoutSig`/`sigKey` so the next crowd tick renders it from cache. The
     * only GPU work is the per-sub `intern_sub_transient` upload — no CPU
     * walk. Returns the count of newly-interned subs, `-1` if the blob
     * signalled a fallback (caller bakes this look synchronously), or `-2` on
     * a malformed blob.
     */
    internCrowdLook(blob: Uint8Array, layout_sig: string, sig_key: string): number;
    /**
     * List every loaded SWF bundle by the name passed to
     * `loadSwfBundle`. Used by diagnostic sweeps that need to iterate
     * the actual loaded set rather than a hand-curated list.
     */
    listLoadedSwfBundles(): string[];
    /**
     * Install entries from a previously-persisted accessory
     * sub-scene blob.
     */
    loadAccessorySubsceneCache(bytes: Uint8Array): number;
    /**
     * Load a .dofasset binary. Returns true on success, false if data is invalid.
     * Never panics — invalid data is handled gracefully to avoid poisoning
     * the wasm-bindgen RefCell (which would break ALL subsequent calls).
     */
    loadAsset(id: number, data: Uint8Array): boolean;
    /**
     * Install entries from a `serializeBodySceneCache` blob into
     * `body_scene_cache`. Returns the count loaded (0 on parse
     * error). Overwrites matching keys.
     */
    loadBodySceneCache(bytes: Uint8Array): number;
    /**
     * Install entries from a previously-serialized blob into the
     * in-memory subscene cache. Returns the count actually loaded
     * (0 on parse error). Idempotent: re-installing the same blob is
     * a no-op (HashMap insert overwrite).
     *
     * Existing entries with matching keys are overwritten — this is
     * deliberate; the loader presumes the on-disk version is at least
     * as fresh as whatever the live cache holds. Callers that want
     * preserve-on-collision can clear before loading.
     */
    loadBodySubsceneCache(bytes: Uint8Array): number;
    /**
     * Load a SWF bundle by name (e.g. "g1", "o3", "player10"). Returns true on
     * success.
     */
    loadSwfBundle(name: string, bytes: Uint8Array): boolean;
    /**
     * Install entries from a previously-persisted tile sub-scene
     * blob. Returns the count actually inserted.
     */
    loadTileSubsceneCache(bytes: Uint8Array): number;
    /**
     * Path cache observability.
     *
     * Reports the live state of the two long-lived tile-pass caches:
     *   - `swf_render_caches` (per-bundle `RenderCache`): shape
     *     command tessellation, morph interpolations, sprite frame-
     *     state walks. Populated by EVERY SWF bake (body atlas,
     *     accessory strip, tile static, tile dynamic, strip-range-
     *     accessorized). Per-bundle keying side-steps shape-id
     *     collisions across bundles (g1/shape 5 ≠ player10/shape 5).
     *   - `tile_subscenes`: pre-encoded `vello::Scene` per
     *     `(bundle, export, frame)` used by `setStaticTilePlacements`
     *     + `renderTilePass` to memcpy-append cached tile geometry.
     *
     * Memory bytes are estimates — Vello scenes don't expose encoded
     * size, so we count entries × heuristic constant (~8 KB per
     * typical tile sub-scene). Use the entry count for hit-rate
     * validation; bytes for capacity-planning only.
     *
     * Returns `{ bundleCacheCount, sceneCacheCount, sceneBytesEstimate,
     * bodySceneCacheCount }`.
     */
    pathCacheStats(): any;
    /**
     * Queue a frame for batch rendering. Builds the Vello scene (CPU work) and stores it.
     * Returns { width, height } of the frame, or null on failure.
     * Call flushFrames() to render all queued frames in ONE GPU dispatch + copy.
     */
    queueFrame(asset_id: number, animation: string, frame_index: number, resolution: number, colors: Uint32Array | null | undefined, acc_info: Uint32Array | null | undefined, dst_x: number, dst_y: number): any;
    /**
     * DIAG: read the animated crowd's current target texture back to an
     * ImageBitmap for display. Has a GPU readback cost — call it sparsely
     * (e.g. a few times/sec), NOT inside the measured render loop.
     */
    realCrowdBitmap(): any;
    /**
     * DIAG: capture `n_frames` of the animated crowd as a flipbook for
     * visual playback. Renders each anim frame (advancing by `step_ms`)
     * into its OWN target texture FIRST (no readback between renders —
     * the blit-readback poisons the next render_to_texture, so we must
     * finish all renders before reading any back), THEN reads every
     * target back to an ImageBitmap. Returns a JS array of ImageBitmaps
     * the caller can flipbook on a canvas (pure 2D, no further GPU).
     * Retained path (cached encodings + append).
     */
    realCrowdCaptureFlipbook(n_frames: number, step_ms: number): any;
    /**
     * DIAG: free the animated crowd (drops cached sub-scenes + target).
     * Non-poisoning content probe: copies a center region of the crowd target to a
     * MAP_READ buffer and async-maps it (event-loop-driven, NO surface present, NO
     * device.poll) to compute the fraction of sampled pixels with alpha>10. Unlike
     * `realCrowdBitmap` (surface blit) this can be called repeatedly without poisoning
     * subsequent renders. Returns a Promise<number> (-1 if no crowd). `await` it in JS.
     */
    realCrowdContentRatio(): Promise<any>;
    realCrowdFree(): void;
    /**
     * DIAG: BATCHED render — splits the Y-sorted crowd into batches of
     * `batch_size` actors (each kept under the single-scene shape
     * ceiling), renders each batch to its own texture (one Vello
     * dispatch each), then alpha-composites them back-to-front onto the
     * crowd target. This is the REAL high-count render path. Measures
     * append + per-batch GPU + composite together (call it in a loop +
     * await onSubmittedWorkDone in JS for end-to-end timing). Composites
     * into `crowd.view`, so `realCrowdBitmap` reads the result.
     */
    realCrowdRenderBatched(batch_size: number, time_ms: number): any;
    /**
     * RETAINED-VELLO v1+v2 real-animation render. Y-sorted batches (z-order
     * preserved). A batch whose players are ALL length-stable renders via the
     * retained fast path: geometry resident, per-frame transform writes for every
     * player + path_data writes for morph players whose geometry frame changed, then
     * the cached recording is replayed. A batch containing a length-varying
     * (structural appear/disappear) player renders via the baseline per-frame lane.
     * Rebuild of a retained batch happens only on player-set change. Composites all
     * batches back-to-front.
     */
    realCrowdRenderRetained(batch_size: number, time_ms: number): any;
    /**
     * RETAINED-VELLO validation (Phase 2). Every player is pinned to a single
     * `frozen_frame`, so each batch's geometry is trivially frame-invariant. The
     * FIRST call per batch (or after a structure change) takes the SLOW path:
     * build → `resolve_scene_reuse` → `run_reuse_full` (creates the GPU-resident
     * scene buffer, caches the replayable recording). Later calls take the FAST
     * path: only the transform byte-range is re-uploaded and the recording is
     * replayed (geometry stays resident).
     *
     * `move_px == 0.0` → 0a (fixed positions): rewrite the IDENTICAL cached
     * transforms — pure mechanism floor (no rebuild, no resolve). `move_px != 0.0`
     * → 0b (moving positions, frozen geometry): rebuild the scene at shifted
     * positions, extract the new transform stream, partial-upload + replay.
     *
     * Drive it from JS with an incrementing `frame_idx`. Returns the same
     * `buildMs`/`resolveMs`/`runMs`/`compositeMs` diagnostics as the baseline
     * `realCrowdRenderBatched`, plus `fastBatches`.
     */
    realCrowdRenderRetainedFrozen(batch_size: number, frozen_frame: number, frame_idx: number, move_px: number): any;
    /**
     * Routes `realCrowdRenderBatched` through the Tier-7 slab path: every
     * unique look interned once into the GPU-resident SubLibrary, the
     * whole crowd rendered as ONE slab block straight into the crowd
     * target (no batch textures, no composite pass). Toggling either way
     * resets the retained slab state.
     */
    realCrowdSetSlab(enabled: boolean): void;
    /**
     * DIAG: set up the stateful ANIMATED Vello-direct crowd. Parses real
     * players (body bundle/export, frameCount, fps, colors, flipped,
     * real x/y, equipped accessories), per-bundle caches, fits a target
     * texture, and pre-emits each player's frame-0 sub-scene. `realCrowdTick`
     * then advances each player's animation and re-emits only the ones
     * whose frame changed. `players`: array of {bundle, export, frameCount,
     * fps, c1,c2,c3, flipped, x, y, acc:[{bundle,export,slot,animType}]}.
     */
    realCrowdSetup(players: any, target_dim_max: number, resolution: number, retain: boolean): any;
    /**
     * DIAG: advance the animated crowd to `time_ms`, re-emitting only the
     * players whose animation frame changed, then render one frame to the
     * crowd's target texture (NO readback — clean GPU timing). Returns
     * `{ reemitted, players }`.
     */
    realCrowdTick(time_ms: number): any;
    /**
     * Render ALL frames of an animation into a single horizontal strip texture.
     * Returns { texture, textureId, width, height, frameWidth, frameHeight, frameCount }.
     * JS extracts sub-rectangles: frame i is at (i * frameWidth, 0, frameWidth, frameHeight).
     * One GPU dispatch for all frames — much faster than rendering frames individually.
     * Supports accessories: pass acc_info as flat [asset_id, slot_id, ...] pairs.
     */
    renderAnimationStrip(asset_id: number, animation: string, resolution: number, colors?: Uint32Array | null, acc_info?: Uint32Array | null): any;
    /**
     * Render a frame and return the raw `GPUTexture` as a JsValue.
     * Render a frame with optional player colors [color1, color2, color3] as 0xRRGGBB.
     * Pass null/undefined for no color replacement.
     * Optional acc_info is a flat array of pairs: [asset_id, slot_id, asset_id, slot_id, ...]
     * Each accessory must be loaded via loadAsset() first. They render using the same
     * animation name and frame index as the character.
     */
    renderFrame(asset_id: number, animation: string, frame_index: number, resolution: number, colors?: Uint32Array | null, acc_info?: Uint32Array | null): any;
    /**
     * Render a frame and copy it into a slot of an atlas texture.
     * Returns { width, height } of the rendered frame, or null on failure.
     * dst_x/dst_y are pixel coordinates in the atlas.
     */
    renderFrameToAtlas(atlas_texture_id: number, dst_x: number, dst_y: number, asset_id: number, animation: string, frame_index: number, resolution: number, colors?: Uint32Array | null, acc_info?: Uint32Array | null, slot_w?: number | null, slot_h?: number | null): any;
    /**
     * Path B accessory strip rasteriser. Bakes 3 directional sub-
     * frames of an accessory into a 3-wide × 1-tall BGRA8 strip at
     * the accessory's own origin. The Pixi compositor positions the
     * sprite per-frame via the body's mount-transform table; this
     * entry knows nothing about the body.
     *
     * Sub-frame layout (column 0/1/2):
     * `pick_accessory_frame(..., char_frame = 0)` …
     * `pick_accessory_frame(..., char_frame = 1)` …
     * `pick_accessory_frame(..., char_frame = 2)`. The Pixi side
     * indexes into the strip via `char_frame % 3` per game tick.
     *
     * `slot + anim_type + dir` drive the slot-specific direction
     * fallback chain inside `pick_accessory_frame`. `side` defaults
     * to `dir` — capes and shields with W-prefix walking variants
     * can pass the body's mount-declared side directly (e.g. `"WR"`)
     * to opt into the canonical labelled frame, otherwise the
     * fallback chain falls back to the cardinal direction.
     */
    renderSwfAccessoryStrip(acc_bundle: string, acc_export: string, slot: number, anim_type: number, dir: string, side: string, resolution: number): any;
    /**
     * Render ALL Z-ordered bands of a body symbol over a frame range
     * into a SINGLE atlas pair (colour + zone-id). Bands are stacked
     * vertically in the atlas with `BAND_PADDING_PX` of transparent
     * padding between them so LINEAR sampling at band 0's bottom
     * edge can't bleed into band 1's top edge.
     *
     * Cuts texture allocations from `bandCount × 2` per anim to
     * exactly `2` (one colour atlas, one zone atlas). Vello compute
     * dispatch count drops from `2 × bandCount` to `2` as well —
     * all bands' geometry packs into one scene per output mode.
     *
     * Pixel-perfect equivalent to per-band rendering: each band's
     * content is rasterized at the same `(scale, -px_min_x, -px_min_y)`
     * world transform as before, just offset down the atlas by
     * `band_idx × (strip_h + BAND_PADDING_PX)`. The Pixi mesh shifts
     * its UV range to address only its band's sub-region; vertex
     * positions and anchors are unchanged, so accessory mount
     * placement (driven by twip-space affine transforms, completely
     * orthogonal to texture layout) sees no change.
     */
    renderSwfBodyAtlas(bundle: string, _export: string, start: number, count: number, total_frame_count: number, resolution: number, apply_b_fix: boolean, hat_equipped: boolean): any;
    /**
     * Render multiple exports of ONE bundle at the SAME frame in a single
     * Vello dispatch — used to collapse tile prefetch from N dispatches
     * (one per unique tile) to 1 dispatch per bundle in the map. Tiles are
     * shelf-packed into a composite texture; the JS caller slices per-tile
     * sub-rectangles via the returned `items*` parallel arrays.
     *
     * Exports that fail to look up or have degenerate bounds are encoded as
     * `itemValid[i] = 0` with zero geometry; valid items get `itemValid[i] = 1`.
     */
    renderSwfBundleBatch(bundle: string, exports: string[], frame: number, resolution: number): any;
    /**
     * Class atlas bake: pack EVERY animation variant of a body
     * bundle (walkR/L/F/B/S, staticR/L/F/B/S, runR/L/F/B/S, plus any
     * other `<word><direction-suffix>` named sprite) × `applyBFix ∈
     * {false, [true]}` × `hatEquipped ∈ {false, [true]}` into ONE
     * Rgba8Unorm texture bridged to a single ImageBitmap.
     *
     * Normalisation: the `applyBFix` and `hatEquipped` dimensions
     * expand only when the body uses them (any mount with
     * `b_fix=true` / a multi-frame toggle sprite respectively).
     * Otherwise we bake one variant per export.
     *
     * Per-variant rasterisation reuses the same scene-build /
     * render_to_texture / `CombineBodyPipeline` path as
     * `renderSwfBodyAtlas`. Each variant produces a variant-sized
     * `combined` texture, then `copy_texture_to_texture` writes it
     * into the class atlas at the packer-assigned origin. No new
     * Vello scene-size risk (every per-variant scene stays the
     * size we know works); the win is purely in (a) Pixi-side
     * texture count → 1 per class instead of N per variant,
     * (b) per-variant intermediate `ImageSource` upload gone.
     */
    renderSwfClassAtlas(bundle: string, resolution: number): any;
    /**
     * Render an exported symbol from a loaded SWF bundle to a fresh GPUTexture.
     * `bundle` is the name passed to `loadSwfBundle`. `export` is the SWF
     * export name (e.g. "168" for tile id 168, or "walkR"/"staticR" for the
     * player). `frame` selects which timeline frame to render (0 for tiles).
     * `resolution` is the output pixels-per-twip multiplier (≈ zoom).
     *
     * Returns `{ texture: GPUTexture, textureId, width, height, anchorX,
     * anchorY }` — `anchorX/Y` is the position of the SWF (0,0) origin
     * inside the rendered texture, so the caller can place the sprite at
     * `(cellCenterX - anchorX, cellCenterY - anchorY)`.
     */
    renderSwfFrame(bundle: string, _export: string, frame: number, resolution: number): any;
    /**
     * Path B mount-transform extraction. Returns a dense flat
     * `Float32Array` of length `count * max_slot * 6` carrying the
     * affine matrix `(a, b, c, d, tx, ty)` at every accessory mount
     * in the body's display tree, per frame. Translations are in
     * TWIP space; JS multiplies by `resolution / 20` for pixel
     * space. Identity matrix where a slot has no mount in a given
     * frame.
     *
     * `apply_b_fix=true` negates the X translation for mounts that
     * declare `b_fix=true` — matches the body strip's bFix
     * behaviour. Caller cache key: `(bundle, export, start, count,
     * apply_b_fix)`.
     * Returns a JS object: `{ matrices: Float32Array, presence:
     * Uint8Array }`.
     * - `matrices` length = `count * max_slot * 6` floats — kurbo
     *   affine coefficient order `(a, b, c, d, tx, ty)`. Identity
     *   matrix where the body has no mount at that frame.
     * - `presence` length = `count * max_slot` bytes — 1 where the
     *   body's display list places a mount of that slot at that
     *   frame, 0 otherwise. **This is the canonical signal for
     *   whether to render the accessory** — checking matrix==identity
     *   in JS is a heuristic that can false-positive.
     *
     * Returns `null` (JsValue::NULL) on resolution failure.
     */
    renderSwfMountTransforms(bundle: string, _export: string, start: number, count: number, apply_b_fix: boolean, max_slot: number): any;
    /**
     * Render the SWF's ROOT timeline (the main movie stage) at a given
     * frame. Used for SWFs without named exports — artwork/big/{gfxId}.swf
     * and spell icons place their visible content directly on the root
     * stage instead of declaring named exports. Honors `swf_player_colors`
     * for portraits that carry the canonical `stringCourseColor` zones.
     */
    renderSwfRoot(bundle: string, frame: number, resolution: number): any;
    /**
     * Compose a spell icon by overlaying the canonical 1.29 trio in ONE
     * Vello dispatch:
     *
     *   1. `_spellBackground` from `back_bundle` — the filled disc, tinted to `bc_rgb`.
     *   2. `_spellFrame` from `back_bundle` — the ring border, tinted to `fc_rgb`.
     *   3. The `up_bundle` SWF's root timeline — the glyph, tinted to `pc_rgb`.
     *
     * All three render with a flat-fill `OwnedColorTransform` (multiply
     * RGB by 0, add the target colour), mirroring the asset-pipeline's
     * `recolorEl` step but applied at render time inside Vello — no PNG
     * composer, no Pixi filter, no readback. Output is a single GPU
     * texture sized to the disc's bounding box (which contains the frame
     * and glyph by SWF stage convention).
     */
    renderSwfSpellIcon(back_bundle: string, up_bundle: string, bc_rgb: number, fc_rgb: number, pc_rgb: number, resolution: number): any;
    /**
     * Run AVM1 across the spell SWF's main timeline and pack every frame
     * into a 2D-grid composite texture in a single Vello dispatch. Mirrors
     * the asset-pipeline's spell strip bake but at runtime — no `.dofasset`
     * frame data, just the SWF + the in-renderer AVM1 emulator from
     * `swf_spike::render_avm1::AvmRenderer`.
     *
     * "Main timeline" = the longest `DefineSprite` in the SWF (Dofus spell
     * convention, e.g. spell 802 sprite id=10 has 129 frames). The
     * renderer is constructed once per call, ticked → rendered → advanced
     * for each frame, ensuring AS2 side-effects (`gotoAndStop`, `_alpha`
     * fades, `_rotation += 0.66`, etc.) drive the visuals exactly the way
     * the canonical Flash client did.
     *
     * Bounds: union of every frame's `symbol_bounds(main_sym)`. Each cell
     * is the same size, giving a uniform anchor across the strip — Pixi
     * can swap textures without per-frame pivot reapplies.
     */
    renderSwfSpellStrip(bundle: string, resolution: number): any;
    /**
     * Render `requested_frame_count` consecutive frames of one (bundle, export)
     * in a single Vello dispatch — frames laid out in a 2D grid so the caller
     * can slice the resulting composite texture into per-frame Pixi sub-textures.
     * Mirrors the dofasset path's `renderAnimationStrip`: 1 GPU dispatch instead
     * of N, 1 texture allocation instead of N. Stops at the first frame whose
     * `symbol_bounds` is degenerate (matches the JS per-frame `break` policy).
     *
     * Anchor handling: uses the union of bounds across all valid frames so the
     * per-frame cell size is uniform and the SWF (0,0) origin lands at the same
     * `(anchorX, anchorY)` inside every cell. The caller can pivot a single Pixi
     * sprite to that anchor and swap textures freely without reapplying offsets.
     */
    renderSwfStrip(bundle: string, _export: string, requested_frame_count: number, resolution: number): any;
    renderSwfStripRange(bundle: string, _export: string, start: number, count: number, total_frame_count: number, resolution: number): any;
    /**
     * Like `renderSwfStripRange` but composes accessory SWFs at the
     * base character's body part mount points (declared via
     * `GAC.applyAccessory(this, slot, side)` in the AS2 frame
     * actions, scanned at SWF load time into
     * `SwfDoc::accessory_mounts`).
     *
     * Inputs (all parallel arrays of equal length, one entry per
     * accessory):
     *  - `acc_slots[i]`: AS2 mount slot id (1-4 in vanilla Dofus —
     *    1=head/hat, 2=weapon, 3=cape, 4=shield in our convention).
     *  - `acc_bundles[i]`: bundle name where the accessory SWF was
     *    loaded via `loadSwfBundle`.
     *  - `acc_exports[i]`: export name within that bundle (e.g.
     *    `"16_42"` = type-16 hat, gfx 42).
     *  - `acc_frames[i]`: frame index inside the accessory's symbol
     *    (R=0/L=3/F=6/B=9/S=12 typically — caller picks based on
     *    the active animation's direction).
     *
     * Mounts whose slot has no accessory entry are silently skipped
     * (no overlay rendered, body part shown as authored). Slot
     * collisions (multiple accessories for the same slot) keep the
     * LAST entry — caller is expected to pre-deduplicate.
     * Renders a strip with composed accessories.
     *
     * `acc_anim_types[i]` classifies the character animation for slot i:
     * 0=static, 1=walk, 2=run. Selects which slot-specific direction
     * fallback table the renderer walks. The accessory's actual frame
     * is computed PER CHARACTER FRAME inside the renderer using the
     * body part's mount-declared `side` plus `(char_frame % 3)`, so
     * the accessory cycles its 3 sub-frames in lockstep with the
     * character animation.
     */
    renderSwfStripRangeAccessorized(bundle: string, _export: string, start: number, count: number, total_frame_count: number, resolution: number, acc_slots: Uint32Array, acc_bundles: string[], acc_exports: string[], acc_anim_types: Uint32Array, char_dir_suffix: string, apply_b_fix: boolean): any;
    /**
     * SPIKE — bitmap-bridge twin of `renderSwfStripRangeAccessorized`.
     * Mirrors every input + every dim/anchor field of the live entry
     * point but returns `{ bitmap: ImageBitmap, ... }` instead of a
     * `{ texture: GPUTexture, textureId, ... }` pair. Internally:
     *   1. Renders Vello's scene into a private `Rgba8Unorm`
     *      `wgpu::Texture` (same path as the live call).
     *   2. Blits that texture to a fresh `Bgra8Unorm`
     *      `OffscreenCanvas` surface frame.
     *   3. `surface.present()` → `canvas.transferToImageBitmap()` →
     *      hands the bitmap to JS.
     *
     * Used by `apps/electrobun/src/game/render/spike-bitmap-bridge.ts`
     * to measure `vello_ms` and `upload_ms` for the cross-device
     * (independent Pixi `GPUDevice`) bitmap import path before
     * committing to the broader Vello → ImageBitmap migration.
     *
     * Delete this entry point once the spike validates Option B.
     */
    renderSwfStripRangeAccessorizedBitmap(bundle: string, _export: string, start: number, count: number, total_frame_count: number, resolution: number, acc_slots: Uint32Array, acc_bundles: string[], acc_exports: string[], acc_anim_types: Uint32Array, char_dir_suffix: string, apply_b_fix: boolean): any;
    /**
     * Render the DYNAMIC parts of a multi-frame tile across a contiguous
     * frame range `[start, start+count)`. Output is a strip of
     * per-frame textures at the FULL animation's union bounds — same
     * canvas size as the static base from `renderSwfTileStaticBase`,
     * so the AnimatedSprite using these frames overlays pixel-perfectly
     * on top. Each cell contains ONLY the placements classified as
     * dynamic (timeline-varying placements, or constant placements of
     * multi-frame characters). Static placements are skipped — they
     * already live on the static base.
     */
    renderSwfTileDynamicStripRange(bundle: string, _export: string, start: number, count: number, total_frame_count: number, resolution: number): any;
    /**
     * Render the STATIC parts of a multi-frame tile export (every depth
     * whose placement data is constant across the timeline AND whose
     * placed character has no multi-frame sub-tree). Output texture is
     * sized to the FULL animation's union bounds, so it composites
     * pixel-perfectly under per-frame dynamic textures from
     * `renderSwfTileDynamicStripRange`. Returns the same shape as
     * `renderSwfStrip` but with `frameCount=1` and `gridCols=1` since
     * the static base is one frame.
     *
     * Used to break up heavy animated tiles (e.g. map 35's tile 343 —
     * wooden building + 210-frame chimney smoke) so the building isn't
     * re-encoded 210 times per cycle, and so each Vello scene stays
     * well under the tile-encoder shape budget. The
     * `feedback_swf_vello_scene_overflow` memory note prescribes this
     * split as the canonical workaround for the overflow.
     */
    renderSwfTileStaticBase(bundle: string, _export: string, total_frame_count: number, resolution: number): any;
    /**
     * Render a single zone mask frame. Returns { texture, textureId, width, height }.
     * Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
     */
    renderZoneMaskFrame(asset_id: number, animation: string, frame_index: number, resolution: number, acc_info?: Uint32Array | null): any;
    /**
     * Render a zone mask strip: same layout as renderAnimationStrip but with
     * zone marker colors (R=zone1, G=zone2, B=zone3) and opaque black for non-zone.
     * Used alongside the base strip for GPU color replacement without item bleed.
     * Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
     */
    renderZoneMaskStrip(asset_id: number, animation: string, resolution: number, acc_info?: Uint32Array | null): any;
    /**
     * Memory accounting snapshot from the patched-wgpu fork. Returns
     * a `Float64Array` of 8 values in this order:
     * `[liveTexBytes, liveBufBytes, createdTexBytes, createdBufBytes,
     *   destroyedTexBytes, destroyedBufBytes, pendingTexBytes,
     *   pendingBufBytes]`.
     *
     * `live*` = currently allocated GPU memory referenced by the
     * Rust side (incremented on `device.create_texture` /
     * `create_buffer`, decremented on `destroy()`).
     * `created*` / `destroyed*` = cumulative running totals.
     * `pending*` = bytes in the deferred-destroy queue waiting for
     * their 2-tick settle.
     */
    rustGpuByteStats(): Float64Array;
    /**
     * DOFUS churn attribution: per-label created stats, flattened as
     * `[name, bytes, count, name, bytes, count, ...]` (bytes/count as
     * decimal strings), sorted by bytes descending. `kind`: 0 =
     * buffers, 1 = textures. Pair with `rustGpuResetByName` to read a
     * clean before/after delta around a single spawn burst.
     */
    rustGpuCreatedByName(kind: number): string[];
    /**
     * Diagnostic: counts for non-byte-sized GPU objects (bind
     * groups, texture views, samplers). Returns 9 values:
     * `[liveBg, createdBg, droppedBg,
     *   liveTv, createdTv, droppedTv,
     *   liveSa, createdSa, droppedSa]`.
     *
     * `live_* = created_* - dropped_*`. If `live_*` climbs without
     * bound during stress, the wgpu Rust side is holding handles
     * past their useful lifetime — pointing to a leak.
     */
    rustGpuObjectCounts(): Float64Array;
    /**
     * Zero the per-label created maps (buffers + textures).
     */
    rustGpuResetByName(): void;
    /**
     * Diagnostics: how many `wgpu::Texture`s we hold in
     * `self.textures` (every render target the Vello side has
     * outstanding). Useful for cross-checking the JS-side
     * `liveRenderTextureIds` set.
     */
    rustTexturesCount(): number;
    /**
     * Serialize `acc_subscenes` to a `VSC2` blob suitable for IDB
     * persistence. Same wire format as the body cache, tagged with
     * `CacheId::Accessory`.
     */
    serializeAccessorySubsceneCache(bundle_filter?: string | null): Uint8Array | undefined;
    /**
     * Serialize `body_scene_cache` (the COMPOSED per-variant body
     * atlas scenes) to a `VSC2` blob. This is the cache the
     * per-variant SPAWN path (`render_swf_body_atlas`) actually reads
     * — persisting it is what warms a cold 250-actor map entry
     * (`serializeBodySubsceneCache` persists a DIFFERENT cache the
     * spawn never touches). Scenes are scale-baked, so the blob is
     * per-resolution; the caller keys IDB rows by resolution.
     */
    serializeBodySceneCache(bundle_filter?: string | null): Uint8Array | undefined;
    /**
     * Serialize the `body_subscene_cache` to a bytes blob suitable for
     * browser-cache persistence. Optionally filter to a single bundle —
     * callers persist one blob per bundle so each entry's content hash
     * invalidates independently when its SWF changes.
     *
     * The cache is resolution-independent (twip identity), so the same
     * bytes work at any render scale. Format: see `scene_cache.rs`
     * (magic "VSC1" + length-prefixed entries).
     *
     * Returns `null` on serialization error (unsupported scene content
     * — Glyph/Image patches don't appear in SWF char bakes, so this
     * path should never fail in practice; if it does, the caller
     * falls back to a fresh bake and the cache stays empty).
     *
     * Per-entry skip: character sub-scenes containing `Patch::Image`
     * (bitmap-backed shape fills) skip persistence and re-bake on
     * cold session. The skip count is logged but not surfaced — the
     * returned blob carries the encodable subset.
     */
    serializeBodySubsceneCache(bundle_filter?: string | null): Uint8Array | undefined;
    /**
     * Serialize `tile_subscenes` to a `VSC2` blob suitable for IDB
     * persistence. Same wire format as the body cache, tagged with
     * `CacheId::Tile`.
     *
     * Tile sub-scenes occasionally contain `Patch::Image` (bitmap
     * fills from `DefineBitsLossless` shape fills). The encoder
     * fails the WHOLE blob if any entry contains such a patch — we
     * don't yet support persisting raster fills. Result: tiles with
     * embedded images skip the persistent cache (in-memory cache
     * still works for the current session); next session re-bakes
     * them from the SWF. Callers see `null` on encode error and
     * gracefully fall back to fresh bakes — no correctness issue.
     */
    serializeTileSubsceneCache(bundle_filter?: string | null): Uint8Array | undefined;
    /**
     * Report `body_scene_cache` health (the composed-atlas LRU at
     * 1500 cap used by `render_swf_body_atlas`). v4 architecture
     * decision blocks on whether this LRU thrashes at 250-bot stress.
     * Returns:
     *   - `entries`: current live entry count (≤ 1500)
     *   - `cap`: BODY_SCENE_CACHE_CAP constant
     *   - `hits`: cumulative hits since renderer init
     *   - `misses`: cumulative misses since renderer init
     *   - `evictions`: cumulative LRU evictions since renderer init
     *   - `hitRate`: hits / (hits + misses); 0.0 if no accesses yet
     * Set the class-atlas bake mode: 0 = AUTO (per-page for ≤2 pages,
     * per-variant for ≥3), 1 = force per-variant, 2 = force per-page.
     * See the `class_atlas_bake_mode` field doc for the measured
     * crossover rationale.
     */
    setClassAtlasBakeMode(mode: number): void;
    /**
     * Legacy A/B toggle. `true` → force per-variant (mode 1);
     * `false` → force per-page (mode 2). Prefer
     * `setClassAtlasBakeMode(0)` to restore AUTO.
     */
    setClassAtlasForcePerVariant(force: boolean): void;
    /**
     * OFF-THREAD BAKE — enable/disable. When ON, the crowd emit loop never
     * bakes synchronously on a cache miss; it queues the look for the worker
     * pool (drained by `crowdTakePendingBakes`) and renders the last-good
     * frame meanwhile. The JS driver MUST be draining + interning/falling
     * back, or queued looks never render — so this stays OFF until the
     * worker pool is up.
     */
    setCrowdOffThreadBake(on: boolean): void;
    /**
     * Set the hard GPU allocation budget (Phase 1 accountant), in
     * bytes over ALL live texture + buffer bytes, bake temp pages
     * included. `0` disables enforcement (accounting continues).
     * When a create would breach the budget the patched wgpu refuses
     * it — a minimal placeholder is allocated instead and the refusal
     * is counted (`gpuLedger().refusals`); the process NEVER
     * allocates past budget.
     */
    setGpuBudgetBytes(bytes: number): void;
    /**
     * Set the player's three zone colours used by the SWF render path.
     * Each value is `0xRRGGBB`; pass any value > 0xFFFFFF (the JS side
     * sends 0xFFFFFFFF for canonical `-1`) to leave that zone untinted.
     * `0` is a REAL colour (flat black) — canonical applyColor skips
     * only `undefined`/`-1` (GlobalSpriteHandler.as:63).
     * Call before `renderSwfFrame` for player/character sprites.
     */
    setSwfPlayerColors(c1: number, c2: number, c3: number): void;
    /**
     * Inject a `{x, y}` host-var (typically `cellFrom` / `cellTo`) into
     * the spell's AVM1 root clip. Must be called before the first
     * `tickSwfSpellFrame` for the values to land on `_parent.cellFrom.x`
     * lookups in AS2.
     */
    setSwfSpellHostCell(instance_id: number, name: string, x: number, y: number): void;
    /**
     * Inject a numeric host-var (typically `level` or `angle`) into the
     * spell's AVM1 root clip.
     */
    setSwfSpellHostNumber(instance_id: number, name: string, value: number): void;
    /**
     * Per-pass GPU timings of the last slab recording (gpu-timing builds
     * only; `null` otherwise or until the first readback completes).
     */
    slabGpuTiming(): any;
    /**
     * Report `body_subscene_cache` footprint for one bundle: how many
     * cache entries belong to that bundle and how many serialized
     * bytes they take in the VSC1/VSC2 IDB wire format. Reads the
     * existing `serialize_body_subscene_cache` path so the size is the
     * real IDB blob size, not an estimate.
     *
     * Returns `{ entryCount, serializedBytes }`. Both 0 if the bundle
     * isn't loaded or the cache has no entries for it. `serializedBytes`
     * is -1 if the encoder failed (returned in console log).
     */
    subsceneCacheBytesForBundle(bundle: string): any;
    /**
     * For an accessory (bundle/export at slot+dir+side), return the
     * SMALLEST `animType` value (in 0..=anim_type) whose
     * 3-cycle frame sequence is identical to the one queried.
     *
     * Purpose: many accessories don't actually animate by anim_type
     * — e.g. helmets, capes, shields that look identical in static
     * / walk / run. The JS-side accessory cache key includes
     * `animType`, so without dedup such accessories get cached
     * three times. By calling this function before keying, the JS
     * can normalise `animType` to its canonical value and collapse
     * the duplicates. Empirically this cuts ~50% of accessory
     * cache entries at 200-bot stress (per snapshot 11: 5780 →
     * expected ~3000).
     *
     * Returns the input `anim_type` unchanged on lookup failure
     * (bundle/export not loaded) so the caller still produces a
     * usable key.
     */
    swfAccessoryCanonicalAnimType(acc_bundle: string, acc_export: string, slot: number, dir: string, side: string, anim_type: number): number;
    /**
     * 0-based frame index at which this export calls
     * `GAC.applyEnd(this)` — the canonical spell-cast "action point"
     * where `GlobalSpriteHandler.applyEnd` releases the sequencer
     * (`_loc3_.sequencer.onActionEnd()`, assets/sources/client-code/
     * ank/battlefield/GlobalSpriteHandler.as:430-440). The JS layer
     * compares this against its 0-based `frameIndex` cursor to fire
     * the spell effect MID-swing instead of at frame 1 or the last
     * frame. Returns `-1` when the export is missing or no descendant
     * ships an `applyEnd` frame script (the caller then keeps its
     * near-frame-0 fallback). Deterministic per (bundle, export) —
     * the JS side caches it.
     */
    swfActionPointFrame(bundle: string, _export: string): number;
    /**
     * this export — `walkR` is a 1-frame wrapper around the real animation,
     * so JS needs the inner count to drive the ticker.
     */
    swfAnimFrameCount(bundle: string, _export: string): number;
    /**
     * One-shot lookup for a body export's slot/band layout. Returns
     * `{ slotCount, bandCount, slots: [{ slot, depth }, ...],
     * bFixUsed }`. JS uses this to decide how many bands to bake per
     * (bundle, export) and which Z order to stack them in.
     *
     * `bFixUsed` reports whether ANY of this character's accessory
     * mount declarations have `b_fix = true`. When false, the body
     * bake is pixel-identical with `apply_b_fix = true` vs `false`
     * (the sprite walker only acts on bFix for placements whose
     * mount declares `b_fix=true` — without any such mount, the
     * override is a no-op). JS uses this to collapse the bake-key's
     * `applyBFix` dimension for characters without capes/shields,
     * roughly halving bakes on those classes.
     */
    swfBodyBandInfo(bundle: string, _export: string): any;
    /**
     * Enumerate every named export in a loaded SWF bundle. Used by
     * the stress test (and any other "all available accessories"
     * caller) to build content pools dynamically from what's actually
     * loaded instead of relying on a hand-curated list. Returns an
     * empty array if the bundle isn't loaded.
     */
    swfBundleExports(bundle: string): string[];
    /**
     * Frames-per-second from the SWF header. Bundles vary: g1/g2 = 12,
     * o1/o2/o4/o5/o6/o7/o10/o12 = 60, o3/o8/o9/o11 = 40. The JS tile
     * ticker reads this per-bundle so an o1 building animates at the
     * 60 fps it was authored for instead of a hardcoded 24 fps that
     * runs everything at 0.4× speed.
     */
    swfBundleFrameRate(bundle: string): number;
    /**
     * True if this export's symbol tree contains any placement with filters
     * (drop shadow / glow / blur / color matrix). Filter-bearing tiles must
     * be rendered individually, not in `renderSwfBundleBatch`, because the
     * halo fallback path (`apply_halo`) emits 5–9 extra symbol renders per
     * filter into the active scene; piling many filter-bearing tiles into
     * one composite scene exceeds Vello's tile encoder threshold and
     * causes silent stroke drops (sprites visibly missing). CPU-only walk
     * of the sprite tree, recurses 5 levels deep — cheap.
     */
    swfExportHasFilters(bundle: string, _export: string): boolean;
    /**
     * Pure-bounds probe for an SWF root timeline. Returns
     * `{width, height}` at resolution 1 without touching the GPU.
     * Used by the fighter-portrait renderer (banner artworks) to
     * compute the natural long-edge before allocating a target
     * canvas. Returns NULL on missing bundle or degenerate bounds.
     */
    swfRootNaturalSize(bundle: string, frame: number): any;
    /**
     * Pure-bounds probe for the spell-icon composition. Returns the
     * natural pixel rectangle `{width, height}` at resolution 1
     * without ever touching the GPU. Replaces the 16×16 throwaway
     * probe-render that previous versions used to discover natural
     * size — a CPU-only `symbol_bounds` walk costs microseconds vs.
     * the milliseconds of an attach-render-detach roundtrip.
     *
     * Returns NULL on missing bundle, missing required layers, or
     * degenerate root bounds.
     */
    swfSpellIconNaturalSize(back_bundle: string, up_bundle: string): any;
    /**
     * Query the cached strip bounds for an export at a given total
     * frame count, populating the cache on miss. Returns
     * `{minXTwip, minYTwip, maxXTwip, maxYTwip, animEnd}` in twip
     * units (caller multiplies by `resolution / 20.0` to get pixels)
     * or `null` on failure. Useful for callers that want to size
     * canvases / ExternalSources without doing a render dispatch.
     */
    swfStripBounds(bundle: string, _export: string, total_frame_count: number): any;
    /**
     * Returns the number of frames in the deepest animation reachable through
     * Classify a multi-frame tile sprite as "animated" or "random".
     *
     * Dofus 1.29 multi-frame tile sprites split into two visual kinds:
     *   * **animated** — plays through every frame in a loop (water,
     *     fire, windmill blades). Caller cycles `currentFrame` over time.
     *   * **random**   — a frame-1 `DoAction` reads the sprite's
     *     `_totalframes`, calls `RandomNumber` then `GotoFrame2` with
     *     `set_playing=false`, picking one variant and freezing on it
     *     (grass tile stamps, dirt patches). Caller MUST NOT animate
     *     these — pick one frame at load and hold it, otherwise the
     *     ground crawls.
     *
     * Classify a multi-frame tile sprite into Dofus 1.29's three kinds:
     *   * `"animated"` — no frame-1 script (or none of `random`/`stop`).
     *     Flash plays naturally; caller cycles frames at FPS.
     *   * `"random"` — `random(N) → gotoAndStop(...)` on frame 1.
     *     Self-randomizing; caller picks ONE stable random frame per
     *     cell.
     *   * `"slope"` — `Stop()` on frame 1 with variants on frames 2..N.
     *     The engine externally calls `gotoAndStop(cell.groundSlope)`
     *     (MapHandler.as:226). Caller must use the cell's groundSlope
     *     property to pick the frame.
     *   * empty string for static (1-frame top + 1-frame children) or
     *     unknown bundles.
     *
     * Important: a sprite is "animated" if EITHER the top sprite is
     * multi-frame OR any of its (recursively-traversed) children is
     * multi-frame. Map 35's tile 343 (the wooden building) is a
     * 1-frame top sprite that contains a 210-frame child (1361) —
     * without recursing, we'd label it static and freeze the building.
     */
    swfTileAnimKind(bundle: string, _export: string): string;
    /**
     * Step-11 deferred-destroy tick. JS calls this once per Pixi
     * shared-ticker tick. It advances the patched-fork's frame
     * counter and calls `GPUTexture.destroy()` /
     * `GPUBuffer.destroy()` on every Rust-side wgpu resource that
     * was dropped at least `min_age_frames` ticks ago — past
     * WebGPU's submission completion window, so destroying now is
     * safe.
     *
     * `max_destroys_per_tick` caps the per-tick destroy count so a
     * burst (anim transitions, cache evictions) doesn't stall a
     * single rAF.
     *
     * Returns `[texturesDestroyed, buffersDestroyed,
     * texturesPending, buffersPending]` for diagnostics.
     */
    tickDeferredDestroys(min_age_frames: number, max_destroys_per_tick: number): Uint32Array;
    /**
     * Tick the spell's AVM1 by one frame, render the new state into the
     * pre-allocated output texture, and report whether the cast is still
     * active. JS calls this on its rAF loop (rate-limited by the SWF's
     * authored fps from `swfBundleFrameRate`).
     *
     * Returns `{ texture, textureId, width, height, anchorX, anchorY,
     * isPlaying, isRemoved, frame }`. `isPlaying = false` when AS2 has
     * called `stop()` on the root; `isRemoved = true` when AS2 has
     * called `_parent.removeMovieClip()` (the canonical "spell over"
     * signal — JS should fire `onComplete` and stop ticking). Returns
     * `JsValue::NULL` if the instance id is unknown.
     */
    tickSwfSpellFrame(instance_id: number): any;
    /**
     * Count entries in `tile_subscenes`, optionally per-bundle. Same
     * usage as the body variant.
     */
    tileSubsceneCacheCountFor(bundle_filter?: string | null): number;
    /**
     * Diagnostics: WASM linear-memory size in bytes. Tracks how
     * much memory the Rust side itself is consuming (excluding GPU
     * resources, which live in the browser GPU process).
     */
    wasmHeapBytes(): number;
}

/**
 * Body-split colour-agnostic bake — port of wc3's deferred prebake
 * (`actor_batch/prebake.rs` `bake_body_frame` segments + mounts). Mirrors
 * [`emit_player_look`] exactly (same symbol lookup, slot depths, mount
 * transforms, flip handling) but renders each body band into its OWN scene
 * with `PlayerColors::default()` — so zone fills stay placeholders and the
 * geometry is identical for every actor with that body — while
 * `zone_patch` capture records where each zone colour lands. Each accessory
 * renders into its own scene (colours baked as authored). The caller interns
 * each sub by its palette-free `key`, so the SubLibrary holds one copy per
 * `(breed,dir,frame,band)` / `(accessory,…)` instead of one per unique
 * coloured look × frame. Per-actor palette is applied at compose via the
 * slab colour overlay (`ZonePatchGpu` + `instance_color_overlays`).
 * DIAG: round-trip self-test for the off-thread crowd-bake blob
 * (de)serialization, run on the real wasm target (the crate can't build for
 * host). Returns true iff every field survives serialize → deserialize.
 */
export function crowdBlobSelftest(): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_vellorenderer_free: (a: number, b: number) => void;
    readonly crowdBlobSelftest: () => number;
    readonly vellorenderer_accessorySubsceneCacheCountFor: (a: number, b: number, c: number) => number;
    readonly vellorenderer_analyzeFrameStability: (a: number, b: number) => any;
    readonly vellorenderer_bakeCrowdLook: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: number) => [number, number];
    readonly vellorenderer_batchCopy: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_benchmarkBatchedAppend: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_benchmarkBatchedChars: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_benchmarkCrowdWithAcc: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => any;
    readonly vellorenderer_benchmarkRealCrowd: (a: number, b: any, c: number, d: number, e: number) => any;
    readonly vellorenderer_bodySceneCacheStats: (a: number) => any;
    readonly vellorenderer_bodySubsceneCacheCountFor: (a: number, b: number, c: number) => number;
    readonly vellorenderer_clearBodySceneCache: (a: number) => number;
    readonly vellorenderer_clearPathCache: (a: number) => void;
    readonly vellorenderer_createAtlas: (a: number, b: number, c: number) => any;
    readonly vellorenderer_createSwfSpellInstance: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_crowdAtlasInfo: (a: number) => any;
    readonly vellorenderer_crowdBakeLookSync: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: number, j: number, k: number, l: number, m: number) => number;
    readonly vellorenderer_crowdHitTest: (a: number, b: number, c: number) => number;
    readonly vellorenderer_crowdInternProf: (a: number) => any;
    readonly vellorenderer_crowdLookPatchDiag: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly vellorenderer_crowdTakePendingBakes: (a: number) => any;
    readonly vellorenderer_crowdTextureHandle: (a: number) => any;
    readonly vellorenderer_crowdUpdateFrames: (a: number, b: number, c: number) => void;
    readonly vellorenderer_crowdUpdateLooks: (a: number, b: any) => void;
    readonly vellorenderer_crowdUpdatePositions: (a: number, b: number, c: number) => void;
    readonly vellorenderer_disposeSwfSpellInstance: (a: number, b: number) => void;
    readonly vellorenderer_drainBakeTelemetry: (a: number) => any;
    readonly vellorenderer_dumpClassEnumeration: (a: number, b: number, c: number) => any;
    readonly vellorenderer_dumpSwfBundleInventory: (a: number, b: number, c: number) => any;
    readonly vellorenderer_flushFrames: (a: number, b: number) => void;
    readonly vellorenderer_freeAllTextures: (a: number) => void;
    readonly vellorenderer_freeAsset: (a: number, b: number) => void;
    readonly vellorenderer_freeRenderTexture: (a: number, b: number) => void;
    readonly vellorenderer_freeTexture: (a: number, b: number) => void;
    readonly vellorenderer_getAnimationInfo: (a: number, b: number, c: number, d: number) => any;
    readonly vellorenderer_getAnimationMeta: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_getAnimationNames: (a: number, b: number) => [number, number];
    readonly vellorenderer_getFrameSize: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly vellorenderer_gpuLastRefusedLabel: (a: number) => [number, number];
    readonly vellorenderer_gpuLedgerStats: (a: number) => [number, number];
    readonly vellorenderer_init: (a: number) => any;
    readonly vellorenderer_internCrowdLook: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly vellorenderer_listLoadedSwfBundles: (a: number) => [number, number];
    readonly vellorenderer_loadAccessorySubsceneCache: (a: number, b: number, c: number) => number;
    readonly vellorenderer_loadAsset: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_loadBodySceneCache: (a: number, b: number, c: number) => number;
    readonly vellorenderer_loadBodySubsceneCache: (a: number, b: number, c: number) => number;
    readonly vellorenderer_loadSwfBundle: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly vellorenderer_loadTileSubsceneCache: (a: number, b: number, c: number) => number;
    readonly vellorenderer_pathCacheStats: (a: number) => any;
    readonly vellorenderer_queueFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => any;
    readonly vellorenderer_realCrowdBitmap: (a: number) => any;
    readonly vellorenderer_realCrowdCaptureFlipbook: (a: number, b: number, c: number) => any;
    readonly vellorenderer_realCrowdContentRatio: (a: number) => any;
    readonly vellorenderer_realCrowdFree: (a: number) => void;
    readonly vellorenderer_realCrowdRenderBatched: (a: number, b: number, c: number) => any;
    readonly vellorenderer_realCrowdRenderRetained: (a: number, b: number, c: number) => any;
    readonly vellorenderer_realCrowdRenderRetainedFrozen: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly vellorenderer_realCrowdSetSlab: (a: number, b: number) => void;
    readonly vellorenderer_realCrowdSetup: (a: number, b: any, c: number, d: number, e: number) => any;
    readonly vellorenderer_realCrowdTick: (a: number, b: number) => any;
    readonly vellorenderer_renderAnimationStrip: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_renderFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => any;
    readonly vellorenderer_renderFrameToAtlas: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => any;
    readonly vellorenderer_renderSwfAccessoryStrip: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => any;
    readonly vellorenderer_renderSwfBodyAtlas: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => any;
    readonly vellorenderer_renderSwfBundleBatch: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_renderSwfClassAtlas: (a: number, b: number, c: number, d: number) => any;
    readonly vellorenderer_renderSwfFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_renderSwfMountTransforms: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_renderSwfRoot: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly vellorenderer_renderSwfSpellIcon: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_renderSwfSpellStrip: (a: number, b: number, c: number, d: number) => any;
    readonly vellorenderer_renderSwfStrip: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_renderSwfStripRange: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_renderSwfStripRangeAccessorized: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => any;
    readonly vellorenderer_renderSwfStripRangeAccessorizedBitmap: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number) => any;
    readonly vellorenderer_renderSwfTileDynamicStripRange: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => any;
    readonly vellorenderer_renderSwfTileStaticBase: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_renderZoneMaskFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => any;
    readonly vellorenderer_renderZoneMaskStrip: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_rustGpuByteStats: (a: number) => [number, number];
    readonly vellorenderer_rustGpuCreatedByName: (a: number, b: number) => [number, number];
    readonly vellorenderer_rustGpuObjectCounts: (a: number) => [number, number];
    readonly vellorenderer_rustGpuResetByName: (a: number) => void;
    readonly vellorenderer_rustTexturesCount: (a: number) => number;
    readonly vellorenderer_serializeAccessorySubsceneCache: (a: number, b: number, c: number) => [number, number];
    readonly vellorenderer_serializeBodySceneCache: (a: number, b: number, c: number) => [number, number];
    readonly vellorenderer_serializeBodySubsceneCache: (a: number, b: number, c: number) => [number, number];
    readonly vellorenderer_serializeTileSubsceneCache: (a: number, b: number, c: number) => [number, number];
    readonly vellorenderer_setClassAtlasBakeMode: (a: number, b: number) => void;
    readonly vellorenderer_setClassAtlasForcePerVariant: (a: number, b: number) => void;
    readonly vellorenderer_setCrowdOffThreadBake: (a: number, b: number) => void;
    readonly vellorenderer_setGpuBudgetBytes: (a: number, b: number) => void;
    readonly vellorenderer_setSwfPlayerColors: (a: number, b: number, c: number, d: number) => void;
    readonly vellorenderer_setSwfSpellHostCell: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly vellorenderer_setSwfSpellHostNumber: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly vellorenderer_slabGpuTiming: (a: number) => any;
    readonly vellorenderer_subsceneCacheBytesForBundle: (a: number, b: number, c: number) => any;
    readonly vellorenderer_swfAccessoryCanonicalAnimType: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
    readonly vellorenderer_swfActionPointFrame: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly vellorenderer_swfAnimFrameCount: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly vellorenderer_swfBodyBandInfo: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly vellorenderer_swfBundleExports: (a: number, b: number, c: number) => [number, number];
    readonly vellorenderer_swfBundleFrameRate: (a: number, b: number, c: number) => number;
    readonly vellorenderer_swfExportHasFilters: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly vellorenderer_swfRootNaturalSize: (a: number, b: number, c: number, d: number) => any;
    readonly vellorenderer_swfSpellIconNaturalSize: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly vellorenderer_swfStripBounds: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly vellorenderer_swfTileAnimKind: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly vellorenderer_tickDeferredDestroys: (a: number, b: number, c: number) => [number, number];
    readonly vellorenderer_tickSwfSpellFrame: (a: number, b: number) => any;
    readonly vellorenderer_tileSubsceneCacheCountFor: (a: number, b: number, c: number) => number;
    readonly vellorenderer_wasmHeapBytes: (a: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h97a41680667a7bc9: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h59f6a18f366ace3f: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h5fcecf7e12083474: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
