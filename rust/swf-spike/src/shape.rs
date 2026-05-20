//! SWF DefineShape → drawable Vello commands.
//!
//! SWF describes a shape as a flat list of edges with a "current style" that
//! mutates as you walk it. Each edge has *two* sides — `fill_style_0` (right of
//! direction) and `fill_style_1` (left of direction). To paint, we have to
//! group edges by style and stitch them into closed paths.
//!
//! Algorithm ported from Arakne-Swf's `PathsBuilder` / `ShapeProcessor`.

use std::collections::HashMap;
use std::collections::hash_map::Entry;

use vello::kurbo::{Affine, BezPath, Point};
use vello::peniko::{
    color::AlphaColor, Blob, Brush, Color, ColorStop, Extend, Fill, Gradient, ImageAlphaType,
    ImageBrush, ImageData, ImageFormat,
};

use crate::bitmap;
use crate::swf_doc::{EncodedBitmap, SwfDoc, Symbol};

/// One drawable produced by flattening a SWF Shape: either a filled BezPath
/// or a stroked one. Coordinates are in twips (the SWF unit, 1/20 px).
#[derive(Debug, Clone)]
pub struct DrawCmd {
    pub path: BezPath,
    pub kind: DrawKind,
}

#[derive(Debug, Clone)]
pub enum DrawKind {
    Fill {
        brush: Brush,
        brush_transform: Option<Affine>,
        rule: Fill,
    },
    Stroke {
        brush: Brush,
        /// Stroke width in twips (path-local units), as stored by SWF.
        width: f64,
        cap: vello::kurbo::Cap,
        join: vello::kurbo::Join,
        miter_limit: f64,
        /// True for SWF widths < 20 twips (< 1 px). Renderer applies the
        /// dofasset NonScaling formula `max(width, 1/world_scale)` so the
        /// device-pixel result is `max(value_px × resolution, 1)` — exactly
        /// what `scene_builder.rs::resolve_stroke_width(NonScaling)` returns.
        non_scaling: bool,
    },
}

#[derive(Debug, Clone)]
struct OpenPath {
    edges: Vec<Edge>,
    style: ResolvedStyle,
}

#[derive(Debug, Clone)]
enum Edge {
    Line {
        from: (f64, f64),
        to: (f64, f64),
    },
    Quad {
        from: (f64, f64),
        ctrl: (f64, f64),
        to: (f64, f64),
    },
}

impl Edge {
    fn from_pt(&self) -> (f64, f64) {
        match *self {
            Edge::Line { from, .. } | Edge::Quad { from, .. } => from,
        }
    }
    fn to_pt(&self) -> (f64, f64) {
        match *self {
            Edge::Line { to, .. } | Edge::Quad { to, .. } => to,
        }
    }
    fn reversed(&self) -> Edge {
        match *self {
            Edge::Line { from, to } => Edge::Line { from: to, to: from },
            Edge::Quad { from, ctrl, to } => Edge::Quad {
                from: to,
                ctrl,
                to: from,
            },
        }
    }
}

#[derive(Debug, Clone)]
struct ResolvedStyle {
    /// Hash key used to merge edges that share a style.
    key: String,
    kind: StyleKind,
    /// SWF fill_style_0 means "fill on the *right* of edge direction" → reverse.
    reverse: bool,
}

#[derive(Debug, Clone)]
enum StyleKind {
    Fill {
        brush: Brush,
        brush_transform: Option<Affine>,
    },
    Stroke {
        brush: Brush,
        width: f64,
        cap: vello::kurbo::Cap,
        join: vello::kurbo::Join,
        miter_limit: f64,
        non_scaling: bool,
    },
}

