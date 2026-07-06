//! Offline verification for the canonical stroke-width floor.
//!
//! CANONICAL RULE (ground truth = Flash player, user-confirmed):
//!   device_width = max(natural_width × total_scale, 1 device pixel)
//! The floor only LIFTS a stroke to 1 device px; anything naturally
//! scaling above 1 px renders at its true scaled size.
//!
//! Renders the same symbol three ways at the same resolution and
//! pixel-diffs them against the DIRECT reference:
//!
//!   ref  — DIRECT emit with the real transform (near-identity CXFORM
//!          forces the non-fragment emit path; tint math rounds to the
//!          exact same bytes). The stroke floor sees the true scale.
//!   frag — the standard fragment-cache path (`render_symbol`, colour-
//!          agnostic → `RenderCache::shape_frags`).
//!   sub  — the twip-identity sub-scene path (encode at IDENTITY, then
//!          `Scene::append` under the scaled transform) — what
//!          `tile_subscenes` / `body_subscene_cache` / `acc_subscenes`
//!          do in vello-wasm.
//!
//! Before the fix, `frag` and `sub` bake the floor at the WRONG scale
//! (1 twip instead of 1 device px) and differ from `ref` on every
//! hairline. After the fix all three must be ~identical (float-order
//! AA jitter only).
//!
//! Usage:
//!   cargo run --release -p swf-spike --bin verify-stroke-floor -- \
//!     [--res 3.5] [--out traces] [<swf> <export> [frame]]
//!
//! With no positional args it runs the two default fixtures
//! (sprites/11.swf staticR and gfx/g1.swf 502) from
//! `DOFUS_CLIENT_BASE` (same default as tests/regression.rs).

use std::path::PathBuf;

use anyhow::Result;
use vello::kurbo::{Affine, Vec2};
use vello::peniko::Color;
use vello::Scene;

use swf_spike::headless::Headless;
use swf_spike::recolor::PlayerColors;
use swf_spike::render::{
    render_symbol, render_symbol_with_ctx_tinted, render_symbol_xformed, symbol_bounds, WgpuCtx,
};
use swf_spike::swf_doc::{OwnedColorTransform, SwfDoc};
use swf_spike::wgpu_filters::FilterPipelines;

/// Repo-local SWF fixtures (same bundles the web client ships).
fn assets_base() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../assets/sources/clips")
}

/// CXFORM that is NOT `is_identity()` (add 0.0005 > 1e-4 threshold) but
/// rounds to byte-identical colours in `mult_add_u8` (0.0005 × 255 =
/// 0.1275 < 0.5). Forces the direct (non-fragment) emit path so the
/// stroke floor is computed against the REAL transform.
fn near_identity_cx() -> OwnedColorTransform {
    OwnedColorTransform {
        add_r: 0.0005,
        ..OwnedColorTransform::IDENTITY
    }
}

struct Diff {
    n_any: usize,
    n_gt2: usize,
    max_delta: u8,
    total: usize,
}

fn diff(a: &[u8], b: &[u8]) -> Diff {
    assert_eq!(a.len(), b.len());
    let mut n_any = 0usize;
    let mut n_gt2 = 0usize;
    let mut max_delta = 0u8;
    for (pa, pb) in a.chunks_exact(4).zip(b.chunks_exact(4)) {
        let mut px_delta = 0u8;
        for c in 0..4 {
            px_delta = px_delta.max(pa[c].abs_diff(pb[c]));
        }
        if px_delta > 0 {
            n_any += 1;
        }
        if px_delta > 2 {
            n_gt2 += 1;
        }
        max_delta = max_delta.max(px_delta);
    }
    Diff {
        n_any,
        n_gt2,
        max_delta,
        total: a.len() / 4,
    }
}

