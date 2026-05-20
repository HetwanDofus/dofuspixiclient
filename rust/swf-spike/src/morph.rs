//! MorphShape interpolation. Builds a `swf::Shape` from a
//! `swf::DefineMorphShape` at a given `ratio` (0..65535). Ported from
//! Ruffle's `core/src/display_object/morph_shape.rs::build_morph_frame`,
//! trimmed to the parts we actually use (no font/bitmap caching, no
//! shape_handle bookkeeping). Spell 108 uses morph shapes for its flame
//! "grow then shrink" animation — without interpolation the morph stays
//! frozen at the start shape.

use swf::{
    Color, DefineMorphShape, FillStyle, Fixed8, Fixed16, Gradient, GradientRecord, LineStyle,
    Matrix, Point, Rectangle, Shape, ShapeFlag, ShapeRecord, ShapeStyles, Twips,
};

/// Interpolate `ms` at the given `ratio` (0..65535). Returns a
/// freshly-built `Shape` that the existing `flatten_shape` path can render
/// without further changes.
pub fn build_morph_frame(ms: &DefineMorphShape, ratio: u16) -> Shape {
    // SWF convention: ratio=0 → start shape, ratio=65535 → end shape.
    // a applies to start, b applies to end.
    let b = f32::from(ratio) / 65535.0;
    let a = 1.0 - b;

    let fill_styles: Vec<FillStyle> = ms
        .start
        .fill_styles
        .iter()
        .zip(ms.end.fill_styles.iter())
        .map(|(s, e)| lerp_fill(s, e, a, b))
        .collect();

    let line_styles: Vec<LineStyle> = ms
        .start
        .line_styles
        .iter()
        .zip(ms.end.line_styles.iter())
        .map(|(s, e)| {
            s.clone()
                .with_width(lerp_twips(s.width(), e.width(), a, b))
                .with_fill_style(lerp_fill(s.fill_style(), e.fill_style(), a, b))
        })
        .collect();

    let mut shape: Vec<ShapeRecord> = Vec::with_capacity(ms.start.shape.len());
    let mut start_iter = ms.start.shape.iter();
    let mut end_iter = ms.end.shape.iter();
    let mut s = start_iter.next();
    let mut e = end_iter.next();
    let mut sx = Twips::ZERO;
    let mut sy = Twips::ZERO;
    let mut ex = Twips::ZERO;
    let mut ey = Twips::ZERO;

    while let (Some(sr), Some(er)) = (s, e) {
        match (sr, er) {
            (ShapeRecord::StyleChange(scs), ShapeRecord::StyleChange(sce)) => {
                let mut style_change = scs.clone();
                if scs.move_to.is_some() || sce.move_to.is_some() {
                    if let Some(mv) = &scs.move_to {
                        sx = mv.x;
                        sy = mv.y;
                    }
                    if let Some(mv) = &sce.move_to {
                        ex = mv.x;
                        ey = mv.y;
                    }
                    style_change.move_to = Some(Point::new(
                        lerp_twips(sx, ex, a, b),
                        lerp_twips(sy, ey, a, b),
                    ));
                }
                shape.push(ShapeRecord::StyleChange(style_change));
                s = start_iter.next();
                e = end_iter.next();
            }
            (ShapeRecord::StyleChange(scs), _) => {
                let mut style_change = scs.clone();
                if let Some(mv) = &scs.move_to {
                    sx = mv.x;
                    sy = mv.y;
                    style_change.move_to = Some(Point::new(
                        lerp_twips(sx, ex, a, b),
                        lerp_twips(sy, ey, a, b),
                    ));
                }
                shape.push(ShapeRecord::StyleChange(style_change));
                update_pos(&mut sx, &mut sy, sr);
                s = start_iter.next();
            }
            (_, ShapeRecord::StyleChange(sce)) => {
                let mut style_change = sce.clone();
                if let Some(mv) = &sce.move_to {
                    ex = mv.x;
                    ey = mv.y;
                    style_change.move_to = Some(Point::new(
                        lerp_twips(sx, ex, a, b),
                        lerp_twips(sy, ey, a, b),
                    ));
                }
                shape.push(ShapeRecord::StyleChange(style_change));
                update_pos(&mut ex, &mut ey, er);
                e = end_iter.next();
                continue;
            }
            _ => {
                shape.push(lerp_edge(
                    Point::new(sx, sy),
                    Point::new(ex, ey),
                    sr,
                    er,
                    a,
                    b,
                ));
                update_pos(&mut sx, &mut sy, sr);
                update_pos(&mut ex, &mut ey, er);
                s = start_iter.next();
                e = end_iter.next();
            }
        }
    }

    let bounds = lerp_rect(&ms.start.shape_bounds, &ms.end.shape_bounds, a, b);
    Shape {
        version: ms.version,
        id: ms.id,
        shape_bounds: bounds.clone(),
        edge_bounds: bounds,
        flags: ShapeFlag::HAS_SCALING_STROKES,
        styles: ShapeStyles {
            fill_styles,
            line_styles,
        },
        shape,
    }
}