/// Public entry: flatten a SWF DefineShape into Vello draw commands. The
/// `doc` is needed only to resolve `FillStyle::Bitmap { id, .. }` references —
/// pass any `SwfDoc` whose `by_id` covers the bitmap IDs used by this shape.
pub fn flatten_shape(shape: &swf::Shape, doc: &SwfDoc) -> Vec<DrawCmd> {
    let mut x: i32 = 0;
    let mut y: i32 = 0;

    let initial_fill = shape.styles.fill_styles.clone();
    let initial_line = shape.styles.line_styles.clone();
    let mut fill_styles: Vec<swf::FillStyle> = initial_fill;
    let mut line_styles: Vec<swf::LineStyle> = initial_line;

    let mut active_fill0: Option<ResolvedStyle> = None;
    let mut active_fill1: Option<ResolvedStyle> = None;
    let mut active_line: Option<ResolvedStyle> = None;

    // SWF demands fills be painted in the order their styles first appear,
    // so a green solid base + grass bitmap layered on top renders correctly.
    // We keep the HashMap for O(1) dedup but back it with a Vec for ordering.
    let mut open: OpenStore = OpenStore::new();
    let mut closed: Vec<OpenPath> = Vec::new();
    let mut finalized: Vec<DrawCmd> = Vec::new();
    let mut pending: Vec<Edge> = Vec::new();

    for record in &shape.shape {
        match record {
            swf::ShapeRecord::StyleChange(sc) => {
                push_pending(
                    &mut open,
                    &mut pending,
                    &active_fill0,
                    &active_fill1,
                    &active_line,
                );

                if sc.new_styles.is_some() {
                    // "Reset" style change — finalize the previous drawing context.
                    closed.extend(open.drain());
                    finalized.extend(emit_paths(&mut closed));
                }

                if let Some(new_styles) = &sc.new_styles {
                    fill_styles = new_styles.fill_styles.clone();
                    line_styles = new_styles.line_styles.clone();
                    closed.extend(open.drain());
                }

                if let Some(idx) = sc.line_style {
                    active_line = if idx == 0 {
                        None
                    } else {
                        line_styles
                            .get((idx - 1) as usize)
                            .map(|ls| resolve_line_style(idx, ls, doc))
                    };
                }
                if let Some(idx) = sc.fill_style_0 {
                    active_fill0 = if idx == 0 {
                        None
                    } else {
                        fill_styles
                            .get((idx - 1) as usize)
                            .map(|fs| resolve_fill_style(idx, fs, /* reverse */ true, doc))
                    };
                }
                if let Some(idx) = sc.fill_style_1 {
                    active_fill1 = if idx == 0 {
                        None
                    } else {
                        fill_styles
                            .get((idx - 1) as usize)
                            .map(|fs| resolve_fill_style(idx, fs, /* reverse */ false, doc))
                    };
                }
                if let Some(mt) = sc.move_to {
                    x = mt.x.get();
                    y = mt.y.get();
                }
            }
            swf::ShapeRecord::StraightEdge { delta } => {
                let to_x = x + delta.dx.get();
                let to_y = y + delta.dy.get();
                pending.push(Edge::Line {
                    from: twip_pt(x, y),
                    to: twip_pt(to_x, to_y),
                });
                x = to_x;
                y = to_y;
            }
            swf::ShapeRecord::CurvedEdge {
                control_delta,
                anchor_delta,
            } => {
                let cx = x + control_delta.dx.get();
                let cy = y + control_delta.dy.get();
                let to_x = cx + anchor_delta.dx.get();
                let to_y = cy + anchor_delta.dy.get();
                pending.push(Edge::Quad {
                    from: twip_pt(x, y),
                    ctrl: twip_pt(cx, cy),
                    to: twip_pt(to_x, to_y),
                });
                x = to_x;
                y = to_y;
            }
        }
    }

    push_pending(
        &mut open,
        &mut pending,
        &active_fill0,
        &active_fill1,
        &active_line,
    );
    closed.extend(open.drain());
    finalized.extend(emit_paths(&mut closed));
    finalized
}

/// Insertion-ordered map of open paths. Mirrors `IndexMap` semantics without
/// the extra dependency: a Vec for iteration order, a HashMap for dedup.
struct OpenStore {
    entries: Vec<Option<OpenPath>>,
    index: HashMap<String, usize>,
}

impl OpenStore {
    fn new() -> Self {
        Self {
            entries: Vec::new(),
            index: HashMap::new(),
        }
    }

