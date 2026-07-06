//! Verify canonical animated-scenery semantics for a scripted tile:
//! per-instance AVM1 playheads (tile_script::ChildScript) driven by the
//! per-cell seeded classification (tile_behavior::resolve_full).
//!
//! Canonical reference: o1.swf gfx 343 (map 35 chimney) —
//!   - child 1373 (129 frames, no scripts): smoke, free-runs forever.
//!   - child 1361 (210 frames, "elevator"): frame-1 `Stop` parks it;
//!     the placement's `onClipEvent(enterFrame)` runs a
//!     `Math.random() < p → play()` trigger, descent re-parks at the
//!     frame-102 `Stop` (see tile_script.rs module doc).
//!
//! Checks:
//!  (a) parked children STAY at their parked frame across ticks while
//!      free-running children advance `+1 % n` per tick;
//!  (b) two different cellIds produce different random trigger
//!      schedules (per-cell seeds).
//!
//! Dumps per-child frame vectors per tick + a PNG pair (both cells at
//! the same tick) under the output dir.
//!
//! Usage:
//!   cargo run -p swf-spike --bin verify-tile-scripts -- \
//!     <bundle.swf> <export> <cellA> <cellB> [--ticks N] [--out DIR]

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

use anyhow::{bail, Result};
use vello::kurbo::{Affine, Vec2};
use vello::peniko::Color;
use vello::Scene;

use swf_spike::headless::Headless;
use swf_spike::render::{render_tile_whole, symbol_bounds_pinned, RenderCache};
use swf_spike::swf_doc::{SwfDoc, Symbol};
use swf_spike::tile_behavior::{resolve_full, TileBehavior};
use swf_spike::tile_script::ChildScript;

struct CellSim {
    cell_id: u16,
    /// child_id → per-tick frame trace (index 0 = state at build).
    traces: HashMap<u16, Vec<u16>>,
    /// child_id → ticks at which `playing` flipped false→true.
    triggers: HashMap<u16, Vec<u32>>,
    /// Final scripts state (at `ticks`).
    scripts: Vec<ChildScript>,
    static_overrides: HashMap<u16, u16>,
}

fn simulate(sprite: &swf_spike::swf_doc::OwnedSprite, doc: &SwfDoc, cell_id: u16, ticks: u32) -> CellSim {
    let resolution = resolve_full(sprite, doc, cell_id);
    let mut scripts = resolution.child_scripts;
    let mut traces: HashMap<u16, Vec<u16>> = HashMap::new();
    let mut triggers: HashMap<u16, Vec<u32>> = HashMap::new();
    let mut playing_prev: HashMap<u16, bool> = HashMap::new();
    for s in &scripts {
        traces.entry(s.child_id).or_default().push(s.current_frame);
        playing_prev.insert(s.child_id, s.playing);
    }
    for t in 1..=ticks {
        for s in scripts.iter_mut() {
            s.tick();
            traces.entry(s.child_id).or_default().push(s.current_frame);
            let was = playing_prev.insert(s.child_id, s.playing).unwrap_or(false);
            if !was && s.playing {
                triggers.entry(s.child_id).or_default().push(t);
            }
        }
    }
    CellSim {
        cell_id,
        traces,
        triggers,
        scripts,
        static_overrides: resolution.child_overrides,
    }
}

fn main() -> Result<()> {
    pollster::block_on(run())
}

