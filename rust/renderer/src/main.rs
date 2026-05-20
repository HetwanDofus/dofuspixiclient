use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use vello::peniko::Color;
use vello::{wgpu, AaConfig, Renderer, RendererOptions, Scene};

mod color;
mod format;
mod pattern;
mod scene_builder;

struct Args {
    input: PathBuf,
    animation: String,
    frame: usize,
    colors: Option<[u32; 3]>,
    resolution: f32,
    output: PathBuf,
    all_frames: bool,
    /// Accessory SVG files: "slot_id:path.svg" (e.g. "0:weapon.svg,1:hat.svg")
    accessories: Vec<(u8, PathBuf)>,
}

fn parse_args() -> Args {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!(
            "Usage: cargo run -- <input.dofasset> [--animation staticF] [--frame 0] \
             [--colors 0xff0000,0x00ff00,0x0000ff] [--resolution 2] [--output render.png] [--all-frames]"
        );
        std::process::exit(1);
    }

    let mut result = Args {
        input: PathBuf::from(&args[1]),
        animation: "staticF".to_string(),
        frame: 0,
        colors: None,
        resolution: 2.0,
        output: PathBuf::from("render.png"),
        all_frames: false,
        accessories: Vec::new(),
    };

    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--animation" => {
                result.animation = args.get(i + 1).cloned().unwrap_or_default();
                i += 2;
            }
            "--frame" => {
                result.frame = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(0);
                i += 2;
            }
            "--colors" => {
                if let Some(s) = args.get(i + 1) {
                    let parts: Vec<u32> = s
                        .split(',')
                        .filter_map(|p| {
                            let p = p.trim().trim_start_matches("0x").trim_start_matches("0X");
                            u32::from_str_radix(p, 16).ok()
                        })
                        .collect();
                    if parts.len() >= 3 {
                        result.colors = Some([parts[0], parts[1], parts[2]]);
                    }
                }
                i += 2;
            }
            "--resolution" => {
                result.resolution = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(2.0);
                i += 2;
            }
            "--output" => {
                result.output = PathBuf::from(args.get(i + 1).cloned().unwrap_or_default());
                i += 2;
            }
            "--all-frames" => {
                result.all_frames = true;
                i += 1;
            }
            "--accessory" => {
                // Format: "slot_id:path/to/accessory.svg"
                if let Some(s) = args.get(i + 1) {
                    if let Some((slot, path)) = s.split_once(':') {
                        if let Ok(slot_id) = slot.parse::<u8>() {
                            result.accessories.push((slot_id, PathBuf::from(path)));
                        }
                    }
                }
                i += 2;
            }
            _ => {
                eprintln!("Unknown argument: {}", args[i]);
                i += 1;
            }
        }
    }

    result
}

fn main() {
    pollster::block_on(run());
}

