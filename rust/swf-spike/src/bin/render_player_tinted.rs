//! Render a player export at frame 0 with three different
//! per-zone colour palettes side-by-side, so we can confirm the
//! HSL recolor lands on the expected body parts (zone1/2/3 in the
//! Dofus 1.29 vanilla class sprites).

use anyhow::Result;
use std::path::PathBuf;
use vello::kurbo::{Affine, Vec2};
use vello::peniko::Color;
use vello::Scene;

use swf_spike::headless::Headless;
use swf_spike::recolor::PlayerColors;
use swf_spike::render::{render_symbol, render_symbol_with_ctx_tinted, symbol_bounds, WgpuCtx};
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

    let doc = SwfDoc::load(&bundle)?;
    let sym = doc.lookup_export(export).expect("export missing");
    let bounds = symbol_bounds(&doc, sym, 0);
    eprintln!(
        "{} sprites tagged with applyColor zones",
        doc.sprite_color_zones.len()
    );

    let scale = 2.0_f64;
    let twip_scale = scale / 20.0;
    let pad = 4.0;
    let px_min_x = (bounds.x0 * twip_scale).floor() - pad;
    let px_min_y = (bounds.y0 * twip_scale).floor() - pad;
    let px_max_x = (bounds.x1 * twip_scale).ceil() + pad;
    let px_max_y = (bounds.y1 * twip_scale).ceil() + pad;
    let cw = ((px_max_x - px_min_x) as u32).max(1);
    let ch = ((px_max_y - px_min_y) as u32).max(1);

    let palettes: [(&str, [u32; 3]); 4] = [
        ("untinted", [0, 0, 0]),
        ("rgb-primary", [0xff_00_00, 0x00_ff_00, 0x00_00_ff]),
        ("warm",       [0xff_88_22, 0xee_cc_44, 0x99_55_22]),
        ("cool",       [0x33_44_aa, 0x66_aa_dd, 0xaa_cc_ff]),
    ];

    let mut headless = Headless::new().await?;
    let cols = palettes.len() as u32;
    let mut sheet = vec![0u8; (cw * cols * ch * 4) as usize];
    let pipelines = FilterPipelines::new(&headless.device);

    for (i, (label, p)) in palettes.iter().enumerate() {
        let xform = Affine::scale(twip_scale)
            .then_translate(Vec2::new(-px_min_x, -px_min_y));
        let mut scene = Scene::new();
        if i == 0 {
            // Sanity row: untinted via the public render_symbol.
            render_symbol(&doc, sym, &mut scene, xform, 0);
        } else {
            let pc = PlayerColors([
                if p[0] == 0 { None } else { Some(p[0]) },
                if p[1] == 0 { None } else { Some(p[1]) },
                if p[2] == 0 { None } else { Some(p[2]) },
            ]);
            let mut ctx = WgpuCtx {
                device: &headless.device,
                queue: &headless.queue,
                renderer: &mut headless.renderer,
                filter_pipelines: &pipelines,
                output_scale: twip_scale,
            };
            render_symbol_with_ctx_tinted(&mut ctx, &doc, sym, &mut scene, xform, 0, pc);
        }
        let pixels = headless.render_to_pixels(&scene, cw, ch, Color::WHITE)?;
        for y in 0..ch {
            let dst = (y * cw * cols + (i as u32) * cw) * 4;
            let src = y * cw * 4;
            sheet[dst as usize..(dst + cw * 4) as usize]
                .copy_from_slice(&pixels[src as usize..(src + cw * 4) as usize]);
        }
        eprintln!("rendered palette `{}`", label);
    }
    image::save_buffer(&out, &sheet, cw * cols, ch, image::ColorType::Rgba8)?;
    eprintln!("wrote {}", out.display());
    Ok(())
}
