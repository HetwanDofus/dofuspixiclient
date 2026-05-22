//! Walk a SwfDoc, recurse through DefineSprites, and emit Vello fills/strokes.
//!
//! Twip → pixel scaling is intentionally NOT done here — we paint in twip
//! coordinates and let the caller's `parent_transform` do the scale. That
//! matches how the existing `dofasset_renderer` handles its scenes.
//!
//! Module layout:
//! - `ctx`      — `RenderCtx` builder + `child(place, id)` descent helper
//! - `cache`    — memoized shape flatten / morph interp / frame state
//! - `bounds`   — symbol_bounds, build_frame_state, transform_rect
//! - `clip`     — silhouette clip-mask path collection
//! - `emit`     — low-level fill/stroke + ColorTransform tinting + HSL recolor
//! - `filter`   — drop shadow / glow / blur / color matrix (GPU + halo paths)
//! - `sprite`   — timeline walker (clip stack, filter handoff, recursion)
//! - `snapshot` — AVM1-resolved tree consumer (DestIn alpha mask, blend modes)

pub mod band;
pub mod bounds;
pub mod cache;
pub mod clip;
pub mod ctx;
pub mod emit;
pub mod filter;
pub mod mount_transforms;
pub mod phased;
pub mod slot_depths;
pub mod snapshot;
pub mod sprite;

pub use band::render_body_band;
pub use bounds::{build_frame_state, symbol_bounds};
pub use cache::RenderCache;
pub use clip::collect_mask_path;
pub use ctx::{RenderCtx, RenderMode};
pub use slot_depths::{
    band_count, band_range, body_has_toggle_sprite, compute_band_presence,
    extract_slot_depths, find_effective_body_symbol, BandRange, SlotDepth,
};
pub use snapshot::{render_snapshot, PlacedSnapshot, ResolvedPlace};

use anyhow::Result;

use vello::kurbo::Affine;
use vello::wgpu;
use vello::{Renderer, Scene};

use crate::swf_doc::{OwnedColorTransform, SwfDoc, Symbol};
use crate::wgpu_filters::FilterPipelines;

/// Per-frame wgpu context shared with the renderer. Required by the
/// filtered-placement path which renders sub-scenes to intermediate
/// textures and applies compute-shader filter passes.
pub struct WgpuCtx<'a> {
    pub device: &'a wgpu::Device,
    pub queue: &'a wgpu::Queue,
    pub renderer: &'a mut Renderer,
    pub filter_pipelines: &'a FilterPipelines,
    /// Output pixels per shape twip (= renderScale / 20.0). Used to size
    /// intermediate filter textures consistent with the main render.
    pub output_scale: f64,
}

/// Multiple SwfDocs probed in order; first hit wins. Used by
/// `render_export` to render an export across a pool of bundles.
pub struct DocPool<'a> {
    pub docs: Vec<&'a SwfDoc>,
}

impl<'a> DocPool<'a> {
    pub fn new(docs: Vec<&'a SwfDoc>) -> Self {
        Self { docs }
    }

    pub fn lookup_export(&self, name: &str) -> Option<(&SwfDoc, &Symbol)> {
        for doc in &self.docs {
            if let Some(sym) = doc.lookup_export(name) {
                return Some((doc, sym));
            }
        }
        None
    }
}

// ---------------------------------------------------------------
// Public entry points. All build a `RenderCtx` and dispatch to the
// internal workhorse `render_symbol_into`. Their parameter lists are
// kept byte-stable so vello-wasm and the debug bins compile
// unchanged.
// ---------------------------------------------------------------

pub fn render_export(
    pool: &DocPool<'_>,
    export: &str,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
) -> Result<()> {
    let (doc, sym) = pool
        .lookup_export(export)
        .ok_or_else(|| anyhow::anyhow!("no export `{}` in DocPool", export))?;
    render_symbol(doc, sym, scene, transform, frame);
    Ok(())
}