async fn run() {
    let args = parse_args();

    if !args.input.exists() {
        eprintln!("Input file not found: {}", args.input.display());
        std::process::exit(1);
    }

    // Load .dofasset
    println!("Loading: {}", args.input.display());
    let load_start = Instant::now();
    let file_data = fs::read(&args.input).expect("Failed to read file");
    let asset = format::load(&file_data);
    let load_ms = load_start.elapsed().as_secs_f64() * 1000.0;
    println!(
        "Loaded in {load_ms:.2}ms — {} animations, {} body parts, {} transforms, {} frames",
        asset.animations.len(),
        asset.body_parts.len(),
        asset.transforms.len(),
        asset.frames.len()
    );

    // Verify animation exists (skip for --animation "*" which renders all)
    let anim = if args.animation != "*" {
        let anim_idx = match asset.animation_map.get(&args.animation) {
            Some(&idx) => idx,
            None => {
                eprintln!(
                    "Animation '{}' not found. Available:",
                    args.animation
                );
                for anim in &asset.animations {
                    eprintln!("  {} ({} frames)", anim.name, anim.frame_ids.len());
                }
                std::process::exit(1);
            }
        };
        let anim = &asset.animations[anim_idx];
        println!(
            "Animation '{}': {} frames @ {} fps, offset ({}, {})",
            anim.name,
            anim.frame_ids.len(),
            anim.fps,
            anim.offset_x,
            anim.offset_y
        );
        Some(anim)
    } else {
        let total: usize = asset.animations.iter().map(|a| a.frame_ids.len()).sum();
        println!("All {} animations, {} total frames", asset.animations.len(), total);
        None
    };

    // Load accessory SVGs
    // Format: "slot_id:path.svg" or "slot_id:path.svg:offsetX:offsetY"
    let mut acc_scenes: Vec<scene_builder::AccessoryScene> = Vec::new();
    for (slot_id, path) in &args.accessories {
        // Try to load atlas.json from the same directory for offset data
        let dir = path.parent().unwrap_or(std::path::Path::new("."));
        let atlas_path = dir.join("atlas.json");
        let (offset_x, offset_y) = if let Ok(atlas_content) = fs::read_to_string(&atlas_path) {
            // Parse offsetX/offsetY from first frame
            let v: serde_json::Value = serde_json::from_str(&atlas_content).unwrap_or_default();
            let frame = &v["frames"][0];
            (
                frame["offsetX"].as_f64().unwrap_or(0.0),
                frame["offsetY"].as_f64().unwrap_or(0.0),
            )
        } else {
            (0.0, 0.0)
        };

        eprintln!("SVG accessories not supported in standalone renderer. Use .dofasset accessories instead.");
        continue;
        #[allow(unreachable_code)]
        let acc_scene: Scene = Scene::new();
        println!("Loaded accessory slot {} from {} (offset: {}, {})", slot_id, path.display(), offset_x, offset_y);
        // Parse accessory frame dimensions from atlas.json
        let (acc_w, acc_h) = if let Ok(atlas_content) = fs::read_to_string(&atlas_path) {
            let v: serde_json::Value = serde_json::from_str(&atlas_content).unwrap_or_default();
            let frame = &v["frames"][0];
            (
                frame["width"].as_f64().unwrap_or(0.0),
                frame["height"].as_f64().unwrap_or(0.0),
            )
        } else {
            (0.0, 0.0)
        };
        acc_scenes.push(scene_builder::AccessoryScene {
            slot_id: *slot_id,
            scene: acc_scene,
            offset_x,
            offset_y,
            width: acc_w,
            height: acc_h,
        });
    }

    // GPU setup
    println!("Initializing GPU...");
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        })
        .await
        .expect("No GPU adapter found");
    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("dofasset-renderer"),
                required_features: adapter.features()
                    & (wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::CLEAR_TEXTURE),
                required_limits: adapter.limits(),
                ..Default::default()
            },
        )
        .await
        .expect("Failed to create device");

    let mut renderer = Renderer::new(
        &device,
        RendererOptions {
            use_cpu: false,
            antialiasing_support: vello::AaSupport::area_only(),
            num_init_threads: None,
            pipeline_cache: None,
        },
    )
    .expect("Failed to create Vello renderer");

    let acc_refs: Vec<&scene_builder::AccessoryScene> = acc_scenes.iter().collect();
    if args.animation == "*" {
        render_each_animation(&mut renderer, &device, &queue, &asset, &args, &acc_refs).await;
    } else if args.all_frames {
        render_all_frames(&mut renderer, &device, &queue, &asset, &args, anim.unwrap(), &acc_refs).await;
    } else {
        render_single_frame(&mut renderer, &device, &queue, &asset, &args, args.frame, &acc_refs).await;
    }
}

async fn render_single_frame(
    renderer: &mut Renderer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    asset: &format::DofAsset,
    args: &Args,
    frame_idx: usize,
    accessories: &[&scene_builder::AccessoryScene],
) {
    // Use uniform canvas so the frame is properly sized for the full animation.
    let meta = scene_builder::compute_animation_render_meta(
        asset, &args.animation, args.resolution, accessories,
    );

    let scene_start = Instant::now();
    let scene = scene_builder::build_frame_scene(
        asset,
        &args.animation,
        frame_idx,
        args.colors.as_ref(),
        args.resolution,
        accessories,
        (meta.bounds_offset_x, meta.bounds_offset_y),
    );
    let scene_ms = scene_start.elapsed().as_secs_f64() * 1000.0;
    println!("Scene built in {scene_ms:.2}ms");
    println!("Anchor: ({:.1}, {:.1})", meta.anchor_x, meta.anchor_y);

    render_scene_to_png(renderer, device, queue, &scene, meta.canvas_width, meta.canvas_height, &args.output).await;
    println!("Saved {}x{} to {}", meta.canvas_width, meta.canvas_height, args.output.display());
}

