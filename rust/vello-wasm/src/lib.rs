use std::collections::HashMap;

use dofasset_renderer::format::{self, DofAsset};
use dofasset_renderer::scene_builder::{self, AccessoryScene};
use vello::peniko::Color;
use vello::{AaConfig, Renderer, RendererOptions, wgpu};
use wasm_bindgen::prelude::*;

mod bake_telemetry;
mod bitmap_bridge;
mod scene_cache;
mod slab_crowd;

// Multi-core scene build (threaded wasm build only). Re-exports
// `initThreadPool(n)` to JS — must be awaited after wasm init, before
// any parallel render call.
#[cfg(feature = "threads")]
pub use wasm_bindgen_rayon::init_thread_pool;

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
fn resolve_only_root_layer(doc: &swf_spike::swf_doc::SwfDoc) -> Option<ResolvedIconLayer<'_>> {
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

/// One equipped accessory in a player look.
struct LookAcc {
    bundle: String,
    export: String,
    slot: u8,
    anim_type: u8,
}

/// A player in the animated crowd. `sig` is the look signature
/// (everything but the animation frame) used as the retained-encoding
/// cache key prefix — two players whose sig + frame match share one
/// encoded sub-scene.
struct AnimPlayer {
    bundle: String,
    export: String,
    frame_count: u16,
    fps: f32,
    colors: swf_spike::recolor::PlayerColors,
    flipped: bool,
    x: f64,
    y: f64,
    acc: Vec<LookAcc>,
    sig: String,
    /// Explicit current frame (LIVE path). Used in place of the global-clock
    /// derivation when `RealAnimCrowd::explicit_frames` is set (driven by
    /// `crowdUpdateFrames`). Lets the crowd track each player's real animation
    /// frame instead of free-running on a shared clock.
    frame: u16,
}

/// Stateful animated Vello-direct crowd. Two render modes:
///   - `retain = false`: NAIVE — every tick re-emits every player's full
///     look from scratch into one scene (the pure Flash-redraw model).
///   - `retain = true`: RETAINED — encode each unique `(sig, frame)` look
///     ONCE into `look_cache`, then per tick just `scene.append` the cached
///     encoding at each player's transform (the "Flash display list" model).
struct RealAnimCrowd {
    players: Vec<AnimPlayer>,
    off_x: f64,
    off_y: f64,
    tw: u32,
    th: u32,
    scale: f64,
    pos_scale: f64,
    retain: bool,
    /// LIVE path: once `crowdUpdateFrames` has been called, render uses each
    /// player's explicit `frame` rather than deriving it from a global clock.
    explicit_frames: bool,
    look_cache: HashMap<String, vello::Scene>,
    /// Last render-frame each `look_cache` key was used. Drives LRU
    /// eviction: with fully-random bot colours (the stress generator) the
    /// `(sig|frame)` key space is effectively unbounded, so without a cap
    /// `look_cache` grew to tens of thousands of `vello::Scene`s and
    /// exhausted the wasm heap (silent `unreachable` abort). Entries not
    /// used within `LOOK_KEEP_FRAMES`, plus an oldest-first backstop at
    /// `LOOK_CACHE_CAP`, are pruned each render.
    look_used: HashMap<String, u64>,
    /// Monotonic render counter for `look_used` stamps.
    crowd_frame: u64,
    target: wgpu::Texture,
    view: wgpu::TextureView,
    /// Batched-render scratch (created on demand by `realCrowdRenderBatched`
    /// when actor count exceeds the single-scene ceiling). One texture per
    /// batch of `batch_size` actors + one composite-target view. Reused
    /// across frames so the render loop doesn't leak GPU textures.
    batch_size: u32,
    batch_targets: Vec<wgpu::Texture>,
    batch_views: Vec<wgpu::TextureView>,
    /// RETAINED-VELLO (Phase 2): per-batch cached recording + resident scene
    /// buffer state. `None` until the batch is first resolved; invalidated when
    /// the batch grid or structure changes. Index aligns with `batch_views`.
    retained_batches: Vec<Option<RetainedBatch>>,
    /// RETAINED-VELLO v1+v2 (Phase 3): baked looks keyed by sig, and per-batch
    /// retained state for `realCrowdRenderRetained`.
    retained_look_cache: HashMap<String, RetainedLook>,
    ret_batches: Vec<Option<RetBatch>>,
    /// Two ping-pong scratch targets for the multi-pass composite when there are
    /// more than `MAX_COMPOSITE_SRC` batches. Allocated lazily.
    composite_scratch: Vec<wgpu::Texture>,
    composite_scratch_views: Vec<wgpu::TextureView>,
}

/// LRU ceiling for `look_cache`, used ONLY by the legacy batch path,
/// which must keep a full `vello::Scene` per `(sig|frame)` to re-append
/// and re-resolve every frame — inherently heavy and non-scaling. The
/// slab path does NOT use `look_cache`: it interns compact bytes once and
/// keeps only a tiny `SubHandle` (see `slab_crowd`), so it needs no cap
/// (the SubLibrary grows to fit, exactly like the Bevy/wc3 side). This
/// cap is just a safety net so a large batch-mode run degrades to cache
/// thrash instead of OOM-freezing the tab during an A/B comparison.
const LOOK_CACHE_CAP: usize = 12_000;

/// Per-frame wall-clock budget for baking + interning newly-seen crowd
/// looks on the slab path. Bakes beyond this are deferred to later frames
/// (the actor is simply not drawn that frame), trading a brief pop-in for
/// a steady frame rate when a burst of new looks appears. Zero cost once
/// the working set is warm.
const SLAB_BAKE_BUDGET_MS: f64 = 4.0;

/// When the SubLibrary's packed bytes pass this, drop ALL interns + the
/// handle cache and let the live frame re-intern its active set. A crowd
/// of fully-unique actors cycling every direction/frame has an unbounded
/// cumulative look set (it can exceed the 1 GiB SubLibrary cap, after
/// which new looks intern as sentinels and their actors vanish). The
/// per-frame bake budget + per-signature fallback keep the crowd visible
/// across the refill. Kept well under the 1 GiB hard cap; for ordinary
/// play (bounded look set) it never trips.
const SLAB_SUBLIB_RESET_BYTES: u64 = 384 * 1024 * 1024;
/// Keep any look used within this many render frames regardless of cap
/// (~4 s at 60 fps — two walk cycles). Older entries are the first
/// evicted when over `LOOK_CACHE_CAP`.
const LOOK_KEEP_FRAMES: u64 = 240;

impl RealAnimCrowd {
    /// Stamp this frame's used look keys and evict stale/overflow entries.
    /// Called once per render with the keys touched this frame. Keeps the
    /// active working set hot; bounds memory under unbounded colour churn.
    fn note_used_and_prune(&mut self, used_keys: &[String]) {
        self.crowd_frame += 1;
        let frame = self.crowd_frame;
        for k in used_keys {
            self.look_used.insert(k.clone(), frame);
        }
        if self.look_cache.len() <= LOOK_CACHE_CAP {
            return;
        }
        // Disjoint field borrows so the retain closure can read look_used
        // while mutating look_cache.
        let Self {
            look_cache,
            look_used,
            ..
        } = self;
        let keep_after = frame.saturating_sub(LOOK_KEEP_FRAMES);
        look_cache.retain(|k, _| look_used.get(k).copied().unwrap_or(0) >= keep_after);
        look_used.retain(|k, _| look_cache.contains_key(k));
        if look_cache.len() > LOOK_CACHE_CAP {
            // Backstop: the live working set itself exceeds the cap (e.g.
            // 500+ fully-unique bots). Drop oldest-stamped first.
            let mut by_age: Vec<(u64, String)> =
                look_used.iter().map(|(k, &f)| (f, k.clone())).collect();
            by_age.sort_unstable_by_key(|(f, _)| *f);
            let excess = look_cache.len() - LOOK_CACHE_CAP;
            for (_, k) in by_age.into_iter().take(excess) {
                look_cache.remove(&k);
                look_used.remove(&k);
            }
        }
    }
}

/// Cached per-batch state for the retained render path. The packed scene buffer
/// lives GPU-resident inside the `Renderer` (keyed by the batch's [`vello::ReuseToken`]);
/// this holds the CPU-side handles needed to REPLAY the recording with only the
/// transform region re-uploaded.
struct RetainedBatch {
    /// Replayable recording (scene buffer bound externally each run).
    recording: vello::low_level::Recording,
    /// Scene buffer proxy — its id is bound to the resident GPU buffer.
    scene_buf: vello::low_level::ResourceProxy,
    /// Fine-stage output image proxy (bound to the batch target view each run).
    out_image: vello::low_level::ResourceProxy,
    /// Transform-region bytes captured at resolve time — for the fixed-position
    /// fast path (rewrite identical transforms, skipping rebuild + resolve).
    frozen_transform_bytes: Vec<u8>,
    /// Hash of the batch's `(sig, frame)` set — mismatch forces a full rebuild.
    structure_sig: u64,
}

/// RETAINED-VELLO v1+v2: a fully-baked look ready for the retained render path.
/// Geometry (path_tags/draw_data/styles + non-morph path_data) is frame-invariant and
/// kept GPU-resident; per frame we re-upload only transforms (always) and, for morph
/// looks, the changed path_data. `retainable=false` (path_data length or transform
/// count varies across frames — structural appear/disappear) falls back to the baseline
/// per-frame lane.
struct RetainedLook {
    /// Frame-0 look — appended to a batch to establish the resident geometry + byte layout.
    base_scene: vello::Scene,
    /// Per-frame local transform streams (length constant across frames == base tx count).
    frames_transforms: Vec<Vec<vello_encoding::Transform>>,
    /// Distinct path_data geometries across the cycle (1 entry for v1/non-morph).
    unique_path_data: Vec<Vec<u32>>,
    /// frame -> index into `unique_path_data`.
    frame_geom: Vec<u16>,
    /// `unique_path_data.len() > 1` — needs per-frame path_data re-upload.
    is_morph: bool,
    /// false -> path_data length / transform count varies across frames -> baseline lane.
    retainable: bool,
}

/// One player inside a retained batch: where its sub-streams live in the resident
/// packed buffer, so we can partial-write its transforms + (morph) path_data.
struct RetPlayer {
    /// Index into `crowd.players`.
    crowd_idx: usize,
    /// Word offset of this player's path_data within the batch path_data region.
    pd_word_start: u32,
    /// Transform-index offset of this player within the batch transform region.
    tx_index_start: u32,
    is_morph: bool,
    /// Geometry index currently resident for this player (-1 = none yet).
    resident_geom: i32,
}

/// Per-batch retained state: the cached recording + resident layout + per-player offsets.
struct RetBatch {
    recording: vello::low_level::Recording,
    scene_buf: vello::low_level::ResourceProxy,
    out_image: vello::low_level::ResourceProxy,
    path_data_base_words: u32,
    transform_base_words: u32,
    players: Vec<RetPlayer>,
    /// Hash of the batch's player sigs — mismatch (spawn/despawn/anim/dir) forces rebuild.
    structure_sig: u64,
    /// Reused per-frame transform-region scratch.
    tx_scratch: Vec<u8>,
}

/// Bake a look across ALL its animation frames into a [`RetainedLook`]: captures
/// per-frame transform streams, dedups path_data geometries, and classifies the look
/// as retainable (path_data length + transform count constant across frames) or not.
#[allow(clippy::too_many_arguments)]
fn bake_retained_look(
    ctx: &mut swf_spike::render::WgpuCtx,
    bundles: &HashMap<String, swf_spike::swf_doc::SwfDoc>,
    caches: &HashMap<String, swf_spike::render::cache::RenderCache>,
    bundle: &str,
    export: &str,
    frame_count: u16,
    flipped: bool,
    colors: swf_spike::recolor::PlayerColors,
    acc: &[LookAcc],
    scale_aff: vello::kurbo::Affine,
) -> RetainedLook {
    use std::hash::{Hash, Hasher};
    let fc = frame_count.max(1);
    let mut frames_transforms: Vec<Vec<vello_encoding::Transform>> =
        Vec::with_capacity(fc as usize);
    let mut pd_per_frame: Vec<Vec<u32>> = Vec::with_capacity(fc as usize);
    let mut base_scene = vello::Scene::new();
    let mut tx_count0 = 0usize;
    let mut pd_len0 = 0usize;
    let mut length_stable = true;
    for f in 0..fc {
        let mut sub = vello::Scene::new();
        emit_player_look(
            ctx, bundles, caches, bundle, export, f, flipped, colors, acc, scale_aff, &mut sub,
        );
        {
            let enc = sub.encoding();
            frames_transforms.push(enc.transforms.clone());
            pd_per_frame.push(enc.path_data.clone());
            if f == 0 {
                tx_count0 = enc.transforms.len();
                pd_len0 = enc.path_data.len();
            } else if enc.transforms.len() != tx_count0 || enc.path_data.len() != pd_len0 {
                length_stable = false;
            }
        }
        if f == 0 {
            base_scene = sub;
        }
    }
    if !length_stable {
        // Not retainable — drop the heavy per-frame data; the baseline lane handles it.
        return RetainedLook {
            base_scene,
            frames_transforms: Vec::new(),
            unique_path_data: Vec::new(),
            frame_geom: Vec::new(),
            is_morph: false,
            retainable: false,
        };
    }
    // Dedup path_data geometries (1 entry for non-morph; N for morphs).
    let mut unique_path_data: Vec<Vec<u32>> = Vec::new();
    let mut hash_to_idx: HashMap<u64, u16> = HashMap::new();
    let mut frame_geom: Vec<u16> = Vec::with_capacity(fc as usize);
    for pd in &pd_per_frame {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        pd.hash(&mut h);
        let key = h.finish();
        let idx = *hash_to_idx.entry(key).or_insert_with(|| {
            unique_path_data.push(pd.clone());
            (unique_path_data.len() - 1) as u16
        });
        frame_geom.push(idx);
    }
    let is_morph = unique_path_data.len() > 1;
    RetainedLook {
        base_scene,
        frames_transforms,
        unique_path_data,
        frame_geom,
        is_morph,
        retainable: true,
    }
}

/// RETAINED-VELLO v3 (union/hide): bake a look that would be length-VARYING
/// (appear/disappear) into a length-STABLE [`RetainedLook`]. Captures every leaf
/// per frame (by depth-path identity), takes the union across the cycle, and
/// re-emits ALL union leaves every frame in stable (sorted depth-path == z-order)
/// order with absent leaves at a scale-0 HIDE transform. The result has a constant
/// draw set, so the normal retained render path keeps it GPU-resident. Morph slots'
/// path_data still varies per frame (handled by the v2 path_data writes).
#[allow(clippy::too_many_arguments)]
fn bake_union_look(
    ctx: &mut swf_spike::render::WgpuCtx,
    bundles: &HashMap<String, swf_spike::swf_doc::SwfDoc>,
    caches: &HashMap<String, swf_spike::render::cache::RenderCache>,
    bundle: &str,
    export: &str,
    frame_count: u16,
    flipped: bool,
    colors: swf_spike::recolor::PlayerColors,
    acc: &[LookAcc],
    scale_aff: vello::kurbo::Affine,
) -> RetainedLook {
    use std::hash::{Hash, Hasher};
    use swf_spike::render::union;
    let fc = frame_count.max(1);

    // 1. Capture leaves per frame (render_shape_into records + skips emission).
    let mut per_frame: Vec<Vec<union::CapturedLeaf>> = Vec::with_capacity(fc as usize);
    for f in 0..fc {
        union::begin_capture();
        let mut throwaway = vello::Scene::new();
        emit_player_look(
            ctx,
            bundles,
            caches,
            bundle,
            export,
            f,
            flipped,
            colors,
            acc,
            scale_aff,
            &mut throwaway,
        );
        per_frame.push(union::take_capture());
    }
    // 2. Build the union (stable slot order).
    let plan = union::build_union(&per_frame);

    // 3. Re-emit the constant-structure union per frame, extract transforms + path_data.
    let mut frames_transforms: Vec<Vec<vello_encoding::Transform>> =
        Vec::with_capacity(fc as usize);
    let mut pd_per_frame: Vec<Vec<u32>> = Vec::with_capacity(fc as usize);
    let mut base_scene = vello::Scene::new();
    for f in 0..fc {
        let mut s = vello::Scene::new();
        union::emit_union_frame(&plan, f, &mut s);
        {
            let enc = s.encoding();
            frames_transforms.push(enc.transforms.clone());
            pd_per_frame.push(enc.path_data.clone());
        }
        if f == 0 {
            base_scene = s;
        }
    }
    let mut unique_path_data: Vec<Vec<u32>> = Vec::new();
    let mut hash_to_idx: HashMap<u64, u16> = HashMap::new();
    let mut frame_geom: Vec<u16> = Vec::with_capacity(fc as usize);
    for pd in &pd_per_frame {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        pd.hash(&mut h);
        let key = h.finish();
        let idx = *hash_to_idx.entry(key).or_insert_with(|| {
            unique_path_data.push(pd.clone());
            (unique_path_data.len() - 1) as u16
        });
        frame_geom.push(idx);
    }
    let is_morph = unique_path_data.len() > 1;
    RetainedLook {
        base_scene,
        frames_transforms,
        unique_path_data,
        frame_geom,
        is_morph,
        retainable: true,
    }
}

