use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use vello::peniko::Color;
use vello::{wgpu, AaConfig, Renderer, RendererOptions, Scene};

mod color;
mod format;
mod pattern;
mod scene_builder;

fn main() {
    pollster::block_on(run());
}

async fn run() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: bench <input.dofasset> [--count 1000] [--resolution 2]");
        std::process::exit(1);
    }

    let input = PathBuf::from(&args[1]);
    let mut count = 1000usize;
    let mut resolution = 2.0f32;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--count" => { count = args.get(i+1).and_then(|s| s.parse().ok()).unwrap_or(1000); i += 2; }
            "--resolution" => { resolution = args.get(i+1).and_then(|s| s.parse().ok()).unwrap_or(2.0); i += 2; }
            _ => { i += 1; }
        }
    }

    // Load asset
    let file_data = fs::read(&input).expect("Failed to read file");
    let asset = format::load(&file_data);
    println!("Loaded: {} animations, {} frames, {} body parts",
        asset.animations.len(), asset.frames.len(), asset.body_parts.len());

    // GPU setup
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

    println!("GPU: {}", adapter.get_info().name);
    println!("Backend: {:?}", adapter.get_info().backend);

    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: Some("bench"),
                required_features: adapter.features()
                    & (wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::CLEAR_TEXTURE),
                required_limits: adapter.limits(),
                ..Default::default()
            },
            None,
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

    // Generate random test cases
    let anim_count = asset.animations.len();
    let mut rng_state: u64 = 0xDEADBEEF_CAFEBABE;
    let mut rng = || -> u64 {
        rng_state ^= rng_state << 13;
        rng_state ^= rng_state >> 7;
        rng_state ^= rng_state << 17;
        rng_state
    };

    struct TestCase {
        anim_name: String,
        frame_idx: usize,
        colors: [u32; 3],
    }

    let mut cases: Vec<TestCase> = Vec::with_capacity(count);
    for _ in 0..count {
        let anim = &asset.animations[(rng() as usize) % anim_count];
        let frame_idx = (rng() as usize) % anim.frame_ids.len();
        let colors = [
            (rng() as u32) & 0xFFFFFF,
            (rng() as u32) & 0xFFFFFF,
            (rng() as u32) & 0xFFFFFF,
        ];
        cases.push(TestCase {
            anim_name: anim.name.clone(),
            frame_idx,
            colors,
        });
    }

    println!("\n=== Benchmark: {} renders at {}x resolution ===\n", count, resolution);

    // Pre-allocate a reusable texture at max frame size
    let mut max_w = 4u32;
    let mut max_h = 4u32;
    for fr in &asset.frames {
        max_w = max_w.max((fr.clip_rect[2].ceil() * resolution) as u32);
        max_h = max_h.max((fr.clip_rect[3].ceil() * resolution) as u32);
    }
    println!("Max tile: {}x{}", max_w, max_h);

    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bench_target"),
        size: wgpu::Extent3d { width: max_w, height: max_h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());

    // Warmup (5 frames)
    print!("Warmup...");
    for case in cases.iter().take(5) {
        let scene = scene_builder::build_frame_scene(
            &asset, &case.anim_name, case.frame_idx,
            Some(&case.colors), resolution, &[], (0.0, 0.0),
        );
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: max_w,
            height: max_h,
            antialiasing_method: AaConfig::Area,
        };
        renderer.render_to_texture(&device, &queue, &scene, &view, &params).expect("Render failed");
        device.poll(wgpu::Maintain::Wait);
    }
    println!(" done");

    // Track system stats
    let pid = std::process::id();
    let mem_before = get_rss_mb(pid);

    // === Phase 1: Scene building (CPU) ===
    print!("Phase 1: Building {} scenes (CPU)... ", count);
    let scene_start = Instant::now();
    let mut scenes: Vec<Scene> = Vec::with_capacity(count);
    for case in &cases {
        let scene = scene_builder::build_frame_scene(
            &asset, &case.anim_name, case.frame_idx,
            Some(&case.colors), resolution, &[], (0.0, 0.0),
        );
        scenes.push(scene);
    }
    let scene_elapsed = scene_start.elapsed();
    let scene_fps = count as f64 / scene_elapsed.as_secs_f64();
    println!("{:.1}ms ({:.0} scenes/sec)", scene_elapsed.as_secs_f64() * 1000.0, scene_fps);

    // === Phase 2: GPU rendering ===
    print!("Phase 2: Rendering {} frames (GPU)... ", count);
    let mut frame_times: Vec<Duration> = Vec::with_capacity(count);
    let gpu_start = Instant::now();

    for scene in &scenes {
        let t0 = Instant::now();
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: max_w,
            height: max_h,
            antialiasing_method: AaConfig::Area,
        };
        renderer.render_to_texture(&device, &queue, &scene, &view, &params).expect("Render failed");
        device.poll(wgpu::Maintain::Wait);
        frame_times.push(t0.elapsed());
    }

    let gpu_elapsed = gpu_start.elapsed();
    let gpu_fps = count as f64 / gpu_elapsed.as_secs_f64();
    println!("{:.1}ms ({:.0} fps)", gpu_elapsed.as_secs_f64() * 1000.0, gpu_fps);

    // === Phase 3: Combined (build + render per frame) ===
    print!("Phase 3: Combined build+render {} frames... ", count);
    let combined_start = Instant::now();
    let mut combined_times: Vec<Duration> = Vec::with_capacity(count);

    for case in &cases {
        let t0 = Instant::now();
        let scene = scene_builder::build_frame_scene(
            &asset, &case.anim_name, case.frame_idx,
            Some(&case.colors), resolution, &[], (0.0, 0.0),
        );
        let params = vello::RenderParams {
            base_color: Color::TRANSPARENT,
            width: max_w,
            height: max_h,
            antialiasing_method: AaConfig::Area,
        };
        renderer.render_to_texture(&device, &queue, &scene, &view, &params).expect("Render failed");
        device.poll(wgpu::Maintain::Wait);
        combined_times.push(t0.elapsed());
    }

    let combined_elapsed = combined_start.elapsed();
    let combined_fps = count as f64 / combined_elapsed.as_secs_f64();

    let mem_after = get_rss_mb(pid);

    // === Stats ===
    println!("\n============================================================");
    println!("=== RESULTS ({} frames, {}x resolution) ===", count, resolution);
    println!("============================================================\n");

    println!("Scene building (CPU):");
    println!("  Total:    {:.1}ms", scene_elapsed.as_secs_f64() * 1000.0);
    println!("  Per frame: {:.3}ms", scene_elapsed.as_secs_f64() * 1000.0 / count as f64);
    println!("  Throughput: {:.0} scenes/sec", scene_fps);

    println!("\nGPU rendering:");
    println!("  Total:    {:.1}ms", gpu_elapsed.as_secs_f64() * 1000.0);
    println!("  Per frame: {:.3}ms", gpu_elapsed.as_secs_f64() * 1000.0 / count as f64);
    println!("  Throughput: {:.0} fps", gpu_fps);
    print_percentiles("  GPU frame", &mut frame_times);

    println!("\nCombined (build + render):");
    println!("  Total:    {:.1}ms", combined_elapsed.as_secs_f64() * 1000.0);
    println!("  Per frame: {:.3}ms", combined_elapsed.as_secs_f64() * 1000.0 / count as f64);
    println!("  Throughput: {:.0} fps", combined_fps);
    print_percentiles("  Combined", &mut combined_times);

    println!("\nMemory:");
    println!("  RSS before bench: {:.1} MB", mem_before);
    println!("  RSS after bench:  {:.1} MB", mem_after);
    println!("  Asset file size:  {:.1} MB", file_data.len() as f64 / 1024.0 / 1024.0);

    println!("\nGPU info:");
    println!("  Adapter: {}", adapter.get_info().name);
    println!("  Backend: {:?}", adapter.get_info().backend);
    println!("  Max tile: {}x{}", max_w, max_h);
}

fn print_percentiles(label: &str, times: &mut Vec<Duration>) {
    times.sort();
    let len = times.len();
    let p50 = times[len / 2].as_secs_f64() * 1000.0;
    let p95 = times[(len as f64 * 0.95) as usize].as_secs_f64() * 1000.0;
    let p99 = times[(len as f64 * 0.99) as usize].as_secs_f64() * 1000.0;
    let min = times[0].as_secs_f64() * 1000.0;
    let max = times[len - 1].as_secs_f64() * 1000.0;
    println!("{} p50: {:.3}ms  p95: {:.3}ms  p99: {:.3}ms  min: {:.3}ms  max: {:.3}ms",
        label, p50, p95, p99, min, max);
}

fn get_rss_mb(pid: u32) -> f64 {
    // macOS: use ps to get RSS
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output();
    match output {
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout);
            s.trim().parse::<f64>().unwrap_or(0.0) / 1024.0
        }
        Err(_) => 0.0,
    }
}
