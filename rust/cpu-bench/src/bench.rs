//! Core benchmark loop, shared by the native CLI and the wasm harness.
//!
//! One "variant" = every frame of one character-anim export at one zoom —
//! the unit the class-atlas / body bake renders per (anim, dir, zoom),
//! measured at 5-15 ms on the in-browser GPU path (RENDER_STATE.md v5).
//! With `AccSpec`s the walk composes mounted accessories exactly like the
//! production `renderSwfStripRangeAccessorized` path (identity look-slot →
//! mount-slot mapping; weapon has no static mount and is excluded, as in
//! production).

use std::collections::HashMap;

use web_time::Instant;

use swf_spike::recolor::PlayerColors;
use swf_spike::render::ctx::{AccessoryDict, AccessoryEntry};
use swf_spike::render::{
    RenderCache, render_symbol_tinted_accessorized_nogpu, render_symbol_tinted_nogpu,
};
use swf_spike::swf_doc::{OwnedOp, OwnedSprite, SwfDoc, Symbol};
use vello::Scene;
use vello::kurbo::{Affine, Rect, Shape, Vec2};
use vello::record::{DisplayOp, Recording};
use vello_cpu::{RenderContext, RenderMode, RenderSettings};

use crate::replay;

const PAD_PX: f64 = 4.0;
const WARM_PALETTE: [Option<u32>; 3] = [Some(0xff_88_22), Some(0xee_cc_44), Some(0x99_55_22)];

/// One accessory to mount during the walk. `slot` is the AS2 mount slot
/// (1 = hat, 2 = cape, 4 = shield).
pub struct AccSpec<'a> {
    pub slot: u8,
    pub label: String,
    pub doc: &'a SwfDoc,
    pub symbol: &'a Symbol,
    pub anim_type: u8,
}

/// Timings for one (export, zoom) variant. All ms.
pub struct VariantBench {
    pub export: String,
    pub acc_labels: String,
    pub frames: u16,
    pub zoom: f64,
    pub width: u16,
    pub height: u16,
    pub ops: usize,
    pub lossy: u32,
    pub walk_cold_ms: f64,
    pub walk_warm_ms: f64,
    /// (num_threads, replay ms per variant, raster ms per variant)
    pub timings: Vec<(u16, f64, f64)>,
    /// Translation mapping recorded twip-scaled space into the pixel cell.
    pub base: Affine,
    /// Frame-0 recording, for rendering a sanity PNG.
    pub first_recording: Recording,
}

impl VariantBench {
    /// Per-frame replay+raster ms for thread config `i`.
    pub fn per_frame_ms(&self, i: usize) -> f64 {
        let (_, rp, ra) = self.timings[i];

        (rp + ra) / f64::from(self.frames)
    }
}

/// Prefer the canonical walk-right export; fall back to any character anim.
pub fn pick_export(doc: &SwfDoc) -> Option<String> {
    for name in ["walkR", "staticR", "runR"] {
        if doc.by_name.contains_key(name) {
            return Some(name.to_owned());
        }
    }

    doc.by_name
        .keys()
        .find(|n| n.starts_with("walk") || n.starts_with("static") || n.starts_with("run"))
        .cloned()
}

/// Pick one hat (type 16 → slot 1), cape (17 → slot 2) and shield
/// (82 → slot 4) from the loaded accessory bundles — the median gfx id of
/// each type's pool, so the choice is deterministic and mid-complexity.
/// Mirrors the stress test's pools built from real `TYPE_GFX` exports.
pub fn pick_accessories<'a>(acc_docs: &'a [SwfDoc]) -> Vec<AccSpec<'a>> {
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
            specs.push(AccSpec {
                slot,
                label: format!("{ty}_{gfx}"),
                doc,
                symbol: sym,
                anim_type: 1,
            });
        }
    }

    specs
}

