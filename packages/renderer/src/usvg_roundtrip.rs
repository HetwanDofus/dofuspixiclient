use std::fs;
use std::path::PathBuf;
use vello_svg::usvg;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: usvg-roundtrip <input.svg> [--output <output.svg>]");
        std::process::exit(1);
    }

    let input = PathBuf::from(&args[1]);
    let mut output: Option<PathBuf> = None;
    let mut i = 2;
    while i < args.len() {
        if args[i] == "--output" {
            output = args.get(i + 1).map(PathBuf::from);
            i += 2;
        } else {
            i += 1;
        }
    }

    let svg_content = fs::read_to_string(&input).expect("Failed to read SVG");
    let options = usvg::Options::default();
    let tree = usvg::Tree::from_str(&svg_content, &options).expect("Failed to parse SVG");
    let rewritten = tree.to_string(&usvg::WriteOptions::default());

    if let Some(out_path) = output {
        fs::write(&out_path, &rewritten).expect("Failed to write output");
    } else {
        print!("{}", rewritten);
    }
}