async fn render_all_frames(
    renderer: &mut Renderer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    asset: &format::DofAsset,
    args: &Args,
    anim: &format::Animation,
    accessories: &[&scene_builder::AccessoryScene],
) {
    let frame_count = anim.frame_ids.len();

    // Use uniform canvas — all frames render at the same size so animations
    // are perfectly stable (no jitter from per-frame size variation).
    let meta = scene_builder::compute_animation_render_meta(
        asset, &args.animation, args.resolution, accessories,
    );
    let tile_w = meta.canvas_width.max(4);
    let tile_h = meta.canvas_height.max(4);

    let cols = (frame_count as f64).sqrt().ceil() as u32;
    let rows = ((frame_count as u32) + cols - 1) / cols;
    let grid_w = cols * tile_w;
    let grid_h = rows * tile_h;

    println!(
        "Rendering {} frames in {}x{} grid ({}x{} tiles, anchor ({:.1},{:.1}))...",
        frame_count, cols, rows, tile_w, tile_h, meta.anchor_x, meta.anchor_y
    );

    let mut grid_pixels = vec![0u8; (grid_w * grid_h * 4) as usize];

    let render_start = Instant::now();
    for idx in 0..frame_count {
        let scene = scene_builder::build_frame_scene(
            asset,
            &args.animation,
            idx,
            args.colors.as_ref(),
            args.resolution,
            accessories,
            (meta.bounds_offset_x, meta.bounds_offset_y),
        );

        let pixels = render_scene_to_pixels(renderer, device, queue, &scene, tile_w, tile_h).await;

        let col = (idx as u32) % cols;
        let row = (idx as u32) / cols;
        let dst_x = col * tile_w;
        let dst_y = row * tile_h;

        for y in 0..tile_h {
            for x in 0..tile_w {
                let src_idx = ((y * tile_w + x) * 4) as usize;
                let dst_idx = (((dst_y + y) * grid_w + dst_x + x) * 4) as usize;
                if src_idx + 4 <= pixels.len() && dst_idx + 4 <= grid_pixels.len() {
                    grid_pixels[dst_idx..dst_idx + 4].copy_from_slice(&pixels[src_idx..src_idx + 4]);
                }
            }
        }
    }
    let render_ms = render_start.elapsed().as_secs_f64() * 1000.0;
    println!("All frames rendered in {render_ms:.2}ms");

    image::save_buffer(&args.output, &grid_pixels, grid_w, grid_h, image::ColorType::Rgba8)
        .expect("Failed to save grid PNG");
    println!(
        "Saved {}x{} grid ({} frames) to {}",
        grid_w,
        grid_h,
        frame_count,
        args.output.display()
    );
}