/// Effective animation length. Character-anim exports like `walkR` are
/// 1-frame wrappers around the real animation, so the count is the max
/// timeline length over nested children — the same rule vello-wasm's
/// `swfAnimFrameCount` uses to drive the JS ticker.
pub fn num_frames(doc: &SwfDoc, sym: &Symbol) -> u16 {
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

/// Exact pixel bbox of everything a recording draws (accessories
/// included), so the cell is sized like the production bake's
/// accessory-padded strip rather than from body bounds alone.
fn recording_bbox(rec: &Recording, base: Affine) -> Option<Rect> {
    let mut acc: Option<Rect> = None;

    for op in &rec.ops {
        let r = match op {
            DisplayOp::Fill { transform, path, .. } => {
                Some((base * *transform).transform_rect_bbox(path.bounding_box()))
            }
            DisplayOp::Stroke { style, transform, path, .. } => {
                let t = base * *transform;
                let half = style.width * 0.5 * t.determinant().abs().sqrt();

                Some(t.transform_rect_bbox(path.bounding_box()).inflate(half, half))
            }
            DisplayOp::Append { rec, transform } => {
                recording_bbox(rec, base * transform.unwrap_or(Affine::IDENTITY))
            }
            _ => None,
        };

        if let Some(r) = r {
            acc = Some(match acc {
                None => r,
                Some(a) => a.union(r),
            });
        }
    }

    acc
}

/// Walk + record + rasterize one export (optionally accessorized) at one
/// zoom for each worker-thread config (`RenderSettings::num_threads`
/// values, 0 = single-threaded).
pub fn bench_variant(
    doc: &SwfDoc,
    export: &str,
    accs: &[AccSpec<'_>],
    zoom: f64,
    threads: &[u16],
    reps: usize,
) -> Option<VariantBench> {
    let sym = doc.lookup_export(export)?;
    let frames = num_frames(doc, sym);
    let xform = Affine::scale(zoom / 20.0);

    let (recordings, walk_cold_ms, walk_warm_ms) = record_frames(doc, sym, accs, xform, frames);
    let ops: usize = recordings.iter().map(Recording::deep_op_count).sum();
    let lossy: u32 = recordings.iter().map(Recording::deep_lossy).sum();

    let mut bb: Option<Rect> = None;

    for rec in &recordings {
        if let Some(r) = recording_bbox(rec, Affine::IDENTITY) {
            bb = Some(match bb {
                None => r,
                Some(a) => a.union(r),
            });
        }
    }

    let bb = bb?;
    let width = (bb.width().ceil() + 2.0 * PAD_PX).max(1.0) as u16;
    let height = (bb.height().ceil() + 2.0 * PAD_PX).max(1.0) as u16;
    let base = Affine::translate(Vec2::new(-bb.x0 + PAD_PX, -bb.y0 + PAD_PX));

    let mut timings = Vec::new();

    for &n in threads {
        timings.push(time_raster(&recordings, base, width, height, n, reps));
    }

    Some(VariantBench {
        export: export.to_owned(),
        acc_labels: accs.iter().map(|a| a.label.as_str()).collect::<Vec<_>>().join("+"),
        frames,
        zoom,
        width,
        height,
        ops,
        lossy,
        walk_cold_ms,
        walk_warm_ms,
        timings,
        base,
        first_recording: recordings.into_iter().next().expect("frames >= 1"),
    })
}

/// Walk every frame through the SWF renderer, capturing one recording per
/// frame. Returns (recordings, first-frame walk ms, per-frame warm walk ms).
fn record_frames(
    doc: &SwfDoc,
    sym: &Symbol,
    accs: &[AccSpec<'_>],
    xform: Affine,
    frames: u16,
) -> (Vec<Recording>, f64, f64) {
    let cache = RenderCache::new();
    let colors = PlayerColors(WARM_PALETTE);
    let mut recordings = Vec::with_capacity(frames as usize);
    let mut cold = 0.0;
    let mut warm = 0.0;

    for f in 0..frames {
        let mut scene = Scene::new();
        scene.enable_recording();

        // The accessory dict is rebuilt per frame like the production
        // bake loop — `char_frame` syncs the accessory's own cycle to
        // the character animation.
        let mut dict: AccessoryDict<'_> = HashMap::new();

        for a in accs {
            dict.insert(
                a.slot,
                AccessoryEntry {
                    doc: a.doc,
                    symbol: a.symbol,
                    anim_type: a.anim_type,
                    char_frame: f,
                    char_dir_suffix: 'R',
                },
            );
        }

        let t = Instant::now();

        if dict.is_empty() {
            render_symbol_tinted_nogpu(doc, sym, &mut scene, xform, f, colors, &cache);
        } else {
            render_symbol_tinted_accessorized_nogpu(
                doc, sym, &mut scene, xform, f, colors, &cache, &dict,
            );
        }

        let ms = t.elapsed().as_secs_f64() * 1e3;

        if f == 0 {
            cold = ms;
        } else {
            warm += ms;
        }

        recordings.push(scene.take_recording().expect("recording enabled"));
    }

    let warm_avg = if frames > 1 { warm / f64::from(frames - 1) } else { cold };

    (recordings, cold, warm_avg)
}

/// Replay + rasterize the whole variant (all frames) `reps` times at the
/// given worker-thread count; returns (threads, best replay ms, best raster ms).
fn time_raster(
    recordings: &[Recording],
    base: Affine,
    width: u16,
    height: u16,
    threads: u16,
    reps: usize,
) -> (u16, f64, f64) {
    let settings = RenderSettings {
        num_threads: threads,
        ..Default::default()
    };
    let mut ctx = RenderContext::new_with(width, height, settings);
    let mut resources = vello_cpu::Resources::new();
    let mut buf = vec![0_u8; usize::from(width) * usize::from(height) * 4];
    let mut best = (f64::MAX, f64::MAX);

    for _ in 0..reps {
        let mut replay_ms = 0.0;
        let mut raster_ms = 0.0;

        for rec in recordings {
            let mut stats = replay::ReplayStats::default();

            let t = Instant::now();
            replay::replay(rec, &mut ctx, base, &mut stats);
            ctx.flush();
            replay_ms += t.elapsed().as_secs_f64() * 1e3;

            let t = Instant::now();
            ctx.render_to_buffer(&mut resources, &mut buf, width, height, RenderMode::OptimizeSpeed);
            raster_ms += t.elapsed().as_secs_f64() * 1e3;

            ctx.reset();
        }

        best.0 = best.0.min(replay_ms);
        best.1 = best.1.min(raster_ms);
    }

    (threads, best.0, best.1)
}