    fn entry_or_insert<'a>(&'a mut self, key: &str, make: impl FnOnce() -> OpenPath) -> &'a mut OpenPath {
        let idx = match self.index.entry(key.to_string()) {
            Entry::Occupied(o) => *o.get(),
            Entry::Vacant(v) => {
                let i = self.entries.len();
                self.entries.push(Some(make()));
                v.insert(i);
                return self.entries[i].as_mut().expect("just inserted");
            }
        };
        self.entries[idx].as_mut().expect("entry never removed without drain")
    }

    fn drain(&mut self) -> impl Iterator<Item = OpenPath> + '_ {
        self.index.clear();
        self.entries.drain(..).flatten()
    }
}

fn push_pending(
    open: &mut OpenStore,
    pending: &mut Vec<Edge>,
    fill0: &Option<ResolvedStyle>,
    fill1: &Option<ResolvedStyle>,
    line: &Option<ResolvedStyle>,
) {
    if pending.is_empty() {
        return;
    }
    let edges = std::mem::take(pending);
    for s in [fill0.as_ref(), fill1.as_ref(), line.as_ref()]
        .iter()
        .copied()
        .flatten()
    {
        let to_push: Vec<Edge> = if s.reverse {
            edges.iter().rev().map(|e| e.reversed()).collect()
        } else {
            edges.clone()
        };
        let entry = open.entry_or_insert(&s.key, || OpenPath {
            edges: Vec::new(),
            style: s.clone(),
        });
        entry.edges.extend(to_push);
    }
}

fn emit_paths(closed: &mut Vec<OpenPath>) -> Vec<DrawCmd> {
    // Within a single shape's flatten output, paint solid+gradient fills
    // first, then bitmap fills on top, then strokes. Dofus 1.29 grass/dirt
    // tiles ship a solid base fill that paints across the whole tile and a
    // bitmap fill that overlays the texture detail. Ordering by insertion
    // would frequently put bitmap below the solid (record order varies per
    // exporter), hiding the texture entirely.
    let mut solid_fills = Vec::new();
    let mut image_fills = Vec::new();
    let mut strokes = Vec::new();

    for raw in closed.drain(..) {
        let stitched = stitch(raw.edges);
        match raw.style.kind {
            StyleKind::Fill {
                brush,
                brush_transform,
            } => {
                // Fills: close each subpath so non-self-closing edge chains
                // still fill solidly (matches SWF auto-close).
                let bp = build_bez(&stitched, /* close = */ true);
                let is_image = matches!(brush, Brush::Image(_));
                let cmd = DrawCmd {
                    path: bp,
                    kind: DrawKind::Fill {
                        brush,
                        brush_transform,
                        rule: Fill::NonZero,
                    },
                };
                if is_image {
                    image_fills.push(cmd);
                } else {
                    solid_fills.push(cmd);
                }
            }
            StyleKind::Stroke {
                brush,
                width,
                cap,
                join,
                miter_limit,
                non_scaling,
            } => {
                // Strokes: do NOT close — Vello would visibly draw the
                // closing line, which produces "random lines" cutting
                // across shapes.
                let bp = build_bez(&stitched, /* close = */ false);
                strokes.push(DrawCmd {
                    path: bp,
                    kind: DrawKind::Stroke {
                        brush,
                        width,
                        cap,
                        join,
                        miter_limit,
                        non_scaling,
                    },
                });
            }
        }
    }
    solid_fills.extend(image_fills);
    solid_fills.extend(strokes);
    solid_fills
}

fn stitch(mut edges: Vec<Edge>) -> Vec<Edge> {
    let mut out: Vec<Edge> = Vec::with_capacity(edges.len());
    while !edges.is_empty() {
        let cur = edges.remove(0);
        out.push(cur);
        loop {
            let last = out.last().unwrap();
            let (lx, ly) = last.to_pt();
            let mut found: Option<(usize, bool)> = None;
            for (i, e) in edges.iter().enumerate() {
                if approx_eq(e.from_pt(), (lx, ly)) {
                    found = Some((i, false));
                    break;
                }
                if approx_eq(e.to_pt(), (lx, ly)) {
                    found = Some((i, true));
                    break;
                }
            }
            match found {
                Some((i, true)) => out.push(edges.remove(i).reversed()),
                Some((i, false)) => out.push(edges.remove(i)),
                None => break,
            }
        }
    }
    out
}