pub fn render_symbol(
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
) {
    let cache = RenderCache::new();
    let mut ctx = RenderCtx::new(doc, scene, &cache)
        .with_transform(transform)
        .with_frame(frame);
    render_symbol_into(&mut ctx, sym);
}

pub fn render_symbol_with_ctx(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
) {
    let inner = reborrow_wgpu(wgpu);
    let cache = RenderCache::new();
    let mut ctx = RenderCtx::new(doc, scene, &cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_frame(frame);
    render_symbol_into(&mut ctx, sym);
}

/// `render_symbol_with_ctx` variant that takes an externally-owned
/// `RenderCache`. Used by callers that hold a long-lived per-bundle
/// cache (Phase 1 of `RENDER_BAKE_PLAN.md`) so shape flattening,
/// morph interpolation, and sprite frame-state walks dedup across
/// bakes of the same bundle. Without this, accessory + tile bakes
/// re-flatten every shape from scratch on every call.
pub fn render_symbol_with_ctx_cached(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
    cache: &crate::render::cache::RenderCache,
) {
    let inner = reborrow_wgpu(wgpu);
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_frame(frame);
    render_symbol_into(&mut ctx, sym);
}

/// Same as `render_symbol_with_ctx` but applies HSL-preserve-lightness
/// recolor to every fill inside a sprite tagged with an applyColor
/// zone (see `SwfDoc.sprite_color_zones`). Used by the player-tinting
/// path. Tile/spell renders should keep using `render_symbol_with_ctx`
/// since they have no zones.
pub fn render_symbol_with_ctx_tinted(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
    player_colors: crate::recolor::PlayerColors,
) {
    let inner = reborrow_wgpu(wgpu);
    let cache = RenderCache::new();
    let mut ctx = RenderCtx::new(doc, scene, &cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_frame(frame)
        .with_player_colors(player_colors);
    render_symbol_into(&mut ctx, sym);
}

/// Same as `render_symbol_with_ctx_tinted` but composes accessory
/// SWFs at body part mount points declared via
/// `GAC.applyAccessory(this, slot, side)` in the base character SWF.
/// Used by the character strip renderer to bake hat/weapon/cape/
/// shield onto each frame in one Vello dispatch.
pub fn render_symbol_with_ctx_tinted_accessorized(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
    player_colors: crate::recolor::PlayerColors,
    cache: &crate::render::cache::RenderCache,
    accessories: &crate::render::ctx::AccessoryDict<'_>,
) {
    let inner = reborrow_wgpu(wgpu);
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_frame(frame)
        .with_player_colors(player_colors)
        .with_accessories(accessories);
    render_symbol_into(&mut ctx, sym);
}

/// Same as `render_symbol_with_ctx_tinted_accessorized` but lets the
/// caller request the canonical AS2 `bFix` X-mirror (canonical
/// directions 3/4/7 — SW/W/NE). When `apply_b_fix=true`, body part
/// placements whose `accessory_mounts` declare `b_fix=true` (capes,
/// shields) get their translation X negated so the global JS-flip
/// the caller will then apply lands the body part on the canonical
/// side.
pub fn render_symbol_with_ctx_tinted_accessorized_bfixed(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
    player_colors: crate::recolor::PlayerColors,
    cache: &crate::render::cache::RenderCache,
    accessories: &crate::render::ctx::AccessoryDict<'_>,
    apply_b_fix: bool,
) {
    let inner = reborrow_wgpu(wgpu);
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_frame(frame)
        .with_player_colors(player_colors)
        .with_accessories(accessories)
        .with_b_fix(apply_b_fix);
    render_symbol_into(&mut ctx, sym);
}

/// Same as `render_symbol_with_ctx_tinted` but reuses an externally-
/// owned `RenderCache` across calls. The hot-path entry for batching
/// many symbol renders into one Vello scene (e.g. the per-frame tile
/// pass): with a fresh cache per call, flattening the same building
/// geometry into draw commands happens N times for N cells using the
/// same tile; the shared cache drops that to once. Same for morph-
/// shape interpolation and sprite frame-state walks.
pub fn render_symbol_with_shared_cache(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
    player_colors: crate::recolor::PlayerColors,
    cache: &RenderCache,
) {
    let inner = reborrow_wgpu(wgpu);
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_frame(frame)
        .with_player_colors(player_colors);
    render_symbol_into(&mut ctx, sym);
}

pub fn render_symbol_xformed(
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut Scene,
    transform: Affine,
    frame: u16,
    color_xform: OwnedColorTransform,
) {
    let cache = RenderCache::new();
    let mut ctx = RenderCtx::new(doc, scene, &cache)
        .with_transform(transform)
        .with_frame(frame)
        .with_color_xform(color_xform);
    render_symbol_into(&mut ctx, sym);
}

pub fn render_shape(
    scene: &mut Scene,
    doc: &SwfDoc,
    shape: &swf::Shape,
    transform: Affine,
    color_xform: OwnedColorTransform,
) {
    let cache = RenderCache::new();
    let mut ctx = RenderCtx::new(doc, scene, &cache)
        .with_transform(transform)
        .with_color_xform(color_xform);
    render_shape_into(&mut ctx, shape);
}

/// Render an accessory's symbol at the parent ctx's transform. Used
/// from `sprite::render_sprite_into` when a body part's
/// `applyAccessory(this, slot, side)` mount is matched against the
/// caller's accessory dictionary. The accessory's local twip space
/// is composed with the body part's world transform — the
/// accessory's own (0,0) origin lands at the body part's mount
/// point, matching the canonical Dofus AS2 `attachMovie` semantic.
///
/// `mount` is the body part's mount declaration — its `side` (e.g.
/// "R", "WR", "B") drives the per-slot direction truth table that
/// picks which frame range of the accessory to use. The character's
/// current frame index (`entry.char_frame`) cycles within that range
/// so the accessory animates in lockstep with the body.
///
/// This intentionally does NOT inherit `recolor_target` /
/// `color_xform` / `player_colors` from the body part: accessories
/// have their own colour authoring.
pub(crate) fn render_accessory_at(
    parent: &mut crate::render::ctx::RenderCtx<'_>,
    entry: &crate::render::ctx::AccessoryEntry<'_>,
    mount: &crate::swf_doc::AccessoryMount,
) {
    let requested_side = mount.side.as_deref().unwrap_or("R");
    // Pets (slot 3) ship as full-character bundles with their own
    // named multi-anim timeline (`staticR`, `walkR`, `runR`, etc.) —
    // the body part's mount tells us nothing about which animation
    // to play. Honor the active character anim instead so the pet
    // walks when the player walks, idles when the player idles, and
    // mirrors the player's facing.
    let symbol = if mount.slot == 3 {
        resolve_pet_symbol(entry, requested_side).unwrap_or(entry.symbol)
    } else {
        entry.symbol
    };
    let frame = pick_accessory_frame(
        entry.doc,
        symbol,
        mount.slot,
        entry.anim_type,
        requested_side,
        entry.char_frame,
    );
    let cache = parent.cache;
    let scene = &mut *parent.scene;
    let transform = parent.transform;
    let inner = parent.wgpu.as_mut().map(|w| WgpuCtx {
        device: w.device,
        queue: w.queue,
        renderer: &mut *w.renderer,
        filter_pipelines: w.filter_pipelines,
        output_scale: w.output_scale,
    });
    let mut acc_ctx = RenderCtx::new(entry.doc, scene, cache)
        .with_transform(transform)
        .with_frame(frame);
    if let Some(w) = inner {
        acc_ctx = acc_ctx.with_wgpu(w);
    }
    render_symbol_into(&mut acc_ctx, symbol);
}

/// Resolve a pet-style accessory's playable symbol for the active
/// character animation. Pet bundles export `static<dir>`, `walk<dir>`,
/// `run<dir>` etc. just like player characters — falling through to
/// the body-part-symbol-as-flat-3-frame layout (which is what slot 1
/// hats use) misses every frame past the first three.
///
/// Returns `None` if the bundle doesn't expose any of the candidates,
/// signalling the caller to keep using the entry's authored symbol.
fn resolve_pet_symbol<'a>(
    entry: &'a crate::render::ctx::AccessoryEntry<'a>,
    requested_side: &str,
) -> Option<&'a crate::swf_doc::Symbol> {
    let dir = entry.char_dir_suffix;
    // Map anim_type → preferred base. Walk/run pets cycle their
    // walk anim when the character moves; static pets idle. Pets
    // that ship without a `walk*` export (rare in vanilla Dofus 1.29
    // but defensive) fall through to the static cycle.
    let base = match entry.anim_type {
        2 => "run",
        1 => "walk",
        _ => "static",
    };
    let primary = format!("{base}{dir}");
    let static_d = format!("static{dir}");
    let static_r = "staticR".to_string();
    // Side-fallback variants land here so a pet only authored for
    // R/L still picks the closest direction.
    let side_fb = format!("{base}{requested_side}");
    let candidates = [primary, side_fb, static_d, static_r];
    for name in &candidates {
        if let Some(sym) = entry.doc.lookup_export(name) {
            return Some(sym);
        }
    }
    None
}

