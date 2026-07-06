//! Verify the canonical settled `static*` idle pose (NPC/monster
//! settle-in idles) against the naive frame-0 render.
//!
//! Renders the export TWICE side-by-side into one PNG:
//!   left  = UNSETTLED (children at `parent_frame % child_frames = 0`,
//!           the pre-fix behaviour — Flash's setup pose)
//!   right = SETTLED   (children pinned at their canonical AS2 `stop()`
//!           frame via `tile_behavior::settled_static_overrides`)
//!
//! Also prints the override map and the export's `applyEnd` action
//! point (if any) so both features are inspectable offline.
//!
//! Usage: render-settled-static <swf> <export> <out.png> [zone1,zone2,zone3]
//! (optional hex palette, e.g. `ff8822,eecc44,995522`, to inspect the
//! tinted output — zone assignment can change between the un-settled
//! and settled frames even when untinted geometry is identical)

use anyhow::Result;
use std::path::PathBuf;
use vello::kurbo::{Affine, Vec2};
use vello::peniko::Color;
use vello::Scene;

use swf_spike::headless::Headless;
use swf_spike::recolor::PlayerColors;
use swf_spike::render::{render_symbol_with_ctx_tinted, symbol_bounds, WgpuCtx};
use swf_spike::swf_doc::SwfDoc;
use swf_spike::wgpu_filters::FilterPipelines;

fn main() -> Result<()> {
    pollster::block_on(run())
}

async fn run() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    let bundle = PathBuf::from(&argv[1]);
    let export = &argv[2];
    let out = PathBuf::from(&argv[3]);

    let palette = argv.get(4).map(|s| {
        let parts: Vec<Option<u32>> = s
            .split(',')
            .map(|p| u32::from_str_radix(p, 16).ok())
            .collect();
        PlayerColors([
            parts.first().copied().flatten(),
            parts.get(1).copied().flatten(),
            parts.get(2).copied().flatten(),
        ])
    });

    let doc = SwfDoc::load(&bundle)?;
    let sym = doc.lookup_export(export).expect("export missing");

    let settled = swf_spike::tile_behavior::settled_static_overrides(&doc, sym);
    let mut pins: Vec<(u16, u16)> = settled.iter().map(|(k, v)| (*k, *v)).collect();
    pins.sort();
    eprintln!("settled overrides for `{export}`: {pins:?}");
    match swf_spike::swf_doc::action_point_frame(&doc, sym) {
        Some(f) => eprintln!("applyEnd action point (1-based): frame {f}"),
        None => eprintln!("applyEnd action point: none"),
    }

    // Canvas from frame-0 bounds with generous padding — the settled
    // pose can extend past the un-settled frame's extents.
    let bounds = symbol_bounds(&doc, sym, 0);
    let scale = 2.0_f64;
    let twip_scale = scale / 20.0;
    let pad = 48.0;
    let px_min_x = (bounds.x0 * twip_scale).floor() - pad;
    let px_min_y = (bounds.y0 * twip_scale).floor() - pad;
    let px_max_x = (bounds.x1 * twip_scale).ceil() + pad;
    let px_max_y = (bounds.y1 * twip_scale).ceil() + pad;
    let cw = ((px_max_x - px_min_x) as u32).max(1);
    let ch = ((px_max_y - px_min_y) as u32).max(1);

    let mut headless = Headless::new().await?;
    let pipelines = FilterPipelines::new(&headless.device);
    let mut sheet = vec![0u8; (cw * 2 * ch * 4) as usize];
    let mut diff_px = 0u64;

    let mut col_pixels: Vec<Vec<u8>> = Vec::new();
    for (i, ov) in [None, Some(&settled)].into_iter().enumerate() {
        let xform =
            Affine::scale(twip_scale).then_translate(Vec2::new(-px_min_x, -px_min_y));
        let mut scene = Scene::new();
        let mut ctx = WgpuCtx {
            device: &headless.device,
            queue: &headless.queue,
            renderer: &mut headless.renderer,
            filter_pipelines: &pipelines,
            output_scale: twip_scale,
        };
        render_symbol_with_ctx_tinted(
            &mut ctx,
            &doc,
            sym,
            &mut scene,
            xform,
            0,
            palette.unwrap_or_default(),
            ov,
        );
        let pixels = headless.render_to_pixels(&scene, cw, ch, Color::WHITE)?;
        for y in 0..ch {
            let dst = (y * cw * 2 + (i as u32) * cw) * 4;
            let src = y * cw * 4;
            sheet[dst as usize..(dst + cw * 4) as usize]
                .copy_from_slice(&pixels[src as usize..(src + cw * 4) as usize]);
        }
        col_pixels.push(pixels);
        eprintln!(
            "rendered {} column",
            if i == 0 { "UNSETTLED" } else { "SETTLED" }
        );
    }
    for (a, b) in col_pixels[0].chunks(4).zip(col_pixels[1].chunks(4)) {
        if a != b {
            diff_px += 1;
        }
    }
    eprintln!(
        "pixel diff between unsettled and settled: {diff_px} / {} ({:.2}%)",
        u64::from(cw) * u64::from(ch),
        100.0 * diff_px as f64 / (f64::from(cw) * f64::from(ch)),
    );

    image::save_buffer(&out, &sheet, cw * 2, ch, image::ColorType::Rgba8)?;
    eprintln!("wrote {}", out.display());
    Ok(())
}
