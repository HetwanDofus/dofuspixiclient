use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use vello::kurbo::{Affine, BezPath, Point, Rect, Stroke};
use vello::peniko::color::DynamicColor;
use vello::peniko::{BlendMode, Blob, Brush, Color, Fill, Image};
use vello::{wgpu, AaConfig, Renderer, RendererOptions, Scene};

use vello_svg::usvg;

mod filters;
use filters::FilterPipelines;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

struct Args {
    input: PathBuf,
    zoom: f32,
    output: PathBuf,
}

fn parse_args() -> Args {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: svg-renderer <input.svg> --zoom <float> --output <output.png>");
        std::process::exit(1);
    }

    let mut result = Args {
        input: PathBuf::from(&args[1]),
        zoom: 1.0,
        output: PathBuf::from("output.png"),
    };

    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--zoom" => {
                result.zoom = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(1.0);
                i += 2;
            }
            "--output" => {
                result.output = PathBuf::from(args.get(i + 1).cloned().unwrap_or_default());
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

// ---------------------------------------------------------------------------
// GPU context passed through rendering for filter support
// ---------------------------------------------------------------------------

struct RenderContext<'a> {
    device: &'a wgpu::Device,
    queue: &'a wgpu::Queue,
    renderer: &'a mut Renderer,
    filter_pipelines: &'a FilterPipelines,
    /// Scale factor from SVG coordinates to final pixel coordinates.
    /// Filters render intermediate textures at this scale for correct pixel-level blur.
    output_scale: f64,
}

// ---------------------------------------------------------------------------
// Custom SVG renderer with pattern, clip path, opacity, filter support
// ---------------------------------------------------------------------------

fn clip_path_to_bez(clip: &usvg::ClipPath) -> Option<BezPath> {
    let first = clip.root().children().first()?;
    if let usvg::Node::Path(p) = first {
        Some(to_bez_path(p))
    } else {
        None
    }
}

fn usvg_blend_to_vello(mode: usvg::BlendMode) -> vello::peniko::Mix {
    match mode {
        usvg::BlendMode::Normal => vello::peniko::Mix::Normal,
        usvg::BlendMode::Multiply => vello::peniko::Mix::Multiply,
        usvg::BlendMode::Screen => vello::peniko::Mix::Screen,
        usvg::BlendMode::Overlay => vello::peniko::Mix::Overlay,
        usvg::BlendMode::Darken => vello::peniko::Mix::Darken,
        usvg::BlendMode::Lighten => vello::peniko::Mix::Lighten,
        usvg::BlendMode::ColorDodge => vello::peniko::Mix::ColorDodge,
        usvg::BlendMode::ColorBurn => vello::peniko::Mix::ColorBurn,
        usvg::BlendMode::HardLight => vello::peniko::Mix::HardLight,
        usvg::BlendMode::SoftLight => vello::peniko::Mix::SoftLight,
        usvg::BlendMode::Difference => vello::peniko::Mix::Difference,
        usvg::BlendMode::Exclusion => vello::peniko::Mix::Exclusion,
        usvg::BlendMode::Hue => vello::peniko::Mix::Hue,
        usvg::BlendMode::Saturation => vello::peniko::Mix::Saturation,
        usvg::BlendMode::Color => vello::peniko::Mix::Color,
        usvg::BlendMode::Luminosity => vello::peniko::Mix::Luminosity,
    }
}