/// Pick the right frame of an accessory symbol for the given mount
/// declaration. Two paths:
///
///   1. **Frame-label path (canonical).** Honors AS2
///      `clip.gotoAndStop(side)` semantics — looks up the requested
///      `side` (and its slot-specific fallback chain) in the
///      symbol's `frame_labels`. Falls back through the chain until
///      a labelled, non-degenerate frame is found.
///
///   2. **Fixed-offset path (legacy).** Used when the symbol carries
///      no frame labels at all: assume Dofus 1.29's flat 5×3
///      directional layout (R=0, L=3, F=6, B=9, S=12; cape RR/RL at
///      15/18) and walk the same fallback chain. Within the chosen
///      offset, pick `(char_frame % 3)` so the accessory's 3-frame
///      per-direction loop syncs with the character.
///
/// Frame labels are case-insensitive (canonical Flash semantic);
/// the parser already lowercased the keys.
pub fn pick_accessory_frame(
    doc: &crate::swf_doc::SwfDoc,
    sym: &crate::swf_doc::Symbol,
    slot: u8,
    anim_type: u8,
    requested_side: &str,
    char_frame: u16,
) -> u16 {
    let chain = side_fallback_chain(slot, anim_type, requested_side);
    let cycle = (char_frame % 3) as u16;

    let labels = match sym {
        crate::swf_doc::Symbol::Sprite(s) if !s.frame_labels.is_empty() => {
            Some(&s.frame_labels)
        }
        _ => None,
    };

    if let Some(labels) = labels {
        // Canonical AS2 path: gotoAndStop(side). Many Dofus
        // accessory SWFs label every direction; some label only the
        // "anchor" frames. Walk the fallback chain, prefer a label
        // for `(side + cycle)` (sub-frame variant — supports SWFs
        // that label "R", "R1", "R2" individually), else just
        // `side`'s anchor frame. The mount's authored side
        // (`requested_side`) is tried FIRST — capes typically
        // declare `applyAccessory(this, 2, "WR")` for walking
        // right, and that exact "wr" / "wr0" label is what the
        // canonical client jumps to. Falling straight to the chain
        // (which only knows R/L) would skip the W-prefix walk
        // variants and freeze the cape on the static "R" frame.
        let try_side_label = |side: &str| -> Option<u16> {
            for sub in [cycle, 0] {
                let key = if sub == 0 {
                    side.to_lowercase()
                } else {
                    format!("{}{}", side.to_lowercase(), sub)
                };
                if let Some(&frame) = labels.get(&key) {
                    let bounds = symbol_bounds(doc, sym, frame);
                    if bounds.width() > 0.0 && bounds.height() > 0.0 {
                        return Some(frame);
                    }
                }
            }
            None
        };
        if let Some(frame) = try_side_label(requested_side) {
            return frame;
        }
        for &side in chain {
            if let Some(frame) = try_side_label(side) {
                return frame;
            }
        }
        // Some accessory bundles ship pet-style with `staticR /
        // walkR / etc.` labels keyed off the character anim instead
        // of the mount side. Try those before falling through.
        for base in ["walk", "run", "static"] {
            for &side in chain {
                let key = format!("{}{}", base, side.to_lowercase());
                if let Some(&frame) = labels.get(&key) {
                    let bounds = symbol_bounds(doc, sym, frame);
                    if bounds.width() > 0.0 && bounds.height() > 0.0 {
                        return frame;
                    }
                }
            }
        }
    }

    // Legacy / unlabelled SWF fallback — Dofus 1.29 character +
    // hat / weapon accessories ship with a flat 5×3 layout instead
    // of named labels. Walk the same chain but use the fixed offset
    // tables.
    for &side in chain {
        let Some(offset) = side_to_frame_offset(side) else {
            continue;
        };
        let frame = offset + cycle;
        let bounds = symbol_bounds(doc, sym, frame);
        if bounds.width() > 0.0 && bounds.height() > 0.0 {
            return frame;
        }
    }
    // Final fallback: frame 0. Some accessory may render empty but at
    // least the call doesn't return a degenerate index.
    let _ = anim_type;
    0
}

