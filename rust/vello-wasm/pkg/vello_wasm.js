/* @ts-self-types="./vello_wasm.d.ts" */

/**
 * Chroma subsampling format
 * @enum {0 | 1 | 2 | 3}
 */
export const ChromaSampling = Object.freeze({
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420: 0, "0": "Cs420",
    /**
     * Horizontally subsampled.
     */
    Cs422: 1, "1": "Cs422",
    /**
     * Not subsampled.
     */
    Cs444: 2, "2": "Cs444",
    /**
     * Monochrome.
     */
    Cs400: 3, "3": "Cs400",
});

export class VelloRenderer {
    static __wrap(ptr) {
        const obj = Object.create(VelloRenderer.prototype);
        obj.__wbg_ptr = ptr;
        VelloRendererFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VelloRendererFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vellorenderer_free(ptr, 0);
    }
    /**
     * Count entries in `acc_subscenes`, optionally per-bundle.
     * @param {string | null} [bundle_filter]
     * @returns {number}
     */
    accessorySubsceneCacheCountFor(bundle_filter) {
        var ptr0 = isLikeNone(bundle_filter) ? 0 : passStringToWasm0(bundle_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_accessorySubsceneCacheCountFor(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * DIAG (Phase-3 design): for each DISTINCT look in the current crowd, bake
     * its look at every animation frame and report how much GEOMETRY changes
     * across frames. `distinctGeomHashes == 1` → path_data/draw_data are
     * frame-invariant (fully retainable: geometry resident, only transforms
     * re-upload). `> 1` → geometry changes per frame (morph shape interpolation
     * and/or structural appear/disappear) — those frames can't keep geometry
     * resident as-is. `distinctTxCounts > 1` → shapes appear/disappear (the
     * union/hide case). Requires `realCrowdSetup` first.
     * @param {number} max_looks
     * @returns {any}
     */
    analyzeFrameStability(max_looks) {
        const ret = wasm.vellorenderer_analyzeFrameStability(this.__wbg_ptr, max_looks);
        return ret;
    }
    /**
     * Batch-copy multiple textures into a destination texture. ONE queue.submit for all copies.
     * `copies` is a flat array: [src_id, dst_x, dst_y, src_id, dst_x, dst_y, ...]
     * All copies go to the same destination texture (the atlas).
     * @param {number} dst_texture_id
     * @param {Float64Array} copies
     * @returns {boolean}
     */
    batchCopy(dst_texture_id, copies) {
        const ptr0 = passArrayF64ToWasm0(copies, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_batchCopy(this.__wbg_ptr, dst_texture_id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * DIAG: the DECIDING test for the 60fps question. Pre-renders each
     * (frame, band) sub-scene ONCE at twip-identity (scale-invariant,
     * uncolored — like body_subscene_cache), then builds the N-char
     * crowd PER ITER by `scene.append`-ing those cached sub-scenes with
     * per-char world transforms (the real per-frame cost). Measures the
     * PER-FRAME build (append) cost vs the naive re-emit (19ms). If this
     * is sub-ms, Vello-direct hits 60fps; recolor is then a separate
     * post-pass. `preMs` is the one-time sub-scene bake.
     * @param {string} bundle
     * @param {string} _export
     * @param {number} n_chars
     * @param {number} target_dim
     * @param {number} iters
     * @param {number} resolution
     * @returns {any}
     */
    benchmarkBatchedAppend(bundle, _export, n_chars, target_dim, iters, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_benchmarkBatchedAppend(this.__wbg_ptr, ptr0, len0, ptr1, len1, n_chars, target_dim, iters, resolution);
        return ret;
    }
    /**
     * DIAG: "Flash model" feasibility test. Build N characters' body
     * bands (one export, frames varied, positioned in a grid) into ONE
     * Vello scene and render it to a `target_dim²` texture `iters`
     * times. Isolates the Vello RENDER cost (the crux of the "per-frame
     * Vello caps at 30fps" claim) from scene-build cost. JS measures GPU
     * wall via `onSubmittedWorkDone` after this returns.
     * @param {string} bundle
     * @param {string} _export
     * @param {number} n_chars
     * @param {number} target_dim
     * @param {number} iters
     * @param {number} resolution
     * @returns {any}
     */
    benchmarkBatchedChars(bundle, _export, n_chars, target_dim, iters, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_benchmarkBatchedChars(this.__wbg_ptr, ptr0, len0, ptr1, len1, n_chars, target_dim, iters, resolution);
        return ret;
    }
    /**
     * DIAG: REALISTIC crowd test. Renders N characters into ONE Vello
     * scene with VARIED gfx (round-robin over `body_specs`), per-char
     * RANDOM zone colours (real recolor), and `acc_per_char` accessories
     * each (round-robin over `acc_specs`). Specs are `"bundle|export"`;
     * unloaded ones are skipped. Renders `iters` times, bridges the
     * result to a bitmap for display. Answers: cost of a realistic
     * varied/colored/accessorized crowd via Vello-direct.
     * @param {string[]} body_specs
     * @param {string[]} acc_specs
     * @param {number} n_chars
     * @param {number} acc_per_char
     * @param {number} target_dim
     * @param {number} iters
     * @param {number} resolution
     * @returns {any}
     */
    benchmarkCrowdWithAcc(body_specs, acc_specs, n_chars, acc_per_char, target_dim, iters, resolution) {
        const ptr0 = passArrayJsValueToWasm0(body_specs, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(acc_specs, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_benchmarkCrowdWithAcc(this.__wbg_ptr, ptr0, len0, ptr1, len1, n_chars, acc_per_char, target_dim, iters, resolution);
        return ret;
    }
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
     * @param {any} players
     * @param {number} target_dim_max
     * @param {number} iters
     * @param {number} resolution
     * @returns {any}
     */
    benchmarkRealCrowd(players, target_dim_max, iters, resolution) {
        const ret = wasm.vellorenderer_benchmarkRealCrowd(this.__wbg_ptr, players, target_dim_max, iters, resolution);
        return ret;
    }
    /**
     * @returns {any}
     */
    bodySceneCacheStats() {
        const ret = wasm.vellorenderer_bodySceneCacheStats(this.__wbg_ptr);
        return ret;
    }
    /**
     * Count entries in `body_subscene_cache`, optionally filtered to a
     * single bundle. Surfaced for the loader-scene's progress UI so it
     * can report "X / Y subscenes ready" without invoking a heavier
     * stats call.
     * @param {string | null} [bundle_filter]
     * @returns {number}
     */
    bodySubsceneCacheCountFor(bundle_filter) {
        var ptr0 = isLikeNone(bundle_filter) ? 0 : passStringToWasm0(bundle_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_bodySubsceneCacheCountFor(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * Drop every `body_scene_cache` entry. Test/diagnostic hook for
     * validating the persist→clear→load→spawn-warm cycle. Returns the
     * number of entries cleared.
     * @returns {number}
     */
    clearBodySceneCache() {
        const ret = wasm.vellorenderer_clearBodySceneCache(this.__wbg_ptr);
        return ret >>> 0;
    }
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
    clearPathCache() {
        wasm.vellorenderer_clearPathCache(this.__wbg_ptr);
    }
    /**
     * Create an atlas texture for packing multiple character frames.
     * Returns { texture: GPUTexture, textureId: number, width, height }.
     * All characters' frames are copied into this single texture via renderFrameToAtlas.
     * @param {number} width
     * @param {number} height
     * @returns {any}
     */
    createAtlas(width, height) {
        const ret = wasm.vellorenderer_createAtlas(this.__wbg_ptr, width, height);
        return ret;
    }
    /**
     * Create a live AVM1 spell instance: allocates an `AvmRenderer`
     * whose tick state will be advanced by per-frame
     * `tickSwfSpellFrame` calls, plus a single output GPU texture sized
     * to the union of all frame bounds (so anchor + canvas stay
     * uniform across the cast). Returns the instance id JS uses to
     * drive subsequent host-var sets, ticks, and dispose. Returns 0
     * on failure.
     * @param {string} bundle
     * @param {number} resolution
     * @returns {number}
     */
    createSwfSpellInstance(bundle, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_createSwfSpellInstance(this.__wbg_ptr, ptr0, len0, resolution);
        return ret >>> 0;
    }
    /**
     * Point-in-path hit test against the last crowd tick's actors. `x`/`y` are
     * in crowd-texture pixel space; returns the front-most hit actor's index or
     * `-1` on a miss.
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    crowdHitTest(x, y) {
        const ret = wasm.vellorenderer_crowdHitTest(this.__wbg_ptr, x, y);
        return ret;
    }
    /**
     * LIVE cutover: expose the crowd target as a Pixi-adoptable `{texture: GPUTexture,
     * width, height}` (no readback — same path as `createAtlas`/strips). Pixi wraps it
     * ONCE as an `ExternalSource`; each frame `realCrowdRenderBatched` re-renders into
     * the same texture and the JS side marks the source dirty. The GPUTexture stays
     * valid while the crowd lives (retired by `realCrowdFree`).
     * @returns {any}
     */
    crowdTextureHandle() {
        const ret = wasm.vellorenderer_crowdTextureHandle(this.__wbg_ptr);
        return ret;
    }
    /**
     * LIVE cutover: set every player's current animation frame IN PLACE (flat
     * `[f0,f1,...]`, same order as `realCrowdSetup`). Switches the crowd to the
     * explicit-frame path so render tracks each player's real frame instead of a
     * global clock. The hot per-frame call alongside `crowdUpdatePositions`.
     * @param {Uint32Array} frames
     */
    crowdUpdateFrames(frames) {
        const ptr0 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.vellorenderer_crowdUpdateFrames(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * LIVE cutover: SPARSE per-player look update (anim swap / direction / colour
     * / accessory change). `updates` is a JS array of `{ i, bundle, export,
     * frameCount, fps, flipped, c1, c2, c3, acc[] }` for ONLY the players whose
     * look changed this tick — recomputes that player's cache signature in place
     * WITHOUT clearing `look_cache` (new `(sig, frame)` combos are baked lazily by
     * the next `realCrowdRenderBatched`, old entries persist for reuse). Roster
     * add/remove still requires a fresh `realCrowdSetup`.
     * @param {any} updates
     */
    crowdUpdateLooks(updates) {
        wasm.vellorenderer_crowdUpdateLooks(this.__wbg_ptr, updates);
    }
    /**
     * LIVE cutover: update player positions IN PLACE (flat `[x0,y0,x1,y1,...]`, same
     * order as `realCrowdSetup`) WITHOUT re-setup. Re-`setup` clears the look cache, so
     * per-frame movement must update positions only; the next `realCrowdRenderBatched`
     * places each player at its new x/y. The roster (player SET) must be unchanged — a
     * spawn/despawn requires a fresh `realCrowdSetup`.
     * @param {Float64Array} xy
     */
    crowdUpdatePositions(xy) {
        const ptr0 = passArrayF64ToWasm0(xy, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.vellorenderer_crowdUpdatePositions(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Free the AVM1 instance + its output GPU texture. JS must call
     * this when the cast completes; otherwise both the AvmRenderer
     * state (typically a few KB) and the texture (a few hundred KB at
     * typical spell sizes) leak for the renderer's lifetime.
     * @param {number} instance_id
     */
    disposeSwfSpellInstance(instance_id) {
        wasm.vellorenderer_disposeSwfSpellInstance(this.__wbg_ptr, instance_id);
    }
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
     * @returns {any}
     */
    drainBakeTelemetry() {
        const ret = wasm.vellorenderer_drainBakeTelemetry(this.__wbg_ptr);
        return ret;
    }
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
     * @param {string} bundle
     * @returns {any}
     */
    dumpClassEnumeration(bundle) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_dumpClassEnumeration(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
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
     * @param {string} bundle
     * @returns {any}
     */
    dumpSwfBundleInventory(bundle) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_dumpSwfBundleInventory(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Render all queued frames in a composite grid, then batch-copy to atlas.
     * 1 Vello render + 1 batch copy = 2 GPU submits total.
     * @param {number} atlas_texture_id
     */
    flushFrames(atlas_texture_id) {
        wasm.vellorenderer_flushFrames(this.__wbg_ptr, atlas_texture_id);
    }
    /**
     * Free all cached textures.
     */
    freeAllTextures() {
        wasm.vellorenderer_freeAllTextures(this.__wbg_ptr);
    }
    /**
     * Free a loaded asset.
     * @param {number} id
     */
    freeAsset(id) {
        wasm.vellorenderer_freeAsset(this.__wbg_ptr, id);
    }
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
     * @param {number} tex_id
     */
    freeRenderTexture(tex_id) {
        wasm.vellorenderer_freeRenderTexture(this.__wbg_ptr, tex_id);
    }
    /**
     * Free a rendered texture by its ID (returned from renderFrame).
     * The wgpu::Texture is removed from our HashMap and dropped, releasing
     * the reference to the underlying GPUTexture. We do NOT call tex.destroy()
     * because Pixi.js may still have pending GPU commands referencing it.
     * The browser's GC will collect the GPUTexture once all references are gone.
     * @param {number} texture_id
     */
    freeTexture(texture_id) {
        wasm.vellorenderer_freeTexture(this.__wbg_ptr, texture_id);
    }
    /**
     * Get animation info. Returns { fps, frameCount, offsetX, offsetY, trimX, trimY, ... } or null.
     * `offsetX/Y` is derived from the first frame's net offset (where Flash (0,0) actually
     * lands in the rendered texture). This avoids sub-pixel discrepancies between the SWF
     * metadata and the actual SVG content positioning that cause jitter between animations.
     * @param {number} asset_id
     * @param {string} animation
     * @returns {any}
     */
    getAnimationInfo(asset_id, animation) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_getAnimationInfo(this.__wbg_ptr, asset_id, ptr0, len0);
        return ret;
    }
    /**
     * Get per-animation uniform canvas size + anchor.
     * Returns { width, height, anchorX, anchorY } or null.
     * All frames render at this size — eliminates jitter from per-frame size variation.
     * The game engine draws the canvas at (screenX - anchorX, screenY - anchorY).
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} resolution
     * @param {Uint32Array | null} [acc_info]
     * @returns {any}
     */
    getAnimationMeta(asset_id, animation, resolution, acc_info) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(acc_info) ? 0 : passArray32ToWasm0(acc_info, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_getAnimationMeta(this.__wbg_ptr, asset_id, ptr0, len0, resolution, ptr1, len1);
        return ret;
    }
    /**
     * List animation names for an asset.
     * @param {number} asset_id
     * @returns {string[]}
     */
    getAnimationNames(asset_id) {
        const ret = wasm.vellorenderer_getAnimationNames(this.__wbg_ptr, asset_id);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Compute pixel dimensions for a frame at a given resolution.
     * Returns the **uniform** canvas size for the entire animation (not per-frame).
     * This ensures all frames of the same animation render at the same size,
     * eliminating jitter from per-frame size variation.
     * Returns [width, height].
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} _frame_index
     * @param {number} resolution
     * @returns {Uint32Array}
     */
    getFrameSize(asset_id, animation, _frame_index, resolution) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_getFrameSize(this.__wbg_ptr, asset_id, ptr0, len0, _frame_index, resolution);
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Initialize the renderer. Returns a JS object `{ renderer, adapter, device }`
     * so JS can pass `{ adapter, device }` to Pixi.js.
     * @returns {Promise<any>}
     */
    static init() {
        const ret = wasm.vellorenderer_init();
        return ret;
    }
    /**
     * List every loaded SWF bundle by the name passed to
     * `loadSwfBundle`. Used by diagnostic sweeps that need to iterate
     * the actual loaded set rather than a hand-curated list.
     * @returns {string[]}
     */
    listLoadedSwfBundles() {
        const ret = wasm.vellorenderer_listLoadedSwfBundles(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Install entries from a previously-persisted accessory
     * sub-scene blob.
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    loadAccessorySubsceneCache(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_loadAccessorySubsceneCache(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * Load a .dofasset binary. Returns true on success, false if data is invalid.
     * Never panics — invalid data is handled gracefully to avoid poisoning
     * the wasm-bindgen RefCell (which would break ALL subsequent calls).
     * @param {number} id
     * @param {Uint8Array} data
     * @returns {boolean}
     */
    loadAsset(id, data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_loadAsset(this.__wbg_ptr, id, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Install entries from a `serializeBodySceneCache` blob into
     * `body_scene_cache`. Returns the count loaded (0 on parse
     * error). Overwrites matching keys.
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    loadBodySceneCache(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_loadBodySceneCache(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
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
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    loadBodySubsceneCache(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_loadBodySubsceneCache(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * Load a SWF bundle by name (e.g. "g1", "o3", "player10"). Returns true on
     * success.
     * @param {string} name
     * @param {Uint8Array} bytes
     * @returns {boolean}
     */
    loadSwfBundle(name, bytes) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_loadSwfBundle(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * Install entries from a previously-persisted tile sub-scene
     * blob. Returns the count actually inserted.
     * @param {Uint8Array} bytes
     * @returns {number}
     */
    loadTileSubsceneCache(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_loadTileSubsceneCache(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
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
     * @returns {any}
     */
    pathCacheStats() {
        const ret = wasm.vellorenderer_pathCacheStats(this.__wbg_ptr);
        return ret;
    }
    /**
     * Queue a frame for batch rendering. Builds the Vello scene (CPU work) and stores it.
     * Returns { width, height } of the frame, or null on failure.
     * Call flushFrames() to render all queued frames in ONE GPU dispatch + copy.
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} frame_index
     * @param {number} resolution
     * @param {Uint32Array | null | undefined} colors
     * @param {Uint32Array | null | undefined} acc_info
     * @param {number} dst_x
     * @param {number} dst_y
     * @returns {any}
     */
    queueFrame(asset_id, animation, frame_index, resolution, colors, acc_info, dst_x, dst_y) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(colors) ? 0 : passArray32ToWasm0(colors, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(acc_info) ? 0 : passArray32ToWasm0(acc_info, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_queueFrame(this.__wbg_ptr, asset_id, ptr0, len0, frame_index, resolution, ptr1, len1, ptr2, len2, dst_x, dst_y);
        return ret;
    }
    /**
     * DIAG: read the animated crowd's current target texture back to an
     * ImageBitmap for display. Has a GPU readback cost — call it sparsely
     * (e.g. a few times/sec), NOT inside the measured render loop.
     * @returns {any}
     */
    realCrowdBitmap() {
        const ret = wasm.vellorenderer_realCrowdBitmap(this.__wbg_ptr);
        return ret;
    }
    /**
     * DIAG: capture `n_frames` of the animated crowd as a flipbook for
     * visual playback. Renders each anim frame (advancing by `step_ms`)
     * into its OWN target texture FIRST (no readback between renders —
     * the blit-readback poisons the next render_to_texture, so we must
     * finish all renders before reading any back), THEN reads every
     * target back to an ImageBitmap. Returns a JS array of ImageBitmaps
     * the caller can flipbook on a canvas (pure 2D, no further GPU).
     * Retained path (cached encodings + append).
     * @param {number} n_frames
     * @param {number} step_ms
     * @returns {any}
     */
    realCrowdCaptureFlipbook(n_frames, step_ms) {
        const ret = wasm.vellorenderer_realCrowdCaptureFlipbook(this.__wbg_ptr, n_frames, step_ms);
        return ret;
    }
    /**
     * DIAG: free the animated crowd (drops cached sub-scenes + target).
     * Non-poisoning content probe: copies a center region of the crowd target to a
     * MAP_READ buffer and async-maps it (event-loop-driven, NO surface present, NO
     * device.poll) to compute the fraction of sampled pixels with alpha>10. Unlike
     * `realCrowdBitmap` (surface blit) this can be called repeatedly without poisoning
     * subsequent renders. Returns a Promise<number> (-1 if no crowd). `await` it in JS.
     * @returns {Promise<any>}
     */
    realCrowdContentRatio() {
        const ret = wasm.vellorenderer_realCrowdContentRatio(this.__wbg_ptr);
        return ret;
    }
    realCrowdFree() {
        wasm.vellorenderer_realCrowdFree(this.__wbg_ptr);
    }
    /**
     * DIAG: BATCHED render — splits the Y-sorted crowd into batches of
     * `batch_size` actors (each kept under the single-scene shape
     * ceiling), renders each batch to its own texture (one Vello
     * dispatch each), then alpha-composites them back-to-front onto the
     * crowd target. This is the REAL high-count render path. Measures
     * append + per-batch GPU + composite together (call it in a loop +
     * await onSubmittedWorkDone in JS for end-to-end timing). Composites
     * into `crowd.view`, so `realCrowdBitmap` reads the result.
     * @param {number} batch_size
     * @param {number} time_ms
     * @returns {any}
     */
    realCrowdRenderBatched(batch_size, time_ms) {
        const ret = wasm.vellorenderer_realCrowdRenderBatched(this.__wbg_ptr, batch_size, time_ms);
        return ret;
    }
    /**
     * RETAINED-VELLO v1+v2 real-animation render. Y-sorted batches (z-order
     * preserved). A batch whose players are ALL length-stable renders via the
     * retained fast path: geometry resident, per-frame transform writes for every
     * player + path_data writes for morph players whose geometry frame changed, then
     * the cached recording is replayed. A batch containing a length-varying
     * (structural appear/disappear) player renders via the baseline per-frame lane.
     * Rebuild of a retained batch happens only on player-set change. Composites all
     * batches back-to-front.
     * @param {number} batch_size
     * @param {number} time_ms
     * @returns {any}
     */
    realCrowdRenderRetained(batch_size, time_ms) {
        const ret = wasm.vellorenderer_realCrowdRenderRetained(this.__wbg_ptr, batch_size, time_ms);
        return ret;
    }
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
     * @param {number} batch_size
     * @param {number} frozen_frame
     * @param {number} frame_idx
     * @param {number} move_px
     * @returns {any}
     */
    realCrowdRenderRetainedFrozen(batch_size, frozen_frame, frame_idx, move_px) {
        const ret = wasm.vellorenderer_realCrowdRenderRetainedFrozen(this.__wbg_ptr, batch_size, frozen_frame, frame_idx, move_px);
        return ret;
    }
    /**
     * Routes `realCrowdRenderBatched` through the Tier-7 slab path: every
     * unique look interned once into the GPU-resident SubLibrary, the
     * whole crowd rendered as ONE slab block straight into the crowd
     * target (no batch textures, no composite pass). Toggling either way
     * resets the retained slab state.
     * @param {boolean} enabled
     */
    realCrowdSetSlab(enabled) {
        wasm.vellorenderer_realCrowdSetSlab(this.__wbg_ptr, enabled);
    }
    /**
     * DIAG: set up the stateful ANIMATED Vello-direct crowd. Parses real
     * players (body bundle/export, frameCount, fps, colors, flipped,
     * real x/y, equipped accessories), per-bundle caches, fits a target
     * texture, and pre-emits each player's frame-0 sub-scene. `realCrowdTick`
     * then advances each player's animation and re-emits only the ones
     * whose frame changed. `players`: array of {bundle, export, frameCount,
     * fps, c1,c2,c3, flipped, x, y, acc:[{bundle,export,slot,animType}]}.
     * @param {any} players
     * @param {number} target_dim_max
     * @param {number} resolution
     * @param {boolean} retain
     * @returns {any}
     */
    realCrowdSetup(players, target_dim_max, resolution, retain) {
        const ret = wasm.vellorenderer_realCrowdSetup(this.__wbg_ptr, players, target_dim_max, resolution, retain);
        return ret;
    }
    /**
     * DIAG: advance the animated crowd to `time_ms`, re-emitting only the
     * players whose animation frame changed, then render one frame to the
     * crowd's target texture (NO readback — clean GPU timing). Returns
     * `{ reemitted, players }`.
     * @param {number} time_ms
     * @returns {any}
     */
    realCrowdTick(time_ms) {
        const ret = wasm.vellorenderer_realCrowdTick(this.__wbg_ptr, time_ms);
        return ret;
    }
    /**
     * Render ALL frames of an animation into a single horizontal strip texture.
     * Returns { texture, textureId, width, height, frameWidth, frameHeight, frameCount }.
     * JS extracts sub-rectangles: frame i is at (i * frameWidth, 0, frameWidth, frameHeight).
     * One GPU dispatch for all frames — much faster than rendering frames individually.
     * Supports accessories: pass acc_info as flat [asset_id, slot_id, ...] pairs.
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} resolution
     * @param {Uint32Array | null} [colors]
     * @param {Uint32Array | null} [acc_info]
     * @returns {any}
     */
    renderAnimationStrip(asset_id, animation, resolution, colors, acc_info) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(colors) ? 0 : passArray32ToWasm0(colors, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(acc_info) ? 0 : passArray32ToWasm0(acc_info, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderAnimationStrip(this.__wbg_ptr, asset_id, ptr0, len0, resolution, ptr1, len1, ptr2, len2);
        return ret;
    }
    /**
     * Render a frame and return the raw `GPUTexture` as a JsValue.
     * Render a frame with optional player colors [color1, color2, color3] as 0xRRGGBB.
     * Pass null/undefined for no color replacement.
     * Optional acc_info is a flat array of pairs: [asset_id, slot_id, asset_id, slot_id, ...]
     * Each accessory must be loaded via loadAsset() first. They render using the same
     * animation name and frame index as the character.
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} frame_index
     * @param {number} resolution
     * @param {Uint32Array | null} [colors]
     * @param {Uint32Array | null} [acc_info]
     * @returns {any}
     */
    renderFrame(asset_id, animation, frame_index, resolution, colors, acc_info) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(colors) ? 0 : passArray32ToWasm0(colors, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(acc_info) ? 0 : passArray32ToWasm0(acc_info, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderFrame(this.__wbg_ptr, asset_id, ptr0, len0, frame_index, resolution, ptr1, len1, ptr2, len2);
        return ret;
    }
    /**
     * Render a frame and copy it into a slot of an atlas texture.
     * Returns { width, height } of the rendered frame, or null on failure.
     * dst_x/dst_y are pixel coordinates in the atlas.
     * @param {number} atlas_texture_id
     * @param {number} dst_x
     * @param {number} dst_y
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} frame_index
     * @param {number} resolution
     * @param {Uint32Array | null} [colors]
     * @param {Uint32Array | null} [acc_info]
     * @param {number | null} [slot_w]
     * @param {number | null} [slot_h]
     * @returns {any}
     */
    renderFrameToAtlas(atlas_texture_id, dst_x, dst_y, asset_id, animation, frame_index, resolution, colors, acc_info, slot_w, slot_h) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(colors) ? 0 : passArray32ToWasm0(colors, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(acc_info) ? 0 : passArray32ToWasm0(acc_info, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderFrameToAtlas(this.__wbg_ptr, atlas_texture_id, dst_x, dst_y, asset_id, ptr0, len0, frame_index, resolution, ptr1, len1, ptr2, len2, isLikeNone(slot_w) ? Number.MAX_SAFE_INTEGER : (slot_w) >>> 0, isLikeNone(slot_h) ? Number.MAX_SAFE_INTEGER : (slot_h) >>> 0);
        return ret;
    }
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
     * @param {string} acc_bundle
     * @param {string} acc_export
     * @param {number} slot
     * @param {number} anim_type
     * @param {string} dir
     * @param {string} side
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfAccessoryStrip(acc_bundle, acc_export, slot, anim_type, dir, side, resolution) {
        const ptr0 = passStringToWasm0(acc_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(acc_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(side, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfAccessoryStrip(this.__wbg_ptr, ptr0, len0, ptr1, len1, slot, anim_type, ptr2, len2, ptr3, len3, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} start
     * @param {number} count
     * @param {number} total_frame_count
     * @param {number} resolution
     * @param {boolean} apply_b_fix
     * @param {boolean} hat_equipped
     * @returns {any}
     */
    renderSwfBodyAtlas(bundle, _export, start, count, total_frame_count, resolution, apply_b_fix, hat_equipped) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfBodyAtlas(this.__wbg_ptr, ptr0, len0, ptr1, len1, start, count, total_frame_count, resolution, apply_b_fix, hat_equipped);
        return ret;
    }
    /**
     * Render multiple exports of ONE bundle at the SAME frame in a single
     * Vello dispatch — used to collapse tile prefetch from N dispatches
     * (one per unique tile) to 1 dispatch per bundle in the map. Tiles are
     * shelf-packed into a composite texture; the JS caller slices per-tile
     * sub-rectangles via the returned `items*` parallel arrays.
     *
     * Exports that fail to look up or have degenerate bounds are encoded as
     * `itemValid[i] = 0` with zero geometry; valid items get `itemValid[i] = 1`.
     * @param {string} bundle
     * @param {string[]} exports
     * @param {number} frame
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfBundleBatch(bundle, exports, frame, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(exports, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfBundleBatch(this.__wbg_ptr, ptr0, len0, ptr1, len1, frame, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfClassAtlas(bundle, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfClassAtlas(this.__wbg_ptr, ptr0, len0, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} frame
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfFrame(bundle, _export, frame, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfFrame(this.__wbg_ptr, ptr0, len0, ptr1, len1, frame, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} start
     * @param {number} count
     * @param {boolean} apply_b_fix
     * @param {number} max_slot
     * @returns {any}
     */
    renderSwfMountTransforms(bundle, _export, start, count, apply_b_fix, max_slot) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfMountTransforms(this.__wbg_ptr, ptr0, len0, ptr1, len1, start, count, apply_b_fix, max_slot);
        return ret;
    }
    /**
     * Render the SWF's ROOT timeline (the main movie stage) at a given
     * frame. Used for SWFs without named exports — artwork/big/{gfxId}.swf
     * and spell icons place their visible content directly on the root
     * stage instead of declaring named exports. Honors `swf_player_colors`
     * for portraits that carry the canonical `stringCourseColor` zones.
     * @param {string} bundle
     * @param {number} frame
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfRoot(bundle, frame, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfRoot(this.__wbg_ptr, ptr0, len0, frame, resolution);
        return ret;
    }
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
     * @param {string} back_bundle
     * @param {string} up_bundle
     * @param {number} bc_rgb
     * @param {number} fc_rgb
     * @param {number} pc_rgb
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfSpellIcon(back_bundle, up_bundle, bc_rgb, fc_rgb, pc_rgb, resolution) {
        const ptr0 = passStringToWasm0(back_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(up_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfSpellIcon(this.__wbg_ptr, ptr0, len0, ptr1, len1, bc_rgb, fc_rgb, pc_rgb, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfSpellStrip(bundle, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfSpellStrip(this.__wbg_ptr, ptr0, len0, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} requested_frame_count
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfStrip(bundle, _export, requested_frame_count, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfStrip(this.__wbg_ptr, ptr0, len0, ptr1, len1, requested_frame_count, resolution);
        return ret;
    }
    /**
     * @param {string} bundle
     * @param {string} _export
     * @param {number} start
     * @param {number} count
     * @param {number} total_frame_count
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfStripRange(bundle, _export, start, count, total_frame_count, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfStripRange(this.__wbg_ptr, ptr0, len0, ptr1, len1, start, count, total_frame_count, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} start
     * @param {number} count
     * @param {number} total_frame_count
     * @param {number} resolution
     * @param {Uint32Array} acc_slots
     * @param {string[]} acc_bundles
     * @param {string[]} acc_exports
     * @param {Uint32Array} acc_anim_types
     * @param {string} char_dir_suffix
     * @param {boolean} apply_b_fix
     * @returns {any}
     */
    renderSwfStripRangeAccessorized(bundle, _export, start, count, total_frame_count, resolution, acc_slots, acc_bundles, acc_exports, acc_anim_types, char_dir_suffix, apply_b_fix) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(acc_slots, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(acc_bundles, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayJsValueToWasm0(acc_exports, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArray32ToWasm0(acc_anim_types, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(char_dir_suffix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfStripRangeAccessorized(this.__wbg_ptr, ptr0, len0, ptr1, len1, start, count, total_frame_count, resolution, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, apply_b_fix);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} start
     * @param {number} count
     * @param {number} total_frame_count
     * @param {number} resolution
     * @param {Uint32Array} acc_slots
     * @param {string[]} acc_bundles
     * @param {string[]} acc_exports
     * @param {Uint32Array} acc_anim_types
     * @param {string} char_dir_suffix
     * @param {boolean} apply_b_fix
     * @returns {any}
     */
    renderSwfStripRangeAccessorizedBitmap(bundle, _export, start, count, total_frame_count, resolution, acc_slots, acc_bundles, acc_exports, acc_anim_types, char_dir_suffix, apply_b_fix) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(acc_slots, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(acc_bundles, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayJsValueToWasm0(acc_exports, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArray32ToWasm0(acc_anim_types, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passStringToWasm0(char_dir_suffix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len6 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfStripRangeAccessorizedBitmap(this.__wbg_ptr, ptr0, len0, ptr1, len1, start, count, total_frame_count, resolution, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, apply_b_fix);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} start
     * @param {number} count
     * @param {number} total_frame_count
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfTileDynamicStripRange(bundle, _export, start, count, total_frame_count, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfTileDynamicStripRange(this.__wbg_ptr, ptr0, len0, ptr1, len1, start, count, total_frame_count, resolution);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @param {number} total_frame_count
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfTileStaticBase(bundle, _export, total_frame_count, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfTileStaticBase(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_frame_count, resolution);
        return ret;
    }
    /**
     * Render a single zone mask frame. Returns { texture, textureId, width, height }.
     * Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} frame_index
     * @param {number} resolution
     * @param {Uint32Array | null} [acc_info]
     * @returns {any}
     */
    renderZoneMaskFrame(asset_id, animation, frame_index, resolution, acc_info) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(acc_info) ? 0 : passArray32ToWasm0(acc_info, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderZoneMaskFrame(this.__wbg_ptr, asset_id, ptr0, len0, frame_index, resolution, ptr1, len1);
        return ret;
    }
    /**
     * Render a zone mask strip: same layout as renderAnimationStrip but with
     * zone marker colors (R=zone1, G=zone2, B=zone3) and opaque black for non-zone.
     * Used alongside the base strip for GPU color replacement without item bleed.
     * Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
     * @param {number} asset_id
     * @param {string} animation
     * @param {number} resolution
     * @param {Uint32Array | null} [acc_info]
     * @returns {any}
     */
    renderZoneMaskStrip(asset_id, animation, resolution, acc_info) {
        const ptr0 = passStringToWasm0(animation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(acc_info) ? 0 : passArray32ToWasm0(acc_info, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderZoneMaskStrip(this.__wbg_ptr, asset_id, ptr0, len0, resolution, ptr1, len1);
        return ret;
    }
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
     * @returns {Float64Array}
     */
    rustGpuByteStats() {
        const ret = wasm.vellorenderer_rustGpuByteStats(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
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
     * @returns {Float64Array}
     */
    rustGpuObjectCounts() {
        const ret = wasm.vellorenderer_rustGpuObjectCounts(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Diagnostics: how many `wgpu::Texture`s we hold in
     * `self.textures` (every render target the Vello side has
     * outstanding). Useful for cross-checking the JS-side
     * `liveRenderTextureIds` set.
     * @returns {number}
     */
    rustTexturesCount() {
        const ret = wasm.vellorenderer_rustTexturesCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Serialize `acc_subscenes` to a `VSC2` blob suitable for IDB
     * persistence. Same wire format as the body cache, tagged with
     * `CacheId::Accessory`.
     * @param {string | null} [bundle_filter]
     * @returns {Uint8Array | undefined}
     */
    serializeAccessorySubsceneCache(bundle_filter) {
        var ptr0 = isLikeNone(bundle_filter) ? 0 : passStringToWasm0(bundle_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_serializeAccessorySubsceneCache(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * Serialize `body_scene_cache` (the COMPOSED per-variant body
     * atlas scenes) to a `VSC2` blob. This is the cache the
     * per-variant SPAWN path (`render_swf_body_atlas`) actually reads
     * — persisting it is what warms a cold 250-actor map entry
     * (`serializeBodySubsceneCache` persists a DIFFERENT cache the
     * spawn never touches). Scenes are scale-baked, so the blob is
     * per-resolution; the caller keys IDB rows by resolution.
     * @param {string | null} [bundle_filter]
     * @returns {Uint8Array | undefined}
     */
    serializeBodySceneCache(bundle_filter) {
        var ptr0 = isLikeNone(bundle_filter) ? 0 : passStringToWasm0(bundle_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_serializeBodySceneCache(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
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
     * @param {string | null} [bundle_filter]
     * @returns {Uint8Array | undefined}
     */
    serializeBodySubsceneCache(bundle_filter) {
        var ptr0 = isLikeNone(bundle_filter) ? 0 : passStringToWasm0(bundle_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_serializeBodySubsceneCache(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
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
     * @param {string | null} [bundle_filter]
     * @returns {Uint8Array | undefined}
     */
    serializeTileSubsceneCache(bundle_filter) {
        var ptr0 = isLikeNone(bundle_filter) ? 0 : passStringToWasm0(bundle_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_serializeTileSubsceneCache(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
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
     * @param {number} mode
     */
    setClassAtlasBakeMode(mode) {
        wasm.vellorenderer_setClassAtlasBakeMode(this.__wbg_ptr, mode);
    }
    /**
     * Legacy A/B toggle. `true` → force per-variant (mode 1);
     * `false` → force per-page (mode 2). Prefer
     * `setClassAtlasBakeMode(0)` to restore AUTO.
     * @param {boolean} force
     */
    setClassAtlasForcePerVariant(force) {
        wasm.vellorenderer_setClassAtlasForcePerVariant(this.__wbg_ptr, force);
    }
    /**
     * Set the player's three zone colours used by the SWF render path.
     * Each value is `0xRRGGBB`; pass `0` to leave that zone untinted.
     * Mirrors what the dofasset path does via `build_color_replacements`
     * — but applied at render time directly to the SWF, with no bake.
     * Call before `renderSwfFrame` for player/character sprites.
     * @param {number} c1
     * @param {number} c2
     * @param {number} c3
     */
    setSwfPlayerColors(c1, c2, c3) {
        wasm.vellorenderer_setSwfPlayerColors(this.__wbg_ptr, c1, c2, c3);
    }
    /**
     * Inject a `{x, y}` host-var (typically `cellFrom` / `cellTo`) into
     * the spell's AVM1 root clip. Must be called before the first
     * `tickSwfSpellFrame` for the values to land on `_parent.cellFrom.x`
     * lookups in AS2.
     * @param {number} instance_id
     * @param {string} name
     * @param {number} x
     * @param {number} y
     */
    setSwfSpellHostCell(instance_id, name, x, y) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.vellorenderer_setSwfSpellHostCell(this.__wbg_ptr, instance_id, ptr0, len0, x, y);
    }
    /**
     * Inject a numeric host-var (typically `level` or `angle`) into the
     * spell's AVM1 root clip.
     * @param {number} instance_id
     * @param {string} name
     * @param {number} value
     */
    setSwfSpellHostNumber(instance_id, name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.vellorenderer_setSwfSpellHostNumber(this.__wbg_ptr, instance_id, ptr0, len0, value);
    }
    /**
     * Per-pass GPU timings of the last slab recording (gpu-timing builds
     * only; `null` otherwise or until the first readback completes).
     * @returns {any}
     */
    slabGpuTiming() {
        const ret = wasm.vellorenderer_slabGpuTiming(this.__wbg_ptr);
        return ret;
    }
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
     * @param {string} bundle
     * @returns {any}
     */
    subsceneCacheBytesForBundle(bundle) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_subsceneCacheBytesForBundle(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
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
     * @param {string} acc_bundle
     * @param {string} acc_export
     * @param {number} slot
     * @param {string} dir
     * @param {string} side
     * @param {number} anim_type
     * @returns {number}
     */
    swfAccessoryCanonicalAnimType(acc_bundle, acc_export, slot, dir, side, anim_type) {
        const ptr0 = passStringToWasm0(acc_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(acc_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(side, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfAccessoryCanonicalAnimType(this.__wbg_ptr, ptr0, len0, ptr1, len1, slot, ptr2, len2, ptr3, len3, anim_type);
        return ret >>> 0;
    }
    /**
     * this export — `walkR` is a 1-frame wrapper around the real animation,
     * so JS needs the inner count to drive the ticker.
     * @param {string} bundle
     * @param {string} _export
     * @returns {number}
     */
    swfAnimFrameCount(bundle, _export) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfAnimFrameCount(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret >>> 0;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @returns {any}
     */
    swfBodyBandInfo(bundle, _export) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfBodyBandInfo(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * Enumerate every named export in a loaded SWF bundle. Used by
     * the stress test (and any other "all available accessories"
     * caller) to build content pools dynamically from what's actually
     * loaded instead of relying on a hand-curated list. Returns an
     * empty array if the bundle isn't loaded.
     * @param {string} bundle
     * @returns {string[]}
     */
    swfBundleExports(bundle) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfBundleExports(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Frames-per-second from the SWF header. Bundles vary: g1/g2 = 12,
     * o1/o2/o4/o5/o6/o7/o10/o12 = 60, o3/o8/o9/o11 = 40. The JS tile
     * ticker reads this per-bundle so an o1 building animates at the
     * 60 fps it was authored for instead of a hardcoded 24 fps that
     * runs everything at 0.4× speed.
     * @param {string} bundle
     * @returns {number}
     */
    swfBundleFrameRate(bundle) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfBundleFrameRate(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * True if this export's symbol tree contains any placement with filters
     * (drop shadow / glow / blur / color matrix). Filter-bearing tiles must
     * be rendered individually, not in `renderSwfBundleBatch`, because the
     * halo fallback path (`apply_halo`) emits 5–9 extra symbol renders per
     * filter into the active scene; piling many filter-bearing tiles into
     * one composite scene exceeds Vello's tile encoder threshold and
     * causes silent stroke drops (sprites visibly missing). CPU-only walk
     * of the sprite tree, recurses 5 levels deep — cheap.
     * @param {string} bundle
     * @param {string} _export
     * @returns {boolean}
     */
    swfExportHasFilters(bundle, _export) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfExportHasFilters(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * Pure-bounds probe for an SWF root timeline. Returns
     * `{width, height}` at resolution 1 without touching the GPU.
     * Used by the fighter-portrait renderer (banner artworks) to
     * compute the natural long-edge before allocating a target
     * canvas. Returns NULL on missing bundle or degenerate bounds.
     * @param {string} bundle
     * @param {number} frame
     * @returns {any}
     */
    swfRootNaturalSize(bundle, frame) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfRootNaturalSize(this.__wbg_ptr, ptr0, len0, frame);
        return ret;
    }
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
     * @param {string} back_bundle
     * @param {string} up_bundle
     * @returns {any}
     */
    swfSpellIconNaturalSize(back_bundle, up_bundle) {
        const ptr0 = passStringToWasm0(back_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(up_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfSpellIconNaturalSize(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * Query the cached strip bounds for an export at a given total
     * frame count, populating the cache on miss. Returns
     * `{minXTwip, minYTwip, maxXTwip, maxYTwip, animEnd}` in twip
     * units (caller multiplies by `resolution / 20.0` to get pixels)
     * or `null` on failure. Useful for callers that want to size
     * canvases / ExternalSources without doing a render dispatch.
     * @param {string} bundle
     * @param {string} _export
     * @param {number} total_frame_count
     * @returns {any}
     */
    swfStripBounds(bundle, _export, total_frame_count) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_swfStripBounds(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_frame_count);
        return ret;
    }
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
     * @param {string} bundle
     * @param {string} _export
     * @returns {string}
     */
    swfTileAnimKind(bundle, _export) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(_export, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.vellorenderer_swfTileAnimKind(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
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
     * @param {number} min_age_frames
     * @param {number} max_destroys_per_tick
     * @returns {Uint32Array}
     */
    tickDeferredDestroys(min_age_frames, max_destroys_per_tick) {
        const ret = wasm.vellorenderer_tickDeferredDestroys(this.__wbg_ptr, min_age_frames, max_destroys_per_tick);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
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
     * @param {number} instance_id
     * @returns {any}
     */
    tickSwfSpellFrame(instance_id) {
        const ret = wasm.vellorenderer_tickSwfSpellFrame(this.__wbg_ptr, instance_id);
        return ret;
    }
    /**
     * Count entries in `tile_subscenes`, optionally per-bundle. Same
     * usage as the body variant.
     * @param {string | null} [bundle_filter]
     * @returns {number}
     */
    tileSubsceneCacheCountFor(bundle_filter) {
        var ptr0 = isLikeNone(bundle_filter) ? 0 : passStringToWasm0(bundle_filter, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_tileSubsceneCacheCountFor(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * Diagnostics: WASM linear-memory size in bytes. Tracks how
     * much memory the Rust side itself is consuming (excluding GPU
     * resources, which live in the browser GPU process).
     * @returns {number}
     */
    wasmHeapBytes() {
        const ret = wasm.vellorenderer_wasmHeapBytes(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) VelloRenderer.prototype[Symbol.dispose] = VelloRenderer.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Window_5bb26bc95d054384: function(arg0) {
            const ret = arg0.Window;
            return ret;
        },
        __wbg_WorkerGlobalScope_866db36eb93893fe: function(arg0) {
            const ret = arg0.WorkerGlobalScope;
            return ret;
        },
        __wbg___wbindgen_boolean_get_2304fb8c853028c8: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_edece8177ad01481: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_falsy_402d3af0d5f09bc6: function(arg0) {
            const ret = !arg0;
            return ret;
        },
        __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_2042690d351e14f0: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_number_get_f73a1244370fcc2c: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_d109740c0d18f4d7: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_3fa391f3fcdb55f8: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_beginComputePass_31742703ea08718a: function(arg0, arg1) {
            const ret = arg0.beginComputePass(arg1);
            return ret;
        },
        __wbg_beginRenderPass_b6be55dca13d3752: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.beginRenderPass(arg1);
            return ret;
        }, arguments); },
        __wbg_buffer_8d6798e32d1afd34: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_call_dfde26266607c996: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_clearBuffer_1d2fa28049240bde: function(arg0, arg1, arg2) {
            arg0.clearBuffer(arg1, arg2);
        },
        __wbg_clearBuffer_591d8dce25a4a8fa: function(arg0, arg1, arg2, arg3) {
            arg0.clearBuffer(arg1, arg2, arg3);
        },
        __wbg_configure_3800e43cc1d4df6c: function() { return handleError(function (arg0, arg1) {
            arg0.configure(arg1);
        }, arguments); },
        __wbg_copyBufferToBuffer_5473c4c6a0f798fc: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.copyBufferToBuffer(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbg_copyTextureToBuffer_496aea3084e74e75: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.copyTextureToBuffer(arg1, arg2, arg3);
        }, arguments); },
        __wbg_copyTextureToTexture_c078f6d44429d14d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.copyTextureToTexture(arg1, arg2, arg3);
        }, arguments); },
        __wbg_createBindGroupLayout_38abd4e4c5dded7c: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createBindGroupLayout(arg1);
            return ret;
        }, arguments); },
        __wbg_createBindGroup_dd602247ba7de53f: function(arg0, arg1) {
            const ret = arg0.createBindGroup(arg1);
            return ret;
        },
        __wbg_createBuffer_3fce72a987f07f6a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createBuffer(arg1);
            return ret;
        }, arguments); },
        __wbg_createCommandEncoder_9b0d0f644b01b53d: function(arg0, arg1) {
            const ret = arg0.createCommandEncoder(arg1);
            return ret;
        },
        __wbg_createComputePipeline_d936327d73af6006: function(arg0, arg1) {
            const ret = arg0.createComputePipeline(arg1);
            return ret;
        },
        __wbg_createPipelineLayout_10a02d78a5e801aa: function(arg0, arg1) {
            const ret = arg0.createPipelineLayout(arg1);
            return ret;
        },
        __wbg_createRenderPipeline_f33944b9347badf7: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createRenderPipeline(arg1);
            return ret;
        }, arguments); },
        __wbg_createSampler_dfafeaada8a50f77: function(arg0, arg1) {
            const ret = arg0.createSampler(arg1);
            return ret;
        },
        __wbg_createShaderModule_c951549f9d218b6a: function(arg0, arg1) {
            const ret = arg0.createShaderModule(arg1);
            return ret;
        },
        __wbg_createTexture_7de0f1ac17578a0c: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createTexture(arg1);
            return ret;
        }, arguments); },
        __wbg_createView_ad451ea74ed4172f: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createView(arg1);
            return ret;
        }, arguments); },
        __wbg_destroy_5c63d60a4ce171f5: function(arg0) {
            arg0.destroy();
        },
        __wbg_destroy_cc5bf33a04815475: function(arg0) {
            arg0.destroy();
        },
        __wbg_dispatchWorkgroupsIndirect_0b5aa70af5409bf1: function(arg0, arg1, arg2) {
            arg0.dispatchWorkgroupsIndirect(arg1, arg2);
        },
        __wbg_dispatchWorkgroups_84e3afede9542ffe: function(arg0, arg1, arg2, arg3) {
            arg0.dispatchWorkgroups(arg1 >>> 0, arg2 >>> 0, arg3 >>> 0);
        },
        __wbg_draw_58cc6aabf299781c: function(arg0, arg1, arg2, arg3, arg4) {
            arg0.draw(arg1 >>> 0, arg2 >>> 0, arg3 >>> 0, arg4 >>> 0);
        },
        __wbg_end_39838302f918fcd7: function(arg0) {
            arg0.end();
        },
        __wbg_end_df1851506654a0d6: function(arg0) {
            arg0.end();
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_features_b943826ea0734d5b: function(arg0) {
            const ret = arg0.features;
            return ret;
        },
        __wbg_finish_1f441b2d9fcf60d0: function(arg0, arg1) {
            const ret = arg0.finish(arg1);
            return ret;
        },
        __wbg_finish_d4f7f2d108f44fc0: function(arg0) {
            const ret = arg0.finish();
            return ret;
        },
        __wbg_from_fa561fa561dc8031: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_getContext_47ea64e14d931e3e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getContext(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getCurrentTexture_66ae9639eac28f8b: function() { return handleError(function (arg0) {
            const ret = arg0.getCurrentTexture();
            return ret;
        }, arguments); },
        __wbg_getMappedRange_1197a8c58eb0add9: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getMappedRange(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_get_98fdf51d029a75eb: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_dcf82ab8aad1a593: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_gpu_0d39e2c1a52c373e: function(arg0) {
            const ret = arg0.gpu;
            return ret;
        },
        __wbg_has_bc6cd87d7cf293b7: function(arg0, arg1, arg2) {
            const ret = arg0.has(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_instanceof_GpuAdapter_b2c1300e425af95c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof GPUAdapter;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_GpuCanvasContext_c9b75b4b7dc7555e: function(arg0) {
            let result;
            try {
                result = arg0 instanceof GPUCanvasContext;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_label_dfb771c49b8a7920: function(arg0, arg1) {
            const ret = arg1.label;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_length_13e61aa81636ec86: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_2591a0f4f659a55c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_56fcd3e2b7e0299d: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_limits_0f372ba0de53c8fa: function(arg0) {
            const ret = arg0.limits;
            return ret;
        },
        __wbg_log_9e99203aee8a50b0: function(arg0, arg1) {
            console.log(getStringFromWasm0(arg0, arg1));
        },
        __wbg_log_eb752234eec406d1: function(arg0) {
            console.log(arg0);
        },
        __wbg_mapAsync_7767a9f33865861e: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.mapAsync(arg1 >>> 0, arg2, arg3);
            return ret;
        },
        __wbg_maxBindGroups_55dde09639db12ab: function(arg0) {
            const ret = arg0.maxBindGroups;
            return ret;
        },
        __wbg_maxBindingsPerBindGroup_2835632451416187: function(arg0) {
            const ret = arg0.maxBindingsPerBindGroup;
            return ret;
        },
        __wbg_maxBufferSize_05d399497c03b182: function(arg0) {
            const ret = arg0.maxBufferSize;
            return ret;
        },
        __wbg_maxColorAttachmentBytesPerSample_69fc9671bd9e83cb: function(arg0) {
            const ret = arg0.maxColorAttachmentBytesPerSample;
            return ret;
        },
        __wbg_maxColorAttachments_50f9613d30a909ed: function(arg0) {
            const ret = arg0.maxColorAttachments;
            return ret;
        },
        __wbg_maxComputeInvocationsPerWorkgroup_0db49fa67b3ed3b2: function(arg0) {
            const ret = arg0.maxComputeInvocationsPerWorkgroup;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeX_f4010b0a3f57f191: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeX;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeY_537dd88bea1134a2: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeY;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeZ_12ddaf5bc7c07f6c: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeZ;
            return ret;
        },
        __wbg_maxComputeWorkgroupStorageSize_863c259d2cb0a769: function(arg0) {
            const ret = arg0.maxComputeWorkgroupStorageSize;
            return ret;
        },
        __wbg_maxComputeWorkgroupsPerDimension_a29df48716e5e15f: function(arg0) {
            const ret = arg0.maxComputeWorkgroupsPerDimension;
            return ret;
        },
        __wbg_maxDynamicStorageBuffersPerPipelineLayout_59546d50fbd3f282: function(arg0) {
            const ret = arg0.maxDynamicStorageBuffersPerPipelineLayout;
            return ret;
        },
        __wbg_maxDynamicUniformBuffersPerPipelineLayout_205b4e7a23eca1a7: function(arg0) {
            const ret = arg0.maxDynamicUniformBuffersPerPipelineLayout;
            return ret;
        },
        __wbg_maxSampledTexturesPerShaderStage_f3b7cf6a46dd4e89: function(arg0) {
            const ret = arg0.maxSampledTexturesPerShaderStage;
            return ret;
        },
        __wbg_maxSamplersPerShaderStage_4c8b533d64aaa111: function(arg0) {
            const ret = arg0.maxSamplersPerShaderStage;
            return ret;
        },
        __wbg_maxStorageBufferBindingSize_d9bcab29fa726c41: function(arg0) {
            const ret = arg0.maxStorageBufferBindingSize;
            return ret;
        },
        __wbg_maxStorageBuffersPerShaderStage_702a6bd12350075d: function(arg0) {
            const ret = arg0.maxStorageBuffersPerShaderStage;
            return ret;
        },
        __wbg_maxStorageTexturesPerShaderStage_d7c93fd5510086ee: function(arg0) {
            const ret = arg0.maxStorageTexturesPerShaderStage;
            return ret;
        },
        __wbg_maxTextureArrayLayers_02a20ef4b596a9ad: function(arg0) {
            const ret = arg0.maxTextureArrayLayers;
            return ret;
        },
        __wbg_maxTextureDimension1D_c4c3a0ab186f5d87: function(arg0) {
            const ret = arg0.maxTextureDimension1D;
            return ret;
        },
        __wbg_maxTextureDimension2D_f979c4fc87e3b3aa: function(arg0) {
            const ret = arg0.maxTextureDimension2D;
            return ret;
        },
        __wbg_maxTextureDimension3D_d3425844dc223af1: function(arg0) {
            const ret = arg0.maxTextureDimension3D;
            return ret;
        },
        __wbg_maxUniformBufferBindingSize_84331a664e6da5ed: function(arg0) {
            const ret = arg0.maxUniformBufferBindingSize;
            return ret;
        },
        __wbg_maxUniformBuffersPerShaderStage_8209dfce1612ddb7: function(arg0) {
            const ret = arg0.maxUniformBuffersPerShaderStage;
            return ret;
        },
        __wbg_maxVertexAttributes_8156247eccc99918: function(arg0) {
            const ret = arg0.maxVertexAttributes;
            return ret;
        },
        __wbg_maxVertexBufferArrayStride_a6be7dd661b61c6a: function(arg0) {
            const ret = arg0.maxVertexBufferArrayStride;
            return ret;
        },
        __wbg_maxVertexBuffers_71ca56afa9dd98cd: function(arg0) {
            const ret = arg0.maxVertexBuffers;
            return ret;
        },
        __wbg_minStorageBufferOffsetAlignment_10b0921761b618e7: function(arg0) {
            const ret = arg0.minStorageBufferOffsetAlignment;
            return ret;
        },
        __wbg_minUniformBufferOffsetAlignment_afc057dd6b1648ec: function(arg0) {
            const ret = arg0.minUniformBufferOffsetAlignment;
            return ret;
        },
        __wbg_navigator_3334c390f542c642: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_navigator_3db7ba343e05d4d1: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_new_02d162bc6cf02f60: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_310879b66b6e95e1: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_439823ec67f1ec48: function() { return handleError(function (arg0, arg1) {
            const ret = new OffscreenCanvas(arg0 >>> 0, arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_new_from_slice_269e35316ed2d061: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_c072c4ce9a2a0cdf: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h59f6a18f366ace3f(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_byte_offset_and_length_a87e79143162d67f: function(arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_new_with_length_1278c16a5c5b497f: function(arg0) {
            const ret = new Float64Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_58dc420af34edb59: function(arg0) {
            const ret = new Float32Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_99887c91eae4abab: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_f128f2c16ad4f906: function(arg0) {
            const ret = new Uint32Array(arg0 >>> 0);
            return ret;
        },
        __wbg_now_81363d44c96dd239: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_now_e7c6795a7f81e10f: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_onSubmittedWorkDone_a33e32762de21b3d: function(arg0) {
            const ret = arg0.onSubmittedWorkDone();
            return ret;
        },
        __wbg_performance_3fcf6e32a7e1ed0a: function(arg0) {
            const ret = arg0.performance;
            return ret;
        },
        __wbg_prototypesetcall_5f9bdc8d75e07276: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_b77c476b01548d0a: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_78d584b53af520f5: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_b39ea83c7f01971a: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_queue_451a2aa83c786578: function(arg0) {
            const ret = arg0.queue;
            return ret;
        },
        __wbg_requestAdapter_3cddf363b0bc9baf: function(arg0, arg1) {
            const ret = arg0.requestAdapter(arg1);
            return ret;
        },
        __wbg_requestDevice_7dd355306bacbcd8: function(arg0, arg1) {
            const ret = arg0.requestDevice(arg1);
            return ret;
        },
        __wbg_resolve_d17db9352f5a220e: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_setBindGroup_3fecca142efa3bcf: function(arg0, arg1, arg2) {
            arg0.setBindGroup(arg1 >>> 0, arg2);
        },
        __wbg_setBindGroup_af7eca394a335db6: function(arg0, arg1, arg2) {
            arg0.setBindGroup(arg1 >>> 0, arg2);
        },
        __wbg_setPipeline_5cbb15c634c129f9: function(arg0, arg1) {
            arg0.setPipeline(arg1);
        },
        __wbg_setPipeline_fb3b65583e919c05: function(arg0, arg1) {
            arg0.setPipeline(arg1);
        },
        __wbg_set_24d0fa9e104112f9: function(arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbg_set_37221b90dcdc9a98: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_5d860a0c0949a838: function(arg0, arg1, arg2) {
            arg0.set(getArrayF32FromWasm0(arg1, arg2));
        },
        __wbg_set_a0e911be3da02782: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_a_c6ed845ffb46afcc: function(arg0, arg1) {
            arg0.a = arg1;
        },
        __wbg_set_access_9d39f60326d67278: function(arg0, arg1) {
            arg0.access = __wbindgen_enum_GpuStorageTextureAccess[arg1];
        },
        __wbg_set_address_mode_u_8c8aaf2ccebb3e8d: function(arg0, arg1) {
            arg0.addressModeU = __wbindgen_enum_GpuAddressMode[arg1];
        },
        __wbg_set_address_mode_v_252818714ab5937f: function(arg0, arg1) {
            arg0.addressModeV = __wbindgen_enum_GpuAddressMode[arg1];
        },
        __wbg_set_address_mode_w_d617929f92a5b8cc: function(arg0, arg1) {
            arg0.addressModeW = __wbindgen_enum_GpuAddressMode[arg1];
        },
        __wbg_set_alpha_a3317d40d97c514e: function(arg0, arg1) {
            arg0.alpha = arg1;
        },
        __wbg_set_alpha_mode_1ae7e0aa38a8eba8: function(arg0, arg1) {
            arg0.alphaMode = __wbindgen_enum_GpuCanvasAlphaMode[arg1];
        },
        __wbg_set_alpha_to_coverage_enabled_0c11d91caea2b92d: function(arg0, arg1) {
            arg0.alphaToCoverageEnabled = arg1 !== 0;
        },
        __wbg_set_array_layer_count_83a40d42f8858bba: function(arg0, arg1) {
            arg0.arrayLayerCount = arg1 >>> 0;
        },
        __wbg_set_array_stride_34be696a5e66eb16: function(arg0, arg1) {
            arg0.arrayStride = arg1;
        },
        __wbg_set_aspect_9d30d9ca40403001: function(arg0, arg1) {
            arg0.aspect = __wbindgen_enum_GpuTextureAspect[arg1];
        },
        __wbg_set_aspect_f231ddb55e5c30eb: function(arg0, arg1) {
            arg0.aspect = __wbindgen_enum_GpuTextureAspect[arg1];
        },
        __wbg_set_attributes_02005a0f12df5908: function(arg0, arg1) {
            arg0.attributes = arg1;
        },
        __wbg_set_b_f55b6a25fa56cccd: function(arg0, arg1) {
            arg0.b = arg1;
        },
        __wbg_set_base_array_layer_f8f8eb2d7bd5eb65: function(arg0, arg1) {
            arg0.baseArrayLayer = arg1 >>> 0;
        },
        __wbg_set_base_mip_level_41735f9b982a26b8: function(arg0, arg1) {
            arg0.baseMipLevel = arg1 >>> 0;
        },
        __wbg_set_beginning_of_pass_write_index_f7a1da82b2427e33: function(arg0, arg1) {
            arg0.beginningOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_beginning_of_pass_write_index_ff16e69caf566bee: function(arg0, arg1) {
            arg0.beginningOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_bind_group_layouts_ddc70fed7170a2ee: function(arg0, arg1) {
            arg0.bindGroupLayouts = arg1;
        },
        __wbg_set_binding_53105cd45cae6a03: function(arg0, arg1) {
            arg0.binding = arg1 >>> 0;
        },
        __wbg_set_binding_d82fdc5364e5b0c5: function(arg0, arg1) {
            arg0.binding = arg1 >>> 0;
        },
        __wbg_set_blend_00219e805977440c: function(arg0, arg1) {
            arg0.blend = arg1;
        },
        __wbg_set_buffer_0c946e9b46823a5c: function(arg0, arg1) {
            arg0.buffer = arg1;
        },
        __wbg_set_buffer_21a336fe62828e11: function(arg0, arg1) {
            arg0.buffer = arg1;
        },
        __wbg_set_buffer_b8a0d482696c532e: function(arg0, arg1) {
            arg0.buffer = arg1;
        },
        __wbg_set_buffers_070770ce2c0d5522: function(arg0, arg1) {
            arg0.buffers = arg1;
        },
        __wbg_set_bytes_per_row_8e39002b1f627e4d: function(arg0, arg1) {
            arg0.bytesPerRow = arg1 >>> 0;
        },
        __wbg_set_bytes_per_row_ea947f8b1955eb75: function(arg0, arg1) {
            arg0.bytesPerRow = arg1 >>> 0;
        },
        __wbg_set_clear_value_4ed990a8b197a59a: function(arg0, arg1) {
            arg0.clearValue = arg1;
        },
        __wbg_set_code_7a3890c4ffd4f7d4: function(arg0, arg1, arg2) {
            arg0.code = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_color_85a6e64ea881593f: function(arg0, arg1) {
            arg0.color = arg1;
        },
        __wbg_set_color_attachments_88b752139b2e1a01: function(arg0, arg1) {
            arg0.colorAttachments = arg1;
        },
        __wbg_set_compare_494fcab2dc5d7792: function(arg0, arg1) {
            arg0.compare = __wbindgen_enum_GpuCompareFunction[arg1];
        },
        __wbg_set_compare_71e8ea844225b7cb: function(arg0, arg1) {
            arg0.compare = __wbindgen_enum_GpuCompareFunction[arg1];
        },
        __wbg_set_compute_ae49764c749c761e: function(arg0, arg1) {
            arg0.compute = arg1;
        },
        __wbg_set_count_036a202e127d1828: function(arg0, arg1) {
            arg0.count = arg1 >>> 0;
        },
        __wbg_set_cull_mode_8c42221bd938897d: function(arg0, arg1) {
            arg0.cullMode = __wbindgen_enum_GpuCullMode[arg1];
        },
        __wbg_set_depth_bias_8de79219aa9d3e44: function(arg0, arg1) {
            arg0.depthBias = arg1;
        },
        __wbg_set_depth_bias_clamp_930cad73d46884cf: function(arg0, arg1) {
            arg0.depthBiasClamp = arg1;
        },
        __wbg_set_depth_bias_slope_scale_85d4c3f48c50408b: function(arg0, arg1) {
            arg0.depthBiasSlopeScale = arg1;
        },
        __wbg_set_depth_clear_value_ef40fa181859a36f: function(arg0, arg1) {
            arg0.depthClearValue = arg1;
        },
        __wbg_set_depth_compare_1273836af777aaa4: function(arg0, arg1) {
            arg0.depthCompare = __wbindgen_enum_GpuCompareFunction[arg1];
        },
        __wbg_set_depth_fail_op_424b14249d8983bf: function(arg0, arg1) {
            arg0.depthFailOp = __wbindgen_enum_GpuStencilOperation[arg1];
        },
        __wbg_set_depth_load_op_57a7381c934d435e: function(arg0, arg1) {
            arg0.depthLoadOp = __wbindgen_enum_GpuLoadOp[arg1];
        },
        __wbg_set_depth_or_array_layers_3601a844f36fa25f: function(arg0, arg1) {
            arg0.depthOrArrayLayers = arg1 >>> 0;
        },
        __wbg_set_depth_read_only_44e6668e5d98f75f: function(arg0, arg1) {
            arg0.depthReadOnly = arg1 !== 0;
        },
        __wbg_set_depth_stencil_5abb374ddd7f3268: function(arg0, arg1) {
            arg0.depthStencil = arg1;
        },
        __wbg_set_depth_stencil_attachment_eb9d08fc6e7a8fda: function(arg0, arg1) {
            arg0.depthStencilAttachment = arg1;
        },
        __wbg_set_depth_store_op_124f84da3afff2bd: function(arg0, arg1) {
            arg0.depthStoreOp = __wbindgen_enum_GpuStoreOp[arg1];
        },
        __wbg_set_depth_write_enabled_93d4e872c40ad885: function(arg0, arg1) {
            arg0.depthWriteEnabled = arg1 !== 0;
        },
        __wbg_set_device_7a51a7721914c23c: function(arg0, arg1) {
            arg0.device = arg1;
        },
        __wbg_set_dimension_9cfe90d02f664a7a: function(arg0, arg1) {
            arg0.dimension = __wbindgen_enum_GpuTextureDimension[arg1];
        },
        __wbg_set_dimension_b61b3c48adf487c1: function(arg0, arg1) {
            arg0.dimension = __wbindgen_enum_GpuTextureViewDimension[arg1];
        },
        __wbg_set_dst_factor_6cbfc3a6898cc9ce: function(arg0, arg1) {
            arg0.dstFactor = __wbindgen_enum_GpuBlendFactor[arg1];
        },
        __wbg_set_end_of_pass_write_index_41d72471cce1e061: function(arg0, arg1) {
            arg0.endOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_end_of_pass_write_index_fd531d3ce14a6897: function(arg0, arg1) {
            arg0.endOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_entries_0d3ea75764a89b83: function(arg0, arg1) {
            arg0.entries = arg1;
        },
        __wbg_set_entries_922ec6089646247e: function(arg0, arg1) {
            arg0.entries = arg1;
        },
        __wbg_set_entry_point_087ca8094ce666fd: function(arg0, arg1, arg2) {
            arg0.entryPoint = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_entry_point_b770157326a1b59e: function(arg0, arg1, arg2) {
            arg0.entryPoint = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_entry_point_d7efddda482bc7fe: function(arg0, arg1, arg2) {
            arg0.entryPoint = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_external_texture_41cadb0b9faf1919: function(arg0, arg1) {
            arg0.externalTexture = arg1;
        },
        __wbg_set_fail_op_9865183abff904e0: function(arg0, arg1) {
            arg0.failOp = __wbindgen_enum_GpuStencilOperation[arg1];
        },
        __wbg_set_format_09f304cdbee40626: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuTextureFormat[arg1];
        },
        __wbg_set_format_90502561f5c3fe92: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuTextureFormat[arg1];
        },
        __wbg_set_format_98f7ca48143feacb: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuTextureFormat[arg1];
        },
        __wbg_set_format_b111ffed7e227fef: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuTextureFormat[arg1];
        },
        __wbg_set_format_b3f26219150f6fcf: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuVertexFormat[arg1];
        },
        __wbg_set_format_dbb02ef2a1b11c73: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuTextureFormat[arg1];
        },
        __wbg_set_format_fd82439cf1e1f024: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuTextureFormat[arg1];
        },
        __wbg_set_fragment_4026e84121693413: function(arg0, arg1) {
            arg0.fragment = arg1;
        },
        __wbg_set_front_face_abcfb70c2001a63b: function(arg0, arg1) {
            arg0.frontFace = __wbindgen_enum_GpuFrontFace[arg1];
        },
        __wbg_set_g_3e49035507785f14: function(arg0, arg1) {
            arg0.g = arg1;
        },
        __wbg_set_has_dynamic_offset_ebc87f184bf9b1b6: function(arg0, arg1) {
            arg0.hasDynamicOffset = arg1 !== 0;
        },
        __wbg_set_height_5dc3bf5fd05f449d: function(arg0, arg1) {
            arg0.height = arg1 >>> 0;
        },
        __wbg_set_height_bb0dc35fd1d941f5: function(arg0, arg1) {
            arg0.height = arg1 >>> 0;
        },
        __wbg_set_height_bdd58e6b04e88cca: function(arg0, arg1) {
            arg0.height = arg1 >>> 0;
        },
        __wbg_set_index_24a79f6bf22a9e3c: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_index_6216eb6926d2fbc6: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_index_b93fd9d797d1ff98: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2 >>> 0;
        },
        __wbg_set_label_0ca1d80bd2825a5c: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_15aeeb29a6954be8: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_2f91d5326490d1cc: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_355fa56959229d47: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_565007795fa1b28b: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_64f13c71608a2731: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_6b0d6041cd54c099: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_76862276b026aadb: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_776849dd514350e6: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_7d273105ca29a945: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_889010e958e191c9: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_96ff54a6b9baaf90: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_b80919003c66c761: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_cbbe51e986da3989: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_ccc4850f4197dc22: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_layout_0561f0404037d441: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_layout_464ae8395c01fe6e: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_layout_b990b908a7810b31: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_load_op_5d3a8abceb4a5269: function(arg0, arg1) {
            arg0.loadOp = __wbindgen_enum_GpuLoadOp[arg1];
        },
        __wbg_set_lod_max_clamp_bf825cfbdd106655: function(arg0, arg1) {
            arg0.lodMaxClamp = arg1;
        },
        __wbg_set_lod_min_clamp_35ccf45d8ee31c7e: function(arg0, arg1) {
            arg0.lodMinClamp = arg1;
        },
        __wbg_set_mag_filter_8f8d84435d8db92a: function(arg0, arg1) {
            arg0.magFilter = __wbindgen_enum_GpuFilterMode[arg1];
        },
        __wbg_set_mapped_at_creation_ff06f7ed93a315dd: function(arg0, arg1) {
            arg0.mappedAtCreation = arg1 !== 0;
        },
        __wbg_set_mask_ad9d29606115a472: function(arg0, arg1) {
            arg0.mask = arg1 >>> 0;
        },
        __wbg_set_max_anisotropy_c82fc429f1b1e064: function(arg0, arg1) {
            arg0.maxAnisotropy = arg1;
        },
        __wbg_set_min_binding_size_746ae443396eb1f4: function(arg0, arg1) {
            arg0.minBindingSize = arg1;
        },
        __wbg_set_min_filter_fb0add0b126873ab: function(arg0, arg1) {
            arg0.minFilter = __wbindgen_enum_GpuFilterMode[arg1];
        },
        __wbg_set_mip_level_count_1d3d8f433adfb7ae: function(arg0, arg1) {
            arg0.mipLevelCount = arg1 >>> 0;
        },
        __wbg_set_mip_level_count_e13846330ea5c4a2: function(arg0, arg1) {
            arg0.mipLevelCount = arg1 >>> 0;
        },
        __wbg_set_mip_level_f4e04afe7e030b52: function(arg0, arg1) {
            arg0.mipLevel = arg1 >>> 0;
        },
        __wbg_set_mipmap_filter_202e81e75b49e109: function(arg0, arg1) {
            arg0.mipmapFilter = __wbindgen_enum_GpuMipmapFilterMode[arg1];
        },
        __wbg_set_module_3d1725eef3718083: function(arg0, arg1) {
            arg0.module = arg1;
        },
        __wbg_set_module_6d0431faccebdcc4: function(arg0, arg1) {
            arg0.module = arg1;
        },
        __wbg_set_module_701adba2958bd873: function(arg0, arg1) {
            arg0.module = arg1;
        },
        __wbg_set_multisample_e577402263e48ad4: function(arg0, arg1) {
            arg0.multisample = arg1;
        },
        __wbg_set_multisampled_2180d2b5d246ae13: function(arg0, arg1) {
            arg0.multisampled = arg1 !== 0;
        },
        __wbg_set_offset_2d6ab375385cd2ae: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_offset_3fadbb3d3dadd4ef: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_offset_da22b013e44ffcc3: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_offset_fa633343238c309f: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_operation_3a748fcc4d122201: function(arg0, arg1) {
            arg0.operation = __wbindgen_enum_GpuBlendOperation[arg1];
        },
        __wbg_set_origin_5531aa268ce97d9d: function(arg0, arg1) {
            arg0.origin = arg1;
        },
        __wbg_set_pass_op_e82189d4f2d5c48d: function(arg0, arg1) {
            arg0.passOp = __wbindgen_enum_GpuStencilOperation[arg1];
        },
        __wbg_set_power_preference_f8956c3fea27c41d: function(arg0, arg1) {
            arg0.powerPreference = __wbindgen_enum_GpuPowerPreference[arg1];
        },
        __wbg_set_primitive_65a118359b90be29: function(arg0, arg1) {
            arg0.primitive = arg1;
        },
        __wbg_set_query_set_0c94267b03620b43: function(arg0, arg1) {
            arg0.querySet = arg1;
        },
        __wbg_set_query_set_17c4bef32f23bd7e: function(arg0, arg1) {
            arg0.querySet = arg1;
        },
        __wbg_set_r_399b4e4373534d2d: function(arg0, arg1) {
            arg0.r = arg1;
        },
        __wbg_set_required_features_83604ede3c9e0352: function(arg0, arg1) {
            arg0.requiredFeatures = arg1;
        },
        __wbg_set_resolve_target_1a8386ab8943f477: function(arg0, arg1) {
            arg0.resolveTarget = arg1;
        },
        __wbg_set_resource_ec6d0e1222a3141f: function(arg0, arg1) {
            arg0.resource = arg1;
        },
        __wbg_set_rows_per_image_3350e95ad2a80a89: function(arg0, arg1) {
            arg0.rowsPerImage = arg1 >>> 0;
        },
        __wbg_set_rows_per_image_e38e907b075d42a7: function(arg0, arg1) {
            arg0.rowsPerImage = arg1 >>> 0;
        },
        __wbg_set_sample_count_eb36fa5f0a856200: function(arg0, arg1) {
            arg0.sampleCount = arg1 >>> 0;
        },
        __wbg_set_sample_type_fade9fb214ec1d74: function(arg0, arg1) {
            arg0.sampleType = __wbindgen_enum_GpuTextureSampleType[arg1];
        },
        __wbg_set_sampler_e11b32a88597fe6a: function(arg0, arg1) {
            arg0.sampler = arg1;
        },
        __wbg_set_shader_location_87fe60eb5cf2ef69: function(arg0, arg1) {
            arg0.shaderLocation = arg1 >>> 0;
        },
        __wbg_set_size_724b776b74138f07: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_size_a15931d6b21f35f9: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_size_e76794a3069a90d7: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_src_factor_00c2d54742fd17a4: function(arg0, arg1) {
            arg0.srcFactor = __wbindgen_enum_GpuBlendFactor[arg1];
        },
        __wbg_set_stencil_back_9ee211b35e39be71: function(arg0, arg1) {
            arg0.stencilBack = arg1;
        },
        __wbg_set_stencil_clear_value_884e0e38f410ec12: function(arg0, arg1) {
            arg0.stencilClearValue = arg1 >>> 0;
        },
        __wbg_set_stencil_front_4fc7b9162e3cc71f: function(arg0, arg1) {
            arg0.stencilFront = arg1;
        },
        __wbg_set_stencil_load_op_eeb37a3ee387626f: function(arg0, arg1) {
            arg0.stencilLoadOp = __wbindgen_enum_GpuLoadOp[arg1];
        },
        __wbg_set_stencil_read_mask_52264a1876326ce1: function(arg0, arg1) {
            arg0.stencilReadMask = arg1 >>> 0;
        },
        __wbg_set_stencil_read_only_192e9b65a6822039: function(arg0, arg1) {
            arg0.stencilReadOnly = arg1 !== 0;
        },
        __wbg_set_stencil_store_op_c110d1172a277982: function(arg0, arg1) {
            arg0.stencilStoreOp = __wbindgen_enum_GpuStoreOp[arg1];
        },
        __wbg_set_stencil_write_mask_5e49d555c45a16fa: function(arg0, arg1) {
            arg0.stencilWriteMask = arg1 >>> 0;
        },
        __wbg_set_step_mode_80a80308a6783be4: function(arg0, arg1) {
            arg0.stepMode = __wbindgen_enum_GpuVertexStepMode[arg1];
        },
        __wbg_set_storage_texture_dab6c69662cecb15: function(arg0, arg1) {
            arg0.storageTexture = arg1;
        },
        __wbg_set_store_op_2bf481ef4a30f927: function(arg0, arg1) {
            arg0.storeOp = __wbindgen_enum_GpuStoreOp[arg1];
        },
        __wbg_set_strip_index_format_ab81420028504e38: function(arg0, arg1) {
            arg0.stripIndexFormat = __wbindgen_enum_GpuIndexFormat[arg1];
        },
        __wbg_set_targets_f00488491d26619c: function(arg0, arg1) {
            arg0.targets = arg1;
        },
        __wbg_set_texture_8732ea1b0f00cc28: function(arg0, arg1) {
            arg0.texture = arg1;
        },
        __wbg_set_texture_e3dad6e696ee0d00: function(arg0, arg1) {
            arg0.texture = arg1;
        },
        __wbg_set_timestamp_writes_0e233b1252b29a60: function(arg0, arg1) {
            arg0.timestampWrites = arg1;
        },
        __wbg_set_timestamp_writes_dd465cc31736e9dd: function(arg0, arg1) {
            arg0.timestampWrites = arg1;
        },
        __wbg_set_topology_774e967bf9bd3600: function(arg0, arg1) {
            arg0.topology = __wbindgen_enum_GpuPrimitiveTopology[arg1];
        },
        __wbg_set_type_3e89072317fa3a02: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_GpuSamplerBindingType[arg1];
        },
        __wbg_set_type_fc5fb8ab00ac41ab: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_GpuBufferBindingType[arg1];
        },
        __wbg_set_unclipped_depth_bbe4b97da619705e: function(arg0, arg1) {
            arg0.unclippedDepth = arg1 !== 0;
        },
        __wbg_set_usage_215da50f99ff465b: function(arg0, arg1) {
            arg0.usage = arg1 >>> 0;
        },
        __wbg_set_usage_5fcdce4860170c24: function(arg0, arg1) {
            arg0.usage = arg1 >>> 0;
        },
        __wbg_set_usage_e78977f1ef3c2dc4: function(arg0, arg1) {
            arg0.usage = arg1 >>> 0;
        },
        __wbg_set_usage_ece80ba45b896722: function(arg0, arg1) {
            arg0.usage = arg1 >>> 0;
        },
        __wbg_set_vertex_879729b1ef5390a2: function(arg0, arg1) {
            arg0.vertex = arg1;
        },
        __wbg_set_view_9850fe7aa8b4eae3: function(arg0, arg1) {
            arg0.view = arg1;
        },
        __wbg_set_view_b8a1c6698b913d81: function(arg0, arg1) {
            arg0.view = arg1;
        },
        __wbg_set_view_dimension_5c6c0dc0d28476c3: function(arg0, arg1) {
            arg0.viewDimension = __wbindgen_enum_GpuTextureViewDimension[arg1];
        },
        __wbg_set_view_dimension_67ac13d87840ccb1: function(arg0, arg1) {
            arg0.viewDimension = __wbindgen_enum_GpuTextureViewDimension[arg1];
        },
        __wbg_set_view_formats_2b4e75efe5453ad6: function(arg0, arg1) {
            arg0.viewFormats = arg1;
        },
        __wbg_set_view_formats_6c5369e801fa17b7: function(arg0, arg1) {
            arg0.viewFormats = arg1;
        },
        __wbg_set_visibility_22877d2819bea70b: function(arg0, arg1) {
            arg0.visibility = arg1 >>> 0;
        },
        __wbg_set_width_25112eb6bf1148df: function(arg0, arg1) {
            arg0.width = arg1 >>> 0;
        },
        __wbg_set_width_9d385df435c1f79d: function(arg0, arg1) {
            arg0.width = arg1 >>> 0;
        },
        __wbg_set_width_a6d5409d7980ccca: function(arg0, arg1) {
            arg0.width = arg1 >>> 0;
        },
        __wbg_set_write_mask_dceb6456d5310b39: function(arg0, arg1) {
            arg0.writeMask = arg1 >>> 0;
        },
        __wbg_set_x_40188fe21190a1a8: function(arg0, arg1) {
            arg0.x = arg1 >>> 0;
        },
        __wbg_set_y_8caca94aad6cb4e8: function(arg0, arg1) {
            arg0.y = arg1 >>> 0;
        },
        __wbg_set_z_bb89b8ff0b9f8f74: function(arg0, arg1) {
            arg0.z = arg1 >>> 0;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_9b2406c23aeb2023: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b34d2126934e16ba: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_submit_19b0e21319bc36d7: function(arg0, arg1) {
            arg0.submit(arg1);
        },
        __wbg_then_837494e384b37459: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_then_87e0b598b245104b: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_bd927500e8905df2: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_transferToImageBitmap_ef78ff480500ad5d: function() { return handleError(function (arg0) {
            const ret = arg0.transferToImageBitmap();
            return ret;
        }, arguments); },
        __wbg_unmap_c2954ef341a2b85d: function(arg0) {
            arg0.unmap();
        },
        __wbg_vellorenderer_new: function(arg0) {
            const ret = VelloRenderer.__wrap(arg0);
            return ret;
        },
        __wbg_warn_c4e0780980765a86: function(arg0) {
            console.warn(arg0);
        },
        __wbg_writeBuffer_1fa3becf9f9f970e: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.writeBuffer(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbg_writeTexture_16d44079bcc6b839: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.writeTexture(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 183, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h97a41680667a7bc9);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 259, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__he3b8ad3a01647b28);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./vello_wasm_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__he3b8ad3a01647b28(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__he3b8ad3a01647b28(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h97a41680667a7bc9(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h97a41680667a7bc9(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h59f6a18f366ace3f(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h59f6a18f366ace3f(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_GpuAddressMode = ["clamp-to-edge", "repeat", "mirror-repeat"];


const __wbindgen_enum_GpuBlendFactor = ["zero", "one", "src", "one-minus-src", "src-alpha", "one-minus-src-alpha", "dst", "one-minus-dst", "dst-alpha", "one-minus-dst-alpha", "src-alpha-saturated", "constant", "one-minus-constant", "src1", "one-minus-src1", "src1-alpha", "one-minus-src1-alpha"];


const __wbindgen_enum_GpuBlendOperation = ["add", "subtract", "reverse-subtract", "min", "max"];


const __wbindgen_enum_GpuBufferBindingType = ["uniform", "storage", "read-only-storage"];


const __wbindgen_enum_GpuCanvasAlphaMode = ["opaque", "premultiplied"];


const __wbindgen_enum_GpuCompareFunction = ["never", "less", "equal", "less-equal", "greater", "not-equal", "greater-equal", "always"];


const __wbindgen_enum_GpuCullMode = ["none", "front", "back"];


const __wbindgen_enum_GpuFilterMode = ["nearest", "linear"];


const __wbindgen_enum_GpuFrontFace = ["ccw", "cw"];


const __wbindgen_enum_GpuIndexFormat = ["uint16", "uint32"];


const __wbindgen_enum_GpuLoadOp = ["load", "clear"];


const __wbindgen_enum_GpuMipmapFilterMode = ["nearest", "linear"];


const __wbindgen_enum_GpuPowerPreference = ["low-power", "high-performance"];


const __wbindgen_enum_GpuPrimitiveTopology = ["point-list", "line-list", "line-strip", "triangle-list", "triangle-strip"];


const __wbindgen_enum_GpuSamplerBindingType = ["filtering", "non-filtering", "comparison"];


const __wbindgen_enum_GpuStencilOperation = ["keep", "zero", "replace", "invert", "increment-clamp", "decrement-clamp", "increment-wrap", "decrement-wrap"];


const __wbindgen_enum_GpuStorageTextureAccess = ["write-only", "read-only", "read-write"];


const __wbindgen_enum_GpuStoreOp = ["store", "discard"];


const __wbindgen_enum_GpuTextureAspect = ["all", "stencil-only", "depth-only"];


const __wbindgen_enum_GpuTextureDimension = ["1d", "2d", "3d"];


const __wbindgen_enum_GpuTextureFormat = ["r8unorm", "r8snorm", "r8uint", "r8sint", "r16uint", "r16sint", "r16float", "rg8unorm", "rg8snorm", "rg8uint", "rg8sint", "r32uint", "r32sint", "r32float", "rg16uint", "rg16sint", "rg16float", "rgba8unorm", "rgba8unorm-srgb", "rgba8snorm", "rgba8uint", "rgba8sint", "bgra8unorm", "bgra8unorm-srgb", "rgb9e5ufloat", "rgb10a2uint", "rgb10a2unorm", "rg11b10ufloat", "rg32uint", "rg32sint", "rg32float", "rgba16uint", "rgba16sint", "rgba16float", "rgba32uint", "rgba32sint", "rgba32float", "stencil8", "depth16unorm", "depth24plus", "depth24plus-stencil8", "depth32float", "depth32float-stencil8", "bc1-rgba-unorm", "bc1-rgba-unorm-srgb", "bc2-rgba-unorm", "bc2-rgba-unorm-srgb", "bc3-rgba-unorm", "bc3-rgba-unorm-srgb", "bc4-r-unorm", "bc4-r-snorm", "bc5-rg-unorm", "bc5-rg-snorm", "bc6h-rgb-ufloat", "bc6h-rgb-float", "bc7-rgba-unorm", "bc7-rgba-unorm-srgb", "etc2-rgb8unorm", "etc2-rgb8unorm-srgb", "etc2-rgb8a1unorm", "etc2-rgb8a1unorm-srgb", "etc2-rgba8unorm", "etc2-rgba8unorm-srgb", "eac-r11unorm", "eac-r11snorm", "eac-rg11unorm", "eac-rg11snorm", "astc-4x4-unorm", "astc-4x4-unorm-srgb", "astc-5x4-unorm", "astc-5x4-unorm-srgb", "astc-5x5-unorm", "astc-5x5-unorm-srgb", "astc-6x5-unorm", "astc-6x5-unorm-srgb", "astc-6x6-unorm", "astc-6x6-unorm-srgb", "astc-8x5-unorm", "astc-8x5-unorm-srgb", "astc-8x6-unorm", "astc-8x6-unorm-srgb", "astc-8x8-unorm", "astc-8x8-unorm-srgb", "astc-10x5-unorm", "astc-10x5-unorm-srgb", "astc-10x6-unorm", "astc-10x6-unorm-srgb", "astc-10x8-unorm", "astc-10x8-unorm-srgb", "astc-10x10-unorm", "astc-10x10-unorm-srgb", "astc-12x10-unorm", "astc-12x10-unorm-srgb", "astc-12x12-unorm", "astc-12x12-unorm-srgb"];


const __wbindgen_enum_GpuTextureSampleType = ["float", "unfilterable-float", "depth", "sint", "uint"];


const __wbindgen_enum_GpuTextureViewDimension = ["1d", "2d", "2d-array", "cube", "cube-array", "3d"];


const __wbindgen_enum_GpuVertexFormat = ["uint8", "uint8x2", "uint8x4", "sint8", "sint8x2", "sint8x4", "unorm8", "unorm8x2", "unorm8x4", "snorm8", "snorm8x2", "snorm8x4", "uint16", "uint16x2", "uint16x4", "sint16", "sint16x2", "sint16x4", "unorm16", "unorm16x2", "unorm16x4", "snorm16", "snorm16x2", "snorm16x4", "float16", "float16x2", "float16x4", "float32", "float32x2", "float32x3", "float32x4", "uint32", "uint32x2", "uint32x3", "uint32x4", "sint32", "sint32x2", "sint32x3", "sint32x4", "unorm10-10-10-2", "unorm8x4-bgra"];


const __wbindgen_enum_GpuVertexStepMode = ["vertex", "instance"];
const VelloRendererFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vellorenderer_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('vello_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