fn render_node(scene: &mut Scene, node: &usvg::Node, images: &ImageCache, ctx: &mut RenderContext) {
    let transform = to_affine(&node.abs_transform());
    match node {
        usvg::Node::Group(g) => {
            // Check for filters — render to intermediate texture and apply
            if !g.filters().is_empty() {
                render_filtered_group(scene, g, images, ctx);
                return;
            }

            let alpha = g.opacity().get();
            let mix = usvg_blend_to_vello(g.blend_mode());

            let clipped = if let Some(clip) = g.clip_path() {
                if let Some(clip_bez) = clip_path_to_bez(clip) {
                    let clip_transform = clip.root().children().first()
                        .map(|n| to_affine(&n.abs_transform()))
                        .unwrap_or(transform);
                    scene.push_layer(
                        BlendMode { mix: vello::peniko::Mix::Clip, compose: vello::peniko::Compose::SrcOver },
                        alpha,
                        clip_transform,
                        &clip_bez,
                    );
                    true
                } else {
                    false
                }
            } else if alpha < 1.0 || !matches!(g.blend_mode(), usvg::BlendMode::Normal) {
                let bb = g.layer_bounding_box();
                let rect = Rect::new(bb.left() as f64, bb.top() as f64, bb.right() as f64, bb.bottom() as f64);
                scene.push_layer(
                    BlendMode { mix, compose: vello::peniko::Compose::SrcOver },
                    alpha,
                    transform,
                    &rect,
                );
                true
            } else {
                false
            };

            for child in g.children() {
                render_node(scene, child, images, ctx);
            }

            if clipped {
                scene.pop_layer();
            }
        }
        usvg::Node::Path(path) => {
            if !path.is_visible() { return; }
            let local_path = to_bez_path(path);

            if let Some(fill) = path.fill() {
                if let Some((brush, brush_transform)) = to_brush_with_patterns(fill.paint(), fill.opacity(), images) {
                    scene.fill(
                        match fill.rule() {
                            usvg::FillRule::NonZero => Fill::NonZero,
                            usvg::FillRule::EvenOdd => Fill::EvenOdd,
                        },
                        transform,
                        &brush,
                        Some(brush_transform),
                        &local_path,
                    );
                }
            }
            if let Some(stroke) = path.stroke() {
                if let Some((brush, brush_transform)) = to_brush_with_patterns(stroke.paint(), stroke.opacity(), images) {
                    let conv_stroke = to_stroke(stroke);
                    scene.stroke(&conv_stroke, transform, &brush, Some(brush_transform), &local_path);
                }
            }
        }
        usvg::Node::Image(img) => {
            if !img.is_visible() { return; }
            match img.kind() {
                usvg::ImageKind::JPEG(_) | usvg::ImageKind::PNG(_)
                | usvg::ImageKind::GIF(_) | usvg::ImageKind::WEBP(_) => {
                    if let Ok(decoded) = decode_raster(img.kind()) {
                        let image = to_image(decoded);
                        scene.draw_image(&image, to_affine(&img.abs_transform()));
                    }
                }
                usvg::ImageKind::SVG(svg) => {
                    for child in svg.root().children() {
                        render_node(scene, child, images, ctx);
                    }
                }
            }
        }
        usvg::Node::Text(text) => {
            for child in text.flattened().children() {
                render_node(scene, child, images, ctx);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Filter rendering: render group to texture, apply filter, composite back
// ---------------------------------------------------------------------------

fn render_filtered_group(
    scene: &mut Scene,
    group: &usvg::Group,
    images: &ImageCache,
    ctx: &mut RenderContext,
) {
    // Use the group's ABSOLUTE bounding box (in root SVG coordinates)
    // since children render with abs_transform. Expand for filter blur radius.
    let bb = group.abs_stroke_bounding_box();
    let pad = 10.0_f32; // padding for filter expansion
    let bb_x = (bb.left() - pad) as f64;
    let bb_y = (bb.top() - pad) as f64;
    let bb_width = (bb.width() + pad * 2.0) as f64;
    let bb_height = (bb.height() + pad * 2.0) as f64;
    let scale = ctx.output_scale;
    let bb_w = (bb_width * scale).ceil() as u32;
    let bb_h = (bb_height * scale).ceil() as u32;
    if bb_w == 0 || bb_h == 0 { return; }

    // Build sub-scene: translate bbox origin to (0,0) and scale to pixel resolution
    let mut sub = Scene::new();
    let offset = Affine::scale(scale) * Affine::translate((-bb_x, -bb_y));
    for child in group.children() {
        let mut child_scene = Scene::new();
        render_node(&mut child_scene, child, images, ctx);
        sub.append(&child_scene, Some(offset));
    }

    // Render sub-scene to intermediate texture at pixel resolution
    let tex = ctx.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("filter_input"),
        size: wgpu::Extent3d { width: bb_w, height: bb_h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    let params = vello::RenderParams {
        base_color: Color::TRANSPARENT,
        width: bb_w,
        height: bb_h,
        antialiasing_method: AaConfig::Area,
    };

    if ctx.renderer.render_to_texture(ctx.device, ctx.queue, &sub, &view, &params).is_err() {
        return; // Skip filter if render fails
    }
    // No poll here — GPU commands are queued, we only need to sync before readback.

    // Apply filter primitives (all submitted to GPU queue without blocking)
    let mut current_tex = tex;
    for filter in group.filters() {
        for primitive in filter.primitives() {
            match primitive.kind() {
                usvg::filter::Kind::GaussianBlur(blur) => {
                    current_tex = ctx.filter_pipelines.apply_gaussian_blur(
                        ctx.device, ctx.queue, &current_tex,
                        bb_w, bb_h,
                        blur.std_dev_x().get(), blur.std_dev_y().get(),
                    );
                }
                usvg::filter::Kind::ConvolveMatrix(conv) => {
                    current_tex = ctx.filter_pipelines.apply_convolve_matrix(
                        ctx.device, ctx.queue, &current_tex,
                        bb_w, bb_h,
                        conv.matrix().data(),
                        conv.matrix().columns(),
                        conv.matrix().rows(),
                        conv.matrix().target_x(),
                        conv.matrix().target_y(),
                        conv.divisor().get(),
                        conv.bias(),
                        conv.preserve_alpha(),
                    );
                }
                usvg::filter::Kind::ColorMatrix(cm) => {
                    if let usvg::filter::ColorMatrixKind::Matrix(m) = cm.kind() {
                        if m.len() == 20 {
                            let mut matrix = [0.0f32; 20];
                            matrix.copy_from_slice(m);
                            current_tex = ctx.filter_pipelines.apply_color_matrix(
                                ctx.device, ctx.queue, &current_tex,
                                bb_w, bb_h, &matrix,
                            );
                        }
                    }
                }
                _ => {} // Skip unsupported filter primitives
            }
        }
    }

    // Readback filtered pixels and composite as image
    let pixels = readback_texture(ctx.device, ctx.queue, &current_tex, bb_w, bb_h);

    let image = Image::new(
        Blob::new(Arc::new(pixels)),
        vello::peniko::ImageFormat::Rgba8,
        bb_w, bb_h,
    );

    // Composite with the group's blend mode and opacity
    let alpha = group.opacity().get();
    let mix = usvg_blend_to_vello(group.blend_mode());
    let needs_layer = alpha < 1.0 || !matches!(group.blend_mode(), usvg::BlendMode::Normal);

    let draw_transform = Affine::translate((bb_x, bb_y)) * Affine::scale(1.0 / scale);

    if needs_layer {
        let bb_rect = Rect::new(bb_x, bb_y, bb_x + bb_width, bb_y + bb_height);
        scene.push_layer(
            BlendMode { mix, compose: vello::peniko::Compose::SrcOver },
            alpha,
            Affine::IDENTITY,
            &bb_rect,
        );
        scene.draw_image(&image, draw_transform);
        scene.pop_layer();
    } else {
        scene.draw_image(&image, draw_transform);
    }
}

fn readback_texture(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture, w: u32, h: u32) -> Vec<u8> {
    let bpr = (w * 4 + 255) & !255;
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("filter_readback"),
        size: (bpr * h) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut enc = device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buf,
            layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bpr), rows_per_image: None },
        },
        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
    );
    queue.submit(Some(enc.finish()));

    let slice = buf.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| { tx.send(r).unwrap(); });
    device.poll(wgpu::Maintain::Wait);
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
    pixels
}

