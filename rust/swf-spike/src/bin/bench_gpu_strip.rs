//! Native GPU reference for the vello_cpu bench (CPU_RENDER_FEASIBILITY.md):
//! same composed-actor workload as `cpu-bench` (body + median hat/cape/
//! shield, warm palette), baked the way production bakes it — every frame
//! of the variant walked into ONE scene, one `render_to_texture` for the
//! whole strip — timed as submit + poll-wait. Completes the
//! {CPU, GPU} × {native, wasm} matrix.
//!
//! Run from `rust/`:
//! `cargo run --release -p swf-spike --bin bench-gpu-strip -- 10,50,100,121 1,3,5 5`

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};

use swf_spike::headless::Headless;
use swf_spike::recolor::PlayerColors;
use swf_spike::render::ctx::{AccessoryDict, AccessoryEntry};
use swf_spike::render::{
    render_symbol_with_ctx_tinted_accessorized, symbol_bounds, RenderCache, WgpuCtx,
};
use swf_spike::swf_doc::{OwnedOp, OwnedSprite, SwfDoc, Symbol};
use swf_spike::wgpu_filters::FilterPipelines;
use vello::kurbo::{Affine, Rect, Vec2};
use vello::peniko::Color;
use vello::wgpu;
use vello::{AaConfig, RenderParams, Scene};

const PAD_PX: f64 = 4.0;
const WARM_PALETTE: [Option<u32>; 3] = [Some(0xff_88_22), Some(0xee_cc_44), Some(0x99_55_22)];
const ACC_BUNDLE_FILES: [&str; 10] = [
    "a1.swf", "a2.swf", "a3.swf", "a4.swf", "a5.swf", "a6.swf", "a7.swf", "a8.swf",
    "accessories.swf", "accessories_autres.swf",
];

fn main() -> Result<()> {
    pollster::block_on(run())
}

struct Acc<'a> {
    slot: u8,
    label: String,
    doc: &'a SwfDoc,
    symbol: &'a Symbol,
}

/// Median gfx id per accessory type — identical picking rule to
/// `cpu_bench::bench::pick_accessories` so both benches compose the same
/// actor (16_203 + 17_155 + 82_101 with the current asset pack).
fn pick_accessories(acc_docs: &[SwfDoc]) -> Vec<Acc<'_>> {
    let mut specs = Vec::new();

    for (ty, slot) in [(16u32, 1u8), (17, 2), (82, 4)] {
        let prefix = format!("{ty}_");
        let mut pool: Vec<(u32, &SwfDoc, &Symbol)> = Vec::new();

        for doc in acc_docs {
            for (name, id) in &doc.by_name {
                let Some(gfx) = name.strip_prefix(&prefix).and_then(|s| s.parse::<u32>().ok())
                else {
                    continue;
                };

                if let Some(sym) = doc.by_id.get(id) {
                    pool.push((gfx, doc, sym));
                }
            }
        }

        pool.sort_by_key(|(gfx, _, _)| *gfx);

        if let Some((gfx, doc, sym)) = pool.get(pool.len() / 2) {
            specs.push(Acc {
                slot,
                label: format!("{ty}_{gfx}"),
                doc,
                symbol: sym,
            });
        }
    }

    specs
}

/// Same recursive rule as vello-wasm's `swfAnimFrameCount`.
fn num_frames(doc: &SwfDoc, sym: &Symbol) -> u16 {
    fn recurse(doc: &SwfDoc, sp: &OwnedSprite, depth: u32, best: &mut u16) {
        if depth == 0 {
            return;
        }

        for op in &sp.ops {
            let OwnedOp::Place(p) = op else { continue };
            let Some(id) = p.character_id else { continue };

            if let Some(Symbol::Sprite(child)) = doc.lookup_id(id) {
                *best = (*best).max(child.num_frames);
                recurse(doc, child, depth - 1, best);
            }
        }
    }

    let Symbol::Sprite(top) = sym else {
        return 1;
    };

    let mut best = top.num_frames;
    recurse(doc, top, 4, &mut best);

    best.max(1)
}

fn pick_export(doc: &SwfDoc) -> Option<String> {
    for name in ["walkR", "staticR", "runR"] {
        if doc.by_name.contains_key(name) {
            return Some(name.to_owned());
        }
    }

    None
}