/// Bounds rectangle the user can use for `symbol_bounds`. We return the
/// UNION of start and end bounds — covers the worst-case shape extent
/// across the morph animation, so layout/clipping computations don't have
/// to recompute per ratio.
pub fn morph_bounds_union(ms: &DefineMorphShape) -> Rectangle<Twips> {
    let s = &ms.start.shape_bounds;
    let e = &ms.end.shape_bounds;
    Rectangle {
        x_min: s.x_min.min(e.x_min),
        x_max: s.x_max.max(e.x_max),
        y_min: s.y_min.min(e.y_min),
        y_max: s.y_max.max(e.y_max),
    }
}

fn update_pos(x: &mut Twips, y: &mut Twips, record: &ShapeRecord) {
    match record {
        ShapeRecord::StraightEdge { delta } => {
            *x += delta.dx;
            *y += delta.dy;
        }
        ShapeRecord::CurvedEdge {
            control_delta,
            anchor_delta,
        } => {
            *x += control_delta.dx + anchor_delta.dx;
            *y += control_delta.dy + anchor_delta.dy;
        }
        ShapeRecord::StyleChange(sc) => {
            if let Some(mv) = &sc.move_to {
                *x = mv.x;
                *y = mv.y;
            }
        }
    }
}

fn lerp_color(s: Color, e: Color, a: f32, b: f32) -> Color {
    Color {
        r: (a * f32::from(s.r) + b * f32::from(e.r)) as u8,
        g: (a * f32::from(s.g) + b * f32::from(e.g)) as u8,
        b: (a * f32::from(s.b) + b * f32::from(e.b)) as u8,
        a: (a * f32::from(s.a) + b * f32::from(e.a)) as u8,
    }
}

fn lerp_twips(s: Twips, e: Twips, a: f32, b: f32) -> Twips {
    Twips::new((s.get() as f32 * a + e.get() as f32 * b).round() as i32)
}

fn lerp_point(s: Point<Twips>, e: Point<Twips>, a: f32, b: f32) -> Point<Twips> {
    Point::new(lerp_twips(s.x, e.x, a, b), lerp_twips(s.y, e.y, a, b))
}

fn lerp_rect(s: &Rectangle<Twips>, e: &Rectangle<Twips>, a: f32, b: f32) -> Rectangle<Twips> {
    Rectangle {
        x_min: lerp_twips(s.x_min, e.x_min, a, b),
        x_max: lerp_twips(s.x_max, e.x_max, a, b),
        y_min: lerp_twips(s.y_min, e.y_min, a, b),
        y_max: lerp_twips(s.y_max, e.y_max, a, b),
    }
}

fn lerp_matrix(s: &Matrix, e: &Matrix, a: f32, b: f32) -> Matrix {
    Matrix {
        a: Fixed16::from_f32(a * s.a.to_f32() + b * e.a.to_f32()),
        b: Fixed16::from_f32(a * s.b.to_f32() + b * e.b.to_f32()),
        c: Fixed16::from_f32(a * s.c.to_f32() + b * e.c.to_f32()),
        d: Fixed16::from_f32(a * s.d.to_f32() + b * e.d.to_f32()),
        tx: lerp_twips(s.tx, e.tx, a, b),
        ty: lerp_twips(s.ty, e.ty, a, b),
    }
}

fn lerp_gradient_record(s: &GradientRecord, e: &GradientRecord, a: f32, b: f32) -> GradientRecord {
    GradientRecord {
        ratio: (f32::from(s.ratio) * a + f32::from(e.ratio) * b).round() as u8,
        color: lerp_color(s.color, e.color, a, b),
    }
}

