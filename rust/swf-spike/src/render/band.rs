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
        .with_frame(frame)
        .with_player_colors(player_colors)
        .with_b_fix(apply_b_fix)
        .with_band_filter(band)
        .with_disable_accessories(true)
        .with_output_mode(output_mode)
        .with_hat_equipped(hat_equipped);
    render_symbol_into(&mut ctx, sym);
}