fn approx_eq(a: (f64, f64), b: (f64, f64)) -> bool {
    (a.0 - b.0).abs() < 1.0 && (a.1 - b.1).abs() < 1.0
}

fn build_bez(edges: &[Edge], close: bool) -> BezPath {
    let mut bp = BezPath::new();
    let mut last: Option<(f64, f64)> = None;
    let mut subpath_active = false;
    for e in edges {
        let from = e.from_pt();
        let need_move = last.map_or(true, |l| !approx_eq(l, from));
        if need_move {
            if close && subpath_active {
                bp.close_path();
            }
            bp.move_to(Point::new(from.0, from.1));
            subpath_active = true;
        }
        match *e {
            Edge::Line { to, .. } => bp.line_to(Point::new(to.0, to.1)),
            Edge::Quad { ctrl, to, .. } => {
                bp.quad_to(Point::new(ctrl.0, ctrl.1), Point::new(to.0, to.1))
            }
        }
        last = Some(e.to_pt());
    }
    if close && subpath_active {
        bp.close_path();
    }
    bp
}

fn resolve_fill_style(
    idx: u32,
    fs: &swf::FillStyle,
    reverse: bool,
    doc: &SwfDoc,
) -> ResolvedStyle {
    // Hash key MUST NOT include the reverse flag: fill_style_0 (reversed) and
    // fill_style_1 (forward) of the SAME fill bound opposite sides of the same
    // region. They must merge into one path so the boundary closes — splitting
    // them creates open chains that fail to close, leaving "swiss cheese" holes
    // wherever a region is bordered partly by left-side edges and partly by
    // right-side edges. (See Arakne's PathStyle::hash, which explicitly omits
    // the `reverse` field.)
    let key = format!("fill:{}:{}", idx, fs_hash(fs));
    let kind = match fs {
        swf::FillStyle::Color(c) => StyleKind::Fill {
            brush: Brush::Solid(swf_color(*c)),
            brush_transform: None,
        },
        swf::FillStyle::LinearGradient(g) => {
            let stops = gradient_stops(g);
            let extend = swf_extend(g.spread);
            let brush = Brush::Gradient(
                Gradient::new_linear((-16384.0, 0.0), (16384.0, 0.0))
                    .with_stops(stops.as_slice())
                    .with_extend(extend),
            );
            StyleKind::Fill {
                brush,
                brush_transform: Some(swf_matrix(&g.matrix)),
            }
        }
        swf::FillStyle::RadialGradient(g) => {
            let stops = gradient_stops(g);
            let extend = swf_extend(g.spread);
            let brush = Brush::Gradient(
                Gradient::new_two_point_radial(
                    Point::new(0.0, 0.0),
                    0.0,
                    Point::new(0.0, 0.0),
                    16384.0,
                )
                .with_stops(stops.as_slice())
                .with_extend(extend),
            );
            StyleKind::Fill {
                brush,
                brush_transform: Some(swf_matrix(&g.matrix)),
            }
        }
        swf::FillStyle::FocalGradient {
            gradient: g,
            focal_point,
        } => {
            let stops = gradient_stops(g);
            let extend = swf_extend(g.spread);
            // Focal point: in -1..1 along the gradient ray. Multiply by the
            // gradient's natural radius (16384) to get the start-center.
            let fp = focal_point.to_f32() as f64;
            let start_x = fp * 16384.0;
            let brush = Brush::Gradient(
                Gradient::new_two_point_radial(
                    Point::new(start_x, 0.0),
                    0.0,
                    Point::new(0.0, 0.0),
                    16384.0,
                )
                .with_stops(stops.as_slice())
                .with_extend(extend),
            );
            StyleKind::Fill {
                brush,
                brush_transform: Some(swf_matrix(&g.matrix)),
            }
        }
        swf::FillStyle::Bitmap {
            id,
            matrix,
            is_smoothed: _,
            is_repeating,
        } => {
            let decoded = match doc.lookup_id(*id) {
                Some(Symbol::Bitmap(enc)) => decode_bitmap(enc),
                _ => None,
            };
            if let Some(bm) = decoded {
                let data = ImageData {
                    data: Blob::new(std::sync::Arc::new(bm.rgba)),
                    format: ImageFormat::Rgba8,
                    alpha_type: ImageAlphaType::Alpha,
                    width: bm.width,
                    height: bm.height,
                };
                let extend = if *is_repeating {
                    Extend::Repeat
                } else {
                    Extend::Repeat
                };
                let brush = ImageBrush::from(data)
                    .with_x_extend(extend)
                    .with_y_extend(extend);

                // SWF `FillBitmapMatrix` is bitmap-pixel → shape-twip
                // (forward direction, same as SVG patternTransform). Vello
                // composes `transform * brush_transform` and inverts to
                // sample the atlas at each output pixel — confirmed by
                // reading vello_shaders/fine.wgsl `read_image` and the
                // `DRAWTAG_FILL_IMAGE` `transform_inverse(transform)` step
                // in draw_leaf.wgsl.
                StyleKind::Fill {
                    brush: Brush::Image(brush),
                    brush_transform: Some(swf_matrix(matrix)),
                }
            } else {
                // Missing/undecodable bitmap → transparent so the underlying
                // ground shows through, instead of the previous magenta which
                // gets tinted into pink/green by the parent ColorTransform.
                StyleKind::Fill {
                    brush: Brush::Solid(Color::from_rgba8(0, 0, 0, 0)),
                    brush_transform: None,
                }
            }
        }
    };
    ResolvedStyle { key, kind, reverse }
}

