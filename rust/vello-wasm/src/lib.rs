use std::collections::HashMap;

use dofasset_renderer::format::{self, DofAsset};
use dofasset_renderer::scene_builder::{self, AccessoryScene};
use vello::peniko::Color;
use vello::{wgpu, AaConfig, Renderer, RendererOptions};
use wasm_bindgen::prelude::*;


#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format!($($t)*)))
}

/// Extract the raw `GPUDevice` JsValue from a `wgpu::Device` via our patched wgpu.
/// Pixi-WebGPU adopts this device when initialized with `app.init({ gpu })`, so both
/// Vello and Pixi render against the same `GPUDevice` and can share `GPUTexture`s
/// directly (no cross-device handoff).
fn extract_gpu_device(device: &wgpu::Device) -> JsValue {
    device.inner.as_webgpu().inner.clone().into()
}

/// Extract the raw `GPUAdapter` JsValue from a `wgpu::Adapter`.
fn extract_gpu_adapter(adapter: &wgpu::Adapter) -> JsValue {
    adapter.inner.as_webgpu().inner.clone().into()
}

/// Extract the raw `GPUTexture` JsValue from a `wgpu::Texture` so JS callers can
/// wrap it in a Pixi `Texture` via `new ExternalSource({ resource: gpuTexture })`.
fn extract_gpu_texture(texture: &wgpu::Texture) -> JsValue {
    texture.inner.as_webgpu().inner.clone().into()
}

/// Pick the best frame to render an accessory at. Accessories pack
/// 5 directions × 3 sub-frames each (R=0/L=3/F=6/B=9/S=12) but not
/// every accessory authors all directions — some only have R. Walk
/// the canonical fallback chain until we find a frame with non-
/// degenerate symbol bounds.
///
///   requested → F (front) → R (right) → frame 0
///
/// Returns the requested frame if it has geometry; otherwise the
/// first fallback that does. Final fallback (frame 0) is returned
/// unchecked even if degenerate so the caller can still log + skip.
fn pick_accessory_frame(
    doc: &swf_spike::swf_doc::SwfDoc,
    sym: &swf_spike::swf_doc::Symbol,
    requested: u16,
) -> u16 {
    let try_frame = |f: u16| -> bool {
        let b = swf_spike::render::symbol_bounds(doc, sym, f);
        b.width() > 0.0 && b.height() > 0.0
    };
    if try_frame(requested) {
        return requested;
    }
    // Direction → fallback frame index. Walk the closest authored
    // direction first: F (front, frame 6) is a reasonable default
    // because it's the most face-on view; then R (frame 0).
    for fb in [6, 0] {
        if fb == requested {
            continue;
        }
        if try_frame(fb) {
            return fb;
        }
    }
    requested
}

/// One layer of the spell-icon composition: the symbol to render plus the
/// root-timeline placement matrix that positions it on the canonical Flash
/// stage. Either field is required to align all three icon layers without
/// the asymmetry the old `lookup_export(...) vs up_doc.root` approach had.
struct ResolvedIconLayer<'a> {
    symbol: &'a swf_spike::swf_doc::Symbol,
    matrix: vello::kurbo::Affine,
}

/// Find the depth=1 (or first) placement on `doc.root` whose instance name
/// matches `name` and resolve it to `(symbol, matrix)`. Returns `None` if no
/// such placement exists or it doesn't reference a known character. Walks
/// only the first frame — spell icon SWFs are 1-frame so this is safe.
fn resolve_named_root_layer<'a>(
    doc: &'a swf_spike::swf_doc::SwfDoc,
    name: &str,
) -> Option<ResolvedIconLayer<'a>> {
    use swf_spike::swf_doc::OwnedOp;
    for op in &doc.root.ops {
        match op {
            OwnedOp::Place(p) if p.name.as_deref() == Some(name) => {
                let char_id = p.character_id?;
                let symbol = doc.lookup_id(char_id)?;
                return Some(ResolvedIconLayer {
                    symbol,
                    matrix: p.matrix.unwrap_or(vello::kurbo::Affine::IDENTITY),
                });
            }
            OwnedOp::ShowFrame => break,
            _ => {}
        }
    }
    None
}

/// Fallback for up SWFs whose glyph placement on root doesn't carry an
/// instance name: pick the single Place op (unique character) on frame 0.
/// If multiple placements exist, return None — we don't want to pick an
/// arbitrary one.
fn resolve_only_root_layer(
    doc: &swf_spike::swf_doc::SwfDoc,
) -> Option<ResolvedIconLayer<'_>> {
    use swf_spike::swf_doc::OwnedOp;
    let mut found: Option<ResolvedIconLayer<'_>> = None;
    for op in &doc.root.ops {
        match op {
            OwnedOp::Place(p) => {
                if found.is_some() {
                    return None; // ambiguous
                }
                let char_id = p.character_id?;
                let symbol = doc.lookup_id(char_id)?;
                found = Some(ResolvedIconLayer {
                    symbol,
                    matrix: p.matrix.unwrap_or(vello::kurbo::Affine::IDENTITY),
                });
            }
            OwnedOp::ShowFrame => break,
            _ => {}
        }
    }
    found
}

/// A frame queued for batch rendering.
struct QueuedFrame {
    scene: vello::Scene,
    width: u32,
    height: u32,
    dst_x: u32,
    dst_y: u32,
}

/// Persistent target texture for `renderTilePass`. Recreated only when
/// the requested size changes; otherwise reused tick-to-tick to avoid
/// per-frame `create_texture` cost. The cached `tex_id` is what
/// `renderTilePass` returns to JS, so the JS side can stash one Pixi
/// `ExternalSource` and let the GPU storage update in place.
struct TilePassTarget {
    width: u32,
    height: u32,
    texture: wgpu::Texture,
    tex_id: u64,
}

/// Cached uniform bounds for an animation (union across all frames, anchor-aligned).
#[derive(Clone, Copy)]
struct UniformBounds {
    min_x: f64,
    min_y: f64,
    width: f64,
    height: f64,
    /// Frame 0's offset_x/offset_y (reference anchor position)
    trim_x: f64,
    trim_y: f64,
}

#[wasm_bindgen]
pub struct VelloRenderer {
    /// Retained `wgpu::Instance` so we can mint new `wgpu::Surface`s
    /// against arbitrary `<canvas>` elements after init. Each Pixi/HUD
    /// layer that wants its own GPU canvas calls `attachCanvasSurface`
    /// post-init; the instance must outlive every surface we hand out.
    instance: wgpu::Instance,
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    /// JS-supplied id → live `wgpu::Surface`. Surfaces own their canvas
    /// indirectly through the `web_sys::HtmlCanvasElement` JS handle that
    /// was passed to `attachCanvasSurface` and consumed by the
    /// `SurfaceTarget::Canvas` variant. `'static` because the canvas is
    /// not borrowed; the JS GPU pipeline pins it through the JS-side
    /// canvas context.
    surfaces: HashMap<u32, wgpu::Surface<'static>>,
    next_surface_id: u32,
    assets: HashMap<u32, DofAsset>,
    textures: HashMap<u64, wgpu::Texture>,
    next_texture_id: u64,
    queued_frames: Vec<QueuedFrame>,
    anim_bounds: HashMap<String, UniformBounds>,
    /// Raw JS GPUDevice/GPUAdapter — stored because wgpu 28 makes backend fields private.
    raw_gpu_device: JsValue,
    raw_gpu_adapter: JsValue,
    /// SWF bundles loaded by `loadSwfBundle`. Keyed by JS-supplied name (e.g.
    /// "g1", "o3", "player10"). Used by the SWF→Vello spike path that bypasses
    /// the SVG/.dofasset pipeline.
    swf_bundles: HashMap<String, swf_spike::swf_doc::SwfDoc>,
    /// GPU compute pipelines for SVG/SWF filter primitives (gaussian blur,
    /// convolution, color matrix). Lazily initialised because pipeline
    /// creation isn't free.
    swf_filter_pipelines: Option<swf_spike::wgpu_filters::FilterPipelines>,
    /// Per-zone player colours applied during `renderSwfFrame` for any
    /// sprite tagged with an `applyColor` zone. `None` for a zone =
    /// leave fills as authored. RGB packed 0xRRGGBB.
    swf_player_colors: swf_spike::recolor::PlayerColors,
    /// Live AVM1 spell instances, one per active cast. Each holds an
    /// `AvmRenderer` whose state is ticked frame-by-frame as the JS
    /// runtime drives `tickSwfSpellFrame`. Disposed via
    /// `disposeSwfSpellInstance` when the cast completes.
    swf_spell_instances: HashMap<u32, SwfSpellInstance>,
    next_spell_instance_id: u32,
    /// Live character instances — one per visible Dofus 1.29 character
    /// (player, monster, NPC). Each owns:
    ///   - pre-resolved accessory bundle/symbol references (avoids the
    ///     per-call lookup_export + 15-frame bounds padding loops that
    ///     dominate cold `renderSwfStripRangeAccessorized` calls);
    ///   - per-zone player colours (no longer global mutation between
    ///     calls, so two characters with different colours can be
    ///     rendered without `setSwfPlayerColors` interleaving);
    ///   - a stable output GPU texture sized for the worst-case anim
    ///     strip the caller declared at create time. Re-rendering on
    ///     anim swap overwrites the same texture so JS Pixi keeps one
    ///     `ExternalSource` for the character's lifetime — no
    ///     allocation churn, no `freeRenderTexture` per swap.
    swf_character_instances: HashMap<u32, SwfCharacterInstance>,
    next_character_instance_id: u32,
    /// Cached union-of-bounds per `(bundle, export, total_frame_count)`.
    /// `renderSwfStripRange` originally walked `symbol_bounds` once per
    /// frame on every chunk dispatch — for a 200-frame anim split into 4
    /// chunks of 50, that's 800 redundant tree walks. The cache memoises
    /// the result so every chunk after the first reuses it. Keyed by
    /// `(bundle_name, export_name, total_frame_count)` because two
    /// different total counts request different bounds windows (a 50-
    /// frame partial anim has narrower bounds than the full 200-frame
    /// cycle, and we shouldn't return the broader cached value for the
    /// narrower request).
    swf_strip_bounds_cache: HashMap<(String, String, u32), CachedAnimBounds>,
    /// Long-lived render caches, ONE PER BUNDLE. Cache contents (shape
    /// flattened commands, morph interpolations, sprite frame states)
    /// are keyed inside each cache by SWF symbol id (`u16`); since
    /// `DefineShape`/`DefineSprite` ids are only unique *within* one
    /// bundle (g1 + o1 both have a shape id 5 but they're completely
    /// different shapes), a single shared cache across bundles
    /// silently returns the wrong flattened commands and produces
    /// catastrophic visual defects + huge bogus geometry that crashes
    /// WGPU on extreme zoom. Per-bundle keying eliminates the
    /// collision while keeping memoization within a bundle.
    tile_render_caches: HashMap<String, swf_spike::render::cache::RenderCache>,
    /// Reusable wgpu output texture for `renderTilePass`. Recreated
    /// only when the requested target size changes — avoids the per-
    /// tick texture allocation that was burning ~ms each call.
    tile_pass_target: Option<TilePassTarget>,
    /// Pre-encoded Vello scene of every *static* tile placement. Built
    /// once via `setStaticTilePlacements` (called by JS whenever map /
    /// zoom / mapscale changes); then `renderTilePass` appends it into
    /// a fresh per-tick scene and only encodes the small dynamic
    /// placements on top. Drops per-dispatch encoding cost from O(all
    /// cells) to O(animated cells) — the architectural lever for
    /// 60fps with infinite zoom.
    static_tile_scene: Option<vello::Scene>,
    /// Per-tile sub-scenes encoded at twip-identity. Keyed by
    /// `(bundle, export, frame)`. Built once per unique tile and
    /// re-used across cells (multiple cells share the same tile) AND
    /// across zoom levels (zoom only changes the per-cell matrix at
    /// composition time, NOT the sub-scene contents). This is what
    /// makes zoom re-render fast: we don't re-walk symbol trees, we
    /// just `scene.append(subscene, matrix)` for each placement.
    tile_subscenes: HashMap<(String, String, u32), vello::Scene>,
    /// Persistent render target for the unified L3 World layer
    /// (chars + foreground tiles + spells, one depth-sorted Vello
    /// pass per dirty tick). Separate from `tile_pass_target` so the
    /// two layers can coexist without thrashing each other's GPU
    /// storage. Allocated lazily on first `renderWorldPass` dispatch
    /// and reused until the requested target size changes.
    world_pass_target: Option<TilePassTarget>,
    /// Pre-encoded Vello scene of the static foreground tile subset
    /// (Object2 tiles whose `(bundle, export, frame, matrix)` don't
    /// change tick-to-tick). Built once via `setStaticWorldTiles`
    /// when the static set changes (map load, zoom step,
    /// tactic-mode toggle); appended via memcpy on every world-pass
    /// dispatch so per-tick encoding cost is bounded by the dynamic
    /// subset (animated tiles + chars + spells).
    static_world_scene: Option<vello::Scene>,
}

/// Memoised result of the strip pre-pass: bounds union over a frame
/// window plus the frame index where the animation naturally ends (the
/// first all-degenerate frame, capped at the requested total).
#[derive(Clone, Copy)]
struct CachedAnimBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    /// First frame index where bounds went degenerate (= effective end of
    /// authored animation). Always `> 0` (we early-out if frame 0 is
    /// degenerate before populating the cache).
    anim_end: u32,
}

/// One live AVM1 spell cast — owns the `AvmRenderer` (which holds the
/// per-clip `current_frame`, `_alpha`, `_rotation` state across ticks)
/// and the bundle name for `swf_bundles` lookup. Output texture is
/// reused across ticks: each `tick_swf_spell_frame` overwrites its
/// pixels rather than allocating a fresh GPU texture, so the cast's
/// total GPU memory is one texture, not N.
/// Pre-validated accessory entry stored on a `SwfCharacterInstance`.
/// Bundle + export are looked up + sanity-checked at create time; the
/// per-tick render path just resolves them via `swf_bundles` lookup
/// (O(1) HashMap probes) instead of redoing the full
/// `renderSwfStripRangeAccessorized` accessory resolution dance every
/// call.
struct CharacterAccessory {
    slot: u8,
    bundle_name: String,
    export_name: String,
    anim_type: u8,
}

/// One live Dofus 1.29 character — owns the accessory list, color
/// zones, and a STABLE output GPU texture sized to a SINGLE worst-
/// case frame across the seed anims. Each `tickSwfCharacterFrame`
/// re-renders just one frame of the current anim into that texture
/// (overwrites, no allocation). JS Pixi holds one `ExternalSource`
/// for the character's lifetime; sprite.texture never changes.
/// Anim swap is a free state mutation — no Vello call. Frame
/// advance is exactly ONE Vello call per character per tick when
/// it lands on the bundle's authored fps boundary.
///
/// Compared to per-swap `renderSwfStripRangeAccessorized`:
///   - No accessory bundle/symbol lookup (~µs each, but adds up at
///     800 chars × 4 accessories = 3200 lookups/sec).
///   - No 15-frame accessory bounds padding compute (~0.5ms/call).
///   - No bounds union compute (~0.3ms/call after first time).
///   - No `wgpu::Texture` allocation (~0.05ms/call but more
///     importantly: no JS-side `ExternalSource` alloc/destroy churn).
///   - `setSwfPlayerColors` no longer needs to be called as global
///     mutable state — colours are owned per-instance.
///
/// Saves ~1.5-2ms per anim-swap render. At 800 players ×
/// 0.5 swaps/sec, that's ~600-800ms/sec of WASM work eliminated.
struct SwfCharacterInstance {
    bundle_name: String,
    accessories: Vec<CharacterAccessory>,
    colors: swf_spike::recolor::PlayerColors,
    /// Single-frame texture dims (worst-case across seed anims +
    /// accessory padding). Each `tickSwfCharacterFrame` overwrites
    /// these pixels with the current frame's render — sprites and
    /// accessories are placed at the anchor offset below so the
    /// foot/origin stays aligned across anims.
    frame_w: u32,
    frame_h: u32,
    /// Frame-anchored origin offset in pixels (negative twip min).
    /// Same role as the strip's `px_min_x` but applied per-frame.
    px_min_x: f64,
    px_min_y: f64,
    resolution: f32,
    /// Stable output texture allocated once at create time.
    /// In the per-tick batched model (`renderSwfWorldLayer`) this
    /// is no longer used — the layer texture replaces it. Kept so
    /// the per-instance `tickSwfCharacterFrame` API still works.
    texture_id: u64,
    /// Per-(anim, frame) scene cache. The dominant per-call cost
    /// is the SWF tree walk + accessory composition + colour
    /// tinting that builds the `vello::Scene`. With this cache,
    /// the FIRST time a (anim, frame) is requested we build and
    /// store; every subsequent request is just a scene reference
    /// + an `append()` into a parent scene — pure JS-style memcpy.
    scene_cache: HashMap<(String, u32), vello::Scene>,
    /// Current anim + direction + b-fix, set by JS via
    /// `setSwfCharacterAnim` on anim swap. The batched
    /// `renderSwfWorldLayer` reads these per instance instead of
    /// taking them as per-call parameters (which would mean N
    /// string allocations per tick across the wasm-bindgen
    /// boundary).
    current_anim: String,
    current_dir_suffix: char,
    current_apply_b_fix: bool,
}

struct SwfSpellInstance {
    avm: swf_spike::render_avm1::AvmRenderer,
    bundle_name: String,
    /// Pre-computed union of every frame's bounds in twip space; the
    /// per-tick render uses this to keep cell size + anchor uniform.
    bounds_x0: f64,
    bounds_y0: f64,
    /// Output GPU texture allocated once at create time, written into
    /// every tick. Stable `texture_id` so the JS Pixi `ExternalSource`
    /// can hold a single reference for the cast's lifetime.
    texture_id: u64,
    width: u32,
    height: u32,
    resolution: f32,
    /// Wall-clock frame counter — incremented per `tick_swf_spell_frame`
    /// for diagnostics.
    frame: u32,
}

/// Resolve which animation name to use for an accessory.
///
/// Exact mapping from original Dofus 1.29 SWF bytecode (verified sprites 10 & 100).
/// anim_type: 0=static, 1=walk, 2=run
///
/// Cape (slot 2, has L/R/RR/RL):          Shield (slot 4, has L/R):
///   dir  static  walk  run                 dir  static  walk  run
///    R     R      R    RR                   R     R      R     R
///    L     L      L    RL                   L     L      L     L
///    F     R      R    RR                   F     R      L     L
///    B     L      L    RL                   B     R      L     R
///    S     R      L     L                   S     R      R     R
///
/// Hat (slot 1, has R/L/F/B/S): uses dir_suffix directly.
/// Weapon (slot 0, has WR/WL/WF/WB/WS for walk/run, R/L/F/B/S for static): uses dir_suffix.
/// Pet (slot 3, has L/R/WL/WR/etc): tries W-prefix for walk/run, else dir_suffix.
fn resolve_accessory_anim(
    acc_asset: &DofAsset,
    animation: &str,
    dir_suffix: &str,
    anim_type: u8,
    slot_id: u8,
) -> Option<String> {
    // 1. Exact animation name match (e.g., "walkR" in the accessory)
    if acc_asset.animation_map.contains_key(animation) {
        return Some(animation.to_string());
    }

    // 2. W-prefix for walk/run (pet accessories have WR, WL, WS, WF, WB)
    if anim_type > 0 {
        let w_dir = format!("W{}", dir_suffix);
        if acc_asset.animation_map.contains_key(w_dir.as_str()) {
            return Some(w_dir);
        }
    }

    // 3. Slot-specific direction lookup from the Dofus truth table
    let candidates: &[&str] = match slot_id {
        // Cape
        2 => match (anim_type, dir_suffix) {
            (0, "R") | (0, "F") | (0, "S") => &["R", "L"],
            (0, "B") | (0, "L")            => &["L", "R"],
            (1, "R") | (1, "F")            => &["R", "L"],
            (1, "B") | (1, "L") | (1, "S") => &["L", "R"],
            (2, "R") | (2, "F")            => &["RR", "R", "L"],
            (2, "B") | (2, "L")            => &["RL", "L", "R"],
            (2, _)                          => &["L", "R"],
            _                               => &["R", "L"],
        },
        // Shield
        4 => match (anim_type, dir_suffix) {
            (0, "L")                        => &["L", "R"],
            (0, _)                          => &["R", "L"],
            (1, "F") | (1, "B") | (1, "L") => &["L", "R"],
            (1, _)                          => &["R", "L"],
            (2, "F") | (2, "L")            => &["L", "R"],
            (2, _)                          => &["R", "L"],
            _                               => &["R", "L"],
        },
        // Hat, weapon, pet, default: try dir_suffix, then common fallbacks
        _ => match dir_suffix {
            "R" => &["R", "S", "F"],
            "L" => &["L", "S", "F"],
            "F" => &["F", "S", "R"],
            "B" => &["B", "S", "L"],
            "S" => &["S", "R", "F"],
            _   => &["R", "L", "S"],
        },
    };

    for &c in candidates {
        if acc_asset.animation_map.contains_key(c) {
            return Some(c.to_string());
        }
    }

    None
}

/// Build accessory scenes from .dofasset data.
/// `acc_info` is a flat array of pairs: [asset_id, slot_id, asset_id, slot_id, ...]
/// Each accessory renders using the same animation name and frame index as the character.
/// Falls back to direction suffix (e.g., "R") if full animation name (e.g., "walkR") not found.
///
/// `char_asset` is the character being rendered — its current frame's
/// `accessory_slots[*].side` provides the authoritative per-slot frame name
/// (captured from the SWF's `applyAccessory(mc, slot, side, …)` call). When
/// an override is present for a slot, it wins over the direction truth table.
fn build_accessory_scenes(
    assets: &HashMap<u32, DofAsset>,
    acc_info: &Option<Vec<u32>>,
    animation: &str,
    frame_index: usize,
    resolution: f32,
    char_asset: &DofAsset,
) -> Vec<AccessoryScene> {
    let Some(info) = acc_info else { return Vec::new() };
    if info.len() < 2 { return Vec::new(); }

    // Extract direction suffix for fallback (e.g., "walkR" → "R")
    let dir_suffix = if animation.len() >= 2 {
        &animation[animation.len()-1..]
    } else {
        "S"
    };

    // Classify animation type: static, walk, or run
    let anim_type = if animation.starts_with("run") { 2u8 }
        else if animation.starts_with("static") { 0 }
        else { 1 }; // walk and everything else

    // Per-slot side overrides baked into the character asset at compile time.
    let mut side_overrides: HashMap<u8, &str> = HashMap::new();
    if let Some(&char_anim_idx) = char_asset.animation_map.get(animation) {
        let char_anim = &char_asset.animations[char_anim_idx];
        if !char_anim.frame_ids.is_empty() {
            let fid = char_anim.frame_ids[frame_index % char_anim.frame_ids.len()] as usize;
            if let Some(char_frame) = char_asset.frames.get(fid) {
                for slot in &char_frame.accessory_slots {
                    if !slot.side.is_empty() {
                        side_overrides.insert(slot.slot_id, slot.side.as_str());
                    }
                }
            }
        }
    }

    let mut scenes = Vec::new();
    for pair in info.chunks(2) {
        let acc_asset_id = pair[0];
        let slot_id = pair[1] as u8;

        let Some(acc_asset) = assets.get(&acc_asset_id) else { continue };

        // Resolve the accessory animation name.
        // Priority: SWF-baked side override → exact anim match → direction table.
        let resolved_anim = if let Some(&side) = side_overrides.get(&slot_id) {
            if acc_asset.animation_map.contains_key(side) {
                Some(side.to_string())
            } else {
                resolve_accessory_anim(acc_asset, animation, dir_suffix, anim_type, slot_id)
            }
        } else {
            resolve_accessory_anim(acc_asset, animation, dir_suffix, anim_type, slot_id)
        };
        let Some(resolved_anim) = resolved_anim else { continue };

        let &anim_idx = acc_asset.animation_map.get(resolved_anim.as_str()).unwrap();
        let anim = &acc_asset.animations[anim_idx];
        if anim.frame_ids.is_empty() { continue; }

        let actual_frame = frame_index % anim.frame_ids.len();
        let scene = scene_builder::build_accessory_scene_unscaled(
            acc_asset, &resolved_anim, actual_frame, resolution,
        );

        // Use net offset (where Flash 0,0 actually lands in the rendered scene)
        // instead of SWF metadata offset. Same fix as character positioning —
        // eliminates ~0.5px discrepancy that displaces accessories.
        let global_fid = anim.frame_ids[actual_frame] as usize;
        let (offset_x, offset_y, acc_w, acc_h) = if let Some(acc_frame) = acc_asset.frames.get(global_fid) {
            let net = scene_builder::compute_net_offset(acc_frame, &acc_asset.transforms);
            (
                -net.0,  // negate: acc_local ADDS this to slot position
                -net.1,
                acc_frame.clip_rect[2] as f64,
                acc_frame.clip_rect[3] as f64,
            )
        } else {
            (anim.offset_x as f64, anim.offset_y as f64, 0.0, 0.0)
        };

        scenes.push(AccessoryScene {
            slot_id,
            scene,
            offset_x,
            offset_y,
            width: acc_w,
            height: acc_h,
        });
    }
    scenes
}

