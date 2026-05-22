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
     * Batch-copy multiple textures into a destination texture. ONE queue.submit for all copies.
     * `copies` is a flat array: [src_id, dst_x, dst_y, src_id, dst_x, dst_y, ...]
     * All copies go to the same destination texture (the atlas).
     */
    batchCopy(dst_texture_id: number, copies: Float64Array): boolean;
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
     * Free the AVM1 instance + its output GPU texture. JS must call
     * this when the cast completes; otherwise both the AvmRenderer
     * state (typically a few KB) and the texture (a few hundred KB at
     * typical spell sizes) leak for the renderer's lifetime.
     */
    disposeSwfSpellInstance(instance_id: number): void;
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
     * Initialize the renderer. Returns a JS object `{ renderer, adapter, device }`
     * so JS can pass `{ adapter, device }` to Pixi.js.
     */
    static init(): Promise<any>;
    /**
     * Load a .dofasset binary. Returns true on success, false if data is invalid.
     * Never panics — invalid data is handled gracefully to avoid poisoning
     * the wasm-bindgen RefCell (which would break ALL subsequent calls).
     */
    loadAsset(id: number, data: Uint8Array): boolean;
    /**
     * Load a SWF bundle by name (e.g. "g1", "o3", "player10"). Returns true on
     * success.
     */
    loadSwfBundle(name: string, bytes: Uint8Array): boolean;
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
     * Diagnostics: how many `wgpu::Texture`s we hold in
     * `self.textures` (every render target the Vello side has
     * outstanding). Useful for cross-checking the JS-side
     * `liveRenderTextureIds` set.
     */
    rustTexturesCount(): number;
    /**
     * Set the player's three zone colours used by the SWF render path.
     * Each value is `0xRRGGBB`; pass `0` to leave that zone untinted.
     * Mirrors what the dofasset path does via `build_color_replacements`
     * — but applied at render time directly to the SWF, with no bake.
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
     * Diagnostics: WASM linear-memory size in bytes. Tracks how
     * much memory the Rust side itself is consuming (excluding GPU
     * resources, which live in the browser GPU process).
     */
    wasmHeapBytes(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_vellorenderer_free: (a: number, b: number) => void;
    readonly vellorenderer_batchCopy: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_clearPathCache: (a: number) => void;
    readonly vellorenderer_createAtlas: (a: number, b: number, c: number) => any;
    readonly vellorenderer_createSwfSpellInstance: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_disposeSwfSpellInstance: (a: number, b: number) => void;
    readonly vellorenderer_flushFrames: (a: number, b: number) => void;
    readonly vellorenderer_freeAllTextures: (a: number) => void;
    readonly vellorenderer_freeAsset: (a: number, b: number) => void;
    readonly vellorenderer_freeRenderTexture: (a: number, b: number) => void;
    readonly vellorenderer_freeTexture: (a: number, b: number) => void;
    readonly vellorenderer_getAnimationInfo: (a: number, b: number, c: number, d: number) => any;
    readonly vellorenderer_getAnimationMeta: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly vellorenderer_getAnimationNames: (a: number, b: number) => [number, number];
    readonly vellorenderer_getFrameSize: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly vellorenderer_init: () => any;
    readonly vellorenderer_loadAsset: (a: number, b: number, c: number, d: number) => number;
    readonly vellorenderer_loadSwfBundle: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly vellorenderer_pathCacheStats: (a: number) => any;
    readonly vellorenderer_queueFrame: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => any;
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
    readonly vellorenderer_rustGpuObjectCounts: (a: number) => [number, number];
    readonly vellorenderer_rustTexturesCount: (a: number) => number;
    readonly vellorenderer_setSwfPlayerColors: (a: number, b: number, c: number, d: number) => void;
    readonly vellorenderer_setSwfSpellHostCell: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly vellorenderer_setSwfSpellHostNumber: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly vellorenderer_swfAccessoryCanonicalAnimType: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
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
    readonly vellorenderer_wasmHeapBytes: (a: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__h095281891b062598: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h2db092c6386880bd: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h6910d188bddc1532: (a: number, b: number, c: any) => void;
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
