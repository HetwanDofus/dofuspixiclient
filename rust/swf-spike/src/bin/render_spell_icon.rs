//! Render a spell icon via the same logic as `renderSwfSpellIcon` in vello-wasm
//! and write to PNG. Used to verify alignment of disc + frame + glyph layers
//! without spinning up the WebGPU/WASM stack.
//!
//! Usage: cargo run --bin render-spell-icon -- <back.swf> <up.swf> <out.png>

use std::path::PathBuf;

use anyhow::Result;
use swf_spike::headless::Headless;
use swf_spike::swf_doc::{OwnedColorTransform, OwnedOp, Symbol, SwfDoc};

struct ResolvedLayer<'a> {
    symbol: &'a Symbol,
    matrix: vello::kurbo::Affine,
}

fn resolve_named<'a>(doc: &'a SwfDoc, name: &str) -> Option<ResolvedLayer<'a>> {
    for op in &doc.root.ops {
        match op {
            OwnedOp::Place(p) if p.name.as_deref() == Some(name) => {
                let cid = p.character_id?;
                let sym = doc.lookup_id(cid)?;
                return Some(ResolvedLayer {
                    symbol: sym,
                    matrix: p.matrix.unwrap_or(vello::kurbo::Affine::IDENTITY),
                });
            }
            OwnedOp::ShowFrame => break,
            _ => {}
        }
    }
    None
}

fn resolve_only_root(doc: &SwfDoc) -> Option<ResolvedLayer<'_>> {
    let mut found: Option<ResolvedLayer<'_>> = None;
    for op in &doc.root.ops {
        match op {
            OwnedOp::Place(p) => {
                if found.is_some() {
                    return None;
                }
                let cid = p.character_id?;
                let sym = doc.lookup_id(cid)?;
                found = Some(ResolvedLayer {
                    symbol: sym,
                    matrix: p.matrix.unwrap_or(vello::kurbo::Affine::IDENTITY),
                });
            }
            OwnedOp::ShowFrame => break,
            _ => {}
        }
    }
    found
}

fn flat_fill(rgb: u32) -> OwnedColorTransform {
    let r = ((rgb >> 16) & 0xff) as f32 / 255.0;
    let g = ((rgb >> 8) & 0xff) as f32 / 255.0;
    let b = (rgb & 0xff) as f32 / 255.0;
    OwnedColorTransform {
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

fn main() -> Result<()> {
    let back_path = PathBuf::from(std::env::args().nth(1).unwrap());
    let up_path = PathBuf::from(std::env::args().nth(2).unwrap());
    let out_path = PathBuf::from(
        std::env::args()
            .nth(3)
            .unwrap_or_else(|| "icon.png".to_string()),
    );

    let back_doc = SwfDoc::load(&back_path)?;
    let up_doc = SwfDoc::load(&up_path)?;

    let bg = resolve_named(&back_doc, "_spellBackground")
        .ok_or_else(|| anyhow::anyhow!("no _spellBackground"))?;
    let frm = resolve_named(&back_doc, "_spellFrame")
        .ok_or_else(|| anyhow::anyhow!("no _spellFrame"))?;
    let glyph = resolve_named(&up_doc, "_spellPrint")
        .or_else(|| resolve_only_root(&up_doc))
        .ok_or_else(|| anyhow::anyhow!("no glyph layer"))?;

    let bounds = swf_spike::render::symbol_bounds(
        &back_doc,
        &Symbol::Sprite(back_doc.root.clone()),
        0,
    );
    let resolution = 2.0_f32; // upscale a bit so the output is easy to read
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
    let bg_xform = xform * bg.matrix;
    let frame_xform = xform * frm.matrix;
    let glyph_xform = xform * glyph.matrix;

    let mut scene = vello::Scene::new();
    swf_spike::render::render_symbol_xformed(
        &back_doc,
        bg.symbol,
        &mut scene,
        bg_xform,
        0,
        flat_fill(0xff8000), // bc — orange so we can see disc
    );
    swf_spike::render::render_symbol_xformed(
        &back_doc,
        frm.symbol,
        &mut scene,
        frame_xform,
        0,
        flat_fill(0xffffff), // fc — white frame
    );
    swf_spike::render::render_symbol_xformed(
        &up_doc,
        glyph.symbol,
        &mut scene,
        glyph_xform,
        0,
        flat_fill(0x000000), // pc — black glyph for contrast
    );

    let mut headless = pollster::block_on(Headless::new())?;
    let pixels = headless.render_to_pixels(&scene, w, h, vello::peniko::Color::TRANSPARENT)?;
    image::save_buffer(&out_path, &pixels, w, h, image::ColorType::Rgba8)?;
    println!("wrote {}x{} icon to {:?}", w, h, out_path);
    Ok(())
}