// ---------------------------------------------------------------------------
// Pattern → Image cache
// ---------------------------------------------------------------------------

struct ImageCache {
    patterns: HashMap<String, Image>,
}

impl ImageCache {
    fn build(tree: &usvg::Tree) -> Self {
        let mut patterns = HashMap::new();
        Self::scan_group(tree.root(), &mut patterns);
        ImageCache { patterns }
    }

    fn scan_group(group: &usvg::Group, patterns: &mut HashMap<String, Image>) {
        for node in group.children() {
            match node {
                usvg::Node::Group(g) => Self::scan_group(g, patterns),
                usvg::Node::Path(path) => {
                    if let Some(fill) = path.fill() {
                        Self::try_cache_pattern(fill.paint(), patterns);
                    }
                    if let Some(stroke) = path.stroke() {
                        Self::try_cache_pattern(stroke.paint(), patterns);
                    }
                }
                _ => {}
            }
        }
    }

    fn try_cache_pattern(paint: &usvg::Paint, patterns: &mut HashMap<String, Image>) {
        if let usvg::Paint::Pattern(pat) = paint {
            let id = pat.id().to_string();
            if patterns.contains_key(&id) { return; }
            if let Some(image) = Self::extract_image_from_group(pat.root()) {
                patterns.insert(id, image);
            }
        }
    }

