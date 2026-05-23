use std::collections::HashMap;

use dofasset_renderer::format::{self, DofAsset};
use dofasset_renderer::scene_builder::{self, AccessoryScene};
use vello::peniko::Color;
use vello::{wgpu, AaConfig, Renderer, RendererOptions};
use wasm_bindgen::prelude::*;

mod bitmap_bridge;


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
///
/// Also marks the underlying `WebTexture` as `extracted`, which
/// switches its `Drop` behaviour from "queue for deferred destroy"
/// to "no-op". Pixi holds an independent JS reference to the same
/// `GPUTexture` handle; we must NOT auto-destroy when the Rust
/// wrapper drops (Round 5 race). Lifecycle stays explicit via the
/// JS-driven `free_render_texture` retire path.
fn extract_gpu_texture(texture: &wgpu::Texture) -> JsValue {
    let web = texture.inner.as_webgpu();
    web.mark_extracted();
    web.inner.clone().into()
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

/// Wall-clock now (ms). Used for per-step instrumentation inside
/// `renderSwfClassAtlas` so we can measure where time goes (scene
/// encoding vs Vello compute submit vs combine vs bridge) and decide
/// architecturally. CPU-side timestamps only — GPU work is async
/// behind `queue.submit`, so "render+submit" times capture command-
/// encoding cost, not GPU runtime. The bridge step IS synchronous
/// (it awaits a present), so its time captures real end-to-end
/// latency for the rendered page to leave the GPU.
///
/// `js_sys::Date::now()` is available without any extra feature gate
/// (unlike `web_sys::Performance` which requires the `Performance`
/// feature on `web-sys`). Date.now()'s ms resolution is fine — the
/// shortest steps we measure are ~1 ms.
fn perf_now() -> f64 {
    js_sys::Date::now()
}

/// True when `name` matches a canonical Dofus character "common"
/// animation pattern: `static* | walk* | run*` × direction suffix.
///
/// We deliberately exclude rare anims (die, hit, cast, dance, salute,
/// glory, anim0..animH, etc.) because each character SWF defines
/// 100+ of them; baking them all into a single class atlas blows
/// past the GPU memory budget AND overflows Vello's tile encoder on
/// the merged per-page scene. Common anims are the only ones that
/// fire continuously in normal gameplay; rare anims go through a JS-
/// side per-variant fallback path (`renderSwfBodyAtlas`) that bakes
/// a 1-variant ClassAtlas on demand.
fn is_character_anim_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    let n = bytes.len();
    if n < 2 {
        return false;
    }
    let last = bytes[n - 1];
    if last != b'R' && last != b'L' && last != b'F' && last != b'B' && last != b'S' {
        return false;
    }
    for &c in bytes.iter() {
        let ascii_letter = (c >= b'A' && c <= b'Z') || (c >= b'a' && c <= b'z');
        if !ascii_letter {
            return false;
        }
    }
    // Only the high-frequency anims live in the class atlas. The JS
    // layer mirrors this prefix list so its fallback path knows when
    // to bake per-variant via `renderSwfBodyAtlas`.
    name.starts_with("static") || name.starts_with("walk") || name.starts_with("run")
}

/// A frame queued for batch rendering.
struct QueuedFrame {
    scene: vello::Scene,
    width: u32,
    height: u32,
    dst_x: u32,
    dst_y: u32,
}

#[wasm_bindgen]
pub struct VelloRenderer {
    /// Retained `wgpu::Instance` — required to mint `wgpu::Surface`s
    /// for the OffscreenCanvas-bitmap bridge in `bitmap_bridge`.
    instance: wgpu::Instance,
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    /// Lazy-initialised blit pipeline used by the OffscreenCanvas
    /// bridge to copy Vello's `Rgba8Unorm` output texture onto a
    /// `Bgra8Unorm` surface texture (the canvas's preferred format,
    /// avoiding Chromium's "preferred format" perf warning).
    blit_bgra_pipeline: Option<bitmap_bridge::BlitPipeline>,
    /// Pooled OffscreenCanvas + wgpu Surface for the bridge. Resized
    /// in-place when callers ask for different dims, so the hot path
    /// avoids the ~10ms canvas+surface allocation cost per bake.
    bridge_canvas_pool: Option<bitmap_bridge::BridgeCanvasPool>,
    /// Lazy-initialised pipeline that combines a body atlas's separate
    /// colour + zone textures into a single Rgba8Unorm output, with
    /// the zone-id packed into the low 2 bits of the alpha channel.
    /// Lets `renderSwfBodyAtlas` return ONE bitmap+source instead of
    /// two — halves the body atlas working set on the Pixi side.
    combine_body_pipeline: Option<bitmap_bridge::CombineBodyPipeline>,
    assets: HashMap<u32, DofAsset>,
    textures: HashMap<u64, wgpu::Texture>,
    next_texture_id: u64,
    queued_frames: Vec<QueuedFrame>,
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
    ///
    /// Phase 1 of `RENDER_BAKE_PLAN.md`: USED BY ALL BAKES (character
    /// body atlas + accessory strip + tile static/dynamic). Before
    /// Phase 1, each bake created its own `RenderCache::new()`,
    /// throwing away the flattened path commands at the end. Shape
    /// flattening + frame-state walk is the dominant cost of a body
    /// atlas bake (~5 ms per call observed); sharing the cache
    /// across bakes of the same bundle drops subsequent bakes by
    /// ~99 % on the flatten path.
    swf_render_caches: HashMap<String, swf_spike::render::cache::RenderCache>,
    /// Phase 1b: pre-built `vello::Scene` cache for the body atlas
    /// bake. Phase 1's flatten cache lived inside `swf_render_caches`
    /// and ONLY memoised the `flatten_shape` step. On real workloads
    /// (200-bot stress, ~26 body bakes/sec) Phase 1 dropped accessory
    /// bakes ~55 % but left body bakes unchanged at ~5 ms — proof
    /// that scene encoding (~90 k `scene.fill()` calls per body bake
    /// to lay out 5 bands × 12 frames × 2 modes worth of path data
    /// into the Vello encoder) is the dominant cost, NOT shape
    /// flatten.
    ///
    /// Phase 1b caches the FULL built `vello::Scene` per
    /// `(bundle, export, start, count, scale_q, apply_b_fix,
    /// hat_equipped, mode)` tuple. Cache hit skips the whole
    /// `build_scene` step; the bake then only runs the two
    /// `render_to_texture` rasterizations + combine + bitmap bridge.
    /// Expected hit cost ~1-1.5 ms (the rasterization floor) vs
    /// ~5 ms on miss.
    body_scene_cache: HashMap<BodySceneCacheKey, vello::Scene>,
    /// Per-tile sub-scenes encoded at twip-identity. Keyed by
    /// `(bundle, export, frame)`. Built once per unique tile and
    /// re-used across cells (multiple cells share the same tile) AND
    /// across zoom levels (zoom only changes the per-cell matrix at
    /// composition time, NOT the sub-scene contents). This is what
    /// makes zoom re-render fast: we don't re-walk symbol trees, we
    /// just `scene.append(subscene, matrix)` for each placement.
    tile_subscenes: HashMap<(String, String, u32), vello::Scene>,
    /// Opt-5: per-bundle precomputed class atlas enumeration.
    /// Populated lazily on first `renderSwfClassAtlas(bundle)` call.
    /// Subsequent calls (including re-bakes after eviction) skip the
    /// per-export `swf_anim_frame_count` + `body_has_toggle_sprite`
    /// + `export_uses_b_fix` work — ~10 ms per class on the warmup
    /// hot path becomes a one-time pre-pay.
    class_enum_cache: HashMap<String, ClassEnumeration>,
}

/// Precomputed metadata for class atlas baking, populated once per
/// bundle. Cached on `VelloRenderer.class_enum_cache`.
struct ClassEnumeration {
    /// `b_fix_used` at the bundle level (any mount with b_fix=true).
    bundle_b_fix_used: bool,
    /// Per-export specs, sorted by name. Each entry already filtered
    /// to the character-anim pattern + verified Sprite + tested for
    /// toggle/bFix dimensionality.
    exports: Vec<ClassEnumerationExport>,
}

struct ClassEnumerationExport {
    export_name: String,
    /// `swf_anim_frame_count` minus the static-clamp.
    total_frame_count: u32,
    /// `body_has_toggle_sprite` — whether to expand hat_equipped dim.
    has_toggle: bool,
    /// Per-export `export_uses_b_fix` — whether to expand applyBFix dim.
    /// Already combined with the bundle-level `bundle_b_fix_used` flag.
    export_b_fix: bool,
    slot_count_logical: u32,
}

/// Phase 1b body-scene cache key. Every parameter that can change the
/// produced `vello::Scene` content (or its absolute cell layout) must
/// be in the key. `scale_q` is `(scale × 1000) as u32` so the float
/// can participate in the `Hash` impl. The mode byte distinguishes
/// the two passes (Colour = 0, ZoneId = 1) — they share every other
/// input but produce different scenes.
#[derive(Clone, PartialEq, Eq, Hash)]
struct BodySceneCacheKey {
    bundle: String,
    export: String,
    start: u32,
    count: u32,
    scale_q: u32,
    apply_b_fix: bool,
    hat_equipped: bool,
    mode: u8,
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
            blit_bgra_pipeline: None,
            bridge_canvas_pool: None,
            combine_body_pipeline: None,
            assets: HashMap::new(),
            textures: HashMap::new(),
            next_texture_id: 0,
            queued_frames: Vec::new(),
            swf_bundles: HashMap::new(),
            swf_filter_pipelines: None,
            swf_player_colors: swf_spike::recolor::PlayerColors::default(),
            swf_spell_instances: HashMap::new(),
            next_spell_instance_id: 1,
            swf_strip_bounds_cache: HashMap::new(),
            swf_render_caches: HashMap::new(),
            body_scene_cache: HashMap::new(),
            tile_subscenes: HashMap::new(),
            class_enum_cache: HashMap::new(),
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