async fn render_each_animation(
    renderer: &mut Renderer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    asset: &format::DofAsset,
    args: &Args,
    accessories: &[&scene_builder::AccessoryScene],
) {
    let out_dir = args.output.parent().unwrap_or(std::path::Path::new("."));
    let total: usize = asset.animations.iter().map(|a| a.frame_ids.len()).sum();
    println!("Rendering {} animations ({} total frames) at {}x...", asset.animations.len(), total, args.resolution);

    let render_start = Instant::now();
    for anim in &asset.animations {
        let frame_count = anim.frame_ids.len();

        // Uniform canvas per animation — eliminates jitter from per-frame size variation.
        let meta = scene_builder::compute_animation_render_meta(
            asset, &anim.name, args.resolution, accessories,
        );
        let tile_w = meta.canvas_width.max(4);
        let tile_h = meta.canvas_height.max(4);

        let cols = (frame_count as f64).sqrt().ceil() as u32;
        let rows = ((frame_count as u32) + cols - 1) / cols;
        let grid_w = cols * tile_w;
        let grid_h = rows * tile_h;

        let mut grid_pixels = vec![0u8; (grid_w * grid_h * 4) as usize];

        for idx in 0..frame_count {
            let scene = scene_builder::build_frame_scene(
                asset, &anim.name, idx, args.colors.as_ref(), args.resolution, accessories,
                (meta.bounds_offset_x, meta.bounds_offset_y),
            );
            let pixels = render_scene_to_pixels(renderer, device, queue, &scene, tile_w, tile_h).await;

            let col = (idx as u32) % cols;
            let row = (idx as u32) / cols;
            let dst_x = col * tile_w;
            let dst_y = row * tile_h;
            for y in 0..tile_h {
                for x in 0..tile_w {
                    let src_idx = ((y * tile_w + x) * 4) as usize;
                    let dst_idx = (((dst_y + y) * grid_w + dst_x + x) * 4) as usize;
                    if src_idx + 4 <= pixels.len() && dst_idx + 4 <= grid_pixels.len() {
                        grid_pixels[dst_idx..dst_idx + 4].copy_from_slice(&pixels[src_idx..src_idx + 4]);
                    }
                }
            }
        }

        let out_path = out_dir.join(format!("{}.png", anim.name));
        image::save_buffer(&out_path, &grid_pixels, grid_w, grid_h, image::ColorType::Rgba8)
            .expect("Failed to save PNG");
        println!("  {} ({} frames, {}x{}, anchor ({:.1},{:.1})) -> {}",
            anim.name, frame_count, grid_w, grid_h,
            meta.anchor_x, meta.anchor_y, out_path.display());
    }

    let render_ms = render_start.elapsed().as_secs_f64() * 1000.0;
    println!("Done in {render_ms:.0}ms");
}

async fn render_scene_to_png(
    renderer: &mut Renderer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    scene: &Scene,
    w: u32,
    h: u32,
    output: &PathBuf,
) {
    let pixels = render_scene_to_pixels(renderer, device, queue, scene, w, h).await;
    image::save_buffer(output, &pixels, w, h, image::ColorType::Rgba8)
        .expect("Failed to save PNG");
}

async fn render_scene_to_pixels(
    renderer: &mut Renderer,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    scene: &Scene,
    w: u32,
    h: u32,
) -> Vec<u8> {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("render_target"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    let params = vello::RenderParams {
        base_color: Color::TRANSPARENT,
        width: w,
        height: h,
        antialiasing_method: AaConfig::Area,
    };

    renderer
        .render_to_texture(device, queue, scene, &view, &params)
        .expect("Render failed");
    // No poll here — readback_texture will sync when mapping the buffer.

    readback_texture(device, queue, &tex, w, h)
}

fn readback_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    tex: &wgpu::Texture,
    w: u32,
    h: u32,
) -> Vec<u8> {
    let bpr = (w * 4 + 255) & !255;
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (bpr * h) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut enc = device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buf,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(bpr),
                rows_per_image: None,
            },
        },
        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
    );
    queue.submit(Some(enc.finish()));

    let slice = buf.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        tx.send(r).unwrap();
    });
    device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None }).ok();
    rx.recv().unwrap().unwrap();

    let data = slice.get_mapped_range();
    let mut pixels = vec![0u8; (w * h * 4) as usize];
    for row in 0..h {
        let src_start = (row * bpr) as usize;
        let dst_start = (row * w * 4) as usize;
        let row_bytes = (w * 4) as usize;
        pixels[dst_start..dst_start + row_bytes]
            .copy_from_slice(&data[src_start..src_start + row_bytes]);
    }
    drop(data);
    buf.unmap();

    // Un-premultiply alpha
    for chunk in pixels.chunks_exact_mut(4) {
        let a = chunk[3] as f32 / 255.0;
        if a > 0.0 {
            chunk[0] = (chunk[0] as f32 / a).min(255.0) as u8;
            chunk[1] = (chunk[1] as f32 / a).min(255.0) as u8;
            chunk[2] = (chunk[2] as f32 / a).min(255.0) as u8;
        }
    }

    pixels
}
