//! Pixel-regression tests. Each test renders a small representative
//! fixture and hashes the result; the hash is pinned in this file.
//! On mismatch the test writes the actual PNG to
//! `target/test-failures/` so the diff can be inspected.
//!
//! The rendering path under test:
//!
//! - `player_static_r_untinted` — `render_symbol` (no wgpu, no
//!   zones). Exercises sprite recursion + shape flattening cache.
//! - `player_static_r_tinted` — `render_symbol_with_ctx_tinted`
//!   with three player colours. Exercises HSL recolor + zone
//!   inheritance.
//! - `tile_343_chimney_smoke_frame_30` — `render_symbol`. The
//!   tile is a 1-frame top placing a 60-frame morph child, so this
//!   tests morph ratio threading and per-frame state walking.
//! - `spell_802_frame_30` — full AVM1 path: `AvmRenderer.tick()`
//!   then `build_snapshot()` then `render_snapshot()`. Exercises
//!   timeline + AS2 + DestIn alpha mask + per-placement state.
//!
//! SWFs aren't shipped with the repo. Tests skip cleanly if the
//! Dofus client isn't installed at the expected location (or
//! `DOFUS_CLIENT_BASE` env var). Override the base via:
//!
//!   DOFUS_CLIENT_BASE=/path/to/retroclient cargo test
//!
//! Update a hash after a deliberate render change:
//!
//!   1. Run `cargo test`. Failing test prints actual hash + path to
//!      target/test-failures/<name>.png.
//!   2. Visually verify the new render in Preview.
//!   3. Replace the constant in this file.
//!   4. Re-run `cargo test`.

use std::path::{Path, PathBuf};

use anyhow::Result;
use vello::kurbo::{Affine, Vec2};
use vello::peniko::Color;
use vello::Scene;

use swf_spike::headless::Headless;
use swf_spike::recolor::PlayerColors;
use swf_spike::render::{
    render_symbol, render_symbol_with_ctx_tinted, symbol_bounds, WgpuCtx,
};
use swf_spike::render_avm1::AvmRenderer;
use swf_spike::swf_doc::{Symbol, SwfDoc};
use swf_spike::wgpu_filters::FilterPipelines;

/// Default location of the Dofus 1.29 retroclient. Override via
/// `DOFUS_CLIENT_BASE` env var.
const DEFAULT_CLIENT_BASE: &str =
    "/Users/grandnainconnu/Work/personal/dofus/dofus1.29/clients/Retro1.47/retroclient";