    /// Render a freshly-rendered Vello texture out through the
    /// `bitmap_bridge` and return an `ImageBitmap` JsValue for Pixi
    /// to consume via `ImageSource`. Lazy-inits the blit pipeline +
    /// canvas pool the first time it's called.
    ///
    /// Lifecycle: the source `wgpu::Texture` is NOT extracted to JS
    /// and NOT inserted into `self.textures`. It drops at end of the
    /// caller's scope; the patched-fork's selective `Drop` queues it
    /// into `deferred_destroy`, which `tickDeferredDestroys` drains
    /// after a 2-tick settle. Net effect: no manual `freeRenderTexture`
    /// call is required for bridge-output paths.
    ///
    /// Returns `JsValue::NULL` on init / bridge failure; the caller
    /// surfaces that as a render error.
    fn texture_to_bitmap(
        &mut self,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
        err_label: &'static str,
    ) -> Option<web_sys::ImageBitmap> {
        if self.blit_bgra_pipeline.is_none() {
            self.blit_bgra_pipeline = Some(bitmap_bridge::BlitPipeline::new(
                &self.device,
                wgpu::TextureFormat::Bgra8Unorm,
            ));
        }
        if self.bridge_canvas_pool.is_none() {
            match bitmap_bridge::BridgeCanvasPool::new(
                &self.instance,
                &self.device,
                width,
                height,
            ) {
                Ok(p) => self.bridge_canvas_pool = Some(p),
                Err(e) => {
                    console_log!("{err_label}: bridge pool init error: {e:?}");
                    return None;
                }
            }
        }
        let blit = self.blit_bgra_pipeline.as_ref().unwrap();
        let pool = self.bridge_canvas_pool.as_mut().unwrap();
        match bitmap_bridge::render_texture_to_bitmap(
            pool, &self.device, &self.queue, blit, texture, width, height,
        ) {
            Ok(b) => Some(b),
            Err(e) => {
                console_log!("{err_label}: bridge error: {e:?}");
                None
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

        let Some(bitmap) = self.texture_to_bitmap(&texture, w, h, "renderSwfFrame") else {
            return JsValue::NULL;
        };

        // SWF (0,0) lands at (-px_min_x, -px_min_y) inside the texture.
        let anchor_x = -px_min_x;
        let anchor_y = -px_min_y;

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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
        // the main sprite at depth 1. Capture the SWF header fps here so
        // we can drop the `doc` borrow before the `&mut self`
        // `texture_to_bitmap` call below.
        let root_sym =
            swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());
        let doc_frame_rate = doc.frame_rate;

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

        let Some(bitmap) = self.texture_to_bitmap(&texture, strip_w, strip_h, "renderSwfSpellStrip")
        else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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
            &JsValue::from(doc_frame_rate),
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

        let Some(bitmap) = self.texture_to_bitmap(&texture, w, h, "renderSwfSpellIcon") else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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
            // Patched-wgpu Drop is a no-op — call destroy() explicitly
            // to release VRAM. See `free_render_texture` doc-comment.
            if let Some(tex) = self.textures.remove(&inst.texture_id) {
                tex.destroy();
            }
        }
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

        let Some(bitmap) = self.texture_to_bitmap(&texture, w, h, "renderSwfRoot") else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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

        let Some(bitmap) =
            self.texture_to_bitmap(&texture, strip_w, strip_h, "renderSwfStripRange")
        else {
            return JsValue::NULL;
        };

        // Anchor (within-cell): SWF (0,0) lands at -px_min relative to each
        // cell's top-left. Same for every frame because we used a uniform
        // global offset.
        let anchor_x = -px_min_x;
        let anchor_y = -px_min_y;

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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

    // ---------------------------------------------------------------
    // Path B: body-band rasteriser. Slices the body display list into
    // Z-ordered bands at accessory mount depths. Each band caches
    // independently of player tint + accessory loadout, so 400 bots
    // of the same class share the same body strips at steady state.
    // See `RENDER_SCALING_PLAN.md`.
    // ---------------------------------------------------------------

    /// One-shot lookup for a body export's slot/band layout. Returns
    /// `{ slotCount, bandCount, slots: [{ slot, depth }, ...],
    /// bFixUsed }`. JS uses this to decide how many bands to bake per
    /// (bundle, export) and which Z order to stack them in.
    ///
    /// `bFixUsed` reports whether ANY of this character's accessory
    /// mount declarations have `b_fix = true`. When false, the body
    /// bake is pixel-identical with `apply_b_fix = true` vs `false`
    /// (the sprite walker only acts on bFix for placements whose
    /// mount declares `b_fix=true` — without any such mount, the
    /// override is a no-op). JS uses this to collapse the bake-key's
    /// `applyBFix` dimension for characters without capes/shields,
    /// roughly halving bakes on those classes.
    #[wasm_bindgen(js_name = "swfBodyBandInfo")]
    pub fn swf_body_band_info(&self, bundle: &str, export: &str) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };
        let swf_spike::swf_doc::Symbol::Sprite(body) = symbol else {
            // Non-sprite body would just render as one band; surface
            // the degenerate case explicitly so the caller knows.
            let result = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&result, &"slotCount".into(), &JsValue::from(0u32));
            let _ = js_sys::Reflect::set(&result, &"bandCount".into(), &JsValue::from(1u32));
            let _ = js_sys::Reflect::set(
                &result,
                &"slots".into(),
                &js_sys::Array::new().into(),
            );
            let _ = js_sys::Reflect::set(&result, &"bFixUsed".into(), &JsValue::FALSE);
            return result.into();
        };
        let slots = swf_spike::render::extract_slot_depths(doc, body, 0);
        let band_count = swf_spike::render::band_count(&slots) as u32;
        let arr = js_sys::Array::new();
        for s in &slots {
            let o = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&o, &"slot".into(), &JsValue::from(u32::from(s.slot)));
            let _ =
                js_sys::Reflect::set(&o, &"depth".into(), &JsValue::from(u32::from(s.depth)));
            // Canonical AS2 `applyAccessory(this, slot, side)` argument.
            // JS uses this string verbatim as the `side` when baking
            // the accessory's strip — passing the bot's facing `dir`
            // instead silently routes walking-prefix sides like "WR"
            // (cape walking right) to the wrong frame. `null` when the
            // body's mount declaration omitted the side string (legacy
            // SWFs).
            let side_value = match &s.side {
                Some(side) => JsValue::from_str(side),
                None => JsValue::NULL,
            };
            let _ = js_sys::Reflect::set(&o, &"side".into(), &side_value);
            arr.push(&o.into());
        }
        // bFix is a no-op unless at least one mount declares `b_fix=true`.
        // accessory_mounts maps character_id -> mounts; scan all entries
        // because a body part placement inside `body` may reference any
        // mount-declaring character id.
        let b_fix_used = doc
            .accessory_mounts
            .values()
            .any(|mounts| mounts.iter().any(|m| m.b_fix));
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &result,
            &"slotCount".into(),
            &JsValue::from(slots.len() as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"bandCount".into(), &JsValue::from(band_count));
        let _ = js_sys::Reflect::set(&result, &"slots".into(), &arr.into());
        let _ = js_sys::Reflect::set(
            &result,
            &"bFixUsed".into(),
            &JsValue::from_bool(b_fix_used),
        );
        // Whether this body's display tree contains a multi-frame
        // sprite with different children per frame — canonical
        // `mcToHide` pattern. Only Iop's R_tete matches in vanilla
        // Dofus 1.29. JS uses this to decide whether to include
        // `hatEquipped` in the body atlas cache key: classes that
        // don't have a toggle bake identically regardless of hat
        // state, so caching two variants wastes ~50 % of cache.
        let has_toggle = swf_spike::render::body_has_toggle_sprite(doc, body);
        let _ = js_sys::Reflect::set(
            &result,
            &"hasToggleSprite".into(),
            &JsValue::from_bool(has_toggle),
        );
        result.into()
    }

    /// Render ALL Z-ordered bands of a body symbol over a frame range
    /// into a SINGLE atlas pair (colour + zone-id). Bands are stacked
    /// vertically in the atlas with `BAND_PADDING_PX` of transparent
    /// padding between them so LINEAR sampling at band 0's bottom
    /// edge can't bleed into band 1's top edge.
    ///
    /// Cuts texture allocations from `bandCount × 2` per anim to
    /// exactly `2` (one colour atlas, one zone atlas). Vello compute
    /// dispatch count drops from `2 × bandCount` to `2` as well —
    /// all bands' geometry packs into one scene per output mode.
    ///
    /// Pixel-perfect equivalent to per-band rendering: each band's
    /// content is rasterized at the same `(scale, -px_min_x, -px_min_y)`
    /// world transform as before, just offset down the atlas by
    /// `band_idx × (strip_h + BAND_PADDING_PX)`. The Pixi mesh shifts
    /// its UV range to address only its band's sub-region; vertex
    /// positions and anchors are unchanged, so accessory mount
    /// placement (driven by twip-space affine transforms, completely
    /// orthogonal to texture layout) sees no change.
    #[wasm_bindgen(js_name = "renderSwfBodyAtlas")]
    pub fn render_swf_body_atlas(
        &mut self,
        bundle: &str,
        export: &str,
        start: u32,
        count: u32,
        total_frame_count: u32,
        resolution: f32,
        apply_b_fix: bool,
        hat_equipped: bool,
    ) -> JsValue {
        const BAND_PADDING_PX: u32 = 2;
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
        let swf_spike::swf_doc::Symbol::Sprite(body) = symbol else {
            console_log!(
                "renderSwfBodyAtlas: export `{bundle}/{export}` is not a sprite"
            );
            return JsValue::NULL;
        };

        // Canonical Dofus body exports nest the actual body parts
        // (and accessory mounts) inside an unnamed single-placement
        // wrapper. The band split + filter operate on the WRAPPER's
        // depth space; if we walked the body export itself we'd see
        // 1 top-level placement (the wrapper) and 0 mounts → empty
        // band split → all bands merge into 1 → JS can't interleave
        // accessories. Descend through the wrapper chain.
        let (effective_sym, effective_xform) =
            swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
        let slots = swf_spike::render::extract_slot_depths(doc, body, 0);
        let band_total_logical = swf_spike::render::band_count(&slots);
        if band_total_logical == 0 {
            return JsValue::NULL;
        }
        // Skip "trivial" bands — canonical Dofus character bodies
        // wrap each accessory slot in an empty placeholder sprite.
        // Bands containing only such placeholders bake to zero
        // pixels but still cost full strip_w × strip_h atlas area.
        // For staticB this drops band count from 5 → 1, shrinking
        // the atlas ~5× and fixing the "1.5 GB cache thrash" at
        // 200-bot stress.
        let effective_body = match effective_sym {
            swf_spike::swf_doc::Symbol::Sprite(s) => s,
            _ => body,
        };
        let band_presence = swf_spike::render::compute_band_presence(
            doc,
            effective_body,
            0,
            &slots,
        );
        // Logical band indices that actually have content. JS uses
        // these for mesh.zIndex assignment; sparse bandIndex values
        // (e.g. just [0] when bands 1-4 are empty) is fine because
        // accessory zIndex is computed from slot order, not band
        // density.
        let present_logical: Vec<usize> = band_presence
            .iter()
            .enumerate()
            .filter_map(|(i, &p)| if p { Some(i) } else { None })
            .collect();
        let band_total = present_logical.len().max(1);
        let band_ranges: Vec<swf_spike::render::BandRange> = present_logical
            .iter()
            .map(|&i| swf_spike::render::band_range(&slots, i))
            .collect();
        // Fallback: if every band was trivial (degenerate body),
        // bake one full-range band so we don't emit a null atlas.
        let band_ranges = if band_ranges.is_empty() {
            vec![swf_spike::render::BandRange::ALL]
        } else {
            band_ranges
        };
        let present_logical = if present_logical.is_empty() {
            vec![0usize]
        } else {
            present_logical
        };

        let end = start.saturating_add(count).min(total_frame_count);
        let chunk_end = end.min(cached.anim_end);
        if chunk_end <= start {
            return JsValue::NULL;
        }
        let chunk_count = chunk_end - start;

        // Cell layout matches the legacy single-strip path — every
        // band shares the same anchor + cell size + grid cols, so
        // mounts and accessory positions align identically to the
        // pre-atlas path.
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

        // Atlas layout: bands stacked vertically. Only PRESENT bands
        // (those with visible content) get a strip; trivial bands are
        // skipped entirely. Width = single-band strip width (already
        // constrained ≤ 16384). Height = N_present × strip_h +
        // (N_present-1) × BAND_PADDING_PX.
        let band_present_u32 = present_logical.len() as u32;
        let padding_total = if band_present_u32 > 0 {
            (band_present_u32 - 1) * BAND_PADDING_PX
        } else {
            0
        };
        let atlas_w = strip_w;
        let atlas_h = strip_h * band_present_u32 + padding_total;
        if atlas_w == 0
            || atlas_h == 0
            || atlas_w > 16384
            || atlas_h > 16384
        {
            console_log!(
                "renderSwfBodyAtlas: atlas {atlas_w}x{atlas_h} exceeds GPU limits \
                 (strip {strip_w}x{strip_h}, bands={band_total})"
            );
            return JsValue::NULL;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
        // Phase 1: long-lived per-bundle cache. Shape flatten + frame
        // state are pass-independent AND bake-independent — sharing
        // across the Colour/ZoneId passes halves the second pass's
        // cost; sharing across BAKES (e.g. every walkR variant of
        // every Iop look) drops subsequent bakes by ~99 % on the
        // flatten path. Per-bundle keying because SWF symbol IDs
        // are only unique within a bundle.
        let cache: &swf_spike::render::cache::RenderCache = self
            .swf_render_caches
            .entry(bundle.to_string())
            .or_default();
        let player_colors = swf_spike::recolor::PlayerColors::default();

        // Helper: build the atlas scene containing EVERY band's cell
        // grid. Each band's content is translated down the atlas by
        // `band_idx × (strip_h + BAND_PADDING_PX)` so the bands stack
        // with a transparent gutter that LINEAR sampling can't cross.
        let band_ranges_ref = &band_ranges;
        let build_scene = |mode: swf_spike::render::RenderMode,
                           device: &wgpu::Device,
                           queue: &wgpu::Queue,
                           renderer: &mut Renderer,
                           filter_pipelines: &swf_spike::wgpu_filters::FilterPipelines|
         -> vello::Scene {
            let mut wctx = swf_spike::render::WgpuCtx {
                device,
                queue,
                renderer,
                filter_pipelines,
                output_scale: scale,
            };
            let mut scene = vello::Scene::new();
            // band_ranges only contains PRESENT bands. We render
            // them in order; each takes the next strip slot in the
            // atlas regardless of its logical band index. JS reads
            // `bandIndex` from the returned `bands` array to recover
            // the logical position for zIndex math.
            // Opt-3 inverted loop order: frame outer, band inner so
            // all bands of one frame share the cached frame_state.
            for slot in 0..chunk_count {
                let frame_idx = start + slot;
                let col = (slot as usize) % grid_cols;
                let row = (slot as usize) / grid_cols;
                let cell_x = (col * frame_w as usize) as f64;
                for (slot_idx, &band) in band_ranges_ref.iter().enumerate() {
                    let band_atlas_y =
                        (slot_idx as f64) * (f64::from(strip_h) + f64::from(BAND_PADDING_PX));
                    let cell_y = band_atlas_y + (row * frame_h as usize) as f64;
                    let xform = vello::kurbo::Affine::scale(scale).then_translate(
                        vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y + cell_y),
                    );
                    // Render the WRAPPER (effective body), with the
                    // wrapper's own placement transform composed in.
                    swf_spike::render::render_body_band(
                        &mut wctx,
                        doc,
                        effective_sym,
                        &mut scene,
                        xform * effective_xform,
                        frame_idx as u16,
                        band,
                        mode,
                        player_colors,
                        cache,
                        apply_b_fix,
                        hat_equipped,
                    );
                }
            }
            scene
        };

        // Phase 1b: scene-level cache. Skip build_scene entirely
        // when a previous bake with identical (bundle, export, start,
        // count, scale, apply_b_fix, hat_equipped, mode) parameters
        // already encoded the Vello scene. We still pay rasterization
        // (render_to_texture) + combine + bitmap bridge, but the
        // ~90 k-fill scene encoding is gone.
        //
        // `scale_q` quantises the f32 scale to integer milli-units so
        // it can participate in `Hash`. Practical scales used in the
        // app are powers of integers (resolution=3 ⇒ scale=0.15),
        // so quantization loss is zero.
        let scale_q = (scale * 1000.0).round() as u32;
        let colour_key = BodySceneCacheKey {
            bundle: bundle.to_string(),
            export: export.to_string(),
            start,
            count: chunk_count,
            scale_q,
            apply_b_fix,
            hat_equipped,
            mode: 0,
        };
        let zone_key = BodySceneCacheKey {
            mode: 1,
            ..colour_key.clone()
        };
        // Build-on-miss into temporaries first so we don't hold a
        // `&mut self.body_scene_cache` borrow across the closure call
        // (which needs `&mut self.renderer`). Once the temps are in
        // scope, the closure has returned and `&mut self.renderer`
        // is no longer alive — we can then mutate `body_scene_cache`.
        let new_colour: Option<vello::Scene> =
            if self.body_scene_cache.contains_key(&colour_key) {
                None
            } else {
                Some(build_scene(
                    swf_spike::render::RenderMode::Colour,
                    &self.device,
                    &self.queue,
                    &mut self.renderer,
                    filter_pipelines,
                ))
            };
        let new_zone: Option<vello::Scene> =
            if self.body_scene_cache.contains_key(&zone_key) {
                None
            } else {
                Some(build_scene(
                    swf_spike::render::RenderMode::ZoneId,
                    &self.device,
                    &self.queue,
                    &mut self.renderer,
                    filter_pipelines,
                ))
            };
        // Soft cap on `body_scene_cache` size. Phase 1b made each
        // body bake ~5× cheaper but accidentally regressed
        // `tickerMsAvg` from 12 ms to 26 ms when the cache grew past
        // ~1100 entries (200-bot stress run, t+15 s). Cause: the
        // WASM heap grew +500 MB as the cache filled, and physical
        // memory pressure inflated main-thread frame time even
        // though CPU-side bake work was lower. At real-game scale
        // (16-50 bots, ~200 unique scene keys) the cap never trips;
        // at stress scale (200 random-look bots, ~1500+ unique keys)
        // eviction kicks in and we accept some scene cache misses
        // (which fall back to ~5 ms bakes — still no worse than the
        // pre-Phase-1b baseline).
        //
        // Approximate-LRU eviction: when the cache crosses the cap,
        // drop a single entry per insert. CRITICAL: the eviction
        // candidate MUST NOT match `colour_key` or `zone_key`. The
        // initial implementation picked `keys().next()` which is
        // randomized per Rust's default hasher, so it could pick
        // either of the keys we're about to `get(&key)` back. When
        // that happened, the `expect("just inserted")` below trapped
        // the wasm module, taking down every subsequent Vello call
        // and producing a "black screen" crash. Excluding the active
        // keys from the victim search is required for correctness,
        // not just optimization. Hot entries that get evicted will
        // re-enter the cache on their next bake; lukewarm entries
        // cycle out. Steady-state size oscillates around the cap.
        const BODY_SCENE_CACHE_CAP: usize = 1500;
        let mut inserts_pending = 0usize;
        if new_colour.is_some() {
            inserts_pending += 1;
        }
        if new_zone.is_some() {
            inserts_pending += 1;
        }
        while self.body_scene_cache.len() + inserts_pending > BODY_SCENE_CACHE_CAP {
            let Some(victim) = self
                .body_scene_cache
                .keys()
                .find(|k| **k != colour_key && **k != zone_key)
                .cloned()
            else {
                // Every remaining entry is one of the two active
                // keys — can't evict without breaking the bake.
                // Accept the over-cap state for this iteration; the
                // next bake will re-evict.
                break;
            };
            self.body_scene_cache.remove(&victim);
        }
        if let Some(s) = new_colour {
            self.body_scene_cache.insert(colour_key.clone(), s);
        }
        if let Some(s) = new_zone {
            self.body_scene_cache.insert(zone_key.clone(), s);
        }
        // Retrieve as `&Scene` — both `render_to_texture` calls below
        // only need a shared borrow. Safe to `expect()`: either we
        // built and inserted the scene above, or it was already in
        // the cache and the eviction loop above is guaranteed to
        // skip it (see the `find(...)` exclusion).
        let colour_scene = self.body_scene_cache.get(&colour_key).expect("just inserted");
        let zone_scene = self.body_scene_cache.get(&zone_key).expect("just inserted");

        // Render both scenes into their respective atlas textures.
        // Atlas dims = (strip_w, band_total * strip_h + padding).
        let render_one = |scene: &vello::Scene,
                          label: &'static str,
                          device: &wgpu::Device,
                          queue: &wgpu::Queue,
                          renderer: &mut Renderer|
         -> Option<wgpu::Texture> {
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: atlas_w,
                    height: atlas_h,
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
                width: atlas_w,
                height: atlas_h,
                antialiasing_method: AaConfig::Area,
            };
            if let Err(e) = renderer.render_to_texture(device, queue, scene, &view, &params) {
                console_log!("renderSwfBodyAtlas[{label}]: render error: {e}");
                return None;
            }
            Some(texture)
        };

        let Some(colour_tex) = render_one(
            colour_scene,
            "vello_swf_body_atlas_color",
            &self.device,
            &self.queue,
            &mut self.renderer,
        ) else {
            return JsValue::NULL;
        };
        let Some(zone_tex) = render_one(
            zone_scene,
            "vello_swf_body_atlas_zone",
            &self.device,
            &self.queue,
            &mut self.renderer,
        ) else {
            return JsValue::NULL;
        };

        // Color+zone merge: run a single render pass that combines
        // the two Vello-rendered temp textures into ONE Rgba8Unorm
        // where the zone-id is packed into the low 2 bits of the
        // alpha channel. Halves the Pixi-side working set vs. the
        // previous two-texture approach. See
        // `CombineBodyPipeline` for the encoding details.
        if self.combine_body_pipeline.is_none() {
            self.combine_body_pipeline =
                Some(bitmap_bridge::CombineBodyPipeline::new(&self.device));
        }
        let combined_tex = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_body_atlas_combined"),
            size: wgpu::Extent3d {
                width: atlas_w,
                height: atlas_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        {
            let combine = self.combine_body_pipeline.as_ref().unwrap();
            let colour_view = colour_tex.create_view(&wgpu::TextureViewDescriptor::default());
            let zone_view = zone_tex.create_view(&wgpu::TextureViewDescriptor::default());
            let dst_view = combined_tex.create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("body-atlas-combine-encoder"),
                });
            combine.combine(&self.device, &mut encoder, &colour_view, &zone_view, &dst_view);
            self.queue.submit(std::iter::once(encoder.finish()));
        }
        // The two source temp textures are no longer needed. They
        // drop at the end of this scope (deferred_destroy queues them
        // for GPU release after the settle window).
        drop(colour_tex);
        drop(zone_tex);

        // Bridge the single combined texture into an ImageBitmap.
        let Some(combined_bitmap) =
            self.texture_to_bitmap(&combined_tex, atlas_w, atlas_h, "renderSwfBodyAtlas")
        else {
            return JsValue::NULL;
        };

        // Per-band atlas region. JS uses this to derive UV ranges:
        //   u0 = 0,            v0 = atlasY / atlas_h
        //   u1 = strip_w/atlas_w (= 1.0),   v1 = (atlasY + strip_h) / atlas_h
        // and within the band, per-frame UVs follow the grid_cols ×
        // grid_rows layout exactly like the legacy single-strip path.
        let bands_arr = js_sys::Array::new();
        for (slot_idx, &logical_band_idx) in present_logical.iter().enumerate() {
            let band_atlas_y =
                (slot_idx as u32) * (strip_h + BAND_PADDING_PX);
            let entry = js_sys::Object::new();
            // `bandIndex` is the LOGICAL band index (0..band_total_logical),
            // not the position in the atlas. JS uses this for
            // mesh.zIndex so bands stay correctly interleaved with
            // accessory slots even when some bands were skipped.
            let _ = js_sys::Reflect::set(
                &entry,
                &"bandIndex".into(),
                &JsValue::from(logical_band_idx as u32),
            );
            let _ = js_sys::Reflect::set(
                &entry,
                &"atlasX".into(),
                &JsValue::from(0u32),
            );
            let _ = js_sys::Reflect::set(
                &entry,
                &"atlasY".into(),
                &JsValue::from(band_atlas_y),
            );
            bands_arr.push(&entry.into());
        }

        let result = js_sys::Object::new();
        // Combined bridge path: ONE bitmap with body color in RGB +
        // packed (body_alpha & 0xFC | zone_id) in A. The JS-side
        // body-band shader binds this texture with two samplers —
        // LINEAR for color/alpha, NEAREST for zone — and decodes
        // zone_id from the low 2 bits of the alpha byte.
        let _ = js_sys::Reflect::set(&result, &"combinedBitmap".into(), &combined_bitmap);
        let _ = js_sys::Reflect::set(
            &result,
            &"atlasWidth".into(),
            &JsValue::from(atlas_w),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"atlasHeight".into(),
            &JsValue::from(atlas_h),
        );
        // `stripWidth` / `stripHeight` = ONE band's strip dims inside
        // the atlas. JS uses these + atlasY to compute per-band UV.
        let _ = js_sys::Reflect::set(
            &result,
            &"stripWidth".into(),
            &JsValue::from(strip_w),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"stripHeight".into(),
            &JsValue::from(strip_h),
        );
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
        // bandCount = number of PRESENT bands (matches `bands` array
        // length). JS iterates the `bands` array to create meshes.
        // The LOGICAL band total is implied by `slotCount + 1` and
        // is already encoded in each `bands[i].bandIndex`.
        let _ = js_sys::Reflect::set(
            &result,
            &"bandCount".into(),
            &JsValue::from(present_logical.len() as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"slotCount".into(),
            &JsValue::from(slots.len() as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"bands".into(), &bands_arr.into());
        let _ = js_sys::Reflect::set(
            &result,
            &"bandPadding".into(),
            &JsValue::from(BAND_PADDING_PX),
        );
        result.into()
    }

    /// Class atlas bake: pack EVERY animation variant of a body
    /// bundle (walkR/L/F/B/S, staticR/L/F/B/S, runR/L/F/B/S, plus any
    /// other `<word><direction-suffix>` named sprite) × `applyBFix ∈
    /// {false, [true]}` × `hatEquipped ∈ {false, [true]}` into ONE
    /// Rgba8Unorm texture bridged to a single ImageBitmap.
    ///
    /// Normalisation: the `applyBFix` and `hatEquipped` dimensions
    /// expand only when the body uses them (any mount with
    /// `b_fix=true` / a multi-frame toggle sprite respectively).
    /// Otherwise we bake one variant per export.
    ///
    /// Per-variant rasterisation reuses the same scene-build /
    /// render_to_texture / `CombineBodyPipeline` path as
    /// `renderSwfBodyAtlas`. Each variant produces a variant-sized
    /// `combined` texture, then `copy_texture_to_texture` writes it
    /// into the class atlas at the packer-assigned origin. No new
    /// Vello scene-size risk (every per-variant scene stays the
    /// size we know works); the win is purely in (a) Pixi-side
    /// texture count → 1 per class instead of N per variant,
    /// (b) per-variant intermediate `ImageSource` upload gone.
    #[wasm_bindgen(js_name = "renderSwfClassAtlas")]
    pub fn render_swf_class_atlas(
        &mut self,
        bundle: &str,
        resolution: f32,
    ) -> JsValue {
        const BAND_PADDING_PX: u32 = 2;
        const PADDING_PX: u32 = 2;
        const MAX_ATLAS_DIM: u32 = 8192;

        if resolution <= 0.0 {
            return JsValue::NULL;
        }

        // Instrumentation accumulators. Cost is one `performance.now()`
        // per phase × N variants — negligible vs the Vello work.
        let bake_start = perf_now();
        let mut total_scene_build_ms = 0.0_f64;
        let mut total_render_submit_ms = 0.0_f64;
        let mut total_combine_copy_ms = 0.0_f64;
        let mut total_bridge_ms = 0.0_f64;
        let mut t_enumerate_start = perf_now();
        let mut per_variant_log: Vec<(String, bool, bool, u32, u32, f64, f64, f64)> =
            Vec::new();

        // Step 1: load the precomputed enumeration for this bundle.
        // `ensure_class_enumeration` builds the per-export metadata
        // (frame counts, has_toggle, export_b_fix, slot counts) ONCE
        // per bundle; subsequent class atlas bakes (e.g. re-bakes,
        // resolution flips, hot-reload) read the cached table. ~11 ms
        // per class saved at warmup (Opt-5).
        if !self.swf_bundles.contains_key(bundle) {
            console_log!("renderSwfClassAtlas: bundle `{bundle}` not loaded");
            return JsValue::NULL;
        }
        if !self.class_enum_cache.contains_key(bundle) {
            let enumeration = self.compute_class_enumeration(bundle);
            self.class_enum_cache
                .insert(bundle.to_string(), enumeration);
        }
        let enumeration = self
            .class_enum_cache
            .get(bundle)
            .expect("just inserted");
        if enumeration.exports.is_empty() {
            console_log!(
                "renderSwfClassAtlas: bundle `{bundle}` has no character-anim exports"
            );
            return JsValue::NULL;
        }
        let b_fix_used = enumeration.bundle_b_fix_used;

        // Step 2: lay out each variant. We compute every variant's
        // pixel bbox + per-band sub-rect (in variant-local coords)
        // before allocating anything, so the bin-pack can choose an
        // atlas size that fits.
        struct VariantLayout {
            export_name: String,
            apply_b_fix: bool,
            hat_equipped: bool,
            // From swf_anim_frame_count for the export.
            total_frame_count: u32,
            // Pixel dims of the variant's full sub-rect.
            atlas_w: u32,
            atlas_h: u32,
            // Per-band & cell layout (variant-local).
            strip_w: u32,
            strip_h: u32,
            frame_w: u32,
            frame_h: u32,
            grid_cols: u32,
            frame_count: u32,
            anchor_x: f64,
            anchor_y: f64,
            // Logical band index → variant-local atlasY of that band.
            present_logical: Vec<usize>,
            band_ranges: Vec<swf_spike::render::BandRange>,
            band_atlas_ys: Vec<u32>,
            slot_count: u32,
            // Scene-build inputs: chunk range. We bake the whole
            // animation in one window (start=0, count=chunk_count),
            // matching the JS-side calling convention.
            chunk_start: u32,
            chunk_count: u32,
            // After packing.
            page_index: u32,
            packed_x: u32,
            packed_y: u32,
        }

        struct AtlasPage {
            width: u32,
            height: u32,
            shelf_y: u32,
            shelf_h: u32,
            shelf_x: u32,
        }

        let mut variants: Vec<VariantLayout> = Vec::new();
        // Iterate the precomputed enumeration. Per-bundle one-shot
        // work (frame counts, toggle/bFix detection, slot counts)
        // already paid; just clone the cheap fields per export.
        let exports_snapshot: Vec<(String, u32, bool, bool, u32)> = enumeration
            .exports
            .iter()
            .map(|e| {
                (
                    e.export_name.clone(),
                    e.total_frame_count,
                    e.has_toggle,
                    e.export_b_fix,
                    e.slot_count_logical,
                )
            })
            .collect();
        for (export_name, total, has_toggle, export_b_fix, slot_count_logical) in
            &exports_snapshot
        {
            let export = export_name.as_str();
            let total = *total;
            let has_toggle = *has_toggle;
            let export_b_fix = *export_b_fix;
            let slot_count_logical = *slot_count_logical;

            // Iterate dimensionality. Per-export bFix collapse (Opt-2):
            // only expand the dimension if THIS export actually uses
            // a `b_fix=true` mount. Static poses on classes with a
            // bFix cape rarely place the cape at frame 0; collapsing
            // such exports halves their variant count.
            for &apply_b_fix in if export_b_fix { &[false, true][..] } else { &[false][..] } {
                for &hat_equipped in if has_toggle { &[false, true][..] } else { &[false][..] } {
                    // Compute variant layout (mirrors the prelude of
                    // `render_swf_body_atlas`).
                    let Some(cached) = self.cache_strip_bounds(bundle, export, total) else {
                        continue;
                    };
                    let Some(doc) = self.swf_bundles.get(bundle) else {
                        continue;
                    };
                    let Some(symbol) = doc.lookup_export(export) else {
                        continue;
                    };
                    let swf_spike::swf_doc::Symbol::Sprite(body) = symbol else {
                        continue;
                    };
                    let (effective_sym, _effective_xform) =
                        swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
                    let slots = swf_spike::render::extract_slot_depths(doc, body, 0);
                    if swf_spike::render::band_count(&slots) == 0 {
                        continue;
                    }
                    let effective_body = match effective_sym {
                        swf_spike::swf_doc::Symbol::Sprite(s) => s,
                        _ => body,
                    };
                    let band_presence = swf_spike::render::compute_band_presence(
                        doc,
                        effective_body,
                        0,
                        &slots,
                    );
                    let present_logical: Vec<usize> = band_presence
                        .iter()
                        .enumerate()
                        .filter_map(|(i, &p)| if p { Some(i) } else { None })
                        .collect();
                    let band_ranges: Vec<swf_spike::render::BandRange> = present_logical
                        .iter()
                        .map(|&i| swf_spike::render::band_range(&slots, i))
                        .collect();
                    let (band_ranges, present_logical) = if band_ranges.is_empty() {
                        (vec![swf_spike::render::BandRange::ALL], vec![0usize])
                    } else {
                        (band_ranges, present_logical)
                    };

                    let chunk_start: u32 = 0;
                    let chunk_end = total.min(cached.anim_end);
                    if chunk_end == 0 {
                        continue;
                    }
                    let chunk_count = chunk_end;

                    let scale = f64::from(resolution) / 20.0;
                    let pad = 1.0;
                    let px_min_x = (cached.min_x * scale).floor() - pad;
                    let px_min_y = (cached.min_y * scale).floor() - pad;
                    let px_max_x = (cached.max_x * scale).ceil() + pad;
                    let px_max_y = (cached.max_y * scale).ceil() + pad;
                    let frame_w = ((px_max_x - px_min_x) as u32).max(1);
                    let frame_h = ((px_max_y - px_min_y) as u32).max(1);

                    // Pick grid layout that keeps the variant's full
                    // atlas (strip_w × (bands × strip_h + padding))
                    // inside MAX_ATLAS_DIM². The legacy single-row
                    // layout (one strip wider than tall) blows past
                    // 16k pixels for high-frame anims like `die`; a
                    // ~square layout keeps the bbox under the cap.
                    let band_present_u32 = present_logical.len() as u32;
                    let padding_total = if band_present_u32 > 0 {
                        (band_present_u32 - 1) * BAND_PADDING_PX
                    } else {
                        0
                    };
                    // Maximum per-band strip height that keeps the
                    // stacked-bands atlas under MAX_ATLAS_DIM tall.
                    let max_strip_h = if band_present_u32 > 0 {
                        (MAX_ATLAS_DIM.saturating_sub(padding_total)) / band_present_u32
                    } else {
                        MAX_ATLAS_DIM
                    };
                    let max_cols = (MAX_ATLAS_DIM / frame_w).max(1) as usize;
                    let max_rows = (max_strip_h / frame_h).max(1) as usize;
                    let chunk_usize = chunk_count as usize;
                    if max_cols * max_rows < chunk_usize {
                        console_log!(
                            "renderSwfClassAtlas: variant {bundle}/{export}/bFix={apply_b_fix}/hat={hat_equipped} \
                             too many frames ({chunk_usize}) for max grid {max_cols}x{max_rows}; skipping"
                        );
                        continue;
                    }
                    // Most-square grid that obeys the band-height
                    // ceiling. Aspect target: `cols * frame_w ≈
                    // rows * frame_h` so strip_w ≈ strip_h.
                    let ideal_cols_f = ((chunk_usize as f64)
                        * (frame_h as f64)
                        / (frame_w as f64))
                        .sqrt()
                        .ceil();
                    let ideal_cols = (ideal_cols_f as usize).max(1);
                    let min_cols = (chunk_usize + max_rows - 1) / max_rows;
                    let grid_cols = ideal_cols.max(min_cols).min(max_cols).min(chunk_usize);
                    let grid_rows_v = (chunk_usize + grid_cols - 1) / grid_cols;
                    let strip_w = frame_w * grid_cols as u32;
                    let strip_h = frame_h * grid_rows_v as u32;
                    let atlas_w = strip_w;
                    let atlas_h = strip_h * band_present_u32 + padding_total;
                    if atlas_w == 0
                        || atlas_h == 0
                        || atlas_w > MAX_ATLAS_DIM
                        || atlas_h > MAX_ATLAS_DIM
                    {
                        // Defence-in-depth — the geometric clamps
                        // above should keep us under MAX_ATLAS_DIM,
                        // but skip rather than abort if a corner
                        // case slips through.
                        console_log!(
                            "renderSwfClassAtlas: variant {bundle}/{export}/bFix={apply_b_fix}/hat={hat_equipped} \
                             still over-large {atlas_w}x{atlas_h}; skipping"
                        );
                        continue;
                    }

                    // Cache per-band variant-local atlasY.
                    let mut band_atlas_ys = Vec::with_capacity(present_logical.len());
                    for slot_idx in 0..present_logical.len() {
                        let y = (slot_idx as u32) * (strip_h + BAND_PADDING_PX);
                        band_atlas_ys.push(y);
                    }

                    variants.push(VariantLayout {
                        export_name: export.to_string(),
                        apply_b_fix,
                        hat_equipped,
                        total_frame_count: total,
                        atlas_w,
                        atlas_h,
                        strip_w,
                        strip_h,
                        frame_w,
                        frame_h,
                        grid_cols: grid_cols as u32,
                        frame_count: chunk_count,
                        anchor_x: -px_min_x,
                        anchor_y: -px_min_y,
                        present_logical,
                        band_ranges,
                        band_atlas_ys,
                        slot_count: slot_count_logical,
                        chunk_start,
                        chunk_count,
                        page_index: 0,
                        packed_x: 0,
                        packed_y: 0,
                    });
                }
            }
        }

        if variants.is_empty() {
            console_log!("renderSwfClassAtlas: bundle `{bundle}` produced no bakeable variants");
            return JsValue::NULL;
        }

        // Step 3: multi-page shelf bin-pack. Each page is ≤
        // MAX_ATLAS_DIM². When a variant doesn't fit on the current
        // page, open a new page. This is the planned fallback for
        // classes whose total variant area exceeds a single page —
        // documented in `RENDER_CLASS_ATLAS_PLAN.md` "Atlas dim
        // ceiling" caveat.
        variants.sort_by(|a, b| b.atlas_h.cmp(&a.atlas_h));
        let mut pages: Vec<AtlasPage> = vec![AtlasPage {
            width: MAX_ATLAS_DIM,
            height: 0,
            shelf_y: 0,
            shelf_h: 0,
            shelf_x: 0,
        }];
        for v in variants.iter_mut() {
            // Try to place on each existing page; spill to a new
            // page if none accept the variant.
            let mut placed = false;
            for (p_idx, page) in pages.iter_mut().enumerate() {
                // Advance to a new shelf if the current one is full.
                let (mut try_y, mut try_x, mut try_shelf_h) =
                    (page.shelf_y, page.shelf_x, page.shelf_h);
                if try_x + v.atlas_w > page.width {
                    try_y = try_y.saturating_add(try_shelf_h);
                    if try_y > 0 {
                        try_y = try_y.saturating_add(PADDING_PX);
                    }
                    try_x = 0;
                    try_shelf_h = 0;
                }
                if try_x + v.atlas_w > page.width {
                    continue;
                }
                if try_y + v.atlas_h > MAX_ATLAS_DIM {
                    continue;
                }
                v.page_index = p_idx as u32;
                v.packed_x = try_x;
                v.packed_y = try_y;
                page.shelf_y = try_y;
                page.shelf_x = try_x + v.atlas_w + PADDING_PX;
                page.shelf_h = try_shelf_h.max(v.atlas_h);
                let new_extent = try_y + page.shelf_h;
                if new_extent > page.height {
                    page.height = new_extent.min(MAX_ATLAS_DIM);
                }
                placed = true;
                break;
            }
            if !placed {
                // Open a new page. A freshly-allocated page can
                // always fit a variant whose dims are ≤
                // MAX_ATLAS_DIM (already validated above).
                let new_page_idx = pages.len() as u32;
                let mut new_page = AtlasPage {
                    width: MAX_ATLAS_DIM,
                    height: v.atlas_h,
                    shelf_y: 0,
                    shelf_h: v.atlas_h,
                    shelf_x: v.atlas_w + PADDING_PX,
                };
                v.page_index = new_page_idx;
                v.packed_x = 0;
                v.packed_y = 0;
                // Cap page height to MAX_ATLAS_DIM (variant already
                // validated against this dim).
                new_page.height = new_page.height.min(MAX_ATLAS_DIM);
                pages.push(new_page);
            }
        }
        // Finalise page dims — each page's WIDTH and HEIGHT are
        // shrunk to the tightest rectangle that contains every
        // packed variant. The packer treats `page.width` as the
        // hard ceiling during placement, but if all variants on
        // this page only used the left 2000 px, allocating a
        // 8192-wide GPU texture wastes ~75 % of the page's memory.
        // Round up to the next multiple of 64 for nicer alignment.
        for (p_idx, page) in pages.iter_mut().enumerate() {
            let mut used_w = 0u32;
            let mut used_h = 0u32;
            for v in variants.iter() {
                if v.page_index as usize != p_idx {
                    continue;
                }
                let right = v.packed_x + v.atlas_w;
                let bottom = v.packed_y + v.atlas_h;
                if right > used_w {
                    used_w = right;
                }
                if bottom > used_h {
                    used_h = bottom;
                }
            }
            let align = 64u32;
            let aligned_w = ((used_w + align - 1) / align) * align;
            let aligned_h = ((used_h + align - 1) / align) * align;
            page.width = aligned_w.max(1).min(MAX_ATLAS_DIM);
            page.height = aligned_h.max(1).min(MAX_ATLAS_DIM);
        }

        // Step 4: allocate one combined class atlas texture per page.
        struct PageTextures {
            combined: wgpu::Texture,
            width: u32,
            height: u32,
        }
        let mut page_textures: Vec<PageTextures> = Vec::with_capacity(pages.len());
        for (p_idx, page) in pages.iter().enumerate() {
            let combined = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("vello_swf_class_atlas_combined"),
                size: wgpu::Extent3d {
                    width: page.width,
                    height: page.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::COPY_DST
                    | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            // No pre-clear needed — `CombineBodyPipeline` runs with
            // `LoadOp::Clear(TRANSPARENT)` on the destination view,
            // overwriting every pixel. Skipping the pre-clear cuts
            // one GPU submission per page.
            page_textures.push(PageTextures {
                combined,
                width: page.width,
                height: page.height,
            });
            let _ = p_idx;
        }

        // Ensure the lazy pipelines exist.
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        if self.combine_body_pipeline.is_none() {
            self.combine_body_pipeline =
                Some(bitmap_bridge::CombineBodyPipeline::new(&self.device));
        }

        let player_colors = swf_spike::recolor::PlayerColors::default();
        let scale = f64::from(resolution) / 20.0;
        let scale_q = (scale * 1000.0).round() as u32;

        // Ensure the bundle-shared render cache exists once for the
        // whole class. This caches flattened shape data per-bundle
        // and is reused across every variant in the loop below.
        let _ = self.swf_render_caches.entry(bundle.to_string()).or_default();
        let _ = scale_q; // body_scene_cache key field — referenced only by the legacy per-variant path now.

        // Pre-clear every page once: combine pass below writes only
        // the variant sub-rect on each variant; pixels outside any
        // variant stay at the clear value.
        for page_tex in &page_textures {
            let dst_view = page_tex
                .combined
                .create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("class-atlas-page-clear"),
                });
            {
                let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("class-atlas-page-clear-pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &dst_view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
            }
            self.queue.submit(std::iter::once(encoder.finish()));
        }

        // Step 5: render each variant at its own dims via Vello, then
        // combine to a variant-sized temp, then copy_texture_to_texture
        // into the variant's page sub-rect.
        //
        // Per-variant Vello dispatch is the safe path — the legacy
        // `feedback_vello_scene_overflow` note documents partial
        // stroke drops when a single scene exceeds the tile-encoder
        // budget. With ~30 variants × ~8 frames × ~5 bands × ~200
        // path fills each = ~240 k fills if merged into one scene
        // per page, well above the overflow threshold. Splitting
        // per-variant keeps each scene at ~5-8 k fills.
        // Instrumentation: track per-class enumeration cost.
        let enumerate_ms = perf_now() - t_enumerate_start;
        t_enumerate_start = perf_now(); // reuse var to silence warning
        let _ = t_enumerate_start;

        for variant in &variants {
            let t_build_start = perf_now();
            let colour_scene = self.build_class_variant_scene(
                bundle,
                &variant.export_name,
                swf_spike::render::RenderMode::Colour,
                variant.chunk_start,
                variant.chunk_count,
                variant.strip_h,
                variant.frame_w,
                variant.frame_h,
                variant.grid_cols as usize,
                -variant.anchor_x,
                -variant.anchor_y,
                scale,
                variant.apply_b_fix,
                variant.hat_equipped,
                &variant.band_ranges,
                player_colors,
            );
            let zone_scene = self.build_class_variant_scene(
                bundle,
                &variant.export_name,
                swf_spike::render::RenderMode::ZoneId,
                variant.chunk_start,
                variant.chunk_count,
                variant.strip_h,
                variant.frame_w,
                variant.frame_h,
                variant.grid_cols as usize,
                -variant.anchor_x,
                -variant.anchor_y,
                scale,
                variant.apply_b_fix,
                variant.hat_equipped,
                &variant.band_ranges,
                player_colors,
            );
            let scene_build_ms = perf_now() - t_build_start;
            total_scene_build_ms += scene_build_ms;

            let v_w = variant.atlas_w;
            let v_h = variant.atlas_h;
            let colour_temp = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("vello_swf_class_variant_color"),
                size: wgpu::Extent3d {
                    width: v_w,
                    height: v_h,
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
            let zone_temp = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("vello_swf_class_variant_zone"),
                size: wgpu::Extent3d {
                    width: v_w,
                    height: v_h,
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
            let colour_view = colour_temp.create_view(&wgpu::TextureViewDescriptor::default());
            let zone_view = zone_temp.create_view(&wgpu::TextureViewDescriptor::default());
            let params = vello::RenderParams {
                base_color: Color::TRANSPARENT,
                width: v_w,
                height: v_h,
                antialiasing_method: AaConfig::Area,
            };
            let t_render_start = perf_now();
            if let Err(e) = self.renderer.render_to_texture(
                &self.device,
                &self.queue,
                &colour_scene,
                &colour_view,
                &params,
            ) {
                console_log!(
                    "renderSwfClassAtlas[colour {}]: render error: {e}",
                    variant.export_name
                );
                return JsValue::NULL;
            }
            if let Err(e) = self.renderer.render_to_texture(
                &self.device,
                &self.queue,
                &zone_scene,
                &zone_view,
                &params,
            ) {
                console_log!(
                    "renderSwfClassAtlas[zone {}]: render error: {e}",
                    variant.export_name
                );
                return JsValue::NULL;
            }
            let render_submit_ms = perf_now() - t_render_start;
            total_render_submit_ms += render_submit_ms;
            let combined_temp = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("vello_swf_class_variant_combined"),
                size: wgpu::Extent3d {
                    width: v_w,
                    height: v_h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let t_combine_start = perf_now();
            {
                let combine = self.combine_body_pipeline.as_ref().unwrap();
                let combined_view =
                    combined_temp.create_view(&wgpu::TextureViewDescriptor::default());
                let dst_page = &page_textures[variant.page_index as usize].combined;
                let mut encoder =
                    self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("class-atlas-variant-combine-copy"),
                    });
                combine.combine(
                    &self.device,
                    &mut encoder,
                    &colour_view,
                    &zone_view,
                    &combined_view,
                );
                encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &combined_temp,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyTextureInfo {
                        texture: dst_page,
                        mip_level: 0,
                        origin: wgpu::Origin3d {
                            x: variant.packed_x,
                            y: variant.packed_y,
                            z: 0,
                        },
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::Extent3d {
                        width: v_w,
                        height: v_h,
                        depth_or_array_layers: 1,
                    },
                );
                self.queue.submit(std::iter::once(encoder.finish()));
            }
            let combine_copy_ms = perf_now() - t_combine_start;
            total_combine_copy_ms += combine_copy_ms;

            per_variant_log.push((
                variant.export_name.clone(),
                variant.apply_b_fix,
                variant.hat_equipped,
                v_w,
                v_h,
                scene_build_ms,
                render_submit_ms,
                combine_copy_ms,
            ));

            drop(colour_temp);
            drop(zone_temp);
            drop(combined_temp);
        }

        // Step 6: bridge each page's class atlas to one ImageBitmap.
        // The bridge step (`render_texture_to_bitmap`) is the only
        // GPU-synchronous step in the bake — it waits for
        // `transferToImageBitmap` after a surface present, so its
        // wall time captures all upstream GPU latency (Vello
        // compute, combine, copies) for everything submitted before.
        let pages_arr = js_sys::Array::new();
        let t_bridge_start = perf_now();
        for page in &page_textures {
            let Some(bitmap) = self.texture_to_bitmap(
                &page.combined,
                page.width,
                page.height,
                "renderSwfClassAtlas",
            ) else {
                return JsValue::NULL;
            };
            let page_obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&page_obj, &"combinedBitmap".into(), &bitmap);
            let _ = js_sys::Reflect::set(
                &page_obj,
                &"atlasWidth".into(),
                &JsValue::from(page.width),
            );
            let _ = js_sys::Reflect::set(
                &page_obj,
                &"atlasHeight".into(),
                &JsValue::from(page.height),
            );
            pages_arr.push(&page_obj.into());
        }
        total_bridge_ms = perf_now() - t_bridge_start;
        let page_count = page_textures.len();
        let mut page_dim_summary = String::new();
        for (i, p) in page_textures.iter().enumerate() {
            if i > 0 {
                page_dim_summary.push(',');
            }
            page_dim_summary.push_str(&format!("{}x{}", p.width, p.height));
        }
        drop(page_textures);

        // Emit a single structured per-class summary plus a per-
        // variant breakdown. Format is grep-friendly so the user
        // can extract numbers across runs:
        //   classAtlasBake bundle=sprite-10 vars=15 pages=2
        //     enumerate=3.2 scene=82.1 render=145.6 combineCopy=12.4
        //     bridge=38.9 total=282.2  pageDims=2048x6080,1024x3072
        //   variant bundle=sprite-10 walkR bFix=0 hat=0 1800x6008
        //     scene=8.2 render=14.5 combineCopy=0.8
        let total_wall_ms = perf_now() - bake_start;
        console_log!(
            "classAtlasBake bundle={bundle} vars={} pages={} enumerate={:.2} scene={:.2} \
             render={:.2} combineCopy={:.2} bridge={:.2} total={:.2} pageDims={}",
            variants.len(),
            page_count,
            enumerate_ms,
            total_scene_build_ms,
            total_render_submit_ms,
            total_combine_copy_ms,
            total_bridge_ms,
            total_wall_ms,
            page_dim_summary
        );
        // Per-variant log lines used to fire here for instrumentation
        // (~24 lines per class bake × hundreds of bakes during a stress
        // run = ~6k+ `console_log!` calls). Each call boxes through
        // wasm-bindgen → DevTools sink and visibly stalls the main
        // thread. The aggregate `classAtlasBake` summary line above is
        // sufficient for production diagnosis; re-enable this loop only
        // when investigating a specific variant.
        let _ = &per_variant_log;

        // Step 7: build per-variant JS metadata.
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"pages".into(), &pages_arr.into());
        let _ = js_sys::Reflect::set(
            &result,
            &"bFixUsed".into(),
            &JsValue::from_bool(b_fix_used),
        );
        let variants_arr = js_sys::Array::new();
        for v in &variants {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &"exportName".into(), &JsValue::from_str(&v.export_name));
            let _ = js_sys::Reflect::set(
                &obj,
                &"applyBFix".into(),
                &JsValue::from_bool(v.apply_b_fix),
            );
            let _ = js_sys::Reflect::set(
                &obj,
                &"hatEquipped".into(),
                &JsValue::from_bool(v.hat_equipped),
            );
            let _ = js_sys::Reflect::set(&obj, &"pageIndex".into(), &JsValue::from(v.page_index));
            let _ = js_sys::Reflect::set(&obj, &"atlasX".into(), &JsValue::from(v.packed_x));
            let _ = js_sys::Reflect::set(&obj, &"atlasY".into(), &JsValue::from(v.packed_y));
            let _ = js_sys::Reflect::set(&obj, &"stripWidth".into(), &JsValue::from(v.strip_w));
            let _ = js_sys::Reflect::set(&obj, &"stripHeight".into(), &JsValue::from(v.strip_h));
            let _ = js_sys::Reflect::set(&obj, &"frameWidth".into(), &JsValue::from(v.frame_w));
            let _ = js_sys::Reflect::set(&obj, &"frameHeight".into(), &JsValue::from(v.frame_h));
            let _ = js_sys::Reflect::set(&obj, &"gridCols".into(), &JsValue::from(v.grid_cols));
            let _ = js_sys::Reflect::set(&obj, &"frameCount".into(), &JsValue::from(v.frame_count));
            let _ = js_sys::Reflect::set(&obj, &"totalFrameCount".into(), &JsValue::from(v.total_frame_count));
            let _ = js_sys::Reflect::set(&obj, &"anchorX".into(), &JsValue::from(v.anchor_x));
            let _ = js_sys::Reflect::set(&obj, &"anchorY".into(), &JsValue::from(v.anchor_y));
            let _ = js_sys::Reflect::set(
                &obj,
                &"bandPadding".into(),
                &JsValue::from(BAND_PADDING_PX),
            );
            let _ = js_sys::Reflect::set(
                &obj,
                &"bandCount".into(),
                &JsValue::from(v.present_logical.len() as u32),
            );
            let _ = js_sys::Reflect::set(
                &obj,
                &"slotCount".into(),
                &JsValue::from(v.slot_count),
            );
            let bands_arr = js_sys::Array::new();
            for (slot_idx, &logical_band_idx) in v.present_logical.iter().enumerate() {
                let band_obj = js_sys::Object::new();
                let _ = js_sys::Reflect::set(
                    &band_obj,
                    &"bandIndex".into(),
                    &JsValue::from(logical_band_idx as u32),
                );
                // Bands are stored in ABSOLUTE class-atlas
                // coordinates so the JS-side UV math is identical
                // to the legacy per-variant path.
                let abs_x = v.packed_x;
                let abs_y = v.packed_y + v.band_atlas_ys[slot_idx];
                let _ = js_sys::Reflect::set(&band_obj, &"atlasX".into(), &JsValue::from(abs_x));
                let _ = js_sys::Reflect::set(&band_obj, &"atlasY".into(), &JsValue::from(abs_y));
                bands_arr.push(&band_obj.into());
            }
            let _ = js_sys::Reflect::set(&obj, &"bands".into(), &bands_arr.into());
            variants_arr.push(&obj.into());
        }
        let _ = js_sys::Reflect::set(&result, &"variants".into(), &variants_arr.into());
        result.into()
    }

    /// Opt-5: build the per-bundle class atlas enumeration table.
    /// Walks `doc.by_name` once, applies the character-anim filter,
    /// runs `swf_anim_frame_count` + `body_has_toggle_sprite` +
    /// `export_uses_b_fix` per qualifying export. Cached on
    /// `class_enum_cache`; only paid once per bundle per session.
    fn compute_class_enumeration(&self, bundle: &str) -> ClassEnumeration {
        let doc = match self.swf_bundles.get(bundle) {
            Some(d) => d,
            None => {
                return ClassEnumeration {
                    bundle_b_fix_used: false,
                    exports: Vec::new(),
                };
            }
        };
        let bundle_b_fix_used = doc
            .accessory_mounts
            .values()
            .any(|mounts| mounts.iter().any(|m| m.b_fix));
        let mut candidates: Vec<String> = doc
            .by_name
            .keys()
            .filter(|n| is_character_anim_name(n))
            .cloned()
            .collect();
        candidates.sort();
        let mut exports: Vec<ClassEnumerationExport> =
            Vec::with_capacity(candidates.len());
        for name in candidates {
            let Some(symbol) = doc.lookup_export(&name) else {
                continue;
            };
            let swf_spike::swf_doc::Symbol::Sprite(body) = symbol else {
                continue;
            };
            let slot_count_logical =
                swf_spike::render::extract_slot_depths(doc, body, 0).len() as u32;
            let has_toggle = swf_spike::render::body_has_toggle_sprite(doc, body);
            let export_b_fix =
                bundle_b_fix_used && swf_spike::render::export_uses_b_fix(doc, body);
            let mut total = self.swf_anim_frame_count(bundle, &name);
            if total == 0 {
                continue;
            }
            if name.starts_with("static") {
                total = 1;
            }
            exports.push(ClassEnumerationExport {
                export_name: name,
                total_frame_count: total,
                has_toggle,
                export_b_fix,
                slot_count_logical,
            });
        }
        ClassEnumeration {
            bundle_b_fix_used,
            exports,
        }
    }

    /// Helper: build a single variant's Vello scene for the class
    /// atlas bake. Mirrors the inline `build_scene` closure from
    /// `render_swf_body_atlas` but lives at method scope so the
    /// borrow of `&mut self.renderer` doesn't conflict with the
    /// scene-cache mutation we need to do around the call.
    #[allow(clippy::too_many_arguments)]
    fn build_class_variant_scene(
        &mut self,
        bundle: &str,
        export: &str,
        mode: swf_spike::render::RenderMode,
        chunk_start: u32,
        chunk_count: u32,
        strip_h: u32,
        frame_w: u32,
        frame_h: u32,
        grid_cols: usize,
        px_min_x: f64,
        px_min_y: f64,
        scale: f64,
        apply_b_fix: bool,
        hat_equipped: bool,
        band_ranges: &[swf_spike::render::BandRange],
        player_colors: swf_spike::recolor::PlayerColors,
    ) -> vello::Scene {
        const BAND_PADDING_PX: u32 = 2;
        let doc = self
            .swf_bundles
            .get(bundle)
            .expect("bundle vetted by caller");
        let symbol = doc.lookup_export(export).expect("export vetted by caller");
        let (effective_sym, effective_xform) =
            swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
        let filter_pipelines = self.swf_filter_pipelines.as_ref().expect("init by caller");
        let cache: &swf_spike::render::cache::RenderCache = self
            .swf_render_caches
            .entry(bundle.to_string())
            .or_default();
        let mut wctx = swf_spike::render::WgpuCtx {
            device: &self.device,
            queue: &self.queue,
            renderer: &mut self.renderer,
            filter_pipelines,
            output_scale: scale,
        };
        let mut scene = vello::Scene::new();
        // Opt-3: inverted loop order. The outer loop walks FRAMES,
        // not bands. Within a single frame, every band reads the
        // SAME `build_frame_state` from `cache.frame_state` — so the
        // 5 band calls become 5 cache hits instead of 5 rebuilds.
        // Frame-state construction was ~30% of `render_body_band`
        // CPU per the per-class profile; this collapses 4 of every
        // 5 builds to a cheap Arc clone.
        for slot in 0..chunk_count {
            let frame_idx = chunk_start + slot;
            let col = (slot as usize) % grid_cols;
            let row = (slot as usize) / grid_cols;
            let cell_x = (col * frame_w as usize) as f64;
            for (slot_idx, &band) in band_ranges.iter().enumerate() {
                let band_atlas_y =
                    (slot_idx as f64) * (f64::from(strip_h) + f64::from(BAND_PADDING_PX));
                let cell_y = band_atlas_y + (row * frame_h as usize) as f64;
                let xform = vello::kurbo::Affine::scale(scale).then_translate(
                    vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y + cell_y),
                );
                swf_spike::render::render_body_band(
                    &mut wctx,
                    doc,
                    effective_sym,
                    &mut scene,
                    xform * effective_xform,
                    frame_idx as u16,
                    band,
                    mode,
                    player_colors,
                    cache,
                    apply_b_fix,
                    hat_equipped,
                );
            }
        }
        scene
    }

    /// Path B accessory strip rasteriser. Bakes 3 directional sub-
    /// frames of an accessory into a 3-wide × 1-tall BGRA8 strip at
    /// the accessory's own origin. The Pixi compositor positions the
    /// sprite per-frame via the body's mount-transform table; this
    /// entry knows nothing about the body.
    ///
    /// Sub-frame layout (column 0/1/2):
    /// `pick_accessory_frame(..., char_frame = 0)` …
    /// `pick_accessory_frame(..., char_frame = 1)` …
    /// `pick_accessory_frame(..., char_frame = 2)`. The Pixi side
    /// indexes into the strip via `char_frame % 3` per game tick.
    ///
    /// `slot + anim_type + dir` drive the slot-specific direction
    /// fallback chain inside `pick_accessory_frame`. `side` defaults
    /// to `dir` — capes and shields with W-prefix walking variants
    /// can pass the body's mount-declared side directly (e.g. `"WR"`)
    /// to opt into the canonical labelled frame, otherwise the
    /// fallback chain falls back to the cardinal direction.
    #[wasm_bindgen(js_name = "renderSwfAccessoryStrip")]
    pub fn render_swf_accessory_strip(
        &mut self,
        acc_bundle: &str,
        acc_export: &str,
        slot: u32,
        anim_type: u32,
        dir: String,
        side: String,
        resolution: f32,
    ) -> JsValue {
        let Some(acc_doc) = self.swf_bundles.get(acc_bundle) else {
            console_log!(
                "renderSwfAccessoryStrip: bundle `{acc_bundle}` not loaded"
            );
            return JsValue::NULL;
        };
        let Some(acc_sym) = acc_doc.lookup_export(acc_export) else {
            console_log!(
                "renderSwfAccessoryStrip: export `{acc_bundle}/{acc_export}` not found"
            );
            return JsValue::NULL;
        };

        let dir_char = dir.chars().next().unwrap_or('R').to_ascii_uppercase();
        let dir_str = dir_char.to_string();
        let side_str = if side.is_empty() { dir_str.clone() } else { side };
        let slot_u8 = slot as u8;
        let anim_type_u8 = anim_type as u8;

        // Resolve the 3 sub-frames + their union bounds. Using the
        // union keeps cell size + anchor stable across cycles so the
        // Pixi sprite swap is a free pointer flip.
        let mut frame_indices = [0u16; 3];
        let mut union: Option<vello::kurbo::Rect> = None;
        for cycle in 0u16..3u16 {
            let f = swf_spike::render::pick_accessory_frame(
                acc_doc, acc_sym, slot_u8, anim_type_u8, &side_str, cycle,
            );
            frame_indices[cycle as usize] = f;
            let b = swf_spike::render::symbol_bounds(acc_doc, acc_sym, f);
            if b.width() <= 0.0 || b.height() <= 0.0 {
                continue;
            }
            union = Some(match union {
                Some(u) => u.union(b),
                None => b,
            });
        }
        let Some(bounds) = union else {
            console_log!(
                "renderSwfAccessoryStrip: `{acc_bundle}/{acc_export}` has no \
                 geometry at slot={slot_u8} anim_type={anim_type_u8} side={side_str}"
            );
            return JsValue::NULL;
        };

        let scale = f64::from(resolution) / 20.0;
        let pad = 1.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let px_max_x = (bounds.x1 * scale).ceil() + pad;
        let px_max_y = (bounds.y1 * scale).ceil() + pad;
        let frame_w = ((px_max_x - px_min_x) as u32).max(1);
        let frame_h = ((px_max_y - px_min_y) as u32).max(1);
        let grid_cols: u32 = 3;
        let strip_w = frame_w * grid_cols;
        let strip_h = frame_h;
        if strip_w == 0 || strip_h == 0 || strip_w > 16384 || strip_h > 16384 {
            console_log!(
                "renderSwfAccessoryStrip: strip {strip_w}x{strip_h} exceeds GPU limits"
            );
            return JsValue::NULL;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines = Some(
                swf_spike::wgpu_filters::FilterPipelines::new(&self.device),
            );
        }
        // Phase 1: persistent per-bundle cache so accessory bakes for
        // the same acc_bundle (a hat type, a weapon type) reuse the
        // shape flatten + frame-state work across calls. Before this
        // change `render_symbol_with_ctx` created a fresh `RenderCache`
        // internally, throwing away the work after the 3 cycle calls.
        let cache: &swf_spike::render::cache::RenderCache = self
            .swf_render_caches
            .entry(acc_bundle.to_string())
            .or_default();
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
        let mut ctx = swf_spike::render::WgpuCtx {
            device: &self.device,
            queue: &self.queue,
            renderer: &mut self.renderer,
            filter_pipelines,
            output_scale: scale,
        };

        let mut scene = vello::Scene::new();
        for cycle in 0u32..grid_cols {
            let cell_x = (cycle * frame_w) as f64;
            let xform = vello::kurbo::Affine::scale(scale).then_translate(
                vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y),
            );
            swf_spike::render::render_symbol_with_ctx_cached(
                &mut ctx,
                acc_doc,
                acc_sym,
                &mut scene,
                xform,
                frame_indices[cycle as usize],
                cache,
            );
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_accessory_strip"),
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
            console_log!("renderSwfAccessoryStrip: render error: {e}");
            return JsValue::NULL;
        }

        let Some(bitmap) =
            self.texture_to_bitmap(&texture, strip_w, strip_h, "renderSwfAccessoryStrip")
        else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ =
            js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ =
            js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(3u32));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols),
        );
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        result.into()
    }

    /// Path B mount-transform extraction. Returns a dense flat
    /// `Float32Array` of length `count * max_slot * 6` carrying the
    /// affine matrix `(a, b, c, d, tx, ty)` at every accessory mount
    /// in the body's display tree, per frame. Translations are in
    /// TWIP space; JS multiplies by `resolution / 20` for pixel
    /// space. Identity matrix where a slot has no mount in a given
    /// frame.
    ///
    /// `apply_b_fix=true` negates the X translation for mounts that
    /// declare `b_fix=true` — matches the body strip's bFix
    /// behaviour. Caller cache key: `(bundle, export, start, count,
    /// apply_b_fix)`.
    /// Returns a JS object: `{ matrices: Float32Array, presence:
    /// Uint8Array }`.
    /// - `matrices` length = `count * max_slot * 6` floats — kurbo
    ///   affine coefficient order `(a, b, c, d, tx, ty)`. Identity
    ///   matrix where the body has no mount at that frame.
    /// - `presence` length = `count * max_slot` bytes — 1 where the
    ///   body's display list places a mount of that slot at that
    ///   frame, 0 otherwise. **This is the canonical signal for
    ///   whether to render the accessory** — checking matrix==identity
    ///   in JS is a heuristic that can false-positive.
    ///
    /// Returns `null` (JsValue::NULL) on resolution failure.
    #[wasm_bindgen(js_name = "renderSwfMountTransforms")]
    pub fn render_swf_mount_transforms(
        &self,
        bundle: &str,
        export: &str,
        start: u32,
        count: u32,
        apply_b_fix: bool,
        max_slot: u32,
    ) -> JsValue {
        if count == 0 || max_slot == 0 {
            return JsValue::NULL;
        }
        let Some(doc) = self.swf_bundles.get(bundle) else {
            console_log!("renderSwfMountTransforms: bundle `{bundle}` not loaded");
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            console_log!(
                "renderSwfMountTransforms: export `{bundle}/{export}` not found"
            );
            return JsValue::NULL;
        };
        let (matrices, presence) =
            swf_spike::render::mount_transforms::extract_mount_transforms(
                doc,
                symbol,
                start as u16,
                count as u16,
                apply_b_fix,
                max_slot as u8,
            );
        let matrices_arr = js_sys::Float32Array::new_with_length(matrices.len() as u32);
        matrices_arr.copy_from(&matrices);
        let presence_arr = js_sys::Uint8Array::new_with_length(presence.len() as u32);
        presence_arr.copy_from(&presence);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"matrices".into(), &matrices_arr.into());
        let _ = js_sys::Reflect::set(&result, &"presence".into(), &presence_arr.into());
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
        // Phase 1: persistent per-bundle cache. `render_symbol_with_
        // ctx_tinted_accessorized_bfixed` already accepts an external
        // cache; previously we passed in a fresh one per call, so the
        // shape-flatten dedup was scoped to this single bake. Lifting
        // to the per-bundle cache shares across bakes too.
        let cache: &swf_spike::render::cache::RenderCache = self
            .swf_render_caches
            .entry(bundle.to_string())
            .or_default();
        let player_colors = self.swf_player_colors;
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
                cache,
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

        let Some(bitmap) = self.texture_to_bitmap(
            &texture,
            strip_w,
            strip_h,
            "renderSwfStripRangeAccessorized",
        ) else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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

    /// SPIKE — bitmap-bridge twin of `renderSwfStripRangeAccessorized`.
    /// Mirrors every input + every dim/anchor field of the live entry
    /// point but returns `{ bitmap: ImageBitmap, ... }` instead of a
    /// `{ texture: GPUTexture, textureId, ... }` pair. Internally:
    ///   1. Renders Vello's scene into a private `Rgba8Unorm`
    ///      `wgpu::Texture` (same path as the live call).
    ///   2. Blits that texture to a fresh `Bgra8Unorm`
    ///      `OffscreenCanvas` surface frame.
    ///   3. `surface.present()` → `canvas.transferToImageBitmap()` →
    ///      hands the bitmap to JS.
    ///
    /// Used by `apps/electrobun/src/game/render/spike-bitmap-bridge.ts`
    /// to measure `vello_ms` and `upload_ms` for the cross-device
    /// (independent Pixi `GPUDevice`) bitmap import path before
    /// committing to the broader Vello → ImageBitmap migration.
    ///
    /// Delete this entry point once the spike validates Option B.
    #[wasm_bindgen(js_name = "renderSwfStripRangeAccessorizedBitmap")]
    pub fn render_swf_strip_range_accessorized_bitmap(
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
        char_dir_suffix: String,
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
                "renderSwfStripRangeAccessorizedBitmap: parallel array length mismatch"
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
                continue;
            };
            let Some(acc_sym) = acc_doc.lookup_export(&acc_exports[i]) else {
                continue;
            };
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
                "renderSwfStripRangeAccessorizedBitmap: strip {strip_w}x{strip_h} exceeds GPU limits"
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
        // Phase 1: persistent per-bundle cache shared across bakes.
        let cache: &swf_spike::render::cache::RenderCache = self
            .swf_render_caches
            .entry(bundle.to_string())
            .or_default();
        let player_colors = self.swf_player_colors;
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
                cache,
                &accessories,
                apply_b_fix,
            );
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_swf_strip_acc_bitmap_spike"),
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
            console_log!("renderSwfStripRangeAccessorizedBitmap: render error: {e}");
            return JsValue::NULL;
        }

        // Bridge: Rgba8Unorm texture → Bgra8Unorm OffscreenCanvas → ImageBitmap.
        if self.blit_bgra_pipeline.is_none() {
            self.blit_bgra_pipeline = Some(bitmap_bridge::BlitPipeline::new(
                &self.device,
                wgpu::TextureFormat::Bgra8Unorm,
            ));
        }
        if self.bridge_canvas_pool.is_none() {
            self.bridge_canvas_pool = Some(
                match bitmap_bridge::BridgeCanvasPool::new(
                    &self.instance,
                    &self.device,
                    strip_w,
                    strip_h,
                ) {
                    Ok(p) => p,
                    Err(e) => {
                        console_log!(
                            "renderSwfStripRangeAccessorizedBitmap: pool init error: {e:?}"
                        );
                        return JsValue::NULL;
                    }
                },
            );
        }
        let blit = self.blit_bgra_pipeline.as_ref().unwrap();
        let pool = self.bridge_canvas_pool.as_mut().unwrap();
        let bitmap = match bitmap_bridge::render_texture_to_bitmap(
            pool,
            &self.device,
            &self.queue,
            blit,
            &texture,
            strip_w,
            strip_h,
        ) {
            Ok(b) => b,
            Err(e) => {
                console_log!(
                    "renderSwfStripRangeAccessorizedBitmap: bridge error: {e:?}"
                );
                return JsValue::NULL;
            }
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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

        // Phase 1: persistent per-bundle cache. Tile static bases bake
        // once per tile per session but they share shape geometry
        // (shapes referenced by both static and dynamic phases). Same
        // cache is reused by the dynamic strip path below.
        let cache: &swf_spike::render::cache::RenderCache = self
            .swf_render_caches
            .entry(bundle.to_string())
            .or_default();
        let mut classification_cache = std::collections::HashMap::new();
        let mut scene = vello::Scene::new();
        swf_spike::render::phased::render_symbol_phased(
            doc,
            symbol,
            &mut scene,
            xform,
            swf_spike::render::phased::RenderPhase::StaticOnly,
            swf_spike::swf_doc::OwnedColorTransform::IDENTITY,
            cache,
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

        let Some(bitmap) =
            self.texture_to_bitmap(&texture, frame_w, frame_h, "renderSwfTileStaticBase")
        else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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

        // Phase 1: persistent per-bundle cache.
        let cache: &swf_spike::render::cache::RenderCache = self
            .swf_render_caches
            .entry(bundle.to_string())
            .or_default();
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
                cache,
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

        let Some(bitmap) = self.texture_to_bitmap(
            &texture,
            strip_w,
            strip_h,
            "renderSwfTileDynamicStripRange",
        ) else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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

        let Some(bitmap) =
            self.texture_to_bitmap(&texture, total_w, total_h, "renderSwfBundleBatch")
        else {
            return JsValue::NULL;
        };

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
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
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

    /// Drop a previously-allocated render output texture by id.
    /// Tile-pass outputs are allocated fresh per dispatch; the caller
    /// holds a Pixi `Texture` referencing the GPUTexture handle, and
    /// frees the underlying storage by id once Pixi has uploaded the
    /// next tick's frame. `tex_id` is taken as `f64` since wasm-bindgen
    /// marshals JS numbers as f64 — internally cast to u64 to match the
    /// `next_texture_id` counter.
    ///
    /// The patched wgpu fork (`rust/wgpu/`) has a no-op `Drop` for
    /// `WebTexture` — see `feedback_pixi_wgpu_texture_lifetime`. So
    /// just removing the entry from the map only releases Rust's
    /// handle, NOT the GPU storage. We have to call `texture.destroy()`
    /// explicitly, which forwards to `GPUTexture.destroy()` on the
    /// browser side and frees the actual VRAM. Without this every
    /// retired strip leaks ~0.5-1 MB of GPU memory and Path B's cache
    /// cap can't bound real memory at all (the JS-side cache evicts
    /// + reallocates, but the freed strips stay resident).
    #[wasm_bindgen(js_name = "freeRenderTexture")]
    pub fn free_render_texture(&mut self, tex_id: f64) {
        if let Some(tex) = self.textures.remove(&(tex_id as u64)) {
            tex.destroy();
        }
    }

    /// Diagnostics: how many `wgpu::Texture`s we hold in
    /// `self.textures` (every render target the Vello side has
    /// outstanding). Useful for cross-checking the JS-side
    /// `liveRenderTextureIds` set.
    #[wasm_bindgen(js_name = "rustTexturesCount")]
    pub fn rust_textures_count(&self) -> u32 {
        self.textures.len() as u32
    }

    /// Diagnostics: WASM linear-memory size in bytes. Tracks how
    /// much memory the Rust side itself is consuming (excluding GPU
    /// resources, which live in the browser GPU process).
    #[wasm_bindgen(js_name = "wasmHeapBytes")]
    pub fn wasm_heap_bytes(&self) -> f64 {
        // Each WASM page is 64 KiB. `wasm_bindgen::memory()` returns
        // a `JsValue` for the WebAssembly.Memory; the easier path is
        // to just expose `core::arch::wasm32::memory_size`.
        #[cfg(target_arch = "wasm32")]
        {
            let pages = core::arch::wasm32::memory_size(0) as f64;
            pages * 65536.0
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            0.0
        }
    }

    /// Step-11 deferred-destroy tick. JS calls this once per Pixi
    /// shared-ticker tick. It advances the patched-fork's frame
    /// counter and calls `GPUTexture.destroy()` /
    /// `GPUBuffer.destroy()` on every Rust-side wgpu resource that
    /// was dropped at least `min_age_frames` ticks ago — past
    /// WebGPU's submission completion window, so destroying now is
    /// safe.
    ///
    /// `max_destroys_per_tick` caps the per-tick destroy count so a
    /// burst (anim transitions, cache evictions) doesn't stall a
    /// single rAF.
    ///
    /// Returns `[texturesDestroyed, buffersDestroyed,
    /// texturesPending, buffersPending]` for diagnostics.
    #[wasm_bindgen(js_name = "tickDeferredDestroys")]
    pub fn tick_deferred_destroys(
        &mut self,
        min_age_frames: u32,
        max_destroys_per_tick: u32,
    ) -> Vec<u32> {
        use wgpu::backend::webgpu::deferred_destroy;
        let (tex_destroyed, buf_destroyed) =
            deferred_destroy::tick_deferred_destroys(
                min_age_frames,
                max_destroys_per_tick,
            );
        let (tex_pending, buf_pending) = deferred_destroy::pending_counts();
        vec![
            tex_destroyed,
            buf_destroyed,
            tex_pending as u32,
            buf_pending as u32,
        ]
    }

    /// Memory accounting snapshot from the patched-wgpu fork. Returns
    /// a `Float64Array` of 8 values in this order:
    /// `[liveTexBytes, liveBufBytes, createdTexBytes, createdBufBytes,
    ///   destroyedTexBytes, destroyedBufBytes, pendingTexBytes,
    ///   pendingBufBytes]`.
    ///
    /// `live*` = currently allocated GPU memory referenced by the
    /// Rust side (incremented on `device.create_texture` /
    /// `create_buffer`, decremented on `destroy()`).
    /// `created*` / `destroyed*` = cumulative running totals.
    /// `pending*` = bytes in the deferred-destroy queue waiting for
    /// their 2-tick settle.
    #[wasm_bindgen(js_name = "rustGpuByteStats")]
    pub fn rust_gpu_byte_stats(&self) -> Vec<f64> {
        use wgpu::backend::webgpu::deferred_destroy;
        let (lt, lb, ct, cb, dt, db, pt, pb) = deferred_destroy::byte_stats();
        vec![
            lt as f64, lb as f64, ct as f64, cb as f64, dt as f64, db as f64,
            pt as f64, pb as f64,
        ]
    }

    /// For an accessory (bundle/export at slot+dir+side), return the
    /// SMALLEST `animType` value (in 0..=anim_type) whose
    /// 3-cycle frame sequence is identical to the one queried.
    ///
    /// Purpose: many accessories don't actually animate by anim_type
    /// — e.g. helmets, capes, shields that look identical in static
    /// / walk / run. The JS-side accessory cache key includes
    /// `animType`, so without dedup such accessories get cached
    /// three times. By calling this function before keying, the JS
    /// can normalise `animType` to its canonical value and collapse
    /// the duplicates. Empirically this cuts ~50% of accessory
    /// cache entries at 200-bot stress (per snapshot 11: 5780 →
    /// expected ~3000).
    ///
    /// Returns the input `anim_type` unchanged on lookup failure
    /// (bundle/export not loaded) so the caller still produces a
    /// usable key.
    #[wasm_bindgen(js_name = "swfAccessoryCanonicalAnimType")]
    pub fn swf_accessory_canonical_anim_type(
        &self,
        acc_bundle: &str,
        acc_export: &str,
        slot: u32,
        dir: &str,
        side: &str,
        anim_type: u32,
    ) -> u32 {
        let Some(acc_doc) = self.swf_bundles.get(acc_bundle) else {
            return anim_type;
        };
        let Some(acc_sym) = acc_doc.lookup_export(acc_export) else {
            return anim_type;
        };
        let dir_char = dir.chars().next().unwrap_or('R').to_ascii_uppercase();
        let dir_str = dir_char.to_string();
        let side_str = if side.is_empty() { dir_str.clone() } else { side.to_string() };
        let slot_u8 = slot as u8;
        let anim_type_u8 = anim_type as u8;

        // Frame sequence at the queried anim_type.
        let target: [u16; 3] = [
            swf_spike::render::pick_accessory_frame(
                acc_doc, acc_sym, slot_u8, anim_type_u8, &side_str, 0,
            ),
            swf_spike::render::pick_accessory_frame(
                acc_doc, acc_sym, slot_u8, anim_type_u8, &side_str, 1,
            ),
            swf_spike::render::pick_accessory_frame(
                acc_doc, acc_sym, slot_u8, anim_type_u8, &side_str, 2,
            ),
        ];

        // Walk smaller anim_types looking for an identical sequence.
        for try_at in 0..anim_type_u8 {
            let candidate: [u16; 3] = [
                swf_spike::render::pick_accessory_frame(
                    acc_doc, acc_sym, slot_u8, try_at, &side_str, 0,
                ),
                swf_spike::render::pick_accessory_frame(
                    acc_doc, acc_sym, slot_u8, try_at, &side_str, 1,
                ),
                swf_spike::render::pick_accessory_frame(
                    acc_doc, acc_sym, slot_u8, try_at, &side_str, 2,
                ),
            ];
            if candidate == target {
                return try_at as u32;
            }
        }
        anim_type
    }

    /// Diagnostic: counts for non-byte-sized GPU objects (bind
    /// groups, texture views, samplers). Returns 9 values:
    /// `[liveBg, createdBg, droppedBg,
    ///   liveTv, createdTv, droppedTv,
    ///   liveSa, createdSa, droppedSa]`.
    ///
    /// `live_* = created_* - dropped_*`. If `live_*` climbs without
    /// bound during stress, the wgpu Rust side is holding handles
    /// past their useful lifetime — pointing to a leak.
    #[wasm_bindgen(js_name = "rustGpuObjectCounts")]
    pub fn rust_gpu_object_counts(&self) -> Vec<f64> {
        use wgpu::backend::webgpu::deferred_destroy;
        let (lbg, cbg, dbg, ltv, ctv, dtv, lsa, csa, dsa) =
            deferred_destroy::object_counts();
        vec![
            lbg as f64, cbg as f64, dbg as f64,
            ltv as f64, ctv as f64, dtv as f64,
            lsa as f64, csa as f64, dsa as f64,
        ]
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

    /// Enumerate every named export in a loaded SWF bundle. Used by
    /// the stress test (and any other "all available accessories"
    /// caller) to build content pools dynamically from what's actually
    /// loaded instead of relying on a hand-curated list. Returns an
    /// empty array if the bundle isn't loaded.
    #[wasm_bindgen(js_name = "swfBundleExports")]
    pub fn swf_bundle_exports(&self, bundle: &str) -> Vec<String> {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return Vec::new();
        };
        let mut names: Vec<String> = doc.by_name.keys().cloned().collect();
        names.sort();
        names
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
        // Patched-wgpu Drop is a no-op — destroy explicitly so VRAM
        // actually releases (e.g. on map transition / hot-reload).
        for (_, tex) in self.textures.drain() {
            tex.destroy();
        }
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
    ///   - `swf_render_caches` (per-bundle `RenderCache`): shape
    ///     command tessellation, morph interpolations, sprite frame-
    ///     state walks. Populated by EVERY SWF bake (body atlas,
    ///     accessory strip, tile static, tile dynamic, strip-range-
    ///     accessorized). Per-bundle keying side-steps shape-id
    ///     collisions across bundles (g1/shape 5 ≠ player10/shape 5).
    ///   - `tile_subscenes`: pre-encoded `vello::Scene` per
    ///     `(bundle, export, frame)` used by `setStaticTilePlacements`
    ///     + `renderTilePass` to memcpy-append cached tile geometry.
    ///
    /// Memory bytes are estimates — Vello scenes don't expose encoded
    /// size, so we count entries × heuristic constant (~8 KB per
    /// typical tile sub-scene). Use the entry count for hit-rate
    /// validation; bytes for capacity-planning only.
    ///
    /// Returns `{ bundleCacheCount, sceneCacheCount, sceneBytesEstimate,
    /// bodySceneCacheCount }`.
    #[wasm_bindgen(js_name = "pathCacheStats")]
    pub fn path_cache_stats(&self) -> JsValue {
        const SCENE_BYTES_ESTIMATE: usize = 8 * 1024;
        let scene_count = self.tile_subscenes.len();
        let bundle_count = self.swf_render_caches.len();
        let body_scene_count = self.body_scene_cache.len();
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
        // Phase 1b body-scene cache size. Soft-capped at
        // `BODY_SCENE_CACHE_CAP` (1500); steady-state count under the
        // cap means no eviction pressure, over the cap means random
        // eviction is firing.
        let _ = js_sys::Reflect::set(
            &result,
            &"bodySceneCacheCount".into(),
            &JsValue::from(body_scene_count as u32),
        );
        result.into()
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
        self.swf_render_caches.clear();
        self.body_scene_cache.clear();
    }
}
