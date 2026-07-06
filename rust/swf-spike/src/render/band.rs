//! Path B body-band rasteriser. Renders one Z-ordered slice of the
//! body symbol's display list — the slice between two accessory mount
//! depths. Accessories themselves are disabled here; the Pixi
//! compositor stacks accessory sprites between bands at runtime.
//!
//! Visual contract: rendering ALL bands of a (bundle, anim, dir,
//! flipped) tuple and compositing them in order, with accessory
//! sprites placed between adjacent bands at the slot-marker depths,
//! produces pixels indistinguishable from the legacy single-strip
//! composite (modulo zone recolour, which becomes a Pixi shader
//! uniform).

use std::collections::HashMap;

use vello::kurbo::Affine;

use crate::recolor::PlayerColors;
use crate::swf_doc::{SwfDoc, Symbol};

use super::cache::RenderCache;
use super::ctx::{RenderCtx, RenderMode};
use super::slot_depths::BandRange;
use super::{render_symbol_into, WgpuCtx};

/// Render one band of a body symbol into the caller's scene.
///
/// `band` constrains the TOP-LEVEL body walk to placements whose
/// depth falls inside the band. Accessory composition is disabled —
/// accessories are baked separately and composed in Pixi.
///
/// `output_mode` selects whether the band emits colour fills
/// (`Colour` — the BGRA8 strip) or zone-id markers (`ZoneId` — the
/// R8 strip read by the shader).
///
/// `player_colors` only matters when `output_mode == ZoneId` (zone
/// resolution); in `Colour` mode the per-bot HSL substitution is the
/// Pixi shader's job — pass `PlayerColors::default()`.
#[allow(clippy::too_many_arguments)]
pub fn render_body_band(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut vello::Scene,
    transform: Affine,
    frame: u16,
    band: BandRange,
    output_mode: RenderMode,
    player_colors: PlayerColors,
    cache: &RenderCache,
    apply_b_fix: bool,
    hat_equipped: bool,
    // Settled `static*` child pins (canonical AS2 `stop()` — see
    // `RenderCache::settled_overrides`). `None` for cycling anims.
    child_frame_overrides: Option<&HashMap<u16, u16>>,
    // Replay scale for twip-identity sub-scene bakes
    // (`body_subscene_cache` et al — see `RenderCtx::downstream_scale`);
    // 1.0 when `transform` already carries the pixel scale.
    downstream_scale: f64,
) {
    let inner = WgpuCtx {
        device: wgpu.device,
        queue: wgpu.queue,
        renderer: &mut *wgpu.renderer,
        filter_pipelines: wgpu.filter_pipelines,
        output_scale: wgpu.output_scale,
    };
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_downstream_scale(downstream_scale)
        .with_frame(frame)
        .with_player_colors(player_colors)
        .with_b_fix(apply_b_fix)
        .with_band_filter(band)
        .with_disable_accessories(true)
        .with_output_mode(output_mode)
        .with_hat_equipped(hat_equipped)
        .with_child_frame_overrides(child_frame_overrides);
    render_symbol_into(&mut ctx, sym);
}

/// Single-walk dual emit: render one band's **Colour** fills into
/// `colour_scene` AND its **ZoneId** marker fills into `zone_scene` in
/// ONE display-list traversal. Byte-identical to calling
/// `render_body_band` once with `RenderMode::Colour` and once with
/// `RenderMode::ZoneId` (same walk, same clips, same per-leaf fills) —
/// but it eliminates the duplicate traversal and the duplicate,
/// uncached `collect_mask_path` per clip. Same arg contract as
/// `render_body_band`; `player_colors` is threaded identically so the
/// colour scene's `recolor_target` resolution matches the standalone
/// Colour pass.
#[allow(clippy::too_many_arguments)]
pub fn render_body_band_dual(
    wgpu: &mut WgpuCtx,
    doc: &SwfDoc,
    sym: &Symbol,
    colour_scene: &mut vello::Scene,
    zone_scene: &mut vello::Scene,
    transform: Affine,
    frame: u16,
    band: BandRange,
    player_colors: PlayerColors,
    cache: &RenderCache,
    apply_b_fix: bool,
    hat_equipped: bool,
    child_frame_overrides: Option<&HashMap<u16, u16>>,
    // Replay scale for twip-identity sub-scene bakes (see
    // `RenderCtx::downstream_scale`); 1.0 for direct renders.
    downstream_scale: f64,
) {
    let inner = WgpuCtx {
        device: wgpu.device,
        queue: wgpu.queue,
        renderer: &mut *wgpu.renderer,
        filter_pipelines: wgpu.filter_pipelines,
        output_scale: wgpu.output_scale,
    };
    let mut ctx = RenderCtx::new(doc, colour_scene, cache)
        .with_wgpu(inner)
        .with_transform(transform)
        .with_downstream_scale(downstream_scale)
        .with_frame(frame)
        .with_player_colors(player_colors)
        .with_b_fix(apply_b_fix)
        .with_band_filter(band)
        .with_disable_accessories(true)
        .with_output_mode(RenderMode::Colour)
        .with_zone_scene(zone_scene)
        .with_hat_equipped(hat_equipped)
        .with_child_frame_overrides(child_frame_overrides);
    render_symbol_into(&mut ctx, sym);
}

/// Same walk as `render_body_band` but without a wgpu context — filtered
/// placements take the CPU halo fallback. Used by the `cpu-bench` harness
/// to measure `vello_cpu` on the exact per-band unit the class-atlas bake
/// renders, on a machine profile with no usable GPU.
#[allow(clippy::too_many_arguments)]
pub fn render_body_band_nogpu(
    doc: &SwfDoc,
    sym: &Symbol,
    scene: &mut vello::Scene,
    transform: Affine,
    frame: u16,
    band: BandRange,
    output_mode: RenderMode,
    player_colors: PlayerColors,
    cache: &RenderCache,
    apply_b_fix: bool,
    hat_equipped: bool,
    child_frame_overrides: Option<&HashMap<u16, u16>>,
    // Replay scale for twip-identity sub-scene bakes (see
    // `RenderCtx::downstream_scale`); 1.0 for direct renders.
    downstream_scale: f64,
) {
    let mut ctx = RenderCtx::new(doc, scene, cache)
        .with_transform(transform)
        .with_downstream_scale(downstream_scale)
        .with_frame(frame)
        .with_player_colors(player_colors)
        .with_b_fix(apply_b_fix)
        .with_band_filter(band)
        .with_disable_accessories(true)
        .with_output_mode(output_mode)
        .with_hat_equipped(hat_equipped)
        .with_child_frame_overrides(child_frame_overrides);
    render_symbol_into(&mut ctx, sym);
}
