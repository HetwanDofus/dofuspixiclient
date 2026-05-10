use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use vello::kurbo::Affine;
use vello::peniko::Color;
use vello::{wgpu, AaConfig, Renderer, RendererOptions, Scene};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};

mod color;
mod format;
mod pattern;
mod scene_builder;

struct Character {
    asset_idx: usize,
    anim_idx: usize,
    frame_offset: usize,
    colors: [u32; 3],
    x: f64,
    y: f64,
}

struct App {
    assets: Vec<format::DofAsset>,
    characters: Vec<Character>,
    resolution: f32,
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    surface: Option<wgpu::Surface<'static>>,
    device: Option<Arc<wgpu::Device>>,
    queue: Option<Arc<wgpu::Queue>>,
    surface_format: wgpu::TextureFormat,
    frame_count: u64,
    last_fps_time: Instant,
    last_fps_count: u64,
    fps: f64,
    start_time: Instant,
    // Stats tracking
    fps_samples: Vec<f64>,
    rss_samples: Vec<f64>,
    frame_times: Vec<f64>,
    pid: u32,
}

impl App {
    fn new(assets: Vec<format::DofAsset>, char_count: usize, resolution: f32) -> Self {
        let mut rng: u64 = 0xDEADBEEF_CAFEBABE;
        let mut next = || -> u64 {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng
        };

        let cols = (char_count as f64).sqrt().ceil() as usize;
        let spacing_x = 70.0;
        let spacing_y = 80.0;

        let mut characters = Vec::with_capacity(char_count);
        for i in 0..char_count {
            let asset_idx = (next() as usize) % assets.len();
            let anim_count = assets[asset_idx].animations.len();
            let col = i % cols;
            let row = i / cols;
            characters.push(Character {
                asset_idx,
                anim_idx: (next() as usize) % anim_count,
                frame_offset: (next() as usize) % 1000,
                colors: [
                    (next() as u32) & 0xFFFFFF,
                    (next() as u32) & 0xFFFFFF,
                    (next() as u32) & 0xFFFFFF,
                ],
                x: col as f64 * spacing_x + 40.0,
                y: row as f64 * spacing_y + 40.0,
            });
        }

        Self {
            assets,
            characters,
            resolution,
            window: None,
            renderer: None,
            surface: None,
            device: None,
            queue: None,
            surface_format: wgpu::TextureFormat::Bgra8UnormSrgb,
            frame_count: 0,
            last_fps_time: Instant::now(),
            last_fps_count: 0,
            fps: 0.0,
            start_time: Instant::now(),
            fps_samples: Vec::new(),
            rss_samples: Vec::new(),
            frame_times: Vec::new(),
            pid: std::process::id(),
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let attrs = Window::default_attributes()
            .with_title(format!(
                "dofasset bench — {} characters, {} sprites",
                self.characters.len(),
                self.assets.len()
            ))
            .with_inner_size(winit::dpi::LogicalSize::new(1920u32, 1080u32));

        let window = Arc::new(event_loop.create_window(attrs).unwrap());

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let surface = instance.create_surface(window.clone()).unwrap();

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            ..Default::default()
        }))
        .unwrap();

        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("windowed"),
                required_features: adapter.features()
                    & (wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::CLEAR_TEXTURE),
                required_limits: adapter.limits(),
                ..Default::default()
            },
            None,
        ))
        .unwrap();

        let device = Arc::new(device);
        let queue = Arc::new(queue);

        let size = window.inner_size();
        let caps = surface.get_capabilities(&adapter);
        let surface_format = caps
            .formats
            .iter()
            .find(|f| **f == wgpu::TextureFormat::Rgba8Unorm)
            .copied()
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_DST,
            format: surface_format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoNoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);
        self.surface_format = surface_format;

        let renderer = Renderer::new(
            &device,
            RendererOptions {
                use_cpu: false,
                antialiasing_support: vello::AaSupport::area_only(),
                num_init_threads: None,
                pipeline_cache: None,
            },
        )
        .unwrap();

        self.window = Some(window);
        self.surface = Some(surface);
        self.device = Some(device);
        self.queue = Some(queue);
        self.renderer = Some(renderer);
        self.start_time = Instant::now();
        self.last_fps_time = Instant::now();
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                self.print_stats();
                event_loop.exit();
            }
            WindowEvent::RedrawRequested => {
                let window = self.window.as_ref().unwrap();
                let surface = self.surface.as_ref().unwrap();
                let device = self.device.as_ref().unwrap();
                let queue = self.queue.as_ref().unwrap();
                let renderer = self.renderer.as_mut().unwrap();

                let size = window.inner_size();
                if size.width == 0 || size.height == 0 {
                    return;
                }

                let frame_time = self.start_time.elapsed().as_secs_f64();

                // Build combined scene with all characters
                let mut scene = Scene::new();
                let scale = self.resolution as f64;

                for ch in &self.characters {
                    let asset = &self.assets[ch.asset_idx];
                    let anim = &asset.animations[ch.anim_idx];
                    if anim.frame_ids.is_empty() {
                        continue;
                    }

                    let fps = anim.fps.max(1) as f64;
                    let frame_idx =
                        ((frame_time * fps) as usize + ch.frame_offset) % anim.frame_ids.len();

                    let char_scene = scene_builder::build_frame_scene(
                        asset,
                        &anim.name,
                        frame_idx,
                        Some(&ch.colors),
                        self.resolution,
                        &[],
                        (0.0, 0.0),
                    );

                    // Position using the animation's anchor offset so the
                    // character's world position aligns correctly.
                    let anchor_x = -anim.offset_x as f64 * scale;
                    let anchor_y = -anim.offset_y as f64 * scale;
                    let translate = Affine::translate((
                        ch.x * scale - anchor_x,
                        ch.y * scale - anchor_y,
                    ));
                    scene.append(&char_scene, Some(translate));
                }

                // Render to offscreen texture
                let render_tex = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("vello_target"),
                    size: wgpu::Extent3d {
                        width: size.width,
                        height: size.height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::STORAGE_BINDING
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                });
                let render_view =
                    render_tex.create_view(&wgpu::TextureViewDescriptor::default());

                let params = vello::RenderParams {
                    base_color: Color::from_rgba8(30, 30, 30, 255),
                    width: size.width,
                    height: size.height,
                    antialiasing_method: AaConfig::Area,
                };

                renderer
                    .render_to_texture(device, queue, &scene, &render_view, &params)
                    .expect("render failed");

                // Blit to surface
                let surface_tex = surface.get_current_texture().unwrap();
                let surface_view = surface_tex.texture.create_view(&Default::default());

                let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                    mag_filter: wgpu::FilterMode::Nearest,
                    min_filter: wgpu::FilterMode::Nearest,
                    ..Default::default()
                });

                let blit_bgl =
                    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                        label: Some("blit_bgl"),
                        entries: &[
                            wgpu::BindGroupLayoutEntry {
                                binding: 0,
                                visibility: wgpu::ShaderStages::FRAGMENT,
                                ty: wgpu::BindingType::Texture {
                                    sample_type: wgpu::TextureSampleType::Float {
                                        filterable: true,
                                    },
                                    view_dimension: wgpu::TextureViewDimension::D2,
                                    multisampled: false,
                                },
                                count: None,
                            },
                            wgpu::BindGroupLayoutEntry {
                                binding: 1,
                                visibility: wgpu::ShaderStages::FRAGMENT,
                                ty: wgpu::BindingType::Sampler(
                                    wgpu::SamplerBindingType::Filtering,
                                ),
                                count: None,
                            },
                        ],
                    });

                let blit_bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("blit_bg"),
                    layout: &blit_bgl,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&render_view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&sampler),
                        },
                    ],
                });

                let blit_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("blit"),
                    source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Borrowed(
                        r#"
                        @group(0) @binding(0) var src: texture_2d<f32>;
                        @group(0) @binding(1) var samp: sampler;
                        struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
                        @vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
                            let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
                            return VOut(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
                        }
                        @fragment fn fs(v: VOut) -> @location(0) vec4f {
                            return textureSample(src, samp, v.uv);
                        }
                        "#,
                    )),
                });

                let blit_pl =
                    device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                        label: Some("blit_pl"),
                        bind_group_layouts: &[&blit_bgl],
                        push_constant_ranges: &[],
                    });

                let blit_pipeline =
                    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                        label: Some("blit"),
                        layout: Some(&blit_pl),
                        vertex: wgpu::VertexState {
                            module: &blit_shader,
                            entry_point: Some("vs"),
                            buffers: &[],
                            compilation_options: Default::default(),
                        },
                        fragment: Some(wgpu::FragmentState {
                            module: &blit_shader,
                            entry_point: Some("fs"),
                            targets: &[Some(wgpu::ColorTargetState {
                                format: self.surface_format,
                                blend: None,
                                write_mask: wgpu::ColorWrites::ALL,
                            })],
                            compilation_options: Default::default(),
                        }),
                        primitive: wgpu::PrimitiveState {
                            topology: wgpu::PrimitiveTopology::TriangleList,
                            ..Default::default()
                        },
                        depth_stencil: None,
                        multisample: Default::default(),
                        multiview: None,
                        cache: None,
                    });

                let mut encoder =
                    device.create_command_encoder(&Default::default());
                {
                    let mut pass =
                        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                            label: Some("blit"),
                            color_attachments: &[Some(
                                wgpu::RenderPassColorAttachment {
                                    view: &surface_view,
                                    resolve_target: None,
                                    ops: wgpu::Operations {
                                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                                        store: wgpu::StoreOp::Store,
                                    },
                                },
                            )],
                            ..Default::default()
                        });
                    pass.set_pipeline(&blit_pipeline);
                    pass.set_bind_group(0, &blit_bg, &[]);
                    pass.draw(0..3, 0..1);
                }
                queue.submit(Some(encoder.finish()));
                surface_tex.present();

                // Per-frame time
                let frame_ms = self.start_time.elapsed().as_secs_f64() * 1000.0 - self.frame_times.iter().sum::<f64>();
                // Actually track wall time per frame properly
                let frame_end = Instant::now();

                // FPS tracking
                self.frame_count += 1;
                let now = frame_end;
                let elapsed = now.duration_since(self.last_fps_time).as_secs_f64();
                if elapsed >= 1.0 {
                    self.fps =
                        (self.frame_count - self.last_fps_count) as f64 / elapsed;
                    self.last_fps_count = self.frame_count;
                    self.last_fps_time = now;

                    // Sample stats every second
                    self.fps_samples.push(self.fps);
                    let rss = get_rss_mb(self.pid);
                    self.rss_samples.push(rss);

                    window.set_title(&format!(
                        "dofasset — {} chars × {} sprites — {:.0} FPS — {:.0} MB",
                        self.characters.len(),
                        self.assets.len(),
                        self.fps,
                        rss
                    ));
                }

                window.request_redraw();
            }
            _ => {}
        }
    }
}