fn lerp_gradient(s: &Gradient, e: &Gradient, a: f32, b: f32) -> Gradient {
    let records: Vec<GradientRecord> = s
        .records
        .iter()
        .zip(e.records.iter())
        .map(|(sr, er)| lerp_gradient_record(sr, er, a, b))
        .collect();
    Gradient {
        matrix: lerp_matrix(&s.matrix, &e.matrix, a, b),
        spread: s.spread,
        interpolation: s.interpolation,
        records,
    }
}

fn lerp_fill(s: &FillStyle, e: &FillStyle, a: f32, b: f32) -> FillStyle {
    use FillStyle::*;
    match (s, e) {
        (Color(s), Color(e)) => Color(lerp_color(*s, *e, a, b)),
        (
            Bitmap {
                id,
                matrix: ms,
                is_smoothed,
                is_repeating,
            },
            Bitmap { matrix: me, .. },
        ) => Bitmap {
            id: *id,
            matrix: lerp_matrix(ms, me, a, b),
            is_smoothed: *is_smoothed,
            is_repeating: *is_repeating,
        },
        (LinearGradient(s), LinearGradient(e)) => LinearGradient(lerp_gradient(s, e, a, b)),
        (RadialGradient(s), RadialGradient(e)) => RadialGradient(lerp_gradient(s, e, a, b)),
        (
            FocalGradient {
                gradient: sg,
                focal_point: sf,
            },
            FocalGradient {
                gradient: eg,
                focal_point: ef,
            },
        ) => FocalGradient {
            gradient: lerp_gradient(sg, eg, a, b),
            focal_point: Fixed8::from_f32(a * sf.to_f32() + b * ef.to_f32()),
        },
        _ => s.clone(),
    }
}

fn lerp_edge(
    sp: Point<Twips>,
    ep: Point<Twips>,
    s: &ShapeRecord,
    e: &ShapeRecord,
    a: f32,
    b: f32,
) -> ShapeRecord {
    let pen = lerp_point(sp, ep, a, b);
    match (s, e) {
        (
            ShapeRecord::StraightEdge { delta: sd },
            ShapeRecord::StraightEdge { delta: ed },
        ) => {
            let sa = sp + *sd;
            let ea = ep + *ed;
            let anchor = lerp_point(sa, ea, a, b);
            ShapeRecord::StraightEdge {
                delta: anchor - pen,
            }
        }
        (
            ShapeRecord::CurvedEdge {
                control_delta: scd,
                anchor_delta: sad,
            },
            ShapeRecord::CurvedEdge {
                control_delta: ecd,
                anchor_delta: ead,
            },
        ) => {
            let sc = sp + *scd;
            let sa = sc + *sad;
            let ec = ep + *ecd;
            let ea = ec + *ead;
            let control = lerp_point(sc, ec, a, b);
            let anchor = lerp_point(sa, ea, a, b);
            ShapeRecord::CurvedEdge {
                control_delta: control - pen,
                anchor_delta: anchor - control,
            }
        }
        // Promote a straight edge to a curve when paired with one (zero-
        // length control delta makes the curve degenerate to the same
        // line at the endpoints).
        (
            ShapeRecord::StraightEdge { delta: sd },
            ShapeRecord::CurvedEdge {
                control_delta: ecd,
                anchor_delta: ead,
            },
        ) => {
            let sa = sp + *sd;
            let scd = *sd / 2;
            let sc = sp + scd;
            let ec = ep + *ecd;
            let ea = ec + *ead;
            let control = lerp_point(sc, ec, a, b);
            let anchor = lerp_point(sa, ea, a, b);
            ShapeRecord::CurvedEdge {
                control_delta: control - pen,
                anchor_delta: anchor - control,
            }
        }
        (
            ShapeRecord::CurvedEdge {
                control_delta: scd,
                anchor_delta: sad,
            },
            ShapeRecord::StraightEdge { delta: ed },
        ) => {
            let sc = sp + *scd;
            let sa = sc + *sad;
            let ea = ep + *ed;
            let ecd = *ed / 2;
            let ec = ep + ecd;
            let control = lerp_point(sc, ec, a, b);
            let anchor = lerp_point(sa, ea, a, b);
            ShapeRecord::CurvedEdge {
                control_delta: control - pen,
                anchor_delta: anchor - control,
            }
        }
        // StyleChange shouldn't appear here (caller handles it), but be
        // defensive — fall back to start record.
        _ => s.clone(),
    }
}