/// Map an accessory side label to its frame offset inside the
/// accessory symbol. Standard layout: 5 directions × 3 sub-frames =
/// 15 frames, with extra rotated variants stacked on after.
fn side_to_frame_offset(side: &str) -> Option<u16> {
    match side {
        "R" => Some(0),
        "L" => Some(3),
        "F" => Some(6),
        "B" => Some(9),
        "S" => Some(12),
        "RR" => Some(15),
        "RL" => Some(18),
        // Walking-prefix variants (capes/pets) are NOT separately
        // authored by most accessories — fall back to the matching
        // cardinal direction. Note: cape SWFs that DO have W-prefix
        // frames put them after the cardinal block; we'd need a
        // per-accessory layout map to use those directly, which is
        // future work.
        "WR" => Some(0),
        "WL" => Some(3),
        "WF" => Some(6),
        "WB" => Some(9),
        "WS" => Some(12),
        _ => None,
    }
}

/// Slot-specific side fallback chain. Mirrors the canonical
/// `resolve_accessory_anim` truth table from the dofasset renderer.
/// First match in the chain whose frame is non-degenerate wins.
fn side_fallback_chain(slot: u8, anim_type: u8, dir_suffix: &str) -> &'static [&'static str] {
    match slot {
        // Cape (slot 2): direction + animation-class specific.
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
        // Shield (slot 4): direction-folded for L/F/B.
        4 => match (anim_type, dir_suffix) {
            (0, "L") => &["L", "R"],
            (0, _) => &["R", "L"],
            (1, "F") | (1, "B") | (1, "L") => &["L", "R"],
            (1, _) => &["R", "L"],
            (2, "F") | (2, "L") => &["L", "R"],
            (2, _) => &["R", "L"],
            _ => &["R", "L"],
        },
        // Hat (1), pet (3), default: simple direction fallback.
        _ => match dir_suffix {
            "R" => &["R", "S", "F"],
            "L" => &["L", "S", "F"],
            "F" => &["F", "S", "R"],
            "B" => &["B", "S", "L"],
            "S" => &["S", "R", "F"],
            _ => &["R", "L", "S"],
        },
    }
}