impl App {
    fn print_stats(&self) {
        let duration = self.start_time.elapsed().as_secs_f64();
        println!("\n============================================================");
        println!("=== SESSION STATS ===");
        println!("============================================================");
        println!("Duration:   {:.1}s", duration);
        println!("Frames:     {}", self.frame_count);
        println!("Characters: {}", self.characters.len());
        println!("Sprites:    {}", self.assets.len());

        if !self.fps_samples.is_empty() {
            let fps = &self.fps_samples;
            let min = fps.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = fps.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let avg = fps.iter().sum::<f64>() / fps.len() as f64;
            println!("\nFPS:");
            println!("  Min: {:.0}  Avg: {:.0}  Max: {:.0}", min, avg, max);
        }

        if !self.rss_samples.is_empty() {
            let rss = &self.rss_samples;
            let min = rss.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = rss.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let avg = rss.iter().sum::<f64>() / rss.len() as f64;
            println!("\nRAM (RSS):");
            println!("  Min: {:.0} MB  Avg: {:.0} MB  Max: {:.0} MB", min, avg, max);
        }

        println!("============================================================\n");
    }
}

fn get_rss_mb(pid: u32) -> f64 {
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: windowed <dir_with_dofassets> [--count 1000] [--resolution 1]");
        eprintln!("  Or:  windowed <single.dofasset> [--count 200] [--resolution 1]");
        std::process::exit(1);
    }

    let input = PathBuf::from(&args[1]);
    let mut count = 1000usize;
    let mut resolution = 1.0f32;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--count" => {
                count = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1000);
                i += 2;
            }
            "--resolution" => {
                resolution = args
                    .get(i + 1)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1.0);
                i += 2;
            }
            _ => i += 1,
        }
    }

    // Load assets — single file or directory of .dofasset files
    let mut assets = Vec::new();
    if input.is_dir() {
        let mut paths: Vec<_> = fs::read_dir(&input)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|e| e == "dofasset").unwrap_or(false))
            .collect();
        paths.sort();
        for path in &paths {
            let data = fs::read(path).unwrap();
            assets.push(format::load(&data));
        }
        println!("Loaded {} assets from {}", assets.len(), input.display());
    } else {
        let data = fs::read(&input).unwrap();
        assets.push(format::load(&data));
        println!("Loaded 1 asset from {}", input.display());
    }

    let total_anims: usize = assets.iter().map(|a| a.animations.len()).sum();
    let total_frames: usize = assets.iter().map(|a| a.frames.len()).sum();
    println!(
        "Total: {} animations, {} frames — rendering {} characters at {}x",
        total_anims, total_frames, count, resolution
    );

    let app = App::new(assets, count, resolution);
    let event_loop = EventLoop::new().unwrap();
    event_loop.run_app(&mut Box::new(app)).unwrap();
}