#[wasm_bindgen]
impl VelloRenderer {
    /// Initialize the renderer. Returns a JS object `{ renderer, adapter, device }`
    /// so JS can pass `{ adapter, device }` to Pixi.js.
    #[wasm_bindgen(js_name = "init")]
    pub async fn init() -> Result<JsValue, JsValue> {
        console_error_panic_hook::set_once();
        console_log!("VelloRenderer: initializing WebGPU...");

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL,
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                ..Default::default()
            })
            .await
            .map_err(|_| JsValue::from_str("No WebGPU adapter found"))?;

        let adapter_limits = adapter.limits();
        console_log!("VelloRenderer: adapter = {:?}", adapter.get_info().name);
        console_log!(
            "VelloRenderer: adapter limits: maxSampledTextures={}, maxSamplers={}",
            adapter_limits.max_sampled_textures_per_shader_stage,
            adapter_limits.max_samplers_per_shader_stage,
        );

        // Start from defaults (Chrome auto-raises most limits) and only
        // override the specific limits we need for large atlas textures.
        let mut required_limits = wgpu::Limits::default();
        required_limits.max_texture_dimension_2d = adapter_limits.max_texture_dimension_2d;
        required_limits.max_buffer_size = adapter_limits.max_buffer_size;
        required_limits.max_storage_buffer_binding_size = adapter_limits.max_storage_buffer_binding_size;
        console_log!("VelloRenderer: maxTexDim2D={} maxBufSize={}",
            required_limits.max_texture_dimension_2d, required_limits.max_buffer_size);

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("vello-pixi-shared"),
                    required_features: wgpu::Features::empty(),
                    required_limits,
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("Device request failed: {e}")))?;

        let renderer = Renderer::new(
            &device,
            RendererOptions {
                use_cpu: false,
                antialiasing_support: vello::AaSupport::area_only(),
                num_init_threads: std::num::NonZeroUsize::new(1),
                pipeline_cache: None,
            },
        )
        .map_err(|e| JsValue::from_str(&format!("Vello renderer init failed: {e}")))?;

        console_log!("VelloRenderer: ready");

        // Extract raw GPU handles from wgpu's wrapper types for Pixi.js sharing.
        // wgpu 28 makes backend fields private, but the struct layout is known:
        //   Device { inner: DispatchDevice }
        // Extract raw GPU handles for Pixi.js (via patched wgpu with pub inner fields)
        let gpu_adapter = extract_gpu_adapter(&adapter);
        let gpu_device = extract_gpu_device(&device);

        let vello = VelloRenderer {
            instance,
            device,
            queue,
            renderer,
            surfaces: HashMap::new(),
            next_surface_id: 1,
            assets: HashMap::new(),
            textures: HashMap::new(),
            next_texture_id: 0,
            queued_frames: Vec::new(),
            anim_bounds: HashMap::new(),
            raw_gpu_device: gpu_device.clone(),
            raw_gpu_adapter: gpu_adapter.clone(),
            swf_bundles: HashMap::new(),
            swf_filter_pipelines: None,
            swf_player_colors: swf_spike::recolor::PlayerColors::default(),
            swf_spell_instances: HashMap::new(),
            next_spell_instance_id: 1,
            swf_character_instances: HashMap::new(),
            next_character_instance_id: 1,
            swf_strip_bounds_cache: HashMap::new(),
            tile_render_caches: HashMap::new(),
            tile_pass_target: None,
            static_tile_scene: None,
            tile_subscenes: HashMap::new(),
            world_pass_target: None,
            static_world_scene: None,
        };

        // Return { renderer, adapter, device, maxTextureSize }
        let result = js_sys::Object::new();
        js_sys::Reflect::set(&result, &"renderer".into(), &vello.into())?;
        js_sys::Reflect::set(&result, &"adapter".into(), &gpu_adapter)?;
        js_sys::Reflect::set(&result, &"device".into(), &gpu_device)?;
        js_sys::Reflect::set(&result, &"maxTextureSize".into(), &JsValue::from(adapter_limits.max_texture_dimension_2d))?;

        Ok(result.into())
    }

    /// Load a .dofasset binary. Returns true on success, false if data is invalid.
    /// Never panics — invalid data is handled gracefully to avoid poisoning
    /// the wasm-bindgen RefCell (which would break ALL subsequent calls).
    #[wasm_bindgen(js_name = "loadAsset")]
    pub fn load_asset(&mut self, id: u32, data: &[u8]) -> bool {
        // Validate magic bytes before attempting full parse to avoid panics
        if data.len() < 4 || &data[0..4] != b"DASF" {
            return false;
        }
        let asset = format::load(data);
        console_log!(
            "VelloRenderer: loaded asset {} ({} anims, {} frames)",
            id,
            asset.animations.len(),
            asset.frames.len()
        );
        self.assets.insert(id, asset);
        true
    }

    /// Free a loaded asset.
    #[wasm_bindgen(js_name = "freeAsset")]
    pub fn free_asset(&mut self, id: u32) {
        self.assets.remove(&id);
    }

    // ----------------------------------------------------------------------
    // SWF spike: load a raw SWF and render its exported sprites/shapes
    // directly through swf-spike — no SVG, no .dofasset.

    /// Load a SWF bundle by name (e.g. "g1", "o3", "player10"). Returns true on
    /// success.
    #[wasm_bindgen(js_name = "loadSwfBundle")]
    pub fn load_swf_bundle(&mut self, name: &str, bytes: &[u8]) -> bool {
        match swf_spike::swf_doc::SwfDoc::from_bytes(bytes) {
            Ok(doc) => {
                console_log!(
                    "VelloRenderer: loaded SWF bundle `{}` ({} bytes, {} characters, {} exports)",
                    name,
                    bytes.len(),
                    doc.by_id.len(),
                    doc.by_name.len()
                );
                // Invalidate any cached bounds for this bundle — a reload
                // (e.g. asset hot-swap) could change the export's
                // geometry, so the cached values are stale.
                self.swf_strip_bounds_cache
                    .retain(|(b, _, _), _| b != name);
                self.swf_bundles.insert(name.to_string(), doc);
                true
            }
            Err(e) => {
                console_log!("VelloRenderer: SWF bundle `{}` parse failed: {e}", name);
                false
            }
        }
    }

    /// Render an exported symbol from a loaded SWF bundle to a fresh GPUTexture.
    /// `bundle` is the name passed to `loadSwfBundle`. `export` is the SWF
    /// export name (e.g. "168" for tile id 168, or "walkR"/"staticR" for the
    /// player). `frame` selects which timeline frame to render (0 for tiles).
    /// `resolution` is the output pixels-per-twip multiplier (≈ zoom).
    ///
    /// Returns `{ texture: GPUTexture, textureId, width, height, anchorX,
    /// anchorY }` — `anchorX/Y` is the position of the SWF (0,0) origin
    /// inside the rendered texture, so the caller can place the sprite at
    /// `(cellCenterX - anchorX, cellCenterY - anchorY)`.
    #[wasm_bindgen(js_name = "renderSwfFrame")]
    pub fn render_swf_frame(
        &mut self,
        bundle: &str,
        export: &str,
        frame: u32,
        resolution: f32,
    ) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };

        // 1. Twip-space bounds of this symbol at the requested frame.
        let bounds = swf_spike::render::symbol_bounds(doc, symbol, frame as u16);
        if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
            // Log this since "objects mostly transparent" likely correlates
            // with degenerate bounds — e.g. a sprite that recurses into
            // children whose Shape::shape_bounds are unset, leaving the
            // union as zero.
            console_log!(
                "renderSwfFrame: degenerate bounds for {bundle}/{export}@frame{frame} (w={} h={}) — texture skipped",
                bounds.width(),
                bounds.height(),
            );
            return JsValue::NULL;
        }

        // SWF twip → pixel = 1/20. Combined with `resolution` for zoom.
        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0; // half-pixel anti-alias padding
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let w = ((px_max_x - px_min_x) as u32).max(1);
        let h = ((px_max_y - px_min_y) as u32).max(1);

        // The transform painted into the scene: scale twips→px, then offset so
        // the bounds' min-corner lands at (0,0) inside the texture.
        let xform = vello::kurbo::Affine::scale(scale)
            .then_translate(vello::kurbo::Vec2::new(-px_min_x, -px_min_y));

        let mut scene = vello::Scene::new();
        // Lazily init the filter pipelines (compute shader compilation isn't
        // free — defer until the first SWF render that might need them).
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        // Cloning the doc so we can hold &self borrows for ctx borrow_mut.
        // Actually we can't mutably borrow self.renderer while immutably
        // holding self.swf_bundles — work around by carving out a context
        // that only borrows the pieces we need.
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
        let mut ctx = swf_spike::render::WgpuCtx {
            device: &self.device,
            queue: &self.queue,
            renderer: &mut self.renderer,
            filter_pipelines,
            output_scale: scale,
        };
        // Use the tinted entry point so player sprites pick up the
        // `swf_player_colors` set via `setSwfPlayerColors`. When no
        // colours have been set (default = all None), the tinted path
        // is a no-op for tiles/spells (they have no zoned sprites).
        swf_spike::render::render_symbol_with_ctx_tinted(
            &mut ctx,
            doc,
            symbol,
            &mut scene,
            xform,
            frame as u16,
            self.swf_player_colors,
        );

        // Same texture descriptor as the dofasset path (lines 935, 1112, 1283).
        // CRUCIAL: `view_formats` MUST stay empty. Adding `Rgba8UnormSrgb` as a
        // view alias would let Pixi sample the bytes through an sRGB-decoding
        // view — double-decoding the gamma curve since Vello already wrote
        // sRGB-encoded bytes — and the whole frame ends up visibly darker
        // (washed-out greens, muddy stones). The dofasset path proved this by
        // working correctly with `&[]` and the same `"no-premultiply-alpha"`.
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_frame"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: w,
            height: h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfFrame: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        // SWF (0,0) lands at (-px_min_x, -px_min_y) inside the texture.
        let anchor_x = -px_min_x;
        let anchor_y = -px_min_y;

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(anchor_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(anchor_y));
        result.into()
    }

    /// Run AVM1 across the spell SWF's main timeline and pack every frame
    /// into a 2D-grid composite texture in a single Vello dispatch. Mirrors
    /// the asset-pipeline's spell strip bake but at runtime — no `.dofasset`
    /// frame data, just the SWF + the in-renderer AVM1 emulator from
    /// `swf_spike::render_avm1::AvmRenderer`.
    ///
    /// "Main timeline" = the longest `DefineSprite` in the SWF (Dofus spell
    /// convention, e.g. spell 802 sprite id=10 has 129 frames). The
    /// renderer is constructed once per call, ticked → rendered → advanced
    /// for each frame, ensuring AS2 side-effects (`gotoAndStop`, `_alpha`
    /// fades, `_rotation += 0.66`, etc.) drive the visuals exactly the way
    /// the canonical Flash client did.
    ///
    /// Bounds: union of every frame's `symbol_bounds(main_sym)`. Each cell
    /// is the same size, giving a uniform anchor across the strip — Pixi
    /// can swap textures without per-frame pivot reapplies.
    #[wasm_bindgen(js_name = "renderSwfSpellStrip")]
    pub fn render_swf_spell_strip(
        &mut self,
        bundle: &str,
        resolution: f32,
    ) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };

        // Pick the longest `DefineSprite` as the main animation.
        let mut main_sprite_id: Option<u16> = None;
        let mut main_frames: u16 = 0;
        for (id, sym) in &doc.by_id {
            if let swf_spike::swf_doc::Symbol::Sprite(sp) = sym {
                if sp.num_frames > main_frames {
                    main_frames = sp.num_frames;
                    main_sprite_id = Some(*id);
                }
            }
        }
        let Some(main_id) = main_sprite_id else {
            console_log!("renderSwfSpellStrip: no DefineSprite in {bundle}");
            return JsValue::NULL;
        };
        let frame_count = main_frames.max(1);
        let Some(main_sym) = doc.by_id.get(&main_id) else {
            return JsValue::NULL;
        };

        // Compute the union of all frame bounds so each grid cell is
        // identical — uniform anchor, no jitter on frame swap.
        let mut union: Option<vello::kurbo::Rect> = None;
        for f in 0..frame_count {
            let r = swf_spike::render::symbol_bounds(doc, main_sym, f);
            if r.width() > 0.0 && r.height() > 0.0 {
                union = Some(match union {
                    None => r,
                    Some(prev) => prev.union(r),
                });
            }
        }
        let Some(bounds) = union else {
            console_log!(
                "renderSwfSpellStrip: degenerate bounds across all frames for {bundle}"
            );
            return JsValue::NULL;
        };

        let scale = f64::from(resolution) / 20.0;
        let pad = 2.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let frame_w = ((px_max_x - px_min_x) as u32).max(1);
        let frame_h = ((px_max_y - px_min_y) as u32).max(1);

        // 2D grid: cap columns so the strip stays within Vello's 16384
        // texture limit. Spell 101 with 189 frames + 100×100 cells lays
        // out as 16 cols × 12 rows, well within budget.
        let max_cols = (16384u32 / frame_w).max(1) as usize;
        let cols = (frame_count as usize).min(max_cols);
        let rows = (frame_count as usize + cols - 1) / cols;
        let strip_w = frame_w * cols as u32;
        let strip_h = frame_h * rows as u32;
        if strip_w > 16384 || strip_h > 16384 {
            console_log!(
                "renderSwfSpellStrip: {strip_w}x{strip_h} exceeds GPU limits"
            );
            return JsValue::NULL;
        }

        // Lazily init filter pipelines — spells with DropShadow/Glow/Blur
        // will route through `apply_compute` on native, halo on WASM (per
        // the cfg-gate in `swf_spike::render::filter::apply`).
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();

        // Wrap the doc's root timeline as a Symbol::Sprite — AvmRenderer
        // expects to walk from root, and a spell SWF's root just places
        // the main sprite at depth 1.
        let root_sym =
            swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());

        let mut renderer =
            swf_spike::render_avm1::AvmRenderer::new(doc.root.num_frames);
        let mut scene = vello::Scene::new();

        for i in 0..frame_count as usize {
            // Order is canonical (per `feedback_swf_avm1_tick_advance`):
            // tick → render → advance. Combining tick+advance causes
            // instance_map misses + parent-state leakage.
            renderer.tick(doc, &root_sym);

            let col = i % cols;
            let row = i / cols;
            let cell_x = (col * frame_w as usize) as f64;
            let cell_y = (row * frame_h as usize) as f64;
            let xform = vello::kurbo::Affine::scale(scale).then_translate(
                vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y + cell_y),
            );

            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            renderer.render(doc, &root_sym, &mut scene, xform, Some(&mut ctx));

            renderer.advance(doc, &root_sym);
        }

        // Single render of the composite scene to one storage texture.
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_spell_strip"),
            size: wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: strip_w,
            height: strip_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfSpellStrip: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ =
            js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ =
            js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(cols as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"frameCount".into(),
            &JsValue::from(frame_count as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        // SWF header fps so the runtime can advance at the right rate.
        let _ = js_sys::Reflect::set(
            &result,
            &"fps".into(),
            &JsValue::from(doc.frame_rate),
        );
        result.into()
    }

    /// Compose a spell icon by overlaying the canonical 1.29 trio in ONE
    /// Vello dispatch:
    ///
    ///   1. `_spellBackground` from `back_bundle` — the filled disc, tinted to `bc_rgb`.
    ///   2. `_spellFrame` from `back_bundle` — the ring border, tinted to `fc_rgb`.
    ///   3. The `up_bundle` SWF's root timeline — the glyph, tinted to `pc_rgb`.
    ///
    /// All three render with a flat-fill `OwnedColorTransform` (multiply
    /// RGB by 0, add the target colour), mirroring the asset-pipeline's
    /// `recolorEl` step but applied at render time inside Vello — no PNG
    /// composer, no Pixi filter, no readback. Output is a single GPU
    /// texture sized to the disc's bounding box (which contains the frame
    /// and glyph by SWF stage convention).
    #[wasm_bindgen(js_name = "renderSwfSpellIcon")]
    pub fn render_swf_spell_icon(
        &mut self,
        back_bundle: &str,
        up_bundle: &str,
        bc_rgb: u32,
        fc_rgb: u32,
        pc_rgb: u32,
        resolution: f32,
    ) -> JsValue {
        let Some((scene, w, h)) = self.prepare_spell_icon_scene(
            back_bundle, up_bundle, bc_rgb, fc_rgb, pc_rgb, resolution,
        ) else {
            return JsValue::NULL;
        };

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_spell_icon"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: w,
            height: h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfSpellIcon: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        result.into()
    }

    /// Render the spell-icon composition (back disc + frame + glyph,
    /// each flat-tinted) into a previously-attached `<canvas>` surface.
    /// Returns the painted (width, height) so the React caller can size
    /// its `<canvas>` slot to the intrinsic content rectangle.
    /// Returns `0` width/height on any failure (missing bundle, empty
    /// bounds, surface dispatch error).
    #[wasm_bindgen(js_name = "renderSwfSpellIconToSurface")]
    pub fn render_swf_spell_icon_to_surface(
        &mut self,
        surface_id: u32,
        back_bundle: &str,
        up_bundle: &str,
        bc_rgb: u32,
        fc_rgb: u32,
        pc_rgb: u32,
        resolution: f32,
    ) -> JsValue {
        if !self.surfaces.contains_key(&surface_id) {
            console_log!(
                "renderSwfSpellIconToSurface: unknown surface id {surface_id}"
            );
            return JsValue::NULL;
        }
        let Some((scene, w, h)) = self.prepare_spell_icon_scene(
            back_bundle, up_bundle, bc_rgb, fc_rgb, pc_rgb, resolution,
        ) else {
            return JsValue::NULL;
        };
        if !self.dispatch_scene_to_surface(
            surface_id,
            "renderSwfSpellIconToSurface",
            &scene,
        ) {
            return JsValue::NULL;
        }
        // Hand back the painted bounds so React can size the slot.
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        result.into()
    }

    /// Pure-bounds probe for the spell-icon composition. Returns the
    /// natural pixel rectangle `{width, height}` at resolution 1
    /// without ever touching the GPU. Replaces the 16×16 throwaway
    /// probe-render that previous versions used to discover natural
    /// size — a CPU-only `symbol_bounds` walk costs microseconds vs.
    /// the milliseconds of an attach-render-detach roundtrip.
    ///
    /// Returns NULL on missing bundle, missing required layers, or
    /// degenerate root bounds.
    #[wasm_bindgen(js_name = "swfSpellIconNaturalSize")]
    pub fn swf_spell_icon_natural_size(
        &self,
        back_bundle: &str,
        up_bundle: &str,
    ) -> JsValue {
        let Some(back_doc) = self.swf_bundles.get(back_bundle) else {
            return JsValue::NULL;
        };
        let Some(up_doc) = self.swf_bundles.get(up_bundle) else {
            return JsValue::NULL;
        };
        // Same layer-resolution preconditions the actual render uses;
        // returning a size for an icon that won't render is worse than
        // returning null.
        if resolve_named_root_layer(back_doc, "_spellBackground").is_none()
            || resolve_named_root_layer(back_doc, "_spellFrame").is_none()
        {
            return JsValue::NULL;
        }
        if resolve_named_root_layer(up_doc, "_spellPrint").is_none()
            && resolve_only_root_layer(up_doc).is_none()
        {
            return JsValue::NULL;
        }

        let bounds = swf_spike::render::symbol_bounds(
            back_doc,
            &swf_spike::swf_doc::Symbol::Sprite(back_doc.root.clone()),
            0,
        );
        if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
            return JsValue::NULL;
        }
        // Mirror prepare_spell_icon_scene's pixel-rectangle math at
        // resolution=1 so the returned (w, h) matches what an actual
        // render would produce at that resolution. Caller computes
        // `renderResolution = pixelSize / natural`.
        let scale = 1.0 / 20.0;
        let pad = 1.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let w = ((px_max_x - px_min_x) as u32).max(1);
        let h = ((px_max_y - px_min_y) as u32).max(1);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        result.into()
    }

    /// Pure-bounds probe for an SWF root timeline. Returns
    /// `{width, height}` at resolution 1 without touching the GPU.
    /// Used by the fighter-portrait renderer (banner artworks) to
    /// compute the natural long-edge before allocating a target
    /// canvas. Returns NULL on missing bundle or degenerate bounds.
    #[wasm_bindgen(js_name = "swfRootNaturalSize")]
    pub fn swf_root_natural_size(&self, bundle: &str, frame: u32) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let root_symbol =
            swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());
        let bounds = swf_spike::render::symbol_bounds(
            doc,
            &root_symbol,
            frame as u16,
        );
        if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
            return JsValue::NULL;
        }
        let scale = 1.0 / 20.0;
        let pad = 1.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let w = ((px_max_x - px_min_x) as u32).max(1);
        let h = ((px_max_y - px_min_y) as u32).max(1);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        result.into()
    }

    /// Spell-icon scene assembly — shared by `renderSwfSpellIcon`
    /// (texture output, transitional) and `renderSwfSpellIconToSurface`
    /// (canonical, per-canvas Vello). Returns `None` on missing bundle
    /// or degenerate root bounds. Returned `(scene, w, h)` is the
    /// natural pixel rectangle at the supplied `resolution`.
    fn prepare_spell_icon_scene(
        &self,
        back_bundle: &str,
        up_bundle: &str,
        bc_rgb: u32,
        fc_rgb: u32,
        pc_rgb: u32,
        resolution: f32,
    ) -> Option<(vello::Scene, u32, u32)> {
        let back_doc = self.swf_bundles.get(back_bundle)?;
        let up_doc = self.swf_bundles.get(up_bundle)?;

        let bg_layer = resolve_named_root_layer(back_doc, "_spellBackground")?;
        let frame_layer = resolve_named_root_layer(back_doc, "_spellFrame")?;
        let glyph_layer = resolve_named_root_layer(up_doc, "_spellPrint")
            .or_else(|| resolve_only_root_layer(up_doc))?;

        let bounds = swf_spike::render::symbol_bounds(
            back_doc,
            &swf_spike::swf_doc::Symbol::Sprite(back_doc.root.clone()),
            0,
        );
        if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
            return None;
        }

        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let w = ((px_max_x - px_min_x) as u32).max(1);
        let h = ((px_max_y - px_min_y) as u32).max(1);

        let xform = vello::kurbo::Affine::scale(scale)
            .then_translate(vello::kurbo::Vec2::new(-px_min_x, -px_min_y));

        fn flat_fill(rgb: u32) -> swf_spike::swf_doc::OwnedColorTransform {
            let r = ((rgb >> 16) & 0xff) as f32 / 255.0;
            let g = ((rgb >> 8) & 0xff) as f32 / 255.0;
            let b = (rgb & 0xff) as f32 / 255.0;
            swf_spike::swf_doc::OwnedColorTransform {
                mult_r: 0.0,
                mult_g: 0.0,
                mult_b: 0.0,
                mult_a: 1.0,
                add_r: r,
                add_g: g,
                add_b: b,
                add_a: 0.0,
            }
        }

        let bg_xform = xform * bg_layer.matrix;
        let frame_xform = xform * frame_layer.matrix;
        let glyph_xform = xform * glyph_layer.matrix;

        let mut scene = vello::Scene::new();
        swf_spike::render::render_symbol_xformed(
            back_doc, bg_layer.symbol, &mut scene, bg_xform, 0, flat_fill(bc_rgb),
        );
        swf_spike::render::render_symbol_xformed(
            back_doc, frame_layer.symbol, &mut scene, frame_xform, 0, flat_fill(fc_rgb),
        );
        swf_spike::render::render_symbol_xformed(
            up_doc, glyph_layer.symbol, &mut scene, glyph_xform, 0, flat_fill(pc_rgb),
        );
        Some((scene, w, h))
    }

    /// Create a live AVM1 spell instance: allocates an `AvmRenderer`
    /// whose tick state will be advanced by per-frame
    /// `tickSwfSpellFrame` calls, plus a single output GPU texture sized
    /// to the union of all frame bounds (so anchor + canvas stay
    /// uniform across the cast). Returns the instance id JS uses to
    /// drive subsequent host-var sets, ticks, and dispose. Returns 0
    /// on failure.
    #[wasm_bindgen(js_name = "createSwfSpellInstance")]
    pub fn create_swf_spell_instance(
        &mut self,
        bundle: &str,
        resolution: f32,
    ) -> u32 {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return 0;
        };
        // Find longest sprite (the main spell timeline) for bounds calc.
        let mut main_sprite_id: Option<u16> = None;
        let mut main_frames: u16 = 0;
        for (id, sym) in &doc.by_id {
            if let swf_spike::swf_doc::Symbol::Sprite(sp) = sym {
                if sp.num_frames > main_frames {
                    main_frames = sp.num_frames;
                    main_sprite_id = Some(*id);
                }
            }
        }
        let Some(main_id) = main_sprite_id else {
            console_log!("createSwfSpellInstance: no DefineSprite in {bundle}");
            return 0;
        };
        let Some(main_sym) = doc.by_id.get(&main_id) else {
            return 0;
        };
        let frame_count = main_frames.max(1);

        // Union bounds across the main sprite's frames so each tick's
        // render lands at the same anchor.
        let mut union: Option<vello::kurbo::Rect> = None;
        for f in 0..frame_count {
            let r = swf_spike::render::symbol_bounds(doc, main_sym, f);
            if r.width() > 0.0 && r.height() > 0.0 {
                union = Some(match union {
                    None => r,
                    Some(prev) => prev.union(r),
                });
            }
        }
        let Some(bounds) = union else {
            console_log!(
                "createSwfSpellInstance: degenerate bounds across all frames for {bundle}"
            );
            return 0;
        };

        let scale = f64::from(resolution) / 20.0;
        let pad = 2.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let w = ((px_max_x - px_min_x) as u32).max(1);
        let h = ((px_max_y - px_min_y) as u32).max(1);
        if w > 16384 || h > 16384 {
            console_log!(
                "createSwfSpellInstance: {w}x{h} exceeds GPU limits for {bundle}"
            );
            return 0;
        }

        // Allocate the per-cast output texture once. Subsequent ticks
        // re-render into the same wgpu texture — Pixi's ExternalSource
        // re-samples it every frame so live AS2 mutations show up.
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_spell_live"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let avm =
            swf_spike::render_avm1::AvmRenderer::new(doc.root.num_frames);
        let instance = SwfSpellInstance {
            avm,
            bundle_name: bundle.to_string(),
            bounds_x0: -px_min_x,
            bounds_y0: -px_min_y,
            texture_id: tex_id,
            width: w,
            height: h,
            resolution,
            frame: 0,
        };

        let id = self.next_spell_instance_id;
        self.next_spell_instance_id += 1;
        self.swf_spell_instances.insert(id, instance);
        id
    }

    /// Inject a `{x, y}` host-var (typically `cellFrom` / `cellTo`) into
    /// the spell's AVM1 root clip. Must be called before the first
    /// `tickSwfSpellFrame` for the values to land on `_parent.cellFrom.x`
    /// lookups in AS2.
    #[wasm_bindgen(js_name = "setSwfSpellHostCell")]
    pub fn set_swf_spell_host_cell(
        &mut self,
        instance_id: u32,
        name: &str,
        x: f64,
        y: f64,
    ) {
        if let Some(inst) = self.swf_spell_instances.get_mut(&instance_id) {
            inst.avm.set_host_cell(name, x, y);
        }
    }

    /// Inject a numeric host-var (typically `level` or `angle`) into the
    /// spell's AVM1 root clip.
    #[wasm_bindgen(js_name = "setSwfSpellHostNumber")]
    pub fn set_swf_spell_host_number(
        &mut self,
        instance_id: u32,
        name: &str,
        value: f64,
    ) {
        if let Some(inst) = self.swf_spell_instances.get_mut(&instance_id) {
            inst.avm
                .set_host_var(name, swf_spike::avm1::Value::Number(value));
        }
    }

    /// Tick the spell's AVM1 by one frame, render the new state into the
    /// pre-allocated output texture, and report whether the cast is still
    /// active. JS calls this on its rAF loop (rate-limited by the SWF's
    /// authored fps from `swfBundleFrameRate`).
    ///
    /// Returns `{ texture, textureId, width, height, anchorX, anchorY,
    /// isPlaying, isRemoved, frame }`. `isPlaying = false` when AS2 has
    /// called `stop()` on the root; `isRemoved = true` when AS2 has
    /// called `_parent.removeMovieClip()` (the canonical "spell over"
    /// signal — JS should fire `onComplete` and stop ticking). Returns
    /// `JsValue::NULL` if the instance id is unknown.
    #[wasm_bindgen(js_name = "tickSwfSpellFrame")]
    pub fn tick_swf_spell_frame(&mut self, instance_id: u32) -> JsValue {
        let Some(inst) = self.swf_spell_instances.get(&instance_id) else {
            return JsValue::NULL;
        };
        let bundle_name = inst.bundle_name.clone();
        let resolution = inst.resolution;
        let bounds_x0 = inst.bounds_x0;
        let bounds_y0 = inst.bounds_y0;
        let texture_id = inst.texture_id;
        let w = inst.width;
        let h = inst.height;

        let Some(doc) = self.swf_bundles.get(&bundle_name) else {
            return JsValue::NULL;
        };
        let root_sym =
            swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());

        // Lazily init filter pipelines — spell SWFs frequently use
        // DropShadow/Glow/Blur on inner sprites. WASM target falls
        // back to halo automatically per the cfg-gate in
        // `swf_spike::render::filter::apply`.
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();

        let scale = f64::from(resolution) / 20.0;
        let xform = vello::kurbo::Affine::scale(scale)
            .then_translate(vello::kurbo::Vec2::new(bounds_x0, bounds_y0));

        // Canonical order per `feedback_swf_avm1_tick_advance`:
        // tick → render → advance. Combining tick+advance corrupts
        // `instance_map` and leaks AVM1 state across the tree.
        let inst = self.swf_spell_instances.get_mut(&instance_id).unwrap();
        inst.avm.tick(doc, &root_sym);

        let mut scene = vello::Scene::new();
        {
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            inst.avm.render(doc, &root_sym, &mut scene, xform, Some(&mut ctx));
        }

        // Snapshot post-tick state BEFORE advance so the JS-side report
        // matches the frame we just rendered.
        let is_playing = inst
            .avm
            .engine
            .clips
            .get(&1)
            .map_or(true, |s| s.playing);
        let is_removed = inst
            .avm
            .engine
            .clips
            .get(&1)
            .is_some_and(|s| s.removed);

        inst.avm.advance(doc, &root_sym);
        inst.frame += 1;
        let frame = inst.frame;

        // Render into the pre-allocated output texture. Pixi's
        // ExternalSource samples the same wgpu Texture each Pixi tick
        // so the JS sprite shows the latest pixels without re-binding.
        let Some(out_texture) = self.textures.get(&texture_id) else {
            return JsValue::NULL;
        };
        let view = out_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: w,
            height: h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) = self.renderer.render_to_texture(
            &self.device,
            &self.queue,
            &scene,
            &view,
            &params,
        ) {
            console_log!("tickSwfSpellFrame: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(out_texture);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(texture_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(bounds_x0));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(bounds_y0));
        let _ = js_sys::Reflect::set(&result, &"isPlaying".into(), &JsValue::from(is_playing));
        let _ = js_sys::Reflect::set(&result, &"isRemoved".into(), &JsValue::from(is_removed));
        let _ = js_sys::Reflect::set(&result, &"frame".into(), &JsValue::from(frame));
        result.into()
    }

    /// Free the AVM1 instance + its output GPU texture. JS must call
    /// this when the cast completes; otherwise both the AvmRenderer
    /// state (typically a few KB) and the texture (a few hundred KB at
    /// typical spell sizes) leak for the renderer's lifetime.
    #[wasm_bindgen(js_name = "disposeSwfSpellInstance")]
    pub fn dispose_swf_spell_instance(&mut self, instance_id: u32) {
        if let Some(inst) = self.swf_spell_instances.remove(&instance_id) {
            self.textures.remove(&inst.texture_id);
        }
    }

    /// Allocate a persistent character instance — pre-resolves
    /// accessory bundles, pre-computes bounds (frame size, accessory
    /// padding, grid layout) over `seed_anims`, and allocates ONE
    /// output GPU texture sized to the worst-case strip.
    /// `tickSwfCharacterStrip` then re-renders any one of those
    /// `seed_anims` into the same texture, overwriting pixels in
    /// place — JS keeps a single Pixi `ExternalSource` for the
    /// instance's lifetime.
    ///
    /// `colors` is `[c1, c2, c3]` packed as `0xRRGGBB`; pass `0` for
    /// "leave the zone untinted" (matches the pre-existing
    /// `setSwfPlayerColors` global semantics, but stored per-
    /// instance so concurrent renders of differently-coloured chars
    /// don't trample each other).
    ///
    /// `seed_anims` MUST cover every anim the caller will pass to
    /// subsequent ticks — the strip texture is sized for the bounds
    /// union over them. Asking for a frame from an anim outside this
    /// list will clip silently. For the canonical Dofus character
    /// pool (staticR/L/F/B/S, walkR/L/F/B/S, runR/L/F/B/S) pass all
    /// 13-15 names; for a stress test you can pass only the subset
    /// you'll cycle.
    ///
    /// `acc_*` are parallel arrays describing accessories — same
    /// shape as `renderSwfStripRangeAccessorized` accepts. Returns 0
    /// on failure (bundle missing, all accessories failed to
    /// resolve, or strip dims exceed GPU limits).
    #[wasm_bindgen(js_name = "createSwfCharacterInstance")]
    pub fn create_swf_character_instance(
        &mut self,
        bundle: &str,
        seed_anims: Vec<String>,
        acc_slots: Vec<u32>,
        acc_bundles: Vec<String>,
        acc_exports: Vec<String>,
        acc_anim_types: Vec<u32>,
        color1: u32,
        color2: u32,
        color3: u32,
        resolution: f32,
    ) -> u32 {
        if !self.swf_bundles.contains_key(bundle) {
            console_log!("createSwfCharacterInstance: bundle `{bundle}` not loaded");
            return 0;
        }
        let n_acc = acc_slots.len();
        if acc_bundles.len() != n_acc
            || acc_exports.len() != n_acc
            || acc_anim_types.len() != n_acc
        {
            console_log!(
                "createSwfCharacterInstance: parallel acc array length mismatch"
            );
            return 0;
        }
        if seed_anims.is_empty() {
            console_log!("createSwfCharacterInstance: seed_anims empty");
            return 0;
        }

        // 1. Pre-validate accessories — keep only the ones whose
        //    bundles are loaded AND whose export resolves AND whose
        //    geometry is non-degenerate. Track the worst-case bounds
        //    padding across all accessories so the strip texture
        //    leaves room for hats / weapons that extend past the
        //    base character bounds.
        let mut accessories: Vec<CharacterAccessory> = Vec::with_capacity(n_acc);
        let mut acc_pad_left = 0.0_f64;
        let mut acc_pad_right = 0.0_f64;
        let mut acc_pad_top = 0.0_f64;
        let mut acc_pad_bottom = 0.0_f64;
        for i in 0..n_acc {
            let slot = acc_slots[i] as u8;
            let acc_bundle = &acc_bundles[i];
            let acc_export = &acc_exports[i];
            let Some(acc_doc) = self.swf_bundles.get(acc_bundle) else {
                console_log!(
                    "createSwfCharacterInstance: accessory bundle `{acc_bundle}` not loaded"
                );
                continue;
            };
            let Some(acc_sym) = acc_doc.lookup_export(acc_export) else {
                console_log!(
                    "createSwfCharacterInstance: accessory export `{acc_bundle}/{acc_export}` not found"
                );
                continue;
            };
            let mut got_bounds = false;
            for f in 0u16..15 {
                let b = swf_spike::render::symbol_bounds(acc_doc, acc_sym, f);
                if b.width() <= 0.0 || b.height() <= 0.0 {
                    continue;
                }
                got_bounds = true;
                if b.x0 < 0.0 { acc_pad_left = acc_pad_left.max(-b.x0); }
                if b.x1 > 0.0 { acc_pad_right = acc_pad_right.max(b.x1); }
                if b.y0 < 0.0 { acc_pad_top = acc_pad_top.max(-b.y0); }
                if b.y1 > 0.0 { acc_pad_bottom = acc_pad_bottom.max(b.y1); }
            }
            if !got_bounds {
                console_log!(
                    "createSwfCharacterInstance: accessory `{acc_bundle}/{acc_export}` has no geometry"
                );
                continue;
            }
            accessories.push(CharacterAccessory {
                slot,
                bundle_name: acc_bundle.clone(),
                export_name: acc_export.clone(),
                anim_type: acc_anim_types[i] as u8,
            });
        }

        // 2. Compute the worst-case (bounds, frame_count) over all
        //    seed anims. The output strip texture is sized so any of
        //    them fits. Use `swf_anim_frame_count` (which walks the
        //    deepest nested sprite, mirroring the JS `swfAnimFrameCount`
        //    contract) to get the ACTUAL frame count per anim — passing
        //    a large dummy total to `cache_strip_bounds` triggers its
        //    stride-sampling path which inflates `anim_end` to that
        //    dummy total, causing tick renders to iterate vastly more
        //    frames than authored (the "4fps" symptom).
        let mut union_min_x = f64::INFINITY;
        let mut union_min_y = f64::INFINITY;
        let mut union_max_x = f64::NEG_INFINITY;
        let mut union_max_y = f64::NEG_INFINITY;
        let mut max_frame_count: u32 = 1;
        let bundle_owned = bundle.to_string();
        for anim in &seed_anims {
            let actual = self.swf_anim_frame_count(&bundle_owned, anim);
            if actual == 0 {
                continue;
            }
            let Some(cached) = self.cache_strip_bounds(&bundle_owned, anim, actual) else {
                continue;
            };
            union_min_x = union_min_x.min(cached.min_x);
            union_min_y = union_min_y.min(cached.min_y);
            union_max_x = union_max_x.max(cached.max_x);
            union_max_y = union_max_y.max(cached.max_y);
            if actual > max_frame_count {
                max_frame_count = actual;
            }
        }
        if !union_min_x.is_finite() {
            console_log!(
                "createSwfCharacterInstance: no seed anim resolved for `{bundle}`"
            );
            return 0;
        }

        // 3. Compute SINGLE-FRAME pixel dims, including accessory
        //    padding. Each `tickSwfCharacterFrame` writes one frame
        //    into this texture; we don't allocate a strip.
        let _ = max_frame_count; // not used in single-frame layout
        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let twip_min_x = union_min_x - acc_pad_left;
        let twip_min_y = union_min_y - acc_pad_top;
        let twip_max_x = union_max_x + acc_pad_right;
        let twip_max_y = union_max_y + acc_pad_bottom;
        let px_min_x = (twip_min_x * scale).floor() - pad;
        let px_min_y = (twip_min_y * scale).floor() - pad;
        let px_max_x = (twip_max_x * scale).ceil() + pad;
        let px_max_y = (twip_max_y * scale).ceil() + pad;
        let frame_w = ((px_max_x - px_min_x) as u32).max(1);
        let frame_h = ((px_max_y - px_min_y) as u32).max(1);
        if frame_w > 16384 || frame_h > 16384 {
            console_log!(
                "createSwfCharacterInstance: frame {frame_w}x{frame_h} exceeds GPU limits"
            );
            return 0;
        }

        // 4. Allocate the per-instance output texture once. Subsequent
        //    `tickSwfCharacterFrame` calls render INTO this texture so
        //    JS Pixi keeps one `ExternalSource` for the lifetime.
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_character_live"),
            size: wgpu::Extent3d {
                width: frame_w,
                height: frame_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let to_opt = |c: u32| if c == 0 { None } else { Some(c) };
        let colors = swf_spike::recolor::PlayerColors([
            to_opt(color1), to_opt(color2), to_opt(color3),
        ]);

        let _ = (acc_pad_left, acc_pad_right, acc_pad_top, acc_pad_bottom);
        let instance = SwfCharacterInstance {
            bundle_name: bundle_owned,
            accessories,
            colors,
            frame_w,
            frame_h,
            px_min_x,
            px_min_y,
            resolution,
            texture_id: tex_id,
            scene_cache: HashMap::new(),
            // JS sets these via setSwfCharacterAnim BEFORE the
            // first batched render. Defaulting here keeps the
            // struct valid if no setter call lands first.
            current_anim: seed_anims.first().cloned().unwrap_or_default(),
            current_dir_suffix: 'R',
            current_apply_b_fix: false,
        };

        let id = self.next_character_instance_id;
        self.next_character_instance_id += 1;
        self.swf_character_instances.insert(id, instance);
        id
    }

    /// Render exactly ONE frame of the requested anim into the
    /// instance's stable output texture. The texture handle is
    /// stable across calls — JS Pixi wraps once at create time and
    /// the `ExternalSource` re-samples the GPU memory on each Pixi
    /// render. No strip, no sub-rect, no per-frame Texture wrappers.
    ///
    /// Returns `{ texture, textureId, width, height, anchorX,
    /// anchorY }`. Width/height are constant for the instance's
    /// lifetime (sized at create); anchor is the SWF (0,0) origin
    /// inside the texture.
    #[wasm_bindgen(js_name = "tickSwfCharacterFrame")]
    pub fn tick_swf_character_frame(
        &mut self,
        instance_id: u32,
        anim: &str,
        frame: u32,
        char_dir_suffix: String,
        apply_b_fix: bool,
    ) -> JsValue {
        let Some(inst) = self.swf_character_instances.get(&instance_id) else {
            return JsValue::NULL;
        };
        let bundle_name = inst.bundle_name.clone();
        let frame_w = inst.frame_w;
        let frame_h = inst.frame_h;
        let px_min_x = inst.px_min_x;
        let px_min_y = inst.px_min_y;
        let resolution = inst.resolution;
        let texture_id = inst.texture_id;
        let player_colors = inst.colors;

        // SCENE CACHE FAST PATH — if we've already built the
        // scene for this (anim, frame) on this instance, reuse it
        // and skip the entire SWF tree walk + accessory composition.
        // This eliminates the dominant ~70% of per-call cost on
        // cache hits; only the GPU dispatch + scene encoding to the
        // device queue remains. After each player cycles each anim
        // once, every render is a hit.
        let cache_key = (anim.to_string(), frame);
        let cache_hit = inst.scene_cache.contains_key(&cache_key);

        if !cache_hit {
            // COLD PATH — build the scene and store it.
            let Some(doc) = self.swf_bundles.get(&bundle_name) else {
                return JsValue::NULL;
            };
            let Some(symbol) = doc.lookup_export(anim) else {
                return JsValue::NULL;
            };

            struct ResolvedAcc<'a> {
                slot: u8,
                doc: &'a swf_spike::swf_doc::SwfDoc,
                symbol: &'a swf_spike::swf_doc::Symbol,
                anim_type: u8,
            }
            let inst_ref = &self.swf_character_instances[&instance_id];
            let mut resolved: Vec<ResolvedAcc> = Vec::with_capacity(inst_ref.accessories.len());
            for a in &inst_ref.accessories {
                let Some(acc_doc) = self.swf_bundles.get(&a.bundle_name) else { continue; };
                let Some(acc_sym) = acc_doc.lookup_export(&a.export_name) else { continue; };
                resolved.push(ResolvedAcc {
                    slot: a.slot,
                    doc: acc_doc,
                    symbol: acc_sym,
                    anim_type: a.anim_type,
                });
            }

            if self.swf_filter_pipelines.is_none() {
                self.swf_filter_pipelines = Some(
                    swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
                );
            }
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();

            let scale = f64::from(resolution) / 20.0;
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };

            let cache = swf_spike::render::cache::RenderCache::new();

            let xform = vello::kurbo::Affine::scale(scale)
                .then_translate(vello::kurbo::Vec2::new(-px_min_x, -px_min_y));
            let dir_char = char_dir_suffix
                .chars()
                .next()
                .unwrap_or('R')
                .to_ascii_uppercase();
            let mut accessories: swf_spike::render::ctx::AccessoryDict = HashMap::new();
            for r in &resolved {
                accessories.insert(
                    r.slot,
                    swf_spike::render::ctx::AccessoryEntry {
                        doc: r.doc,
                        symbol: r.symbol,
                        anim_type: r.anim_type,
                        char_frame: frame as u16,
                        char_dir_suffix: dir_char,
                    },
                );
            }
            let mut scene = vello::Scene::new();
            swf_spike::render::render_symbol_with_ctx_tinted_accessorized_bfixed(
                &mut ctx,
                doc,
                symbol,
                &mut scene,
                xform,
                frame as u16,
                player_colors,
                &cache,
                &accessories,
                apply_b_fix,
            );

            // Cache the built scene for next time.
            let inst_mut = self.swf_character_instances.get_mut(&instance_id).unwrap();
            inst_mut.scene_cache.insert(cache_key.clone(), scene);
        }

        // WARM PATH — render from the cached scene. Same code for
        // both the just-built and pre-existing cases.
        let inst_ref = &self.swf_character_instances[&instance_id];
        let scene = inst_ref.scene_cache.get(&cache_key).unwrap();

        let Some(out_texture) = self.textures.get(&texture_id) else {
            return JsValue::NULL;
        };
        let view = out_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: frame_w,
            height: frame_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) = self.renderer.render_to_texture(
            &self.device, &self.queue, scene, &view, &params,
        ) {
            console_log!("tickSwfCharacterFrame: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(out_texture);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(&result, &"textureId".into(), &JsValue::from(texture_id as f64));
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        result.into()
    }

    /// Free the character instance + its output GPU texture.
    #[wasm_bindgen(js_name = "disposeSwfCharacterInstance")]
    pub fn dispose_swf_character_instance(&mut self, instance_id: u32) {
        if let Some(inst) = self.swf_character_instances.remove(&instance_id) {
            self.textures.remove(&inst.texture_id);
        }
    }

    /// Allocate a viewport-sized output texture for the batched
    /// world-layer render path. Single texture shared by every
    /// `renderSwfWorldLayer` call; JS Pixi wraps it ONCE as an
    /// `ExternalSource` and never re-allocates. Returns the
    /// `{ texture, textureId, width, height }` so JS can wire it
    /// up immediately.
    #[wasm_bindgen(js_name = "createWorldLayerTexture")]
    pub fn create_world_layer_texture(&mut self, width: u32, height: u32) -> JsValue {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_world_layer"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(&result, &"textureId".into(), &JsValue::from(tex_id as f64));
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(width));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(height));
        result.into()
    }

    /// Update an instance's current anim + direction. Cheap — just
    /// state mutation, no rendering. Called from JS on anim swap.
    /// The batched `renderSwfWorldLayer` then uses these per-instance
    /// values when building each placement's scene fragment.
    #[wasm_bindgen(js_name = "setSwfCharacterAnim")]
    pub fn set_swf_character_anim(
        &mut self,
        instance_id: u32,
        anim: &str,
        dir_suffix: String,
        apply_b_fix: bool,
    ) {
        if let Some(inst) = self.swf_character_instances.get_mut(&instance_id) {
            inst.current_anim = anim.to_string();
            inst.current_dir_suffix = dir_suffix.chars().next().unwrap_or('R');
            inst.current_apply_b_fix = apply_b_fix;
        }
    }

    /// Batch render: composes ALL active character placements into
    /// ONE Vello scene, dispatches ONCE, writes the result into the
    /// shared world-layer texture allocated by
    /// `createWorldLayerTexture`. Replaces N individual
    /// `tickSwfCharacterFrame` calls per tick with 1 call total.
    ///
    /// Per-placement parallel arrays:
    ///   - `instance_ids[i]`: WASM character instance id
    ///   - `frames[i]`:       current frame within the instance's
    ///                        current anim (set via setSwfCharacterAnim)
    ///   - `pos_x[i] / pos_y[i]`: pixel position in the layer texture
    ///                        (== screen coords; layer is viewport-sized)
    ///
    /// Returns true on success, false on parallel-array-length
    /// mismatch / texture-id miss / render error.
    #[wasm_bindgen(js_name = "renderSwfWorldLayer")]
    pub fn render_swf_world_layer(
        &mut self,
        layer_texture_id: f64,
        width: u32,
        height: u32,
        instance_ids: Vec<u32>,
        frames: Vec<u32>,
        pos_x: Vec<f32>,
        pos_y: Vec<f32>,
    ) -> bool {
        let n = instance_ids.len();
        if frames.len() != n || pos_x.len() != n || pos_y.len() != n {
            console_log!("renderSwfWorldLayer: array length mismatch");
            return false;
        }
        let layer_tex_id = layer_texture_id as u64;
        if !self.textures.contains_key(&layer_tex_id) {
            console_log!("renderSwfWorldLayer: layer texture id {layer_tex_id} not found");
            return false;
        }

        // Lazy filter pipeline init (each character may use filters).
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }

        // Pass 1: ensure every (instance, current_anim, frame[i]) is
        // cached. We have to walk `swf_character_instances` mutably
        // here because cold-path scene building inserts into the
        // instance's `scene_cache`. Doing this in a separate pass
        // lets pass 2 just borrow each scene immutably.
        for i in 0..n {
            let id = instance_ids[i];
            let frame = frames[i];
            let cache_key = {
                let Some(inst) = self.swf_character_instances.get(&id) else {
                    continue;
                };
                (inst.current_anim.clone(), frame)
            };
            // Already cached? skip the build.
            let already = self
                .swf_character_instances
                .get(&id)
                .map(|i| i.scene_cache.contains_key(&cache_key))
                .unwrap_or(false);
            if already {
                continue;
            }

            // Cold path — build the scene fragment for this
            // (instance, anim, frame). Same logic as
            // `tick_swf_character_frame`'s cold branch but writes
            // directly into the instance's cache.
            let (
                bundle_name, accessories_meta, player_colors,
                px_min_x, px_min_y, resolution, dir_char, apply_b_fix, anim_owned,
            ) = {
                let inst = &self.swf_character_instances[&id];
                (
                    inst.bundle_name.clone(),
                    inst.accessories.iter().map(|a| {
                        (a.slot, a.bundle_name.clone(), a.export_name.clone(), a.anim_type)
                    }).collect::<Vec<_>>(),
                    inst.colors,
                    inst.px_min_x,
                    inst.px_min_y,
                    inst.resolution,
                    inst.current_dir_suffix,
                    inst.current_apply_b_fix,
                    inst.current_anim.clone(),
                )
            };
            let _ = (apply_b_fix, anim_owned);
            let Some(doc) = self.swf_bundles.get(&bundle_name) else { continue; };
            let Some(symbol) = doc.lookup_export(&cache_key.0) else { continue; };

            // Resolve accessory docs/symbols.
            struct ResolvedAcc<'a> {
                slot: u8,
                doc: &'a swf_spike::swf_doc::SwfDoc,
                symbol: &'a swf_spike::swf_doc::Symbol,
                anim_type: u8,
            }
            let mut resolved: Vec<ResolvedAcc> = Vec::with_capacity(accessories_meta.len());
            for (slot, bn, en, at) in &accessories_meta {
                let Some(acc_doc) = self.swf_bundles.get(bn) else { continue; };
                let Some(acc_sym) = acc_doc.lookup_export(en) else { continue; };
                resolved.push(ResolvedAcc { slot: *slot, doc: acc_doc, symbol: acc_sym, anim_type: *at });
            }

            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let scale = f64::from(resolution) / 20.0;
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            let cache = swf_spike::render::cache::RenderCache::new();
            let xform = vello::kurbo::Affine::scale(scale)
                .then_translate(vello::kurbo::Vec2::new(-px_min_x, -px_min_y));
            let mut accessories: swf_spike::render::ctx::AccessoryDict = HashMap::new();
            for r in &resolved {
                accessories.insert(r.slot, swf_spike::render::ctx::AccessoryEntry {
                    doc: r.doc,
                    symbol: r.symbol,
                    anim_type: r.anim_type,
                    char_frame: frame as u16,
                    char_dir_suffix: dir_char,
                });
            }
            let mut scene = vello::Scene::new();
            swf_spike::render::render_symbol_with_ctx_tinted_accessorized_bfixed(
                &mut ctx, doc, symbol, &mut scene, xform, frame as u16,
                player_colors, &cache, &accessories, apply_b_fix,
            );
            // Insert into cache.
            if let Some(inst_mut) = self.swf_character_instances.get_mut(&id) {
                inst_mut.scene_cache.insert(cache_key, scene);
            }
        }

        // Pass 2: assemble the giant world-layer scene. Pure cache
        // lookups + appends — no scene building, no GPU work yet.
        // JS passes (pos_x, pos_y) as the WORLD ANCHOR position
        // (the character's foot point). The cached scene was built
        // with its anchor at (-px_min_x, -px_min_y) in scene-pixel
        // space, so the translation that lands the anchor on the
        // world point is `(pos + px_min)`.
        let mut layer_scene = vello::Scene::new();
        for i in 0..n {
            let id = instance_ids[i];
            let frame = frames[i];
            let x = pos_x[i] as f64;
            let y = pos_y[i] as f64;
            let Some(inst) = self.swf_character_instances.get(&id) else { continue; };
            let cache_key = (inst.current_anim.clone(), frame);
            let Some(sprite_scene) = inst.scene_cache.get(&cache_key) else { continue; };
            let tx = x + inst.px_min_x;
            let ty = y + inst.px_min_y;
            let xform = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(tx, ty));
            layer_scene.append(sprite_scene, Some(xform));
        }

        // Single GPU dispatch for the whole world layer.
        let Some(out_texture) = self.textures.get(&layer_tex_id) else {
            return false;
        };
        let view = out_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width,
            height,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) = self.renderer.render_to_texture(
            &self.device, &self.queue, &layer_scene, &view, &params,
        ) {
            console_log!("renderSwfWorldLayer: render error: {e}");
            return false;
        }
        true
    }

    /// Render the SWF's ROOT timeline (the main movie stage) at a given
    /// frame. Used for SWFs without named exports — artwork/big/{gfxId}.swf
    /// and spell icons place their visible content directly on the root
    /// stage instead of declaring named exports. Honors `swf_player_colors`
    /// for portraits that carry the canonical `stringCourseColor` zones.
    #[wasm_bindgen(js_name = "renderSwfRoot")]
    pub fn render_swf_root(
        &mut self,
        bundle: &str,
        frame: u32,
        resolution: f32,
    ) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        // Wrap the root timeline as a `Symbol::Sprite` so the existing
        // render pipeline (designed around `&Symbol`) can dispatch into it.
        // `OwnedSprite` derives Clone — cheap one-shot clone, fine for the
        // per-portrait render path which isn't a hot loop.
        let root_symbol =
            swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());

        let bounds = swf_spike::render::symbol_bounds(doc, &root_symbol, frame as u16);
        if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
            console_log!(
                "renderSwfRoot: degenerate bounds for {bundle}@frame{frame} (w={} h={}) — null",
                bounds.width(),
                bounds.height(),
            );
            return JsValue::NULL;
        }

        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let w = ((px_max_x - px_min_x) as u32).max(1);
        let h = ((px_max_y - px_min_y) as u32).max(1);

        let xform = vello::kurbo::Affine::scale(scale)
            .then_translate(vello::kurbo::Vec2::new(-px_min_x, -px_min_y));

        let mut scene = vello::Scene::new();
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
        let mut ctx = swf_spike::render::WgpuCtx {
            device: &self.device,
            queue: &self.queue,
            renderer: &mut self.renderer,
            filter_pipelines,
            output_scale: scale,
        };
        swf_spike::render::render_symbol_with_ctx_tinted(
            &mut ctx,
            doc,
            &root_symbol,
            &mut scene,
            xform,
            frame as u16,
            self.swf_player_colors,
        );

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_root"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: w,
            height: h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfRoot: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        result.into()
    }

    /// Render the SWF's root timeline directly into a previously-attached
    /// `<canvas>` surface. Used by HUD consumers (fighter portraits,
    /// banner artwork) that need an `<canvas>` element they can mount
    /// in React. Returns `{ width, height, anchorX, anchorY }` on
    /// success or NULL on failure (unknown surface, missing bundle,
    /// degenerate bounds, render error).
    #[wasm_bindgen(js_name = "renderSwfRootToSurface")]
    pub fn render_swf_root_to_surface(
        &mut self,
        surface_id: u32,
        bundle: &str,
        frame: u32,
        resolution: f32,
    ) -> JsValue {
        if !self.surfaces.contains_key(&surface_id) {
            console_log!(
                "renderSwfRootToSurface: unknown surface id {surface_id}"
            );
            return JsValue::NULL;
        }
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let root_symbol =
            swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());
        let bounds =
            swf_spike::render::symbol_bounds(doc, &root_symbol, frame as u16);
        if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
            return JsValue::NULL;
        }
        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let w = ((px_max_x - px_min_x) as u32).max(1);
        let h = ((px_max_y - px_min_y) as u32).max(1);
        let xform = vello::kurbo::Affine::scale(scale)
            .then_translate(vello::kurbo::Vec2::new(-px_min_x, -px_min_y));

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }

        let mut scene = vello::Scene::new();
        let player_colors = self.swf_player_colors;
        {
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            swf_spike::render::render_symbol_with_ctx_tinted(
                &mut ctx,
                doc,
                &root_symbol,
                &mut scene,
                xform,
                frame as u16,
                player_colors,
            );
        }

        if !self.dispatch_scene_to_surface(
            surface_id,
            "renderSwfRootToSurface",
            &scene,
        ) {
            return JsValue::NULL;
        }
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        result.into()
    }

    /// Render `requested_frame_count` consecutive frames of one (bundle, export)
    /// in a single Vello dispatch — frames laid out in a 2D grid so the caller
    /// can slice the resulting composite texture into per-frame Pixi sub-textures.
    /// Mirrors the dofasset path's `renderAnimationStrip`: 1 GPU dispatch instead
    /// of N, 1 texture allocation instead of N. Stops at the first frame whose
    /// `symbol_bounds` is degenerate (matches the JS per-frame `break` policy).
    ///
    /// Anchor handling: uses the union of bounds across all valid frames so the
    /// per-frame cell size is uniform and the SWF (0,0) origin lands at the same
    /// `(anchorX, anchorY)` inside every cell. The caller can pivot a single Pixi
    /// sprite to that anchor and swap textures freely without reapplying offsets.
    #[wasm_bindgen(js_name = "renderSwfStrip")]
    pub fn render_swf_strip(
        &mut self,
        bundle: &str,
        export: &str,
        requested_frame_count: u32,
        resolution: f32,
    ) -> JsValue {
        // Backward-compat shim: render the whole [0, requested_frame_count)
        // range with the bounds union taken over the same window. New
        // callers should use `renderSwfStripRange` for chunked rendering
        // (where the bounds union must span the FULL animation so per-cell
        // anchors stay aligned across chunks).
        self.render_swf_strip_range(
            bundle,
            export,
            0,
            requested_frame_count,
            requested_frame_count,
            resolution,
        )
    }

    /// Render a contiguous frame window of an export's strip while sharing
    /// per-cell anchors with all other windows of the SAME animation. Use
    /// for animations that exceed Vello's per-scene tile-encoder budget
    /// (~60 frames worth of typical tile geometry): split a long anim into
    /// N consecutive `renderSwfStripRange` calls — each produces its own
    /// ExternalSource at the same anchor + frame_w/frame_h, so JS can
    /// concatenate them into one logical AnimatedSprite by rotating
    /// textures across chunk boundaries without any anchor jitter.
    ///
    /// `total_frame_count` is the FULL animation length used to compute
    /// the bounds union (so anchors are uniform across chunks). `start`
    /// and `count` define which slice this call renders.
    /// Internal: compute (or fetch from cache) the bounds union of an
    /// export's animation across `[0, total_frame_count)` plus the first
    /// degenerate frame index. Returns `None` if the bundle/export is
    /// missing or frame 0 itself is degenerate. Callers should treat
    /// `None` as a hard render failure.
    fn cache_strip_bounds(
        &mut self,
        bundle: &str,
        export: &str,
        total_frame_count: u32,
    ) -> Option<CachedAnimBounds> {
        let key = (bundle.to_string(), export.to_string(), total_frame_count);
        if let Some(c) = self.swf_strip_bounds_cache.get(&key) {
            return Some(*c);
        }
        let doc = self.swf_bundles.get(bundle)?;
        let symbol = doc.lookup_export(export)?;
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let mut anim_end: u32 = 0;

        // Subsample frames for the bounds union when the animation is
        // long. A naive walk is O(total_frame_count × tree-size) and a
        // 200-frame tile with deep geometry burns ~100 ms of pure CPU
        // here — that's the dominant cost on long-animation maps.
        // Tile bundles in Dofus 1.29 are authored within a fixed
        // bounding box (the artist drew on a sized canvas), so bounds
        // shift smoothly across frames; sampling every Nth frame
        // captures the union to within a fraction of a pixel.
        //
        // Heuristic: sample at most `MAX_BOUNDS_SAMPLES` frames, but
        // always include frame 0 and the final frame. For ≤ that
        // count we fall back to per-frame walking (zero risk for
        // short anims).
        const MAX_BOUNDS_SAMPLES: u32 = 30;
        let stride = if total_frame_count <= MAX_BOUNDS_SAMPLES {
            1
        } else {
            total_frame_count / MAX_BOUNDS_SAMPLES
        };
        let mut last_valid: u32 = 0;
        let mut i: u32 = 0;
        let mut union_any = |bounds: vello::kurbo::Rect| {
            min_x = min_x.min(bounds.x0);
            min_y = min_y.min(bounds.y0);
            max_x = max_x.max(bounds.x1);
            max_y = max_y.max(bounds.y1);
        };
        while i < total_frame_count {
            let bounds = swf_spike::render::symbol_bounds(doc, symbol, i as u16);
            if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
                if i == 0 {
                    console_log!(
                        "cacheStripBounds: degenerate bounds for {bundle}/{export}@frame0 — null"
                    );
                    return None;
                }
                // Hit a degenerate frame between samples — clamp the
                // anim end at the last sampled-valid frame plus one
                // (caller will get a slightly truncated cycle but
                // that's preferable to a render dispatch that hits
                // the degenerate frame mid-strip).
                break;
            }
            union_any(bounds);
            last_valid = i;
            anim_end = i + 1;
            // Always include the final frame in the sample even when
            // strided sampling would skip it, so growing animations
            // (e.g. fire that gets larger over time) capture their
            // full extent.
            let next = i + stride;
            if next >= total_frame_count && i + 1 < total_frame_count {
                i = total_frame_count - 1;
            } else {
                i = next;
            }
        }
        if anim_end == 0 {
            return None;
        }
        // anim_end describes the END (exclusive) of the playable
        // range. With stride > 1 we may have only sampled up to
        // `last_valid` — extend anim_end to the requested total so the
        // chunked render path can still iterate every frame index in
        // sequence (the per-frame `render_symbol_with_ctx_tinted` call
        // tolerates degenerate bounds gracefully; only the prepass was
        // expensive).
        if stride > 1 {
            anim_end = total_frame_count;
            let _ = last_valid; // silence unused-when-no-debug warning
        }
        let cached = CachedAnimBounds {
            min_x,
            min_y,
            max_x,
            max_y,
            anim_end,
        };
        self.swf_strip_bounds_cache.insert(key, cached);
        Some(cached)
    }

    /// Query the cached strip bounds for an export at a given total
    /// frame count, populating the cache on miss. Returns
    /// `{minXTwip, minYTwip, maxXTwip, maxYTwip, animEnd}` in twip
    /// units (caller multiplies by `resolution / 20.0` to get pixels)
    /// or `null` on failure. Useful for callers that want to size
    /// canvases / ExternalSources without doing a render dispatch.
    #[wasm_bindgen(js_name = "swfStripBounds")]
    pub fn swf_strip_bounds(
        &mut self,
        bundle: &str,
        export: &str,
        total_frame_count: u32,
    ) -> JsValue {
        let Some(c) = self.cache_strip_bounds(bundle, export, total_frame_count) else {
            return JsValue::NULL;
        };
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"minXTwip".into(), &JsValue::from(c.min_x));
        let _ = js_sys::Reflect::set(&result, &"minYTwip".into(), &JsValue::from(c.min_y));
        let _ = js_sys::Reflect::set(&result, &"maxXTwip".into(), &JsValue::from(c.max_x));
        let _ = js_sys::Reflect::set(&result, &"maxYTwip".into(), &JsValue::from(c.max_y));
        let _ =
            js_sys::Reflect::set(&result, &"animEnd".into(), &JsValue::from(c.anim_end));
        result.into()
    }

    #[wasm_bindgen(js_name = "renderSwfStripRange")]
    pub fn render_swf_strip_range(
        &mut self,
        bundle: &str,
        export: &str,
        start: u32,
        count: u32,
        total_frame_count: u32,
        resolution: f32,
    ) -> JsValue {
        if count == 0 || total_frame_count == 0 || start >= total_frame_count {
            return JsValue::NULL;
        }
        let Some(cached) = self.cache_strip_bounds(bundle, export, total_frame_count) else {
            // Either bundle/export missing or frame 0 was degenerate —
            // already logged inside the helper.
            return JsValue::NULL;
        };
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };
        let end = start.saturating_add(count).min(total_frame_count);
        if end <= start {
            return JsValue::NULL;
        }
        let anim_end = cached.anim_end;
        if anim_end <= start {
            return JsValue::NULL;
        }
        let chunk_end = end.min(anim_end);
        let chunk_count = chunk_end - start;

        // Convert cached global bounds to pixel space + per-cell dims.
        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let px_min_x = (cached.min_x * scale).floor() - pad;
        let px_min_y = (cached.min_y * scale).floor() - pad;
        let px_max_x = (cached.max_x * scale).ceil() + pad;
        let px_max_y = (cached.max_y * scale).ceil() + pad;
        let frame_w = ((px_max_x - px_min_x) as u32).max(1);
        let frame_h = ((px_max_y - px_min_y) as u32).max(1);

        // 3. Layout this chunk's frames in a 2D grid bounded by 16384px texture limit.
        let max_cols = (16384u32 / frame_w).max(1) as usize;
        let chunk_usize = chunk_count as usize;
        let grid_cols = chunk_usize.min(max_cols);
        let grid_rows = (chunk_usize + grid_cols - 1) / grid_cols;
        let strip_w = frame_w * grid_cols as u32;
        let strip_h = frame_h * grid_rows as u32;

        if strip_w == 0 || strip_h == 0 || strip_w > 16384 || strip_h > 16384 {
            console_log!(
                "renderSwfStripRange: strip {strip_w}x{strip_h} exceeds GPU limits — null"
            );
            return JsValue::NULL;
        }

        // 4. Build the chunk's Vello scene. Each cell uses the same global
        //    offset (-px_min, derived from the FULL anim's union) so SWF
        //    (0,0) lands at the same anchor everywhere — chunks compose
        //    seamlessly.
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
        let mut ctx = swf_spike::render::WgpuCtx {
            device: &self.device,
            queue: &self.queue,
            renderer: &mut self.renderer,
            filter_pipelines,
            output_scale: scale,
        };

        let mut scene = vello::Scene::new();
        for slot in 0..chunk_count {
            let frame_idx = start + slot;
            let col = (slot as usize) % grid_cols;
            let row = (slot as usize) / grid_cols;
            let cell_x = (col * frame_w as usize) as f64;
            let cell_y = (row * frame_h as usize) as f64;

            let xform = vello::kurbo::Affine::scale(scale).then_translate(
                vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y + cell_y),
            );

            swf_spike::render::render_symbol_with_ctx_tinted(
                &mut ctx,
                doc,
                symbol,
                &mut scene,
                xform,
                frame_idx as u16,
                self.swf_player_colors,
            );
        }
        let valid_frames = chunk_count;

        // 5. Render the composite scene to one storage texture.
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_strip"),
            size: wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: strip_w,
            height: strip_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfStrip: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        // Anchor (within-cell): SWF (0,0) lands at -px_min relative to each
        // cell's top-left. Same for every frame because we used a uniform
        // global offset.
        let anchor_x = -px_min_x;
        let anchor_y = -px_min_y;

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ =
            js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ =
            js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"frameCount".into(),
            &JsValue::from(valid_frames),
        );
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(anchor_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(anchor_y));
        result.into()
    }

    /// Like `renderSwfStripRange` but composes accessory SWFs at the
    /// base character's body part mount points (declared via
    /// `GAC.applyAccessory(this, slot, side)` in the AS2 frame
    /// actions, scanned at SWF load time into
    /// `SwfDoc::accessory_mounts`).
    ///
    /// Inputs (all parallel arrays of equal length, one entry per
    /// accessory):
    ///  - `acc_slots[i]`: AS2 mount slot id (1-4 in vanilla Dofus —
    ///    1=head/hat, 2=weapon, 3=cape, 4=shield in our convention).
    ///  - `acc_bundles[i]`: bundle name where the accessory SWF was
    ///    loaded via `loadSwfBundle`.
    ///  - `acc_exports[i]`: export name within that bundle (e.g.
    ///    `"16_42"` = type-16 hat, gfx 42).
    ///  - `acc_frames[i]`: frame index inside the accessory's symbol
    ///    (R=0/L=3/F=6/B=9/S=12 typically — caller picks based on
    ///    the active animation's direction).
    ///
    /// Mounts whose slot has no accessory entry are silently skipped
    /// (no overlay rendered, body part shown as authored). Slot
    /// collisions (multiple accessories for the same slot) keep the
    /// LAST entry — caller is expected to pre-deduplicate.
    /// Renders a strip with composed accessories.
    ///
    /// `acc_anim_types[i]` classifies the character animation for slot i:
    /// 0=static, 1=walk, 2=run. Selects which slot-specific direction
    /// fallback table the renderer walks. The accessory's actual frame
    /// is computed PER CHARACTER FRAME inside the renderer using the
    /// body part's mount-declared `side` plus `(char_frame % 3)`, so
    /// the accessory cycles its 3 sub-frames in lockstep with the
    /// character animation.
    #[wasm_bindgen(js_name = "renderSwfStripRangeAccessorized")]
    pub fn render_swf_strip_range_accessorized(
        &mut self,
        bundle: &str,
        export: &str,
        start: u32,
        count: u32,
        total_frame_count: u32,
        resolution: f32,
        acc_slots: Vec<u32>,
        acc_bundles: Vec<String>,
        acc_exports: Vec<String>,
        acc_anim_types: Vec<u32>,
        // Direction-suffix character ('R'|'L'|'S'|'F'|'B') of the
        // requested character animation. Used by the slot-3 (pet)
        // path to pick named exports (`staticR`, `walkR`, ...) and
        // for the accessory frame-label resolver. Passed as a JS
        // string (single ASCII char) since wasm-bindgen doesn't
        // marshal Rust `char` directly.
        char_dir_suffix: String,
        // True when the JS caller will follow this render with
        // `sprite.scale.x = -1` (canonical 1.29 directions 3/4/7 —
        // SW/W/NE). Triggers the bFix body-part X-mirror so
        // accessories with `b_fix=true` mounts (capes, shields)
        // land on the canonical side instead of the reversed one.
        apply_b_fix: bool,
    ) -> JsValue {
        if count == 0 || total_frame_count == 0 || start >= total_frame_count {
            return JsValue::NULL;
        }
        let n_acc = acc_slots.len();
        if acc_bundles.len() != n_acc
            || acc_exports.len() != n_acc
            || acc_anim_types.len() != n_acc
        {
            console_log!(
                "renderSwfStripRangeAccessorized: parallel array length mismatch"
            );
            return JsValue::NULL;
        }

        let Some(cached) = self.cache_strip_bounds(bundle, export, total_frame_count) else {
            return JsValue::NULL;
        };
        let end = start.saturating_add(count).min(total_frame_count);
        if end <= start {
            return JsValue::NULL;
        }
        let chunk_end = end.min(cached.anim_end);
        if chunk_end <= start {
            return JsValue::NULL;
        }
        let chunk_count = chunk_end - start;

        // Compute accessory bounds-extents in twip space so the strip
        // texture is padded enough that accessories extending past
        // the base character (e.g. a tall hat, a long weapon) don't
        // get clipped at the texture edge. Accessories render at the
        // body part's mount placement (which is within the base
        // character's bounds), so total worst-case extension past
        // base bounds is the max accessory bbox extent in each
        // direction. We resolve accessory bundles + symbols here too
        // so we only fail the whole call if NO accessory resolves.
        struct ResolvedAcc<'a> {
            slot: u8,
            doc: &'a swf_spike::swf_doc::SwfDoc,
            symbol: &'a swf_spike::swf_doc::Symbol,
            anim_type: u8,
        }
        let mut resolved: Vec<ResolvedAcc> = Vec::with_capacity(n_acc);
        let mut acc_pad_left = 0.0_f64;
        let mut acc_pad_right = 0.0_f64;
        let mut acc_pad_top = 0.0_f64;
        let mut acc_pad_bottom = 0.0_f64;
        for i in 0..n_acc {
            let slot = acc_slots[i] as u8;
            let Some(acc_doc) = self.swf_bundles.get(&acc_bundles[i]) else {
                console_log!(
                    "renderSwfStripRangeAccessorized: accessory bundle `{}` not loaded",
                    acc_bundles[i]
                );
                continue;
            };
            let Some(acc_sym) = acc_doc.lookup_export(&acc_exports[i]) else {
                console_log!(
                    "renderSwfStripRangeAccessorized: accessory export `{}/{}` not found",
                    acc_bundles[i],
                    acc_exports[i]
                );
                continue;
            };
            // Bounds padding: take the union across the accessory's
            // first 15 frames (5 standard directions × 3 sub-frames)
            // so the strip texture has enough room no matter which
            // direction is picked at render time. Cheap upper bound
            // — we don't know in advance which side the body part
            // will declare; this guarantees no clipping.
            let mut got_any_bounds = false;
            for f in 0u16..15 {
                let b = swf_spike::render::symbol_bounds(acc_doc, acc_sym, f);
                if b.width() <= 0.0 || b.height() <= 0.0 {
                    continue;
                }
                got_any_bounds = true;
                if b.x0 < 0.0 {
                    acc_pad_left = acc_pad_left.max(-b.x0);
                }
                if b.x1 > 0.0 {
                    acc_pad_right = acc_pad_right.max(b.x1);
                }
                if b.y0 < 0.0 {
                    acc_pad_top = acc_pad_top.max(-b.y0);
                }
                if b.y1 > 0.0 {
                    acc_pad_bottom = acc_pad_bottom.max(b.y1);
                }
            }
            if !got_any_bounds {
                console_log!(
                    "renderSwfStripRangeAccessorized: accessory `{}/{}` has no geometry at any frame",
                    acc_bundles[i],
                    acc_exports[i]
                );
                continue;
            }
            resolved.push(ResolvedAcc {
                slot,
                doc: acc_doc,
                symbol: acc_sym,
                anim_type: acc_anim_types[i] as u8,
            });
        }

        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let twip_min_x = cached.min_x - acc_pad_left;
        let twip_min_y = cached.min_y - acc_pad_top;
        let twip_max_x = cached.max_x + acc_pad_right;
        let twip_max_y = cached.max_y + acc_pad_bottom;
        let px_min_x = (twip_min_x * scale).floor() - pad;
        let px_min_y = (twip_min_y * scale).floor() - pad;
        let px_max_x = (twip_max_x * scale).ceil() + pad;
        let px_max_y = (twip_max_y * scale).ceil() + pad;
        let frame_w = ((px_max_x - px_min_x) as u32).max(1);
        let frame_h = ((px_max_y - px_min_y) as u32).max(1);

        let max_cols = (16384u32 / frame_w).max(1) as usize;
        let chunk_usize = chunk_count as usize;
        let grid_cols = chunk_usize.min(max_cols);
        let grid_rows = (chunk_usize + grid_cols - 1) / grid_cols;
        let strip_w = frame_w * grid_cols as u32;
        let strip_h = frame_h * grid_rows as u32;
        if strip_w == 0 || strip_h == 0 || strip_w > 16384 || strip_h > 16384 {
            console_log!(
                "renderSwfStripRangeAccessorized: strip {strip_w}x{strip_h} exceeds GPU limits"
            );
            return JsValue::NULL;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }

        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };

        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
        let mut ctx = swf_spike::render::WgpuCtx {
            device: &self.device,
            queue: &self.queue,
            renderer: &mut self.renderer,
            filter_pipelines,
            output_scale: scale,
        };

        // One shared cache so identical body parts (used across
        // animation frames + across cells) flatten just once.
        let cache = swf_spike::render::cache::RenderCache::new();
        let player_colors = self.swf_player_colors;

        let mut scene = vello::Scene::new();
        for slot in 0..chunk_count {
            let frame_idx = start + slot;
            let col = (slot as usize) % grid_cols;
            let row = (slot as usize) / grid_cols;
            let cell_x = (col * frame_w as usize) as f64;
            let cell_y = (row * frame_h as usize) as f64;

            let xform = vello::kurbo::Affine::scale(scale).then_translate(
                vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y + cell_y),
            );

            // Rebuild the accessory dict for THIS character frame.
            // The `char_frame` field on each entry tells the
            // accessory render path which sub-frame in the chosen
            // direction to use, syncing the accessory's loop with
            // the character animation.
            let dir_char = char_dir_suffix
                .chars()
                .next()
                .unwrap_or('R')
                .to_ascii_uppercase();
            let mut accessories: swf_spike::render::ctx::AccessoryDict =
                HashMap::new();
            for r in &resolved {
                accessories.insert(
                    r.slot,
                    swf_spike::render::ctx::AccessoryEntry {
                        doc: r.doc,
                        symbol: r.symbol,
                        anim_type: r.anim_type,
                        char_frame: frame_idx as u16,
                        char_dir_suffix: dir_char,
                    },
                );
            }

            swf_spike::render::render_symbol_with_ctx_tinted_accessorized_bfixed(
                &mut ctx,
                doc,
                symbol,
                &mut scene,
                xform,
                frame_idx as u16,
                player_colors,
                &cache,
                &accessories,
                apply_b_fix,
            );
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_strip_acc"),
            size: wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: strip_w,
            height: strip_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfStripRangeAccessorized: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ =
            js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ =
            js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"frameCount".into(),
            &JsValue::from(chunk_count),
        );
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        result.into()
    }

    /// Render the STATIC parts of a multi-frame tile export (every depth
    /// whose placement data is constant across the timeline AND whose
    /// placed character has no multi-frame sub-tree). Output texture is
    /// sized to the FULL animation's union bounds, so it composites
    /// pixel-perfectly under per-frame dynamic textures from
    /// `renderSwfTileDynamicStripRange`. Returns the same shape as
    /// `renderSwfStrip` but with `frameCount=1` and `gridCols=1` since
    /// the static base is one frame.
    ///
    /// Used to break up heavy animated tiles (e.g. map 35's tile 343 —
    /// wooden building + 210-frame chimney smoke) so the building isn't
    /// re-encoded 210 times per cycle, and so each Vello scene stays
    /// well under the tile-encoder shape budget. The
    /// `feedback_swf_vello_scene_overflow` memory note prescribes this
    /// split as the canonical workaround for the overflow.
    #[wasm_bindgen(js_name = "renderSwfTileStaticBase")]
    pub fn render_swf_tile_static_base(
        &mut self,
        bundle: &str,
        export: &str,
        total_frame_count: u32,
        resolution: f32,
    ) -> JsValue {
        if total_frame_count == 0 {
            return JsValue::NULL;
        }
        let Some(cached) = self.cache_strip_bounds(bundle, export, total_frame_count) else {
            return JsValue::NULL;
        };
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };

        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let px_min_x = (cached.min_x * scale).floor() - pad;
        let px_min_y = (cached.min_y * scale).floor() - pad;
        let px_max_x = (cached.max_x * scale).ceil() + pad;
        let px_max_y = (cached.max_y * scale).ceil() + pad;
        let frame_w = ((px_max_x - px_min_x) as u32).max(1);
        let frame_h = ((px_max_y - px_min_y) as u32).max(1);
        if frame_w > 16384 || frame_h > 16384 {
            console_log!("renderSwfTileStaticBase: {frame_w}x{frame_h} exceeds GPU limits");
            return JsValue::NULL;
        }

        let xform = vello::kurbo::Affine::scale(scale)
            .then_translate(vello::kurbo::Vec2::new(-px_min_x, -px_min_y));

        let cache = swf_spike::render::cache::RenderCache::new();
        let mut classification_cache = std::collections::HashMap::new();
        let mut scene = vello::Scene::new();
        swf_spike::render::phased::render_symbol_phased(
            doc,
            symbol,
            &mut scene,
            xform,
            swf_spike::render::phased::RenderPhase::StaticOnly,
            swf_spike::swf_doc::OwnedColorTransform::IDENTITY,
            &cache,
            &mut classification_cache,
        );

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_tile_static"),
            size: wgpu::Extent3d {
                width: frame_w,
                height: frame_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: frame_w,
            height: frame_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfTileStaticBase: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        result.into()
    }

    /// Render the DYNAMIC parts of a multi-frame tile across a contiguous
    /// frame range `[start, start+count)`. Output is a strip of
    /// per-frame textures at the FULL animation's union bounds — same
    /// canvas size as the static base from `renderSwfTileStaticBase`,
    /// so the AnimatedSprite using these frames overlays pixel-perfectly
    /// on top. Each cell contains ONLY the placements classified as
    /// dynamic (timeline-varying placements, or constant placements of
    /// multi-frame characters). Static placements are skipped — they
    /// already live on the static base.
    #[wasm_bindgen(js_name = "renderSwfTileDynamicStripRange")]
    pub fn render_swf_tile_dynamic_strip_range(
        &mut self,
        bundle: &str,
        export: &str,
        start: u32,
        count: u32,
        total_frame_count: u32,
        resolution: f32,
    ) -> JsValue {
        if count == 0 || total_frame_count == 0 || start >= total_frame_count {
            return JsValue::NULL;
        }
        let Some(cached) = self.cache_strip_bounds(bundle, export, total_frame_count) else {
            return JsValue::NULL;
        };
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };
        let end = start.saturating_add(count).min(total_frame_count);
        if end <= start {
            return JsValue::NULL;
        }
        let chunk_end = end.min(cached.anim_end);
        if chunk_end <= start {
            return JsValue::NULL;
        }
        let chunk_count = chunk_end - start;

        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let px_min_x = (cached.min_x * scale).floor() - pad;
        let px_min_y = (cached.min_y * scale).floor() - pad;
        let px_max_x = (cached.max_x * scale).ceil() + pad;
        let px_max_y = (cached.max_y * scale).ceil() + pad;
        let frame_w = ((px_max_x - px_min_x) as u32).max(1);
        let frame_h = ((px_max_y - px_min_y) as u32).max(1);

        let max_cols = (16384u32 / frame_w).max(1) as usize;
        let chunk_usize = chunk_count as usize;
        let grid_cols = chunk_usize.min(max_cols);
        let grid_rows = (chunk_usize + grid_cols - 1) / grid_cols;
        let strip_w = frame_w * grid_cols as u32;
        let strip_h = frame_h * grid_rows as u32;
        if strip_w == 0 || strip_h == 0 || strip_w > 16384 || strip_h > 16384 {
            console_log!(
                "renderSwfTileDynamicStripRange: strip {strip_w}x{strip_h} exceeds GPU limits"
            );
            return JsValue::NULL;
        }

        let cache = swf_spike::render::cache::RenderCache::new();
        let mut classification_cache = std::collections::HashMap::new();
        let mut scene = vello::Scene::new();
        for slot in 0..chunk_count {
            let frame_idx = start + slot;
            let col = (slot as usize) % grid_cols;
            let row = (slot as usize) / grid_cols;
            let cell_x = (col * frame_w as usize) as f64;
            let cell_y = (row * frame_h as usize) as f64;
            let xform = vello::kurbo::Affine::scale(scale).then_translate(
                vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y + cell_y),
            );
            swf_spike::render::phased::render_symbol_phased(
                doc,
                symbol,
                &mut scene,
                xform,
                swf_spike::render::phased::RenderPhase::DynamicAt(frame_idx as u16),
                swf_spike::swf_doc::OwnedColorTransform::IDENTITY,
                &cache,
                &mut classification_cache,
            );
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_tile_dynamic"),
            size: wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: strip_w,
            height: strip_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfTileDynamicStripRange: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ =
            js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ =
            js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"frameCount".into(),
            &JsValue::from(chunk_count),
        );
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        result.into()
    }

    /// Render multiple exports of ONE bundle at the SAME frame in a single
    /// Vello dispatch — used to collapse tile prefetch from N dispatches
    /// (one per unique tile) to 1 dispatch per bundle in the map. Tiles are
    /// shelf-packed into a composite texture; the JS caller slices per-tile
    /// sub-rectangles via the returned `items*` parallel arrays.
    ///
    /// Exports that fail to look up or have degenerate bounds are encoded as
    /// `itemValid[i] = 0` with zero geometry; valid items get `itemValid[i] = 1`.
    #[wasm_bindgen(js_name = "renderSwfBundleBatch")]
    pub fn render_swf_bundle_batch(
        &mut self,
        bundle: &str,
        exports: Vec<String>,
        frame: u32,
        resolution: f32,
    ) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        if exports.is_empty() {
            return JsValue::NULL;
        }

        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let n = exports.len();

        // 1. Look up symbols + per-export bounds.
        struct ItemDims {
            valid: bool,
            symbol_idx: usize,
            px_min_x: f64,
            px_min_y: f64,
            w: u32,
            h: u32,
        }
        let mut symbols: Vec<&swf_spike::swf_doc::Symbol> = Vec::with_capacity(n);
        let mut items: Vec<ItemDims> = Vec::with_capacity(n);

        for export in &exports {
            let symbol = doc.lookup_export(export);
            if let Some(sym) = symbol {
                let bounds = swf_spike::render::symbol_bounds(doc, sym, frame as u16);
                if bounds.width() <= 0.0 || bounds.height() <= 0.0 {
                    items.push(ItemDims {
                        valid: false,
                        symbol_idx: usize::MAX,
                        px_min_x: 0.0,
                        px_min_y: 0.0,
                        w: 0,
                        h: 0,
                    });
                    continue;
                }
                let px_min_x = (bounds.x0 * scale).floor() - pad;
                let px_min_y = (bounds.y0 * scale).floor() - pad;
                let px_max_x = (bounds.x1 * scale).ceil() + pad;
                let px_max_y = (bounds.y1 * scale).ceil() + pad;
                let w = ((px_max_x - px_min_x) as u32).max(1);
                let h = ((px_max_y - px_min_y) as u32).max(1);
                let symbol_idx = symbols.len();
                symbols.push(sym);
                items.push(ItemDims {
                    valid: true,
                    symbol_idx,
                    px_min_x,
                    px_min_y,
                    w,
                    h,
                });
            } else {
                items.push(ItemDims {
                    valid: false,
                    symbol_idx: usize::MAX,
                    px_min_x: 0.0,
                    px_min_y: 0.0,
                    w: 0,
                    h: 0,
                });
            }
        }

        // 2. Shelf-pack: sort valid items by height descending, place
        //    left-to-right wrapping at MAX_WIDTH. Each shelf has a max
        //    height = first (tallest) placed item's height.
        const MAX_WIDTH: u32 = 4096;
        let mut indices: Vec<usize> = (0..n).filter(|&i| items[i].valid).collect();
        indices.sort_by(|&a, &b| items[b].h.cmp(&items[a].h));

        let mut placements: Vec<(u32, u32)> = vec![(0, 0); n];
        let mut shelf_x: u32 = 0;
        let mut shelf_y: u32 = 0;
        let mut shelf_h: u32 = 0;
        let mut total_w: u32 = 0;
        let mut total_h: u32 = 0;

        for &idx in &indices {
            let w = items[idx].w;
            let h = items[idx].h;
            // Wrap to a new shelf if this item won't fit on the current one.
            if shelf_x + w > MAX_WIDTH && shelf_x > 0 {
                shelf_y += shelf_h;
                shelf_x = 0;
                shelf_h = 0;
            }
            placements[idx] = (shelf_x, shelf_y);
            shelf_x += w;
            shelf_h = shelf_h.max(h);
            total_w = total_w.max(shelf_x);
            total_h = total_h.max(shelf_y + shelf_h);
        }

        if total_w == 0 || total_h == 0 || total_w > 16384 || total_h > 16384 {
            console_log!(
                "renderSwfBundleBatch: composite {total_w}x{total_h} invalid for {bundle}"
            );
            return JsValue::NULL;
        }

        // 3. Build composite Vello scene with all valid items at their
        //    packed positions.
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
        let mut ctx = swf_spike::render::WgpuCtx {
            device: &self.device,
            queue: &self.queue,
            renderer: &mut self.renderer,
            filter_pipelines,
            output_scale: scale,
        };

        let mut scene = vello::Scene::new();
        for (i, item) in items.iter().enumerate() {
            if !item.valid {
                continue;
            }
            let symbol = symbols[item.symbol_idx];
            let (place_x, place_y) = placements[i];
            let xform = vello::kurbo::Affine::scale(scale).then_translate(
                vello::kurbo::Vec2::new(
                    -item.px_min_x + f64::from(place_x),
                    -item.px_min_y + f64::from(place_y),
                ),
            );
            swf_spike::render::render_symbol_with_ctx_tinted(
                &mut ctx,
                doc,
                symbol,
                &mut scene,
                xform,
                frame as u16,
                self.swf_player_colors,
            );
        }

        // 4. Render the composite to one storage texture.
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_bundle_batch"),
            size: wgpu::Extent3d {
                width: total_w,
                height: total_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: total_w,
            height: total_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("renderSwfBundleBatch: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        // 5. Build parallel typed arrays for the per-item geometry.
        let item_x = js_sys::Uint32Array::new_with_length(n as u32);
        let item_y = js_sys::Uint32Array::new_with_length(n as u32);
        let item_w = js_sys::Uint32Array::new_with_length(n as u32);
        let item_h = js_sys::Uint32Array::new_with_length(n as u32);
        let item_anchor_x = js_sys::Float64Array::new_with_length(n as u32);
        let item_anchor_y = js_sys::Float64Array::new_with_length(n as u32);
        let item_valid = js_sys::Uint8Array::new_with_length(n as u32);

        for (i, item) in items.iter().enumerate() {
            let (px, py) = placements[i];
            item_x.set_index(i as u32, px);
            item_y.set_index(i as u32, py);
            item_w.set_index(i as u32, item.w);
            item_h.set_index(i as u32, item.h);
            item_anchor_x.set_index(i as u32, -item.px_min_x);
            item_anchor_y.set_index(i as u32, -item.px_min_y);
            item_valid.set_index(i as u32, if item.valid { 1 } else { 0 });
        }

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(total_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(total_h));
        let _ = js_sys::Reflect::set(&result, &"itemX".into(), &item_x.into());
        let _ = js_sys::Reflect::set(&result, &"itemY".into(), &item_y.into());
        let _ = js_sys::Reflect::set(&result, &"itemW".into(), &item_w.into());
        let _ = js_sys::Reflect::set(&result, &"itemH".into(), &item_h.into());
        let _ = js_sys::Reflect::set(&result, &"itemAnchorX".into(), &item_anchor_x.into());
        let _ = js_sys::Reflect::set(&result, &"itemAnchorY".into(), &item_anchor_y.into());
        let _ = js_sys::Reflect::set(&result, &"itemValid".into(), &item_valid.into());
        result.into()
    }

    /// Pre-encode every static tile placement into one cached Vello
    /// scene. Called by JS whenever the static set changes (map load,
    /// zoom step, viewport resize, tactic-mode toggle) — never per
    /// Pixi tick. The cached scene persists until the next call;
    /// `renderTilePass` appends it into the per-tick frame scene with
    /// a memcpy-cost path-buffer copy, eliminating the per-dispatch
    /// encoding cost of static cells (typically >99% of the map).
    ///
    /// Empty input clears the cached scene (i.e. the map has no
    /// static placements, e.g. during teardown).
    #[wasm_bindgen(js_name = "setStaticTilePlacements")]
    pub fn set_static_tile_placements(
        &mut self,
        bundles: Vec<String>,
        exports: Vec<String>,
        bundle_idx: Vec<u32>,
        export_idx: Vec<u32>,
        frames: Vec<u32>,
        matrices: Vec<f32>,
    ) {
        let n = bundle_idx.len();
        if n == 0 {
            self.static_tile_scene = None;
            return;
        }
        if export_idx.len() != n
            || frames.len() != n
            || matrices.len() != n * 6
        {
            console_log!(
                "setStaticTilePlacements: array length mismatch (n={n})"
            );
            return;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        for name in bundles.iter() {
            self.tile_render_caches
                .entry(name.clone())
                .or_default();
        }

        // Phase 1: ensure a sub-scene exists for each unique
        // `(bundle, export, frame)` triple. Sub-scenes are encoded at
        // twip-identity once and reused across cells AND across zoom
        // changes; only frame advancement on animated tiles (not
        // expected to land in `set_static_tile_placements`) would
        // trigger a new sub-scene build.
        let player_colors = self.swf_player_colors;
        {
            let renderer_ref = &mut self.renderer;
            let device_ref = &self.device;
            let queue_ref = &self.queue;
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let bundles_map = &self.swf_bundles;
            let caches_map = &self.tile_render_caches;
            let subscene_map = &mut self.tile_subscenes;
            let mut ctx = swf_spike::render::WgpuCtx {
                device: device_ref,
                queue: queue_ref,
                renderer: renderer_ref,
                filter_pipelines,
                output_scale: 1.0,
            };
            for i in 0..n {
                let b_idx = bundle_idx[i] as usize;
                let e_idx = export_idx[i] as usize;
                if b_idx >= bundles.len() || e_idx >= exports.len() {
                    continue;
                }
                let bundle_name = &bundles[b_idx];
                let export_name = &exports[e_idx];
                let frame = frames[i];
                let key = (bundle_name.clone(), export_name.clone(), frame);
                if subscene_map.contains_key(&key) {
                    continue;
                }
                let Some(doc) = bundles_map.get(bundle_name) else {
                    continue;
                };
                let Some(symbol) = doc.lookup_export(export_name) else {
                    continue;
                };
                let cache = caches_map
                    .get(bundle_name)
                    .expect("cache pre-created above");
                let mut subscene = vello::Scene::new();
                swf_spike::render::render_symbol_with_shared_cache(
                    &mut ctx,
                    doc,
                    symbol,
                    &mut subscene,
                    vello::kurbo::Affine::IDENTITY,
                    frame as u16,
                    player_colors,
                    cache,
                );
                subscene_map.insert(key, subscene);
            }
        }

        // Phase 2: build the static_tile_scene by appending each
        // placement's cached sub-scene with its per-cell matrix.
        // Pure memcpy + matrix-compose work — no symbol tree walks.
        let mut scene = vello::Scene::new();
        for i in 0..n {
            let b_idx = bundle_idx[i] as usize;
            let e_idx = export_idx[i] as usize;
            if b_idx >= bundles.len() || e_idx >= exports.len() {
                continue;
            }
            let key = (
                bundles[b_idx].clone(),
                exports[e_idx].clone(),
                frames[i],
            );
            let Some(subscene) = self.tile_subscenes.get(&key) else {
                continue;
            };
            let m = &matrices[i * 6..i * 6 + 6];
            let xform = vello::kurbo::Affine::new([
                m[0] as f64,
                m[1] as f64,
                m[2] as f64,
                m[3] as f64,
                m[4] as f64,
                m[5] as f64,
            ]);
            scene.append(subscene, Some(xform));
        }
        self.static_tile_scene = Some(scene);
    }

    /// Render an arbitrary set of (bundle, export, frame, matrix)
    /// placements into one output texture in a single Vello dispatch.
    ///
    /// Inputs use small unique-string tables (`bundles`, `exports`)
    /// indexed by per-placement parallel arrays so the marshalling cost
    /// across the JS↔WASM boundary stays in the kilobytes range even for
    /// hundreds of placements per frame.
    ///
    /// Each placement's `matrix` is a 6-element 2D affine `[a, b, c, d,
    /// tx, ty]` mapping the symbol's twip space directly to output
    /// pixels. The caller composes (zoom, world position, rotation,
    /// flip, slope) into this single matrix; the renderer treats every
    /// placement as a drop-in transform.
    ///
    /// Placements that fail to look up (missing bundle/export) are
    /// silently skipped — by design, no per-placement validity flag in
    /// the response since the caller already knows which tiles exist.
    ///
    /// Returns `{ texture, textureId, width, height }` matching the
    /// other render entry points so the JS side can wrap the GPUTexture
    /// as a Pixi `ExternalSource` per layer.
    #[wasm_bindgen(js_name = "renderTilePass")]
    pub fn render_tile_pass(
        &mut self,
        target_w: u32,
        target_h: u32,
        bundles: Vec<String>,
        exports: Vec<String>,
        bundle_idx: Vec<u32>,
        export_idx: Vec<u32>,
        frames: Vec<u32>,
        matrices: Vec<f32>,
    ) -> JsValue {
        if target_w == 0
            || target_h == 0
            || target_w > 16384
            || target_h > 16384
        {
            return JsValue::NULL;
        }
        let Some(scene) = self.prepare_tile_scene(
            &bundles,
            &exports,
            &bundle_idx,
            &export_idx,
            &frames,
            &matrices,
        ) else {
            return JsValue::NULL;
        };

        // Persistent target texture: only recreated when the size
        // changes (resize, zoom step crosses a DPR threshold, etc).
        // Reusing the same wgpu::Texture means Pixi's ExternalSource
        // can hold one stable handle while the GPU storage updates in
        // place every tick — eliminates per-tick texture allocation
        // and keeps Pixi's bind groups warm.
        let target = match &self.tile_pass_target {
            Some(t) if t.width == target_w && t.height == target_h => t,
            _ => {
                // Drop the old texture from the registry (if any) so
                // its GPU storage frees promptly. JS callers shouldn't
                // be holding a Pixi sprite over a stale handle past
                // the resize event that triggered the recreate.
                if let Some(old) = self.tile_pass_target.take() {
                    self.textures.remove(&old.tex_id);
                }
                let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("vello_tile_pass"),
                    size: wgpu::Extent3d {
                        width: target_w,
                        height: target_h,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::STORAGE_BINDING
                        | wgpu::TextureUsages::COPY_SRC
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                });
                let tex_id = self.next_texture_id;
                self.next_texture_id += 1;
                self.textures.insert(tex_id, texture);
                self.tile_pass_target = Some(TilePassTarget {
                    width: target_w,
                    height: target_h,
                    // Re-fetch the texture from the map by id to satisfy
                    // the borrow checker — we just inserted it. Cloning
                    // the wgpu::Texture would double-own the GPU resource,
                    // so we keep the canonical copy in `self.textures`
                    // and stash a clone in the target. wgpu textures are
                    // `Arc`-like internally so clone is a refcount bump.
                    texture: self.textures.get(&tex_id).unwrap().clone(),
                    tex_id,
                });
                self.tile_pass_target.as_ref().unwrap()
            }
        };

        let view = target
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: target_w,
            height: target_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) = self.renderer.render_to_texture(
            &self.device,
            &self.queue,
            &scene,
            &view,
            &params,
        ) {
            console_log!("renderTilePass: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&target.texture);
        let tex_id = target.tex_id;

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(target_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(target_h));
        result.into()
    }

    /// Tile-pass scene assembly — shared by `renderTilePass` (texture
    /// output, transitional) and `renderTilePassToSurface` (Phase 3+,
    /// canonical). Returns `None` only on parallel-array length mismatch;
    /// `n == 0` is valid and yields a scene containing only the cached
    /// `static_tile_scene`.
    ///
    /// Side effects: lazily inits `swf_filter_pipelines`, populates
    /// `tile_render_caches` for any new bundle, builds + memoizes
    /// `tile_subscenes` for each `(bundle, export, frame)` triple. The
    /// returned `Scene` is a fresh per-call assembly (static prepended,
    /// dynamic placements appended with their per-cell matrix) — caller
    /// owns the dispatch.
    fn prepare_tile_scene(
        &mut self,
        bundles: &[String],
        exports: &[String],
        bundle_idx: &[u32],
        export_idx: &[u32],
        frames: &[u32],
        matrices: &[f32],
    ) -> Option<vello::Scene> {
        let n = bundle_idx.len();
        if n > 0
            && (export_idx.len() != n
                || frames.len() != n
                || matrices.len() != n * 6)
        {
            console_log!(
                "prepare_tile_scene: parallel array length mismatch (n={n}, export_idx={}, frames={}, matrices={})",
                export_idx.len(),
                frames.len(),
                matrices.len()
            );
            return None;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        for name in bundles.iter() {
            self.tile_render_caches.entry(name.clone()).or_default();
        }

        // Phase 1: ensure sub-scenes exist for each unique dynamic
        // placement (bundle, export, frame). Cache grows up to
        // (animated_tiles × frame_count) entries — bounded.
        let player_colors = self.swf_player_colors;
        {
            let renderer_ref = &mut self.renderer;
            let device_ref = &self.device;
            let queue_ref = &self.queue;
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let bundles_map = &self.swf_bundles;
            let caches_map = &self.tile_render_caches;
            let subscene_map = &mut self.tile_subscenes;
            let mut ctx = swf_spike::render::WgpuCtx {
                device: device_ref,
                queue: queue_ref,
                renderer: renderer_ref,
                filter_pipelines,
                output_scale: 1.0,
            };
            for i in 0..n {
                let b_idx = bundle_idx[i] as usize;
                let e_idx = export_idx[i] as usize;
                if b_idx >= bundles.len() || e_idx >= exports.len() {
                    continue;
                }
                let bundle_name = &bundles[b_idx];
                let export_name = &exports[e_idx];
                let frame = frames[i];
                let key = (bundle_name.clone(), export_name.clone(), frame);
                if subscene_map.contains_key(&key) {
                    continue;
                }
                let Some(doc) = bundles_map.get(bundle_name) else {
                    continue;
                };
                let Some(symbol) = doc.lookup_export(export_name) else {
                    continue;
                };
                let cache = caches_map
                    .get(bundle_name)
                    .expect("cache pre-created above");
                let mut subscene = vello::Scene::new();
                swf_spike::render::render_symbol_with_shared_cache(
                    &mut ctx,
                    doc,
                    symbol,
                    &mut subscene,
                    vello::kurbo::Affine::IDENTITY,
                    frame as u16,
                    player_colors,
                    cache,
                );
                subscene_map.insert(key, subscene);
            }
        }

        // Phase 2: per-frame scene = cached static + dynamic placements.
        let mut scene = vello::Scene::new();
        if let Some(static_scene) = &self.static_tile_scene {
            scene.append(static_scene, None);
        }
        for i in 0..n {
            let b_idx = bundle_idx[i] as usize;
            let e_idx = export_idx[i] as usize;
            if b_idx >= bundles.len() || e_idx >= exports.len() {
                continue;
            }
            let key = (bundles[b_idx].clone(), exports[e_idx].clone(), frames[i]);
            let Some(subscene) = self.tile_subscenes.get(&key) else {
                continue;
            };
            let m = &matrices[i * 6..i * 6 + 6];
            let xform = vello::kurbo::Affine::new([
                m[0] as f64,
                m[1] as f64,
                m[2] as f64,
                m[3] as f64,
                m[4] as f64,
                m[5] as f64,
            ]);
            scene.append(subscene, Some(xform));
        }
        Some(scene)
    }

    /// Render the tile pass (Ground + Object1) directly into a
    /// previously-attached `<canvas>` surface. Replaces the
    /// `renderTilePass` → ExternalSource path: Vello writes the swap
    /// chain texture directly via `render_to_texture`, then the surface
    /// presents to the canvas. The browser composites the resulting
    /// canvas with sibling Pixi/Vello canvases via DOM stacking.
    ///
    /// `surface_id` must come from a prior `attachCanvasSurface` call.
    /// The surface's configured size determines render extents; caller
    /// must `configureSurface(id, w, h)` whenever the viewport changes
    /// before dispatching here. Returns `true` on success, `false` on
    /// any failure (unknown id, lost surface, render error).
    #[wasm_bindgen(js_name = "renderTilePassToSurface")]
    pub fn render_tile_pass_to_surface(
        &mut self,
        surface_id: u32,
        bundles: Vec<String>,
        exports: Vec<String>,
        bundle_idx: Vec<u32>,
        export_idx: Vec<u32>,
        frames: Vec<u32>,
        matrices: Vec<f32>,
    ) -> bool {
        if !self.surfaces.contains_key(&surface_id) {
            console_log!(
                "renderTilePassToSurface: unknown surface id {surface_id}"
            );
            return false;
        }
        let Some(scene) = self.prepare_tile_scene(
            &bundles,
            &exports,
            &bundle_idx,
            &export_idx,
            &frames,
            &matrices,
        ) else {
            return false;
        };
        self.dispatch_scene_to_surface(surface_id, "renderTilePassToSurface", &scene)
    }

    /// Acquire the next swap chain frame for `surface_id`, render `scene`
    /// into it via Vello, and present. Internal helper shared by all
    /// `renderXxxToSurface` entry points so the boilerplate around
    /// frame acquisition / present / error handling is centralized.
    fn dispatch_scene_to_surface(
        &mut self,
        surface_id: u32,
        label: &str,
        scene: &vello::Scene,
    ) -> bool {
        let Some(surface) = self.surfaces.get(&surface_id) else {
            return false;
        };
        let frame = match surface.get_current_texture() {
            Ok(f) => f,
            Err(e) => {
                console_log!(
                    "{label}: get_current_texture failed for surface {surface_id}: {e}"
                );
                return false;
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("vello_surface_view"),
            format: Some(wgpu::TextureFormat::Rgba8Unorm),
            dimension: Some(wgpu::TextureViewDimension::D2),
            usage: Some(wgpu::TextureUsages::STORAGE_BINDING),
            aspect: wgpu::TextureAspect::All,
            base_mip_level: 0,
            mip_level_count: Some(1),
            base_array_layer: 0,
            array_layer_count: Some(1),
        });
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: frame.texture.width(),
            height: frame.texture.height(),
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, scene, &view, &params)
        {
            console_log!("{label}: render error: {e}");
            return false;
        }
        frame.present();
        true
    }

    /// Drop a previously-allocated render output texture by id.
    /// Tile-pass outputs are allocated fresh per dispatch; the caller
    /// holds a Pixi `Texture` referencing the GPUTexture handle, and
    /// frees the underlying storage by id once Pixi has uploaded the
    /// next tick's frame. `tex_id` is taken as `f64` since wasm-bindgen
    /// marshals JS numbers as f64 — internally cast to u64 to match the
    /// `next_texture_id` counter.
    #[wasm_bindgen(js_name = "freeRenderTexture")]
    pub fn free_render_texture(&mut self, tex_id: f64) {
        self.textures.remove(&(tex_id as u64));
    }

    /// True if this export's symbol tree contains any placement with filters
    /// (drop shadow / glow / blur / color matrix). Filter-bearing tiles must
    /// be rendered individually, not in `renderSwfBundleBatch`, because the
    /// halo fallback path (`apply_halo`) emits 5–9 extra symbol renders per
    /// filter into the active scene; piling many filter-bearing tiles into
    /// one composite scene exceeds Vello's tile encoder threshold and
    /// causes silent stroke drops (sprites visibly missing). CPU-only walk
    /// of the sprite tree, recurses 5 levels deep — cheap.
    #[wasm_bindgen(js_name = "swfExportHasFilters")]
    pub fn swf_export_has_filters(&self, bundle: &str, export: &str) -> bool {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return false;
        };
        let Some(swf_spike::swf_doc::Symbol::Sprite(top)) =
            doc.lookup_export(export)
        else {
            return false;
        };
        fn recurse(
            doc: &swf_spike::swf_doc::SwfDoc,
            sp: &swf_spike::swf_doc::OwnedSprite,
            depth: u32,
        ) -> bool {
            if depth == 0 {
                return false;
            }
            for op in &sp.ops {
                if let swf_spike::swf_doc::OwnedOp::Place(p) = op {
                    if !p.filters.is_empty() {
                        return true;
                    }
                    if let Some(id) = p.character_id {
                        if let Some(swf_spike::swf_doc::Symbol::Sprite(child)) =
                            doc.lookup_id(id)
                        {
                            if recurse(doc, child, depth - 1) {
                                return true;
                            }
                        }
                    }
                }
            }
            false
        }
        recurse(doc, top, 5)
    }

    /// Returns the number of frames in the deepest animation reachable through
    /// Classify a multi-frame tile sprite as "animated" or "random".
    ///
    /// Dofus 1.29 multi-frame tile sprites split into two visual kinds:
    ///   * **animated** — plays through every frame in a loop (water,
    ///     fire, windmill blades). Caller cycles `currentFrame` over time.
    ///   * **random**   — a frame-1 `DoAction` reads the sprite's
    ///     `_totalframes`, calls `RandomNumber` then `GotoFrame2` with
    ///     `set_playing=false`, picking one variant and freezing on it
    ///     (grass tile stamps, dirt patches). Caller MUST NOT animate
    ///     these — pick one frame at load and hold it, otherwise the
    ///     ground crawls.
    ///
    /// Classify a multi-frame tile sprite into Dofus 1.29's three kinds:
    ///   * `"animated"` — no frame-1 script (or none of `random`/`stop`).
    ///     Flash plays naturally; caller cycles frames at FPS.
    ///   * `"random"` — `random(N) → gotoAndStop(...)` on frame 1.
    ///     Self-randomizing; caller picks ONE stable random frame per
    ///     cell.
    ///   * `"slope"` — `Stop()` on frame 1 with variants on frames 2..N.
    ///     The engine externally calls `gotoAndStop(cell.groundSlope)`
    ///     (MapHandler.as:226). Caller must use the cell's groundSlope
    ///     property to pick the frame.
    ///   * empty string for static (1-frame top + 1-frame children) or
    ///     unknown bundles.
    ///
    /// Important: a sprite is "animated" if EITHER the top sprite is
    /// multi-frame OR any of its (recursively-traversed) children is
    /// multi-frame. Map 35's tile 343 (the wooden building) is a
    /// 1-frame top sprite that contains a 210-frame child (1361) —
    /// without recursing, we'd label it static and freeze the building.
    #[wasm_bindgen(js_name = "swfTileAnimKind")]
    pub fn swf_tile_anim_kind(&self, bundle: &str, export: &str) -> String {
        use swf_spike::swf_doc::{
            avm1_classify_frame1, OwnedOp, Symbol, TileScriptKind,
        };
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return String::new();
        };
        let Some(Symbol::Sprite(top)) = doc.lookup_export(export) else {
            return String::new();
        };

        // Slope classification is only meaningful at the TOP sprite
        // level: the Dofus engine calls `tile.gotoAndStop(cell.groundSlope)`
        // on the placed instance directly (MapHandler.as:226). For a
        // tile to be a real slope it must have multi-frame variants on
        // the top timeline (frame 1 = flat with Stop, frames 2..N =
        // rotated). A `Stop()` inside a nested child is a separate
        // idiom — a paused sub-animation — and must NOT promote the
        // whole tile to slope (e.g. o1's tile 343 is a 1-frame
        // building wrapper around a 210-frame child that happens to
        // call Stop() in its frame 1).
        //
        // Random *can* legitimately appear on a child (the
        // `random()+gotoAndStop` self-randomizer is sometimes wrapped
        // in a 1-frame parent), so child-level Random still wins.
        let mut top_kind: Option<TileScriptKind> = None;
        for op in &top.ops {
            if matches!(op, OwnedOp::ShowFrame) {
                break;
            }
            if let OwnedOp::DoAction(bc) = op
                && let Some(k) = avm1_classify_frame1(bc)
            {
                top_kind = Some(k);
                break;
            }
        }
        if let Some(kind) = top_kind {
            match kind {
                TileScriptKind::Random => return "random".to_string(),
                TileScriptKind::Slope if top.num_frames > 1 => {
                    return "slope".to_string();
                }
                // Stop() on a 1-frame top sprite is just a no-op —
                // fall through and let the recursive nested-anim
                // check decide.
                _ => {}
            }
        }

        // Walk one level into immediate children's frame-1 ops looking
        // ONLY for Random (the wrapped self-randomizer pattern). Slope
        // detection at child level is intentionally ignored — see comment
        // above. clip_actions on the placement count as Random too since
        // some bundles attach the random script to the placement instead
        // of placing a bare DoAction on the child.
        let mut child_random = false;
        'outer: for op in &top.ops {
            if matches!(op, OwnedOp::ShowFrame) {
                break;
            }
            if let OwnedOp::Place(p) = op {
                for ca in &p.clip_actions {
                    if matches!(
                        avm1_classify_frame1(&ca.bytecode),
                        Some(TileScriptKind::Random)
                    ) {
                        child_random = true;
                        break 'outer;
                    }
                }
                if let Some(id) = p.character_id
                    && let Some(Symbol::Sprite(child)) = doc.lookup_id(id)
                {
                    for cop in &child.ops {
                        if matches!(cop, OwnedOp::ShowFrame) {
                            break;
                        }
                        if let OwnedOp::DoAction(bc) = cop
                            && matches!(
                                avm1_classify_frame1(bc),
                                Some(TileScriptKind::Random)
                            )
                        {
                            child_random = true;
                            break 'outer;
                        }
                    }
                }
            }
        }
        if child_random {
            return "random".to_string();
        }

        // No frame-1 script found. The tile is animated if the top
        // sprite is multi-frame OR any nested child is. `swfAnimFrameCount`
        // already does this recursive search and returns the longest
        // nested timeline; reuse that result.
        let total = self.swf_anim_frame_count(bundle, export);
        if total > 1 {
            "animated".to_string()
        } else {
            String::new()
        }
    }

    /// this export — `walkR` is a 1-frame wrapper around the real animation,
    /// so JS needs the inner count to drive the ticker.
    #[wasm_bindgen(js_name = "swfAnimFrameCount")]
    pub fn swf_anim_frame_count(&self, bundle: &str, export: &str) -> u32 {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return 0;
        };
        let Some(swf_spike::swf_doc::Symbol::Sprite(top)) = doc.lookup_export(export) else {
            return 0;
        };
        fn recurse(doc: &swf_spike::swf_doc::SwfDoc, sp: &swf_spike::swf_doc::OwnedSprite, depth: u32, best: &mut u16) {
            if depth == 0 {
                return;
            }
            for op in &sp.ops {
                if let swf_spike::swf_doc::OwnedOp::Place(p) = op {
                    if let Some(id) = p.character_id {
                        if let Some(swf_spike::swf_doc::Symbol::Sprite(child)) = doc.lookup_id(id) {
                            if child.num_frames > *best {
                                *best = child.num_frames;
                            }
                            recurse(doc, child, depth - 1, best);
                        }
                    }
                }
            }
        }
        let mut best = top.num_frames;
        recurse(doc, top, 4, &mut best);
        u32::from(best)
    }

    /// Set the player's three zone colours used by the SWF render path.
    /// Each value is `0xRRGGBB`; pass `0` to leave that zone untinted.
    /// Mirrors what the dofasset path does via `build_color_replacements`
    /// — but applied at render time directly to the SWF, with no bake.
    /// Call before `renderSwfFrame` for player/character sprites.
    #[wasm_bindgen(js_name = "setSwfPlayerColors")]
    pub fn set_swf_player_colors(&mut self, c1: u32, c2: u32, c3: u32) {
        let pack = |v: u32| if v == 0 { None } else { Some(v & 0xff_ff_ff) };
        self.swf_player_colors = swf_spike::recolor::PlayerColors([pack(c1), pack(c2), pack(c3)]);
    }

    /// Frames-per-second from the SWF header. Bundles vary: g1/g2 = 12,
    /// o1/o2/o4/o5/o6/o7/o10/o12 = 60, o3/o8/o9/o11 = 40. The JS tile
    /// ticker reads this per-bundle so an o1 building animates at the
    /// 60 fps it was authored for instead of a hardcoded 24 fps that
    /// runs everything at 0.4× speed.
    #[wasm_bindgen(js_name = "swfBundleFrameRate")]
    pub fn swf_bundle_frame_rate(&self, bundle: &str) -> f32 {
        self.swf_bundles
            .get(bundle)
            .map(|d| d.frame_rate)
            .unwrap_or(0.0)
    }

    // Accessories are loaded as regular .dofasset assets via loadAsset().
    // When rendering, pass accessory info as flat array: [asset_id, slot_id, asset_id, slot_id, ...]
    // Each accessory renders using the same animation name and frame index as the character.

    /// Get animation info. Returns { fps, frameCount, offsetX, offsetY, trimX, trimY, ... } or null.
    /// `offsetX/Y` is derived from the first frame's net offset (where Flash (0,0) actually
    /// lands in the rendered texture). This avoids sub-pixel discrepancies between the SWF
    /// metadata and the actual SVG content positioning that cause jitter between animations.
    #[wasm_bindgen(js_name = "getAnimationInfo")]
    pub fn get_animation_info(&self, asset_id: u32, animation: &str) -> JsValue {
        let Some(asset) = self.assets.get(&asset_id) else {
            return JsValue::NULL;
        };
        let Some(&anim_idx) = asset.animation_map.get(animation) else {
            return JsValue::NULL;
        };
        let anim = &asset.animations[anim_idx];

        // Derive offset from the first frame's net offset (clip_offset * offset_transform).
        // This is where Flash (0,0) — the registration point — actually lands in the
        // rendered texture. Using this instead of anim.offset_x/y eliminates the ~0.5px
        // discrepancy between SWF metadata and SVG content that causes visible shifts
        // when switching between animations.
        let (offset_x, offset_y, trim_x, trim_y, frame_w, frame_h) = if !anim.frame_ids.is_empty() {
            let fid = anim.frame_ids[0] as usize;
            if let Some(frame) = asset.frames.get(fid) {
                let net = scene_builder::compute_net_offset(frame, &asset.transforms);
                (
                    -(net.0 as f32),     // negate: net is position of reg point, offset is frame-to-regpoint
                    -(net.1 as f32),
                    frame.offset_x,
                    frame.offset_y,
                    frame.clip_rect[2],
                    frame.clip_rect[3],
                )
            } else {
                (anim.offset_x, anim.offset_y, 0.0, 0.0, 0.0, 0.0)
            }
        } else {
            (anim.offset_x, anim.offset_y, 0.0, 0.0, 0.0, 0.0)
        };

        let obj = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&obj, &"fps".into(), &JsValue::from(anim.fps));
        let _ = js_sys::Reflect::set(&obj, &"frameCount".into(), &JsValue::from(anim.frame_ids.len() as u32));
        let _ = js_sys::Reflect::set(&obj, &"offsetX".into(), &JsValue::from(offset_x));
        let _ = js_sys::Reflect::set(&obj, &"offsetY".into(), &JsValue::from(offset_y));
        let _ = js_sys::Reflect::set(&obj, &"trimX".into(), &JsValue::from(trim_x));
        let _ = js_sys::Reflect::set(&obj, &"trimY".into(), &JsValue::from(trim_y));
        let _ = js_sys::Reflect::set(&obj, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&obj, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(&obj, &"hasBaseFrame".into(), &JsValue::from(anim.base_frame_id != u32::MAX));
        let _ = js_sys::Reflect::set(&obj, &"baseZOrder".into(), &JsValue::from(anim.base_z_order));
        obj.into()
    }

    /// Get per-animation uniform canvas size + anchor.
    /// Returns { width, height, anchorX, anchorY } or null.
    /// All frames render at this size — eliminates jitter from per-frame size variation.
    /// The game engine draws the canvas at (screenX - anchorX, screenY - anchorY).
    #[wasm_bindgen(js_name = "getAnimationMeta")]
    pub fn get_animation_meta(
        &self,
        asset_id: u32,
        animation: &str,
        resolution: f32,
        acc_info: Option<Vec<u32>>,
    ) -> JsValue {
        let Some(asset) = self.assets.get(&asset_id) else {
            return JsValue::NULL;
        };

        let acc_scenes = build_accessory_scenes(
            &self.assets, &acc_info, animation, 0, resolution, asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        let meta = scene_builder::compute_animation_render_meta(
            asset, animation, resolution, &acc_refs,
        );

        let obj = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&obj, &"width".into(), &JsValue::from(meta.canvas_width));
        let _ = js_sys::Reflect::set(&obj, &"height".into(), &JsValue::from(meta.canvas_height));
        let _ = js_sys::Reflect::set(&obj, &"anchorX".into(), &JsValue::from(meta.anchor_x));
        let _ = js_sys::Reflect::set(&obj, &"anchorY".into(), &JsValue::from(meta.anchor_y));
        obj.into()
    }

    /// Compute pixel dimensions for a frame at a given resolution.
    /// Returns the **uniform** canvas size for the entire animation (not per-frame).
    /// This ensures all frames of the same animation render at the same size,
    /// eliminating jitter from per-frame size variation.
    /// Returns [width, height].
    #[wasm_bindgen(js_name = "getFrameSize")]
    pub fn get_frame_size(
        &self,
        asset_id: u32,
        animation: &str,
        _frame_index: u32,
        resolution: f32,
    ) -> Vec<u32> {
        let Some(asset) = self.assets.get(&asset_id) else {
            return vec![0, 0];
        };

        let meta = scene_builder::compute_animation_render_meta(
            asset, animation, resolution, &[],
        );
        vec![meta.canvas_width.max(1), meta.canvas_height.max(1)]
    }

    /// Render a frame and return the raw `GPUTexture` as a JsValue.
    /// Render a frame with optional player colors [color1, color2, color3] as 0xRRGGBB.
    /// Pass null/undefined for no color replacement.
    /// Optional acc_info is a flat array of pairs: [asset_id, slot_id, asset_id, slot_id, ...]
    /// Each accessory must be loaded via loadAsset() first. They render using the same
    /// animation name and frame index as the character.
    #[wasm_bindgen(js_name = "renderFrame")]
    pub fn render_frame(
        &mut self,
        asset_id: u32,
        animation: &str,
        frame_index: u32,
        resolution: f32,
        colors: Option<Vec<u32>>,
        acc_info: Option<Vec<u32>>,
    ) -> JsValue {
        let Some(asset) = self.assets.get(&asset_id) else {
            return JsValue::NULL;
        };

        // Convert optional colors array to the format build_frame_scene expects
        let player_colors: Option<[u32; 3]> = colors.and_then(|c| {
            if c.len() >= 3 {
                Some([c[0], c[1], c[2]])
            } else {
                None
            }
        });

        // Build accessory scenes from .dofasset data
        let acc_scenes = build_accessory_scenes(
            &self.assets, &acc_info, animation, frame_index as usize, resolution, asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        // Compute canvas size including accessories
        let meta = scene_builder::compute_animation_render_meta(
            asset, animation, resolution, &acc_refs,
        );
        let w = meta.canvas_width.max(1);
        let h = meta.canvas_height.max(1);

        let scene = scene_builder::build_frame_scene(
            asset,
            animation,
            frame_index as usize,
            player_colors.as_ref(),
            resolution,
            &acc_refs,
            (meta.bounds_offset_x, meta.bounds_offset_y),
        );

        // Render directly to the output texture.
        // STORAGE_BINDING: Vello compute writes
        // COPY_SRC: batchCopy into atlas
        // TEXTURE_BINDING: Pixi.js may sample it directly (e.g., non-atlas path)
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_frame"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[wgpu::TextureFormat::Rgba8UnormSrgb],
        });

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: w,
            height: h,
            antialiasing_method: AaConfig::Area,
        };

        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
            console_log!("VelloRenderer: render error: {e}");
            return JsValue::NULL;
        }

        // Extract GPUTexture — this is a temp texture for batchCopy into the atlas
        let gpu_texture = extract_gpu_texture(&texture);

        // Keep the wgpu::Texture alive so the GPUTexture isn't garbage collected
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        // Return { texture: GPUTexture, textureId: number, width: number, height: number }
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(&result, &"textureId".into(), &JsValue::from(tex_id as f64));
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));

        result.into()
    }

    /// Create an atlas texture for packing multiple character frames.
    /// Returns { texture: GPUTexture, textureId: number, width, height }.
    /// All characters' frames are copied into this single texture via renderFrameToAtlas.
    #[wasm_bindgen(js_name = "createAtlas")]
    pub fn create_atlas(&mut self, width: u32, height: u32) -> JsValue {
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_atlas"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[wgpu::TextureFormat::Rgba8UnormSrgb],
        });

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(&result, &"textureId".into(), &JsValue::from(tex_id as f64));
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(width));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(height));
        result.into()
    }

    /// Batch-copy multiple textures into a destination texture. ONE queue.submit for all copies.
    /// `copies` is a flat array: [src_id, dst_x, dst_y, src_id, dst_x, dst_y, ...]
    /// All copies go to the same destination texture (the atlas).
    #[wasm_bindgen(js_name = "batchCopy")]
    pub fn batch_copy(
        &mut self,
        dst_texture_id: f64,
        copies: &[f64],
    ) -> bool {
        let dst_id = dst_texture_id as u64;
        if copies.len() < 3 { return false; }

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("batch_copy"),
        });

        for chunk in copies.chunks(3) {
            let src_id = chunk[0] as u64;
            let dst_x = chunk[1] as u32;
            let dst_y = chunk[2] as u32;

            let Some(src) = self.textures.get(&src_id) else { continue };
            let src_w = src.width();
            let src_h = src.height();
            let Some(dst) = self.textures.get(&dst_id) else { return false };

            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: src, mip_level: 0,
                    origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: dst, mip_level: 0,
                    origin: wgpu::Origin3d { x: dst_x, y: dst_y, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d { width: src_w, height: src_h, depth_or_array_layers: 1 },
            );
        }

        self.queue.submit(Some(encoder.finish()));
        true
    }

    /// Render a frame and copy it into a slot of an atlas texture.
    /// Returns { width, height } of the rendered frame, or null on failure.
    /// dst_x/dst_y are pixel coordinates in the atlas.
    #[wasm_bindgen(js_name = "renderFrameToAtlas")]
    pub fn render_frame_to_atlas(
        &mut self,
        atlas_texture_id: f64,
        dst_x: u32,
        dst_y: u32,
        asset_id: u32,
        animation: &str,
        frame_index: u32,
        resolution: f32,
        colors: Option<Vec<u32>>,
        acc_info: Option<Vec<u32>>,
        slot_w: Option<u32>,
        slot_h: Option<u32>,
    ) -> JsValue {
        let atlas_id = atlas_texture_id as u64;
        let Some(atlas) = self.textures.get(&atlas_id) else {
            return JsValue::NULL;
        };
        // Clone the reference so we don't hold a borrow on self.textures
        let atlas_size = wgpu::Extent3d {
            width: atlas.width(),
            height: atlas.height(),
            depth_or_array_layers: 1,
        };
        // We need a way to reference the atlas texture for the copy.
        // Since copy_texture_to_texture takes &Texture, we need to work with the borrow.
        // Build the scene first (needs &self.assets), then do the GPU work.

        let Some(asset) = self.assets.get(&asset_id) else {
            return JsValue::NULL;
        };

        let player_colors: Option<[u32; 3]> = colors.and_then(|c| {
            if c.len() >= 3 { Some([c[0], c[1], c[2]]) } else { None }
        });

        let acc_scenes = build_accessory_scenes(
            &self.assets, &acc_info, animation, frame_index as usize, resolution, asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        let meta = scene_builder::compute_animation_render_meta(
            asset, animation, resolution, &acc_refs,
        );
        let w = meta.canvas_width.max(1);
        let h = meta.canvas_height.max(1);

        let scene = scene_builder::build_frame_scene(
            asset, animation, frame_index as usize,
            player_colors.as_ref(), resolution, &acc_refs,
            (meta.bounds_offset_x, meta.bounds_offset_y),
        );

        // Render to a temporary texture sized to the FULL SLOT (not just the frame).
        // The scene content occupies (w, h) and the rest is transparent.
        // This ensures the entire slot area is overwritten when copied to the atlas,
        // preventing stale content from a previous (larger) frame showing through.
        let render_w = slot_w.unwrap_or(w).max(w);
        let render_h = slot_h.unwrap_or(h).max(h);
        let render_target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_atlas_rt"),
            size: wgpu::Extent3d { width: render_w, height: render_h, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: render_w, height: render_h,
            antialiasing_method: AaConfig::Area,
        };

        if self.renderer.render_to_texture(&self.device, &self.queue, &scene, &rt_view, &params).is_err() {
            return JsValue::NULL;
        }

        // Copy the full slot area (not just the frame) to clear any stale content
        let copy_w = render_w.min(atlas_size.width.saturating_sub(dst_x));
        let copy_h = render_h.min(atlas_size.height.saturating_sub(dst_y));
        if copy_w == 0 || copy_h == 0 {
            return JsValue::NULL;
        }

        // Copy rendered frame into atlas slot
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("atlas_copy"),
        });

        // Re-borrow atlas texture for the copy
        let atlas_tex = self.textures.get(&atlas_id).unwrap();
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &render_target, mip_level: 0,
                origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: atlas_tex, mip_level: 0,
                origin: wgpu::Origin3d { x: dst_x, y: dst_y, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d { width: copy_w, height: copy_h, depth_or_array_layers: 1 },
        );
        self.queue.submit(Some(encoder.finish()));

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        result.into()
    }

    /// Queue a frame for batch rendering. Builds the Vello scene (CPU work) and stores it.
    /// Returns { width, height } of the frame, or null on failure.
    /// Call flushFrames() to render all queued frames in ONE GPU dispatch + copy.
    #[wasm_bindgen(js_name = "queueFrame")]
    pub fn queue_frame(
        &mut self,
        asset_id: u32,
        animation: &str,
        frame_index: u32,
        resolution: f32,
        colors: Option<Vec<u32>>,
        acc_info: Option<Vec<u32>>,
        dst_x: u32,
        dst_y: u32,
    ) -> JsValue {
        let Some(asset) = self.assets.get(&asset_id) else {
            return JsValue::NULL;
        };

        let player_colors: Option<[u32; 3]> = colors.and_then(|c| {
            if c.len() >= 3 { Some([c[0], c[1], c[2]]) } else { None }
        });

        let acc_scenes = build_accessory_scenes(
            &self.assets, &acc_info, animation, frame_index as usize, resolution, asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        // Use character-only canvas size (no accessories) for consistent dimensions.
        // Different accessory combinations produce different canvas sizes, causing
        // characters to shift position within variably-sized textures → visible jitter.
        // Accessories extending beyond the character bounds are clipped by flushFrames.
        let meta = scene_builder::compute_animation_render_meta(
            asset, animation, resolution, &[],
        );
        let w = meta.canvas_width.max(1);
        let h = meta.canvas_height.max(1);

        let scene = scene_builder::build_frame_scene(
            asset, animation, frame_index as usize,
            player_colors.as_ref(), resolution, &acc_refs,
            (meta.bounds_offset_x, meta.bounds_offset_y),
        );

        self.queued_frames.push(QueuedFrame {
            scene, width: w, height: h, dst_x, dst_y,
        });

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        result.into()
    }

    /// Render all queued frames in a composite grid, then batch-copy to atlas.
    /// 1 Vello render + 1 batch copy = 2 GPU submits total.
    #[wasm_bindgen(js_name = "flushFrames")]
    pub fn flush_frames(&mut self, atlas_texture_id: f64) {
        if self.queued_frames.is_empty() {
            return;
        }

        let atlas_id = atlas_texture_id as u64;
        const MAX_TEX_DIM: u32 = 8192;
        // Cell size = atlas slot size (256 at 2x). Using the slot size ensures
        // each frame's copy overwrites the ENTIRE slot, clearing stale content
        // from previous occupants. The transparent background of the Vello render
        // fills uncovered areas within each cell.
        const SLOT_SIZE: u32 = 256;

        let max_dim = self.queued_frames.iter()
            .map(|f| f.width.max(f.height))
            .max()
            .unwrap_or(SLOT_SIZE);
        let cell = max_dim.max(SLOT_SIZE).next_power_of_two().min(2048);
        let cols = (MAX_TEX_DIM / cell).max(1);
        let max_rows = MAX_TEX_DIM / cell;
        let batch_size = (cols * max_rows) as usize;

        struct Region { src_x: u32, src_y: u32, dst_x: u32, dst_y: u32 }

        let mut offset = 0;
        while offset < self.queued_frames.len() {
            let end = (offset + batch_size).min(self.queued_frames.len());
            let batch = &self.queued_frames[offset..end];
            let batch_len = batch.len() as u32;

            let mut composite = vello::Scene::new();
            let mut regions: Vec<Region> = Vec::new();

            for (i, frame) in batch.iter().enumerate() {
                let col = (i as u32) % cols;
                let row = (i as u32) / cols;
                let cx = col * cell;
                let cy = row * cell;

                // Clip each frame to its cell so content can't bleed into neighbors
                let clip_rect = vello::kurbo::Rect::new(
                    cx as f64, cy as f64, (cx + cell) as f64, (cy + cell) as f64,
                );
                composite.push_layer(
                    vello::peniko::Fill::default(), vello::peniko::BlendMode::default(), 1.0,
                    vello::kurbo::Affine::IDENTITY, &clip_rect,
                );
                composite.append(
                    &frame.scene,
                    Some(vello::kurbo::Affine::translate((cx as f64, cy as f64))),
                );
                composite.pop_layer();

                regions.push(Region { src_x: cx, src_y: cy, dst_x: frame.dst_x, dst_y: frame.dst_y });
            }

            let num_rows = (batch_len + cols - 1) / cols;
            let used_cols = batch_len.min(cols);
            let total_width = used_cols * cell;
            let total_height = num_rows * cell;

            if total_width == 0 || total_height == 0 {
                offset = end;
                continue;
            }

            let render_target = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("batch_render"),
                size: wgpu::Extent3d { width: total_width, height: total_height, depth_or_array_layers: 1 },
                mip_level_count: 1, sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
            let params = vello::RenderParams {
                base_color: Color::TRANSPARENT,
                width: total_width, height: total_height,
                antialiasing_method: AaConfig::Area,
            };

            if self.renderer.render_to_texture(&self.device, &self.queue, &composite, &rt_view, &params).is_err() {
                offset = end;
                continue;
            }

            if let Some(atlas_tex) = self.textures.get(&atlas_id) {
                let atlas_w = atlas_tex.width();
                let atlas_h = atlas_tex.height();
                let mut encoder = self.device.create_command_encoder(
                    &wgpu::CommandEncoderDescriptor { label: Some("batch_copy") },
                );

                // Copy FULL CELL (not just frame size) to clear stale content
                for r in &regions {
                    let cw = cell.min(atlas_w.saturating_sub(r.dst_x));
                    let ch = cell.min(atlas_h.saturating_sub(r.dst_y));
                    if cw == 0 || ch == 0 { continue; }

                    encoder.copy_texture_to_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &render_target, mip_level: 0,
                            origin: wgpu::Origin3d { x: r.src_x, y: r.src_y, z: 0 },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyTextureInfo {
                            texture: atlas_tex, mip_level: 0,
                            origin: wgpu::Origin3d { x: r.dst_x, y: r.dst_y, z: 0 },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::Extent3d { width: cw, height: ch, depth_or_array_layers: 1 },
                    );
                }

                self.queue.submit(Some(encoder.finish()));
            }

            offset = end;
        }

        self.queued_frames.clear();
    }

    /// Render ALL frames of an animation into a single horizontal strip texture.
    /// Returns { texture, textureId, width, height, frameWidth, frameHeight, frameCount }.
    /// JS extracts sub-rectangles: frame i is at (i * frameWidth, 0, frameWidth, frameHeight).
    /// One GPU dispatch for all frames — much faster than rendering frames individually.
    /// Supports accessories: pass acc_info as flat [asset_id, slot_id, ...] pairs.
    #[wasm_bindgen(js_name = "renderAnimationStrip")]
    pub fn render_animation_strip(
        &mut self,
        asset_id: u32,
        animation: &str,
        resolution: f32,
        colors: Option<Vec<u32>>,
        acc_info: Option<Vec<u32>>,
    ) -> JsValue {
        let Some(asset) = self.assets.get(&asset_id) else {
            return JsValue::NULL;
        };
        let Some(&anim_idx) = asset.animation_map.get(animation) else {
            return JsValue::NULL;
        };
        let anim = &asset.animations[anim_idx];
        let frame_count = anim.frame_ids.len();
        if frame_count == 0 {
            return JsValue::NULL;
        }

        let player_colors: Option<[u32; 3]> = colors.and_then(|c| {
            if c.len() >= 3 { Some([c[0], c[1], c[2]]) } else { None }
        });

        // Compute canvas size INCLUDING accessories across ALL frames.
        // Accessories may extend into negative coordinates (hats above character),
        // so track min bounds to shift content into the positive canvas area.
        let mut global_min_x = 0.0_f64;
        let mut global_min_y = 0.0_f64;
        let mut global_max_x = 0.0_f64;
        let mut global_max_y = 0.0_f64;
        for i in 0..frame_count {
            let acc_scenes_i = build_accessory_scenes(
                &self.assets, &acc_info, animation, i, resolution, asset,
            );
            let acc_refs_i: Vec<&AccessoryScene> = acc_scenes_i.iter().collect();
            let (bmin_x, bmin_y, bw, bh) = scene_builder::compute_frame_bounds(
                asset, animation, i, resolution, &acc_refs_i,
            );
            global_min_x = global_min_x.min(bmin_x);
            global_min_y = global_min_y.min(bmin_y);
            global_max_x = global_max_x.max(bmin_x + bw);
            global_max_y = global_max_y.max(bmin_y + bh);
        }

        // bounds_offset shifts content so negative accessories are visible
        let bounds_offset = (-global_min_x, -global_min_y);
        let max_w = ((global_max_x - global_min_x).ceil() as u32).max(1);
        let max_h = ((global_max_y - global_min_y).ceil() as u32).max(1);

        // Compute the anchor (registration point) within the tight frame.
        let first_fid = anim.frame_ids[0] as usize;
        let has_base = anim.base_frame_id != u32::MAX;
        let (anchor_x, anchor_y) = if has_base {
            if let Some(base_frame) = asset.frames.get(anim.base_frame_id as usize) {
                let net = scene_builder::compute_net_offset(base_frame, &asset.transforms);
                (net.0 * resolution as f64 + bounds_offset.0,
                 net.1 * resolution as f64 + bounds_offset.1)
            } else {
                (bounds_offset.0, bounds_offset.1)
            }
        } else if let Some(first_frame) = asset.frames.get(first_fid) {
            let net = scene_builder::compute_net_offset(first_frame, &asset.transforms);
            (net.0 * resolution as f64 + bounds_offset.0,
             net.1 * resolution as f64 + bounds_offset.1)
        } else {
            (bounds_offset.0, bounds_offset.1)
        };

        // Arrange frames in a 2D grid to stay within GPU texture limits (16384×16384).
        // E.g., 42 frames at 400px wide → 40 cols × 2 rows = 16000×800 instead of 16800×400.
        let max_cols = (16384 / max_w).max(1) as usize;
        let grid_cols = frame_count.min(max_cols);
        let grid_rows = (frame_count + grid_cols - 1) / grid_cols;
        let strip_w = max_w * grid_cols as u32;
        let strip_h = max_h * grid_rows as u32;

        if strip_w > 16384 || strip_h > 16384 {
            return JsValue::NULL;
        }

        // Build ONE composite Vello scene with all frames in a grid.
        // Single GPU dispatch for the entire animation.
        let mut composite = vello::Scene::new();
        for i in 0..frame_count {
            let col = i % grid_cols;
            let row = i / grid_cols;

            let acc_scenes = build_accessory_scenes(
                &self.assets, &acc_info, animation, i, resolution, asset,
            );
            let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

            let frame_scene = scene_builder::build_frame_scene(
                asset, animation, i, player_colors.as_ref(), resolution, &acc_refs, bounds_offset,
            );

            let cx = (col as u32 * max_w) as f64;
            let cy = (row as u32 * max_h) as f64;
            let clip = vello::kurbo::Rect::new(cx, cy, cx + max_w as f64, cy + max_h as f64);
            composite.push_layer(vello::peniko::Fill::default(), vello::peniko::BlendMode::default(), 1.0, vello::kurbo::Affine::IDENTITY, &clip);
            composite.append(&frame_scene, Some(vello::kurbo::Affine::translate((cx, cy))));
            composite.pop_layer();
        }

        // Render entire strip in ONE Vello dispatch directly to STORAGE texture,
        // then copy to the final TEXTURE_BINDING texture.
        let render_target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_strip_rt"),
            size: wgpu::Extent3d { width: strip_w, height: strip_h, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: strip_w, height: strip_h,
            antialiasing_method: AaConfig::Area,
        };

        if self.renderer.render_to_texture(&self.device, &self.queue, &composite, &rt_view, &params).is_err() {
            return JsValue::NULL;
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_strip"),
            size: wgpu::Extent3d { width: strip_w, height: strip_h, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("strip_copy"),
        });
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &render_target, mip_level: 0,
                origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &texture, mip_level: 0,
                origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d { width: strip_w, height: strip_h, depth_or_array_layers: 1 },
        );
        self.queue.submit(Some(encoder.finish()));
        // tmp_textures dropped here — safe, submit already consumed the command buffer

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(&result, &"textureId".into(), &JsValue::from(tex_id as f64));
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(max_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(max_h));
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(frame_count as u32));
        let _ = js_sys::Reflect::set(&result, &"gridCols".into(), &JsValue::from(grid_cols as u32));
        // bounds_offset: how much the content was shifted to fit negative accessory positions
        let _ = js_sys::Reflect::set(&result, &"boundsOffsetX".into(), &JsValue::from(bounds_offset.0));
        let _ = js_sys::Reflect::set(&result, &"boundsOffsetY".into(), &JsValue::from(bounds_offset.1));
        // anchor: registration point within the tight frame (in pixels at render resolution)
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(anchor_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(anchor_y));
        result.into()
    }

    /// Render a single zone mask frame. Returns { texture, textureId, width, height }.
    /// Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
    #[wasm_bindgen(js_name = "renderZoneMaskFrame")]
    pub fn render_zone_mask_frame(
        &mut self,
        asset_id: u32,
        animation: &str,
        frame_index: u32,
        resolution: f32,
        acc_info: Option<Vec<u32>>,
    ) -> JsValue {
        let Some(asset) = self.assets.get(&asset_id) else { return JsValue::NULL };

        let acc_scenes = build_accessory_scenes(
            &self.assets, &acc_info, animation, frame_index as usize, resolution, asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();
        let frame_scene = scene_builder::build_zone_mask_scene(asset, animation, frame_index as usize, resolution, &acc_refs);
        let dims = self.get_frame_size(asset_id, animation, frame_index, resolution);
        let w = dims[0].max(1);
        let h = dims[1].max(1);

        // Same render-then-copy pattern as renderFrame to isolate Vello's
        // render target from Pixi.js's sampling texture.
        let render_target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_zm_rt"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: w, height: h,
            antialiasing_method: AaConfig::Area,
        };

        if let Err(e) = self.renderer.render_to_texture(&self.device, &self.queue, &frame_scene, &rt_view, &params) {
            console_log!("VelloRenderer: zone mask frame render error: {e}");
            return JsValue::NULL;
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_zm_out"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("zm_copy"),
        });
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &render_target, mip_level: 0,
                origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &texture, mip_level: 0,
                origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.queue.submit(Some(encoder.finish()));

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(&result, &"textureId".into(), &JsValue::from(tex_id as f64));
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(h));
        result.into()
    }

    /// Render a zone mask strip: same layout as renderAnimationStrip but with
    /// zone marker colors (R=zone1, G=zone2, B=zone3) and opaque black for non-zone.
    /// Used alongside the base strip for GPU color replacement without item bleed.
    /// Optional acc_info: flat array of pairs [asset_id, slot_id, ...] for accessory occluders.
    #[wasm_bindgen(js_name = "renderZoneMaskStrip")]
    pub fn render_zone_mask_strip(
        &mut self,
        asset_id: u32,
        animation: &str,
        resolution: f32,
        acc_info: Option<Vec<u32>>,
    ) -> JsValue {
        let Some(asset) = self.assets.get(&asset_id) else { return JsValue::NULL };
        let Some(&anim_idx) = asset.animation_map.get(animation) else { return JsValue::NULL };
        let anim = &asset.animations[anim_idx];
        let frame_count = anim.frame_ids.len();
        if frame_count == 0 { return JsValue::NULL; }

        let mut max_w: u32 = 1;
        let mut max_h: u32 = 1;
        for i in 0..frame_count {
            let dims = self.get_frame_size(asset_id, animation, i as u32, resolution);
            max_w = max_w.max(dims[0]);
            max_h = max_h.max(dims[1]);
        }

        let strip_w = max_w * frame_count as u32;
        let strip_h = max_h;
        if strip_w > 8192 { return JsValue::NULL; }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_zone_mask"),
            size: wgpu::Extent3d { width: strip_w, height: strip_h, depth_or_array_layers: 1 },
            mip_level_count: 1, sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("zone_mask_copy"),
        });
        let mut tmp_textures: Vec<wgpu::Texture> = Vec::with_capacity(frame_count);

        for i in 0..frame_count {
            let acc_scenes = build_accessory_scenes(&self.assets, &acc_info, animation, i, resolution, asset);
            let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();
            let frame_scene = scene_builder::build_zone_mask_scene(asset, animation, i, resolution, &acc_refs);
            let dims = self.get_frame_size(asset_id, animation, i as u32, resolution);
            let fw = dims[0].max(1);
            let fh = dims[1].max(1);

            let tmp = self.device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d { width: fw, height: fh, depth_or_array_layers: 1 },
                mip_level_count: 1, sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let tmp_view = tmp.create_view(&wgpu::TextureViewDescriptor::default());
            let params = vello::RenderParams {
                base_color: Color::TRANSPARENT,
                width: fw, height: fh,
                antialiasing_method: AaConfig::Area,
            };

            if self.renderer.render_to_texture(&self.device, &self.queue, &frame_scene, &tmp_view, &params).is_err() {
                continue;
            }

            let copy_w = fw.min(max_w);
            let copy_h = fh.min(max_h);
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &tmp, mip_level: 0,
                    origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &texture, mip_level: 0,
                    origin: wgpu::Origin3d { x: i as u32 * max_w, y: 0, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d { width: copy_w, height: copy_h, depth_or_array_layers: 1 },
            );
            tmp_textures.push(tmp);
        }

        self.queue.submit(Some(encoder.finish()));
        drop(tmp_textures);

        let gpu_texture = extract_gpu_texture(&texture);
        let tex_id = self.next_texture_id;
        self.next_texture_id += 1;
        self.textures.insert(tex_id, texture);

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(&result, &"textureId".into(), &JsValue::from(tex_id as f64));
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(max_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(max_h));
        result.into()
    }

    /// Free a rendered texture by its ID (returned from renderFrame).
    /// The wgpu::Texture is removed from our HashMap and dropped, releasing
    /// the reference to the underlying GPUTexture. We do NOT call tex.destroy()
    /// because Pixi.js may still have pending GPU commands referencing it.
    /// The browser's GC will collect the GPUTexture once all references are gone.
    #[wasm_bindgen(js_name = "freeTexture")]
    pub fn free_texture(&mut self, texture_id: f64) {
        let id = texture_id as u64;
        self.textures.remove(&id);
        // Dropped — releases our reference, does NOT call GPUTexture.destroy()
    }

    /// Free all cached textures.
    #[wasm_bindgen(js_name = "freeAllTextures")]
    pub fn free_all_textures(&mut self) {
        self.textures.clear();
    }


    /// List animation names for an asset.
    #[wasm_bindgen(js_name = "getAnimationNames")]
    pub fn get_animation_names(&self, asset_id: u32) -> Vec<String> {
        let Some(asset) = self.assets.get(&asset_id) else {
            return Vec::new();
        };
        asset.animations.iter().map(|a| a.name.clone()).collect()
    }

    /// Path cache observability.
    ///
    /// Reports the live state of the two long-lived tile-pass caches:
    ///   - `tile_render_caches` (per-bundle `RenderCache`): shape
    ///     command tessellation, morph interpolations, sprite frame-
    ///     state walks. Populated by tile paths; character + spell
    ///     paths use fresh per-call caches because their bundles
    ///     have shape-id collisions with each other.
    ///   - `tile_subscenes`: pre-encoded `vello::Scene` per
    ///     `(bundle, export, frame)` used by `setStaticTilePlacements`
    ///     + `renderTilePass` to memcpy-append cached tile geometry.
    ///
    /// Memory bytes are estimates — Vello scenes don't expose encoded
    /// size, so we count entries × heuristic constant (~8 KB per
    /// typical tile sub-scene). Use the entry count for hit-rate
    /// validation; bytes for capacity-planning only.
    ///
    /// Returns `{ bundleCacheCount, sceneCacheCount, sceneBytesEstimate }`.
    #[wasm_bindgen(js_name = "pathCacheStats")]
    pub fn path_cache_stats(&self) -> JsValue {
        const SCENE_BYTES_ESTIMATE: usize = 8 * 1024;
        let scene_count = self.tile_subscenes.len();
        let bundle_count = self.tile_render_caches.len();
        let bytes_est = scene_count * SCENE_BYTES_ESTIMATE;

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &result,
            &"bundleCacheCount".into(),
            &JsValue::from(bundle_count as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"sceneCacheCount".into(),
            &JsValue::from(scene_count as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"sceneBytesEstimate".into(),
            &JsValue::from(bytes_est as f64),
        );
        result.into()
    }

    /// Render the unified L3 World layer.
    ///
    /// Heterogeneous placement-list dispatch matching the canonical
    /// Object2 depth band (foreground tiles + characters + spell VFX
    /// interleaved by `cellNum × 100 + sub-offset`). Four placement
    /// kinds:
    ///   - kind=0  Tile  — bundle/export/frame/matrix
    ///   - kind=1  Char  — bundle/export/frame/matrix + accessories
    ///                     + color zones + dirSuffix + bFix + alpha
    ///   - kind=2  Spell — instance_id (resolved against AVM1 state)
    ///                     + matrix + alpha
    ///   - kind=3  Decal — bundle/export/frame/matrix + alpha
    ///
    /// Caller contract:
    ///   - `kinds[i]` discriminates the placement; out-of-range kinds
    ///     are skipped silently (TS-Rust version skew tolerance).
    ///   - `bundles`/`exports` are dedup'd; `bundle_idx`/`export_idx`
    ///     index into them. Accessory bundles + exports MUST be added
    ///     to those tables (callers intern them).
    ///   - `frames`/`alphas`/`depths` are per-placement.
    ///   - `matrices` is 6 × n floats (`a, b, c, d, tx, ty`).
    ///   - **Caller MUST sort placements by `depths` ascending** —
    ///     `WorldLayer.snapshotByDepth()` does this. Vello renders in
    ///     scene-order; out-of-order placements paint incorrectly.
    ///   - `color_zones` is `3 × n` u32; sentinel `u32::MAX` = absent.
    ///   - `char_dirs[i]` ASCII direction byte ('R','L','F','B','S'),
    ///     or 0 for non-Char.
    ///   - `char_b_fix[i]` 0/1 — non-zero triggers AS2 bFix mirror for
    ///     accessories with `b_fix=true` mounts (capes, shields).
    ///   - **Accessory CSR layout** for variable-length per-Char
    ///     accessory lists: `acc_offsets[i]..acc_offsets[i+1]` slices
    ///     into `acc_*[]`. `acc_offsets` length is `n+1`. Non-Char
    ///     placements emit an empty range.
    ///
    /// Static foreground tile content prepended via `static_world_scene`
    /// (built once by `setStaticWorldTiles`). Per-tick dispatch
    /// re-encodes only the dynamic subset (animated tiles + chars +
    /// spells) on top.
    ///
    /// Returns `{texture, textureId, width, height}` on success, NULL
    /// on input validation failure or render error.
    #[wasm_bindgen(js_name = "renderWorldPass")]
    pub fn render_world_pass(
        &mut self,
        target_w: u32,
        target_h: u32,
        kinds: Vec<u8>,
        bundles: Vec<String>,
        exports: Vec<String>,
        bundle_idx: Vec<u32>,
        export_idx: Vec<u32>,
        frames: Vec<u32>,
        depths: Vec<i32>,
        matrices: Vec<f32>,
        alphas: Vec<f32>,
        color_zones: Vec<u32>,
        char_dirs: Vec<u8>,
        char_b_fix: Vec<u8>,
        acc_offsets: Vec<u32>,
        acc_slots: Vec<u8>,
        acc_bundle_idx: Vec<u32>,
        acc_export_idx: Vec<u32>,
        acc_anim_types: Vec<u8>,
    ) -> JsValue {
        if target_w == 0
            || target_h == 0
            || target_w > 16384
            || target_h > 16384
        {
            return JsValue::NULL;
        }
        let Some(scene) = self.prepare_world_scene(
            &kinds,
            &bundles,
            &exports,
            &bundle_idx,
            &export_idx,
            &frames,
            &depths,
            &matrices,
            &alphas,
            &color_zones,
            &char_dirs,
            &char_b_fix,
            &acc_offsets,
            &acc_slots,
            &acc_bundle_idx,
            &acc_export_idx,
            &acc_anim_types,
        ) else {
            return JsValue::NULL;
        };
        // Persistent world target. Reused across dispatches; only
        // recreated on size change so Pixi's ExternalSource holds a
        // stable handle while contents update in place.
        let target = match &self.world_pass_target {
            Some(t) if t.width == target_w && t.height == target_h => t,
            _ => {
                if let Some(old) = self.world_pass_target.take() {
                    self.textures.remove(&old.tex_id);
                }
                let texture =
                    self.device.create_texture(&wgpu::TextureDescriptor {
                        label: Some("vello_world_pass"),
                        size: wgpu::Extent3d {
                            width: target_w,
                            height: target_h,
                            depth_or_array_layers: 1,
                        },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        usage: wgpu::TextureUsages::STORAGE_BINDING
                            | wgpu::TextureUsages::COPY_SRC
                            | wgpu::TextureUsages::TEXTURE_BINDING,
                        view_formats: &[],
                    });
                let tex_id = self.next_texture_id;
                self.next_texture_id += 1;
                self.textures.insert(tex_id, texture);
                self.world_pass_target = Some(TilePassTarget {
                    width: target_w,
                    height: target_h,
                    texture: self.textures.get(&tex_id).unwrap().clone(),
                    tex_id,
                });
                self.world_pass_target.as_ref().unwrap()
            }
        };

        let view = target
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: target_w,
            height: target_h,
            antialiasing_method: AaConfig::Area,
        };
        if let Err(e) = self.renderer.render_to_texture(
            &self.device,
            &self.queue,
            &scene,
            &view,
            &params,
        ) {
            console_log!("renderWorldPass: render error: {e}");
            return JsValue::NULL;
        }

        let gpu_texture = extract_gpu_texture(&target.texture);
        let tex_id = target.tex_id;
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"texture".into(), &gpu_texture);
        let _ = js_sys::Reflect::set(
            &result,
            &"textureId".into(),
            &JsValue::from(tex_id as f64),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"width".into(),
            &JsValue::from(target_w),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"height".into(),
            &JsValue::from(target_h),
        );
        result.into()
    }

    /// World-pass scene assembly — shared by `renderWorldPass` (texture
    /// output, transitional) and `renderWorldPassToSurface` (Phase 4+,
    /// canonical). Returns `None` only on parallel-array length
    /// mismatch; `n == 0` is valid and yields a scene containing only
    /// the cached `static_world_scene`.
    ///
    /// Encoding contract — same as `render_world_pass`:
    ///   kinds[i]: 0=tile, 1=char, 2=spell, 3=decal.
    ///   Tile/Decal use `(bundle, export, frame)` keyed subscene cache.
    ///   Char re-renders per-placement (color zones can't cache).
    ///   Spell composes live AVM1 state via `frames[i] = instance_id`.
    fn prepare_world_scene(
        &mut self,
        kinds: &[u8],
        bundles: &[String],
        exports: &[String],
        bundle_idx: &[u32],
        export_idx: &[u32],
        frames: &[u32],
        depths: &[i32],
        matrices: &[f32],
        alphas: &[f32],
        color_zones: &[u32],
        char_dirs: &[u8],
        char_b_fix: &[u8],
        acc_offsets: &[u32],
        acc_slots: &[u8],
        acc_bundle_idx: &[u32],
        acc_export_idx: &[u32],
        acc_anim_types: &[u8],
    ) -> Option<vello::Scene> {
        let n = kinds.len();
        if n > 0
            && (bundle_idx.len() != n
                || export_idx.len() != n
                || frames.len() != n
                || depths.len() != n
                || alphas.len() != n
                || matrices.len() != n * 6
                || color_zones.len() != n * 3
                || char_dirs.len() != n
                || char_b_fix.len() != n
                || acc_offsets.len() != n + 1)
        {
            console_log!(
                "prepare_world_scene: parallel array length mismatch (n={n})"
            );
            return None;
        }
        if n > 0 {
            let acc_total = *acc_offsets.last().unwrap_or(&0) as usize;
            if acc_slots.len() != acc_total
                || acc_bundle_idx.len() != acc_total
                || acc_export_idx.len() != acc_total
                || acc_anim_types.len() != acc_total
            {
                console_log!(
                    "prepare_world_scene: accessory CSR length mismatch (total={acc_total})"
                );
                return None;
            }
        }
        let _ = depths; // depths threaded for future ordering asserts.

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        for name in bundles.iter() {
            self.tile_render_caches.entry(name.clone()).or_default();
        }

        // Phase 1: ensure tile subscenes exist for every Tile/Decal
        // placement (kind 0 or 3) at unique (bundle, export, frame).
        // Char (kind=1) skips this — color zones are per-placement and
        // can't be cached at the (bundle, export, frame) key.
        // Spell (kind=2) skips this — AVM1 state is dynamic.
        let mut warned_kinds: u8 = 0;
        {
            let renderer_ref = &mut self.renderer;
            let device_ref = &self.device;
            let queue_ref = &self.queue;
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let bundles_map = &self.swf_bundles;
            let caches_map = &self.tile_render_caches;
            let subscene_map = &mut self.tile_subscenes;
            let mut ctx = swf_spike::render::WgpuCtx {
                device: device_ref,
                queue: queue_ref,
                renderer: renderer_ref,
                filter_pipelines,
                output_scale: 1.0,
            };
            for i in 0..n {
                let kind = kinds[i];
                if kind == 1 || kind == 2 {
                    continue;
                }
                if kind != 0 && kind != 3 {
                    let bit = 1u8 << kind.min(7);
                    if warned_kinds & bit == 0 {
                        warned_kinds |= bit;
                        console_log!(
                            "prepare_world_scene: kind={kind} unknown; skipped"
                        );
                    }
                    continue;
                }
                let b_idx = bundle_idx[i] as usize;
                let e_idx = export_idx[i] as usize;
                if b_idx >= bundles.len() || e_idx >= exports.len() {
                    continue;
                }
                let bundle_name = &bundles[b_idx];
                let export_name = &exports[e_idx];
                let frame = frames[i];
                let key = (bundle_name.clone(), export_name.clone(), frame);
                if subscene_map.contains_key(&key) {
                    continue;
                }
                let Some(doc) = bundles_map.get(bundle_name) else {
                    continue;
                };
                let Some(symbol) = doc.lookup_export(export_name) else {
                    continue;
                };
                let cache = caches_map
                    .get(bundle_name)
                    .expect("cache pre-created above");
                let mut subscene = vello::Scene::new();
                swf_spike::render::render_symbol_with_shared_cache(
                    &mut ctx,
                    doc,
                    symbol,
                    &mut subscene,
                    vello::kurbo::Affine::IDENTITY,
                    frame as u16,
                    self.swf_player_colors,
                    cache,
                );
                subscene_map.insert(key, subscene);
            }
        }

        // Phase 2: build per-frame scene. Static foreground tile scene
        // prepended via memcpy; dynamic placements (animated tiles +
        // chars + spells + decals) re-encoded.
        let mut scene = vello::Scene::new();
        if let Some(static_scene) = &self.static_world_scene {
            scene.append(static_scene, None);
        }
        {
            let renderer_ref = &mut self.renderer;
            let device_ref = &self.device;
            let queue_ref = &self.queue;
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let bundles_map = &self.swf_bundles;
            let subscene_map = &self.tile_subscenes;
            let spell_instances = &self.swf_spell_instances;
            let mut ctx = swf_spike::render::WgpuCtx {
                device: device_ref,
                queue: queue_ref,
                renderer: renderer_ref,
                filter_pipelines,
                output_scale: 1.0,
            };
            for i in 0..n {
                let kind = kinds[i];
                let b_idx = bundle_idx[i] as usize;
                let e_idx = export_idx[i] as usize;
                let m = &matrices[i * 6..i * 6 + 6];
                let xform = vello::kurbo::Affine::new([
                    m[0] as f64, m[1] as f64, m[2] as f64,
                    m[3] as f64, m[4] as f64, m[5] as f64,
                ]);
                let alpha = alphas[i];
                match kind {
                    0 => {
                        if b_idx >= bundles.len() || e_idx >= exports.len() {
                            continue;
                        }
                        let key = (
                            bundles[b_idx].clone(),
                            exports[e_idx].clone(),
                            frames[i],
                        );
                        let Some(subscene) = subscene_map.get(&key) else {
                            continue;
                        };
                        scene.append(subscene, Some(xform));
                    }
                    1 => {
                        if b_idx >= bundles.len() || e_idx >= exports.len() {
                            continue;
                        }
                        let bundle_name = &bundles[b_idx];
                        let export_name = &exports[e_idx];
                        let Some(doc) = bundles_map.get(bundle_name) else {
                            continue;
                        };
                        let Some(symbol) = doc.lookup_export(export_name)
                        else {
                            continue;
                        };
                        let zo = i * 3;
                        let z = |v: u32| -> Option<u32> {
                            if v == u32::MAX { None } else { Some(v) }
                        };
                        let player_colors = swf_spike::recolor::PlayerColors([
                            z(color_zones[zo]),
                            z(color_zones[zo + 1]),
                            z(color_zones[zo + 2]),
                        ]);
                        let acc_start = acc_offsets[i] as usize;
                        let acc_end = acc_offsets[i + 1] as usize;
                        let mut accessories: swf_spike::render::ctx::AccessoryDict =
                            std::collections::HashMap::with_capacity(
                                acc_end - acc_start,
                            );
                        let dir_byte = char_dirs[i];
                        let dir_char = if dir_byte == 0 {
                            'R'
                        } else {
                            char::from(dir_byte).to_ascii_uppercase()
                        };
                        let char_frame = frames[i] as u16;
                        for k in acc_start..acc_end {
                            let abi = acc_bundle_idx[k] as usize;
                            let aei = acc_export_idx[k] as usize;
                            if abi >= bundles.len() || aei >= exports.len() {
                                continue;
                            }
                            let acc_bundle = &bundles[abi];
                            let acc_export = &exports[aei];
                            let Some(acc_doc) = bundles_map.get(acc_bundle)
                            else {
                                continue;
                            };
                            let Some(acc_sym) =
                                acc_doc.lookup_export(acc_export)
                            else {
                                continue;
                            };
                            accessories.insert(
                                acc_slots[k],
                                swf_spike::render::ctx::AccessoryEntry {
                                    doc: acc_doc,
                                    symbol: acc_sym,
                                    anim_type: acc_anim_types[k],
                                    char_frame,
                                    char_dir_suffix: dir_char,
                                },
                            );
                        }
                        let cache =
                            swf_spike::render::cache::RenderCache::new();
                        let apply_b_fix = char_b_fix[i] != 0;
                        let needs_layer = alpha < 0.999 && alpha > 0.0;
                        if needs_layer {
                            let big_clip = vello::kurbo::Rect::new(
                                -1.0e7, -1.0e7, 1.0e7, 1.0e7,
                            );
                            scene.push_layer(
                                vello::peniko::Fill::NonZero,
                                vello::peniko::BlendMode::default(),
                                alpha,
                                vello::kurbo::Affine::IDENTITY,
                                &big_clip,
                            );
                        }
                        if alpha > 0.0 {
                            swf_spike::render::render_symbol_with_ctx_tinted_accessorized_bfixed(
                                &mut ctx,
                                doc,
                                symbol,
                                &mut scene,
                                xform,
                                char_frame,
                                player_colors,
                                &cache,
                                &accessories,
                                apply_b_fix,
                            );
                        }
                        if needs_layer {
                            scene.pop_layer();
                        }
                    }
                    2 => {
                        let inst_id = frames[i];
                        let Some(inst) = spell_instances.get(&inst_id)
                        else {
                            continue;
                        };
                        let Some(doc) = bundles_map.get(&inst.bundle_name)
                        else {
                            continue;
                        };
                        let root_sym = swf_spike::swf_doc::Symbol::Sprite(
                            doc.root.clone(),
                        );
                        let needs_layer = alpha < 0.999 && alpha > 0.0;
                        if needs_layer {
                            let big_clip = vello::kurbo::Rect::new(
                                -1.0e7, -1.0e7, 1.0e7, 1.0e7,
                            );
                            scene.push_layer(
                                vello::peniko::Fill::NonZero,
                                vello::peniko::BlendMode::default(),
                                alpha,
                                vello::kurbo::Affine::IDENTITY,
                                &big_clip,
                            );
                        }
                        if alpha > 0.0 {
                            inst.avm.render(
                                doc,
                                &root_sym,
                                &mut scene,
                                xform,
                                Some(&mut ctx),
                            );
                        }
                        if needs_layer {
                            scene.pop_layer();
                        }
                    }
                    3 => {
                        if b_idx >= bundles.len() || e_idx >= exports.len() {
                            continue;
                        }
                        let key = (
                            bundles[b_idx].clone(),
                            exports[e_idx].clone(),
                            frames[i],
                        );
                        let Some(subscene) = subscene_map.get(&key) else {
                            continue;
                        };
                        if alpha >= 0.999 {
                            scene.append(subscene, Some(xform));
                        } else if alpha > 0.0 {
                            let big_clip = vello::kurbo::Rect::new(
                                -1.0e7, -1.0e7, 1.0e7, 1.0e7,
                            );
                            scene.push_layer(
                                vello::peniko::Fill::NonZero,
                                vello::peniko::BlendMode::default(),
                                alpha,
                                vello::kurbo::Affine::IDENTITY,
                                &big_clip,
                            );
                            scene.append(subscene, Some(xform));
                            scene.pop_layer();
                        }
                    }
                    4 => {
                        // CellTint — solid filled diamond at canonical
                        // Object2 sub-offset +2 (between foreground tiles
                        // at +0 and chars at +30). Encoding:
                        //   frames[i]  = packed AARRGGBB color
                        //   alphas[i]  = additional opacity multiplier
                        //   matrix     = maps unit diamond (vertices at
                        //                (-0.5, 0), (0, -0.5), (0.5, 0),
                        //                (0, 0.5)) to surface pixels
                        let packed = frames[i];
                        let a = ((packed >> 24) & 0xff) as f32 / 255.0;
                        let r = ((packed >> 16) & 0xff) as u8;
                        let g = ((packed >> 8) & 0xff) as u8;
                        let b = (packed & 0xff) as u8;
                        let final_alpha = (a * alpha).clamp(0.0, 1.0);
                        if final_alpha <= 0.0 {
                            continue;
                        }
                        let alpha_byte = (final_alpha * 255.0) as u8;
                        let color =
                            vello::peniko::Color::from_rgba8(r, g, b, alpha_byte);
                        let mut path = vello::kurbo::BezPath::new();
                        path.move_to((-0.5, 0.0));
                        path.line_to((0.0, -0.5));
                        path.line_to((0.5, 0.0));
                        path.line_to((0.0, 0.5));
                        path.close_path();
                        scene.fill(
                            vello::peniko::Fill::NonZero,
                            xform,
                            color,
                            None,
                            &path,
                        );
                    }
                    _ => {}
                }
            }
        }
        Some(scene)
    }

    /// Render the unified L3 World pass (Object2: chars + foreground
    /// tiles + spells + decals) directly into a previously-attached
    /// `<canvas>` surface. Same encoding contract as `renderWorldPass`
    /// (kinds + parallel arrays + accessory CSR) — the only difference
    /// is the destination: swap chain frame view instead of an
    /// internally-managed off-screen RT.
    #[wasm_bindgen(js_name = "renderWorldPassToSurface")]
    pub fn render_world_pass_to_surface(
        &mut self,
        surface_id: u32,
        kinds: Vec<u8>,
        bundles: Vec<String>,
        exports: Vec<String>,
        bundle_idx: Vec<u32>,
        export_idx: Vec<u32>,
        frames: Vec<u32>,
        depths: Vec<i32>,
        matrices: Vec<f32>,
        alphas: Vec<f32>,
        color_zones: Vec<u32>,
        char_dirs: Vec<u8>,
        char_b_fix: Vec<u8>,
        acc_offsets: Vec<u32>,
        acc_slots: Vec<u8>,
        acc_bundle_idx: Vec<u32>,
        acc_export_idx: Vec<u32>,
        acc_anim_types: Vec<u8>,
    ) -> bool {
        if !self.surfaces.contains_key(&surface_id) {
            console_log!(
                "renderWorldPassToSurface: unknown surface id {surface_id}"
            );
            return false;
        }
        let Some(scene) = self.prepare_world_scene(
            &kinds,
            &bundles,
            &exports,
            &bundle_idx,
            &export_idx,
            &frames,
            &depths,
            &matrices,
            &alphas,
            &color_zones,
            &char_dirs,
            &char_b_fix,
            &acc_offsets,
            &acc_slots,
            &acc_bundle_idx,
            &acc_export_idx,
            &acc_anim_types,
        ) else {
            return false;
        };
        self.dispatch_scene_to_surface(
            surface_id,
            "renderWorldPassToSurface",
            &scene,
        )
    }

    /// Pre-encode the unified L3 World layer's static foreground-tile
    /// subset into one cached Vello scene. Called whenever the static
    /// set changes (map load, zoom step, tactic-mode toggle); world
    /// pass appends it via memcpy on every dispatch. Mirrors
    /// `setStaticTilePlacements` for the world pass.
    ///
    /// Encoding: tile-only flat arrays. Empty input clears cache.
    #[wasm_bindgen(js_name = "setStaticWorldTiles")]
    pub fn set_static_world_tiles(
        &mut self,
        bundles: Vec<String>,
        exports: Vec<String>,
        bundle_idx: Vec<u32>,
        export_idx: Vec<u32>,
        frames: Vec<u32>,
        matrices: Vec<f32>,
    ) {
        let n = bundle_idx.len();
        if n == 0 {
            self.static_world_scene = None;
            return;
        }
        if export_idx.len() != n
            || frames.len() != n
            || matrices.len() != n * 6
        {
            console_log!(
                "setStaticWorldTiles: array length mismatch (n={n})"
            );
            return;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        for name in bundles.iter() {
            self.tile_render_caches.entry(name.clone()).or_default();
        }

        let player_colors = self.swf_player_colors;
        {
            let renderer_ref = &mut self.renderer;
            let device_ref = &self.device;
            let queue_ref = &self.queue;
            let filter_pipelines =
                self.swf_filter_pipelines.as_ref().unwrap();
            let bundles_map = &self.swf_bundles;
            let caches_map = &self.tile_render_caches;
            let subscene_map = &mut self.tile_subscenes;
            let mut ctx = swf_spike::render::WgpuCtx {
                device: device_ref,
                queue: queue_ref,
                renderer: renderer_ref,
                filter_pipelines,
                output_scale: 1.0,
            };
            for i in 0..n {
                let b_idx = bundle_idx[i] as usize;
                let e_idx = export_idx[i] as usize;
                if b_idx >= bundles.len() || e_idx >= exports.len() {
                    continue;
                }
                let bundle_name = &bundles[b_idx];
                let export_name = &exports[e_idx];
                let frame = frames[i];
                let key = (bundle_name.clone(), export_name.clone(), frame);
                if subscene_map.contains_key(&key) {
                    continue;
                }
                let Some(doc) = bundles_map.get(bundle_name) else {
                    continue;
                };
                let Some(symbol) = doc.lookup_export(export_name) else {
                    continue;
                };
                let cache = caches_map
                    .get(bundle_name)
                    .expect("cache pre-created above");
                let mut subscene = vello::Scene::new();
                swf_spike::render::render_symbol_with_shared_cache(
                    &mut ctx,
                    doc,
                    symbol,
                    &mut subscene,
                    vello::kurbo::Affine::IDENTITY,
                    frame as u16,
                    player_colors,
                    cache,
                );
                subscene_map.insert(key, subscene);
            }
        }

        let mut scene = vello::Scene::new();
        for i in 0..n {
            let b_idx = bundle_idx[i] as usize;
            let e_idx = export_idx[i] as usize;
            if b_idx >= bundles.len() || e_idx >= exports.len() {
                continue;
            }
            let key = (
                bundles[b_idx].clone(),
                exports[e_idx].clone(),
                frames[i],
            );
            let Some(subscene) = self.tile_subscenes.get(&key) else {
                continue;
            };
            let m = &matrices[i * 6..i * 6 + 6];
            let xform = vello::kurbo::Affine::new([
                m[0] as f64, m[1] as f64, m[2] as f64,
                m[3] as f64, m[4] as f64, m[5] as f64,
            ]);
            scene.append(subscene, Some(xform));
        }
        self.static_world_scene = Some(scene);
    }

    /// Synthetic world-pass benchmark for the M1 gate. Builds a grid
    /// of `n_chars` Char placements, `n_tiles` Tile placements, and
    /// `n_spells` Spell placeholders, each pulling from the first
    /// loaded character + tile bundle. Renders 1 frame; reports
    /// wall-clock ms for the JS caller to gate on.
    ///
    /// **Architecture gate**: if dispatch P99 exceeds the FPS target
    /// budget on the user's machine, the migration aborts before any
    /// consumer-side code is written.
    ///
    /// Returns `{ ms, n_placements, scene_paths_estimated, status }`.
    #[wasm_bindgen(js_name = "renderWorldPassBench")]
    pub fn render_world_pass_bench(
        &mut self,
        n_chars: u32,
        n_tiles: u32,
        n_spells: u32,
    ) -> JsValue {
        let n_total = (n_chars + n_tiles + n_spells) as usize;
        if n_total == 0 {
            return JsValue::NULL;
        }

        // Pick first available char bundle (sprite/N) and tile bundle
        // (gfx/g1 etc.) from loaded swf_bundles.
        let char_bundle = self
            .swf_bundles
            .iter()
            .find(|(name, _)| name.starts_with("sprite-"))
            .map(|(name, _)| name.clone());
        let tile_bundle = self
            .swf_bundles
            .iter()
            .find(|(name, _)| {
                name.as_str() == "g1"
                    || name.as_str() == "g2"
                    || name.starts_with('o')
            })
            .map(|(name, _)| name.clone());

        let mut bundles: Vec<String> = Vec::new();
        let mut exports: Vec<String> = Vec::new();
        let char_b_idx = if let Some(ref b) = char_bundle {
            bundles.push(b.clone());
            exports.push("static_R".to_string());
            0u32
        } else if n_chars > 0 {
            console_log!("renderWorldPassBench: no character bundle loaded");
            return JsValue::NULL;
        } else {
            0
        };
        let tile_b_idx = if let Some(ref b) = tile_bundle {
            bundles.push(b.clone());
            exports.push("g1".to_string());
            (bundles.len() - 1) as u32
        } else if n_tiles > 0 {
            console_log!("renderWorldPassBench: no tile bundle loaded");
            return JsValue::NULL;
        } else {
            0
        };

        let mut kinds: Vec<u8> = Vec::with_capacity(n_total);
        let mut bundle_idx: Vec<u32> = Vec::with_capacity(n_total);
        let mut export_idx: Vec<u32> = Vec::with_capacity(n_total);
        let mut frames: Vec<u32> = Vec::with_capacity(n_total);
        let mut depths: Vec<i32> = Vec::with_capacity(n_total);
        let mut matrices: Vec<f32> = Vec::with_capacity(n_total * 6);
        let mut alphas: Vec<f32> = Vec::with_capacity(n_total);
        let mut color_zones: Vec<u32> =
            Vec::with_capacity(n_total * 3);
        let mut char_dirs: Vec<u8> = Vec::with_capacity(n_total);
        let mut char_b_fix: Vec<u8> = Vec::with_capacity(n_total);
        let mut acc_offsets: Vec<u32> = Vec::with_capacity(n_total + 1);
        acc_offsets.push(0);

        // Lay placements in a grid. Each placement at a unique cell
        // for canonical-style depth dispersion. `cellNum` derived
        // from grid index; depth = cellNum * 100 + sub_offset.
        let cols = ((n_total as f32).sqrt().ceil() as u32).max(1);
        let cell_w = 86.0_f32; // canonical cell width
        let cell_h = 43.0_f32;

        for i in 0..n_chars {
            let cell = i;
            let col = (cell % cols) as f32;
            let row = (cell / cols) as f32;
            kinds.push(1);
            bundle_idx.push(char_b_idx);
            export_idx.push(0); // "static_R"
            frames.push(0);
            depths.push((cell as i32) * 100 + 30);
            matrices.extend_from_slice(&[
                1.0, 0.0, 0.0, 1.0,
                col * cell_w, row * cell_h,
            ]);
            alphas.push(1.0);
            color_zones.extend_from_slice(&[
                0xFF0000, 0x00FF00, 0x0000FF,
            ]);
            char_dirs.push(b'R');
            char_b_fix.push(0);
            acc_offsets.push(*acc_offsets.last().unwrap_or(&0));
        }
        for i in 0..n_tiles {
            let cell = n_chars + i;
            let col = (cell % cols) as f32;
            let row = (cell / cols) as f32;
            kinds.push(0);
            bundle_idx.push(tile_b_idx);
            export_idx.push(1.min(exports.len() as u32 - 1));
            frames.push(0);
            depths.push((cell as i32) * 100 + 0);
            matrices.extend_from_slice(&[
                1.0, 0.0, 0.0, 1.0,
                col * cell_w, row * cell_h,
            ]);
            alphas.push(1.0);
            color_zones.extend_from_slice(&[
                u32::MAX, u32::MAX, u32::MAX,
            ]);
            char_dirs.push(0);
            char_b_fix.push(0);
            acc_offsets.push(*acc_offsets.last().unwrap_or(&0));
        }
        // Spell placeholders skip if no spell instance is live.
        // Skipped with kind=2; renderWorldPass logs and continues.
        for i in 0..n_spells {
            let cell = n_chars + n_tiles + i;
            let col = (cell % cols) as f32;
            let row = (cell / cols) as f32;
            kinds.push(2);
            bundle_idx.push(0);
            export_idx.push(0);
            frames.push(0);
            depths.push((cell as i32) * 100 + 50);
            matrices.extend_from_slice(&[
                1.0, 0.0, 0.0, 1.0,
                col * cell_w, row * cell_h,
            ]);
            alphas.push(1.0);
            color_zones.extend_from_slice(&[
                u32::MAX, u32::MAX, u32::MAX,
            ]);
            char_dirs.push(0);
            char_b_fix.push(0);
            acc_offsets.push(*acc_offsets.last().unwrap_or(&0));
        }

        let target_w = 2048u32;
        let target_h = 1024u32;

        let result = self.render_world_pass(
            target_w,
            target_h,
            kinds,
            bundles,
            exports,
            bundle_idx,
            export_idx,
            frames,
            depths,
            matrices,
            alphas,
            color_zones,
            char_dirs,
            char_b_fix,
            acc_offsets,
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        let status = if result.is_null() { "fail" } else { "ok" };

        let ret = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &ret,
            &"placements".into(),
            &JsValue::from(n_total as u32),
        );
        let _ = js_sys::Reflect::set(
            &ret,
            &"status".into(),
            &JsValue::from_str(status),
        );
        ret.into()
    }

    /// Phase 3c — Drop both long-lived path caches.
    ///
    /// Use cases:
    ///   - Memory-pressure recovery (e.g. WindowServer watchdog firing).
    ///   - Cold-vs-warm bench setup: clear → run → measure → clear → run
    ///     → measure to compare miss-cost against hit-cost reproducibly.
    ///   - Bundle eviction: a downstream codepath that unloads a
    ///     `swf_bundles` entry should call this to drop stale shape
    ///     commands keyed by symbol IDs that no longer exist.
    ///
    /// Does NOT touch the per-cast spell instance caches, the static
    /// tile scene, or in-flight GPU textures — only the scene + bundle
    /// caches that are pure rebuild-on-demand.
    #[wasm_bindgen(js_name = "clearPathCache")]
    pub fn clear_path_cache(&mut self) {
        self.tile_subscenes.clear();
        self.tile_render_caches.clear();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Surface API — Phase 2 of the three-canvas migration.
    //
    // Each Vello-output `<canvas>` (ground+Object1, Object2, HUD slices)
    // is attached as its own `wgpu::Surface`; per-tick render dispatch
    // targets that surface directly via `render_to_texture` on the
    // swap-chain frame view. Eliminates the Pixi `ExternalSource` indirection
    // and the patched-wgpu GPUTexture extraction path entirely.
    //
    // Configuration uses `RENDER_ATTACHMENT | STORAGE_BINDING | COPY_DST`
    // because Vello writes via a compute pipeline (STORAGE_BINDING is
    // mandatory for `render_to_texture`'s output target). Browser support
    // for STORAGE_BINDING on canvas swap chains: Chrome 113+ allows it for
    // `rgba8unorm`. If unsupported, the configure call surfaces an error
    // and the JS side falls back (Phase 5 deletion of the wgpu fork
    // implies STORAGE_BINDING-on-canvas is available).

    /// Attach a `<canvas>` as a Vello-driven surface. Returns the JS-facing
    /// id used by `configureSurface` / `detachSurface` / future
    /// `renderXxxToSurface` calls. The canvas is consumed (moved into the
    /// Surface). Returns 0 on failure.
    #[wasm_bindgen(js_name = "attachCanvasSurface")]
    pub fn attach_canvas_surface(
        &mut self,
        canvas: web_sys::HtmlCanvasElement,
        width: u32,
        height: u32,
    ) -> u32 {
        if width == 0 || height == 0 || width > 16384 || height > 16384 {
            console_log!(
                "attachCanvasSurface: invalid size {width}x{height}"
            );
            return 0;
        }
        let surface = match self
            .instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
        {
            Ok(s) => s,
            Err(e) => {
                console_log!("attachCanvasSurface: create_surface failed: {e}");
                return 0;
            }
        };
        let cfg = surface_config(width, height);
        surface.configure(&self.device, &cfg);
        let id = self.next_surface_id;
        self.next_surface_id = self.next_surface_id.wrapping_add(1).max(1);
        self.surfaces.insert(id, surface);
        console_log!(
            "attachCanvasSurface: id={id} {width}x{height}"
        );
        id
    }

    /// Reconfigure a previously-attached surface (resize / DPR change).
    /// Idempotent if dims match the current configuration.
    #[wasm_bindgen(js_name = "configureSurface")]
    pub fn configure_surface(&mut self, id: u32, width: u32, height: u32) {
        if width == 0 || height == 0 || width > 16384 || height > 16384 {
            return;
        }
        let Some(surface) = self.surfaces.get(&id) else {
            return;
        };
        surface.configure(&self.device, &surface_config(width, height));
    }

    /// Drop a surface attachment. Subsequent renders to this id no-op.
    #[wasm_bindgen(js_name = "detachSurface")]
    pub fn detach_surface(&mut self, id: u32) {
        self.surfaces.remove(&id);
    }
}

/// Standard `wgpu::SurfaceConfiguration` used for every Vello-attached
/// canvas. Format is `Rgba8Unorm` to match Vello's required output
/// format. Usage includes `STORAGE_BINDING` because Vello's compute
/// pipeline writes the final image directly into the storage view.
/// `COPY_DST` is included so future passes (debug overlays, blits) can
/// also write into the surface texture without reconfiguring.
fn surface_config(width: u32, height: u32) -> wgpu::SurfaceConfiguration {
    wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::COPY_DST,
        format: wgpu::TextureFormat::Rgba8Unorm,
        width,
        height,
        present_mode: wgpu::PresentMode::AutoVsync,
        alpha_mode: wgpu::CompositeAlphaMode::PreMultiplied,
        view_formats: vec![],
        desired_maximum_frame_latency: 1,
    }
}