fn resolve_line_style(idx: u32, ls: &swf::LineStyle, doc: &SwfDoc) -> ResolvedStyle {
    // SWF stroke widths are in twips (1 px = 20 twips). Most Dofus 1.29 art uses
    // 1-twip hairlines (0.05 px) and 5-twip (0.25 px) sub-pixel widths. We
    // mirror Arakne+dofasset behavior:
    //   * raw_twips < 20 (< 1 px in Flash): mark `non_scaling`. The renderer
    //     clamps via `max(width, 1/world_scale)` so device width is at least
    //     1 device pixel — same as `StrokeWidthMode::NonScaling` in
    //     dofasset-renderer/src/scene_builder.rs:357-366.
    //   * raw_twips >= 20: pass through. Vello multiplies by world_scale to
    //     give `value_px × resolution` device pixels — same as Fixed mode.
    let raw_twips = f64::from(ls.width().get());
    let non_scaling = raw_twips < 20.0;
    let width = raw_twips;
    let cap = match ls.start_cap() {
        swf::LineCapStyle::Round => vello::kurbo::Cap::Round,
        swf::LineCapStyle::None => vello::kurbo::Cap::Butt,
        swf::LineCapStyle::Square => vello::kurbo::Cap::Square,
    };
    let (join, miter_limit) = match ls.join_style() {
        swf::LineJoinStyle::Round => (vello::kurbo::Join::Round, 4.0),
        swf::LineJoinStyle::Bevel => (vello::kurbo::Join::Bevel, 4.0),
        swf::LineJoinStyle::Miter(ml) => (vello::kurbo::Join::Miter, ml.to_f64()),
    };
    let brush = match ls.fill_style() {
        swf::FillStyle::Color(c) => Brush::Solid(swf_color(*c)),
        swf::FillStyle::LinearGradient(g) | swf::FillStyle::RadialGradient(g)
        | swf::FillStyle::FocalGradient { gradient: g, .. } => {
            // Gradient strokes are rare; build a real gradient brush so the
            // stroke at least picks up the right palette instead of
            // defaulting to opaque black ("random black lines").
            let stops = gradient_stops(g);
            let kind_brush = matches!(
                ls.fill_style(),
                swf::FillStyle::LinearGradient(_)
            );
            if kind_brush {
                Brush::Gradient(
                    Gradient::new_linear((-16384.0, 0.0), (16384.0, 0.0))
                        .with_stops(stops.as_slice()),
                )
            } else {
                Brush::Gradient(
                    Gradient::new_two_point_radial(
                        Point::new(0.0, 0.0),
                        0.0,
                        Point::new(0.0, 0.0),
                        16384.0,
                    )
                    .with_stops(stops.as_slice()),
                )
            }
        }
        swf::FillStyle::Bitmap { id, .. } => {
            // Bitmap-filled stroke: rare. Approximate with the bitmap's
            // average color (sampled from a single texel).
            match doc.lookup_id(*id) {
                Some(Symbol::Bitmap(enc)) => match decode_bitmap(enc) {
                    Some(bm) if bm.rgba.len() >= 4 => Brush::Solid(AlphaColor::from_rgba8(
                        bm.rgba[0],
                        bm.rgba[1],
                        bm.rgba[2],
                        bm.rgba[3],
                    )),
                    _ => Brush::Solid(Color::from_rgba8(0, 0, 0, 0)),
                },
                _ => Brush::Solid(Color::from_rgba8(0, 0, 0, 0)),
            }
        }
    };
    ResolvedStyle {
        key: format!("line:{}:w{}:n{}", idx, width as i64, non_scaling as u8),
        kind: StyleKind::Stroke {
            brush,
            width,
            cap,
            join,
            miter_limit,
            non_scaling,
        },
        reverse: false,
    }
}