/// Emit one player's complete look into `out`: body bands interleaved
/// with equipped accessories at their REAL mount transforms + correct
/// direction frames, in scale-space with the SWF origin at (0,0).
/// Canonical band-interleave z-order (cape behind, hat in front).
/// Per-bundle caches are REQUIRED — a cache shared across bundles
/// collides symbol ids and yields bogus (giant/wrong) geometry.
/// Returns the number of accessories actually drawn.
#[allow(clippy::too_many_arguments)]
fn emit_player_look(
    ctx: &mut swf_spike::render::WgpuCtx,
    bundles: &HashMap<String, swf_spike::swf_doc::SwfDoc>,
    caches: &HashMap<String, swf_spike::render::cache::RenderCache>,
    bundle: &str,
    export: &str,
    frame: u16,
    flipped: bool,
    colors: swf_spike::recolor::PlayerColors,
    acc: &[LookAcc],
    base: vello::kurbo::Affine,
    out: &mut vello::Scene,
) -> u32 {
    use swf_spike::render::ctx::RenderMode;
    const MAX_SLOT: u8 = 5;
    let Some(doc) = bundles.get(bundle) else {
        return 0;
    };
    let Some(symbol) = doc.lookup_export(export) else {
        return 0;
    };
    let Some(body_cache) = caches.get(bundle) else {
        return 0;
    };
    let swf_spike::swf_doc::Symbol::Sprite(body_sprite) = symbol else {
        return 0;
    };
    let mut equipped: HashMap<
        u8,
        (
            &swf_spike::render::cache::RenderCache,
            &swf_spike::swf_doc::SwfDoc,
            &swf_spike::swf_doc::Symbol,
            u8,
        ),
    > = HashMap::new();
    for a in acc {
        let Some(adoc) = bundles.get(&a.bundle) else {
            continue;
        };
        let Some(asym) = adoc.lookup_export(&a.export) else {
            continue;
        };
        let Some(acache) = caches.get(&a.bundle) else {
            continue;
        };
        equipped.insert(a.slot, (acache, adoc, asym, a.anim_type));
    }
    let has_hat = equipped.contains_key(&1);
    let (effective_sym, effective_xform) =
        swf_spike::render::find_effective_body_symbol(doc, symbol, frame);
    let slots = swf_spike::render::extract_slot_depths(doc, body_sprite, frame);
    let (mount_mats, mount_pres) = swf_spike::render::mount_transforms::extract_mount_transforms(
        doc, symbol, frame, 1, flipped, MAX_SLOT,
    );
    let body_xform = base * effective_xform;
    let mut acc_drawn = 0u32;
    let n = slots.len();
    for i in 0..=n {
        let band = swf_spike::render::band_range(&slots, i);
        swf_spike::render::render_body_band(
            ctx,
            doc,
            effective_sym,
            out,
            body_xform,
            frame,
            band,
            RenderMode::Colour,
            colors,
            body_cache,
            flipped,
            has_hat,
        );
        if i < n {
            let sd = &slots[i];
            let slot_us = sd.slot as usize;
            if mount_pres.get(slot_us).copied().unwrap_or(0) == 1 {
                if let Some(&(acache, adoc, asym, at)) = equipped.get(&sd.slot) {
                    let off = slot_us * 6;
                    if off + 6 <= mount_mats.len() {
                        let m = vello::kurbo::Affine::new([
                            f64::from(mount_mats[off]),
                            f64::from(mount_mats[off + 1]),
                            f64::from(mount_mats[off + 2]),
                            f64::from(mount_mats[off + 3]),
                            f64::from(mount_mats[off + 4]),
                            f64::from(mount_mats[off + 5]),
                        ]);
                        let side = sd.side.as_deref().unwrap_or("R");
                        let acc_frame = swf_spike::render::pick_accessory_frame(
                            adoc, asym, sd.slot, at, side, frame,
                        );
                        swf_spike::render::render_symbol_with_shared_cache(
                            ctx,
                            adoc,
                            asym,
                            out,
                            base * m,
                            acc_frame,
                            swf_spike::recolor::PlayerColors::default(),
                            acache,
                        );
                        acc_drawn += 1;
                    }
                }
            }
        }
    }
    acc_drawn
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
    /// DIAG: stateful animated Vello-direct crowd (real players, real
    /// mounts, real positions). Holds per-player cached sub-scenes;
    /// `realCrowdTick` re-emits only frame-changed players. Used to
    /// measure the real ANIMATED per-frame cost over a long run.
    real_anim_crowd: Option<RealAnimCrowd>,
    /// DIAG: lazy single-pass compositor for the batched crowd render
    /// (folds all per-batch textures past the single-scene shape ceiling in
    /// ONE fullscreen pass instead of N sequential `over` passes).
    crowd_composite_pipeline: Option<bitmap_bridge::MultiCompositePipeline>,
    /// Tier-7 slab crowd state (interned-look render path; see `slab_crowd`).
    slab_crowd: slab_crowd::SlabCrowdState,
    /// Routes `realCrowdRenderBatched` through the slab path when set via
    /// `realCrowdSetSlab`. The batch/composite path stays the default.
    slab_mode: bool,
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
    /// Expected hit cost ~0.5-1 ms (rasterization floor) vs ~3-5 ms
    /// on miss. Most critical role: makes repeated zoom (e.g.
    /// 3 → 5 → 3) hit cache on return instead of rebaking from
    /// scratch — without this cache, the second visit to a prior
    /// zoom level costs the same as the first visit, and stress
    /// tests with frequent zoom changes saturate the bake queue.
    body_scene_cache: HashMap<BodySceneCacheKey, vello::Scene>,
    /// Lifetime counters for `body_scene_cache` (cumulative since
    /// renderer init). Surfaced via `bodySceneCacheStats()` so the
    /// architecture decision can verify whether the LRU is actually
    /// thrashing at 250-bot stress (the v3 "delete it" instinct
    /// depends on this — see RENDER_STATE.md v4).
    body_scene_cache_hits: u64,
    body_scene_cache_misses: u64,
    body_scene_cache_evictions: u64,
    /// Profiling accumulators for `build_class_variant_scene`, reset
    /// per class-atlas bake. `dbg_p1_ms` = Pass 1 (subscene
    /// build/emit + cache-key churn), `dbg_p2_ms` = Pass 2 (variant
    /// assembly via `scene.append`). Lets the `classAtlasBake` log
    /// split the `scene=` phase into emit vs assemble so we know
    /// whether the cold-bake cost is the SWF re-emit or the append
    /// copies. Temporary instrumentation.
    dbg_p1_ms: f64,
    dbg_p2_ms: f64,
    /// `renderSwfClassAtlas` bake-mode selector:
    ///   0 = AUTO (default): per-page when the packed atlas needs
    ///       ≤ 2 pages, per-variant when ≥ 3 pages. Measured crossover
    ///       (2026-05-25, headless Chrome, M-series): per-page is
    ///       1.3-5.2× faster for 1-2 page atlases (wall is ~flat 8-10 ms
    ///       independent of zoom) but ~2× SLOWER for 3-large-page
    ///       atlases (it rasterises each full page incl. shelf-pack
    ///       slack + encodes one huge multi-variant Vello scene per
    ///       page, whereas per-variant only renders the painted variant
    ///       rects).
    ///   1 = force per-variant (A/B + fallback).
    ///   2 = force per-page (A/B).
    /// Set via `setClassAtlasBakeMode(mode)`; the legacy
    /// `setClassAtlasForcePerVariant(bool)` maps true→1, false→2.
    class_atlas_bake_mode: u8,
    /// Phase 1c: scale-invariant per-(frame, band) sub-scene cache for
    /// the class atlas bake. Each entry is a `vello::Scene` produced
    /// by `render_body_band` with `transform = effective_xform`, so
    /// path coords are in twip space and `output_scale` is unused
    /// (the compute filter path is `cfg`-off on wasm32 — see
    /// `swf-spike/src/render/filter.rs:31-37`). Variant assembly
    /// composes the atlas via `scene.append(sub, scale.then_translate(target))`,
    /// which means a zoom change skips the entire scene-build phase
    /// and only pays the per-call append memcpy.
    ///
    /// Why per (frame, band) rather than per variant: per-variant
    /// caching at twip identity would need an internal twip-grid cell
    /// layout that doesn't pixel-snap after scaling. Per (frame, band)
    /// puts each cell at the cached origin and lets the assembly
    /// translate to a pixel-snapped target.
    body_subscene_cache: HashMap<BodySubsceneKey, vello::Scene>,
    /// Per-tile sub-scenes encoded at twip-identity. Keyed by
    /// `(bundle, export, frame)`. Built once per unique tile and
    /// re-used across cells (multiple cells share the same tile) AND
    /// across zoom levels (zoom only changes the per-cell matrix at
    /// composition time, NOT the sub-scene contents). This is what
    /// makes zoom re-render fast: we don't re-walk symbol trees, we
    /// just `scene.append(subscene, matrix)` for each placement.
    tile_subscenes: HashMap<(String, String, u32), vello::Scene>,
    /// Per-accessory sub-scenes encoded at twip-identity. Keyed by
    /// `(bundle, export, slot, anim_type, side, cycle)`. Built once
    /// per unique accessory cycle and re-used across zoom levels —
    /// the per-cycle scale × translate xform is applied at
    /// composition time. Same architecture as `tile_subscenes`;
    /// the population path is `render_swf_accessory_strip`.
    ///
    /// Before this cache existed, every `renderSwfAccessoryStrip`
    /// call ran 3 fresh AS2 walks (one per cycle) regardless of
    /// resolution — a zoom change with 250 bots × ~4 accessories
    /// each forced ~3000 redundant walks. With the cache, the AS2
    /// work runs at most once per cycle per accessory regardless
    /// of zoom changes.
    acc_subscenes: HashMap<scene_cache::AccessorySubsceneKey, vello::Scene>,
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

/// Body atlas scene cache key (Phase 1b). Resolution-keyed via
/// `scale_q` = `(scale × 1000).round() as u32`. Each (bundle, export,
/// start, count, mode, scale_q, apply_b_fix, hat_equipped) combo
/// produces one cached `vello::Scene`. Hit skips the entire
/// `build_scene` step; only `render_to_texture` + combine + bitmap
/// bridge still run on the hot path.
///
/// Why `scale_q` IS in the key: a previous attempt to drop it (cache
/// at twip identity, wrap with `Affine::scale(scale)` at render time)
/// produced visible per-cell sub-pixel drift because the wrapped
/// twip cells didn't land on the pixel atlas grid at all zoom
/// levels. Per-cell pixel-snapping requires baking `scale` into the
/// cell xform, which forces scale into the key. The cache is then
/// resolution-specific but the LRU window (cap 1500) is large enough
/// that recent zoom levels stay warm — zoom 3 → 5 → 3 hits cache on
/// the return, which is the dominant user pattern.
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

/// Phase 1c sub-scene cache key — see `body_subscene_cache`. Crucially
/// NO `scale_q`: sub-scenes are at twip-identity and are reused across
/// every zoom level. `band_lo` + `band_hi` are the `BandRange` fields
/// inlined to participate in `Hash` (the upstream `BandRange` doesn't
/// derive it). `compute_band_presence` is independent of `apply_b_fix`
/// and `hat_equipped`, so two variants of the same `(bundle, export)`
/// share band ranges and thus share cache entries on shared bands.
#[derive(Clone, PartialEq, Eq, Hash)]
struct BodySubsceneKey {
    bundle: String,
    export: String,
    apply_b_fix: bool,
    hat_equipped: bool,
    mode: u8,
    frame_idx: u16,
    band_lo: Option<u16>,
    band_hi: Option<u16>,
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
            (0, "B") | (0, "L") => &["L", "R"],
            (1, "R") | (1, "F") => &["R", "L"],
            (1, "B") | (1, "L") | (1, "S") => &["L", "R"],
            (2, "R") | (2, "F") => &["RR", "R", "L"],
            (2, "B") | (2, "L") => &["RL", "L", "R"],
            (2, _) => &["L", "R"],
            _ => &["R", "L"],
        },
        // Shield
        4 => match (anim_type, dir_suffix) {
            (0, "L") => &["L", "R"],
            (0, _) => &["R", "L"],
            (1, "F") | (1, "B") | (1, "L") => &["L", "R"],
            (1, _) => &["R", "L"],
            (2, "F") | (2, "L") => &["L", "R"],
            (2, _) => &["R", "L"],
            _ => &["R", "L"],
        },
        // Hat, weapon, pet, default: try dir_suffix, then common fallbacks
        _ => match dir_suffix {
            "R" => &["R", "S", "F"],
            "L" => &["L", "S", "F"],
            "F" => &["F", "S", "R"],
            "B" => &["B", "S", "L"],
            "S" => &["S", "R", "F"],
            _ => &["R", "L", "S"],
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
    let Some(info) = acc_info else {
        return Vec::new();
    };
    if info.len() < 2 {
        return Vec::new();
    }

    // Extract direction suffix for fallback (e.g., "walkR" → "R")
    let dir_suffix = if animation.len() >= 2 {
        &animation[animation.len() - 1..]
    } else {
        "S"
    };

    // Classify animation type: static, walk, or run
    let anim_type = if animation.starts_with("run") {
        2u8
    } else if animation.starts_with("static") {
        0
    } else {
        1
    }; // walk and everything else

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

        let Some(acc_asset) = assets.get(&acc_asset_id) else {
            continue;
        };

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
        let Some(resolved_anim) = resolved_anim else {
            continue;
        };

        let &anim_idx = acc_asset.animation_map.get(resolved_anim.as_str()).unwrap();
        let anim = &acc_asset.animations[anim_idx];
        if anim.frame_ids.is_empty() {
            continue;
        }

        let actual_frame = frame_index % anim.frame_ids.len();
        let scene = scene_builder::build_accessory_scene_unscaled(
            acc_asset,
            &resolved_anim,
            actual_frame,
            resolution,
        );

        // Use net offset (where Flash 0,0 actually lands in the rendered scene)
        // instead of SWF metadata offset. Same fix as character positioning —
        // eliminates ~0.5px discrepancy that displaces accessories.
        let global_fid = anim.frame_ids[actual_frame] as usize;
        let (offset_x, offset_y, acc_w, acc_h) =
            if let Some(acc_frame) = acc_asset.frames.get(global_fid) {
                let net = scene_builder::compute_net_offset(acc_frame, &acc_asset.transforms);
                (
                    -net.0, // negate: acc_local ADDS this to slot position
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
        required_limits.max_storage_buffer_binding_size =
            adapter_limits.max_storage_buffer_binding_size;
        console_log!(
            "VelloRenderer: maxTexDim2D={} maxBufSize={}",
            required_limits.max_texture_dimension_2d,
            required_limits.max_buffer_size
        );

        // DIAG: request TIMESTAMP_QUERY when the adapter advertises it so
        // JS can do real per-pass GPU profiling (timestampWrites in render
        // passes). Gated on adapter support so the device request can't
        // fail on browsers that don't expose it.
        let mut required_features = wgpu::Features::empty();
        let ts_supported = adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY);
        if ts_supported {
            required_features |= wgpu::Features::TIMESTAMP_QUERY;
        }
        console_log!(
            "VelloRenderer: timestamp-query adapter-supported={} requested={}",
            ts_supported,
            ts_supported
        );

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("vello-pixi-shared"),
                required_features,
                required_limits,
                ..Default::default()
            })
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
            real_anim_crowd: None,
            crowd_composite_pipeline: None,
            slab_crowd: slab_crowd::SlabCrowdState::default(),
            slab_mode: false,
            swf_filter_pipelines: None,
            swf_player_colors: swf_spike::recolor::PlayerColors::default(),
            swf_spell_instances: HashMap::new(),
            next_spell_instance_id: 1,
            swf_strip_bounds_cache: HashMap::new(),
            swf_render_caches: HashMap::new(),
            body_scene_cache: HashMap::new(),
            body_scene_cache_hits: 0,
            body_scene_cache_misses: 0,
            body_scene_cache_evictions: 0,
            dbg_p1_ms: 0.0,
            dbg_p2_ms: 0.0,
            // AUTO: per-page for ≤2-page atlases (the measured win),
            // per-variant for ≥3-page atlases. See field doc.
            class_atlas_bake_mode: 0,
            body_subscene_cache: HashMap::new(),
            tile_subscenes: HashMap::new(),
            acc_subscenes: HashMap::new(),
            class_enum_cache: HashMap::new(),
        };

        // Return { renderer, adapter, device, maxTextureSize }
        let result = js_sys::Object::new();
        js_sys::Reflect::set(&result, &"renderer".into(), &vello.into())?;
        js_sys::Reflect::set(&result, &"adapter".into(), &gpu_adapter)?;
        js_sys::Reflect::set(&result, &"device".into(), &gpu_device)?;
        js_sys::Reflect::set(
            &result,
            &"maxTextureSize".into(),
            &JsValue::from(adapter_limits.max_texture_dimension_2d),
        )?;

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
                self.swf_strip_bounds_cache.retain(|(b, _, _), _| b != name);
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
            match bitmap_bridge::BridgeCanvasPool::new(&self.instance, &self.device, width, height)
            {
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
            pool,
            &self.device,
            &self.queue,
            blit,
            texture,
            width,
            height,
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
        let bake_start = perf_now();
        bake_telemetry::subscene_reset();
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

        // Lazily init the filter pipelines (compute shader compilation isn't
        // free — defer until the first SWF render that might need them).
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }

        // Twip-identity sub-scene cache: a tile's scene at
        // `xform = Affine::IDENTITY` is reusable across every zoom
        // level. The final scene is assembled by appending the cached
        // sub-scene under `xform = scale.then_translate(-px_min)` —
        // identical output to building inline because `scene.append`
        // pre-multiplies its xform over every transform in the child
        // encoding. This makes a zoom change zero-CPU on the second
        // tile call (only the cheap GPU rasterize remains).
        //
        // Tiles ignore `swf_player_colors` (no zoned sprites), so
        // the key is just `(bundle, export, frame)`.
        let sub_key = (bundle.to_string(), export.to_string(), frame);
        let sub_was_hit = self.tile_subscenes.contains_key(&sub_key);
        if sub_was_hit {
            bake_telemetry::subscene_hit();
        } else {
            bake_telemetry::subscene_miss();
            let mut sub_scene = vello::Scene::new();
            {
                let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
                let mut ctx = swf_spike::render::WgpuCtx {
                    device: &self.device,
                    queue: &self.queue,
                    renderer: &mut self.renderer,
                    filter_pipelines,
                    // Twip-identity render: no `output_scale` because
                    // the inner filter compute path is `cfg`-off on
                    // wasm32 (see swf-spike/src/render/filter.rs).
                    output_scale: 1.0,
                };
                swf_spike::render::render_symbol_with_ctx_tinted(
                    &mut ctx,
                    doc,
                    symbol,
                    &mut sub_scene,
                    vello::kurbo::Affine::IDENTITY,
                    frame as u16,
                    self.swf_player_colors,
                );
            }
            self.tile_subscenes.insert(sub_key.clone(), sub_scene);
        }
        let mut scene = vello::Scene::new();
        let sub_ref = self.tile_subscenes.get(&sub_key).expect("ensured above");
        scene.append(sub_ref, Some(xform));

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
        {
            let (hits, misses) = bake_telemetry::subscene_take();
            bake_telemetry::Builder::new(bake_telemetry::BakeKind::TileFrame, bundle)
                .total(perf_now() - bake_start)
                .subscene(hits, misses)
                .pixel_area(u64::from(w) * u64::from(h))
                .sub_count(1)
                .commit();
        }
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
    pub fn render_swf_spell_strip(&mut self, bundle: &str, resolution: f32) -> JsValue {
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
            console_log!("renderSwfSpellStrip: degenerate bounds across all frames for {bundle}");
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
            console_log!("renderSwfSpellStrip: {strip_w}x{strip_h} exceeds GPU limits");
            return JsValue::NULL;
        }

        // Lazily init filter pipelines — spells with DropShadow/Glow/Blur
        // will route through `apply_compute` on native, halo on WASM (per
        // the cfg-gate in `swf_spike::render::filter::apply`).
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }
        let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();

        // Wrap the doc's root timeline as a Symbol::Sprite — AvmRenderer
        // expects to walk from root, and a spell SWF's root just places
        // the main sprite at depth 1. Capture the SWF header fps here so
        // we can drop the `doc` borrow before the `&mut self`
        // `texture_to_bitmap` call below.
        let root_sym = swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());
        let doc_frame_rate = doc.frame_rate;

        let mut renderer = swf_spike::render_avm1::AvmRenderer::new(doc.root.num_frames);
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
            let xform = vello::kurbo::Affine::scale(scale).then_translate(vello::kurbo::Vec2::new(
                -px_min_x + cell_x,
                -px_min_y + cell_y,
            ));

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

        let Some(bitmap) =
            self.texture_to_bitmap(&texture, strip_w, strip_h, "renderSwfSpellStrip")
        else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(&result, &"gridCols".into(), &JsValue::from(cols as u32));
        let _ = js_sys::Reflect::set(
            &result,
            &"frameCount".into(),
            &JsValue::from(frame_count as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        // SWF header fps so the runtime can advance at the right rate.
        let _ = js_sys::Reflect::set(&result, &"fps".into(), &JsValue::from(doc_frame_rate));
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
            back_bundle,
            up_bundle,
            bc_rgb,
            fc_rgb,
            pc_rgb,
            resolution,
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
    pub fn swf_spell_icon_natural_size(&self, back_bundle: &str, up_bundle: &str) -> JsValue {
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
        let root_symbol = swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());
        let bounds = swf_spike::render::symbol_bounds(doc, &root_symbol, frame as u16);
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
            back_doc,
            bg_layer.symbol,
            &mut scene,
            bg_xform,
            0,
            flat_fill(bc_rgb),
        );
        swf_spike::render::render_symbol_xformed(
            back_doc,
            frame_layer.symbol,
            &mut scene,
            frame_xform,
            0,
            flat_fill(fc_rgb),
        );
        swf_spike::render::render_symbol_xformed(
            up_doc,
            glyph_layer.symbol,
            &mut scene,
            glyph_xform,
            0,
            flat_fill(pc_rgb),
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
    pub fn create_swf_spell_instance(&mut self, bundle: &str, resolution: f32) -> u32 {
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
            console_log!("createSwfSpellInstance: {w}x{h} exceeds GPU limits for {bundle}");
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

        let avm = swf_spike::render_avm1::AvmRenderer::new(doc.root.num_frames);
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
    pub fn set_swf_spell_host_cell(&mut self, instance_id: u32, name: &str, x: f64, y: f64) {
        if let Some(inst) = self.swf_spell_instances.get_mut(&instance_id) {
            inst.avm.set_host_cell(name, x, y);
        }
    }

    /// Inject a numeric host-var (typically `level` or `angle`) into the
    /// spell's AVM1 root clip.
    #[wasm_bindgen(js_name = "setSwfSpellHostNumber")]
    pub fn set_swf_spell_host_number(&mut self, instance_id: u32, name: &str, value: f64) {
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
        let root_sym = swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());

        // Lazily init filter pipelines — spell SWFs frequently use
        // DropShadow/Glow/Blur on inner sprites. WASM target falls
        // back to halo automatically per the cfg-gate in
        // `swf_spike::render::filter::apply`.
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
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
            inst.avm
                .render(doc, &root_sym, &mut scene, xform, Some(&mut ctx));
        }

        // Snapshot post-tick state BEFORE advance so the JS-side report
        // matches the frame we just rendered.
        let is_playing = inst.avm.engine.clips.get(&1).map_or(true, |s| s.playing);
        let is_removed = inst.avm.engine.clips.get(&1).is_some_and(|s| s.removed);

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
        if let Err(e) =
            self.renderer
                .render_to_texture(&self.device, &self.queue, &scene, &view, &params)
        {
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
    pub fn render_swf_root(&mut self, bundle: &str, frame: u32, resolution: f32) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        // Wrap the root timeline as a `Symbol::Sprite` so the existing
        // render pipeline (designed around `&Symbol`) can dispatch into it.
        // `OwnedSprite` derives Clone — cheap one-shot clone, fine for the
        // per-portrait render path which isn't a hot loop.
        let root_symbol = swf_spike::swf_doc::Symbol::Sprite(doc.root.clone());

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
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
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
        let _ = js_sys::Reflect::set(&result, &"animEnd".into(), &JsValue::from(c.anim_end));
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
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
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

            let xform = vello::kurbo::Affine::scale(scale).then_translate(vello::kurbo::Vec2::new(
                -px_min_x + cell_x,
                -px_min_y + cell_y,
            ));

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
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(valid_frames));
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
            let _ = js_sys::Reflect::set(&result, &"slots".into(), &js_sys::Array::new().into());
            let _ = js_sys::Reflect::set(&result, &"bFixUsed".into(), &JsValue::FALSE);
            return result.into();
        };
        let slots = swf_spike::render::extract_slot_depths(doc, body, 0);
        let band_count = swf_spike::render::band_count(&slots) as u32;
        let arr = js_sys::Array::new();
        for s in &slots {
            let o = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&o, &"slot".into(), &JsValue::from(u32::from(s.slot)));
            let _ = js_sys::Reflect::set(&o, &"depth".into(), &JsValue::from(u32::from(s.depth)));
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
        let _ = js_sys::Reflect::set(&result, &"bFixUsed".into(), &JsValue::from_bool(b_fix_used));
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
        let bake_start = perf_now();
        bake_telemetry::subscene_reset();
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
            console_log!("renderSwfBodyAtlas: export `{bundle}/{export}` is not a sprite");
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
        let band_presence =
            swf_spike::render::compute_band_presence(doc, effective_body, 0, &slots);
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

        // bFix variant-level dedup (spawn path). A fully bFix-insensitive
        // export bakes byte-identically for apply_b_fix=false/true — the
        // flip only ever touches a non-present band (e.g. an invisible
        // cape mount anchor whose band `compute_band_presence` dropped).
        // Collapsing the flag lets both flipped/unflipped directions of
        // such an export share ONE `body_scene_cache` entry and one
        // `build_both` pass. Exports with a genuinely visible bFix band
        // (a real cape) report a sensitive band and keep `apply_b_fix`,
        // so their flipped directions stay pixel-correct. Mirrors the
        // class-atlas warmup's per-band dedup; here the whole-atlas cache
        // granularity only permits the all-or-nothing variant collapse.
        let eff_apply_b_fix = apply_b_fix
            && swf_spike::render::compute_bfix_sensitive_bands(doc, effective_body, &band_ranges)
                .iter()
                .any(|&s| s);

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

        // DIAG (crop measurement): each present band only fills part of
        // the shared frame_w×frame_h cell. Compute each band's own
        // content bbox (union across sampled chunk frames) and compare
        // its area to the full cell, to quantify per-band crop savings
        // before changing the atlas layout. Logged, not yet applied.
        {
            let full_cell = f64::from(frame_w) * f64::from(frame_h);
            let n_bands = band_ranges.len();
            let mut sum_band = 0.0_f64;
            let sample: Vec<u32> = if chunk_count <= 8 {
                (start..chunk_end).collect()
            } else {
                (0..8).map(|k| start + k * (chunk_count / 8)).collect()
            };
            for &band in &band_ranges {
                let mut bx0 = f64::INFINITY;
                let mut by0 = f64::INFINITY;
                let mut bx1 = f64::NEG_INFINITY;
                let mut by1 = f64::NEG_INFINITY;
                for &f in &sample {
                    let r = swf_spike::render::band_bounds(
                        doc,
                        effective_body,
                        effective_xform,
                        f as u16,
                        band,
                    );
                    if r.width() > 0.0 && r.height() > 0.0 {
                        bx0 = bx0.min(r.x0);
                        by0 = by0.min(r.y0);
                        bx1 = bx1.max(r.x1);
                        by1 = by1.max(r.y1);
                    }
                }
                if bx1 > bx0 && by1 > by0 {
                    let bw = ((bx1 * scale).ceil() + pad) - ((bx0 * scale).floor() - pad);
                    let bh = ((by1 * scale).ceil() + pad) - ((by0 * scale).floor() - pad);
                    sum_band += bw.max(1.0) * bh.max(1.0);
                }
            }
            let full_total = full_cell * (n_bands as f64);
            if full_total > 0.0 && sum_band > 0.0 {
                console_log!(
                    "[crop-measure] {}/{} bands={} full={:.0} cropped={:.0} ratio={:.2}x",
                    bundle,
                    export,
                    n_bands,
                    full_total,
                    sum_band,
                    full_total / sum_band
                );
            }
        }

        // Atlas layout: bands stacked vertically. Only PRESENT bands
        // (those with visible content) get a strip; trivial bands are
        // skipped entirely. Atlas width = strip_w, atlas height =
        // N_present × strip_h + (N_present-1) × BAND_PADDING_PX.
        //
        // Layout policy: prefer a SOFT cap of 8192 (= the JS-side
        // SharedInputAtlas page edge) so the variant's combined texture
        // fits a super-atlas slot, which collapses `BodyBandBatch`
        // keys (`source.uid × bandIndex`) across many variants and
        // drops compose-render cost. Variants whose total pixel area
        // exceeds the soft cap fall back to the HARD cap (= wgpu
        // `maxTextureDimension2d` 16384) — they still bake correctly,
        // they just take a dedicated per-variant Texture in JS and
        // don't share a batch.
        //
        // Within either cap, the picker mirrors `renderSwfClassAtlas`
        // (~line 3022): pick a near-square grid that obeys both the
        // per-band height ceiling and the width ceiling. The greedy
        // single-row packer this replaces was the cause of 13000+ ×
        // 1800 atlases at high zoom — same pixel count, but the row
        // exceeded the super-atlas page so the variant fell back.
        const SOFT_ATLAS_DIM: u32 = 8192;
        const HARD_ATLAS_DIM: u32 = 16384;
        let chunk_usize = chunk_count as usize;
        let band_present_u32 = present_logical.len() as u32;
        let padding_total = if band_present_u32 > 0 {
            (band_present_u32 - 1) * BAND_PADDING_PX
        } else {
            0
        };

        let pick_layout = |target_dim: u32| -> Option<(usize, usize, u32, u32)> {
            let max_strip_h = if band_present_u32 > 0 {
                target_dim.saturating_sub(padding_total) / band_present_u32
            } else {
                target_dim
            };
            let max_cols = (target_dim / frame_w.max(1)).max(1) as usize;
            let max_rows = (max_strip_h / frame_h.max(1)).max(1) as usize;
            if max_cols.saturating_mul(max_rows) < chunk_usize {
                return None;
            }
            // Aspect target: cols × frame_w ≈ rows × frame_h
            // ⇒ cols ≈ sqrt(chunk × frame_h / frame_w)
            let ideal_cols_f = ((chunk_usize as f64) * (frame_h as f64) / (frame_w.max(1) as f64))
                .sqrt()
                .ceil();
            let ideal_cols = (ideal_cols_f as usize).max(1);
            let min_cols = (chunk_usize + max_rows - 1) / max_rows;
            let grid_cols = ideal_cols.max(min_cols).min(max_cols).min(chunk_usize);
            let grid_rows = (chunk_usize + grid_cols - 1) / grid_cols;
            let sw = frame_w * grid_cols as u32;
            let sh = frame_h * grid_rows as u32;
            Some((grid_cols, grid_rows, sw, sh))
        };

        let (grid_cols, _grid_rows, strip_w, strip_h) =
            match pick_layout(SOFT_ATLAS_DIM).or_else(|| pick_layout(HARD_ATLAS_DIM)) {
                Some(layout) => layout,
                None => {
                    console_log!(
                        "renderSwfBodyAtlas: {bundle}/{export} too large to fit \
                         {HARD_ATLAS_DIM}² (frame {frame_w}x{frame_h}, chunk={chunk_usize}, \
                         bands={band_present_u32}); skipping"
                    );
                    return JsValue::NULL;
                }
            };

        let atlas_w = strip_w;
        let atlas_h = strip_h * band_present_u32 + padding_total;
        if atlas_w == 0 || atlas_h == 0 || atlas_w > HARD_ATLAS_DIM || atlas_h > HARD_ATLAS_DIM {
            // Defence-in-depth — the picker already enforces both
            // dims under the chosen target_dim, but skip rather than
            // abort if a corner case slips through.
            console_log!(
                "renderSwfBodyAtlas: {bundle}/{export} layout overflow \
                 {atlas_w}x{atlas_h} (strip {strip_w}x{strip_h}, bands={band_present_u32}); skipping"
            );
            return JsValue::NULL;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
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
        // Pixel-exact cell xforms. The earlier resolution-independent
        // attempt cached the scene at twip identity and wrapped with
        // `Affine::scale(scale)` at render time, but cell positions
        // then drifted by `(twip_w × scale − frame_w)` per column —
        // the rounding gap between the natural twip extent and the
        // pixel-rounded `frame_w`. The drift accumulated across cells
        // and produced visible per-frame jitter in walk animations
        // ("staggery shifting" reported during stress-test playback).
        //
        // Fix: keep cell xforms pixel-exact (`scale.then_translate
        // (pixel_pos)`) so every cell aligns to the atlas grid
        // perfectly. The resolution-independence is moved DOWN one
        // layer — `body_subscene_cache` (per-frame, per-band sub-
        // scenes at twip identity) survives every zoom change, so
        // build_scene's Pass 1 cost is ~0 across resolutions; only
        // the Pass 2 composition (chunk × band scene.append calls,
        // ~1 ms total) re-runs per bake. `body_scene_cache` is
        // dropped entirely; see the BodySceneCacheKey doc.
        // Single-walk dual emit: ONE display-list traversal builds the
        // Colour scene AND the ZoneId scene (was two full walks). Each
        // `(frame, band)` cell calls `render_body_band_dual`, which
        // emits colour fills into `colour` and zone markers into `zone`
        // simultaneously — byte-identical to the old two-pass build.
        let build_both = |device: &wgpu::Device,
                          queue: &wgpu::Queue,
                          renderer: &mut Renderer,
                          filter_pipelines: &swf_spike::wgpu_filters::FilterPipelines|
         -> (vello::Scene, vello::Scene) {
            let mut wctx = swf_spike::render::WgpuCtx {
                device,
                queue,
                renderer,
                filter_pipelines,
                output_scale: scale,
            };
            let mut colour = vello::Scene::new();
            let mut zone = vello::Scene::new();
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
                    swf_spike::render::render_body_band_dual(
                        &mut wctx,
                        doc,
                        effective_sym,
                        &mut colour,
                        &mut zone,
                        xform * effective_xform,
                        frame_idx as u16,
                        band,
                        player_colors,
                        cache,
                        eff_apply_b_fix,
                        hat_equipped,
                    );
                }
            }
            (colour, zone)
        };

        // Composed-atlas cache (Phase 1b). Resolution-keyed on
        // `scale_q` (= scale × 1000) — at each unique scale the
        // first bake pays Pass 1 + Pass 2 + GPU, subsequent bakes
        // at the SAME scale hit the cache and skip straight to
        // GPU rasterize. CRITICAL on repeated-zoom (e.g.
        // 3 → 5 → 3): without this cache the 3 → return rebuilds
        // every variant from scratch (~2-3 ms × 250 bots × 7
        // variants = several seconds of CPU). With cache the
        // return is GPU-only at ~0.5 ms per bake.
        //
        // The earlier resolution-independent attempt (drop scale_q,
        // wrap with Affine::scale at render time) caused sub-pixel
        // cell drift visible as animation stagger. Bringing it back
        // would require splitting the cache to per-sub-scene
        // granularity (cf. body_subscene_cache used by the class
        // atlas path) — left as future work.
        //
        // Build-on-miss into temporaries first so we don't hold a
        // `&mut self.body_scene_cache` borrow across the closure
        // call (which needs `&mut self.renderer`).
        let scale_q = (scale * 1000.0).round() as u32;
        let colour_key = BodySceneCacheKey {
            bundle: bundle.to_string(),
            export: export.to_string(),
            start,
            count: chunk_count,
            scale_q,
            apply_b_fix: eff_apply_b_fix,
            hat_equipped,
            mode: 0,
        };
        let zone_key = BodySceneCacheKey {
            mode: 1,
            ..colour_key.clone()
        };
        // colour_key/zone_key differ only by `mode` and are always
        // inserted as a pair, so cache presence is symmetric — one
        // `contains_key` decides. On miss, the single dual walk builds
        // BOTH scenes in one traversal.
        let (new_colour, new_zone): (Option<vello::Scene>, Option<vello::Scene>) =
            if self.body_scene_cache.contains_key(&colour_key) {
                bake_telemetry::subscene_hit();
                bake_telemetry::subscene_hit();
                self.body_scene_cache_hits += 2;
                (None, None)
            } else {
                bake_telemetry::subscene_miss();
                bake_telemetry::subscene_miss();
                self.body_scene_cache_misses += 2;
                let (c, z) = build_both(
                    &self.device,
                    &self.queue,
                    &mut self.renderer,
                    filter_pipelines,
                );
                (Some(c), Some(z))
            };
        // Approximate-LRU eviction at 1500 cap. Must skip the two
        // active keys when picking a victim — see the long comment
        // on the original implementation (the `find(...)` exclusion
        // is required for correctness, not just optimisation; the
        // first attempt evicted an active key and trapped wasm).
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
                break;
            };
            // Evict the victim AND its colour/zone sibling together. The
            // cache stores each variant as a (mode:0, mode:1) PAIR and the
            // hit path below relies on "colour present ⟹ zone present".
            // Evicting a single key would split a pair, so a later HIT on
            // the surviving half skips insertion and the `get` on the
            // missing half used to panic (`just inserted`), which poisons
            // the whole WASM module. The sibling can never be the active
            // colour_key/zone_key (victim is already excluded from those,
            // and a flipped-mode key of a non-active key is also
            // non-active), so this never drops the keys we're about to use.
            let sibling = BodySceneCacheKey {
                mode: if victim.mode == 0 { 1 } else { 0 },
                ..victim.clone()
            };
            self.body_scene_cache.remove(&victim);
            self.body_scene_cache.remove(&sibling);
            self.body_scene_cache_evictions += 1;
        }
        if let Some(s) = new_colour {
            self.body_scene_cache.insert(colour_key.clone(), s);
        }
        if let Some(s) = new_zone {
            self.body_scene_cache.insert(zone_key.clone(), s);
        }
        // Defence-in-depth: never `expect`/panic here — a panic in WASM
        // aborts and poisons the module (every later call throws "recursive
        // use of an object" / "unreachable", killing all rendering). If the
        // pair is somehow incomplete, skip this bake and let the caller
        // retry next frame.
        if !self.body_scene_cache.contains_key(&colour_key)
            || !self.body_scene_cache.contains_key(&zone_key)
        {
            console_log!(
                "renderSwfBodyAtlas: body_scene_cache pair incomplete \
                 (bundle={bundle} export={export}); skipping bake"
            );
            return JsValue::NULL;
        }
        let colour_scene = self
            .body_scene_cache
            .get(&colour_key)
            .expect("checked present above");
        let zone_scene = self
            .body_scene_cache
            .get(&zone_key)
            .expect("checked present above");

        // Render both scenes into their respective atlas textures.
        // Atlas dims = (strip_w, band_total * strip_h + padding).
        // The scene has `scale` baked into every cell xform so
        // content lands on the pixel atlas grid exactly.
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
            combine.combine(
                &self.device,
                &mut encoder,
                &colour_view,
                &zone_view,
                &dst_view,
            );
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
            let band_atlas_y = (slot_idx as u32) * (strip_h + BAND_PADDING_PX);
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
            let _ = js_sys::Reflect::set(&entry, &"atlasX".into(), &JsValue::from(0u32));
            let _ = js_sys::Reflect::set(&entry, &"atlasY".into(), &JsValue::from(band_atlas_y));
            bands_arr.push(&entry.into());
        }

        let result = js_sys::Object::new();
        // Combined bridge path: ONE bitmap with body color in RGB +
        // packed (body_alpha & 0xFC | zone_id) in A. The JS-side
        // body-band shader binds this texture with two samplers —
        // LINEAR for color/alpha, NEAREST for zone — and decodes
        // zone_id from the low 2 bits of the alpha byte.
        let _ = js_sys::Reflect::set(&result, &"combinedBitmap".into(), &combined_bitmap);
        let _ = js_sys::Reflect::set(&result, &"atlasWidth".into(), &JsValue::from(atlas_w));
        let _ = js_sys::Reflect::set(&result, &"atlasHeight".into(), &JsValue::from(atlas_h));
        // `stripWidth` / `stripHeight` = ONE band's strip dims inside
        // the atlas. JS uses these + atlasY to compute per-band UV.
        let _ = js_sys::Reflect::set(&result, &"stripWidth".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"stripHeight".into(), &JsValue::from(strip_h));
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(chunk_count));
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
        {
            let (hits, misses) = bake_telemetry::subscene_take();
            bake_telemetry::Builder::new(bake_telemetry::BakeKind::BodyAtlas, bundle)
                .total(perf_now() - bake_start)
                .subscene(hits, misses)
                .pixel_area(u64::from(atlas_w) * u64::from(atlas_h))
                .sub_count(count)
                .commit();
        }
        result.into()
    }

    /// DIAG: "Flash model" feasibility test. Build N characters' body
    /// bands (one export, frames varied, positioned in a grid) into ONE
    /// Vello scene and render it to a `target_dim²` texture `iters`
    /// times. Isolates the Vello RENDER cost (the crux of the "per-frame
    /// Vello caps at 30fps" claim) from scene-build cost. JS measures GPU
    /// wall via `onSubmittedWorkDone` after this returns.
    #[wasm_bindgen(js_name = "benchmarkBatchedChars")]
    pub fn benchmark_batched_chars(
        &mut self,
        bundle: &str,
        export: &str,
        n_chars: u32,
        target_dim: u32,
        iters: u32,
        resolution: f32,
    ) -> JsValue {
        use swf_spike::render::ctx::RenderMode;
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };
        let swf_spike::swf_doc::Symbol::Sprite(body) = symbol else {
            return JsValue::NULL;
        };
        let (effective_sym, effective_xform) =
            swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
        let effective_body = match effective_sym {
            swf_spike::swf_doc::Symbol::Sprite(s) => s,
            _ => body,
        };
        let slots = swf_spike::render::extract_slot_depths(doc, body, 0);
        let band_presence =
            swf_spike::render::compute_band_presence(doc, effective_body, 0, &slots);
        let band_ranges: Vec<swf_spike::render::BandRange> = {
            let present: Vec<usize> = band_presence
                .iter()
                .enumerate()
                .filter_map(|(i, &p)| if p { Some(i) } else { None })
                .collect();
            if present.is_empty() {
                vec![swf_spike::render::BandRange::ALL]
            } else {
                present
                    .iter()
                    .map(|&i| swf_spike::render::band_range(&slots, i))
                    .collect()
            }
        };
        let bounds = swf_spike::render::symbol_bounds(doc, symbol, 0);
        let scale = f64::from(resolution) / 20.0;
        let char_w = (bounds.width() * scale).max(1.0);
        let char_h = (bounds.height() * scale).max(1.0);
        let frame_count = u32::from(body.num_frames).max(1);
        // Anchor offset so each body's bbox top-left lands at its grid
        // cell (not its SWF origin) — otherwise bodies extend off the top
        // edge and get clipped, undercounting GPU work.
        let anchor_x = -bounds.x0 * scale;
        let anchor_y = -bounds.y0 * scale;
        // Pack with overlap (×0.5) so N chars fully fit on the target as a
        // dense crowd — every char ON-canvas so the GPU actually renders
        // its full coverage (realistic).
        let step_x = (char_w * 0.5).max(1.0);
        let step_y = (char_h * 0.5).max(1.0);
        let cols = (((f64::from(target_dim) - char_w) / step_x).floor() as u32).max(1);

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }
        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("batched-chars-bench"),
            size: wgpu::Extent3d {
                width: target_dim,
                height: target_dim,
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
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: target_dim,
            height: target_dim,
            antialiasing_method: AaConfig::Area,
        };
        // Build the N-char scene ONCE (build cost measured separately),
        // then render it `iters` times to isolate the GPU render cost.
        // Each char gets RANDOM per-zone colours (real recolor via
        // render_body_band Colour mode + player_colors) so this reflects
        // a varied crowd, not 500 identical bodies — and exercises the
        // recolor build cost (colored fills can't share cache).
        let t_build = perf_now();
        let mut scene = vello::Scene::new();
        {
            let cache: &swf_spike::render::cache::RenderCache = self
                .swf_render_caches
                .entry(bundle.to_string())
                .or_default();
            let mut wctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines: self.swf_filter_pipelines.as_ref().unwrap(),
                output_scale: scale,
            };
            for i in 0..n_chars {
                let col = i % cols;
                let row = i / cols;
                let wx = anchor_x + f64::from(col) * step_x;
                let wy = anchor_y + f64::from(row) * step_y;
                let frame = (i % frame_count) as u16;
                // Deterministic per-char random zone colours.
                let h = i.wrapping_mul(2_654_435_761).wrapping_add(1);
                let c1 = h & 0x00FF_FFFF;
                let c2 = h.wrapping_mul(40_503) & 0x00FF_FFFF;
                let c3 = h.wrapping_mul(2_246_822_519) & 0x00FF_FFFF;
                let pc = swf_spike::recolor::PlayerColors([Some(c1), Some(c2), Some(c3)]);
                let place = vello::kurbo::Affine::scale(scale)
                    .then_translate(vello::kurbo::Vec2::new(wx, wy));
                for &band in &band_ranges {
                    swf_spike::render::render_body_band(
                        &mut wctx,
                        doc,
                        effective_sym,
                        &mut scene,
                        place * effective_xform,
                        frame,
                        band,
                        RenderMode::Colour,
                        pc,
                        cache,
                        false,
                        false,
                    );
                }
            }
        }
        let build_ms = perf_now() - t_build;

        let t_render = perf_now();
        for _ in 0..iters {
            let _ =
                self.renderer
                    .render_to_texture(&self.device, &self.queue, &scene, &view, &params);
        }
        let submit_ms = (perf_now() - t_render) / f64::from(iters.max(1));

        // Bridge the final rendered target to an ImageBitmap so JS can
        // DISPLAY it — proves Vello actually drew real bodies (not blank).
        let bitmap =
            self.texture_to_bitmap(&target, target_dim, target_dim, "benchmarkBatchedChars");

        let result = js_sys::Object::new();
        let set = |k: &str, v: f64| {
            let _ = js_sys::Reflect::set(&result, &k.into(), &JsValue::from(v));
        };
        set("nChars", f64::from(n_chars));
        set("iters", f64::from(iters));
        set("targetDim", f64::from(target_dim));
        set("cols", f64::from(cols));
        set("charWpx", char_w);
        set("charHpx", char_h);
        set("bands", band_ranges.len() as f64);
        set("buildMsTotal", build_ms);
        set("submitMsPerIter", submit_ms);
        if let Some(bmp) = bitmap {
            let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bmp);
        }
        result.into()
    }

    /// DIAG: REALISTIC crowd test. Renders N characters into ONE Vello
    /// scene with VARIED gfx (round-robin over `body_specs`), per-char
    /// RANDOM zone colours (real recolor), and `acc_per_char` accessories
    /// each (round-robin over `acc_specs`). Specs are `"bundle|export"`;
    /// unloaded ones are skipped. Renders `iters` times, bridges the
    /// result to a bitmap for display. Answers: cost of a realistic
    /// varied/colored/accessorized crowd via Vello-direct.
    #[wasm_bindgen(js_name = "benchmarkCrowdWithAcc")]
    pub fn benchmark_crowd_with_acc(
        &mut self,
        body_specs: Vec<String>,
        acc_specs: Vec<String>,
        n_chars: u32,
        acc_per_char: u32,
        target_dim: u32,
        iters: u32,
        resolution: f32,
    ) -> JsValue {
        use swf_spike::render::ctx::RenderMode;
        let scale = f64::from(resolution) / 20.0;

        struct BSetup {
            bundle: String,
            export: String,
            xform: vello::kurbo::Affine,
            bands: Vec<swf_spike::render::BandRange>,
            frames: u16,
            anchor_x: f64,
            anchor_y: f64,
            char_w: f64,
            char_h: f64,
        }
        let mut setups: Vec<BSetup> = Vec::new();
        for spec in &body_specs {
            let mut it = spec.split('|');
            let (Some(b), Some(e)) = (it.next(), it.next()) else {
                continue;
            };
            let Some(doc) = self.swf_bundles.get(b) else {
                continue;
            };
            let Some(symbol) = doc.lookup_export(e) else {
                continue;
            };
            let swf_spike::swf_doc::Symbol::Sprite(body) = symbol else {
                continue;
            };
            let (effective_sym, effective_xform) =
                swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
            let effective_body = match effective_sym {
                swf_spike::swf_doc::Symbol::Sprite(s) => s,
                _ => body,
            };
            let slots = swf_spike::render::extract_slot_depths(doc, body, 0);
            let presence = swf_spike::render::compute_band_presence(doc, effective_body, 0, &slots);
            let present: Vec<usize> = presence
                .iter()
                .enumerate()
                .filter_map(|(i, &p)| if p { Some(i) } else { None })
                .collect();
            let bands: Vec<swf_spike::render::BandRange> = if present.is_empty() {
                vec![swf_spike::render::BandRange::ALL]
            } else {
                present
                    .iter()
                    .map(|&i| swf_spike::render::band_range(&slots, i))
                    .collect()
            };
            let bounds = swf_spike::render::symbol_bounds(doc, symbol, 0);
            setups.push(BSetup {
                bundle: b.to_string(),
                export: e.to_string(),
                xform: effective_xform,
                bands,
                frames: body.num_frames.max(1),
                anchor_x: -bounds.x0 * scale,
                anchor_y: -bounds.y0 * scale,
                char_w: (bounds.width() * scale).max(1.0),
                char_h: (bounds.height() * scale).max(1.0),
            });
        }
        if setups.is_empty() {
            return JsValue::NULL;
        }
        let acc: Vec<(String, String)> = acc_specs
            .iter()
            .filter_map(|s| {
                let mut it = s.split('|');
                Some((it.next()?.to_string(), it.next()?.to_string()))
            })
            .collect();

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }
        for s in &setups {
            self.swf_render_caches.entry(s.bundle.clone()).or_default();
        }
        for (b, _) in &acc {
            self.swf_render_caches.entry(b.clone()).or_default();
        }

        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("crowd-acc-bench"),
            size: wgpu::Extent3d {
                width: target_dim,
                height: target_dim,
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
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: target_dim,
            height: target_dim,
            antialiasing_method: AaConfig::Area,
        };

        let max_w = setups.iter().map(|s| s.char_w).fold(1.0_f64, f64::max);
        let max_h = setups.iter().map(|s| s.char_h).fold(1.0_f64, f64::max);
        let step_x = (max_w * 0.5).max(1.0);
        let step_y = (max_h * 0.5).max(1.0);
        let cols = (((f64::from(target_dim) - max_w) / step_x).floor() as u32).max(1);

        // ── ONE-TIME: emit each char (varied gfx + per-char random colors +
        // accessories) into its OWN sub-scene at scale, anchored to local
        // origin (NO grid translate). Per-char colours survive because each
        // char owns a colored sub-scene — no post-pass needed. This is the
        // realistic colored bake; cached & re-emitted only on frame change.
        let t_pre = perf_now();
        let mut char_scenes: Vec<vello::Scene> = Vec::with_capacity(n_chars as usize);
        {
            let mut wctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines: self.swf_filter_pipelines.as_ref().unwrap(),
                output_scale: scale,
            };
            let bundles = &self.swf_bundles;
            let caches = &self.swf_render_caches;
            for i in 0..n_chars {
                let s = &setups[(i as usize) % setups.len()];
                let frame = (i % u32::from(s.frames)) as u16;
                let h = i.wrapping_mul(2_654_435_761).wrapping_add(1);
                let pc = swf_spike::recolor::PlayerColors([
                    Some(h & 0x00FF_FFFF),
                    Some(h.wrapping_mul(40_503) & 0x00FF_FFFF),
                    Some(h.wrapping_mul(2_246_822_519) & 0x00FF_FFFF),
                ]);
                // Local-origin placement: scaled, shifted so bbox-min lands at
                // (0,0). The per-frame grid translate is applied at append.
                let base = vello::kurbo::Affine::scale(scale)
                    .then_translate(vello::kurbo::Vec2::new(s.anchor_x, s.anchor_y));
                let mut cs = vello::Scene::new();
                if let Some(doc) = bundles.get(&s.bundle) {
                    if let Some(symbol) = doc.lookup_export(&s.export) {
                        let (eff, _) =
                            swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
                        if let Some(cache) = caches.get(&s.bundle) {
                            for &band in &s.bands {
                                swf_spike::render::render_body_band(
                                    &mut wctx,
                                    doc,
                                    eff,
                                    &mut cs,
                                    base * s.xform,
                                    frame,
                                    band,
                                    RenderMode::Colour,
                                    pc,
                                    cache,
                                    false,
                                    false,
                                );
                            }
                        }
                    }
                }
                // accessories (fixed palette — no recolor), local offsets
                if !acc.is_empty() {
                    for j in 0..acc_per_char {
                        let (ab, ae) = &acc[((i * acc_per_char + j) as usize) % acc.len()];
                        if let Some(adoc) = bundles.get(ab) {
                            if let Some(asym) = adoc.lookup_export(ae) {
                                if let Some(acache) = caches.get(ab) {
                                    let off_y = s.char_h * (0.15 + 0.18 * f64::from(j));
                                    let aplace = vello::kurbo::Affine::scale(scale).then_translate(
                                        vello::kurbo::Vec2::new(
                                            s.anchor_x + s.char_w * 0.25,
                                            s.anchor_y + off_y,
                                        ),
                                    );
                                    swf_spike::render::render_body_band(
                                        &mut wctx,
                                        adoc,
                                        asym,
                                        &mut cs,
                                        aplace,
                                        0,
                                        swf_spike::render::BandRange::ALL,
                                        RenderMode::Colour,
                                        swf_spike::recolor::PlayerColors::default(),
                                        acache,
                                        false,
                                        false,
                                    );
                                }
                            }
                        }
                    }
                }
                char_scenes.push(cs);
            }
        }
        let pre_ms = perf_now() - t_pre;

        // ── PER-FRAME: rebuild the whole crowd via append of cached colored
        // char sub-scenes at grid positions, then render. THIS is the real
        // per-frame cost that gates fps (positions move every frame).
        let mut build_total = 0.0;
        let mut submit_total = 0.0;
        let mut scene = vello::Scene::new();
        for _ in 0..iters {
            let t_b = perf_now();
            scene.reset();
            for i in 0..n_chars {
                let col = i % cols;
                let row = i / cols;
                let place = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                    f64::from(col) * step_x,
                    f64::from(row) * step_y,
                ));
                scene.append(&char_scenes[i as usize], Some(place));
            }
            build_total += perf_now() - t_b;
            let t_s = perf_now();
            let _ =
                self.renderer
                    .render_to_texture(&self.device, &self.queue, &scene, &view, &params);
            submit_total += perf_now() - t_s;
        }
        let build_ms = build_total / f64::from(iters.max(1));
        let submit_ms = submit_total / f64::from(iters.max(1));

        let bitmap =
            self.texture_to_bitmap(&target, target_dim, target_dim, "benchmarkCrowdWithAcc");

        let result = js_sys::Object::new();
        let set = |k: &str, v: f64| {
            let _ = js_sys::Reflect::set(&result, &k.into(), &JsValue::from(v));
        };
        set("nChars", f64::from(n_chars));
        set("uniqueBodies", setups.len() as f64);
        set("accExports", acc.len() as f64);
        set("accPerChar", f64::from(acc_per_char));
        set("iters", f64::from(iters));
        set("targetDim", f64::from(target_dim));
        set("preMsOneTime", pre_ms);
        set("buildMsPerIterAppend", build_ms);
        set("submitMsPerIter", submit_ms);
        if let Some(bmp) = bitmap {
            let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bmp);
        }
        result.into()
    }

    /// DIAG: the DECIDING test for the 60fps question. Pre-renders each
    /// (frame, band) sub-scene ONCE at twip-identity (scale-invariant,
    /// uncolored — like body_subscene_cache), then builds the N-char
    /// crowd PER ITER by `scene.append`-ing those cached sub-scenes with
    /// per-char world transforms (the real per-frame cost). Measures the
    /// PER-FRAME build (append) cost vs the naive re-emit (19ms). If this
    /// is sub-ms, Vello-direct hits 60fps; recolor is then a separate
    /// post-pass. `preMs` is the one-time sub-scene bake.
    #[wasm_bindgen(js_name = "benchmarkBatchedAppend")]
    pub fn benchmark_batched_append(
        &mut self,
        bundle: &str,
        export: &str,
        n_chars: u32,
        target_dim: u32,
        iters: u32,
        resolution: f32,
    ) -> JsValue {
        use swf_spike::render::ctx::RenderMode;
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let Some(symbol) = doc.lookup_export(export) else {
            return JsValue::NULL;
        };
        let swf_spike::swf_doc::Symbol::Sprite(body) = symbol else {
            return JsValue::NULL;
        };
        let (effective_sym, effective_xform) =
            swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
        let effective_body = match effective_sym {
            swf_spike::swf_doc::Symbol::Sprite(s) => s,
            _ => body,
        };
        let slots = swf_spike::render::extract_slot_depths(doc, body, 0);
        let presence = swf_spike::render::compute_band_presence(doc, effective_body, 0, &slots);
        let band_ranges: Vec<swf_spike::render::BandRange> = {
            let present: Vec<usize> = presence
                .iter()
                .enumerate()
                .filter_map(|(i, &p)| if p { Some(i) } else { None })
                .collect();
            if present.is_empty() {
                vec![swf_spike::render::BandRange::ALL]
            } else {
                present
                    .iter()
                    .map(|&i| swf_spike::render::band_range(&slots, i))
                    .collect()
            }
        };
        let bounds = swf_spike::render::symbol_bounds(doc, symbol, 0);
        let scale = f64::from(resolution) / 20.0;
        let frame_count = u32::from(body.num_frames).max(1);
        let anchor_x = -bounds.x0 * scale;
        let anchor_y = -bounds.y0 * scale;
        let char_w = (bounds.width() * scale).max(1.0);
        let char_h = (bounds.height() * scale).max(1.0);

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }

        // ── ONE-TIME: render each (frame, band) sub-scene at twip-identity
        // (uncolored, scale-invariant). This is what body_subscene_cache
        // holds; appended per char with a world transform.
        let t_pre = perf_now();
        let mut subscenes: Vec<Vec<vello::Scene>> = Vec::new();
        {
            let cache: &swf_spike::render::cache::RenderCache = self
                .swf_render_caches
                .entry(bundle.to_string())
                .or_default();
            let mut wctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines: self.swf_filter_pipelines.as_ref().unwrap(),
                output_scale: scale,
            };
            for f in 0..frame_count {
                let mut row = Vec::new();
                for &band in &band_ranges {
                    let mut sub = vello::Scene::new();
                    swf_spike::render::render_body_band(
                        &mut wctx,
                        doc,
                        effective_sym,
                        &mut sub,
                        effective_xform,
                        f as u16,
                        band,
                        RenderMode::Colour,
                        swf_spike::recolor::PlayerColors::default(),
                        cache,
                        false,
                        false,
                    );
                    row.push(sub);
                }
                subscenes.push(row);
            }
        }
        let pre_ms = perf_now() - t_pre;

        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("append-bench"),
            size: wgpu::Extent3d {
                width: target_dim,
                height: target_dim,
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
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: target_dim,
            height: target_dim,
            antialiasing_method: AaConfig::Area,
        };

        let step_x = (char_w * 0.5).max(1.0);
        let step_y = (char_h * 0.5).max(1.0);
        let cols = (((f64::from(target_dim) - char_w) / step_x).floor() as u32).max(1);
        let n_bands = band_ranges.len();

        // ── PER-FRAME: rebuild via append + render, measured each iter.
        let mut build_total = 0.0;
        let mut submit_total = 0.0;
        let mut scene = vello::Scene::new();
        for _ in 0..iters {
            let t_b = perf_now();
            scene.reset();
            for i in 0..n_chars {
                let f = (i % frame_count) as usize;
                let col = i % cols;
                let row = i / cols;
                let wx = anchor_x + f64::from(col) * step_x;
                let wy = anchor_y + f64::from(row) * step_y;
                let place = vello::kurbo::Affine::scale(scale)
                    .then_translate(vello::kurbo::Vec2::new(wx, wy));
                for b in 0..n_bands {
                    scene.append(&subscenes[f][b], Some(place));
                }
            }
            build_total += perf_now() - t_b;
            let t_s = perf_now();
            let _ =
                self.renderer
                    .render_to_texture(&self.device, &self.queue, &scene, &view, &params);
            submit_total += perf_now() - t_s;
        }
        let build_ms = build_total / f64::from(iters.max(1));
        let submit_ms = submit_total / f64::from(iters.max(1));

        let bitmap =
            self.texture_to_bitmap(&target, target_dim, target_dim, "benchmarkBatchedAppend");

        let result = js_sys::Object::new();
        let set = |k: &str, v: f64| {
            let _ = js_sys::Reflect::set(&result, &k.into(), &JsValue::from(v));
        };
        set("nChars", f64::from(n_chars));
        set("bands", n_bands as f64);
        set("frameCount", f64::from(frame_count));
        set("iters", f64::from(iters));
        set("preMsOneTime", pre_ms);
        set("buildMsPerIterAppend", build_ms);
        set("submitMsPerIter", submit_ms);
        if let Some(bmp) = bitmap {
            let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bmp);
        }
        result.into()
    }

    /// DIAG: render the ACTUAL on-screen players via Vello-direct using
    /// REAL data — real body gfx + real equipped accessories at their
    /// REAL mount transforms + correct direction frames (driven through
    /// the SAME `render_symbol_with_ctx_tinted_accessorized_bfixed` path
    /// the live renderer bakes with), real per-player colors, and real
    /// isometric screen positions (Y-sorted, flipped per direction). NO
    /// fixed offsets, NO grid stacking. Each look is emitted once into a
    /// sub-scene; the crowd is rebuilt per frame via `scene.append` at
    /// real positions. Measures the real per-frame cost + displays it.
    ///
    /// `players`: JS array of {
    ///   bundle, export, frame, dir (1-char suffix), flipped (bool),
    ///   c1, c2, c3 (packed 0xRRGGBB, 0 = no tint), x, y (map-space px),
    ///   acc: [{ bundle, export, slot, animType }]
    /// }
    #[wasm_bindgen(js_name = "benchmarkRealCrowd")]
    pub fn benchmark_real_crowd(
        &mut self,
        players: JsValue,
        target_dim_max: u32,
        iters: u32,
        resolution: f32,
    ) -> JsValue {
        use swf_spike::render::ctx::RenderMode;
        const MAX_SLOT: u8 = 5;

        let scale = f64::from(resolution) / 20.0;
        let pos_scale = f64::from(resolution); // map-space px → screen px

        struct AccSpec {
            bundle: String,
            export: String,
            slot: u8,
            anim_type: u8,
        }
        struct PlayerSpec {
            bundle: String,
            export: String,
            frame: u16,
            dir: char,
            flipped: bool,
            colors: swf_spike::recolor::PlayerColors,
            x: f64,
            y: f64,
            acc: Vec<AccSpec>,
        }
        let get_f64 = |o: &JsValue, k: &str| -> f64 {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
        };
        let get_str = |o: &JsValue, k: &str| -> String {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_default()
        };
        let get_bool = |o: &JsValue, k: &str| -> bool {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        };
        let opt_color = |c: f64| -> Option<u32> {
            let v = c as i64;
            if v > 0 {
                Some((v as u32) & 0x00FF_FFFF)
            } else {
                None
            }
        };

        let arr = js_sys::Array::from(&players);
        let mut specs: Vec<PlayerSpec> = Vec::with_capacity(arr.length() as usize);
        for i in 0..arr.length() {
            let o = arr.get(i);
            let bundle = get_str(&o, "bundle");
            let export = get_str(&o, "export");
            if bundle.is_empty() || export.is_empty() {
                continue;
            }
            let dir = get_str(&o, "dir")
                .chars()
                .next()
                .unwrap_or('R')
                .to_ascii_uppercase();
            let acc_val =
                js_sys::Reflect::get(&o, &JsValue::from_str("acc")).unwrap_or(JsValue::NULL);
            let mut acc: Vec<AccSpec> = Vec::new();
            if acc_val.is_truthy() {
                let aarr = js_sys::Array::from(&acc_val);
                for j in 0..aarr.length() {
                    let a = aarr.get(j);
                    let ab = get_str(&a, "bundle");
                    let ae = get_str(&a, "export");
                    if ab.is_empty() || ae.is_empty() {
                        continue;
                    }
                    acc.push(AccSpec {
                        bundle: ab,
                        export: ae,
                        slot: get_f64(&a, "slot") as u8,
                        anim_type: get_f64(&a, "animType") as u8,
                    });
                }
            }
            specs.push(PlayerSpec {
                bundle,
                export,
                frame: get_f64(&o, "frame") as u16,
                dir,
                flipped: get_bool(&o, "flipped"),
                colors: swf_spike::recolor::PlayerColors([
                    opt_color(get_f64(&o, "c1")),
                    opt_color(get_f64(&o, "c2")),
                    opt_color(get_f64(&o, "c3")),
                ]),
                x: get_f64(&o, "x"),
                y: get_f64(&o, "y"),
                acc,
            });
        }
        if specs.is_empty() {
            return JsValue::NULL;
        }
        // Y-sort so back-to-front overlap is canonical (lower y first).
        specs.sort_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal));

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }

        // PER-BUNDLE render caches (CRITICAL: a cache shared across bundles
        // returns the wrong flattened shapes for colliding symbol ids →
        // huge bogus accessory geometry. Each bundle gets its own.)
        for s in &specs {
            self.swf_render_caches.entry(s.bundle.clone()).or_default();
            for a in &s.acc {
                self.swf_render_caches.entry(a.bundle.clone()).or_default();
            }
        }

        // ── ONE-TIME: emit each player's full look (body + accessories at
        // real mounts) into its own sub-scene at scale, SWF origin (0,0). ──
        let mut char_scenes: Vec<vello::Scene> = Vec::with_capacity(specs.len());
        let mut placed: Vec<(f64, f64, bool)> = Vec::with_capacity(specs.len());
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let mut rendered = 0u32;
        let mut acc_drawn = 0u32;
        let t_pre = perf_now();
        {
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            let bundles = &self.swf_bundles;
            let caches = &self.swf_render_caches;
            for s in &specs {
                let Some(doc) = bundles.get(&s.bundle) else {
                    continue;
                };
                let Some(symbol) = doc.lookup_export(&s.export) else {
                    continue;
                };
                let Some(body_cache) = caches.get(&s.bundle) else {
                    continue;
                };
                // Equipped accessories keyed by mount slot (resolve symbols +
                // each accessory's OWN per-bundle cache).
                let mut equipped: HashMap<
                    u8,
                    (
                        &swf_spike::render::cache::RenderCache,
                        &swf_spike::swf_doc::SwfDoc,
                        &swf_spike::swf_doc::Symbol,
                        u8,
                    ),
                > = HashMap::new();
                for a in &s.acc {
                    let Some(adoc) = bundles.get(&a.bundle) else {
                        continue;
                    };
                    let Some(asym) = adoc.lookup_export(&a.export) else {
                        continue;
                    };
                    let Some(acache) = caches.get(&a.bundle) else {
                        continue;
                    };
                    equipped.insert(a.slot, (acache, adoc, asym, a.anim_type));
                }
                let has_hat = equipped.contains_key(&1);
                // Effective body + its wrapper transform (export → body space),
                // and the body's mount slot-depths (sorted by depth, with side).
                let (effective_sym, effective_xform) =
                    swf_spike::render::find_effective_body_symbol(doc, symbol, s.frame);
                let swf_spike::swf_doc::Symbol::Sprite(body_sprite) = symbol else {
                    continue;
                };
                let slots = swf_spike::render::extract_slot_depths(doc, body_sprite, s.frame);
                // Per-frame mount matrices (export space) + presence bitmap.
                let (mount_mats, mount_pres) =
                    swf_spike::render::mount_transforms::extract_mount_transforms(
                        doc, symbol, s.frame, 1, s.flipped, MAX_SLOT,
                    );
                let base = vello::kurbo::Affine::scale(scale);
                let body_xform = base * effective_xform;
                let mut cs = vello::Scene::new();
                // CANONICAL Z-INTERLEAVE: band0, accessory@slot0-mount, band1,
                // accessory@slot1-mount, … — z = append order = body-part depth
                // (cape behind, hat in front), exactly like the live renderer.
                let n = slots.len();
                for i in 0..=n {
                    let band = swf_spike::render::band_range(&slots, i);
                    swf_spike::render::render_body_band(
                        &mut ctx,
                        doc,
                        effective_sym,
                        &mut cs,
                        body_xform,
                        s.frame,
                        band,
                        RenderMode::Colour,
                        s.colors,
                        body_cache,
                        s.flipped,
                        has_hat,
                    );
                    if i < n {
                        let sd = &slots[i];
                        let slot_us = sd.slot as usize;
                        let present = mount_pres.get(slot_us).copied().unwrap_or(0) == 1;
                        if present {
                            if let Some(&(acache, adoc, asym, at)) = equipped.get(&sd.slot) {
                                let off = slot_us * 6;
                                if off + 6 <= mount_mats.len() {
                                    let m = vello::kurbo::Affine::new([
                                        f64::from(mount_mats[off]),
                                        f64::from(mount_mats[off + 1]),
                                        f64::from(mount_mats[off + 2]),
                                        f64::from(mount_mats[off + 3]),
                                        f64::from(mount_mats[off + 4]),
                                        f64::from(mount_mats[off + 5]),
                                    ]);
                                    let side = sd.side.as_deref().unwrap_or("R");
                                    let acc_frame = swf_spike::render::pick_accessory_frame(
                                        adoc, asym, sd.slot, at, side, s.frame,
                                    );
                                    swf_spike::render::render_symbol_with_shared_cache(
                                        &mut ctx,
                                        adoc,
                                        asym,
                                        &mut cs,
                                        base * m,
                                        acc_frame,
                                        swf_spike::recolor::PlayerColors::default(),
                                        acache,
                                    );
                                    acc_drawn += 1;
                                }
                            }
                        }
                    }
                }
                // Content bbox: symmetric X extent covers both flip states.
                let b = swf_spike::render::symbol_bounds(doc, symbol, s.frame);
                let wx = s.x * pos_scale;
                let wy = s.y * pos_scale;
                let xext = b.x0.abs().max(b.x1.abs());
                let cx0 = wx - xext * scale;
                let cx1 = wx + xext * scale;
                let cy0 = wy + b.y0 * scale;
                let cy1 = wy + b.y1 * scale;
                if cx0 < min_x {
                    min_x = cx0;
                }
                if cy0 < min_y {
                    min_y = cy0;
                }
                if cx1 > max_x {
                    max_x = cx1;
                }
                if cy1 > max_y {
                    max_y = cy1;
                }
                char_scenes.push(cs);
                placed.push((wx, wy, s.flipped));
                rendered += 1;
            }
        }
        let pre_ms = perf_now() - t_pre;
        if char_scenes.is_empty() {
            return JsValue::NULL;
        }

        if !min_x.is_finite() {
            min_x = 0.0;
            min_y = 0.0;
            max_x = 1.0;
            max_y = 1.0;
        }
        let margin = 64.0_f64;
        let off_x = margin - min_x;
        let off_y = margin - min_y;
        let span_x = (max_x - min_x + 2.0 * margin).max(1.0);
        let span_y = (max_y - min_y + 2.0 * margin).max(1.0);
        let cap = target_dim_max.min(8192).max(64);
        let tw = (span_x.ceil() as u32).min(cap).max(1);
        let th = (span_y.ceil() as u32).min(cap).max(1);

        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("real-crowd-bench"),
            size: wgpu::Extent3d {
                width: tw,
                height: th,
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
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: tw,
            height: th,
            antialiasing_method: AaConfig::Area,
        };

        // ── PER-FRAME: append all looks at real fitted positions, render. ──
        let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        let mut build_total = 0.0;
        let mut submit_total = 0.0;
        let mut scene = vello::Scene::new();
        for _ in 0..iters {
            let t_b = perf_now();
            scene.reset();
            for (k, cs) in char_scenes.iter().enumerate() {
                let (wx, wy, flipped) = placed[k];
                let base = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                    wx + off_x,
                    wy + off_y,
                ));
                let place = if flipped { base * flip_x } else { base };
                scene.append(cs, Some(place));
            }
            build_total += perf_now() - t_b;
            let t_s = perf_now();
            let _ =
                self.renderer
                    .render_to_texture(&self.device, &self.queue, &scene, &view, &params);
            submit_total += perf_now() - t_s;
        }
        let build_ms = build_total / f64::from(iters.max(1));
        let submit_ms = submit_total / f64::from(iters.max(1));

        let bitmap = self.texture_to_bitmap(&target, tw, th, "benchmarkRealCrowd");

        let result = js_sys::Object::new();
        let set = |k: &str, v: f64| {
            let _ = js_sys::Reflect::set(&result, &k.into(), &JsValue::from(v));
        };
        set("playersIn", specs.len() as f64);
        set("rendered", f64::from(rendered));
        set("accessoriesDrawn", f64::from(acc_drawn));
        set("texW", f64::from(tw));
        set("texH", f64::from(th));
        set("iters", f64::from(iters));
        set("preMsOneTime", pre_ms);
        set("buildMsPerIterAppend", build_ms);
        set("submitMsPerIter", submit_ms);
        if let Some(bmp) = bitmap {
            let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bmp);
        }
        result.into()
    }

    /// DIAG: set up the stateful ANIMATED Vello-direct crowd. Parses real
    /// players (body bundle/export, frameCount, fps, colors, flipped,
    /// real x/y, equipped accessories), per-bundle caches, fits a target
    /// texture, and pre-emits each player's frame-0 sub-scene. `realCrowdTick`
    /// then advances each player's animation and re-emits only the ones
    /// whose frame changed. `players`: array of {bundle, export, frameCount,
    /// fps, c1,c2,c3, flipped, x, y, acc:[{bundle,export,slot,animType}]}.
    #[wasm_bindgen(js_name = "realCrowdSetup")]
    pub fn real_crowd_setup(
        &mut self,
        players: JsValue,
        target_dim_max: u32,
        resolution: f32,
        retain: bool,
    ) -> JsValue {
        // A new crowd invalidates every interned look: the SubLibrary's
        // pinned ramp/atlas caches are append-only within a crowd
        // lifetime (wc3 resets these per MapEpoch for the same reason).
        self.slab_crowd.reset(&mut self.renderer);
        let scale = f64::from(resolution) / 20.0;
        let pos_scale = f64::from(resolution);
        let get_f64 = |o: &JsValue, k: &str| -> f64 {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
        };
        let get_str = |o: &JsValue, k: &str| -> String {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_default()
        };
        let get_bool = |o: &JsValue, k: &str| -> bool {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        };
        let opt_color = |c: f64| -> Option<u32> {
            let v = c as i64;
            if v > 0 {
                Some((v as u32) & 0x00FF_FFFF)
            } else {
                None
            }
        };

        let arr = js_sys::Array::from(&players);
        let mut players_vec: Vec<AnimPlayer> = Vec::with_capacity(arr.length() as usize);
        for i in 0..arr.length() {
            let o = arr.get(i);
            let bundle = get_str(&o, "bundle");
            let export = get_str(&o, "export");
            if bundle.is_empty() || export.is_empty() {
                continue;
            }
            let acc_val =
                js_sys::Reflect::get(&o, &JsValue::from_str("acc")).unwrap_or(JsValue::NULL);
            let mut acc: Vec<LookAcc> = Vec::new();
            if acc_val.is_truthy() {
                let aarr = js_sys::Array::from(&acc_val);
                for j in 0..aarr.length() {
                    let a = aarr.get(j);
                    let ab = get_str(&a, "bundle");
                    let ae = get_str(&a, "export");
                    if ab.is_empty() || ae.is_empty() {
                        continue;
                    }
                    acc.push(LookAcc {
                        bundle: ab,
                        export: ae,
                        slot: get_f64(&a, "slot") as u8,
                        anim_type: get_f64(&a, "animType") as u8,
                    });
                }
            }
            let fc = (get_f64(&o, "frameCount") as u16).max(1);
            let fps = get_f64(&o, "fps") as f32;
            let flipped = get_bool(&o, "flipped");
            let colors = swf_spike::recolor::PlayerColors([
                opt_color(get_f64(&o, "c1")),
                opt_color(get_f64(&o, "c2")),
                opt_color(get_f64(&o, "c3")),
            ]);
            // Look signature (everything but the anim frame): the retained
            // cache key prefix. Identical looks share one encoded sub-scene.
            let mut acc_sig = String::new();
            for a in &acc {
                acc_sig.push_str(&a.bundle);
                acc_sig.push(':');
                acc_sig.push_str(&a.export);
                acc_sig.push(':');
                acc_sig.push_str(&a.slot.to_string());
                acc_sig.push(',');
            }
            let sig = format!(
                "{bundle}|{export}|{}|{:?}|{acc_sig}",
                u8::from(flipped),
                colors.0
            );
            players_vec.push(AnimPlayer {
                bundle,
                export,
                frame_count: fc,
                fps: if fps > 0.0 { fps } else { 12.0 },
                colors,
                flipped,
                x: get_f64(&o, "x"),
                y: get_f64(&o, "y"),
                acc,
                sig,
                frame: 0,
            });
        }
        if players_vec.is_empty() {
            return JsValue::NULL;
        }
        // NOTE: do NOT sort here. The player Vec order is the stable index
        // contract for `crowdUpdatePositions`/`crowdUpdateFrames`/`crowdUpdateLooks`
        // (the live path writes by index). Paint order (back-to-front by y) is
        // re-derived PER FRAME inside `realCrowdRenderBatched`.

        // Per-bundle caches (required to avoid cross-bundle id collisions).
        for p in &players_vec {
            self.swf_render_caches.entry(p.bundle.clone()).or_default();
            for a in &p.acc {
                self.swf_render_caches.entry(a.bundle.clone()).or_default();
            }
        }
        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }

        // Fit the target to content bounds (symbol_bounds — NO emit/bake).
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let acc_total: u32 = players_vec.iter().map(|p| p.acc.len() as u32).sum();
        for p in &players_vec {
            let wx = p.x * pos_scale;
            let wy = p.y * pos_scale;
            if let Some(doc) = self.swf_bundles.get(&p.bundle) {
                if let Some(sym) = doc.lookup_export(&p.export) {
                    let b = swf_spike::render::symbol_bounds(doc, sym, 0);
                    let xext = b.x0.abs().max(b.x1.abs());
                    min_x = min_x.min(wx - xext * scale);
                    max_x = max_x.max(wx + xext * scale);
                    min_y = min_y.min(wy + b.y0 * scale);
                    max_y = max_y.max(wy + b.y1 * scale);
                }
            }
        }
        if !min_x.is_finite() {
            min_x = 0.0;
            min_y = 0.0;
            max_x = 1.0;
            max_y = 1.0;
        }
        let margin = 64.0_f64;
        let off_x = margin - min_x;
        let off_y = margin - min_y;
        let cap = target_dim_max.min(8192).max(64);
        let tw = (((max_x - min_x + 2.0 * margin).ceil()) as u32)
            .min(cap)
            .max(1);
        let th = (((max_y - min_y + 2.0 * margin).ceil()) as u32)
            .min(cap)
            .max(1);

        let target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("real-anim-crowd"),
            size: wgpu::Extent3d {
                width: tw,
                height: th,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            // RENDER_ATTACHMENT is required because the batched path's
            // composite pass writes this texture via a render pass (not
            // Vello's STORAGE compute write).
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());

        let count = players_vec.len() as u32;
        self.real_anim_crowd = Some(RealAnimCrowd {
            players: players_vec,
            off_x,
            off_y,
            tw,
            th,
            scale,
            pos_scale,
            retain,
            explicit_frames: false,
            look_cache: HashMap::new(),
            look_used: HashMap::new(),
            crowd_frame: 0,
            target,
            view,
            batch_size: 0,
            batch_targets: Vec::new(),
            batch_views: Vec::new(),
            retained_batches: Vec::new(),
            retained_look_cache: HashMap::new(),
            ret_batches: Vec::new(),
            composite_scratch: Vec::new(),
            composite_scratch_views: Vec::new(),
        });

        let result = js_sys::Object::new();
        let set = |k: &str, v: f64| {
            let _ = js_sys::Reflect::set(&result, &k.into(), &JsValue::from(v));
        };
        set("players", f64::from(count));
        set("retain", if retain { 1.0 } else { 0.0 });
        set("accessoriesDrawn", f64::from(acc_total));
        set("texW", f64::from(tw));
        set("texH", f64::from(th));
        // LIVE cutover: the content offset baked into the texture. A player at world
        // `(wx, wy)` (== p.x*pos_scale, p.y*pos_scale) lands at texture-local
        // `(wx + offX, wy + offY)`, so mounting the crowd sprite at `(-offX, -offY)`
        // in the player world container makes texture-local map back to world.
        set("offX", off_x);
        set("offY", off_y);
        set("posScale", pos_scale);
        set("scale", scale);
        result.into()
    }

    /// DIAG: advance the animated crowd to `time_ms`, re-emitting only the
    /// players whose animation frame changed, then render one frame to the
    /// crowd's target texture (NO readback — clean GPU timing). Returns
    /// `{ reemitted, players }`.
    #[wasm_bindgen(js_name = "realCrowdTick")]
    pub fn real_crowd_tick(&mut self, time_ms: f64) -> JsValue {
        let Some(mut crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let scale = crowd.scale;
        let pos_scale = crowd.pos_scale;
        let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        let scale_aff = vello::kurbo::Affine::scale(scale);
        let mut scene = vello::Scene::new();
        let mut acc_drawn = 0u32;
        let mut encoded = 0u32; // cache misses this tick (retained mode)
        {
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            let bundles = &self.swf_bundles;
            let caches = &self.swf_render_caches;
            if crowd.retain {
                // RETAINED ("Flash display list"): encode each unique
                // (sig, frame) look ONCE into look_cache, then per player
                // just `scene.append` the cached encoding at its transform.
                // Steady state (after one anim cycle) = zero re-encode.
                let RealAnimCrowd {
                    ref players,
                    ref mut look_cache,
                    off_x,
                    off_y,
                    ..
                } = crowd;
                for p in players {
                    let fc = p.frame_count.max(1);
                    let fps = f64::from(p.fps.max(0.001));
                    let tf = (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16;
                    let key = format!("{}|{}", p.sig, tf);
                    if !look_cache.contains_key(&key) {
                        let mut sub = vello::Scene::new();
                        acc_drawn += emit_player_look(
                            &mut ctx, bundles, caches, &p.bundle, &p.export, tf, p.flipped,
                            p.colors, &p.acc, scale_aff, &mut sub,
                        );
                        look_cache.insert(key.clone(), sub);
                        encoded += 1;
                    }
                    if let Some(sub) = look_cache.get(&key) {
                        let translate = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                            p.x * pos_scale + off_x,
                            p.y * pos_scale + off_y,
                        ));
                        let place = if p.flipped {
                            translate * flip_x
                        } else {
                            translate
                        };
                        scene.append(sub, Some(place));
                    }
                }
            } else {
                // NAIVE: re-emit EVERY player's full look from scratch
                // into one scene every tick. No cache, no pre-bake.
                for p in &crowd.players {
                    let fc = p.frame_count.max(1);
                    let fps = f64::from(p.fps.max(0.001));
                    let tf = (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16;
                    let translate = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                        p.x * pos_scale + crowd.off_x,
                        p.y * pos_scale + crowd.off_y,
                    ));
                    let base = if p.flipped {
                        translate * flip_x * scale_aff
                    } else {
                        translate * scale_aff
                    };
                    acc_drawn += emit_player_look(
                        &mut ctx, bundles, caches, &p.bundle, &p.export, tf, p.flipped, p.colors,
                        &p.acc, base, &mut scene,
                    );
                }
            }
        }
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: crowd.tw,
            height: crowd.th,
            antialiasing_method: AaConfig::Area,
        };
        let _ = self.renderer.render_to_texture(
            &self.device,
            &self.queue,
            &scene,
            &crowd.view,
            &params,
        );
        let n = crowd.players.len() as u32;
        let cache_size = crowd.look_cache.len() as u32;
        self.real_anim_crowd = Some(crowd);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"emitted".into(), &JsValue::from(n));
        let _ = js_sys::Reflect::set(&result, &"accDrawn".into(), &JsValue::from(acc_drawn));
        let _ = js_sys::Reflect::set(&result, &"encoded".into(), &JsValue::from(encoded));
        let _ = js_sys::Reflect::set(&result, &"cacheSize".into(), &JsValue::from(cache_size));
        result.into()
    }

    /// DIAG: capture `n_frames` of the animated crowd as a flipbook for
    /// visual playback. Renders each anim frame (advancing by `step_ms`)
    /// into its OWN target texture FIRST (no readback between renders —
    /// the blit-readback poisons the next render_to_texture, so we must
    /// finish all renders before reading any back), THEN reads every
    /// target back to an ImageBitmap. Returns a JS array of ImageBitmaps
    /// the caller can flipbook on a canvas (pure 2D, no further GPU).
    /// Retained path (cached encodings + append).
    #[wasm_bindgen(js_name = "realCrowdCaptureFlipbook")]
    pub fn real_crowd_capture_flipbook(&mut self, n_frames: u32, step_ms: f64) -> JsValue {
        let Some(mut crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let scale = crowd.scale;
        let pos_scale = crowd.pos_scale;
        let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        let scale_aff = vello::kurbo::Affine::scale(scale);
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: crowd.tw,
            height: crowd.th,
            antialiasing_method: AaConfig::Area,
        };
        // PASS 1: render every frame to its OWN target (no readback yet).
        let mut targets: Vec<wgpu::Texture> = Vec::with_capacity(n_frames as usize);
        for i in 0..n_frames {
            let time_ms = f64::from(i) * step_ms;
            let mut scene = vello::Scene::new();
            {
                let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
                let mut ctx = swf_spike::render::WgpuCtx {
                    device: &self.device,
                    queue: &self.queue,
                    renderer: &mut self.renderer,
                    filter_pipelines,
                    output_scale: scale,
                };
                let bundles = &self.swf_bundles;
                let caches = &self.swf_render_caches;
                let RealAnimCrowd {
                    ref players,
                    ref mut look_cache,
                    off_x,
                    off_y,
                    ..
                } = crowd;
                for p in players {
                    let fc = p.frame_count.max(1);
                    let fps = f64::from(p.fps.max(0.001));
                    let tf = (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16;
                    let key = format!("{}|{}", p.sig, tf);
                    if !look_cache.contains_key(&key) {
                        let mut sub = vello::Scene::new();
                        emit_player_look(
                            &mut ctx, bundles, caches, &p.bundle, &p.export, tf, p.flipped,
                            p.colors, &p.acc, scale_aff, &mut sub,
                        );
                        look_cache.insert(key.clone(), sub);
                    }
                    if let Some(sub) = look_cache.get(&key) {
                        let translate = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                            p.x * pos_scale + off_x,
                            p.y * pos_scale + off_y,
                        ));
                        let place = if p.flipped {
                            translate * flip_x
                        } else {
                            translate
                        };
                        scene.append(sub, Some(place));
                    }
                }
            }
            let target = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("flipbook-frame"),
                size: wgpu::Extent3d {
                    width: crowd.tw,
                    height: crowd.th,
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
            let view = target.create_view(&wgpu::TextureViewDescriptor::default());
            let _ =
                self.renderer
                    .render_to_texture(&self.device, &self.queue, &scene, &view, &params);
            targets.push(target);
        }
        // PASS 2: read every target back to an ImageBitmap (renders done,
        // so readback-poison is irrelevant).
        let arr = js_sys::Array::new();
        for t in &targets {
            if let Some(bmp) =
                self.texture_to_bitmap(t, crowd.tw, crowd.th, "realCrowdCaptureFlipbook")
            {
                arr.push(&bmp);
            }
        }
        self.real_anim_crowd = Some(crowd);
        arr.into()
    }

    /// Routes `realCrowdRenderBatched` through the Tier-7 slab path: every
    /// unique look interned once into the GPU-resident SubLibrary, the
    /// whole crowd rendered as ONE slab block straight into the crowd
    /// target (no batch textures, no composite pass). Toggling either way
    /// resets the retained slab state.
    #[wasm_bindgen(js_name = "realCrowdSetSlab")]
    pub fn real_crowd_set_slab(&mut self, enabled: bool) {
        if self.slab_mode != enabled {
            self.slab_crowd.reset(&mut self.renderer);
        }
        self.slab_mode = enabled;
    }

    /// Per-pass GPU timings of the last slab recording (gpu-timing builds
    /// only; `null` otherwise or until the first readback completes).
    #[wasm_bindgen(js_name = "slabGpuTiming")]
    pub fn slab_gpu_timing(&self) -> JsValue {
        #[cfg(feature = "gpu-timing")]
        if let Some((prepass_ms, total_ms, breakdown, dispatched, drained)) =
            self.renderer.slab_prepass_debug()
        {
            let result = js_sys::Object::new();
            let _ = js_sys::Reflect::set(
                &result,
                &"prepassMs".into(),
                &prepass_ms.map(JsValue::from).unwrap_or(JsValue::NULL),
            );
            let _ = js_sys::Reflect::set(&result, &"totalMs".into(), &JsValue::from(total_ms));
            let _ = js_sys::Reflect::set(&result, &"dispatched".into(), &JsValue::from(dispatched));
            let _ = js_sys::Reflect::set(&result, &"drained".into(), &JsValue::from(drained));
            let passes = js_sys::Object::new();
            for (label, ms) in breakdown {
                let _ = js_sys::Reflect::set(&passes, &label.into(), &JsValue::from(ms));
            }
            let _ = js_sys::Reflect::set(&result, &"passes".into(), &passes);
            return result.into();
        }
        JsValue::NULL
    }

    /// DIAG: BATCHED render — splits the Y-sorted crowd into batches of
    /// `batch_size` actors (each kept under the single-scene shape
    /// ceiling), renders each batch to its own texture (one Vello
    /// dispatch each), then alpha-composites them back-to-front onto the
    /// crowd target. This is the REAL high-count render path. Measures
    /// append + per-batch GPU + composite together (call it in a loop +
    /// await onSubmittedWorkDone in JS for end-to-end timing). Composites
    /// into `crowd.view`, so `realCrowdBitmap` reads the result.
    #[wasm_bindgen(js_name = "realCrowdRenderBatched")]
    pub fn real_crowd_render_batched(&mut self, batch_size: u32, time_ms: f64) -> JsValue {
        if batch_size == 0 {
            return JsValue::NULL;
        }
        if self.crowd_composite_pipeline.is_none() {
            self.crowd_composite_pipeline = Some(bitmap_bridge::MultiCompositePipeline::new(
                &self.device,
                &self.queue,
                wgpu::TextureFormat::Rgba8Unorm,
            ));
        }
        let Some(mut crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let n_players = crowd.players.len() as u32;
        let n_batches = n_players.div_ceil(batch_size).max(1);
        let (tw, th) = (crowd.tw, crowd.th);
        if self.slab_mode {
            // Tier-7 slab path: the whole Y-sorted crowd in one slab
            // block, rendered straight into `crowd.view` — batch
            // textures and the composite pass are skipped entirely.
            let t_build = web_time::Instant::now();
            let mut sorted_idx: Vec<usize> = (0..crowd.players.len()).collect();
            sorted_idx.sort_by(|&a, &b| {
                crowd.players[a]
                    .y
                    .partial_cmp(&crowd.players[b].y)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let scale = crowd.scale;
            let pos_scale = crowd.pos_scale;
            let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
            let scale_aff = vello::kurbo::Affine::scale(scale);
            let params = vello::RenderParams {
                base_color: Color::TRANSPARENT,
                width: tw,
                height: th,
                antialiasing_method: AaConfig::Area,
            };
            // Bound the cumulative interned set: if it has grown near the
            // SubLibrary cap, drop it and re-intern the active set this
            // frame (fallback covers the brief refill). Prevents the
            // overflow-to-sentinel state where past-cap looks render blank.
            let sublib_over = self
                .renderer
                .sub_library_stats()
                .is_some_and(|l| l.used_bytes() > SLAB_SUBLIB_RESET_BYTES);
            if sublib_over {
                self.slab_crowd.reset(&mut self.renderer);
            }
            let mut emits: Vec<slab_crowd::SlabEmit> = Vec::with_capacity(sorted_idx.len());
            let mut baked_this_frame: u32 = 0;
            {
                let RealAnimCrowd {
                    ref players,
                    off_x,
                    off_y,
                    explicit_frames,
                    ..
                } = crowd;
                let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
                let mut ctx = swf_spike::render::WgpuCtx {
                    device: &self.device,
                    queue: &self.queue,
                    renderer: &mut self.renderer,
                    filter_pipelines,
                    output_scale: scale,
                };
                let bundles = &self.swf_bundles;
                let caches = &self.swf_render_caches;
                // Per-frame bake budget (wc3's "1-decode-per-frame" idea,
                // time-bounded): a look not yet interned is baked + interned
                // synchronously, but only until this budget is spent — then
                // un-baked actors are skipped THIS frame and picked up over
                // the next few frames. Keeps the frame from stalling when a
                // burst of new (look,dir,frame) combos appears (spawn /
                // direction changes) while staying smooth at 60 fps. At
                // steady state (all looks cached) zero bakes happen.
                let bake_t0 = web_time::Instant::now();
                let mut bake_budget_left = true;
                for &idx in &sorted_idx {
                    let p = &players[idx];
                    let fc = p.frame_count.max(1);
                    let tf = if explicit_frames {
                        p.frame.min(fc - 1)
                    } else {
                        let fps = f64::from(p.fps.max(0.001));
                        (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16
                    };
                    let key = format!("{}|{}", p.sig, tf);
                    let look = if let Some(c) = self.slab_crowd.cached_look(&key) {
                        Some(c)
                    } else if bake_budget_left {
                        // Bake the look once, intern its bytes compactly
                        // (no Arc retained), cache the tiny handle.
                        let mut sub = vello::Scene::new();
                        emit_player_look(
                            &mut ctx, bundles, caches, &p.bundle, &p.export, tf, p.flipped,
                            p.colors, &p.acc, scale_aff, &mut sub,
                        );
                        let enc = sub.encoding();
                        let handle = ctx.renderer.intern_sub_transient(ctx.queue, enc, &[]);
                        let c = slab_crowd::CachedLook {
                            handle,
                            n_paths: enc.n_paths,
                            n_path_segments: enc.n_path_segments,
                            n_clips: enc.n_clips,
                        };
                        self.slab_crowd.cache_look(&p.sig, key, c);
                        baked_this_frame += 1;
                        if bake_t0.elapsed().as_secs_f64() * 1000.0 > SLAB_BAKE_BUDGET_MS {
                            bake_budget_left = false;
                        }
                        Some(c)
                    } else {
                        // Budget spent: show a nearby already-baked frame of
                        // the same look/direction so the actor stays visible
                        // (animation catches up as its exact frame warms)
                        // instead of popping out.
                        self.slab_crowd.fallback_look(&p.sig)
                    };
                    let Some(c) = look else {
                        continue;
                    };
                    let translate = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                        p.x * pos_scale + off_x,
                        p.y * pos_scale + off_y,
                    ));
                    let place = if p.flipped {
                        translate * flip_x
                    } else {
                        translate
                    };
                    emits.push(slab_crowd::SlabEmit {
                        look: c,
                        world: place,
                    });
                }
            }
            let (slab_scene, used, overflow) = slab_crowd::build_crowd_slab_scene(
                &mut self.renderer,
                &mut self.slab_crowd,
                &emits,
            );
            let build_ms = t_build.elapsed().as_secs_f64() * 1000.0;
            let render_result = slab_crowd::render_crowd_slab(
                &mut self.renderer,
                &mut self.slab_crowd,
                &self.device,
                &self.queue,
                &slab_scene,
                &params,
                &crowd.view,
            );
            // Slab path keeps no `look_cache` scenes — its working set is
            // the compact handle cache. Report its size + this frame's bakes.
            let cache_size = self.slab_crowd.unique_looks() as u32;
            self.real_anim_crowd = Some(crowd);
            let s = self.slab_crowd.last;
            let result = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&result, &"mode".into(), &"slab".into());
            let _ = js_sys::Reflect::set(&result, &"players".into(), &JsValue::from(n_players));
            let _ = js_sys::Reflect::set(&result, &"slots".into(), &JsValue::from(used));
            let _ = js_sys::Reflect::set(&result, &"overflow".into(), &JsValue::from(overflow));
            let _ = js_sys::Reflect::set(&result, &"fast".into(), &JsValue::from(s.fast));
            let _ = js_sys::Reflect::set(&result, &"cacheSize".into(), &JsValue::from(cache_size));
            let _ = js_sys::Reflect::set(
                &result,
                &"bakedThisFrame".into(),
                &JsValue::from(baked_this_frame),
            );
            let _ = js_sys::Reflect::set(&result, &"buildMs".into(), &JsValue::from(build_ms));
            let _ =
                js_sys::Reflect::set(&result, &"resolveMs".into(), &JsValue::from(s.resolve_ms));
            let _ = js_sys::Reflect::set(&result, &"uploadMs".into(), &JsValue::from(s.upload_ms));
            let _ = js_sys::Reflect::set(&result, &"runMs".into(), &JsValue::from(s.replay_ms));
            let _ = js_sys::Reflect::set(&result, &"packedKB".into(), &JsValue::from(s.packed_kb));
            let _ =
                js_sys::Reflect::set(&result, &"ok".into(), &JsValue::from(render_result.is_ok()));
            return result.into();
        }
        // (Re)create per-batch scratch textures, reused across frames.
        if crowd.batch_size != batch_size || crowd.batch_targets.len() != n_batches as usize {
            crowd.batch_targets.clear();
            crowd.batch_views.clear();
            for _ in 0..n_batches {
                let t = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("crowd-batch"),
                    size: wgpu::Extent3d {
                        width: tw,
                        height: th,
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
                let v = t.create_view(&wgpu::TextureViewDescriptor::default());
                crowd.batch_targets.push(t);
                crowd.batch_views.push(v);
            }
            crowd.batch_size = batch_size;
        }
        // Paint back-to-front: derive the z-order from CURRENT positions every
        // frame (players move, so the order baked at setup goes stale). The look
        // cache is order-independent, so this is just a Vec<usize> sort — batches
        // then walk contiguous slices of this sorted index.
        let mut sorted_idx: Vec<usize> = (0..crowd.players.len()).collect();
        sorted_idx.sort_by(|&a, &b| {
            crowd.players[a]
                .y
                .partial_cmp(&crowd.players[b].y)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let scale = crowd.scale;
        let pos_scale = crowd.pos_scale;
        let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        let scale_aff = vello::kurbo::Affine::scale(scale);
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: tw,
            height: th,
            antialiasing_method: AaConfig::Area,
        };
        // PASS 1: build + render each batch (Y-sorted contiguous chunk).
        // Split into BUILD (append cached looks), RESOLVE (Scene→Recording,
        // pure CPU — the parallelizable cost) and RUN (GPU submit) so we can
        // see the per-phase breakdown.
        let mut build_ms = 0.0f64;
        let mut resolve_ms = 0.0f64;
        let mut run_ms = 0.0f64;
        // Encoding stream byte breakdown — to size the retained-Vello win:
        // everything except `transforms` is frame-invariant (persistable on the
        // GPU); only `transforms` (the pose) re-uploads per frame.
        let mut static_b = 0u64; // path_tags + path_data + draw_tags + draw_data + styles
        let mut transforms_b = 0u64; // per-frame dynamic
        let mut n_paths_acc = 0u64;
        let mut used_keys: Vec<String> = Vec::with_capacity(sorted_idx.len());
        {
            let bsz = batch_size as usize;
            for b in 0..n_batches as usize {
                let start = b * bsz;
                let end = ((b + 1) * bsz).min(crowd.players.len());
                if start >= end {
                    break;
                }
                let t_build = web_time::Instant::now();
                let mut scene = vello::Scene::new();
                {
                    let RealAnimCrowd {
                        ref players,
                        ref mut look_cache,
                        off_x,
                        off_y,
                        explicit_frames,
                        ..
                    } = crowd;
                    let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
                    let mut ctx = swf_spike::render::WgpuCtx {
                        device: &self.device,
                        queue: &self.queue,
                        renderer: &mut self.renderer,
                        filter_pipelines,
                        output_scale: scale,
                    };
                    let bundles = &self.swf_bundles;
                    let caches = &self.swf_render_caches;
                    for &idx in &sorted_idx[start..end] {
                        let p = &players[idx];
                        let fc = p.frame_count.max(1);
                        // LIVE path: each player's real frame (set by
                        // crowdUpdateFrames). Fallback: free-run on the global clock.
                        let tf = if explicit_frames {
                            p.frame.min(fc - 1)
                        } else {
                            let fps = f64::from(p.fps.max(0.001));
                            (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16
                        };
                        let key = format!("{}|{}", p.sig, tf);
                        used_keys.push(key.clone());
                        if !look_cache.contains_key(&key) {
                            let mut sub = vello::Scene::new();
                            emit_player_look(
                                &mut ctx, bundles, caches, &p.bundle, &p.export, tf, p.flipped,
                                p.colors, &p.acc, scale_aff, &mut sub,
                            );
                            look_cache.insert(key.clone(), sub);
                        }
                        if let Some(sub) = look_cache.get(&key) {
                            let translate =
                                vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                                    p.x * pos_scale + off_x,
                                    p.y * pos_scale + off_y,
                                ));
                            let place = if p.flipped {
                                translate * flip_x
                            } else {
                                translate
                            };
                            scene.append(sub, Some(place));
                        }
                    }
                }
                build_ms += t_build.elapsed().as_secs_f64() * 1000.0;
                {
                    let enc = scene.encoding();
                    static_b += enc.path_tags.len() as u64
                        + (enc.path_data.len() as u64) * 4
                        + (enc.draw_tags.len() as u64) * 4
                        + (enc.draw_data.len() as u64) * 4
                        + (enc.styles.len() as u64) * 8;
                    transforms_b += (enc.transforms.len() as u64) * 24;
                    n_paths_acc += enc.n_paths as u64;
                }
                let t_res = web_time::Instant::now();
                let (recording, target, sub_lib_proxy) =
                    self.renderer.resolve_scene(&scene, &params);
                resolve_ms += t_res.elapsed().as_secs_f64() * 1000.0;
                let t_run = web_time::Instant::now();
                let _ = self.renderer.run_resolved(
                    &self.device,
                    &self.queue,
                    &recording,
                    target,
                    &crowd.batch_views[b],
                    sub_lib_proxy,
                );
                run_ms += t_run.elapsed().as_secs_f64() * 1000.0;
            }
        }
        // PASS 2: fold all batches back-to-front onto the crowd target in
        // ONE pass (one submit, one framebuffer write).
        let t_comp = web_time::Instant::now();
        {
            let comp = self.crowd_composite_pipeline.as_ref().unwrap();
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("crowd-composite-encoder"),
                });
            let src: Vec<&wgpu::TextureView> = crowd.batch_views.iter().collect();
            comp.composite(&self.device, &self.queue, &mut encoder, &src, &crowd.view);
            self.queue.submit(std::iter::once(encoder.finish()));
        }
        let composite_ms = t_comp.elapsed().as_secs_f64() * 1000.0;
        crowd.note_used_and_prune(&used_keys);
        let cache_size = crowd.look_cache.len() as u32;
        self.real_anim_crowd = Some(crowd);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"players".into(), &JsValue::from(n_players));
        let _ = js_sys::Reflect::set(&result, &"batches".into(), &JsValue::from(n_batches));
        let _ = js_sys::Reflect::set(&result, &"cacheSize".into(), &JsValue::from(cache_size));
        let _ = js_sys::Reflect::set(&result, &"buildMs".into(), &JsValue::from(build_ms));
        let _ = js_sys::Reflect::set(&result, &"resolveMs".into(), &JsValue::from(resolve_ms));
        let _ = js_sys::Reflect::set(&result, &"runMs".into(), &JsValue::from(run_ms));
        let _ = js_sys::Reflect::set(&result, &"compositeMs".into(), &JsValue::from(composite_ms));
        // Retained-Vello sizing: staticKB persists on GPU; only transformsKB
        // re-uploads per frame. saving = static/(static+transforms).
        let _ = js_sys::Reflect::set(
            &result,
            &"staticKB".into(),
            &JsValue::from((static_b / 1024) as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"transformsKB".into(),
            &JsValue::from((transforms_b / 1024) as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"nPaths".into(),
            &JsValue::from(n_paths_acc as u32),
        );
        result.into()
    }

    /// RETAINED-VELLO validation (Phase 2). Every player is pinned to a single
    /// `frozen_frame`, so each batch's geometry is trivially frame-invariant. The
    /// FIRST call per batch (or after a structure change) takes the SLOW path:
    /// build → `resolve_scene_reuse` → `run_reuse_full` (creates the GPU-resident
    /// scene buffer, caches the replayable recording). Later calls take the FAST
    /// path: only the transform byte-range is re-uploaded and the recording is
    /// replayed (geometry stays resident).
    ///
    /// `move_px == 0.0` → 0a (fixed positions): rewrite the IDENTICAL cached
    /// transforms — pure mechanism floor (no rebuild, no resolve). `move_px != 0.0`
    /// → 0b (moving positions, frozen geometry): rebuild the scene at shifted
    /// positions, extract the new transform stream, partial-upload + replay.
    ///
    /// Drive it from JS with an incrementing `frame_idx`. Returns the same
    /// `buildMs`/`resolveMs`/`runMs`/`compositeMs` diagnostics as the baseline
    /// `realCrowdRenderBatched`, plus `fastBatches`.
    #[wasm_bindgen(js_name = "realCrowdRenderRetainedFrozen")]
    pub fn real_crowd_render_retained_frozen(
        &mut self,
        batch_size: u32,
        frozen_frame: u16,
        frame_idx: u32,
        move_px: f64,
    ) -> JsValue {
        if batch_size == 0 {
            return JsValue::NULL;
        }
        if self.crowd_composite_pipeline.is_none() {
            self.crowd_composite_pipeline = Some(bitmap_bridge::MultiCompositePipeline::new(
                &self.device,
                &self.queue,
                wgpu::TextureFormat::Rgba8Unorm,
            ));
        }
        let Some(mut crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let n_players = crowd.players.len() as u32;
        let n_batches = n_players.div_ceil(batch_size).max(1);
        let (tw, th) = (crowd.tw, crowd.th);
        // (Re)create per-batch scratch textures. A grid change invalidates ALL
        // retained state (the resident buffers + cached recordings).
        if crowd.batch_size != batch_size || crowd.batch_targets.len() != n_batches as usize {
            crowd.batch_targets.clear();
            crowd.batch_views.clear();
            crowd.retained_batches.clear();
            self.renderer.free_all_reused();
            for _ in 0..n_batches {
                let t = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("crowd-batch"),
                    size: wgpu::Extent3d {
                        width: tw,
                        height: th,
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
                let v = t.create_view(&wgpu::TextureViewDescriptor::default());
                crowd.batch_targets.push(t);
                crowd.batch_views.push(v);
            }
            crowd.batch_size = batch_size;
        }
        if crowd.retained_batches.len() != n_batches as usize {
            crowd.retained_batches.clear();
            crowd
                .retained_batches
                .resize_with(n_batches as usize, || None);
            self.renderer.free_all_reused();
        }

        let scale = crowd.scale;
        let pos_scale = crowd.pos_scale;
        let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        let scale_aff = vello::kurbo::Affine::scale(scale);
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: tw,
            height: th,
            antialiasing_method: AaConfig::Area,
        };
        // Oscillating horizontal drift keeps moving players on-texture.
        let move_dx = move_px * ((frame_idx as f64) * 0.3).sin();

        let mut build_ms = 0.0f64;
        let mut resolve_ms = 0.0f64;
        let mut run_ms = 0.0f64;
        let mut fast_batches = 0u32;

        let bsz = batch_size as usize;
        for b in 0..n_batches as usize {
            let start = b * bsz;
            let end = ((b + 1) * bsz).min(crowd.players.len());
            if start >= end {
                break;
            }
            let token = vello::ReuseToken(b as u64);
            let struct_sig = Self::frozen_structure_sig(&crowd.players[start..end], frozen_frame);
            let fast = crowd.retained_batches[b]
                .as_ref()
                .is_some_and(|rb| rb.structure_sig == struct_sig);

            if fast {
                let rb = crowd.retained_batches[b].as_ref().unwrap();
                // Fast path. 0a: reuse identical transforms; 0b: rebuild only the
                // transform stream at shifted positions.
                let t_run = web_time::Instant::now();
                if move_px == 0.0 {
                    let _ = self.renderer.run_reuse_transforms(
                        &self.device,
                        &self.queue,
                        token,
                        &rb.recording,
                        rb.scene_buf,
                        rb.out_image,
                        &crowd.batch_views[b],
                        &rb.frozen_transform_bytes,
                        None,
                    );
                    run_ms += t_run.elapsed().as_secs_f64() * 1000.0;
                } else {
                    // Rebuild the scene at shifted positions purely to extract the
                    // new transform stream (same structure → same length/order).
                    let t_build = web_time::Instant::now();
                    let mut scene = vello::Scene::new();
                    {
                        let RealAnimCrowd {
                            ref players,
                            ref look_cache,
                            off_x,
                            off_y,
                            ..
                        } = crowd;
                        for p in &players[start..end] {
                            let tf = frozen_frame % p.frame_count.max(1);
                            let key = format!("{}|{}", p.sig, tf);
                            if let Some(sub) = look_cache.get(&key) {
                                let translate =
                                    vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                                        p.x * pos_scale + off_x + move_dx,
                                        p.y * pos_scale + off_y,
                                    ));
                                let place = if p.flipped {
                                    translate * flip_x
                                } else {
                                    translate
                                };
                                scene.append(sub, Some(place));
                            }
                        }
                    }
                    let tx_bytes: &[u8] =
                        bytemuck::cast_slice(scene.encoding().transforms.as_slice());
                    build_ms += t_build.elapsed().as_secs_f64() * 1000.0;
                    let t_run2 = web_time::Instant::now();
                    let _ = self.renderer.run_reuse_transforms(
                        &self.device,
                        &self.queue,
                        token,
                        &rb.recording,
                        rb.scene_buf,
                        rb.out_image,
                        &crowd.batch_views[b],
                        tx_bytes,
                        None,
                    );
                    run_ms += t_run2.elapsed().as_secs_f64() * 1000.0;
                }
                fast_batches += 1;
                continue;
            }

            // SLOW path: build → resolve_scene_reuse → run_reuse_full, cache batch.
            let t_build = web_time::Instant::now();
            let mut scene = vello::Scene::new();
            {
                let RealAnimCrowd {
                    ref players,
                    ref mut look_cache,
                    off_x,
                    off_y,
                    ..
                } = crowd;
                let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
                let mut ctx = swf_spike::render::WgpuCtx {
                    device: &self.device,
                    queue: &self.queue,
                    renderer: &mut self.renderer,
                    filter_pipelines,
                    output_scale: scale,
                };
                let bundles = &self.swf_bundles;
                let caches = &self.swf_render_caches;
                for p in &players[start..end] {
                    let tf = frozen_frame % p.frame_count.max(1);
                    let key = format!("{}|{}", p.sig, tf);
                    if !look_cache.contains_key(&key) {
                        let mut sub = vello::Scene::new();
                        emit_player_look(
                            &mut ctx, bundles, caches, &p.bundle, &p.export, tf, p.flipped,
                            p.colors, &p.acc, scale_aff, &mut sub,
                        );
                        look_cache.insert(key.clone(), sub);
                    }
                    if let Some(sub) = look_cache.get(&key) {
                        let translate = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                            p.x * pos_scale + off_x + move_dx,
                            p.y * pos_scale + off_y,
                        ));
                        let place = if p.flipped {
                            translate * flip_x
                        } else {
                            translate
                        };
                        scene.append(sub, Some(place));
                    }
                }
            }
            build_ms += t_build.elapsed().as_secs_f64() * 1000.0;

            let t_res = web_time::Instant::now();
            let resolved = self.renderer.resolve_scene_reuse(&scene, &params);
            resolve_ms += t_res.elapsed().as_secs_f64() * 1000.0;

            // Capture the transform region bytes for the 0a fast path.
            let off = resolved.transform_offset() as usize;
            let len = resolved.transform_len() as usize;
            let frozen_transform_bytes = resolved.packed[off..off + len].to_vec();

            let t_run = web_time::Instant::now();
            let _ = self.renderer.run_reuse_full(
                &self.device,
                &self.queue,
                token,
                &resolved,
                &crowd.batch_views[b],
            );
            run_ms += t_run.elapsed().as_secs_f64() * 1000.0;

            crowd.retained_batches[b] = Some(RetainedBatch {
                recording: resolved.recording,
                scene_buf: resolved.scene_buf,
                out_image: resolved.out_image,
                frozen_transform_bytes,
                structure_sig: struct_sig,
            });
        }

        // Composite all batches → crowd target (one pass, same as baseline).
        let t_comp = web_time::Instant::now();
        {
            let comp = self.crowd_composite_pipeline.as_ref().unwrap();
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("crowd-composite-encoder"),
                });
            let src: Vec<&wgpu::TextureView> = crowd.batch_views.iter().collect();
            comp.composite(&self.device, &self.queue, &mut encoder, &src, &crowd.view);
            self.queue.submit(std::iter::once(encoder.finish()));
        }
        let composite_ms = t_comp.elapsed().as_secs_f64() * 1000.0;

        self.real_anim_crowd = Some(crowd);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"players".into(), &JsValue::from(n_players));
        let _ = js_sys::Reflect::set(&result, &"batches".into(), &JsValue::from(n_batches));
        let _ = js_sys::Reflect::set(&result, &"fastBatches".into(), &JsValue::from(fast_batches));
        let _ = js_sys::Reflect::set(&result, &"buildMs".into(), &JsValue::from(build_ms));
        let _ = js_sys::Reflect::set(&result, &"resolveMs".into(), &JsValue::from(resolve_ms));
        let _ = js_sys::Reflect::set(&result, &"runMs".into(), &JsValue::from(run_ms));
        let _ = js_sys::Reflect::set(&result, &"compositeMs".into(), &JsValue::from(composite_ms));
        result.into()
    }

    /// DIAG (Phase-3 design): for each DISTINCT look in the current crowd, bake
    /// its look at every animation frame and report how much GEOMETRY changes
    /// across frames. `distinctGeomHashes == 1` → path_data/draw_data are
    /// frame-invariant (fully retainable: geometry resident, only transforms
    /// re-upload). `> 1` → geometry changes per frame (morph shape interpolation
    /// and/or structural appear/disappear) — those frames can't keep geometry
    /// resident as-is. `distinctTxCounts > 1` → shapes appear/disappear (the
    /// union/hide case). Requires `realCrowdSetup` first.
    #[wasm_bindgen(js_name = "analyzeFrameStability")]
    pub fn analyze_frame_stability(&mut self, max_looks: u32) -> JsValue {
        use std::hash::{Hash, Hasher};
        let Some(crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let scale_aff = vello::kurbo::Affine::scale(crowd.scale);
        let results = js_sys::Array::new();
        {
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: crowd.scale,
            };
            let bundles = &self.swf_bundles;
            let caches = &self.swf_render_caches;
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            for p in crowd.players.iter() {
                if !seen.insert(p.sig.clone()) {
                    continue;
                }
                if seen.len() as u32 > max_looks {
                    break;
                }
                let fc = p.frame_count.max(1);
                let mut geom_hashes: std::collections::HashSet<u64> =
                    std::collections::HashSet::new();
                let mut tx_counts: std::collections::HashSet<usize> =
                    std::collections::HashSet::new();
                let mut pd_words0 = 0usize;
                for f in 0..fc {
                    let mut sub = vello::Scene::new();
                    emit_player_look(
                        &mut ctx, bundles, caches, &p.bundle, &p.export, f, p.flipped, p.colors,
                        &p.acc, scale_aff, &mut sub,
                    );
                    let enc = sub.encoding();
                    if f == 0 {
                        pd_words0 = enc.path_data.len();
                    }
                    let mut h = std::collections::hash_map::DefaultHasher::new();
                    enc.path_data.hash(&mut h);
                    enc.draw_data.hash(&mut h);
                    geom_hashes.insert(h.finish());
                    tx_counts.insert(enc.transforms.len());
                }
                let o = js_sys::Object::new();
                let _ = js_sys::Reflect::set(&o, &"bundle".into(), &p.bundle.clone().into());
                let _ = js_sys::Reflect::set(&o, &"export".into(), &p.export.clone().into());
                let _ = js_sys::Reflect::set(&o, &"frames".into(), &JsValue::from(fc));
                let _ = js_sys::Reflect::set(
                    &o,
                    &"distinctGeomHashes".into(),
                    &JsValue::from(geom_hashes.len() as u32),
                );
                let _ = js_sys::Reflect::set(
                    &o,
                    &"distinctTxCounts".into(),
                    &JsValue::from(tx_counts.len() as u32),
                );
                let _ = js_sys::Reflect::set(
                    &o,
                    &"pathDataWords".into(),
                    &JsValue::from(pd_words0 as u32),
                );
                results.push(&o);
            }
        }
        self.real_anim_crowd = Some(crowd);
        results.into()
    }

    /// RETAINED-VELLO v1+v2 real-animation render. Y-sorted batches (z-order
    /// preserved). A batch whose players are ALL length-stable renders via the
    /// retained fast path: geometry resident, per-frame transform writes for every
    /// player + path_data writes for morph players whose geometry frame changed, then
    /// the cached recording is replayed. A batch containing a length-varying
    /// (structural appear/disappear) player renders via the baseline per-frame lane.
    /// Rebuild of a retained batch happens only on player-set change. Composites all
    /// batches back-to-front.
    #[wasm_bindgen(js_name = "realCrowdRenderRetained")]
    pub fn real_crowd_render_retained(&mut self, batch_size: u32, time_ms: f64) -> JsValue {
        if batch_size == 0 {
            return JsValue::NULL;
        }
        if self.crowd_composite_pipeline.is_none() {
            self.crowd_composite_pipeline = Some(bitmap_bridge::MultiCompositePipeline::new(
                &self.device,
                &self.queue,
                wgpu::TextureFormat::Rgba8Unorm,
            ));
        }
        let Some(mut crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let n_players = crowd.players.len() as u32;
        if n_players == 0 {
            self.real_anim_crowd = Some(crowd);
            return JsValue::NULL;
        }
        let (tw, th) = (crowd.tw, crowd.th);

        let scale = crowd.scale;
        let pos_scale = crowd.pos_scale;
        let off_x = crowd.off_x;
        let off_y = crowd.off_y;
        let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        let scale_aff = vello::kurbo::Affine::scale(scale);
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: tw,
            height: th,
            antialiasing_method: AaConfig::Area,
        };
        let place_of = |p: &AnimPlayer| {
            let tr = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                p.x * pos_scale + off_x,
                p.y * pos_scale + off_y,
            ));
            if p.flipped { tr * flip_x } else { tr }
        };
        let frame_of = |p: &AnimPlayer| {
            let fc = p.frame_count.max(1);
            let fps = f64::from(p.fps.max(0.001));
            (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16
        };

        // Y-sorted render order (z-order: back-to-front).
        let mut order: Vec<usize> = (0..crowd.players.len()).collect();
        order.sort_by(|&a, &b| {
            crowd.players[a]
                .y
                .partial_cmp(&crowd.players[b].y)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // PRE-PASS 1: bake RetainedLook (classify) for every distinct sig.
        {
            let RealAnimCrowd {
                ref players,
                ref mut retained_look_cache,
                ..
            } = crowd;
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            let bundles = &self.swf_bundles;
            let caches = &self.swf_render_caches;
            for p in players.iter() {
                if !retained_look_cache.contains_key(&p.sig) {
                    let mut look = bake_retained_look(
                        &mut ctx,
                        bundles,
                        caches,
                        &p.bundle,
                        &p.export,
                        p.frame_count,
                        p.flipped,
                        p.colors,
                        &p.acc,
                        scale_aff,
                    );
                    // v3: length-varying (appear/disappear) looks aren't retainable
                    // as-is — re-bake via the union/hide path to force length-stability.
                    if !look.retainable {
                        look = bake_union_look(
                            &mut ctx,
                            bundles,
                            caches,
                            &p.bundle,
                            &p.export,
                            p.frame_count,
                            p.flipped,
                            p.colors,
                            &p.acc,
                            scale_aff,
                        );
                    }
                    retained_look_cache.insert(p.sig.clone(), look);
                }
            }
        }

        // Geometry-budgeted batches: split the Y-sorted order so each batch's summed
        // path count stays under MAX_BATCH_PATHS (above ~this, Vello's bump buffers
        // overflow → silent geometry drop → black). Player count is also capped at
        // `batch_size`. A single look heavier than the budget still gets its own batch.
        const MAX_BATCH_PATHS: u32 = 5000;
        let mut batch_bounds: Vec<(usize, usize)> = Vec::new();
        {
            let mut s = 0usize;
            let mut acc = 0u32;
            let mut cnt = 0u32;
            for idx in 0..order.len() {
                let w = crowd.retained_look_cache[&crowd.players[order[idx]].sig]
                    .base_scene
                    .encoding()
                    .n_paths;
                if cnt > 0 && (acc.saturating_add(w) > MAX_BATCH_PATHS || cnt >= batch_size) {
                    batch_bounds.push((s, idx));
                    s = idx;
                    acc = 0;
                    cnt = 0;
                }
                acc = acc.saturating_add(w);
                cnt += 1;
            }
            batch_bounds.push((s, order.len()));
        }
        let n_batches = batch_bounds.len();

        // (Re)allocate per-batch textures + ret_batches + composite scratch when the
        // batch count changes. Textures are screen-sized (~3-8MB) so many are cheap.
        if crowd.batch_targets.len() != n_batches {
            crowd.batch_targets.clear();
            crowd.batch_views.clear();
            crowd.ret_batches.clear();
            self.renderer.free_all_reused();
            let mk = |extra: wgpu::TextureUsages| {
                let t = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("crowd-batch"),
                    size: wgpu::Extent3d {
                        width: tw,
                        height: th,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::STORAGE_BINDING
                        | wgpu::TextureUsages::COPY_SRC
                        | wgpu::TextureUsages::TEXTURE_BINDING
                        | extra,
                    view_formats: &[],
                });
                let v = t.create_view(&wgpu::TextureViewDescriptor::default());
                (t, v)
            };
            for _ in 0..n_batches {
                let (t, v) = mk(wgpu::TextureUsages::empty());
                crowd.batch_targets.push(t);
                crowd.batch_views.push(v);
            }
            crowd.ret_batches.resize_with(n_batches, || None);
            // Ping-pong scratch only needed when batches exceed the single-pass limit.
            crowd.composite_scratch.clear();
            crowd.composite_scratch_views.clear();
            if n_batches > bitmap_bridge::MAX_COMPOSITE_SRC {
                for _ in 0..2 {
                    let (t, v) = mk(wgpu::TextureUsages::RENDER_ATTACHMENT);
                    crowd.composite_scratch.push(t);
                    crowd.composite_scratch_views.push(v);
                }
            }
        }
        crowd.batch_size = batch_size;

        let mut build_ms = 0.0f64;
        let mut resolve_ms = 0.0f64;
        let mut run_ms = 0.0f64;
        let mut retained_n = 0u32;
        let mut rebuilds = 0u32;

        for (b, &(s, e)) in batch_bounds.iter().enumerate() {
            if s >= e {
                continue;
            }
            let token = vello::ReuseToken(b as u64);
            retained_n += 1;
            {
                let struct_sig = {
                    use std::hash::{Hash, Hasher};
                    let mut h = std::collections::hash_map::DefaultHasher::new();
                    for &i in &order[s..e] {
                        crowd.players[i].sig.hash(&mut h);
                    }
                    h.finish()
                };
                let need_rebuild = match &crowd.ret_batches[b] {
                    Some(rb) => rb.structure_sig != struct_sig,
                    None => true,
                };
                if need_rebuild {
                    rebuilds += 1;
                    let t_build = web_time::Instant::now();
                    let mut scene = vello::Scene::new();
                    let mut rps: Vec<RetPlayer> = Vec::with_capacity(e - s);
                    for &i in &order[s..e] {
                        let p = &crowd.players[i];
                        let look = &crowd.retained_look_cache[&p.sig];
                        let pd_start = scene.encoding().path_data.len() as u32;
                        let tx_start = scene.encoding().transforms.len() as u32;
                        scene.append(&look.base_scene, Some(place_of(p)));
                        rps.push(RetPlayer {
                            crowd_idx: i,
                            pd_word_start: pd_start,
                            tx_index_start: tx_start,
                            is_morph: look.is_morph,
                            resident_geom: -1,
                        });
                    }
                    build_ms += t_build.elapsed().as_secs_f64() * 1000.0;
                    let t_res = web_time::Instant::now();
                    let resolved = self.renderer.resolve_scene_reuse(&scene, &params);
                    resolve_ms += t_res.elapsed().as_secs_f64() * 1000.0;
                    let pdb = resolved.layout.path_data_base;
                    let txb = resolved.layout.transform_base;
                    self.renderer
                        .prepare_reuse(&self.device, &self.queue, token, &resolved);
                    crowd.ret_batches[b] = Some(RetBatch {
                        recording: resolved.recording,
                        scene_buf: resolved.scene_buf,
                        out_image: resolved.out_image,
                        path_data_base_words: pdb,
                        transform_base_words: txb,
                        players: rps,
                        structure_sig: struct_sig,
                        tx_scratch: Vec::new(),
                    });
                }

                let t_run = web_time::Instant::now();
                let rb = crowd.ret_batches[b].as_mut().unwrap();
                // Transforms: rebuild the whole region (one contiguous write).
                rb.tx_scratch.clear();
                for rp in rb.players.iter() {
                    let p = &crowd.players[rp.crowd_idx];
                    let look = &crowd.retained_look_cache[&p.sig];
                    let tf = frame_of(p) as usize;
                    let pt = vello_encoding::Transform::from_kurbo(&place_of(p));
                    for t in &look.frames_transforms[tf] {
                        rb.tx_scratch
                            .extend_from_slice(bytemuck::bytes_of(&(pt * *t)));
                    }
                }
                self.renderer.reuse_write(
                    &self.queue,
                    token,
                    (rb.transform_base_words as u64) * 4,
                    &rb.tx_scratch,
                );
                // Morph path_data: write only players whose geometry frame changed.
                let pdb = rb.path_data_base_words;
                for rp in rb.players.iter_mut() {
                    if !rp.is_morph {
                        continue;
                    }
                    let p = &crowd.players[rp.crowd_idx];
                    let look = &crowd.retained_look_cache[&p.sig];
                    let tf = frame_of(p) as usize;
                    let g = look.frame_geom[tf] as i32;
                    if g != rp.resident_geom {
                        let bytes: &[u8] =
                            bytemuck::cast_slice(look.unique_path_data[g as usize].as_slice());
                        let off = ((pdb + rp.pd_word_start) as u64) * 4;
                        self.renderer.reuse_write(&self.queue, token, off, bytes);
                        rp.resident_geom = g;
                    }
                }
                let _ = self.renderer.reuse_replay(
                    &self.device,
                    &self.queue,
                    token,
                    &rb.recording,
                    rb.scene_buf,
                    rb.out_image,
                    &crowd.batch_views[b],
                    None,
                    None,
                );
                run_ms += t_run.elapsed().as_secs_f64() * 1000.0;
            }
        }

        // Composite all batches back-to-front (Y order) onto the crowd target.
        // MultiCompositePipeline folds <=8 sources per pass; for more batches we
        // ping-pong through two scratch targets (accumulator is the back-most source
        // of each subsequent pass), final pass writes the crowd target.
        let t_comp = web_time::Instant::now();
        {
            let comp = self.crowd_composite_pipeline.as_ref().unwrap();
            let cap = bitmap_bridge::MAX_COMPOSITE_SRC;
            let views: Vec<&wgpu::TextureView> = crowd.batch_views.iter().collect();
            if views.len() <= cap {
                let mut encoder =
                    self.device
                        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                            label: Some("crowd-composite"),
                        });
                comp.composite(&self.device, &self.queue, &mut encoder, &views, &crowd.view);
                self.queue.submit(std::iter::once(encoder.finish()));
            } else {
                let mut written = 0usize;
                let mut acc: Option<usize> = None; // index into composite_scratch_views
                while written < views.len() {
                    let take = if acc.is_some() { cap - 1 } else { cap };
                    let take = take.min(views.len() - written);
                    let is_last = written + take == views.len();
                    let next_scratch = acc.map_or(0, |a| 1 - a);
                    let mut srcs: Vec<&wgpu::TextureView> = Vec::with_capacity(cap);
                    if let Some(a) = acc {
                        srcs.push(&crowd.composite_scratch_views[a]);
                    }
                    srcs.extend(views[written..written + take].iter().copied());
                    let dst: &wgpu::TextureView = if is_last {
                        &crowd.view
                    } else {
                        &crowd.composite_scratch_views[next_scratch]
                    };
                    let mut encoder =
                        self.device
                            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                                label: Some("crowd-composite-mp"),
                            });
                    comp.composite(&self.device, &self.queue, &mut encoder, &srcs, dst);
                    self.queue.submit(std::iter::once(encoder.finish()));
                    written += take;
                    acc = Some(next_scratch);
                }
            }
        }
        let composite_ms = t_comp.elapsed().as_secs_f64() * 1000.0;

        let look_cache_size = crowd.retained_look_cache.len() as u32;
        self.real_anim_crowd = Some(crowd);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"players".into(), &JsValue::from(n_players));
        let _ = js_sys::Reflect::set(&result, &"batches".into(), &JsValue::from(n_batches as u32));
        let _ = js_sys::Reflect::set(
            &result,
            &"retainedBatches".into(),
            &JsValue::from(retained_n),
        );
        let _ = js_sys::Reflect::set(&result, &"dynamicBatches".into(), &JsValue::from(0u32));
        let _ = js_sys::Reflect::set(&result, &"rebuilds".into(), &JsValue::from(rebuilds));
        let _ = js_sys::Reflect::set(
            &result,
            &"bakedLooks".into(),
            &JsValue::from(look_cache_size),
        );
        let _ = js_sys::Reflect::set(&result, &"buildMs".into(), &JsValue::from(build_ms));
        let _ = js_sys::Reflect::set(&result, &"resolveMs".into(), &JsValue::from(resolve_ms));
        let _ = js_sys::Reflect::set(&result, &"runMs".into(), &JsValue::from(run_ms));
        let _ = js_sys::Reflect::set(&result, &"compositeMs".into(), &JsValue::from(composite_ms));
        result.into()
    }

    /// Stable hash of a batch's `(sig, frame)` set, in player order.
    fn frozen_structure_sig(players: &[AnimPlayer], frozen_frame: u16) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        for p in players {
            p.sig.hash(&mut h);
            let tf = frozen_frame % p.frame_count.max(1);
            tf.hash(&mut h);
        }
        h.finish()
    }

    /// DIAG (threaded build): same as `realCrowdRenderBatched` but the
    /// per-batch scene BUILD (`scene.append` of cached encodings) runs in
    /// PARALLEL across the rayon thread pool — the steady-state cost is
    /// pure read-only cache access, so each batch's scene is built on its
    /// own core. Render + composite stay single-threaded (one GPU device).
    /// Requires `initThreadPool(n)` to have been awaited.
    #[cfg(feature = "threads")]
    #[wasm_bindgen(js_name = "realCrowdRenderBatchedParallel")]
    pub fn real_crowd_render_batched_parallel(&mut self, batch_size: u32, time_ms: f64) -> JsValue {
        use rayon::prelude::*;
        if batch_size == 0 {
            return JsValue::NULL;
        }
        if self.crowd_composite_pipeline.is_none() {
            self.crowd_composite_pipeline = Some(bitmap_bridge::MultiCompositePipeline::new(
                &self.device,
                &self.queue,
                wgpu::TextureFormat::Rgba8Unorm,
            ));
        }
        let Some(mut crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let n_players = crowd.players.len() as u32;
        // `batch_size` is the per-submit render cap (actors per `render_to_texture`).
        // n_batches = number of render-scenes = number of submits = composite inputs.
        let n_batches = n_players.div_ceil(batch_size).max(1);
        let (tw, th) = (crowd.tw, crowd.th);
        if crowd.batch_size != batch_size || crowd.batch_targets.len() != n_batches as usize {
            crowd.batch_targets.clear();
            crowd.batch_views.clear();
            for _ in 0..n_batches {
                let t = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("crowd-batch"),
                    size: wgpu::Extent3d {
                        width: tw,
                        height: th,
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
                let v = t.create_view(&wgpu::TextureViewDescriptor::default());
                crowd.batch_targets.push(t);
                crowd.batch_views.push(v);
            }
            crowd.batch_size = batch_size;
        }
        let scale = crowd.scale;
        let pos_scale = crowd.pos_scale;
        let off_x = crowd.off_x;
        let off_y = crowd.off_y;
        let flip_x = vello::kurbo::Affine::new([-1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        let scale_aff = vello::kurbo::Affine::scale(scale);
        let bsz = batch_size as usize;
        // PASS 0 (sequential): warm any missing (sig,frame) so the parallel
        // pass below is strictly read-only on the cache.
        {
            let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
            let mut ctx = swf_spike::render::WgpuCtx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                filter_pipelines,
                output_scale: scale,
            };
            let bundles = &self.swf_bundles;
            let caches = &self.swf_render_caches;
            let RealAnimCrowd {
                ref players,
                ref mut look_cache,
                ..
            } = crowd;
            for p in players {
                let fc = p.frame_count.max(1);
                let fps = f64::from(p.fps.max(0.001));
                let tf = (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16;
                let key = format!("{}|{}", p.sig, tf);
                if !look_cache.contains_key(&key) {
                    let mut sub = vello::Scene::new();
                    emit_player_look(
                        &mut ctx, bundles, caches, &p.bundle, &p.export, tf, p.flipped, p.colors,
                        &p.acc, scale_aff, &mut sub,
                    );
                    look_cache.insert(key, sub);
                }
            }
        }
        // PASS 1 (PARALLEL): decouple BUILD granularity from SUBMIT granularity.
        //
        // We want FEW render-scenes (few submits + few composite inputs) but MANY
        // parallel build tasks (one per core). When n_render < thread_count, a
        // naive "one task per render-scene" starves the pool, so we sub-divide
        // each render-scene's player range into `cpr` contiguous slices, build
        // all (n_render * cpr) slices in parallel, then merge each render-scene's
        // `cpr` slices back together (also in parallel — render-scenes are
        // independent). The merge is a transform-free `append`, a cheap concat
        // of encoded vectors. Contiguous slicing preserves player z-order so the
        // back-to-front composite stays correct.
        let n_render = n_batches as usize;
        let threads = rayon::current_num_threads().max(1);
        let cpr = threads.div_ceil(n_render).max(1); // slices per render-scene
        let n_build = n_render * cpr;
        let build_one = |bi: usize,
                         players: &[AnimPlayer],
                         look_cache: &std::collections::HashMap<String, vello::Scene>|
         -> vello::Scene {
            let m = bi / cpr; // which render-scene
            let c = bi % cpr; // which slice within it
            let rstart = m * bsz;
            let rend = ((m + 1) * bsz).min(players.len());
            let rlen = rend.saturating_sub(rstart);
            let cstart = rstart + (c * rlen) / cpr;
            let cend = rstart + ((c + 1) * rlen) / cpr;
            let mut scene = vello::Scene::new();
            for p in &players[cstart..cend] {
                let fc = p.frame_count.max(1);
                let fps = f64::from(p.fps.max(0.001));
                let tf = (((time_ms / 1000.0) * fps) as i64).rem_euclid(i64::from(fc)) as u16;
                let key = format!("{}|{}", p.sig, tf);
                if let Some(sub) = look_cache.get(&key) {
                    let translate = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                        p.x * pos_scale + off_x,
                        p.y * pos_scale + off_y,
                    ));
                    let place = if p.flipped {
                        translate * flip_x
                    } else {
                        translate
                    };
                    scene.append(sub, Some(place));
                }
            }
            scene
        };
        let batch_scenes: Vec<vello::Scene> = {
            let players = &crowd.players;
            let look_cache = &crowd.look_cache;
            if cpr == 1 {
                // n_render >= threads: one parallel task per render-scene, no merge.
                (0..n_render)
                    .into_par_iter()
                    .map(|m| build_one(m, players, look_cache))
                    .collect()
            } else {
                // Build fine slices in parallel...
                let slices: Vec<vello::Scene> = (0..n_build)
                    .into_par_iter()
                    .map(|bi| build_one(bi, players, look_cache))
                    .collect();
                // ...then merge each render-scene's `cpr` slices (parallel; concat).
                (0..n_render)
                    .into_par_iter()
                    .map(|m| {
                        let mut rs = vello::Scene::new();
                        for c in 0..cpr {
                            rs.append(&slices[m * cpr + c], None);
                        }
                        rs
                    })
                    .collect()
            }
        };
        // PASS 2 (sequential): render each render-scene to its target.
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: tw,
            height: th,
            antialiasing_method: AaConfig::Area,
        };
        for (b, scene) in batch_scenes.iter().enumerate() {
            let _ = self.renderer.render_to_texture(
                &self.device,
                &self.queue,
                scene,
                &crowd.batch_views[b],
                &params,
            );
        }
        // Fold all render-scene targets onto the crowd target in ONE pass.
        {
            let comp = self.crowd_composite_pipeline.as_ref().unwrap();
            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("crowd-composite-encoder"),
                });
            let src: Vec<&wgpu::TextureView> = crowd.batch_views.iter().collect();
            comp.composite(&self.device, &self.queue, &mut encoder, &src, &crowd.view);
            self.queue.submit(std::iter::once(encoder.finish()));
        }
        self.real_anim_crowd = Some(crowd);
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"players".into(), &JsValue::from(n_players));
        let _ = js_sys::Reflect::set(&result, &"batches".into(), &JsValue::from(n_batches));
        let _ = js_sys::Reflect::set(
            &result,
            &"buildScenes".into(),
            &JsValue::from(n_build as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"parallel".into(), &JsValue::from(1u32));
        result.into()
    }

    /// DIAG: read the animated crowd's current target texture back to an
    /// ImageBitmap for display. Has a GPU readback cost — call it sparsely
    /// (e.g. a few times/sec), NOT inside the measured render loop.
    #[wasm_bindgen(js_name = "realCrowdBitmap")]
    pub fn real_crowd_bitmap(&mut self) -> JsValue {
        let Some(crowd) = self.real_anim_crowd.take() else {
            return JsValue::NULL;
        };
        let bmp = self.texture_to_bitmap(&crowd.target, crowd.tw, crowd.th, "realCrowd");
        self.real_anim_crowd = Some(crowd);
        match bmp {
            Some(b) => b.into(),
            None => JsValue::NULL,
        }
    }

    /// DIAG: free the animated crowd (drops cached sub-scenes + target).
    /// Non-poisoning content probe: copies a center region of the crowd target to a
    /// MAP_READ buffer and async-maps it (event-loop-driven, NO surface present, NO
    /// device.poll) to compute the fraction of sampled pixels with alpha>10. Unlike
    /// `realCrowdBitmap` (surface blit) this can be called repeatedly without poisoning
    /// subsequent renders. Returns a Promise<number> (-1 if no crowd). `await` it in JS.
    #[wasm_bindgen(js_name = "realCrowdContentRatio")]
    pub fn real_crowd_content_ratio(&self) -> js_sys::Promise {
        let (tex, tw, th) = match &self.real_anim_crowd {
            Some(c) => (c.target.clone(), c.tw, c.th),
            None => return js_sys::Promise::resolve(&JsValue::from(-1.0)),
        };
        let device = self.device.clone();
        let queue = self.queue.clone();
        wasm_bindgen_futures::future_to_promise(async move {
            let rw = tw.min(1024);
            let rh = th.min(1024);
            let ox = (tw - rw) / 2;
            let oy = (th - rh) / 2;
            let bpr = (rw * 4).next_multiple_of(256);
            let buf = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("content-probe"),
                size: (bpr as u64) * (rh as u64),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("content-probe-enc"),
            });
            enc.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &tex,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: ox, y: oy, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: &buf,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(bpr),
                        rows_per_image: Some(rh),
                    },
                },
                wgpu::Extent3d {
                    width: rw,
                    height: rh,
                    depth_or_array_layers: 1,
                },
            );
            queue.submit(std::iter::once(enc.finish()));
            let (tx, rx) = futures_intrusive::channel::shared::oneshot_channel();
            buf.slice(..).map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send(r);
            });
            let _ = rx.receive().await;
            let mut nz = 0u32;
            let mut total = 0u32;
            {
                let data = buf.slice(..).get_mapped_range();
                for row in 0..rh {
                    let base = (row * bpr) as usize;
                    let mut x = 0u32;
                    while x < rw {
                        let i = base + (x as usize) * 4 + 3;
                        if i < data.len() {
                            total += 1;
                            if data[i] > 10 {
                                nz += 1;
                            }
                        }
                        x += 4;
                    }
                }
            }
            buf.unmap();
            buf.destroy();
            let ratio = if total > 0 {
                f64::from(nz) / f64::from(total)
            } else {
                -1.0
            };
            Ok(JsValue::from(ratio))
        })
    }

    /// LIVE cutover: expose the crowd target as a Pixi-adoptable `{texture: GPUTexture,
    /// width, height}` (no readback — same path as `createAtlas`/strips). Pixi wraps it
    /// ONCE as an `ExternalSource`; each frame `realCrowdRenderBatched` re-renders into
    /// the same texture and the JS side marks the source dirty. The GPUTexture stays
    /// valid while the crowd lives (retired by `realCrowdFree`).
    #[wasm_bindgen(js_name = "crowdTextureHandle")]
    pub fn crowd_texture_handle(&self) -> JsValue {
        let Some(crowd) = self.real_anim_crowd.as_ref() else {
            return JsValue::NULL;
        };
        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &result,
            &"texture".into(),
            &extract_gpu_texture(&crowd.target),
        );
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(crowd.tw));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(crowd.th));
        result.into()
    }

    /// LIVE cutover: update player positions IN PLACE (flat `[x0,y0,x1,y1,...]`, same
    /// order as `realCrowdSetup`) WITHOUT re-setup. Re-`setup` clears the look cache, so
    /// per-frame movement must update positions only; the next `realCrowdRenderBatched`
    /// places each player at its new x/y. The roster (player SET) must be unchanged — a
    /// spawn/despawn requires a fresh `realCrowdSetup`.
    #[wasm_bindgen(js_name = "crowdUpdatePositions")]
    pub fn crowd_update_positions(&mut self, xy: &[f64]) {
        let Some(crowd) = self.real_anim_crowd.as_mut() else {
            return;
        };
        let n = (xy.len() / 2).min(crowd.players.len());
        for i in 0..n {
            crowd.players[i].x = xy[i * 2];
            crowd.players[i].y = xy[i * 2 + 1];
        }
    }

    /// LIVE cutover: set every player's current animation frame IN PLACE (flat
    /// `[f0,f1,...]`, same order as `realCrowdSetup`). Switches the crowd to the
    /// explicit-frame path so render tracks each player's real frame instead of a
    /// global clock. The hot per-frame call alongside `crowdUpdatePositions`.
    #[wasm_bindgen(js_name = "crowdUpdateFrames")]
    pub fn crowd_update_frames(&mut self, frames: &[u32]) {
        let Some(crowd) = self.real_anim_crowd.as_mut() else {
            return;
        };
        crowd.explicit_frames = true;
        let n = frames.len().min(crowd.players.len());
        for i in 0..n {
            let fc = crowd.players[i].frame_count.max(1);
            crowd.players[i].frame = (frames[i] as u16).min(fc - 1);
        }
    }

    /// LIVE cutover: SPARSE per-player look update (anim swap / direction / colour
    /// / accessory change). `updates` is a JS array of `{ i, bundle, export,
    /// frameCount, fps, flipped, c1, c2, c3, acc[] }` for ONLY the players whose
    /// look changed this tick — recomputes that player's cache signature in place
    /// WITHOUT clearing `look_cache` (new `(sig, frame)` combos are baked lazily by
    /// the next `realCrowdRenderBatched`, old entries persist for reuse). Roster
    /// add/remove still requires a fresh `realCrowdSetup`.
    #[wasm_bindgen(js_name = "crowdUpdateLooks")]
    pub fn crowd_update_looks(&mut self, updates: JsValue) {
        let get_f64 = |o: &JsValue, k: &str| -> f64 {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0)
        };
        let get_str = |o: &JsValue, k: &str| -> String {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_default()
        };
        let get_bool = |o: &JsValue, k: &str| -> bool {
            js_sys::Reflect::get(o, &JsValue::from_str(k))
                .ok()
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        };
        let opt_color = |c: f64| -> Option<u32> {
            let v = c as i64;
            if v > 0 {
                Some((v as u32) & 0x00FF_FFFF)
            } else {
                None
            }
        };

        let arr = js_sys::Array::from(&updates);
        // Collect into owned data first so we can register caches on &mut self
        // without holding a borrow of the crowd.
        let mut new_bundles: Vec<String> = Vec::new();
        let Some(crowd) = self.real_anim_crowd.as_mut() else {
            return;
        };
        for k in 0..arr.length() {
            let o = arr.get(k);
            let i = get_f64(&o, "i") as usize;
            if i >= crowd.players.len() {
                continue;
            }
            let bundle = get_str(&o, "bundle");
            let export = get_str(&o, "export");
            if bundle.is_empty() || export.is_empty() {
                continue;
            }
            let acc_val =
                js_sys::Reflect::get(&o, &JsValue::from_str("acc")).unwrap_or(JsValue::NULL);
            let mut acc: Vec<LookAcc> = Vec::new();
            if acc_val.is_truthy() {
                let aarr = js_sys::Array::from(&acc_val);
                for j in 0..aarr.length() {
                    let a = aarr.get(j);
                    let ab = get_str(&a, "bundle");
                    let ae = get_str(&a, "export");
                    if ab.is_empty() || ae.is_empty() {
                        continue;
                    }
                    new_bundles.push(ab.clone());
                    acc.push(LookAcc {
                        bundle: ab,
                        export: ae,
                        slot: get_f64(&a, "slot") as u8,
                        anim_type: get_f64(&a, "animType") as u8,
                    });
                }
            }
            let flipped = get_bool(&o, "flipped");
            let colors = swf_spike::recolor::PlayerColors([
                opt_color(get_f64(&o, "c1")),
                opt_color(get_f64(&o, "c2")),
                opt_color(get_f64(&o, "c3")),
            ]);
            let mut acc_sig = String::new();
            for a in &acc {
                acc_sig.push_str(&a.bundle);
                acc_sig.push(':');
                acc_sig.push_str(&a.export);
                acc_sig.push(':');
                acc_sig.push_str(&a.slot.to_string());
                acc_sig.push(',');
            }
            let sig = format!(
                "{bundle}|{export}|{}|{:?}|{acc_sig}",
                u8::from(flipped),
                colors.0
            );
            let fc = (get_f64(&o, "frameCount") as u16).max(1);
            let fps = get_f64(&o, "fps") as f32;
            new_bundles.push(bundle.clone());
            let p = &mut crowd.players[i];
            p.bundle = bundle;
            p.export = export;
            p.frame_count = fc;
            p.fps = if fps > 0.0 { fps } else { 12.0 };
            p.flipped = flipped;
            p.colors = colors;
            p.acc = acc;
            p.sig = sig;
            if p.frame >= fc {
                p.frame = fc - 1;
            }
        }
        // Register per-bundle render caches for any newly-referenced bundle/acc
        // (cross-bundle id collisions otherwise produce the "10× accessory" bug).
        for b in new_bundles {
            self.swf_render_caches.entry(b).or_default();
        }
    }

    #[wasm_bindgen(js_name = "realCrowdFree")]
    pub fn real_crowd_free(&mut self) {
        // Retire any GPU-resident retained scene buffers before dropping the crowd
        // (otherwise the patched-wgpu no-op Drop leaks them).
        self.renderer.free_all_reused();
        if let Some(crowd) = self.real_anim_crowd.take() {
            // Explicitly destroy the crowd target + batch textures (patched-wgpu Drop is
            // a no-op, so dropping alone would leak them).
            crowd.target.destroy();
            for t in &crowd.batch_targets {
                t.destroy();
            }
            for t in &crowd.composite_scratch {
                t.destroy();
            }
        }
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
    pub fn render_swf_class_atlas(&mut self, bundle: &str, resolution: f32) -> JsValue {
        const BAND_PADDING_PX: u32 = 2;
        const PADDING_PX: u32 = 2;
        const MAX_ATLAS_DIM: u32 = 8192;

        if resolution <= 0.0 {
            return JsValue::NULL;
        }

        // Instrumentation accumulators. Cost is one `performance.now()`
        // per phase × N variants — negligible vs the Vello work.
        let bake_start = perf_now();
        bake_telemetry::subscene_reset();
        swf_spike::render::probe::reset();
        let mut total_scene_build_ms = 0.0_f64;
        let mut total_render_submit_ms = 0.0_f64;
        let mut total_combine_copy_ms = 0.0_f64;
        let mut total_bridge_ms = 0.0_f64;
        // Temporary scene-phase profiling accumulators (see classAtlasBake
        // log). colour/zone = wall of each build_class_variant_scene call;
        // page_append = the second-level variant→page append copies.
        // Pass1/Pass2 totals come from self.dbg_p1_ms/dbg_p2_ms.
        let mut total_colour_build_ms = 0.0_f64;
        let mut total_zone_build_ms = 0.0_f64;
        let mut total_page_append_ms = 0.0_f64;
        self.dbg_p1_ms = 0.0;
        self.dbg_p2_ms = 0.0;
        let mut t_enumerate_start = perf_now();
        let mut per_variant_log: Vec<(String, bool, bool, u32, u32, f64, f64, f64)> = Vec::new();

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
        let enumeration = self.class_enum_cache.get(bundle).expect("just inserted");
        if enumeration.exports.is_empty() {
            console_log!("renderSwfClassAtlas: bundle `{bundle}` has no character-anim exports");
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
            // Per-PRESENT-band bFix sensitivity (aligned with
            // `band_ranges`). `false` → that band is byte-identical for
            // apply_b_fix=false/true, so its sub-scene is shared across
            // both bFix cells (the subscene key collapses bFix→false).
            bfix_sensitive: Vec<bool>,
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
        for (export_name, total, has_toggle, export_b_fix, slot_count_logical) in &exports_snapshot
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
            for &apply_b_fix in if export_b_fix {
                &[false, true][..]
            } else {
                &[false][..]
            } {
                for &hat_equipped in if has_toggle {
                    &[false, true][..]
                } else {
                    &[false][..]
                } {
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
                    let band_presence =
                        swf_spike::render::compute_band_presence(doc, effective_body, 0, &slots);
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

                    // Per-band bFix sensitivity (Opt): only the band(s)
                    // actually holding a b_fix-mounted part pixel-differ
                    // between apply_b_fix=false/true. Insensitive bands
                    // share one cached sub-scene across both bFix cells.
                    // Only relevant when this export expands the bFix
                    // dimension; otherwise apply_b_fix is always false.
                    let bfix_sensitive = if apply_b_fix {
                        swf_spike::render::compute_bfix_sensitive_bands(
                            doc,
                            effective_body,
                            &band_ranges,
                        )
                    } else {
                        vec![false; band_ranges.len()]
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
                    let ideal_cols_f = ((chunk_usize as f64) * (frame_h as f64) / (frame_w as f64))
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
                        bfix_sensitive,
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
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }
        if self.combine_body_pipeline.is_none() {
            self.combine_body_pipeline =
                Some(bitmap_bridge::CombineBodyPipeline::new(&self.device));
        }

        let player_colors = swf_spike::recolor::PlayerColors::default();
        let scale = f64::from(resolution) / 20.0;

        // Ensure the bundle-shared render cache exists once for the
        // whole class. This caches flattened shape data per-bundle
        // and is reused across every variant in the loop below.
        let _ = self
            .swf_render_caches
            .entry(bundle.to_string())
            .or_default();

        let enumerate_ms = perf_now() - t_enumerate_start;
        t_enumerate_start = perf_now(); // reuse var to silence warning
        let _ = t_enumerate_start;

        // Per-page (PerPage) vs per-variant (PerVariant) bake mode.
        //
        // PerVariant was the historical path: each variant got its
        // own colour/zone/combined wgpu::Texture, two render_to_texture
        // calls, one combine pass, then a copy_texture_to_texture into
        // the page's sub-rect. That's **3 createTexture + 3 queue.submit
        // per variant × ~24 variants = ~72 GPU ops per atlas page**.
        // On WebGPU/Metal each createTexture + submit carries ~0.5-2 ms
        // fixed driver overhead regardless of workload, so the bake
        // wall is dominated by *submission* overhead, not by Vello
        // fragment shading. Measured: sprite-100 zoom 5 (~141 MP)
        // takes ~120 ms wall, of which Vello's actual shading cost
        // is ~15-30 ms.
        //
        // PerPage composes every variant's sub-scene into ONE Vello
        // scene per pass, with each sub-scene's xform pre-multiplied
        // by an `Affine::translate((packed_x, packed_y))` so the
        // variants land at their packed positions inside a page-sized
        // target. One render_to_texture per pass + one combine per
        // page = **3 createTexture + 3 queue.submit per page**, an
        // ~8-24× reduction in GPU ops.
        //
        // The historical concern (`feedback_vello_scene_overflow`)
        // about the tile encoder dropping strokes when a scene
        // exceeds ~700 paths is mitigated by (a) Vello's encoder
        // has since gained better overflow handling, (b) we already
        // split into multiple pages when the variant set is large
        // (`MAX_ATLAS_DIM` cap), so the worst-case scene size is
        // bounded by `page_area / per-cell-area`, not by the raw
        // variant count. If a per-page scene does corrupt, the JS
        // caller can toggle back via the flag below.
        //
        // Bake-mode selection. AUTO (mode 0) picks per-variant only
        // for ≥3-page atlases, where per-page's full-page rasterise +
        // huge-scene encode loses to per-variant's targeted small
        // renders (measured crossover). Modes 1/2 force a path for
        // A/B testing via `setClassAtlasBakeMode`.
        let bake_per_variant = match self.class_atlas_bake_mode {
            1 => true,
            2 => false,
            _ => page_textures.len() > 2,
        };

        if !bake_per_variant {
            // ── PER-PAGE path ─────────────────────────────────────
            // Group variants by page. Already done at pack time —
            // `variant.page_index` tells us which page each variant
            // belongs to.
            let mut variants_by_page: Vec<Vec<usize>> = vec![Vec::new(); page_textures.len()];
            for (i, v) in variants.iter().enumerate() {
                variants_by_page[v.page_index as usize].push(i);
            }
            for (page_idx, page_variants) in variants_by_page.iter().enumerate() {
                let page_w = page_textures[page_idx].width;
                let page_h = page_textures[page_idx].height;
                if page_variants.is_empty() {
                    // Empty page (shouldn't happen post-pack, but guard);
                    // still need to clear the destination to TRANSPARENT.
                    let dst_view = page_textures[page_idx]
                        .combined
                        .create_view(&wgpu::TextureViewDescriptor::default());
                    let mut enc =
                        self.device
                            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                                label: Some("class-atlas-page-empty-clear"),
                            });
                    {
                        let _ = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                            label: Some("class-atlas-page-empty-clear-pass"),
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
                    self.queue.submit(std::iter::once(enc.finish()));
                    continue;
                }

                // Compose all variants on this page into ONE colour
                // scene + ONE zone scene, with each variant's content
                // translated to its packed (x, y).
                let t_build_start = perf_now();
                let mut colour_page_scene = vello::Scene::new();
                let mut zone_page_scene = vello::Scene::new();
                for &vi in page_variants {
                    let v = &variants[vi];
                    let translate = vello::kurbo::Affine::translate(vello::kurbo::Vec2::new(
                        f64::from(v.packed_x),
                        f64::from(v.packed_y),
                    ));
                    let dbg_c0 = perf_now();
                    // Q1+Q2: dual-build (one walk) on the Colour call,
                    // append straight into the page (no variant scene).
                    self.build_class_variant_scene(
                        bundle,
                        &v.export_name,
                        swf_spike::render::RenderMode::Colour,
                        v.chunk_start,
                        v.chunk_count,
                        v.strip_h,
                        v.frame_w,
                        v.frame_h,
                        v.grid_cols as usize,
                        -v.anchor_x,
                        -v.anchor_y,
                        scale,
                        v.apply_b_fix,
                        v.hat_equipped,
                        &v.band_ranges,
                        &v.bfix_sensitive,
                        player_colors,
                        Some((&mut colour_page_scene, translate)),
                    );
                    total_colour_build_ms += perf_now() - dbg_c0;
                    let dbg_z0 = perf_now();
                    // ZoneId call: Pass 1 is all cache hits (the dual
                    // Colour walk already built the zone sub-scenes), so
                    // this is just the direct page append.
                    self.build_class_variant_scene(
                        bundle,
                        &v.export_name,
                        swf_spike::render::RenderMode::ZoneId,
                        v.chunk_start,
                        v.chunk_count,
                        v.strip_h,
                        v.frame_w,
                        v.frame_h,
                        v.grid_cols as usize,
                        -v.anchor_x,
                        -v.anchor_y,
                        scale,
                        v.apply_b_fix,
                        v.hat_equipped,
                        &v.band_ranges,
                        &v.bfix_sensitive,
                        player_colors,
                        Some((&mut zone_page_scene, translate)),
                    );
                    total_zone_build_ms += perf_now() - dbg_z0;
                    // Page append now happens inside Pass 2 (Q2) — no
                    // separate variant→page append step.
                    let _ = &mut total_page_append_ms;
                }
                let scene_build_ms = perf_now() - t_build_start;
                total_scene_build_ms += scene_build_ms;

                // Allocate page-sized colour + zone temps. The
                // memory cost is up to ~256 MB per temp × 2 = 512 MB
                // per page, plus the destination page = ~768 MB peak.
                // Apple Silicon's unified memory comfortably handles
                // this. The temps drop at end of scope; the patched
                // wgpu's Drop-is-no-op behaviour leaves them in
                // the deferred-destroy queue, which `tickDeferredDestroys`
                // drains within ~2 Pixi ticks.
                let colour_temp = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("vello_swf_class_atlas_colour_page"),
                    size: wgpu::Extent3d {
                        width: page_w,
                        height: page_h,
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
                    label: Some("vello_swf_class_atlas_zone_page"),
                    size: wgpu::Extent3d {
                        width: page_w,
                        height: page_h,
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
                    width: page_w,
                    height: page_h,
                    antialiasing_method: AaConfig::Area,
                };

                let t_render_start = perf_now();
                if let Err(e) = self.renderer.render_to_texture(
                    &self.device,
                    &self.queue,
                    &colour_page_scene,
                    &colour_view,
                    &params,
                ) {
                    console_log!(
                        "renderSwfClassAtlas[per-page colour page{page_idx}]: render error: {e}"
                    );
                    return JsValue::NULL;
                }
                if let Err(e) = self.renderer.render_to_texture(
                    &self.device,
                    &self.queue,
                    &zone_page_scene,
                    &zone_view,
                    &params,
                ) {
                    console_log!(
                        "renderSwfClassAtlas[per-page zone page{page_idx}]: render error: {e}"
                    );
                    return JsValue::NULL;
                }
                let render_submit_ms = perf_now() - t_render_start;
                total_render_submit_ms += render_submit_ms;

                // Combine directly into the page's final texture (no
                // intermediate combined_temp, no copy_texture_to_texture
                // — the combine pass's RenderPass clears + writes the
                // entire dst, which is exactly what we want for a
                // page-sized output).
                let t_combine_start = perf_now();
                {
                    let combine = self.combine_body_pipeline.as_ref().unwrap();
                    let dst_view = page_textures[page_idx]
                        .combined
                        .create_view(&wgpu::TextureViewDescriptor::default());
                    let mut encoder =
                        self.device
                            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                                label: Some("class-atlas-per-page-combine"),
                            });
                    combine.combine(
                        &self.device,
                        &mut encoder,
                        &colour_view,
                        &zone_view,
                        &dst_view,
                    );
                    self.queue.submit(std::iter::once(encoder.finish()));
                }
                let combine_copy_ms = perf_now() - t_combine_start;
                total_combine_copy_ms += combine_copy_ms;

                // Aggregate per-page row into the per_variant_log
                // ledger as a single "page=N" pseudo-entry so the
                // log line below still emits sensible content. We
                // still emit one row per variant separately for
                // per-variant diagnostics, but with zero ms (the
                // build cost is shared across the page).
                for &vi in page_variants {
                    let v = &variants[vi];
                    per_variant_log.push((
                        v.export_name.clone(),
                        v.apply_b_fix,
                        v.hat_equipped,
                        v.atlas_w,
                        v.atlas_h,
                        0.0, // scene-build shared across the page
                        0.0, // render shared across the page
                        0.0, // combine shared across the page
                    ));
                }

                // Explicitly destroy the page-sized temps NOW rather
                // than relying on `Drop`. The patched wgpu fork's
                // `Drop for WebTexture` is a no-op (see
                // `feedback_pixi_wgpu_texture_lifetime`): a plain
                // `drop()` only queues for deferred destruction, which
                // `tickDeferredDestroys` drains on Pixi ticks. But a
                // class-atlas bake is fully synchronous — no ticks fire
                // mid-bake — so a multi-page zoom-5 atlas would hold
                // every page's 256 MB colour + 256 MB zone temp live
                // at once (~1.5 GB for 3 pages), and a back-to-back
                // sweep across 24 bundles would never let the queue
                // drain → GPU OOM / WindowServer crash. `destroy()`
                // forwards to `GPUTexture.destroy()` immediately,
                // capping peak GPU at ~768 MB (one page's temps).
                colour_temp.destroy();
                zone_temp.destroy();
            }
        } else {
            // ── PER-VARIANT path ──────────────────────────────────
            // Historical / fallback path. Pre-clear every page once
            // (the combine pass below only writes the variant
            // sub-rect, so pixels outside any variant stay at the
            // cleared transparent value).
            for page_tex in &page_textures {
                let dst_view = page_tex
                    .combined
                    .create_view(&wgpu::TextureViewDescriptor::default());
                let mut encoder =
                    self.device
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
                    &variant.bfix_sensitive,
                    player_colors,
                    // Per-variant bake path: no page dest — build a
                    // standalone variant scene (rendered to its own texture).
                    None,
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
                    &variant.bfix_sensitive,
                    player_colors,
                    // Per-variant bake path: no page dest — build a
                    // standalone variant scene (rendered to its own texture).
                    None,
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
                        self.device
                            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
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
        } // end of `else { /* PER-VARIANT path */ }`

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
            let _ =
                js_sys::Reflect::set(&page_obj, &"atlasWidth".into(), &JsValue::from(page.width));
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
        let probe = swf_spike::render::probe::take();
        let bfix_vars = variants.iter().filter(|v| v.apply_b_fix).count();
        let hat_vars = variants.iter().filter(|v| v.hat_equipped).count();
        let (sub_hits, sub_misses) = bake_telemetry::peek_subscene();
        console_log!(
            "classAtlasBake bundle={bundle} vars={} pages={} enumerate={:.2} scene={:.2} \
             render={:.2} combineCopy={:.2} bridge={:.2} total={:.2} pageDims={} \
             [scene split: p1emit={:.2} p2append={:.2} colour={:.2} zone={:.2} pageAppend={:.2}] \
             [probe: subMiss={} subHit={} bfixVars={} hatVars={} bfixZeroFlip={} maskCalls={} maskFlat={} shapeFlat={} fsMiss={}]",
            variants.len(),
            page_count,
            enumerate_ms,
            total_scene_build_ms,
            total_render_submit_ms,
            total_combine_copy_ms,
            total_bridge_ms,
            total_wall_ms,
            page_dim_summary,
            self.dbg_p1_ms,
            self.dbg_p2_ms,
            total_colour_build_ms,
            total_zone_build_ms,
            total_page_append_ms,
            sub_misses,
            sub_hits,
            bfix_vars,
            hat_vars,
            probe.bfix_zero_flip_builds,
            probe.mask_path_calls,
            probe.mask_path_flattens,
            probe.shape_flattens,
            probe.frame_state_misses,
        );
        // Telemetry: also record this bake in the structured channel.
        // The console_log above stays for ad-hoc grepping during dev;
        // the structured record is what drives the per-burst digest.
        {
            let (hits, misses) = bake_telemetry::subscene_take();
            // Sum of all page areas — diagnostic only; tells us if we
            // were GPU-bound (large area, large gpu_render_ms) vs
            // CPU-bound (small area, large scene_build_ms).
            let mut pixel_area: u64 = 0;
            for p in &page_dim_summary
                .split(',')
                .filter_map(|s| {
                    let mut parts = s.split('x');
                    let w: u64 = parts.next()?.parse().ok()?;
                    let h: u64 = parts.next()?.parse().ok()?;
                    Some(w * h)
                })
                .collect::<Vec<u64>>()
            {
                pixel_area += *p;
            }
            bake_telemetry::Builder::new(bake_telemetry::BakeKind::ClassAtlas, bundle)
                .enumerate(enumerate_ms)
                .scene_build(total_scene_build_ms)
                .gpu_render(total_render_submit_ms)
                .combine_copy(total_combine_copy_ms)
                .bridge(total_bridge_ms)
                .total(total_wall_ms)
                .subscene(hits, misses)
                .pixel_area(pixel_area)
                .sub_count(variants.len() as u32)
                .commit();
        }
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
        let _ = js_sys::Reflect::set(&result, &"bFixUsed".into(), &JsValue::from_bool(b_fix_used));
        let variants_arr = js_sys::Array::new();
        for v in &variants {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(
                &obj,
                &"exportName".into(),
                &JsValue::from_str(&v.export_name),
            );
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
            let _ = js_sys::Reflect::set(
                &obj,
                &"totalFrameCount".into(),
                &JsValue::from(v.total_frame_count),
            );
            let _ = js_sys::Reflect::set(&obj, &"anchorX".into(), &JsValue::from(v.anchor_x));
            let _ = js_sys::Reflect::set(&obj, &"anchorY".into(), &JsValue::from(v.anchor_y));
            let _ =
                js_sys::Reflect::set(&obj, &"bandPadding".into(), &JsValue::from(BAND_PADDING_PX));
            let _ = js_sys::Reflect::set(
                &obj,
                &"bandCount".into(),
                &JsValue::from(v.present_logical.len() as u32),
            );
            let _ = js_sys::Reflect::set(&obj, &"slotCount".into(), &JsValue::from(v.slot_count));
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
        let mut exports: Vec<ClassEnumerationExport> = Vec::with_capacity(candidates.len());
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
            let export_b_fix = bundle_b_fix_used && swf_spike::render::export_uses_b_fix(doc, body);
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
        // Per-band bFix sensitivity (aligned with `band_ranges`). For an
        // insensitive band the sub-scene key collapses bFix→false, so
        // both bFix variants share one cached encoding (the band is
        // byte-identical for apply_b_fix=false/true). See
        // `compute_bfix_sensitive_bands`.
        bfix_sensitive: &[bool],
        player_colors: swf_spike::recolor::PlayerColors,
        // Q2 — collapse the double append. When `Some((page, translate))`,
        // Pass 2 appends each sub-scene DIRECTLY into the page scene with
        // `translate * cell_xform` (Vello pre-multiplies, so this equals
        // appending into a per-variant scene then appending that into the
        // page) — eliminating the per-variant intermediate scene + its
        // extra append. `None` keeps the standalone per-variant build
        // (the ≥3-page bake path that renders each variant separately).
        page_dest: Option<(&mut vello::Scene, vello::kurbo::Affine)>,
    ) -> vello::Scene {
        const BAND_PADDING_PX: u32 = 2;
        let mode_u8 = match mode {
            swf_spike::render::RenderMode::Colour => 0u8,
            swf_spike::render::RenderMode::ZoneId => 1u8,
        };

        // Pass 1 — populate `body_subscene_cache` for every (frame,
        // band) tuple we'll need. Sub-scenes are built with
        // `transform = effective_xform`; path coords land in twip
        // space, no `output_scale` dependency (compute filter path is
        // `cfg`-off on wasm32). The cache key omits `scale`, so a
        // zoom change reuses every entry.
        //
        // Loop order matches the legacy Opt-3 invariant — frame outer,
        // band inner — so the per-bundle `RenderCache.frame_state`
        // memo hits 4 of every 5 band calls on a cold population.
        // On a warm cache this pass is pure HashMap lookups + skips.
        // Pass 1 — single-walk dual build. For each (frame, band) we
        // build BOTH the Colour sub-scene and the ZoneId sub-scene in
        // ONE `render_body_band_dual` traversal and cache both (mode 0
        // + mode 1). They're always inserted as a pair, so presence of
        // the Colour key (mode 0) means both exist. The result: the
        // second build_class_variant_scene call (ZoneId) finds every
        // sub-scene already cached → Pass 1 is pure HashMap hits, no
        // second walk. Byte-identical: each sub-scene equals what the
        // old per-mode `render_body_band` produced.
        let p1_start = perf_now();
        for slot in 0..chunk_count {
            let frame_idx = (chunk_start + slot) as u16;
            for (band_idx, &band) in band_ranges.iter().enumerate() {
                // Collapse bFix→false for bands that can't flip, so this
                // build is shared with the apply_b_fix=false variant.
                let eff_b_fix =
                    apply_b_fix && bfix_sensitive.get(band_idx).copied().unwrap_or(true);
                let colour_key = BodySubsceneKey {
                    bundle: bundle.to_string(),
                    export: export.to_string(),
                    apply_b_fix: eff_b_fix,
                    hat_equipped,
                    mode: 0,
                    frame_idx,
                    band_lo: band.lo_exclusive,
                    band_hi: band.hi_inclusive,
                };
                if self.body_subscene_cache.contains_key(&colour_key) {
                    bake_telemetry::subscene_hit();
                    continue;
                }
                bake_telemetry::subscene_miss();
                swf_spike::render::probe::bfix_flips_reset();
                let mut colour_sub = vello::Scene::new();
                let mut zone_sub = vello::Scene::new();
                {
                    let doc = self
                        .swf_bundles
                        .get(bundle)
                        .expect("bundle vetted by caller");
                    let symbol = doc.lookup_export(export).expect("export vetted by caller");
                    let (effective_sym, effective_xform) =
                        swf_spike::render::find_effective_body_symbol(doc, symbol, 0);
                    let filter_pipelines =
                        self.swf_filter_pipelines.as_ref().expect("init by caller");
                    let cache: &swf_spike::render::cache::RenderCache = self
                        .swf_render_caches
                        .entry(bundle.to_string())
                        .or_default();
                    let mut wctx = swf_spike::render::WgpuCtx {
                        device: &self.device,
                        queue: &self.queue,
                        renderer: &mut self.renderer,
                        filter_pipelines,
                        // Unused on wasm32 — the compute filter path
                        // that reads `output_scale` is `cfg`-off; the
                        // halo fallback emits pure twip path commands.
                        output_scale: 1.0,
                    };
                    swf_spike::render::render_body_band_dual(
                        &mut wctx,
                        doc,
                        effective_sym,
                        &mut colour_sub,
                        &mut zone_sub,
                        effective_xform,
                        frame_idx,
                        band,
                        player_colors,
                        cache,
                        eff_b_fix,
                        hat_equipped,
                    );
                }
                if eff_b_fix && swf_spike::render::probe::bfix_flips_peek() == 0 {
                    swf_spike::render::probe::note_bfix_zero_flip_build();
                }
                let zone_key = BodySubsceneKey {
                    mode: 1,
                    ..colour_key.clone()
                };
                self.body_subscene_cache.insert(colour_key, colour_sub);
                self.body_subscene_cache.insert(zone_key, zone_sub);
            }
        }
        self.dbg_p1_ms += perf_now() - p1_start;

        // Pass 2 — assemble the variant atlas scene. `scene.append`
        // pre-multiplies its `Option<Affine>` over every transform in
        // the child encoding, so applying `scale.then_translate(target)`
        // here yields the exact same final transform as the legacy
        // path (`scale.then_translate(target) * effective_xform`) —
        // because `effective_xform` is already baked into the cached
        // sub-scene's commands.
        let p2_start = perf_now();
        let mut scene = vello::Scene::new();
        let mut page_dest = page_dest;
        for slot in 0..chunk_count {
            let frame_idx = (chunk_start + slot) as u16;
            let col = (slot as usize) % grid_cols;
            let row = (slot as usize) / grid_cols;
            let cell_x = (col * frame_w as usize) as f64;
            for (band_idx, &band) in band_ranges.iter().enumerate() {
                let band_atlas_y =
                    (band_idx as f64) * (f64::from(strip_h) + f64::from(BAND_PADDING_PX));
                let cell_y = band_atlas_y + (row * frame_h as usize) as f64;
                let cell_xform = vello::kurbo::Affine::scale(scale).then_translate(
                    vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y + cell_y),
                );
                let eff_b_fix =
                    apply_b_fix && bfix_sensitive.get(band_idx).copied().unwrap_or(true);
                let key = BodySubsceneKey {
                    bundle: bundle.to_string(),
                    export: export.to_string(),
                    apply_b_fix: eff_b_fix,
                    hat_equipped,
                    mode: mode_u8,
                    frame_idx,
                    band_lo: band.lo_exclusive,
                    band_hi: band.hi_inclusive,
                };
                let sub_scene = self
                    .body_subscene_cache
                    .get(&key)
                    .expect("ensured by Pass 1");
                if let Some((page, translate)) = page_dest.as_mut() {
                    // Q2: append straight into the page at its packed
                    // offset — no per-variant intermediate scene.
                    page.append(sub_scene, Some(*translate * cell_xform));
                } else {
                    scene.append(sub_scene, Some(cell_xform));
                }
            }
        }
        self.dbg_p2_ms += perf_now() - p2_start;
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
        let bake_start = perf_now();
        bake_telemetry::subscene_reset();
        let Some(acc_doc) = self.swf_bundles.get(acc_bundle) else {
            console_log!("renderSwfAccessoryStrip: bundle `{acc_bundle}` not loaded");
            return JsValue::NULL;
        };
        let Some(acc_sym) = acc_doc.lookup_export(acc_export) else {
            console_log!("renderSwfAccessoryStrip: export `{acc_bundle}/{acc_export}` not found");
            return JsValue::NULL;
        };

        let dir_char = dir.chars().next().unwrap_or('R').to_ascii_uppercase();
        let dir_str = dir_char.to_string();
        let side_str = if side.is_empty() {
            dir_str.clone()
        } else {
            side
        };
        let slot_u8 = slot as u8;
        let anim_type_u8 = anim_type as u8;

        // Resolve the 3 sub-frames + their union bounds. Using the
        // union keeps cell size + anchor stable across cycles so the
        // Pixi sprite swap is a free pointer flip.
        let mut frame_indices = [0u16; 3];
        let mut union: Option<vello::kurbo::Rect> = None;
        for cycle in 0u16..3u16 {
            let f = swf_spike::render::pick_accessory_frame(
                acc_doc,
                acc_sym,
                slot_u8,
                anim_type_u8,
                &side_str,
                cycle,
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
            console_log!("renderSwfAccessoryStrip: strip {strip_w}x{strip_h} exceeds GPU limits");
            return JsValue::NULL;
        }

        if self.swf_filter_pipelines.is_none() {
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
        }

        // Twip-identity sub-scene cache. For each of the 3 cycles,
        // look up `(bundle, export, slot, anim_type, side, cycle)`;
        // if present, reuse the cached scene. On miss, build it at
        // `Affine::IDENTITY` and insert. Then compose the final strip
        // scene by appending each sub-scene under the per-cycle
        // `scale × translate` xform — `scene.append(sub, Some(M))`
        // pre-multiplies M over every transform inside the sub-scene
        // (see vello::Scene::append), so the output is identical to
        // the legacy inline path.
        //
        // Why this matters: a zoom change used to force 3 fresh AS2
        // walks per accessory bake. With ~4 accessories × 250 bots
        // that's ~3000 redundant walks per zoom. After this refactor
        // the AS2 work is amortized across resolutions.
        let pad_cycles: u32 = grid_cols; // = 3, matches strip layout
        let mut cycle_keys: Vec<scene_cache::AccessorySubsceneKey> =
            Vec::with_capacity(pad_cycles as usize);
        for cycle in 0u32..pad_cycles {
            cycle_keys.push(scene_cache::AccessorySubsceneKey {
                bundle: acc_bundle.to_string(),
                export: acc_export.to_string(),
                slot: slot_u8,
                anim_type: anim_type_u8,
                side: side_str.clone(),
                cycle: cycle as u8,
            });
        }

        // Pass 1 — populate the sub-scene cache for every cycle.
        // Split into pre-checks so we never hold `&mut self.renderer`
        // alongside `&mut self.acc_subscenes` (both required by
        // `render_symbol_with_ctx_cached`).
        for (cycle_idx, key) in cycle_keys.iter().enumerate() {
            if self.acc_subscenes.contains_key(key) {
                bake_telemetry::subscene_hit();
                continue;
            }
            bake_telemetry::subscene_miss();
            let mut sub_scene = vello::Scene::new();
            {
                let cache: &swf_spike::render::cache::RenderCache = self
                    .swf_render_caches
                    .entry(acc_bundle.to_string())
                    .or_default();
                let filter_pipelines = self.swf_filter_pipelines.as_ref().unwrap();
                let mut wctx = swf_spike::render::WgpuCtx {
                    device: &self.device,
                    queue: &self.queue,
                    renderer: &mut self.renderer,
                    filter_pipelines,
                    // Twip-identity render — the compute filter path
                    // that reads `output_scale` is `cfg`-off on
                    // wasm32, so this argument is unused for tiles/
                    // accessories. See swf-spike/src/render/filter.rs.
                    output_scale: 1.0,
                };
                swf_spike::render::render_symbol_with_ctx_cached(
                    &mut wctx,
                    acc_doc,
                    acc_sym,
                    &mut sub_scene,
                    vello::kurbo::Affine::IDENTITY,
                    frame_indices[cycle_idx],
                    cache,
                );
            }
            self.acc_subscenes.insert(key.clone(), sub_scene);
        }

        // Pass 2 — assemble the strip scene.
        let mut scene = vello::Scene::new();
        for (cycle_idx, key) in cycle_keys.iter().enumerate() {
            let cell_x = (cycle_idx as u32 * frame_w) as f64;
            let xform = vello::kurbo::Affine::scale(scale)
                .then_translate(vello::kurbo::Vec2::new(-px_min_x + cell_x, -px_min_y));
            let sub_ref = self.acc_subscenes.get(key).expect("ensured by Pass 1");
            scene.append(sub_ref, Some(xform));
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
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(3u32));
        let _ = js_sys::Reflect::set(&result, &"gridCols".into(), &JsValue::from(grid_cols));
        let _ = js_sys::Reflect::set(&result, &"anchorX".into(), &JsValue::from(-px_min_x));
        let _ = js_sys::Reflect::set(&result, &"anchorY".into(), &JsValue::from(-px_min_y));
        {
            let (hits, misses) = bake_telemetry::subscene_take();
            bake_telemetry::Builder::new(bake_telemetry::BakeKind::AccessoryStrip, acc_bundle)
                .total(perf_now() - bake_start)
                .subscene(hits, misses)
                .pixel_area(u64::from(strip_w) * u64::from(strip_h))
                .sub_count(grid_cols)
                .commit();
        }
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
            console_log!("renderSwfMountTransforms: export `{bundle}/{export}` not found");
            return JsValue::NULL;
        };
        let (matrices, presence) = swf_spike::render::mount_transforms::extract_mount_transforms(
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
        if acc_bundles.len() != n_acc || acc_exports.len() != n_acc || acc_anim_types.len() != n_acc
        {
            console_log!("renderSwfStripRangeAccessorized: parallel array length mismatch");
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
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
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

            let xform = vello::kurbo::Affine::scale(scale).then_translate(vello::kurbo::Vec2::new(
                -px_min_x + cell_x,
                -px_min_y + cell_y,
            ));

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
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(chunk_count));
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
        if acc_bundles.len() != n_acc || acc_exports.len() != n_acc || acc_anim_types.len() != n_acc
        {
            console_log!("renderSwfStripRangeAccessorizedBitmap: parallel array length mismatch");
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
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
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
            let xform = vello::kurbo::Affine::scale(scale).then_translate(vello::kurbo::Vec2::new(
                -px_min_x + cell_x,
                -px_min_y + cell_y,
            ));
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
                console_log!("renderSwfStripRangeAccessorizedBitmap: bridge error: {e:?}");
                return JsValue::NULL;
            }
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(chunk_count));
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
            let xform = vello::kurbo::Affine::scale(scale).then_translate(vello::kurbo::Vec2::new(
                -px_min_x + cell_x,
                -px_min_y + cell_y,
            ));
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

        let Some(bitmap) =
            self.texture_to_bitmap(&texture, strip_w, strip_h, "renderSwfTileDynamicStripRange")
        else {
            return JsValue::NULL;
        };

        let result = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&result, &"bitmap".into(), &bitmap);
        let _ = js_sys::Reflect::set(&result, &"width".into(), &JsValue::from(strip_w));
        let _ = js_sys::Reflect::set(&result, &"height".into(), &JsValue::from(strip_h));
        let _ = js_sys::Reflect::set(&result, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&result, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        let _ = js_sys::Reflect::set(&result, &"frameCount".into(), &JsValue::from(chunk_count));
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
            self.swf_filter_pipelines =
                Some(swf_spike::wgpu_filters::FilterPipelines::new(&self.device));
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
            let xform = vello::kurbo::Affine::scale(scale).then_translate(vello::kurbo::Vec2::new(
                -item.px_min_x + f64::from(place_x),
                -item.px_min_y + f64::from(place_y),
            ));
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
            deferred_destroy::tick_deferred_destroys(min_age_frames, max_destroys_per_tick);
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
            lt as f64, lb as f64, ct as f64, cb as f64, dt as f64, db as f64, pt as f64, pb as f64,
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
        let side_str = if side.is_empty() {
            dir_str.clone()
        } else {
            side.to_string()
        };
        let slot_u8 = slot as u8;
        let anim_type_u8 = anim_type as u8;

        // Frame sequence at the queried anim_type.
        let target: [u16; 3] = [
            swf_spike::render::pick_accessory_frame(
                acc_doc,
                acc_sym,
                slot_u8,
                anim_type_u8,
                &side_str,
                0,
            ),
            swf_spike::render::pick_accessory_frame(
                acc_doc,
                acc_sym,
                slot_u8,
                anim_type_u8,
                &side_str,
                1,
            ),
            swf_spike::render::pick_accessory_frame(
                acc_doc,
                acc_sym,
                slot_u8,
                anim_type_u8,
                &side_str,
                2,
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
        let (lbg, cbg, dbg, ltv, ctv, dtv, lsa, csa, dsa) = deferred_destroy::object_counts();
        vec![
            lbg as f64, cbg as f64, dbg as f64, ltv as f64, ctv as f64, dtv as f64, lsa as f64,
            csa as f64, dsa as f64,
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
        let Some(swf_spike::swf_doc::Symbol::Sprite(top)) = doc.lookup_export(export) else {
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
                        if let Some(swf_spike::swf_doc::Symbol::Sprite(child)) = doc.lookup_id(id) {
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
        use swf_spike::swf_doc::{OwnedOp, Symbol, TileScriptKind, avm1_classify_frame1};
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
                            && matches!(avm1_classify_frame1(bc), Some(TileScriptKind::Random))
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
        fn recurse(
            doc: &swf_spike::swf_doc::SwfDoc,
            sp: &swf_spike::swf_doc::OwnedSprite,
            depth: u32,
            best: &mut u16,
        ) {
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

    /// List every loaded SWF bundle by the name passed to
    /// `loadSwfBundle`. Used by diagnostic sweeps that need to iterate
    /// the actual loaded set rather than a hand-curated list.
    #[wasm_bindgen(js_name = "listLoadedSwfBundles")]
    pub fn list_loaded_swf_bundles(&self) -> Vec<String> {
        let mut names: Vec<String> = self.swf_bundles.keys().cloned().collect();
        names.sort();
        names
    }

    /// Dump full inventory of a loaded SWF bundle for diagnostic sweeps.
    /// Returns an array of `{ name, kind, totalFrames, isCharacterAnim }`
    /// — one row per named export. `kind` is `"Sprite" | "Shape" |
    /// "MorphShape" | "Bitmap"`. `totalFrames` uses the same recursive
    /// resolver as `swfAnimFrameCount` (0 for non-Sprite exports).
    /// `isCharacterAnim` mirrors the `is_character_anim_name` filter
    /// used by `renderSwfClassAtlas`.
    ///
    /// Caller can roll up the result to answer "of the 110+ named
    /// exports, how many go through the class atlas vs the single-
    /// variant runtime path?".
    #[wasm_bindgen(js_name = "dumpSwfBundleInventory")]
    pub fn dump_swf_bundle_inventory(&self, bundle: &str) -> JsValue {
        let Some(doc) = self.swf_bundles.get(bundle) else {
            return JsValue::NULL;
        };
        let arr = js_sys::Array::new();
        let mut names: Vec<&String> = doc.by_name.keys().collect();
        names.sort();
        for name in names {
            let id = match doc.by_name.get(name) {
                Some(i) => *i,
                None => continue,
            };
            let sym = match doc.by_id.get(&id) {
                Some(s) => s,
                None => continue,
            };
            let kind: &'static str = match sym {
                swf_spike::swf_doc::Symbol::Sprite(_) => "Sprite",
                swf_spike::swf_doc::Symbol::Shape(_) => "Shape",
                swf_spike::swf_doc::Symbol::MorphShape(_) => "MorphShape",
                swf_spike::swf_doc::Symbol::Bitmap(_) => "Bitmap",
            };
            let total_frames = if matches!(sym, swf_spike::swf_doc::Symbol::Sprite(_)) {
                self.swf_anim_frame_count(bundle, name)
            } else {
                0
            };
            let row = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&row, &"name".into(), &JsValue::from_str(name));
            let _ = js_sys::Reflect::set(&row, &"kind".into(), &JsValue::from_str(kind));
            let _ = js_sys::Reflect::set(&row, &"totalFrames".into(), &JsValue::from(total_frames));
            let _ = js_sys::Reflect::set(
                &row,
                &"isCharacterAnim".into(),
                &JsValue::from_bool(is_character_anim_name(name)),
            );
            arr.push(&row.into());
        }
        arr.into()
    }

    /// Dump the `ClassEnumeration` produced by `compute_class_enumeration`
    /// for diagnostic sweeps. Returns
    /// `{ bundleBFixUsed, exports: [{ exportName, totalFrameCount,
    /// hasToggle, exportBFix, slotCountLogical }] }` or `null` if the
    /// bundle isn't loaded.
    ///
    /// Read-only: builds a fresh enumeration without touching
    /// `class_enum_cache` (so the diagnostic doesn't accidentally
    /// short-circuit a subsequent `renderSwfClassAtlas` call).
    #[wasm_bindgen(js_name = "dumpClassEnumeration")]
    pub fn dump_class_enumeration(&self, bundle: &str) -> JsValue {
        if !self.swf_bundles.contains_key(bundle) {
            return JsValue::NULL;
        }
        let enumeration = self.compute_class_enumeration(bundle);
        let exports_arr = js_sys::Array::new();
        for e in &enumeration.exports {
            let row = js_sys::Object::new();
            let _ = js_sys::Reflect::set(
                &row,
                &"exportName".into(),
                &JsValue::from_str(&e.export_name),
            );
            let _ = js_sys::Reflect::set(
                &row,
                &"totalFrameCount".into(),
                &JsValue::from(e.total_frame_count),
            );
            let _ =
                js_sys::Reflect::set(&row, &"hasToggle".into(), &JsValue::from_bool(e.has_toggle));
            let _ = js_sys::Reflect::set(
                &row,
                &"exportBFix".into(),
                &JsValue::from_bool(e.export_b_fix),
            );
            let _ = js_sys::Reflect::set(
                &row,
                &"slotCountLogical".into(),
                &JsValue::from(e.slot_count_logical),
            );
            exports_arr.push(&row.into());
        }
        let out = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &out,
            &"bundleBFixUsed".into(),
            &JsValue::from_bool(enumeration.bundle_b_fix_used),
        );
        let _ = js_sys::Reflect::set(&out, &"exports".into(), &exports_arr.into());
        out.into()
    }

    /// Report `body_scene_cache` health (the composed-atlas LRU at
    /// 1500 cap used by `render_swf_body_atlas`). v4 architecture
    /// decision blocks on whether this LRU thrashes at 250-bot stress.
    /// Returns:
    ///   - `entries`: current live entry count (≤ 1500)
    ///   - `cap`: BODY_SCENE_CACHE_CAP constant
    ///   - `hits`: cumulative hits since renderer init
    ///   - `misses`: cumulative misses since renderer init
    ///   - `evictions`: cumulative LRU evictions since renderer init
    ///   - `hitRate`: hits / (hits + misses); 0.0 if no accesses yet
    /// Set the class-atlas bake mode: 0 = AUTO (per-page for ≤2 pages,
    /// per-variant for ≥3), 1 = force per-variant, 2 = force per-page.
    /// See the `class_atlas_bake_mode` field doc for the measured
    /// crossover rationale.
    #[wasm_bindgen(js_name = "setClassAtlasBakeMode")]
    pub fn set_class_atlas_bake_mode(&mut self, mode: u8) {
        self.class_atlas_bake_mode = mode;
    }

    /// Legacy A/B toggle. `true` → force per-variant (mode 1);
    /// `false` → force per-page (mode 2). Prefer
    /// `setClassAtlasBakeMode(0)` to restore AUTO.
    #[wasm_bindgen(js_name = "setClassAtlasForcePerVariant")]
    pub fn set_class_atlas_force_per_variant(&mut self, force: bool) {
        self.class_atlas_bake_mode = if force { 1 } else { 2 };
    }

    #[wasm_bindgen(js_name = "bodySceneCacheStats")]
    pub fn body_scene_cache_stats(&self) -> JsValue {
        const BODY_SCENE_CACHE_CAP: u32 = 1500;
        let accesses = self.body_scene_cache_hits + self.body_scene_cache_misses;
        let hit_rate = if accesses > 0 {
            (self.body_scene_cache_hits as f64) / (accesses as f64)
        } else {
            0.0
        };
        let out = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &out,
            &"entries".into(),
            &JsValue::from(self.body_scene_cache.len() as u32),
        );
        let _ = js_sys::Reflect::set(&out, &"cap".into(), &JsValue::from(BODY_SCENE_CACHE_CAP));
        let _ = js_sys::Reflect::set(
            &out,
            &"hits".into(),
            &JsValue::from(self.body_scene_cache_hits as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &"misses".into(),
            &JsValue::from(self.body_scene_cache_misses as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &"evictions".into(),
            &JsValue::from(self.body_scene_cache_evictions as f64),
        );
        let _ = js_sys::Reflect::set(&out, &"hitRate".into(), &JsValue::from(hit_rate));
        out.into()
    }

    /// Report `body_subscene_cache` footprint for one bundle: how many
    /// cache entries belong to that bundle and how many serialized
    /// bytes they take in the VSC1/VSC2 IDB wire format. Reads the
    /// existing `serialize_body_subscene_cache` path so the size is the
    /// real IDB blob size, not an estimate.
    ///
    /// Returns `{ entryCount, serializedBytes }`. Both 0 if the bundle
    /// isn't loaded or the cache has no entries for it. `serializedBytes`
    /// is -1 if the encoder failed (returned in console log).
    #[wasm_bindgen(js_name = "subsceneCacheBytesForBundle")]
    pub fn subscene_cache_bytes_for_bundle(&self, bundle: &str) -> JsValue {
        let mut entry_count: u32 = 0;
        for key in self.body_subscene_cache.keys() {
            if key.bundle == bundle {
                entry_count += 1;
            }
        }
        let bytes_len: i64 = match self.serialize_body_subscene_cache(Some(bundle.to_string())) {
            Some(b) => b.len() as i64,
            None => -1,
        };
        let out = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&out, &"entryCount".into(), &JsValue::from(entry_count));
        let _ = js_sys::Reflect::set(
            &out,
            &"serializedBytes".into(),
            &JsValue::from(bytes_len as f64),
        );
        out.into()
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
                    -(net.0 as f32), // negate: net is position of reg point, offset is frame-to-regpoint
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
        let _ = js_sys::Reflect::set(
            &obj,
            &"frameCount".into(),
            &JsValue::from(anim.frame_ids.len() as u32),
        );
        let _ = js_sys::Reflect::set(&obj, &"offsetX".into(), &JsValue::from(offset_x));
        let _ = js_sys::Reflect::set(&obj, &"offsetY".into(), &JsValue::from(offset_y));
        let _ = js_sys::Reflect::set(&obj, &"trimX".into(), &JsValue::from(trim_x));
        let _ = js_sys::Reflect::set(&obj, &"trimY".into(), &JsValue::from(trim_y));
        let _ = js_sys::Reflect::set(&obj, &"frameWidth".into(), &JsValue::from(frame_w));
        let _ = js_sys::Reflect::set(&obj, &"frameHeight".into(), &JsValue::from(frame_h));
        let _ = js_sys::Reflect::set(
            &obj,
            &"hasBaseFrame".into(),
            &JsValue::from(anim.base_frame_id != u32::MAX),
        );
        let _ = js_sys::Reflect::set(
            &obj,
            &"baseZOrder".into(),
            &JsValue::from(anim.base_z_order),
        );
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

        let acc_scenes =
            build_accessory_scenes(&self.assets, &acc_info, animation, 0, resolution, asset);
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        let meta =
            scene_builder::compute_animation_render_meta(asset, animation, resolution, &acc_refs);

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

        let meta = scene_builder::compute_animation_render_meta(asset, animation, resolution, &[]);
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
            &self.assets,
            &acc_info,
            animation,
            frame_index as usize,
            resolution,
            asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        // Compute canvas size including accessories
        let meta =
            scene_builder::compute_animation_render_meta(asset, animation, resolution, &acc_refs);
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
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
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
    pub fn batch_copy(&mut self, dst_texture_id: f64, copies: &[f64]) -> bool {
        let dst_id = dst_texture_id as u64;
        if copies.len() < 3 {
            return false;
        }

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("batch_copy"),
            });

        for chunk in copies.chunks(3) {
            let src_id = chunk[0] as u64;
            let dst_x = chunk[1] as u32;
            let dst_y = chunk[2] as u32;

            let Some(src) = self.textures.get(&src_id) else {
                continue;
            };
            let src_w = src.width();
            let src_h = src.height();
            let Some(dst) = self.textures.get(&dst_id) else {
                return false;
            };

            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: src,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: dst,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: dst_x,
                        y: dst_y,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d {
                    width: src_w,
                    height: src_h,
                    depth_or_array_layers: 1,
                },
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
            if c.len() >= 3 {
                Some([c[0], c[1], c[2]])
            } else {
                None
            }
        });

        let acc_scenes = build_accessory_scenes(
            &self.assets,
            &acc_info,
            animation,
            frame_index as usize,
            resolution,
            asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        let meta =
            scene_builder::compute_animation_render_meta(asset, animation, resolution, &acc_refs);
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

        // Render to a temporary texture sized to the FULL SLOT (not just the frame).
        // The scene content occupies (w, h) and the rest is transparent.
        // This ensures the entire slot area is overwritten when copied to the atlas,
        // preventing stale content from a previous (larger) frame showing through.
        let render_w = slot_w.unwrap_or(w).max(w);
        let render_h = slot_h.unwrap_or(h).max(h);
        let render_target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_atlas_rt"),
            size: wgpu::Extent3d {
                width: render_w,
                height: render_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: render_w,
            height: render_h,
            antialiasing_method: AaConfig::Area,
        };

        if self
            .renderer
            .render_to_texture(&self.device, &self.queue, &scene, &rt_view, &params)
            .is_err()
        {
            return JsValue::NULL;
        }

        // Copy the full slot area (not just the frame) to clear any stale content
        let copy_w = render_w.min(atlas_size.width.saturating_sub(dst_x));
        let copy_h = render_h.min(atlas_size.height.saturating_sub(dst_y));
        if copy_w == 0 || copy_h == 0 {
            return JsValue::NULL;
        }

        // Copy rendered frame into atlas slot
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("atlas_copy"),
            });

        // Re-borrow atlas texture for the copy
        let atlas_tex = self.textures.get(&atlas_id).unwrap();
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &render_target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: atlas_tex,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: dst_x,
                    y: dst_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: copy_w,
                height: copy_h,
                depth_or_array_layers: 1,
            },
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
            if c.len() >= 3 {
                Some([c[0], c[1], c[2]])
            } else {
                None
            }
        });

        let acc_scenes = build_accessory_scenes(
            &self.assets,
            &acc_info,
            animation,
            frame_index as usize,
            resolution,
            asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

        // Use character-only canvas size (no accessories) for consistent dimensions.
        // Different accessory combinations produce different canvas sizes, causing
        // characters to shift position within variably-sized textures → visible jitter.
        // Accessories extending beyond the character bounds are clipped by flushFrames.
        let meta = scene_builder::compute_animation_render_meta(asset, animation, resolution, &[]);
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

        self.queued_frames.push(QueuedFrame {
            scene,
            width: w,
            height: h,
            dst_x,
            dst_y,
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

        let max_dim = self
            .queued_frames
            .iter()
            .map(|f| f.width.max(f.height))
            .max()
            .unwrap_or(SLOT_SIZE);
        let cell = max_dim.max(SLOT_SIZE).next_power_of_two().min(2048);
        let cols = (MAX_TEX_DIM / cell).max(1);
        let max_rows = MAX_TEX_DIM / cell;
        let batch_size = (cols * max_rows) as usize;

        struct Region {
            src_x: u32,
            src_y: u32,
            dst_x: u32,
            dst_y: u32,
        }

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
                    cx as f64,
                    cy as f64,
                    (cx + cell) as f64,
                    (cy + cell) as f64,
                );
                composite.push_layer(
                    vello::peniko::Fill::default(),
                    vello::peniko::BlendMode::default(),
                    1.0,
                    vello::kurbo::Affine::IDENTITY,
                    &clip_rect,
                );
                composite.append(
                    &frame.scene,
                    Some(vello::kurbo::Affine::translate((cx as f64, cy as f64))),
                );
                composite.pop_layer();

                regions.push(Region {
                    src_x: cx,
                    src_y: cy,
                    dst_x: frame.dst_x,
                    dst_y: frame.dst_y,
                });
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
                size: wgpu::Extent3d {
                    width: total_width,
                    height: total_height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
            let params = vello::RenderParams {
                base_color: Color::TRANSPARENT,
                width: total_width,
                height: total_height,
                antialiasing_method: AaConfig::Area,
            };

            if self
                .renderer
                .render_to_texture(&self.device, &self.queue, &composite, &rt_view, &params)
                .is_err()
            {
                offset = end;
                continue;
            }

            if let Some(atlas_tex) = self.textures.get(&atlas_id) {
                let atlas_w = atlas_tex.width();
                let atlas_h = atlas_tex.height();
                let mut encoder =
                    self.device
                        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                            label: Some("batch_copy"),
                        });

                // Copy FULL CELL (not just frame size) to clear stale content
                for r in &regions {
                    let cw = cell.min(atlas_w.saturating_sub(r.dst_x));
                    let ch = cell.min(atlas_h.saturating_sub(r.dst_y));
                    if cw == 0 || ch == 0 {
                        continue;
                    }

                    encoder.copy_texture_to_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &render_target,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: r.src_x,
                                y: r.src_y,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyTextureInfo {
                            texture: atlas_tex,
                            mip_level: 0,
                            origin: wgpu::Origin3d {
                                x: r.dst_x,
                                y: r.dst_y,
                                z: 0,
                            },
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::Extent3d {
                            width: cw,
                            height: ch,
                            depth_or_array_layers: 1,
                        },
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
            if c.len() >= 3 {
                Some([c[0], c[1], c[2]])
            } else {
                None
            }
        });

        // Compute canvas size INCLUDING accessories across ALL frames.
        // Accessories may extend into negative coordinates (hats above character),
        // so track min bounds to shift content into the positive canvas area.
        let mut global_min_x = 0.0_f64;
        let mut global_min_y = 0.0_f64;
        let mut global_max_x = 0.0_f64;
        let mut global_max_y = 0.0_f64;
        for i in 0..frame_count {
            let acc_scenes_i =
                build_accessory_scenes(&self.assets, &acc_info, animation, i, resolution, asset);
            let acc_refs_i: Vec<&AccessoryScene> = acc_scenes_i.iter().collect();
            let (bmin_x, bmin_y, bw, bh) =
                scene_builder::compute_frame_bounds(asset, animation, i, resolution, &acc_refs_i);
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
                (
                    net.0 * resolution as f64 + bounds_offset.0,
                    net.1 * resolution as f64 + bounds_offset.1,
                )
            } else {
                (bounds_offset.0, bounds_offset.1)
            }
        } else if let Some(first_frame) = asset.frames.get(first_fid) {
            let net = scene_builder::compute_net_offset(first_frame, &asset.transforms);
            (
                net.0 * resolution as f64 + bounds_offset.0,
                net.1 * resolution as f64 + bounds_offset.1,
            )
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

            let acc_scenes =
                build_accessory_scenes(&self.assets, &acc_info, animation, i, resolution, asset);
            let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();

            let frame_scene = scene_builder::build_frame_scene(
                asset,
                animation,
                i,
                player_colors.as_ref(),
                resolution,
                &acc_refs,
                bounds_offset,
            );

            let cx = (col as u32 * max_w) as f64;
            let cy = (row as u32 * max_h) as f64;
            let clip = vello::kurbo::Rect::new(cx, cy, cx + max_w as f64, cy + max_h as f64);
            composite.push_layer(
                vello::peniko::Fill::default(),
                vello::peniko::BlendMode::default(),
                1.0,
                vello::kurbo::Affine::IDENTITY,
                &clip,
            );
            composite.append(
                &frame_scene,
                Some(vello::kurbo::Affine::translate((cx, cy))),
            );
            composite.pop_layer();
        }

        // Render entire strip in ONE Vello dispatch directly to STORAGE texture,
        // then copy to the final TEXTURE_BINDING texture.
        let render_target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_strip_rt"),
            size: wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: strip_w,
            height: strip_h,
            antialiasing_method: AaConfig::Area,
        };

        if self
            .renderer
            .render_to_texture(&self.device, &self.queue, &composite, &rt_view, &params)
            .is_err()
        {
            return JsValue::NULL;
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_strip"),
            size: wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("strip_copy"),
            });
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &render_target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
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
        let _ = js_sys::Reflect::set(
            &result,
            &"frameCount".into(),
            &JsValue::from(frame_count as u32),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"gridCols".into(),
            &JsValue::from(grid_cols as u32),
        );
        // bounds_offset: how much the content was shifted to fit negative accessory positions
        let _ = js_sys::Reflect::set(
            &result,
            &"boundsOffsetX".into(),
            &JsValue::from(bounds_offset.0),
        );
        let _ = js_sys::Reflect::set(
            &result,
            &"boundsOffsetY".into(),
            &JsValue::from(bounds_offset.1),
        );
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
        let Some(asset) = self.assets.get(&asset_id) else {
            return JsValue::NULL;
        };

        let acc_scenes = build_accessory_scenes(
            &self.assets,
            &acc_info,
            animation,
            frame_index as usize,
            resolution,
            asset,
        );
        let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();
        let frame_scene = scene_builder::build_zone_mask_scene(
            asset,
            animation,
            frame_index as usize,
            resolution,
            &acc_refs,
        );
        let dims = self.get_frame_size(asset_id, animation, frame_index, resolution);
        let w = dims[0].max(1);
        let h = dims[1].max(1);

        // Same render-then-copy pattern as renderFrame to isolate Vello's
        // render target from Pixi.js's sampling texture.
        let render_target = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_zm_rt"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let rt_view = render_target.create_view(&wgpu::TextureViewDescriptor::default());
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: w,
            height: h,
            antialiasing_method: AaConfig::Area,
        };

        if let Err(e) = self.renderer.render_to_texture(
            &self.device,
            &self.queue,
            &frame_scene,
            &rt_view,
            &params,
        ) {
            console_log!("VelloRenderer: zone mask frame render error: {e}");
            return JsValue::NULL;
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_zm_out"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("zm_copy"),
            });
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &render_target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
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

        let mut max_w: u32 = 1;
        let mut max_h: u32 = 1;
        for i in 0..frame_count {
            let dims = self.get_frame_size(asset_id, animation, i as u32, resolution);
            max_w = max_w.max(dims[0]);
            max_h = max_h.max(dims[1]);
        }

        let strip_w = max_w * frame_count as u32;
        let strip_h = max_h;
        if strip_w > 8192 {
            return JsValue::NULL;
        }

        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_zone_mask"),
            size: wgpu::Extent3d {
                width: strip_w,
                height: strip_h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("zone_mask_copy"),
            });
        let mut tmp_textures: Vec<wgpu::Texture> = Vec::with_capacity(frame_count);

        for i in 0..frame_count {
            let acc_scenes =
                build_accessory_scenes(&self.assets, &acc_info, animation, i, resolution, asset);
            let acc_refs: Vec<&AccessoryScene> = acc_scenes.iter().collect();
            let frame_scene =
                scene_builder::build_zone_mask_scene(asset, animation, i, resolution, &acc_refs);
            let dims = self.get_frame_size(asset_id, animation, i as u32, resolution);
            let fw = dims[0].max(1);
            let fh = dims[1].max(1);

            let tmp = self.device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d {
                    width: fw,
                    height: fh,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let tmp_view = tmp.create_view(&wgpu::TextureViewDescriptor::default());
            let params = vello::RenderParams {
                base_color: Color::TRANSPARENT,
                width: fw,
                height: fh,
                antialiasing_method: AaConfig::Area,
            };

            if self
                .renderer
                .render_to_texture(&self.device, &self.queue, &frame_scene, &tmp_view, &params)
                .is_err()
            {
                continue;
            }

            let copy_w = fw.min(max_w);
            let copy_h = fh.min(max_h);
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &tmp,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: i as u32 * max_w,
                        y: 0,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::Extent3d {
                    width: copy_w,
                    height: copy_h,
                    depth_or_array_layers: 1,
                },
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
        let body_subscene_count = self.body_subscene_cache.len();
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
        // Phase 1c sub-scene cache size — scale-invariant per (frame,
        // band, mode) sub-scenes. Steady-state ceiling is bounded by
        // visible variants × frames × bands × modes, not by zoom level.
        let _ = js_sys::Reflect::set(
            &result,
            &"bodySubsceneCacheCount".into(),
            &JsValue::from(body_subscene_count as u32),
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
        self.body_subscene_cache.clear();
        self.acc_subscenes.clear();
    }

    /// Serialize the `body_subscene_cache` to a bytes blob suitable for
    /// browser-cache persistence. Optionally filter to a single bundle —
    /// callers persist one blob per bundle so each entry's content hash
    /// invalidates independently when its SWF changes.
    ///
    /// The cache is resolution-independent (twip identity), so the same
    /// bytes work at any render scale. Format: see `scene_cache.rs`
    /// (magic "VSC1" + length-prefixed entries).
    ///
    /// Returns `null` on serialization error (unsupported scene content
    /// — Glyph/Image patches don't appear in SWF char bakes, so this
    /// path should never fail in practice; if it does, the caller
    /// falls back to a fresh bake and the cache stays empty).
    ///
    /// Per-entry skip: character sub-scenes containing `Patch::Image`
    /// (bitmap-backed shape fills) skip persistence and re-bake on
    /// cold session. The skip count is logged but not surfaced — the
    /// returned blob carries the encodable subset.
    #[wasm_bindgen(js_name = "serializeBodySubsceneCache")]
    pub fn serialize_body_subscene_cache(&self, bundle_filter: Option<String>) -> Option<Vec<u8>> {
        let entries: Vec<(scene_cache::SubsceneKey, vello::Scene)> = self
            .body_subscene_cache
            .iter()
            .filter(|(k, _)| match &bundle_filter {
                Some(b) => &k.bundle == b,
                None => true,
            })
            .map(|(k, v)| {
                (
                    scene_cache::SubsceneKey {
                        bundle: k.bundle.clone(),
                        export: k.export.clone(),
                        apply_b_fix: k.apply_b_fix,
                        hat_equipped: k.hat_equipped,
                        mode: k.mode,
                        frame_idx: k.frame_idx,
                        band_lo: k.band_lo,
                        band_hi: k.band_hi,
                    },
                    v.clone(),
                )
            })
            .collect();
        let total = entries.len();
        let (bytes, skipped) = scene_cache::encode_body_stream(entries);
        if skipped > 0 {
            let bundle_tag = bundle_filter.as_deref().unwrap_or("(all)");
            console_log!(
                "serializeBodySubsceneCache: bundle={bundle_tag} persisted={}/{total} \
                 skipped={skipped} (bitmap-fill subscenes)",
                total as u32 - skipped
            );
        }
        if bytes.is_empty() { None } else { Some(bytes) }
    }

    /// Install entries from a previously-serialized blob into the
    /// in-memory subscene cache. Returns the count actually loaded
    /// (0 on parse error). Idempotent: re-installing the same blob is
    /// a no-op (HashMap insert overwrite).
    ///
    /// Existing entries with matching keys are overwritten — this is
    /// deliberate; the loader presumes the on-disk version is at least
    /// as fresh as whatever the live cache holds. Callers that want
    /// preserve-on-collision can clear before loading.
    #[wasm_bindgen(js_name = "loadBodySubsceneCache")]
    pub fn load_body_subscene_cache(&mut self, bytes: &[u8]) -> u32 {
        let parsed = match scene_cache::decode_body_stream(bytes) {
            Ok(v) => v,
            Err(e) => {
                console_log!("loadBodySubsceneCache failed: {e}");
                return 0;
            }
        };
        let mut count = 0u32;
        for (k, scene) in parsed {
            let key = BodySubsceneKey {
                bundle: k.bundle,
                export: k.export,
                apply_b_fix: k.apply_b_fix,
                hat_equipped: k.hat_equipped,
                mode: k.mode,
                frame_idx: k.frame_idx,
                band_lo: k.band_lo,
                band_hi: k.band_hi,
            };
            self.body_subscene_cache.insert(key, scene);
            count += 1;
        }
        count
    }

    /// Serialize `body_scene_cache` (the COMPOSED per-variant body
    /// atlas scenes) to a `VSC2` blob. This is the cache the
    /// per-variant SPAWN path (`render_swf_body_atlas`) actually reads
    /// — persisting it is what warms a cold 250-actor map entry
    /// (`serializeBodySubsceneCache` persists a DIFFERENT cache the
    /// spawn never touches). Scenes are scale-baked, so the blob is
    /// per-resolution; the caller keys IDB rows by resolution.
    #[wasm_bindgen(js_name = "serializeBodySceneCache")]
    pub fn serialize_body_scene_cache(&self, bundle_filter: Option<String>) -> Option<Vec<u8>> {
        let entries: Vec<(scene_cache::ComposedBodyKey, vello::Scene)> = self
            .body_scene_cache
            .iter()
            .filter(|(k, _)| match &bundle_filter {
                Some(b) => &k.bundle == b,
                None => true,
            })
            .map(|(k, v)| {
                (
                    scene_cache::ComposedBodyKey {
                        bundle: k.bundle.clone(),
                        export: k.export.clone(),
                        start: k.start,
                        count: k.count,
                        scale_q: k.scale_q,
                        apply_b_fix: k.apply_b_fix,
                        hat_equipped: k.hat_equipped,
                        mode: k.mode,
                    },
                    v.clone(),
                )
            })
            .collect();
        let total = entries.len();
        let (bytes, skipped) = scene_cache::encode_composed_body_stream(entries);
        if skipped > 0 {
            console_log!(
                "serializeBodySceneCache: persisted={}/{total} skipped={skipped}",
                total as u32 - skipped
            );
        }
        if bytes.is_empty() { None } else { Some(bytes) }
    }

    /// Install entries from a `serializeBodySceneCache` blob into
    /// `body_scene_cache`. Returns the count loaded (0 on parse
    /// error). Overwrites matching keys.
    #[wasm_bindgen(js_name = "loadBodySceneCache")]
    pub fn load_body_scene_cache(&mut self, bytes: &[u8]) -> u32 {
        let parsed = match scene_cache::decode_composed_body_stream(bytes) {
            Ok(v) => v,
            Err(e) => {
                console_log!("loadBodySceneCache failed: {e}");
                return 0;
            }
        };
        let mut count = 0u32;
        for (k, scene) in parsed {
            let key = BodySceneCacheKey {
                bundle: k.bundle,
                export: k.export,
                start: k.start,
                count: k.count,
                scale_q: k.scale_q,
                apply_b_fix: k.apply_b_fix,
                hat_equipped: k.hat_equipped,
                mode: k.mode,
            };
            if count < 6 {
                console_log!(
                    "BSC-LOAD {}|{}|s{}|c{}|q{}|b{}|h{}|m{}",
                    key.bundle,
                    key.export,
                    key.start,
                    key.count,
                    key.scale_q,
                    key.apply_b_fix as u8,
                    key.hat_equipped as u8,
                    key.mode
                );
            }
            self.body_scene_cache.insert(key, scene);
            count += 1;
        }
        count
    }

    /// Drop every `body_scene_cache` entry. Test/diagnostic hook for
    /// validating the persist→clear→load→spawn-warm cycle. Returns the
    /// number of entries cleared.
    #[wasm_bindgen(js_name = "clearBodySceneCache")]
    pub fn clear_body_scene_cache(&mut self) -> u32 {
        let n = self.body_scene_cache.len() as u32;
        self.body_scene_cache.clear();
        n
    }

    /// Serialize `tile_subscenes` to a `VSC2` blob suitable for IDB
    /// persistence. Same wire format as the body cache, tagged with
    /// `CacheId::Tile`.
    ///
    /// Tile sub-scenes occasionally contain `Patch::Image` (bitmap
    /// fills from `DefineBitsLossless` shape fills). The encoder
    /// fails the WHOLE blob if any entry contains such a patch — we
    /// don't yet support persisting raster fills. Result: tiles with
    /// embedded images skip the persistent cache (in-memory cache
    /// still works for the current session); next session re-bakes
    /// them from the SWF. Callers see `null` on encode error and
    /// gracefully fall back to fresh bakes — no correctness issue.
    #[wasm_bindgen(js_name = "serializeTileSubsceneCache")]
    pub fn serialize_tile_subscene_cache(&self, bundle_filter: Option<String>) -> Option<Vec<u8>> {
        let entries: Vec<(scene_cache::TileSubsceneKey, vello::Scene)> = self
            .tile_subscenes
            .iter()
            .filter(|((b, _, _), _)| match &bundle_filter {
                Some(f) => b == f,
                None => true,
            })
            .map(|((bundle, export, frame), scene)| {
                (
                    scene_cache::TileSubsceneKey {
                        bundle: bundle.clone(),
                        export: export.clone(),
                        frame: *frame,
                    },
                    scene.clone(),
                )
            })
            .collect();
        // `encode_tile_stream` skips entries with unsupported scene
        // content (bitmap fills) — returns the bytes for the
        // encodable subset plus a skip count. Skip count is logged
        // as info, not an error, because it's expected for tile
        // bundles with bitmap fills.
        let (bytes, skipped) = scene_cache::encode_tile_stream(entries);
        if skipped > 0 {
            console_log!("serializeTileSubsceneCache: skipped {skipped} tile(s) with bitmap fills");
        }
        if bytes.is_empty() { None } else { Some(bytes) }
    }

    /// Install entries from a previously-persisted tile sub-scene
    /// blob. Returns the count actually inserted.
    #[wasm_bindgen(js_name = "loadTileSubsceneCache")]
    pub fn load_tile_subscene_cache(&mut self, bytes: &[u8]) -> u32 {
        let parsed = match scene_cache::decode_tile_stream(bytes) {
            Ok(v) => v,
            Err(e) => {
                console_log!("loadTileSubsceneCache failed: {e}");
                return 0;
            }
        };
        let mut count = 0u32;
        for (k, scene) in parsed {
            self.tile_subscenes
                .insert((k.bundle, k.export, k.frame), scene);
            count += 1;
        }
        count
    }

    /// Count entries in `tile_subscenes`, optionally per-bundle. Same
    /// usage as the body variant.
    #[wasm_bindgen(js_name = "tileSubsceneCacheCountFor")]
    pub fn tile_subscene_cache_count_for(&self, bundle_filter: Option<String>) -> u32 {
        match bundle_filter {
            Some(b) => self
                .tile_subscenes
                .keys()
                .filter(|(bundle, _, _)| bundle == &b)
                .count() as u32,
            None => self.tile_subscenes.len() as u32,
        }
    }

    /// Serialize `acc_subscenes` to a `VSC2` blob suitable for IDB
    /// persistence. Same wire format as the body cache, tagged with
    /// `CacheId::Accessory`.
    #[wasm_bindgen(js_name = "serializeAccessorySubsceneCache")]
    pub fn serialize_accessory_subscene_cache(
        &self,
        bundle_filter: Option<String>,
    ) -> Option<Vec<u8>> {
        let entries: Vec<(scene_cache::AccessorySubsceneKey, vello::Scene)> = self
            .acc_subscenes
            .iter()
            .filter(|(k, _)| match &bundle_filter {
                Some(b) => &k.bundle == b,
                None => true,
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let total = entries.len();
        let (bytes, skipped) = scene_cache::encode_accessory_stream(entries);
        if skipped > 0 {
            let bundle_tag = bundle_filter.as_deref().unwrap_or("(all)");
            console_log!(
                "serializeAccessorySubsceneCache: bundle={bundle_tag} persisted={}/{total} \
                 skipped={skipped} (bitmap-fill subscenes)",
                total as u32 - skipped
            );
        }
        if bytes.is_empty() { None } else { Some(bytes) }
    }

    /// Install entries from a previously-persisted accessory
    /// sub-scene blob.
    #[wasm_bindgen(js_name = "loadAccessorySubsceneCache")]
    pub fn load_accessory_subscene_cache(&mut self, bytes: &[u8]) -> u32 {
        let parsed = match scene_cache::decode_accessory_stream(bytes) {
            Ok(v) => v,
            Err(e) => {
                console_log!("loadAccessorySubsceneCache failed: {e}");
                return 0;
            }
        };
        let mut count = 0u32;
        for (k, scene) in parsed {
            self.acc_subscenes.insert(k, scene);
            count += 1;
        }
        count
    }

    /// Count entries in `acc_subscenes`, optionally per-bundle.
    #[wasm_bindgen(js_name = "accessorySubsceneCacheCountFor")]
    pub fn accessory_subscene_cache_count_for(&self, bundle_filter: Option<String>) -> u32 {
        match bundle_filter {
            Some(b) => self.acc_subscenes.keys().filter(|k| k.bundle == b).count() as u32,
            None => self.acc_subscenes.len() as u32,
        }
    }

    /// Drain accumulated bake telemetry records.
    ///
    /// Returns an object `{ drops, records: [{kind, bundle, ms…,
    /// subsceneHits, subsceneMisses, pixelArea, subCount,
    /// tsRecorded}, …] }`. The returned records are removed from the
    /// internal buffer — subsequent calls only see new records.
    ///
    /// Why this shape (raw records, not pre-aggregated): the per-burst
    /// digest (zoom change, full warmup, etc.) needs different bucket
    /// boundaries depending on what the caller wants to study. Raw
    /// records let JS aggregate per-window. ~120 bytes per record;
    /// for a 700-record zoom burst that's ~85 KB round-trip — well
    /// under what wasm-bindgen handles in a single tick.
    ///
    /// `drops` is the count of records that were dropped because the
    /// internal buffer reached its 10k cap. Non-zero means the
    /// consumer fell behind — start draining more often.
    #[wasm_bindgen(js_name = "drainBakeTelemetry")]
    pub fn drain_bake_telemetry(&self) -> JsValue {
        let (records, drops) = bake_telemetry::drain();
        let out = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&out, &"drops".into(), &JsValue::from(drops));
        let arr = js_sys::Array::new();
        for rec in records {
            let obj = js_sys::Object::new();
            let _ = js_sys::Reflect::set(&obj, &"kind".into(), &JsValue::from_str(rec.kind));
            let _ = js_sys::Reflect::set(&obj, &"bundle".into(), &JsValue::from_str(&rec.bundle));
            let _ = js_sys::Reflect::set(
                &obj,
                &"sceneBuildMs".into(),
                &JsValue::from(rec.scene_build_ms),
            );
            let _ = js_sys::Reflect::set(
                &obj,
                &"gpuRenderMs".into(),
                &JsValue::from(rec.gpu_render_ms),
            );
            let _ = js_sys::Reflect::set(&obj, &"bridgeMs".into(), &JsValue::from(rec.bridge_ms));
            let _ = js_sys::Reflect::set(
                &obj,
                &"enumerateMs".into(),
                &JsValue::from(rec.enumerate_ms),
            );
            let _ = js_sys::Reflect::set(
                &obj,
                &"combineCopyMs".into(),
                &JsValue::from(rec.combine_copy_ms),
            );
            let _ = js_sys::Reflect::set(&obj, &"totalMs".into(), &JsValue::from(rec.total_ms));
            let _ = js_sys::Reflect::set(
                &obj,
                &"subsceneHits".into(),
                &JsValue::from(rec.subscene_hits),
            );
            let _ = js_sys::Reflect::set(
                &obj,
                &"subsceneMisses".into(),
                &JsValue::from(rec.subscene_misses),
            );
            let _ = js_sys::Reflect::set(
                &obj,
                &"pixelArea".into(),
                &JsValue::from(rec.pixel_area as f64),
            );
            let _ = js_sys::Reflect::set(&obj, &"subCount".into(), &JsValue::from(rec.sub_count));
            let _ =
                js_sys::Reflect::set(&obj, &"tsRecorded".into(), &JsValue::from(rec.ts_recorded));
            arr.push(&obj.into());
        }
        let _ = js_sys::Reflect::set(&out, &"records".into(), &arr.into());
        out.into()
    }

    /// Count entries in `body_subscene_cache`, optionally filtered to a
    /// single bundle. Surfaced for the loader-scene's progress UI so it
    /// can report "X / Y subscenes ready" without invoking a heavier
    /// stats call.
    #[wasm_bindgen(js_name = "bodySubsceneCacheCountFor")]
    pub fn body_subscene_cache_count_for(&self, bundle_filter: Option<String>) -> u32 {
        match bundle_filter {
            Some(b) => self
                .body_subscene_cache
                .keys()
                .filter(|k| k.bundle == b)
                .count() as u32,
            None => self.body_subscene_cache.len() as u32,
        }
    }
}
