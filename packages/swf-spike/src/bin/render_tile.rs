//! Render a single SWF-exported tile to PNG so we can A/B against Arakne's
//! atlas.svg of the same tile and find specific divergences.
//!
//! Usage: cargo run --bin render-tile -- <bundle> <export_id> <out.png> [--scale 3]

use std::fs;
use std::path::PathBuf;

use anyhow::Result;
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
    if argv.len() < 4 {
        eprintln!(
            "usage: render-tile <bundle.swf> <export_id> <out.png> [--scale N]"
        );
        std::process::exit(2);
    }
    let bundle_path = PathBuf::from(&argv[1]);
    let export = &argv[2];
    let out_path = PathBuf::from(&argv[3]);
    // Allow looking up symbols by raw character_id when a SWF doesn't export
    // by name. Pass `--id N` instead of an export name string. Useful for
    // visualising sub-symbols that AVM1 references internally (spell 802's
    // sprite 9 uses `char 8` as a depth-1 base shape with no export name).
    let id_override: Option<u16> = argv
        .iter()
        .position(|a| a == "--id")
        .and_then(|i| argv.get(i + 1))
        .and_then(|s| s.parse().ok());
    let scale: f64 = argv
        .iter()
        .position(|a| a == "--scale")
        .and_then(|i| argv.get(i + 1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(3.0);

    let doc = SwfDoc::load(&bundle_path)?;
    let sym = match id_override {
        Some(id) => doc
            .lookup_id(id)
            .ok_or_else(|| anyhow::anyhow!("no character_id={} in {}", id, bundle_path.display()))?,
        None => doc
            .lookup_export(export)
            .ok_or_else(|| anyhow::anyhow!("no export `{}` in {}", export, bundle_path.display()))?,
    };

    let bounds = symbol_bounds(&doc, sym, 0);
    eprintln!(
        "symbol {} bounds (twips): x=[{:.1}, {:.1}] y=[{:.1}, {:.1}] w={:.1} h={:.1}",
        export, bounds.x0, bounds.x1, bounds.y0, bounds.y1, bounds.width(), bounds.height()
    );

    let twip_scale = scale / 20.0;
    let pad = 1.0;
    let px_min_x = (bounds.x0 * twip_scale).floor() - pad;
    let px_min_y = (bounds.y0 * twip_scale).floor() - pad;
    let px_max_x = (bounds.x1 * twip_scale).ceil() + pad;
    let px_max_y = (bounds.y1 * twip_scale).ceil() + pad;
    let w = ((px_max_x - px_min_x) as u32).max(1);
    let h = ((px_max_y - px_min_y) as u32).max(1);

    eprintln!("texture {} x {} px (scale={})", w, h, scale);

    let xform = Affine::scale(twip_scale)
        .then_translate(Vec2::new(-px_min_x, -px_min_y));
    let mut scene = Scene::new();
    render_symbol(&doc, sym, &mut scene, xform, 0);

    let mut headless = Headless::new().await?;
    let pixels = headless.render_to_pixels(&scene, w, h, Color::TRANSPARENT)?;
    fs::create_dir_all(out_path.parent().unwrap_or(std::path::Path::new("."))).ok();
    image::save_buffer(&out_path, &pixels, w, h, image::ColorType::Rgba8)?;
    eprintln!("wrote {}", out_path.display());
    Ok(())
}