    fn extract_image_from_group(group: &usvg::Group) -> Option<Image> {
        for node in group.children() {
            match node {
                usvg::Node::Image(img) => {
                    match img.kind() {
                        usvg::ImageKind::PNG(_) | usvg::ImageKind::JPEG(_)
                        | usvg::ImageKind::GIF(_) | usvg::ImageKind::WEBP(_) => {
                            if let Ok(decoded) = decode_raster(img.kind()) {
                                return Some(to_image(decoded));
                            }
                        }
                        _ => {}
                    }
                }
                usvg::Node::Group(g) => {
                    if let Some(img) = Self::extract_image_from_group(g) {
                        return Some(img);
                    }
                }
                _ => {}
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// Brush conversion with pattern support
// ---------------------------------------------------------------------------

fn to_brush_with_patterns(
    paint: &usvg::Paint,
    opacity: usvg::Opacity,
    images: &ImageCache,
) -> Option<(Brush, Affine)> {
    match paint {
        usvg::Paint::Color(color) => Some((
            Brush::Solid(Color::from_rgba8(color.red, color.green, color.blue, opacity.to_u8())),
            Affine::IDENTITY,
        )),
        usvg::Paint::LinearGradient(gr) => {
            let stops: Vec<vello::peniko::ColorStop> = gr.stops().iter().map(|stop| {
                vello::peniko::ColorStop {
                    offset: stop.offset().get(),
                    color: DynamicColor::from_alpha_color(Color::from_rgba8(
                        stop.color().red, stop.color().green, stop.color().blue,
                        (stop.opacity() * opacity).to_u8(),
                    )),
                }
            }).collect();
            let gradient = vello::peniko::Gradient::new_linear(
                Point::new(gr.x1() as f64, gr.y1() as f64),
                Point::new(gr.x2() as f64, gr.y2() as f64),
            ).with_stops(stops.as_slice());
            let transform = to_affine(&gr.transform());
            Some((Brush::Gradient(gradient), transform))
        }
        usvg::Paint::RadialGradient(gr) => {
            let stops: Vec<vello::peniko::ColorStop> = gr.stops().iter().map(|stop| {
                vello::peniko::ColorStop {
                    offset: stop.offset().get(),
                    color: DynamicColor::from_alpha_color(Color::from_rgba8(
                        stop.color().red, stop.color().green, stop.color().blue,
                        (stop.opacity() * opacity).to_u8(),
                    )),
                }
            }).collect();
            let gradient = vello::peniko::Gradient::new_two_point_radial(
                Point::new(gr.cx() as f64, gr.cy() as f64), 0_f32,
                Point::new(gr.fx() as f64, gr.fy() as f64), gr.r().get(),
            ).with_stops(stops.as_slice());
            let transform = to_affine(&gr.transform());
            Some((Brush::Gradient(gradient), transform))
        }
        usvg::Paint::Pattern(pat) => {
            if let Some(image) = images.patterns.get(pat.id()) {
                let mut img = image.clone();
                img.x_extend = vello::peniko::Extend::Repeat;
                img.y_extend = vello::peniko::Extend::Repeat;
                let brush = Brush::Image(img);
                let transform = to_affine(&pat.transform());
                Some((brush, transform))
            } else {
                None
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Utility converters
// ---------------------------------------------------------------------------

fn to_affine(ts: &usvg::Transform) -> Affine {
    Affine::new([ts.sx, ts.ky, ts.kx, ts.sy, ts.tx, ts.ty].map(f64::from))
}

fn to_stroke(stroke: &usvg::Stroke) -> Stroke {
    let mut s = Stroke::new(stroke.width().get() as f64)
        .with_caps(match stroke.linecap() {
            usvg::LineCap::Butt => vello::kurbo::Cap::Butt,
            usvg::LineCap::Round => vello::kurbo::Cap::Round,
            usvg::LineCap::Square => vello::kurbo::Cap::Square,
        })
        .with_join(match stroke.linejoin() {
            usvg::LineJoin::Miter | usvg::LineJoin::MiterClip => vello::kurbo::Join::Miter,
            usvg::LineJoin::Round => vello::kurbo::Join::Round,
            usvg::LineJoin::Bevel => vello::kurbo::Join::Bevel,
        })
        .with_miter_limit(stroke.miterlimit().get() as f64);
    if let Some(da) = stroke.dasharray() {
        s = s.with_dashes(stroke.dashoffset() as f64, da.iter().map(|x| *x as f64));
    }
    s
}

fn to_bez_path(path: &usvg::Path) -> BezPath {
    let mut bp = BezPath::new();
    let mut just_closed = false;
    let mut init = (0.0, 0.0);
    for seg in path.data().segments() {
        match seg {
            usvg::tiny_skia_path::PathSegment::MoveTo(p) => {
                if std::mem::take(&mut just_closed) { bp.move_to(init); }
                init = (p.x.into(), p.y.into());
                bp.move_to(init);
            }
            usvg::tiny_skia_path::PathSegment::LineTo(p) => {
                if std::mem::take(&mut just_closed) { bp.move_to(init); }
                bp.line_to(Point::new(p.x as f64, p.y as f64));
            }
            usvg::tiny_skia_path::PathSegment::QuadTo(p1, p2) => {
                if std::mem::take(&mut just_closed) { bp.move_to(init); }
                bp.quad_to(Point::new(p1.x as f64, p1.y as f64), Point::new(p2.x as f64, p2.y as f64));
            }
            usvg::tiny_skia_path::PathSegment::CubicTo(p1, p2, p3) => {
                if std::mem::take(&mut just_closed) { bp.move_to(init); }
                bp.curve_to(
                    Point::new(p1.x as f64, p1.y as f64),
                    Point::new(p2.x as f64, p2.y as f64),
                    Point::new(p3.x as f64, p3.y as f64),
                );
            }
            usvg::tiny_skia_path::PathSegment::Close => {
                just_closed = true;
                bp.close_path();
            }
        }
    }
    bp
}

fn decode_raster(kind: &usvg::ImageKind) -> Result<image::RgbaImage, image::ImageError> {
    let (data, fmt) = match kind {
        usvg::ImageKind::JPEG(d) => (d, image::ImageFormat::Jpeg),
        usvg::ImageKind::PNG(d) => (d, image::ImageFormat::Png),
        usvg::ImageKind::GIF(d) => (d, image::ImageFormat::Gif),
        usvg::ImageKind::WEBP(d) => (d, image::ImageFormat::WebP),
        usvg::ImageKind::SVG(_) => unreachable!(),
    };
    Ok(image::load_from_memory_with_format(data, fmt)?.into_rgba8())
}

fn to_image(img: image::RgbaImage) -> Image {
    let (w, h) = (img.width(), img.height());
    Image::new(Blob::new(Arc::new(img.into_vec())), vello::peniko::ImageFormat::Rgba8, w, h)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() {
    pollster::block_on(run());
}

async fn run() {
    let args = parse_args();

    if !args.input.exists() {
        eprintln!("Input file not found: {}", args.input.display());
        std::process::exit(1);
    }

    // Read SVG and replace __RESOLUTION__ placeholder
    let svg_content = fs::read_to_string(&args.input).expect("Failed to read SVG file");
    let res_value = format!("{:.10}", 1.0 / args.zoom as f64);
    let processed_svg = svg_content.replace("__RESOLUTION__", &res_value);

    // Parse with usvg, round-trip to flatten <use> elements.
    let options = usvg::Options::default();
    let tree = match usvg::Tree::from_str(&processed_svg, &options) {
        Ok(t) => t,
        Err(e) => {
            // For very complex SVGs (e.g., 80K+ <use> elements), usvg hits its
            // 1M node limit. Output a transparent image instead of crashing.
            eprintln!("Warning: SVG too complex for usvg ({e}), outputting empty image");
            let w = 1u32; let h = 1u32;
            image::save_buffer(&args.output, &[0u8; 4], w, h, image::ColorType::Rgba8)
                .expect("Failed to save empty PNG");
            return;
        }
    };
    // Round-trip for <use> flattening. If re-parse fails (e.g., node limit exceeded
    // due to massive <use> expansion), fall back to the first-parse tree.
    let mut write_opts = usvg::WriteOptions::default();
    write_opts.coordinates_precision = 12;
    write_opts.transforms_precision = 12;
    let rewritten = tree.to_string(&write_opts);
    let tree = usvg::Tree::from_data(rewritten.as_bytes(), &options).unwrap_or(tree);

    // Build pattern image cache
    let images = ImageCache::build(&tree);

    // Get SVG dimensions and compute output size
    let svg_size = tree.size();
    let w = (svg_size.width() as f64 * args.zoom as f64).ceil() as u32;
    let h = (svg_size.height() as f64 * args.zoom as f64).ceil() as u32;

    if w == 0 || h == 0 {
        eprintln!("SVG has zero dimensions: {}x{}", w, h);
        std::process::exit(1);
    }

    // GPU setup — needed BEFORE scene building for filter support
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
                label: Some("svg-renderer"),
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

    let filter_pipelines = FilterPipelines::new(&device);

    // Build vello scene with zoom transform, passing GPU context for filters
    let mut sub = Scene::new();
    {
        let mut ctx = RenderContext {
            device: &device,
            queue: &queue,
            renderer: &mut renderer,
            filter_pipelines: &filter_pipelines,
            output_scale: args.zoom as f64,
        };
        for child in tree.root().children() {
            render_node(&mut sub, child, &images, &mut ctx);
        }
    }
    let mut scene = Scene::new();
    scene.append(&sub, Some(Affine::scale(args.zoom as f64)));

    // Render final scene
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
        .render_to_texture(&device, &queue, &scene, &view, &params)
        .expect("Render failed");
    device.poll(wgpu::Maintain::Wait);

    // Readback final output
    let pixels = readback_texture(&device, &queue, &tex, w, h);

    // Un-premultiply alpha
    let mut pixels = pixels;
    for chunk in pixels.chunks_exact_mut(4) {
        let a = chunk[3] as f32 / 255.0;
        if a > 0.0 {
            chunk[0] = (chunk[0] as f32 / a).min(255.0) as u8;
            chunk[1] = (chunk[1] as f32 / a).min(255.0) as u8;
            chunk[2] = (chunk[2] as f32 / a).min(255.0) as u8;
        }
    }

    // Save PNG
    image::save_buffer(&args.output, &pixels, w, h, image::ColorType::Rgba8)
        .expect("Failed to save PNG");
}