/// Body bounds union across frames, padded by the largest accessory
/// bbox extent per side — the same accessory padding rule the production
/// strip bake applies.
fn cell_bounds(doc: &SwfDoc, sym: &Symbol, frames: u16, accs: &[Acc<'_>]) -> Rect {
    let mut b = symbol_bounds(doc, sym, 0);

    for f in 1..frames {
        b = b.union(symbol_bounds(doc, sym, f));
    }

    let mut pad = [0.0_f64; 4];

    for a in accs {
        let frames = num_frames(a.doc, a.symbol);

        for f in 0..frames.min(8) {
            let r = a.doc;
            let ab = symbol_bounds(r, a.symbol, f);
            pad[0] = pad[0].max(-ab.x0);
            pad[1] = pad[1].max(-ab.y0);
            pad[2] = pad[2].max(ab.x1);
            pad[3] = pad[3].max(ab.y1);
        }
    }

    Rect::new(b.x0 - pad[0], b.y0 - pad[1], b.x1 + pad[2], b.y1 + pad[3])
}

async fn run() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    let csv = |i: usize, def: &str| -> Vec<String> {
        argv.get(i)
            .map(|s| s.as_str())
            .unwrap_or(def)
            .split(',')
            .map(str::to_owned)
            .collect()
    };
    let classes: Vec<u32> = csv(1, "10,50,100,121").iter().map(|s| s.parse().unwrap()).collect();
    let zooms: Vec<f64> = csv(2, "1,3,5").iter().map(|s| s.parse().unwrap()).collect();
    let reps: usize = argv.get(3).map(|s| s.parse().unwrap()).unwrap_or(5);

    let sprites_dir = PathBuf::from("../assets/sources/clips/sprites");
    let acc_docs: Vec<SwfDoc> = ACC_BUNDLE_FILES
        .iter()
        .filter_map(|f| SwfDoc::load(&sprites_dir.join("accessories").join(f)).ok())
        .collect();
    let accs = pick_accessories(&acc_docs);
    eprintln!(
        "accessories: {}",
        accs.iter().map(|a| a.label.as_str()).collect::<Vec<_>>().join(", ")
    );

    let mut headless = Headless::new().await?;
    let pipelines = FilterPipelines::new(&headless.device);

    println!("\n| class | export | frames | zoom | cell px | strip px | walk ms | GPU ms/strip | GPU ms/frame |");
    println!("|---|---|---|---|---|---|---|---|---|");

    for class in &classes {
        let doc = SwfDoc::load(&sprites_dir.join(format!("{class}.swf")))
            .with_context(|| format!("loading {class}.swf"))?;
        let export = pick_export(&doc).context("no walkR")?;
        let sym = doc.lookup_export(&export).context("export")?;
        let frames = num_frames(&doc, sym);
        let bounds = cell_bounds(&doc, sym, frames, &accs);

        for &zoom in &zooms {
            bench_one(
                &mut headless, &pipelines, &doc, &export, sym, frames, bounds, &accs, *class,
                zoom, reps,
            )?;
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn bench_one(
    headless: &mut Headless,
    pipelines: &FilterPipelines,
    doc: &SwfDoc,
    export: &str,
    sym: &Symbol,
    frames: u16,
    bounds: Rect,
    accs: &[Acc<'_>],
    class: u32,
    zoom: f64,
    reps: usize,
) -> Result<()> {
    let ts = zoom / 20.0;
    let px_min_x = (bounds.x0 * ts).floor() - PAD_PX;
    let px_min_y = (bounds.y0 * ts).floor() - PAD_PX;
    let cell_w = ((bounds.x1 * ts).ceil() + PAD_PX - px_min_x).max(1.0) as u32;
    let cell_h = ((bounds.y1 * ts).ceil() + PAD_PX - px_min_y).max(1.0) as u32;
    let strip_w = (cell_w * u32::from(frames)).min(16384);
    let cols = strip_w / cell_w;
    let rows = (u32::from(frames)).div_ceil(cols);
    let strip_h = cell_h * rows;

    let cache = RenderCache::new();
    let colors = PlayerColors(WARM_PALETTE);
    let mut scene = Scene::new();

    let t_walk = Instant::now();

    for f in 0..frames {
        let col = u32::from(f) % cols;
        let row = u32::from(f) / cols;
        let xform = Affine::scale(ts).then_translate(Vec2::new(
            -px_min_x + f64::from(col * cell_w),
            -px_min_y + f64::from(row * cell_h),
        ));
        let mut dict: AccessoryDict<'_> = HashMap::new();

        for a in accs {
            dict.insert(
                a.slot,
                AccessoryEntry {
                    doc: a.doc,
                    symbol: a.symbol,
                    anim_type: 1,
                    char_frame: f,
                    char_dir_suffix: 'R',
                },
            );
        }

        let mut ctx = WgpuCtx {
            device: &headless.device,
            queue: &headless.queue,
            renderer: &mut headless.renderer,
            filter_pipelines: pipelines,
            output_scale: ts,
        };
        render_symbol_with_ctx_tinted_accessorized(
            &mut ctx, doc, sym, &mut scene, xform, f, colors, &cache, &dict,
        );
    }

    let walk_ms = t_walk.elapsed().as_secs_f64() * 1e3;

    let tex = headless.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bench_gpu_strip"),
        size: wgpu::Extent3d {
            width: strip_w,
            height: strip_h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    let params = RenderParams {
        base_color: Color::TRANSPARENT,
        width: strip_w,
        height: strip_h,
        antialiasing_method: AaConfig::Area,
    };

    let render_once = |headless: &mut Headless| -> Result<()> {
        headless
            .renderer
            .render_to_texture(&headless.device, &headless.queue, &scene, &view, &params)
            .map_err(|e| anyhow::anyhow!("render: {e:?}"))?;
        headless
            .device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            })
            .ok();

        Ok(())
    };

    // Warmup (pipeline compilation, first-submit costs) excluded.
    render_once(headless)?;

    let mut best = f64::MAX;

    for _ in 0..reps {
        let t = Instant::now();
        render_once(headless)?;
        best = best.min(t.elapsed().as_secs_f64() * 1e3);
    }

    println!(
        "| {} | {} | {} | {} | {}×{} | {}×{} | {:.2} | {:.2} | {:.3} |",
        class,
        export,
        frames,
        zoom,
        cell_w,
        cell_h,
        strip_w,
        strip_h,
        walk_ms,
        best,
        best / f64::from(frames),
    );

    Ok(())
}