// One-shot diagnostic: the very first bitmap fill seen by this WASM module
// gets logged with its matrix and inferred bitmap dimensions, so we can sanity
// check the math.

/// Dumps each unique bitmap's pixel stats once so we can see decoder output.
#[cfg(target_arch = "wasm32")]
fn log_bitmap_pixels_once(id: u16, bm: &bitmap::DecodedBitmap) {
    static SEEN: std::sync::Mutex<Vec<u16>> = std::sync::Mutex::new(Vec::new());
    {
        let mut seen = SEEN.lock().unwrap();
        if seen.len() >= 20 || seen.contains(&id) {
            return;
        }
        seen.push(id);
    }
    let n = bm.rgba.len() / 4;
    let mut min_a = 255u8;
    let mut max_a = 0u8;
    let mut sum_a: u32 = 0;
    let mut zero_a = 0usize;
    let mut full_a = 0usize;
    for chunk in bm.rgba.chunks_exact(4) {
        let a = chunk[3];
        if a < min_a {
            min_a = a;
        }
        if a > max_a {
            max_a = a;
        }
        sum_a += u32::from(a);
        if a == 0 {
            zero_a += 1;
        } else if a == 255 {
            full_a += 1;
        }
    }
    let avg_a = if n > 0 { sum_a / n as u32 } else { 0 };

    // RGB stats so we can tell if the bitmap is near-uniform (in which case
    // forward-matrix rendering would look like a solid color, not absence).
    let mut min_r = 255u8;
    let mut max_r = 0u8;
    let mut min_g = 255u8;
    let mut max_g = 0u8;
    let mut min_b = 255u8;
    let mut max_b = 0u8;
    for chunk in bm.rgba.chunks_exact(4) {
        if chunk[0] < min_r { min_r = chunk[0]; }
        if chunk[0] > max_r { max_r = chunk[0]; }
        if chunk[1] < min_g { min_g = chunk[1]; }
        if chunk[1] > max_g { max_g = chunk[1]; }
        if chunk[2] < min_b { min_b = chunk[2]; }
        if chunk[2] > max_b { max_b = chunk[2]; }
    }
    let msg = format!(
        "swf-spike: bitmap id={} {}x{} a={}/{}/{} r={}-{} g={}-{} b={}-{}",
        id, bm.width, bm.height, min_a, max_a, avg_a,
        min_r, max_r, min_g, max_g, min_b, max_b,
    );
    web_sys::console::log_1(&js_sys::JsString::from(msg.as_str()).into());
}

