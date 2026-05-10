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
        ptr = ptr >>> 0;
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
     * Attach a `<canvas>` as a Vello-driven surface. Returns the JS-facing
     * id used by `configureSurface` / `detachSurface` / future
     * `renderXxxToSurface` calls. The canvas is consumed (moved into the
     * Surface). Returns 0 on failure.
     * @param {HTMLCanvasElement} canvas
     * @param {number} width
     * @param {number} height
     * @returns {number}
     */
    attachCanvasSurface(canvas, width, height) {
        const ret = wasm.vellorenderer_attachCanvasSurface(this.__wbg_ptr, canvas, width, height);
        return ret >>> 0;
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
     * Reconfigure a previously-attached surface (resize / DPR change).
     * Idempotent if dims match the current configuration.
     * @param {number} id
     * @param {number} width
     * @param {number} height
     */
    configureSurface(id, width, height) {
        wasm.vellorenderer_configureSurface(this.__wbg_ptr, id, width, height);
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
     * Allocate a persistent character instance — pre-resolves
     * accessory bundles, pre-computes bounds (frame size, accessory
     * padding, grid layout) over `seed_anims`, and allocates ONE
     * output GPU texture sized to the worst-case strip.
     * `tickSwfCharacterStrip` then re-renders any one of those
     * `seed_anims` into the same texture, overwriting pixels in
     * place — JS keeps a single Pixi `ExternalSource` for the
     * instance's lifetime.
     *
     * `colors` is `[c1, c2, c3]` packed as `0xRRGGBB`; pass `0` for
     * "leave the zone untinted" (matches the pre-existing
     * `setSwfPlayerColors` global semantics, but stored per-
     * instance so concurrent renders of differently-coloured chars
     * don't trample each other).
     *
     * `seed_anims` MUST cover every anim the caller will pass to
     * subsequent ticks — the strip texture is sized for the bounds
     * union over them. Asking for a frame from an anim outside this
     * list will clip silently. For the canonical Dofus character
     * pool (staticR/L/F/B/S, walkR/L/F/B/S, runR/L/F/B/S) pass all
     * 13-15 names; for a stress test you can pass only the subset
     * you'll cycle.
     *
     * `acc_*` are parallel arrays describing accessories — same
     * shape as `renderSwfStripRangeAccessorized` accepts. Returns 0
     * on failure (bundle missing, all accessories failed to
     * resolve, or strip dims exceed GPU limits).
     * @param {string} bundle
     * @param {string[]} seed_anims
     * @param {Uint32Array} acc_slots
     * @param {string[]} acc_bundles
     * @param {string[]} acc_exports
     * @param {Uint32Array} acc_anim_types
     * @param {number} color1
     * @param {number} color2
     * @param {number} color3
     * @param {number} resolution
     * @returns {number}
     */
    createSwfCharacterInstance(bundle, seed_anims, acc_slots, acc_bundles, acc_exports, acc_anim_types, color1, color2, color3, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(seed_anims, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(acc_slots, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(acc_bundles, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayJsValueToWasm0(acc_exports, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArray32ToWasm0(acc_anim_types, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_createSwfCharacterInstance(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, color1, color2, color3, resolution);
        return ret >>> 0;
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
     * Allocate a viewport-sized output texture for the batched
     * world-layer render path. Single texture shared by every
     * `renderSwfWorldLayer` call; JS Pixi wraps it ONCE as an
     * `ExternalSource` and never re-allocates. Returns the
     * `{ texture, textureId, width, height }` so JS can wire it
     * up immediately.
     * @param {number} width
     * @param {number} height
     * @returns {any}
     */
    createWorldLayerTexture(width, height) {
        const ret = wasm.vellorenderer_createWorldLayerTexture(this.__wbg_ptr, width, height);
        return ret;
    }
    /**
     * Drop a surface attachment. Subsequent renders to this id no-op.
     * @param {number} id
     */
    detachSurface(id) {
        wasm.vellorenderer_detachSurface(this.__wbg_ptr, id);
    }
    /**
     * Free the character instance + its output GPU texture.
     * @param {number} instance_id
     */
    disposeSwfCharacterInstance(instance_id) {
        wasm.vellorenderer_disposeSwfCharacterInstance(this.__wbg_ptr, instance_id);
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
     * Path cache observability.
     *
     * Reports the live state of the two long-lived tile-pass caches:
     *   - `tile_render_caches` (per-bundle `RenderCache`): shape
     *     command tessellation, morph interpolations, sprite frame-
     *     state walks. Populated by tile paths; character + spell
     *     paths use fresh per-call caches because their bundles
     *     have shape-id collisions with each other.
     *   - `tile_subscenes`: pre-encoded `vello::Scene` per
     *     `(bundle, export, frame)` used by `setStaticTilePlacements`
     *     + `renderTilePass` to memcpy-append cached tile geometry.
     *
     * Memory bytes are estimates — Vello scenes don't expose encoded
     * size, so we count entries × heuristic constant (~8 KB per
     * typical tile sub-scene). Use the entry count for hit-rate
     * validation; bytes for capacity-planning only.
     *
     * Returns `{ bundleCacheCount, sceneCacheCount, sceneBytesEstimate }`.
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
        const ret = wasm.vellorenderer_renderFrameToAtlas(this.__wbg_ptr, atlas_texture_id, dst_x, dst_y, asset_id, ptr0, len0, frame_index, resolution, ptr1, len1, ptr2, len2, isLikeNone(slot_w) ? 0x100000001 : (slot_w) >>> 0, isLikeNone(slot_h) ? 0x100000001 : (slot_h) >>> 0);
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
     * Render the SWF's root timeline directly into a previously-attached
     * `<canvas>` surface. Used by HUD consumers (fighter portraits,
     * banner artwork) that need an `<canvas>` element they can mount
     * in React. Returns `{ width, height, anchorX, anchorY }` on
     * success or NULL on failure (unknown surface, missing bundle,
     * degenerate bounds, render error).
     * @param {number} surface_id
     * @param {string} bundle
     * @param {number} frame
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfRootToSurface(surface_id, bundle, frame, resolution) {
        const ptr0 = passStringToWasm0(bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfRootToSurface(this.__wbg_ptr, surface_id, ptr0, len0, frame, resolution);
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
     * Render the spell-icon composition (back disc + frame + glyph,
     * each flat-tinted) into a previously-attached `<canvas>` surface.
     * Returns the painted (width, height) so the React caller can size
     * its `<canvas>` slot to the intrinsic content rectangle.
     * Returns `0` width/height on any failure (missing bundle, empty
     * bounds, surface dispatch error).
     * @param {number} surface_id
     * @param {string} back_bundle
     * @param {string} up_bundle
     * @param {number} bc_rgb
     * @param {number} fc_rgb
     * @param {number} pc_rgb
     * @param {number} resolution
     * @returns {any}
     */
    renderSwfSpellIconToSurface(surface_id, back_bundle, up_bundle, bc_rgb, fc_rgb, pc_rgb, resolution) {
        const ptr0 = passStringToWasm0(back_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(up_bundle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfSpellIconToSurface(this.__wbg_ptr, surface_id, ptr0, len0, ptr1, len1, bc_rgb, fc_rgb, pc_rgb, resolution);
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
     * Batch render: composes ALL active character placements into
     * ONE Vello scene, dispatches ONCE, writes the result into the
     * shared world-layer texture allocated by
     * `createWorldLayerTexture`. Replaces N individual
     * `tickSwfCharacterFrame` calls per tick with 1 call total.
     *
     * Per-placement parallel arrays:
     *   - `instance_ids[i]`: WASM character instance id
     *   - `frames[i]`:       current frame within the instance's
     *                        current anim (set via setSwfCharacterAnim)
     *   - `pos_x[i] / pos_y[i]`: pixel position in the layer texture
     *                        (== screen coords; layer is viewport-sized)
     *
     * Returns true on success, false on parallel-array-length
     * mismatch / texture-id miss / render error.
     * @param {number} layer_texture_id
     * @param {number} width
     * @param {number} height
     * @param {Uint32Array} instance_ids
     * @param {Uint32Array} frames
     * @param {Float32Array} pos_x
     * @param {Float32Array} pos_y
     * @returns {boolean}
     */
    renderSwfWorldLayer(layer_texture_id, width, height, instance_ids, frames, pos_x, pos_y) {
        const ptr0 = passArray32ToWasm0(instance_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(pos_x, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF32ToWasm0(pos_y, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderSwfWorldLayer(this.__wbg_ptr, layer_texture_id, width, height, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        return ret !== 0;
    }
    /**
     * Render an arbitrary set of (bundle, export, frame, matrix)
     * placements into one output texture in a single Vello dispatch.
     *
     * Inputs use small unique-string tables (`bundles`, `exports`)
     * indexed by per-placement parallel arrays so the marshalling cost
     * across the JS↔WASM boundary stays in the kilobytes range even for
     * hundreds of placements per frame.
     *
     * Each placement's `matrix` is a 6-element 2D affine `[a, b, c, d,
     * tx, ty]` mapping the symbol's twip space directly to output
     * pixels. The caller composes (zoom, world position, rotation,
     * flip, slope) into this single matrix; the renderer treats every
     * placement as a drop-in transform.
     *
     * Placements that fail to look up (missing bundle/export) are
     * silently skipped — by design, no per-placement validity flag in
     * the response since the caller already knows which tiles exist.
     *
     * Returns `{ texture, textureId, width, height }` matching the
     * other render entry points so the JS side can wrap the GPUTexture
     * as a Pixi `ExternalSource` per layer.
     * @param {number} target_w
     * @param {number} target_h
     * @param {string[]} bundles
     * @param {string[]} exports
     * @param {Uint32Array} bundle_idx
     * @param {Uint32Array} export_idx
     * @param {Uint32Array} frames
     * @param {Float32Array} matrices
     * @returns {any}
     */
    renderTilePass(target_w, target_h, bundles, exports, bundle_idx, export_idx, frames, matrices) {
        const ptr0 = passArrayJsValueToWasm0(bundles, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(exports, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(bundle_idx, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(export_idx, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF32ToWasm0(matrices, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderTilePass(this.__wbg_ptr, target_w, target_h, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
        return ret;
    }
    /**
     * Render the tile pass (Ground + Object1) directly into a
     * previously-attached `<canvas>` surface. Replaces the
     * `renderTilePass` → ExternalSource path: Vello writes the swap
     * chain texture directly via `render_to_texture`, then the surface
     * presents to the canvas. The browser composites the resulting
     * canvas with sibling Pixi/Vello canvases via DOM stacking.
     *
     * `surface_id` must come from a prior `attachCanvasSurface` call.
     * The surface's configured size determines render extents; caller
     * must `configureSurface(id, w, h)` whenever the viewport changes
     * before dispatching here. Returns `true` on success, `false` on
     * any failure (unknown id, lost surface, render error).
     * @param {number} surface_id
     * @param {string[]} bundles
     * @param {string[]} exports
     * @param {Uint32Array} bundle_idx
     * @param {Uint32Array} export_idx
     * @param {Uint32Array} frames
     * @param {Float32Array} matrices
     * @returns {boolean}
     */
    renderTilePassToSurface(surface_id, bundles, exports, bundle_idx, export_idx, frames, matrices) {
        const ptr0 = passArrayJsValueToWasm0(bundles, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(exports, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(bundle_idx, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(export_idx, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF32ToWasm0(matrices, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderTilePassToSurface(this.__wbg_ptr, surface_id, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
        return ret !== 0;
    }
    /**
     * Render the unified L3 World layer.
     *
     * Heterogeneous placement-list dispatch matching the canonical
     * Object2 depth band (foreground tiles + characters + spell VFX
     * interleaved by `cellNum × 100 + sub-offset`). Four placement
     * kinds:
     *   - kind=0  Tile  — bundle/export/frame/matrix
     *   - kind=1  Char  — bundle/export/frame/matrix + accessories
     *                     + color zones + dirSuffix + bFix + alpha
     *   - kind=2  Spell — instance_id (resolved against AVM1 state)
     *                     + matrix + alpha
     *   - kind=3  Decal — bundle/export/frame/matrix + alpha
     *
     * Caller contract:
     *   - `kinds[i]` discriminates the placement; out-of-range kinds
     *     are skipped silently (TS-Rust version skew tolerance).
     *   - `bundles`/`exports` are dedup'd; `bundle_idx`/`export_idx`
     *     index into them. Accessory bundles + exports MUST be added
     *     to those tables (callers intern them).
     *   - `frames`/`alphas`/`depths` are per-placement.
     *   - `matrices` is 6 × n floats (`a, b, c, d, tx, ty`).
     *   - **Caller MUST sort placements by `depths` ascending** —
     *     `WorldLayer.snapshotByDepth()` does this. Vello renders in
     *     scene-order; out-of-order placements paint incorrectly.
     *   - `color_zones` is `3 × n` u32; sentinel `u32::MAX` = absent.
     *   - `char_dirs[i]` ASCII direction byte ('R','L','F','B','S'),
     *     or 0 for non-Char.
     *   - `char_b_fix[i]` 0/1 — non-zero triggers AS2 bFix mirror for
     *     accessories with `b_fix=true` mounts (capes, shields).
     *   - **Accessory CSR layout** for variable-length per-Char
     *     accessory lists: `acc_offsets[i]..acc_offsets[i+1]` slices
     *     into `acc_*[]`. `acc_offsets` length is `n+1`. Non-Char
     *     placements emit an empty range.
     *
     * Static foreground tile content prepended via `static_world_scene`
     * (built once by `setStaticWorldTiles`). Per-tick dispatch
     * re-encodes only the dynamic subset (animated tiles + chars +
     * spells) on top.
     *
     * Returns `{texture, textureId, width, height}` on success, NULL
     * on input validation failure or render error.
     * @param {number} target_w
     * @param {number} target_h
     * @param {Uint8Array} kinds
     * @param {string[]} bundles
     * @param {string[]} exports
     * @param {Uint32Array} bundle_idx
     * @param {Uint32Array} export_idx
     * @param {Uint32Array} frames
     * @param {Int32Array} depths
     * @param {Float32Array} matrices
     * @param {Float32Array} alphas
     * @param {Uint32Array} color_zones
     * @param {Uint8Array} char_dirs
     * @param {Uint8Array} char_b_fix
     * @param {Uint32Array} acc_offsets
     * @param {Uint8Array} acc_slots
     * @param {Uint32Array} acc_bundle_idx
     * @param {Uint32Array} acc_export_idx
     * @param {Uint8Array} acc_anim_types
     * @returns {any}
     */
    renderWorldPass(target_w, target_h, kinds, bundles, exports, bundle_idx, export_idx, frames, depths, matrices, alphas, color_zones, char_dirs, char_b_fix, acc_offsets, acc_slots, acc_bundle_idx, acc_export_idx, acc_anim_types) {
        const ptr0 = passArray8ToWasm0(kinds, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(bundles, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(exports, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(bundle_idx, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(export_idx, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArray32ToWasm0(depths, wasm.__wbindgen_malloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF32ToWasm0(matrices, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ptr8 = passArrayF32ToWasm0(alphas, wasm.__wbindgen_malloc);
        const len8 = WASM_VECTOR_LEN;
        const ptr9 = passArray32ToWasm0(color_zones, wasm.__wbindgen_malloc);
        const len9 = WASM_VECTOR_LEN;
        const ptr10 = passArray8ToWasm0(char_dirs, wasm.__wbindgen_malloc);
        const len10 = WASM_VECTOR_LEN;
        const ptr11 = passArray8ToWasm0(char_b_fix, wasm.__wbindgen_malloc);
        const len11 = WASM_VECTOR_LEN;
        const ptr12 = passArray32ToWasm0(acc_offsets, wasm.__wbindgen_malloc);
        const len12 = WASM_VECTOR_LEN;
        const ptr13 = passArray8ToWasm0(acc_slots, wasm.__wbindgen_malloc);
        const len13 = WASM_VECTOR_LEN;
        const ptr14 = passArray32ToWasm0(acc_bundle_idx, wasm.__wbindgen_malloc);
        const len14 = WASM_VECTOR_LEN;
        const ptr15 = passArray32ToWasm0(acc_export_idx, wasm.__wbindgen_malloc);
        const len15 = WASM_VECTOR_LEN;
        const ptr16 = passArray8ToWasm0(acc_anim_types, wasm.__wbindgen_malloc);
        const len16 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderWorldPass(this.__wbg_ptr, target_w, target_h, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8, ptr9, len9, ptr10, len10, ptr11, len11, ptr12, len12, ptr13, len13, ptr14, len14, ptr15, len15, ptr16, len16);
        return ret;
    }
    /**
     * Synthetic world-pass benchmark for the M1 gate. Builds a grid
     * of `n_chars` Char placements, `n_tiles` Tile placements, and
     * `n_spells` Spell placeholders, each pulling from the first
     * loaded character + tile bundle. Renders 1 frame; reports
     * wall-clock ms for the JS caller to gate on.
     *
     * **Architecture gate**: if dispatch P99 exceeds the FPS target
     * budget on the user's machine, the migration aborts before any
     * consumer-side code is written.
     *
     * Returns `{ ms, n_placements, scene_paths_estimated, status }`.
     * @param {number} n_chars
     * @param {number} n_tiles
     * @param {number} n_spells
     * @returns {any}
     */
    renderWorldPassBench(n_chars, n_tiles, n_spells) {
        const ret = wasm.vellorenderer_renderWorldPassBench(this.__wbg_ptr, n_chars, n_tiles, n_spells);
        return ret;
    }
    /**
     * Render the unified L3 World pass (Object2: chars + foreground
     * tiles + spells + decals) directly into a previously-attached
     * `<canvas>` surface. Same encoding contract as `renderWorldPass`
     * (kinds + parallel arrays + accessory CSR) — the only difference
     * is the destination: swap chain frame view instead of an
     * internally-managed off-screen RT.
     * @param {number} surface_id
     * @param {Uint8Array} kinds
     * @param {string[]} bundles
     * @param {string[]} exports
     * @param {Uint32Array} bundle_idx
     * @param {Uint32Array} export_idx
     * @param {Uint32Array} frames
     * @param {Int32Array} depths
     * @param {Float32Array} matrices
     * @param {Float32Array} alphas
     * @param {Uint32Array} color_zones
     * @param {Uint8Array} char_dirs
     * @param {Uint8Array} char_b_fix
     * @param {Uint32Array} acc_offsets
     * @param {Uint8Array} acc_slots
     * @param {Uint32Array} acc_bundle_idx
     * @param {Uint32Array} acc_export_idx
     * @param {Uint8Array} acc_anim_types
     * @returns {boolean}
     */
    renderWorldPassToSurface(surface_id, kinds, bundles, exports, bundle_idx, export_idx, frames, depths, matrices, alphas, color_zones, char_dirs, char_b_fix, acc_offsets, acc_slots, acc_bundle_idx, acc_export_idx, acc_anim_types) {
        const ptr0 = passArray8ToWasm0(kinds, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(bundles, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(exports, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(bundle_idx, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(export_idx, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        const ptr6 = passArray32ToWasm0(depths, wasm.__wbindgen_malloc);
        const len6 = WASM_VECTOR_LEN;
        const ptr7 = passArrayF32ToWasm0(matrices, wasm.__wbindgen_malloc);
        const len7 = WASM_VECTOR_LEN;
        const ptr8 = passArrayF32ToWasm0(alphas, wasm.__wbindgen_malloc);
        const len8 = WASM_VECTOR_LEN;
        const ptr9 = passArray32ToWasm0(color_zones, wasm.__wbindgen_malloc);
        const len9 = WASM_VECTOR_LEN;
        const ptr10 = passArray8ToWasm0(char_dirs, wasm.__wbindgen_malloc);
        const len10 = WASM_VECTOR_LEN;
        const ptr11 = passArray8ToWasm0(char_b_fix, wasm.__wbindgen_malloc);
        const len11 = WASM_VECTOR_LEN;
        const ptr12 = passArray32ToWasm0(acc_offsets, wasm.__wbindgen_malloc);
        const len12 = WASM_VECTOR_LEN;
        const ptr13 = passArray8ToWasm0(acc_slots, wasm.__wbindgen_malloc);
        const len13 = WASM_VECTOR_LEN;
        const ptr14 = passArray32ToWasm0(acc_bundle_idx, wasm.__wbindgen_malloc);
        const len14 = WASM_VECTOR_LEN;
        const ptr15 = passArray32ToWasm0(acc_export_idx, wasm.__wbindgen_malloc);
        const len15 = WASM_VECTOR_LEN;
        const ptr16 = passArray8ToWasm0(acc_anim_types, wasm.__wbindgen_malloc);
        const len16 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_renderWorldPassToSurface(this.__wbg_ptr, surface_id, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8, ptr9, len9, ptr10, len10, ptr11, len11, ptr12, len12, ptr13, len13, ptr14, len14, ptr15, len15, ptr16, len16);
        return ret !== 0;
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
     * Pre-encode every static tile placement into one cached Vello
     * scene. Called by JS whenever the static set changes (map load,
     * zoom step, viewport resize, tactic-mode toggle) — never per
     * Pixi tick. The cached scene persists until the next call;
     * `renderTilePass` appends it into the per-tick frame scene with
     * a memcpy-cost path-buffer copy, eliminating the per-dispatch
     * encoding cost of static cells (typically >99% of the map).
     *
     * Empty input clears the cached scene (i.e. the map has no
     * static placements, e.g. during teardown).
     * @param {string[]} bundles
     * @param {string[]} exports
     * @param {Uint32Array} bundle_idx
     * @param {Uint32Array} export_idx
     * @param {Uint32Array} frames
     * @param {Float32Array} matrices
     */
    setStaticTilePlacements(bundles, exports, bundle_idx, export_idx, frames, matrices) {
        const ptr0 = passArrayJsValueToWasm0(bundles, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(exports, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(bundle_idx, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(export_idx, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF32ToWasm0(matrices, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        wasm.vellorenderer_setStaticTilePlacements(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
    }
    /**
     * Pre-encode the unified L3 World layer's static foreground-tile
     * subset into one cached Vello scene. Called whenever the static
     * set changes (map load, zoom step, tactic-mode toggle); world
     * pass appends it via memcpy on every dispatch. Mirrors
     * `setStaticTilePlacements` for the world pass.
     *
     * Encoding: tile-only flat arrays. Empty input clears cache.
     * @param {string[]} bundles
     * @param {string[]} exports
     * @param {Uint32Array} bundle_idx
     * @param {Uint32Array} export_idx
     * @param {Uint32Array} frames
     * @param {Float32Array} matrices
     */
    setStaticWorldTiles(bundles, exports, bundle_idx, export_idx, frames, matrices) {
        const ptr0 = passArrayJsValueToWasm0(bundles, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(exports, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(bundle_idx, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(export_idx, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArray32ToWasm0(frames, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF32ToWasm0(matrices, wasm.__wbindgen_malloc);
        const len5 = WASM_VECTOR_LEN;
        wasm.vellorenderer_setStaticWorldTiles(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
    }
    /**
     * Update an instance's current anim + direction. Cheap — just
     * state mutation, no rendering. Called from JS on anim swap.
     * The batched `renderSwfWorldLayer` then uses these per-instance
     * values when building each placement's scene fragment.
     * @param {number} instance_id
     * @param {string} anim
     * @param {string} dir_suffix
     * @param {boolean} apply_b_fix
     */
    setSwfCharacterAnim(instance_id, anim, dir_suffix, apply_b_fix) {
        const ptr0 = passStringToWasm0(anim, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(dir_suffix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        wasm.vellorenderer_setSwfCharacterAnim(this.__wbg_ptr, instance_id, ptr0, len0, ptr1, len1, apply_b_fix);
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
     * Render exactly ONE frame of the requested anim into the
     * instance's stable output texture. The texture handle is
     * stable across calls — JS Pixi wraps once at create time and
     * the `ExternalSource` re-samples the GPU memory on each Pixi
     * render. No strip, no sub-rect, no per-frame Texture wrappers.
     *
     * Returns `{ texture, textureId, width, height, anchorX,
     * anchorY }`. Width/height are constant for the instance's
     * lifetime (sized at create); anchor is the SWF (0,0) origin
     * inside the texture.
     * @param {number} instance_id
     * @param {string} anim
     * @param {number} frame
     * @param {string} char_dir_suffix
     * @param {boolean} apply_b_fix
     * @returns {any}
     */
    tickSwfCharacterFrame(instance_id, anim, frame, char_dir_suffix, apply_b_fix) {
        const ptr0 = passStringToWasm0(anim, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(char_dir_suffix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vellorenderer_tickSwfCharacterFrame(this.__wbg_ptr, instance_id, ptr0, len0, frame, ptr1, len1, apply_b_fix);
        return ret;
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
        __wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_49868bde5eb1e745: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_344c8750a8525473: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_914df97fcfa788f2: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_3c3b4f651835fbcb: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_beginComputePass_31742703ea08718a: function(arg0, arg1) {
            const ret = arg0.beginComputePass(arg1);
            return ret;
        },
        __wbg_buffer_a77cc90da4bdb503: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_call_d578befcc3145dee: function() { return handleError(function (arg0, arg1, arg2) {
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
        __wbg_dispatchWorkgroupsIndirect_0b5aa70af5409bf1: function(arg0, arg1, arg2) {
            arg0.dispatchWorkgroupsIndirect(arg1, arg2);
        },
        __wbg_dispatchWorkgroups_84e3afede9542ffe: function(arg0, arg1, arg2, arg3) {
            arg0.dispatchWorkgroups(arg1 >>> 0, arg2 >>> 0, arg3 >>> 0);
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
        __wbg_finish_1f441b2d9fcf60d0: function(arg0, arg1) {
            const ret = arg0.finish(arg1);
            return ret;
        },
        __wbg_finish_d4f7f2d108f44fc0: function(arg0) {
            const ret = arg0.finish();
            return ret;
        },
        __wbg_getContext_8f1ff363618c55da: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getContext(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getCurrentTexture_66ae9639eac28f8b: function() { return handleError(function (arg0) {
            const ret = arg0.getCurrentTexture();
            return ret;
        }, arguments); },
        __wbg_gpu_0d39e2c1a52c373e: function(arg0) {
            const ret = arg0.gpu;
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
        __wbg_limits_0f372ba0de53c8fa: function(arg0) {
            const ret = arg0.limits;
            return ret;
        },
        __wbg_log_9e99203aee8a50b0: function(arg0, arg1) {
            console.log(getStringFromWasm0(arg0, arg1));
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
        __wbg_navigator_9b09ea705d03d227: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_navigator_af52153252bdf29d: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_4f9fafbb3909af72: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_f3c9df4f38f3f798: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_from_slice_2580ff33d0d10520: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_14d7cc391ce53d2c: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h0a41f10693601c0d(a, state0.b, arg0, arg1);
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
        __wbg_new_with_length_41a22191b9bdfd66: function(arg0) {
            const ret = new Uint32Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_6402c1de5dfd4085: function(arg0) {
            const ret = new Float64Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_9cedd08484b73942: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_onSubmittedWorkDone_a33e32762de21b3d: function(arg0) {
            const ret = arg0.onSubmittedWorkDone();
            return ret;
        },
        __wbg_push_6bdbc990be5ac37b: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_abaf92f0bd4e80a4: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_df5a6dac26d818f3: function(arg0) {
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
        __wbg_resolve_0a79de24e9d2267b: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_setBindGroup_af7eca394a335db6: function(arg0, arg1, arg2) {
            arg0.setBindGroup(arg1 >>> 0, arg2);
        },
        __wbg_setPipeline_5cbb15c634c129f9: function(arg0, arg1) {
            arg0.setPipeline(arg1);
        },
        __wbg_set_8ee2d34facb8466e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_access_9d39f60326d67278: function(arg0, arg1) {
            arg0.access = __wbindgen_enum_GpuStorageTextureAccess[arg1];
        },
        __wbg_set_alpha_mode_1ae7e0aa38a8eba8: function(arg0, arg1) {
            arg0.alphaMode = __wbindgen_enum_GpuCanvasAlphaMode[arg1];
        },
        __wbg_set_array_layer_count_83a40d42f8858bba: function(arg0, arg1) {
            arg0.arrayLayerCount = arg1 >>> 0;
        },
        __wbg_set_aspect_9d30d9ca40403001: function(arg0, arg1) {
            arg0.aspect = __wbindgen_enum_GpuTextureAspect[arg1];
        },
        __wbg_set_aspect_f231ddb55e5c30eb: function(arg0, arg1) {
            arg0.aspect = __wbindgen_enum_GpuTextureAspect[arg1];
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
        __wbg_set_bind_group_layouts_ddc70fed7170a2ee: function(arg0, arg1) {
            arg0.bindGroupLayouts = arg1;
        },
        __wbg_set_binding_53105cd45cae6a03: function(arg0, arg1) {
            arg0.binding = arg1 >>> 0;
        },
        __wbg_set_binding_d82fdc5364e5b0c5: function(arg0, arg1) {
            arg0.binding = arg1 >>> 0;
        },
        __wbg_set_buffer_0c946e9b46823a5c: function(arg0, arg1) {
            arg0.buffer = arg1;
        },
        __wbg_set_buffer_21a336fe62828e11: function(arg0, arg1) {
            arg0.buffer = arg1;
        },
        __wbg_set_bytes_per_row_8e39002b1f627e4d: function(arg0, arg1) {
            arg0.bytesPerRow = arg1 >>> 0;
        },
        __wbg_set_code_7a3890c4ffd4f7d4: function(arg0, arg1, arg2) {
            arg0.code = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_compute_ae49764c749c761e: function(arg0, arg1) {
            arg0.compute = arg1;
        },
        __wbg_set_depth_or_array_layers_3601a844f36fa25f: function(arg0, arg1) {
            arg0.depthOrArrayLayers = arg1 >>> 0;
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
        __wbg_set_end_of_pass_write_index_fd531d3ce14a6897: function(arg0, arg1) {
            arg0.endOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_entries_0d3ea75764a89b83: function(arg0, arg1) {
            arg0.entries = arg1;
        },
        __wbg_set_entries_922ec6089646247e: function(arg0, arg1) {
            arg0.entries = arg1;
        },
        __wbg_set_entry_point_b770157326a1b59e: function(arg0, arg1, arg2) {
            arg0.entryPoint = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_external_texture_41cadb0b9faf1919: function(arg0, arg1) {
            arg0.externalTexture = arg1;
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
        __wbg_set_format_fd82439cf1e1f024: function(arg0, arg1) {
            arg0.format = __wbindgen_enum_GpuTextureFormat[arg1];
        },
        __wbg_set_has_dynamic_offset_ebc87f184bf9b1b6: function(arg0, arg1) {
            arg0.hasDynamicOffset = arg1 !== 0;
        },
        __wbg_set_height_26ab95ff99e2b620: function(arg0, arg1) {
            arg0.height = arg1 >>> 0;
        },
        __wbg_set_height_5dc3bf5fd05f449d: function(arg0, arg1) {
            arg0.height = arg1 >>> 0;
        },
        __wbg_set_height_7d0bbaf691aeef8f: function(arg0, arg1) {
            arg0.height = arg1 >>> 0;
        },
        __wbg_set_index_338a66e40fc45dee: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2 >>> 0;
        },
        __wbg_set_index_60d5919b982859a5: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_index_e93e681c9c5b6486: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
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
        __wbg_set_label_76862276b026aadb: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_776849dd514350e6: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_7d273105ca29a945: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_96ff54a6b9baaf90: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_ccc4850f4197dc22: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_layout_0561f0404037d441: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_layout_b990b908a7810b31: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_mapped_at_creation_ff06f7ed93a315dd: function(arg0, arg1) {
            arg0.mappedAtCreation = arg1 !== 0;
        },
        __wbg_set_min_binding_size_746ae443396eb1f4: function(arg0, arg1) {
            arg0.minBindingSize = arg1;
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
        __wbg_set_module_3d1725eef3718083: function(arg0, arg1) {
            arg0.module = arg1;
        },
        __wbg_set_multisampled_2180d2b5d246ae13: function(arg0, arg1) {
            arg0.multisampled = arg1 !== 0;
        },
        __wbg_set_offset_3fadbb3d3dadd4ef: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_offset_fa633343238c309f: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_origin_5531aa268ce97d9d: function(arg0, arg1) {
            arg0.origin = arg1;
        },
        __wbg_set_power_preference_f8956c3fea27c41d: function(arg0, arg1) {
            arg0.powerPreference = __wbindgen_enum_GpuPowerPreference[arg1];
        },
        __wbg_set_query_set_0c94267b03620b43: function(arg0, arg1) {
            arg0.querySet = arg1;
        },
        __wbg_set_required_features_83604ede3c9e0352: function(arg0, arg1) {
            arg0.requiredFeatures = arg1;
        },
        __wbg_set_resource_ec6d0e1222a3141f: function(arg0, arg1) {
            arg0.resource = arg1;
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
        __wbg_set_size_724b776b74138f07: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_size_a15931d6b21f35f9: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_size_e76794a3069a90d7: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_storage_texture_dab6c69662cecb15: function(arg0, arg1) {
            arg0.storageTexture = arg1;
        },
        __wbg_set_texture_8732ea1b0f00cc28: function(arg0, arg1) {
            arg0.texture = arg1;
        },
        __wbg_set_texture_e3dad6e696ee0d00: function(arg0, arg1) {
            arg0.texture = arg1;
        },
        __wbg_set_timestamp_writes_dd465cc31736e9dd: function(arg0, arg1) {
            arg0.timestampWrites = arg1;
        },
        __wbg_set_type_3e89072317fa3a02: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_GpuSamplerBindingType[arg1];
        },
        __wbg_set_type_fc5fb8ab00ac41ab: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_GpuBufferBindingType[arg1];
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
        __wbg_set_width_1ae13bf0b65e6395: function(arg0, arg1) {
            arg0.width = arg1 >>> 0;
        },
        __wbg_set_width_81fa781e87b17891: function(arg0, arg1) {
            arg0.width = arg1 >>> 0;
        },
        __wbg_set_width_a6d5409d7980ccca: function(arg0, arg1) {
            arg0.width = arg1 >>> 0;
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
        __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_24f78b6d23f286ea: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_59fd959c540fe405: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_submit_19b0e21319bc36d7: function(arg0, arg1) {
            arg0.submit(arg1);
        },
        __wbg_then_00eed3ac0b8e82cb: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_479d77cb064907ee: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_a0c8db0381c8994c: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_vellorenderer_new: function(arg0) {
            const ret = VelloRenderer.__wrap(arg0);
            return ret;
        },
        __wbg_warn_2b0a27f629a4bb1e: function(arg0) {
            console.warn(arg0);
        },
        __wbg_writeBuffer_1fa3becf9f9f970e: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.writeBuffer(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbg_writeTexture_16d44079bcc6b839: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.writeTexture(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 193, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h27a34c19f56d26f6);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 253, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__he75b7269c1eb9773);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
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

function wasm_bindgen__convert__closures_____invoke__he75b7269c1eb9773(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__he75b7269c1eb9773(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h27a34c19f56d26f6(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h27a34c19f56d26f6(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h0a41f10693601c0d(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h0a41f10693601c0d(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_GpuBufferBindingType = ["uniform", "storage", "read-only-storage"];


const __wbindgen_enum_GpuCanvasAlphaMode = ["opaque", "premultiplied"];


const __wbindgen_enum_GpuPowerPreference = ["low-power", "high-performance"];


const __wbindgen_enum_GpuSamplerBindingType = ["filtering", "non-filtering", "comparison"];


const __wbindgen_enum_GpuStorageTextureAccess = ["write-only", "read-only", "read-write"];


const __wbindgen_enum_GpuTextureAspect = ["all", "stencil-only", "depth-only"];


const __wbindgen_enum_GpuTextureDimension = ["1d", "2d", "3d"];


const __wbindgen_enum_GpuTextureFormat = ["r8unorm", "r8snorm", "r8uint", "r8sint", "r16uint", "r16sint", "r16float", "rg8unorm", "rg8snorm", "rg8uint", "rg8sint", "r32uint", "r32sint", "r32float", "rg16uint", "rg16sint", "rg16float", "rgba8unorm", "rgba8unorm-srgb", "rgba8snorm", "rgba8uint", "rgba8sint", "bgra8unorm", "bgra8unorm-srgb", "rgb9e5ufloat", "rgb10a2uint", "rgb10a2unorm", "rg11b10ufloat", "rg32uint", "rg32sint", "rg32float", "rgba16uint", "rgba16sint", "rgba16float", "rgba32uint", "rgba32sint", "rgba32float", "stencil8", "depth16unorm", "depth24plus", "depth24plus-stencil8", "depth32float", "depth32float-stencil8", "bc1-rgba-unorm", "bc1-rgba-unorm-srgb", "bc2-rgba-unorm", "bc2-rgba-unorm-srgb", "bc3-rgba-unorm", "bc3-rgba-unorm-srgb", "bc4-r-unorm", "bc4-r-snorm", "bc5-rg-unorm", "bc5-rg-snorm", "bc6h-rgb-ufloat", "bc6h-rgb-float", "bc7-rgba-unorm", "bc7-rgba-unorm-srgb", "etc2-rgb8unorm", "etc2-rgb8unorm-srgb", "etc2-rgb8a1unorm", "etc2-rgb8a1unorm-srgb", "etc2-rgba8unorm", "etc2-rgba8unorm-srgb", "eac-r11unorm", "eac-r11snorm", "eac-rg11unorm", "eac-rg11snorm", "astc-4x4-unorm", "astc-4x4-unorm-srgb", "astc-5x4-unorm", "astc-5x4-unorm-srgb", "astc-5x5-unorm", "astc-5x5-unorm-srgb", "astc-6x5-unorm", "astc-6x5-unorm-srgb", "astc-6x6-unorm", "astc-6x6-unorm-srgb", "astc-8x5-unorm", "astc-8x5-unorm-srgb", "astc-8x6-unorm", "astc-8x6-unorm-srgb", "astc-8x8-unorm", "astc-8x8-unorm-srgb", "astc-10x5-unorm", "astc-10x5-unorm-srgb", "astc-10x6-unorm", "astc-10x6-unorm-srgb", "astc-10x8-unorm", "astc-10x8-unorm-srgb", "astc-10x10-unorm", "astc-10x10-unorm-srgb", "astc-12x10-unorm", "astc-12x10-unorm-srgb", "astc-12x12-unorm", "astc-12x12-unorm-srgb"];


const __wbindgen_enum_GpuTextureSampleType = ["float", "unfilterable-float", "depth", "sint", "uint"];


const __wbindgen_enum_GpuTextureViewDimension = ["1d", "2d", "2d-array", "cube", "cube-array", "3d"];
const VelloRendererFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vellorenderer_free(ptr >>> 0, 1));

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
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
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

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
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

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
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
