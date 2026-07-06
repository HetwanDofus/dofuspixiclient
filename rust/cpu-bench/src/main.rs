//! Native CLI for the vello_cpu bench — see `bench.rs` for the workload.
//!
//! For every class it benches the bare body variant AND the full composed
//! actor (body + hat + cape + shield from the real accessory bundles,
//! unique palette). Run from `rust/`:
//! `cargo run --release -p cpu-bench -- [classes] [zooms] [threads] [reps]`
//! e.g. `cargo run --release -p cpu-bench -- 10,100,121 1,3,5 0,7 3`

use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};

use cpu_bench::bench::{VariantBench, bench_variant, pick_accessories, pick_export};
use cpu_bench::replay;
use swf_spike::render::set_record_fragments;
use swf_spike::swf_doc::SwfDoc;
use vello_cpu::{Pixmap, RenderContext};

const ACC_BUNDLE_FILES: [&str; 10] = [
    "a1.swf", "a2.swf", "a3.swf", "a4.swf", "a5.swf", "a6.swf", "a7.swf", "a8.swf",
    "accessories.swf", "accessories_autres.swf",
];

struct Args {
    sprites_dir: PathBuf,
    classes: Vec<u32>,
    zooms: Vec<f64>,
    threads: Vec<u16>,
    reps: usize,
    out_dir: PathBuf,
}

fn main() -> Result<()> {
    let args = parse_args();
    fs::create_dir_all(&args.out_dir)?;
    set_record_fragments(true);

    let acc_dir = args.sprites_dir.join("accessories");
    let acc_docs: Vec<SwfDoc> = ACC_BUNDLE_FILES
        .iter()
        .filter_map(|f| SwfDoc::load(&acc_dir.join(f)).ok())
        .collect();
    let accs = pick_accessories(&acc_docs);
    eprintln!(
        "accessory bundles loaded: {} | picked: {}",
        acc_docs.len(),
        accs.iter().map(|a| a.label.as_str()).collect::<Vec<_>>().join(", ")
    );

    let mut rows = Vec::new();

    for class in &args.classes {
        let path = args.sprites_dir.join(format!("{class}.swf"));
        let doc = SwfDoc::load(&path).with_context(|| format!("loading {}", path.display()))?;
        let export = pick_export(&doc)
            .with_context(|| format!("no character-anim export in {class}.swf"))?;

        for &zoom in &args.zooms {
            for acc_set in [&[][..], &accs[..]] {
                let b = bench_variant(&doc, &export, acc_set, zoom, &args.threads, args.reps)
                    .context("export vanished")?;

                if b.lossy > 0 {
                    eprintln!("[warn] class {class} {export} zoom {zoom}: {} lossy ops", b.lossy);
                }

                write_png(&args, *class, &b)?;
                rows.push((*class, b));
            }
        }
    }

    print_report(&rows, &args);

    Ok(())
}

fn parse_args() -> Args {
    let argv: Vec<String> = std::env::args().collect();
    let csv = |i: usize, def: &str| -> Vec<String> {
        argv.get(i)
            .map(|s| s.as_str())
            .unwrap_or(def)
            .split(',')
            .map(str::to_owned)
            .collect()
    };

    Args {
        sprites_dir: PathBuf::from("../assets/sources/clips/sprites"),
        classes: csv(1, "10,100,121").iter().map(|s| s.parse().unwrap()).collect(),
        zooms: csv(2, "1,3,5").iter().map(|s| s.parse().unwrap()).collect(),
        threads: csv(3, "0,7").iter().map(|s| s.parse().unwrap()).collect(),
        reps: argv.get(4).map(|s| s.parse().unwrap()).unwrap_or(3),
        out_dir: PathBuf::from("target/cpu-bench"),
    }
}

fn write_png(args: &Args, class: u32, b: &VariantBench) -> Result<()> {
    let mut ctx = RenderContext::new(b.width, b.height);
    let mut resources = vello_cpu::Resources::new();
    let mut stats = replay::ReplayStats::default();

    replay::replay(&b.first_recording, &mut ctx, b.base, &mut stats);
    ctx.flush();

    let mut pixmap = Pixmap::new(b.width, b.height);
    ctx.render_to_pixmap(&mut resources, &mut pixmap);

    let kind = if b.acc_labels.is_empty() { "body" } else { "composed" };
    let path = args
        .out_dir
        .join(format!("class{class}-{}-{kind}-z{}.png", b.export, b.zoom));
    fs::write(&path, pixmap.into_png()?)?;

    Ok(())
}

fn print_report(rows: &[(u32, VariantBench)], args: &Args) {
    println!("\n## vello_cpu on real class-sprite bakes (variant = all frames of one export)\n");
    println!("GPU in-browser reference: 5-15 ms per variant bake, ~8-10 ms per atlas page.\n");

    let header: String = args
        .threads
        .iter()
        .map(|n| format!(" replay/raster t{n} |"))
        .collect();
    println!("| class | export | acc | frames | zoom | cell px | ops | walk cold/warm ms |{header} per-frame t0 |");
    println!("|---|---|---|---|---|---|---|---|{}---|", "---|".repeat(args.threads.len()));

    for (class, r) in rows {
        let cells: String = r
            .timings
            .iter()
            .map(|(_, rp, ra)| format!(" {rp:.2} / {ra:.2} |"))
            .collect();
        let acc = if r.acc_labels.is_empty() { "-" } else { r.acc_labels.as_str() };
        println!(
            "| {} | {} | {} | {} | {} | {}×{} | {} | {:.2} / {:.2} |{cells} {:.3} |",
            class,
            r.export,
            acc,
            r.frames,
            r.zoom,
            r.width,
            r.height,
            r.ops,
            r.walk_cold_ms,
            r.walk_warm_ms,
            r.per_frame_ms(0),
        );
    }

    println!("\nPNGs: {}", args.out_dir.display());
}