fn decode_bitmap(enc: &EncodedBitmap) -> Option<bitmap::DecodedBitmap> {
    let result = match enc {
        EncodedBitmap::Lossless {
            version,
            format,
            width,
            height,
            data,
        } => bitmap::decode_lossless_raw(*version, *format, *width, *height, data),
        EncodedBitmap::Jpeg2 { data } => bitmap::decode_jpeg2(data),
        EncodedBitmap::LegacyJpeg { data } => bitmap::decode_jpeg2(data),
        EncodedBitmap::Jpeg3 { jpeg, alpha } => bitmap::decode_jpeg3_raw(jpeg, alpha),
    };
    match result {
        Ok(bm) => Some(bm),
        Err(e) => {
            warn_decode_failure(enc, &e);
            None
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn warn_decode_failure(enc: &EncodedBitmap, err: &anyhow::Error) {
    let kind = match enc {
        EncodedBitmap::Lossless { format, width, height, .. } => {
            format!("Lossless({:?}, {}x{})", format, width, height)
        }
        EncodedBitmap::Jpeg2 { data } => format!("Jpeg2({} B)", data.len()),
        EncodedBitmap::LegacyJpeg { data } => format!("LegacyJpeg({} B)", data.len()),
        EncodedBitmap::Jpeg3 { jpeg, alpha } => {
            format!("Jpeg3({} B + {} B alpha)", jpeg.len(), alpha.len())
        }
    };
    let msg = format!("swf-spike: bitmap decode failed [{kind}]: {err}");
    web_sys::console::warn_1(&js_sys::JsString::from(msg.as_str()).into());
}

#[cfg(not(target_arch = "wasm32"))]
fn warn_decode_failure(enc: &EncodedBitmap, err: &anyhow::Error) {
    let kind = match enc {
        EncodedBitmap::Lossless { format, width, height, .. } => {
            format!("Lossless({:?}, {}x{})", format, width, height)
        }
        EncodedBitmap::Jpeg2 { data } => format!("Jpeg2({} B)", data.len()),
        EncodedBitmap::LegacyJpeg { data } => format!("LegacyJpeg({} B)", data.len()),
        EncodedBitmap::Jpeg3 { jpeg, alpha } => {
            format!("Jpeg3({} B + {} B alpha)", jpeg.len(), alpha.len())
        }
    };
    eprintln!("swf-spike: bitmap decode failed [{kind}]: {err}");
}

fn fs_hash(fs: &swf::FillStyle) -> String {
    match fs {
        swf::FillStyle::Color(c) => format!("c{:02x}{:02x}{:02x}{:02x}", c.r, c.g, c.b, c.a),
        swf::FillStyle::LinearGradient(_) => "lg".to_string(),
        swf::FillStyle::RadialGradient(_) | swf::FillStyle::FocalGradient { .. } => "rg".to_string(),
        swf::FillStyle::Bitmap { id, .. } => format!("b{}", id),
    }
}

fn swf_color(c: swf::Color) -> Color {
    AlphaColor::from_rgba8(c.r, c.g, c.b, c.a)
}

fn swf_extend(spread: swf::GradientSpread) -> Extend {
    match spread {
        swf::GradientSpread::Pad => Extend::Pad,
        swf::GradientSpread::Reflect => Extend::Reflect,
        swf::GradientSpread::Repeat => Extend::Repeat,
    }
}

fn gradient_stops(g: &swf::Gradient) -> Vec<ColorStop> {
    g.records
        .iter()
        .map(|r| ColorStop {
            offset: f32::from(r.ratio) / 255.0,
            color: swf_color(r.color).into(),
        })
        .collect()
}

fn swf_matrix(m: &swf::Matrix) -> Affine {
    // swf::Matrix has a/b/c/d as Fixed16 (call .to_f64()) and tx/ty as Twips.
    Affine::new([
        m.a.to_f64(),
        m.b.to_f64(),
        m.c.to_f64(),
        m.d.to_f64(),
        f64::from(m.tx.get()),
        f64::from(m.ty.get()),
    ])
}

fn twip_pt(x: i32, y: i32) -> (f64, f64) {
    (f64::from(x), f64::from(y))
}