fn client_base() -> Option<PathBuf> {
    let p = std::env::var("DOFUS_CLIENT_BASE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_CLIENT_BASE));
    p.exists().then_some(p)
}

/// CRC32 (IEEE polynomial). Inlined to avoid pulling sha2/blake3
/// just for fingerprinting render outputs. Collision risk on three
/// known-good outputs is effectively zero.
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xffff_ffff;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

/// Save the rendered PNG so a developer can inspect a regression.
fn save_failure(name: &str, w: u32, h: u32, pixels: &[u8]) -> PathBuf {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/test-failures");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join(format!("{name}.png"));
    let _ = image::save_buffer(&path, pixels, w, h, image::ColorType::Rgba8);
    path
}

fn assert_hash(name: &str, w: u32, h: u32, pixels: &[u8], expected: u32) {
    let actual = crc32(pixels);
    if actual != expected {
        let path = save_failure(name, w, h, pixels);
        panic!(
            "regression: {name}\n  expected crc32: 0x{expected:08x}\n  actual crc32:   0x{actual:08x}\n  actual saved to: {}",
            path.display()
        );
    }
}

/// Render an exported symbol at frame 0 to a fresh texture, return
/// (w, h, raw RGBA8 pixels).
async fn render_symbol_frame_0(
    swf_path: &Path,
    export: &str,
    scale: f64,
    bg: Color,
) -> Result<(u32, u32, Vec<u8>)> {
    let doc = SwfDoc::load(swf_path)?;
    let sym = doc
        .lookup_export(export)
        .ok_or_else(|| anyhow::anyhow!("no export `{}`", export))?;

    let bounds = symbol_bounds(&doc, sym, 0);
    let twip_scale = scale / 20.0;
    let pad = 4.0;
    let px_min_x = (bounds.x0 * twip_scale).floor() - pad;
    let px_min_y = (bounds.y0 * twip_scale).floor() - pad;
    let px_max_x = (bounds.x1 * twip_scale).ceil() + pad;
    let px_max_y = (bounds.y1 * twip_scale).ceil() + pad;
    let w = ((px_max_x - px_min_x) as u32).max(1);
    let h = ((px_max_y - px_min_y) as u32).max(1);

    let xform = Affine::scale(twip_scale).then_translate(Vec2::new(-px_min_x, -px_min_y));
    let mut scene = Scene::new();
    render_symbol(&doc, sym, &mut scene, xform, 0);

    let mut headless = Headless::new().await?;
    let pixels = headless.render_to_pixels(&scene, w, h, bg)?;
    Ok((w, h, pixels))
}

#[test]
fn player_static_r_untinted() {
    let Some(base) = client_base() else {
        eprintln!("skipping: DOFUS_CLIENT_BASE not set, default missing");
        return;
    };
    let swf = base.join("clips/sprites/10.swf");
    let (w, h, pixels) =
        pollster::block_on(render_symbol_frame_0(&swf, "staticR", 2.0, Color::WHITE))
            .expect("render");
    assert_hash("player_static_r_untinted", w, h, &pixels, 0x1d_e0_c7_3c);
}

#[test]
fn player_static_r_tinted_warm() {
    let Some(base) = client_base() else {
        eprintln!("skipping: DOFUS_CLIENT_BASE not set, default missing");
        return;
    };
    let swf = base.join("clips/sprites/10.swf");
    let doc = SwfDoc::load(&swf).expect("load");
    let sym = doc.lookup_export("staticR").expect("staticR export");

    let bounds = symbol_bounds(&doc, sym, 0);
    let scale = 2.0_f64;
    let twip_scale = scale / 20.0;
    let pad = 4.0;
    let px_min_x = (bounds.x0 * twip_scale).floor() - pad;
    let px_min_y = (bounds.y0 * twip_scale).floor() - pad;
    let px_max_x = (bounds.x1 * twip_scale).ceil() + pad;
    let px_max_y = (bounds.y1 * twip_scale).ceil() + pad;
    let w = ((px_max_x - px_min_x) as u32).max(1);
    let h = ((px_max_y - px_min_y) as u32).max(1);

    let pc = PlayerColors([Some(0xff_88_22), Some(0xee_cc_44), Some(0x99_55_22)]);
    let xform = Affine::scale(twip_scale).then_translate(Vec2::new(-px_min_x, -px_min_y));

    let mut scene = Scene::new();
    let mut headless = pollster::block_on(Headless::new()).expect("headless");
    let pipelines = FilterPipelines::new(&headless.device);
    let mut wgpu_ctx = WgpuCtx {
        device: &headless.device,
        queue: &headless.queue,
        renderer: &mut headless.renderer,
        filter_pipelines: &pipelines,
        output_scale: twip_scale,
    };
    render_symbol_with_ctx_tinted(&mut wgpu_ctx, &doc, sym, &mut scene, xform, 0, pc);
    drop(wgpu_ctx);
    drop(pipelines);
    let pixels = headless
        .render_to_pixels(&scene, w, h, Color::WHITE)
        .expect("render");

    assert_hash("player_static_r_tinted_warm", w, h, &pixels, 0xa8_03_84_35);
}

#[test]
fn tile_343_chimney_morph_frame_30() {
    let Some(base) = client_base() else {
        eprintln!("skipping: DOFUS_CLIENT_BASE not set, default missing");
        return;
    };
    // o1.swf — direct path on macOS bundles is `clips/gfx/o1.swf`;
    // on the server-style retroclient it's the same.
    let swf = base.join("clips/gfx/o1.swf");
    if !swf.exists() {
        eprintln!("skipping: {} missing", swf.display());
        return;
    }

    // Render frame 30 of tile 343 directly. The 60-frame morph
    // child sweeps ratio 0..64444; frame 30 should land near the
    // middle of the smoke arc — exercises morph ratio + cache.
    let doc = SwfDoc::load(&swf).expect("load");
    let sym = doc.lookup_export("343").expect("export 343");
    let bounds = symbol_bounds(&doc, sym, 30);
    let scale = 2.0_f64;
    let twip_scale = scale / 20.0;
    let pad = 4.0;
    let px_min_x = (bounds.x0 * twip_scale).floor() - pad;
    let px_min_y = (bounds.y0 * twip_scale).floor() - pad;
    let px_max_x = (bounds.x1 * twip_scale).ceil() + pad;
    let px_max_y = (bounds.y1 * twip_scale).ceil() + pad;
    let w = ((px_max_x - px_min_x) as u32).max(1);
    let h = ((px_max_y - px_min_y) as u32).max(1);

    let xform = Affine::scale(twip_scale).then_translate(Vec2::new(-px_min_x, -px_min_y));
    let mut scene = Scene::new();
    render_symbol(&doc, sym, &mut scene, xform, 30);

    let mut headless = pollster::block_on(Headless::new()).expect("headless");
    let pixels = headless
        .render_to_pixels(&scene, w, h, Color::BLACK)
        .expect("render");

    assert_hash("tile_343_chimney_morph_frame_30", w, h, &pixels, 0x4e_06_19_3a);
}

#[test]
fn spell_802_frame_30() {
    let Some(base) = client_base() else {
        eprintln!("skipping: DOFUS_CLIENT_BASE not set, default missing");
        return;
    };
    let swf = base.join("clips/spells/802.swf");
    if !swf.exists() {
        eprintln!("skipping: {} missing", swf.display());
        return;
    }

    // Full AVM1 path: tick the engine to frame 30, build a
    // resolved snapshot, render through render_snapshot.
    let doc = SwfDoc::load(&swf).expect("load");
    // Pick the longest sprite as the spell root (matches what
    // render-avm1-sheet does — spells don't export "anim1").
    let (root_id, root_sprite) = doc
        .by_id
        .iter()
        .filter_map(|(id, sym)| {
            if let Symbol::Sprite(s) = sym {
                Some((*id, s))
            } else {
                None
            }
        })
        .max_by_key(|(_, s)| s.num_frames)
        .expect("at least one sprite");
    let total = root_sprite.num_frames;
    let root_sym = Symbol::Sprite(root_sprite.clone());

    // Cell sizing — one frame at scale=2, padded.
    let bounds = symbol_bounds(&doc, &root_sym, 30);
    let scale = 2.0_f64;
    let twip_scale = scale / 20.0;
    let pad = 4.0;
    let px_min_x = (bounds.x0 * twip_scale).floor() - pad;
    let px_min_y = (bounds.y0 * twip_scale).floor() - pad;
    let px_max_x = (bounds.x1 * twip_scale).ceil() + pad;
    let px_max_y = (bounds.y1 * twip_scale).ceil() + pad;
    let w = ((px_max_x - px_min_x) as u32).max(1);
    let h = ((px_max_y - px_min_y) as u32).max(1);

    let xform = Affine::scale(twip_scale).then_translate(Vec2::new(-px_min_x, -px_min_y));

    let mut avm = AvmRenderer::new(total);
    for _ in 0..30 {
        avm.tick(&doc, &root_sym);
        avm.advance(&doc, &root_sym);
    }
    avm.tick(&doc, &root_sym);

    let mut scene = Scene::new();
    let mut headless = pollster::block_on(Headless::new()).expect("headless");
    let pipelines = FilterPipelines::new(&headless.device);
    let mut wgpu_ctx = WgpuCtx {
        device: &headless.device,
        queue: &headless.queue,
        renderer: &mut headless.renderer,
        filter_pipelines: &pipelines,
        output_scale: twip_scale,
    };
    avm.render(&doc, &root_sym, &mut scene, xform, Some(&mut wgpu_ctx));
    drop(wgpu_ctx);
    drop(pipelines);
    let pixels = headless
        .render_to_pixels(&scene, w, h, Color::BLACK)
        .expect("render");
    let _ = root_id;

    assert_hash("spell_802_frame_30", w, h, &pixels, 0xe5_d4_92_10);
}
