//! Render N frames of a tile to a horizontal sheet so we can spot
//! per-frame rendering bugs (e.g. tile 343's smoke morph).
//!
//! Usage: render_tile_sheet <bundle.swf> <export> <out.png> [N=8] [step=15]

use anyhow::Result;
use std::path::PathBuf;
use vello::kurbo::{Affine, Vec2};
use vello::peniko::Color;
use vello::Scene;

use swf_spike::headless::Headless;
use swf_spike::render::{render_symbol, symbol_bounds};
use swf_spike::swf_doc::SwfDoc;

fn main() -> Result<()> {
    pollster::block_on(run())
}

async fn run() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    let bundle = PathBuf::from(&argv[1]);
    let export = &argv[2];
    let out = PathBuf::from(&argv[3]);
    let cols: u32 = argv.get(4).and_then(|s| s.parse().ok()).unwrap_or(8);
    let step: u32 = argv.get(5).and_then(|s| s.parse().ok()).unwrap_or(15);

    let doc = SwfDoc::load(&bundle)?;
    // Allow `--id N` to address a non-exported character (e.g.
    // sprite 1373 inside tile 343 which isn't exported on its own).
    let id: Option<u16> = export.parse().ok();
    let sym = if let Some(id) = id
        && let Some(s) = doc.lookup_id(id)
    {
        s
    } else {
        doc.lookup_export(export).expect("export missing")
    };
    // Use union bounds across all the frames we'll render so the sheet
    // cell stays a fixed size.
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for i in 0..cols {
        let f = i * step;
        let b = symbol_bounds(&doc, sym, f as u16);
        min_x = min_x.min(b.x0);
        min_y = min_y.min(b.y0);
        max_x = max_x.max(b.x1);
        max_y = max_y.max(b.y1);
    }
    let scale = 2.0;
    let twip_scale = scale / 20.0;
    let pad = 4.0;
    let px_min_x = (min_x * twip_scale).floor() - pad;
    let px_min_y = (min_y * twip_scale).floor() - pad;
    let px_max_x = (max_x * twip_scale).ceil() + pad;
    let px_max_y = (max_y * twip_scale).ceil() + pad;
    let cw = ((px_max_x - px_min_x) as u32).max(1);
    let ch = ((px_max_y - px_min_y) as u32).max(1);

    eprintln!("each cell {}x{}, total {}x{}", cw, ch, cw * cols, ch);
    let mut headless = Headless::new().await?;

    let mut sheet = vec![0u8; (cw * cols * ch * 4) as usize];
    for i in 0..cols {
        let f = i * step;
        let xform = Affine::scale(twip_scale)
            .then_translate(Vec2::new(-px_min_x, -px_min_y));
        let mut scene = Scene::new();
        render_symbol(&doc, sym, &mut scene, xform, f as u16);
        let pixels = headless.render_to_pixels(&scene, cw, ch, Color::BLACK)?;
        // copy into sheet at column i
        for y in 0..ch {
            let dst_off = (y * cw * cols + i * cw) * 4;
            let src_off = y * cw * 4;
            sheet[dst_off as usize..(dst_off + cw * 4) as usize]
                .copy_from_slice(&pixels[src_off as usize..(src_off + cw * 4) as usize]);
        }
        eprintln!("rendered frame {}", f);
    }
    image::save_buffer(&out, &sheet, cw * cols, ch, image::ColorType::Rgba8)?;
    eprintln!("wrote {}", out.display());
    Ok(())
}