/// Reborrow a mutable WgpuCtx reference into a fresh owned WgpuCtx
/// so the public entries can hand a value-typed WgpuCtx to
/// `RenderCtx::with_wgpu`.
fn reborrow_wgpu<'a>(w: &'a mut WgpuCtx<'_>) -> WgpuCtx<'a> {
    WgpuCtx {
        device: w.device,
        queue: w.queue,
        renderer: &mut *w.renderer,
        filter_pipelines: w.filter_pipelines,
        output_scale: w.output_scale,
    }
}

// ---------------------------------------------------------------
// Internal workhorses called by every entry point.
// ---------------------------------------------------------------

/// Dispatch a Symbol to the right rendering function. Reads
/// `ctx.ratio` for MorphShape interpolation and `ctx.frame` for
/// sprite timeline position. Morph interpolation hits the cache
/// (bucketed by ratio high byte).
pub(crate) fn render_symbol_into(ctx: &mut RenderCtx<'_>, sym: &Symbol) {
    match sym {
        Symbol::Shape(shape) => render_shape_into(ctx, shape),
        Symbol::Sprite(sprite) => sprite::render_sprite_into(ctx, sprite),
        Symbol::Bitmap { .. } => {}
        Symbol::MorphShape(ms) => {
            let interp = ctx.cache.morph_frame(ms, ctx.ratio);
            render_shape_into(ctx, &interp);
        }
    }
}

