//! Render a spell SWF as an N-frame spritesheet, ticking the AVM1 scripts at
//! every step. Mirrors `render-cast-sheet`'s layout but uses `AvmRenderer`
//! instead of the stateless walker — so `_rotation += 0.66`,
//! `_alpha = random(...)`, `gotoAndStop(random(2)+1)` and friends actually
//! drive the visuals.
//!
//! Usage:
//!   render-avm1-sheet <spell.swf> <out.png> [--scale N] [--frames N] [--cols N]
//!
//! Picks the longest DefineSprite as the spell's main animation (Dofus
//! convention; spell 802's id=10 has 129 frames).

use std::fs;
use std::path::PathBuf;

use anyhow::{anyhow, Result};
use vello::kurbo::{Affine, Rect, Vec2};
use vello::peniko::Color;
use vello::Scene;

use swf_spike::headless::Headless;
use swf_spike::render::{symbol_bounds, WgpuCtx};
use swf_spike::render_avm1::AvmRenderer;
use swf_spike::swf_doc::{OwnedSprite, Symbol, SwfDoc};
use swf_spike::wgpu_filters::FilterPipelines;

fn main() -> Result<()> {
    pollster::block_on(run())
}

async fn run() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    if argv.len() < 3 {
        eprintln!("usage: render-avm1-sheet <swf> <out.png> [--scale N] [--frames N] [--cols N]");
        std::process::exit(2);
    }
    let swf_path = PathBuf::from(&argv[1]);
    let out_path = PathBuf::from(&argv[2]);
    let scale: f64 = parse_flag(&argv, "--scale").unwrap_or(2.0);
    let cols: usize = parse_flag(&argv, "--cols").unwrap_or(16);
    let frames_override: Option<u16> = parse_flag(&argv, "--frames");
    // Background colour for each cell. Spell SWFs ship translucent colours
    // intended to composite over a non-transparent map (the game renders the
    // spell on top of cells + caster). Default keeps transparent for
    // diff-friendliness, but `--bg white` gives the in-game look.
    let bg = match parse_flag_str(&argv, "--bg").as_deref() {
        Some("white") => Color::WHITE,
        Some("black") => Color::BLACK,
        Some("gray") | Some("grey") => Color::from_rgba8(128, 128, 128, 255),
        _ => Color::TRANSPARENT,
    };

    let doc = SwfDoc::load(&swf_path)?;

    // Spell SWFs don't export `anim1`; pick the longest sprite.
    let (sprite_id, _sprite_ref, total_frames) = {
        let mut best: Option<(u16, &OwnedSprite, u16)> = None;
        for (id, sym) in &doc.by_id {
            if let Symbol::Sprite(s) = sym {
                match best {
                    None => best = Some((*id, s, s.num_frames)),
                    Some((_, _, n)) if s.num_frames > n => best = Some((*id, s, s.num_frames)),
                    _ => {}
                }
            }
        }
        best.ok_or_else(|| anyhow!("no DefineSprite in {}", swf_path.display()))?
    };
    let frames = frames_override.unwrap_or(total_frames);
    eprintln!(
        "main sprite: id={} {} frames (rendering {})",
        sprite_id, total_frames, frames
    );

    // Build root sprite that places the main animation at depth 1, identity
    // matrix. AvmRenderer expects the root to be a Sprite, and our SWF docs
    // already have `doc.root` as the file's root timeline. But the file root
    // for a spell is just `place(spell_sprite)`, so we can use it directly.
    let root_sym = Symbol::Sprite(doc.root.clone());

    // Compute union bounds across all frames so each cell is the same size.
    let twip_scale = scale / 20.0;
    let pad = 2.0;
    let main_sym = doc.by_id.get(&sprite_id).unwrap();
    let mut union: Option<Rect> = None;
    for f in 0..frames.max(1) {
        let r = symbol_bounds(&doc, main_sym, f);
        if r.width() > 0.0 && r.height() > 0.0 {
            union = Some(match union {
                None => r,
                Some(prev) => prev.union(r),
            });
        }
    }
    let r = union.unwrap_or(Rect::new(0.0, 0.0, 1.0, 1.0));
    let px_min_x = (r.x0 * twip_scale).floor() - pad;
    let px_min_y = (r.y0 * twip_scale).floor() - pad;
    let px_max_x = (r.x1 * twip_scale).ceil() + pad;
    let px_max_y = (r.y1 * twip_scale).ceil() + pad;
    let cell_w = ((px_max_x - px_min_x) as u32).max(1);
    let cell_h = ((px_max_y - px_min_y) as u32).max(1);
    eprintln!("cell: {}×{} px (scale={})", cell_w, cell_h, scale);

    let n = frames.max(1) as usize;
    let strip_rows = (n + cols - 1) / cols;
    let sheet_w = cell_w * cols as u32;
    let sheet_h = cell_h * strip_rows as u32;
    eprintln!(
        "sheet: {}×{} px ({} frames, {} cols × {} rows)",
        sheet_w, sheet_h, n, cols, strip_rows
    );

    let mut headless = Headless::new().await?;
    let filter_pipelines = FilterPipelines::new(&headless.device);
    let mut sheet = vec![0u8; (sheet_w * sheet_h * 4) as usize];

    // Build a fresh AvmRenderer. Tick once per output frame, then render.
    let mut renderer = AvmRenderer::new(doc.root.num_frames);

    for frame_idx in 0..n {
        // Order: tick (process current frame) → render (draw it) → advance
        // (step to next frame). Combining tick+advance in one step is what
        // caused fresh-placement instance_map misses → AVM1 state leakage.
        renderer.tick(&doc, &root_sym);

        // Render this frame into a per-cell texture, with filter pipelines
        // available so DropShadow / Glow / Blur composite via the GPU
        // compute path instead of being silently dropped.
        let mut scene = Scene::new();
        let xform = Affine::scale(twip_scale).then_translate(Vec2::new(
            -r.x0 * twip_scale - pad,
            -r.y0 * twip_scale - pad,
        ));
        {
            let mut ctx = WgpuCtx {
                device: &headless.device,
                queue: &headless.queue,
                renderer: &mut headless.renderer,
                filter_pipelines: &filter_pipelines,
                output_scale: scale,
            };
            renderer.render(&doc, &root_sym, &mut scene, xform, Some(&mut ctx));
        }
        let pixels = headless.render_to_pixels(&scene, cell_w, cell_h, bg)?;

        let col = frame_idx % cols;
        let row = frame_idx / cols;
        let dst_x = (col as u32) * cell_w;
        let dst_y = (row as u32) * cell_h;
        for ry in 0..cell_h {
            let src_off = (ry * cell_w * 4) as usize;
            let dst_off = (((dst_y + ry) * sheet_w + dst_x) * 4) as usize;
            let bytes = (cell_w * 4) as usize;
            sheet[dst_off..dst_off + bytes]
                .copy_from_slice(&pixels[src_off..src_off + bytes]);
        }

        // Advance current_frame across the whole tree so the NEXT iteration
        // sees the next frame's placements (which the next tick will then
        // ensure instances for and run handlers on).
        renderer.advance(&doc, &root_sym);
    }

    fs::create_dir_all(out_path.parent().unwrap_or(std::path::Path::new("."))).ok();
    image::save_buffer(&out_path, &sheet, sheet_w, sheet_h, image::ColorType::Rgba8)?;
    eprintln!("wrote {}", out_path.display());
    Ok(())
}

fn parse_flag<T: std::str::FromStr>(argv: &[String], name: &str) -> Option<T> {
    argv.iter()
        .position(|a| a == name)
        .and_then(|i| argv.get(i + 1))
        .and_then(|s| s.parse().ok())
}

fn parse_flag_str(argv: &[String], name: &str) -> Option<String> {
    argv.iter()
        .position(|a| a == name)
        .and_then(|i| argv.get(i + 1))
        .cloned()
}