#[allow(clippy::too_many_arguments)]
fn run_case(
    headless: &mut Headless,
    swf_path: &PathBuf,
    export: &str,
    frame: u16,
    resolution: f64,
    out_dir: &PathBuf,
    tag: &str,
) -> Result<()> {
    let doc = SwfDoc::load(swf_path)?;
    let sym = doc
        .lookup_export(export)
        .ok_or_else(|| anyhow::anyhow!("no export `{export}` in {}", swf_path.display()))?;

    let bounds = symbol_bounds(&doc, sym, frame);
    let scale = resolution / 20.0;
    let pad = 2.0;
    let px_min_x = (bounds.x0 * scale).floor() - pad;
    let px_min_y = (bounds.y0 * scale).floor() - pad;
    let px_max_x = (bounds.x1 * scale).ceil() + pad;
    let px_max_y = (bounds.y1 * scale).ceil() + pad;
    let w = ((px_max_x - px_min_x) as u32).max(1);
    let h = ((px_max_y - px_min_y) as u32).max(1);
    let xform = Affine::scale(scale).then_translate(Vec2::new(-px_min_x, -px_min_y));

    // ── ref: DIRECT emit at the real transform ──────────────────────
    let mut ref_scene = Scene::new();
    render_symbol_xformed(&doc, sym, &mut ref_scene, xform, frame, near_identity_cx());
    let ref_px = headless.render_to_pixels(&ref_scene, w, h, Color::TRANSPARENT)?;

    // ── frag: standard fragment-cache path ──────────────────────────
    let mut frag_scene = Scene::new();
    render_symbol(&doc, sym, &mut frag_scene, xform, frame);
    let frag_px = headless.render_to_pixels(&frag_scene, w, h, Color::TRANSPARENT)?;

    // ── sub: twip-identity sub-scene, appended at the real scale ────
    let mut sub = Scene::new();
    {
        let pipelines = FilterPipelines::new(&headless.device);
        let mut wctx = WgpuCtx {
            device: &headless.device,
            queue: &headless.queue,
            renderer: &mut headless.renderer,
            filter_pipelines: &pipelines,
            output_scale: 1.0,
        };
        render_symbol_with_ctx_tinted(
            &mut wctx,
            &doc,
            sym,
            &mut sub,
            Affine::IDENTITY,
            frame,
            PlayerColors::default(),
            None,
            // The sub-scene is appended at `xform` (scale) below — the
            // canonical stroke floor must see that replay scale.
            scale,
        );
    }
    let mut sub_scene = Scene::new();
    sub_scene.append(&sub, Some(xform));
    let sub_px = headless.render_to_pixels(&sub_scene, w, h, Color::TRANSPARENT)?;

    std::fs::create_dir_all(out_dir).ok();
    for (name, px) in [("ref", &ref_px), ("frag", &frag_px), ("sub", &sub_px)] {
        let path = out_dir.join(format!("stroke_floor_{tag}_{name}.png"));
        image::save_buffer(&path, px, w, h, image::ColorType::Rgba8)?;
    }

    let d_frag = diff(&ref_px, &frag_px);
    let d_sub = diff(&ref_px, &sub_px);
    println!(
        "case {tag} ({export} @ res {resolution}, {w}x{h}, frame {frame}):"
    );
    println!(
        "  frag vs ref: {} px differ ({} px > 2), max channel delta {} / total {}",
        d_frag.n_any, d_frag.n_gt2, d_frag.max_delta, d_frag.total
    );
    println!(
        "  sub  vs ref: {} px differ ({} px > 2), max channel delta {} / total {}",
        d_sub.n_any, d_sub.n_gt2, d_sub.max_delta, d_sub.total
    );
    Ok(())
}

fn main() -> Result<()> {
    pollster::block_on(run())
}

async fn run() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    let res: f64 = argv
        .iter()
        .position(|a| a == "--res")
        .and_then(|i| argv.get(i + 1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(3.5);
    let out_dir = PathBuf::from(
        argv.iter()
            .position(|a| a == "--out")
            .and_then(|i| argv.get(i + 1))
            .cloned()
            .unwrap_or_else(|| "traces".to_string()),
    );
    let positional: Vec<&String> = argv[1..]
        .iter()
        .filter(|a| !a.starts_with("--"))
        .filter(|a| {
            // Drop values consumed by --res / --out.
            let idx = argv.iter().position(|x| x == *a).unwrap();
            idx == 0 || (argv[idx - 1] != "--res" && argv[idx - 1] != "--out")
        })
        .collect();

    let mut headless = Headless::new().await?;

    if positional.len() >= 2 {
        let swf = PathBuf::from(positional[0]);
        let export = positional[1];
        let frame: u16 = positional
            .get(2)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        run_case(&mut headless, &swf, export, frame, res, &out_dir, "custom")?;
        return Ok(());
    }

    let base = assets_base();
    if !base.exists() {
        anyhow::bail!("assets base missing: {}", base.display());
    }
    run_case(
        &mut headless,
        &base.join("sprites/11.swf"),
        "staticR",
        0,
        res,
        &out_dir,
        "sprite11_staticR",
    )?;
    run_case(
        &mut headless,
        &base.join("gfx/g1.swf"),
        "502",
        0,
        res,
        &out_dir,
        "tile_g1_502",
    )?;
    Ok(())
}