/// Flatten a shape into draw commands (cached), optionally HSL-recolor
/// each brush to the active zone target, then emit. Cache hit avoids
/// re-walking shape records; the no-recolor path emits the cached
/// `DrawCmd` directly with no per-fill clone.
///
/// Path B `RenderMode::ZoneId` branch: emit zone marker fills only.
/// Each fill becomes a flat-solid `(zone_id * 60, 0, 0, 255)` brush;
/// strokes are dropped (zones never cross stroke geometry in canonical
/// Dofus). Non-zone subtrees emit nothing — the Pixi shader treats
/// zero-alpha pixels as "no recolour".
pub(crate) fn render_shape_into(ctx: &mut RenderCtx<'_>, shape: &swf::Shape) {
    let transform = ctx.transform;
    let color_xform = ctx.color_xform;
    let cmds = ctx.cache.shape_cmds(shape, ctx.doc);

    if ctx.output_mode == ctx::RenderMode::ZoneId {
        let Some(zone) = ctx.recolor_zone else {
            return;
        };
        // Zone marker colour. Multiplying by 60 keeps zones 1/2/3 at
        // 60/120/180 so a single shader threshold ladder reads them
        // unambiguously and any sub-pixel filtering noise still lands
        // in the correct bucket.
        let r = zone.saturating_mul(60);
        let marker = vello::peniko::Brush::Solid(
            vello::peniko::color::AlphaColor::from_rgba8(r, 0, 0, 255),
        );
        for cmd in cmds.iter() {
            if let crate::shape::DrawKind::Fill {
                rule,
                brush_transform,
                ..
            } = &cmd.kind
            {
                // ColorTransform intentionally not applied — markers
                // must be pure so the shader's HSL substitution lands
                // the right pixel value irrespective of any animated
                // tint on the body.
                ctx.scene
                    .fill(*rule, transform, &marker, *brush_transform, &cmd.path);
            }
        }
        return;
    }

    let recolor_target = ctx.recolor_target;
    for cmd in cmds.iter() {
        if let Some(target) = recolor_target {
            // Recolor needs a mutable copy. BezPath + Brush are
            // internally Arc-shared so the clone is cheap.
            let mut cmd = cmd.clone();
            emit::recolor_cmd_in_place(&mut cmd, target);
            emit::emit_cmd(ctx.scene, &cmd, transform, color_xform);
        } else {
            emit::emit_cmd(ctx.scene, cmd, transform, color_xform);
        }
    }
}