async fn run() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    if argv.len() < 5 {
        eprintln!("usage: verify-tile-scripts <bundle.swf> <export> <cellA> <cellB> [--ticks N] [--out DIR]");
        std::process::exit(2);
    }
    let bundle_path = PathBuf::from(&argv[1]);
    let export = argv[2].clone();
    let cell_a: u16 = argv[3].parse()?;
    let cell_b: u16 = argv[4].parse()?;
    let ticks: u32 = argv
        .iter()
        .position(|a| a == "--ticks")
        .and_then(|i| argv.get(i + 1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(6000);
    let out_dir = argv
        .iter()
        .position(|a| a == "--out")
        .and_then(|i| argv.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("traces"));
    fs::create_dir_all(&out_dir)?;

    let doc = SwfDoc::load(&bundle_path)?;
    let Some(sym) = doc.lookup_export(&export) else {
        bail!("no export `{export}` in {}", bundle_path.display());
    };
    let Symbol::Sprite(sprite) = sym else {
        bail!("export `{export}` is not a sprite");
    };

    // Inventory.
    let probe = resolve_full(sprite, &doc, cell_a);
    println!("export {export}: behavior={:?}", probe.behavior);
    for s in &probe.child_scripts {
        println!(
            "  child {}: {} frames, build frame={} playing={} enterFrame={} frameActions={}",
            s.child_id,
            s.num_frames,
            s.current_frame,
            s.playing,
            s.has_enter_frame(),
            s.has_frame_actions()
        );
    }
    for (id, f) in &probe.child_overrides {
        println!("  frozen child {id} pinned at frame {f}");
    }
    if !matches!(probe.behavior, TileBehavior::Animated { .. }) {
        bail!("export `{export}` did not classify Animated — nothing to verify");
    }

    // Simulate both cells and dump traces.
    let sims = [
        simulate(sprite, &doc, cell_a, ticks),
        simulate(sprite, &doc, cell_b, ticks),
    ];
    for sim in &sims {
        let mut dump = String::new();
        let mut ids: Vec<u16> = sim.traces.keys().copied().collect();
        ids.sort_unstable();
        writeln!(dump, "# {export} cell {} — per-tick child frames", sim.cell_id)?;
        writeln!(dump, "# tick {}", ids.iter().map(|i| format!("c{i}")).collect::<Vec<_>>().join(" "))?;
        for t in 0..=(ticks as usize) {
            let row: Vec<String> = ids
                .iter()
                .map(|id| sim.traces[id].get(t).map_or_else(|| "-".into(), |f| f.to_string()))
                .collect();
            writeln!(dump, "{t} {}", row.join(" "))?;
        }
        let path = out_dir.join(format!("tile_scripts_{export}_cell{}.txt", sim.cell_id));
        fs::write(&path, dump)?;
        println!("wrote {}", path.display());
    }

    // (a) free loops advance +1 % n; scripted (frame-action) children
    // stay parked between triggers.
    let mut checked_loop = false;
    let mut checked_parked = false;
    for probe_script in &probe.child_scripts {
        let id = probe_script.child_id;
        let n = probe_script.num_frames;
        for sim in &sims {
            let trace = &sim.traces[&id];
            if probe_script.playing && !probe_script.has_enter_frame() && !probe_script.has_frame_actions() {
                // Free-running loop: frame_t == (frame_0 + t) % n exactly.
                for (t, &f) in trace.iter().enumerate() {
                    let expect = ((u32::from(trace[0]) + t as u32) % u32::from(n)) as u16;
                    assert_eq!(
                        f, expect,
                        "cell {}: free child {id} diverged at tick {t}: {f} != {expect}",
                        sim.cell_id
                    );
                }
                checked_loop = true;
            }
            if probe_script.has_frame_actions() && !probe_script.playing {
                // Parked child: frame must NOT change on any tick where no
                // trigger has fired yet.
                let first_trigger = sim
                    .triggers
                    .get(&id)
                    .and_then(|v| v.first().copied())
                    .unwrap_or(ticks + 1);
                for (t, &f) in trace.iter().enumerate() {
                    if (t as u32) < first_trigger {
                        assert_eq!(
                            f, trace[0],
                            "cell {}: parked child {id} moved at tick {t} BEFORE any trigger",
                            sim.cell_id
                        );
                    }
                }
                println!(
                    "cell {}: parked child {id} stayed at frame {} for {} ticks, trigger ticks: {:?}",
                    sim.cell_id,
                    trace[0],
                    first_trigger.min(ticks),
                    sim.triggers.get(&id).map(|v| &v[..]).unwrap_or(&[])
                );
                checked_parked = true;
            }
        }
    }
    assert!(checked_loop, "no free-running child found to verify");
    assert!(checked_parked, "no parked scripted child found to verify");

    // (b) different cells → different trigger schedules.
    let mut schedules_differ = false;
    for probe_script in &probe.child_scripts {
        if !probe_script.has_enter_frame() {
            continue;
        }
        let id = probe_script.child_id;
        let a = sims[0].triggers.get(&id).cloned().unwrap_or_default();
        let b = sims[1].triggers.get(&id).cloned().unwrap_or_default();
        println!("child {id} trigger schedule: cell {} → {a:?}", sims[0].cell_id);
        println!("child {id} trigger schedule: cell {} → {b:?}", sims[1].cell_id);
        if a != b {
            schedules_differ = true;
        }
    }
    assert!(
        schedules_differ,
        "cells {cell_a} and {cell_b} produced IDENTICAL trigger schedules over {ticks} ticks — per-cell seeding broken (or too few ticks)"
    );

    // PNG pair: pick a tick where the two cells visibly diverge on a
    // scripted child (one mid-descent, one parked) and render both.
    let scripted_id = probe
        .child_scripts
        .iter()
        .find(|s| s.has_enter_frame())
        .map(|s| s.child_id);
    let png_tick = scripted_id
        .and_then(|id| {
            let ta = &sims[0].traces[&id];
            let tb = &sims[1].traces[&id];
            (0..ta.len()).find(|&t| ta[t] != tb[t])
        })
        .unwrap_or(ticks as usize / 2);
    println!("rendering PNG pair at tick {png_tick} (first frame-divergence of the scripted child)");

    let mut headless = Headless::new().await?;
    let cache = RenderCache::new();
    for sim in &sims {
        // Rebuild the exact composed state at png_tick from the traces.
        let mut overrides = sim.static_overrides.clone();
        for s in &sim.scripts {
            let f = sim.traces[&s.child_id][png_tick.min(ticks as usize)];
            overrides.insert(s.child_id, f);
        }
        let bounds = symbol_bounds_pinned(&doc, sym, 0, Some(&overrides));
        let scale = 2.0 / 20.0;
        let pad = 1.0;
        let px_min_x = (bounds.x0 * scale).floor() - pad;
        let px_min_y = (bounds.y0 * scale).floor() - pad;
        let w = (((bounds.x1 * scale).ceil() + pad - px_min_x) as u32).max(1);
        let h = (((bounds.y1 * scale).ceil() + pad - px_min_y) as u32).max(1);
        let xform = Affine::scale(scale).then_translate(Vec2::new(-px_min_x, -px_min_y));
        let mut scene = Scene::new();
        render_tile_whole(None, &doc, sym, &mut scene, xform, 0, &overrides, &cache);
        let pixels = headless.render_to_pixels(&scene, w, h, Color::TRANSPARENT)?;
        let path = out_dir.join(format!(
            "tile_scripts_{export}_cell{}_t{png_tick}.png",
            sim.cell_id
        ));
        image::save_buffer(&path, &pixels, w, h, image::ColorType::Rgba8)?;
        println!("wrote {}", path.display());
    }

    println!("OK: parked children park, loops advance, schedules differ per cell");
    Ok(())
}
