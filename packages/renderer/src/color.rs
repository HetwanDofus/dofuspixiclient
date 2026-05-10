use vello::peniko::Color;

/// Convert RGB (0-255) to HSL (0-1).
pub fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let r = r as f64 / 255.0;
    let g = g as f64 / 255.0;
    let b = b as f64 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;

    if (max - min).abs() < f64::EPSILON {
        return (0.0, 0.0, l);
    }

    let d = max - min;
    let s = if l > 0.5 { d / (2.0 - max - min) } else { d / (max + min) };

    let h = if (max - r).abs() < f64::EPSILON {
        ((g - b) / d + if g < b { 6.0 } else { 0.0 }) / 6.0
    } else if (max - g).abs() < f64::EPSILON {
        ((b - r) / d + 2.0) / 6.0
    } else {
        ((r - g) / d + 4.0) / 6.0
    };

    (h, s, l)
}

/// Convert HSL (0-1) to RGB (0-255).
pub fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    if s.abs() < f64::EPSILON {
        let v = (l * 255.0).round() as u8;
        return (v, v, v);
    }

    let hue2rgb = |p: f64, q: f64, mut t: f64| -> f64 {
        if t < 0.0 { t += 1.0; }
        if t > 1.0 { t -= 1.0; }
        if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
        if t < 1.0 / 2.0 { return q; }
        if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
        p
    };

    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;

    let r = (hue2rgb(p, q, h + 1.0 / 3.0) * 255.0).round() as u8;
    let g = (hue2rgb(p, q, h) * 255.0).round() as u8;
    let b = (hue2rgb(p, q, h - 1.0 / 3.0) * 255.0).round() as u8;

    (r, g, b)
}

/// Replace a color's hue/saturation while preserving its lightness.
pub fn replace_zone_color(original: Color, target_h: f64, target_s: f64) -> Color {
    let rgba = original.to_rgba8();
    let (_, _, orig_l) = rgb_to_hsl(rgba.r, rgba.g, rgba.b);
    let (nr, ng, nb) = hsl_to_rgb(target_h, target_s, orig_l);
    Color::from_rgba8(nr, ng, nb, rgba.a)
}

/// Build a color replacement lookup table for zone colors.
/// Maps original RGBA → replaced RGBA for all colors in all zones.
///
/// `player_colors` carries up to 3 u32 RGB values. The meaning of each slot
/// depends on the zone's `tint_mode`:
///
/// - Player: [body, trim, accent] — 3 hues, zones map 1→0, 2→1, 3→2.
/// - Guild: [background, foreground, _] — 2 hues, zones map 1→0, 2→1.
/// - Spell: [color, _, _] — a single hue, all zones use slot 0.
/// - AlignmentLevel: [side_hint, _, _] — for now, treated like Spell (single
///   hue); a proper level-ramp needs the level as a separate input.
///
/// All modes share the same HSL-preserve-lightness math — the difference is
/// just which slot the zone's target hue comes from.
pub fn build_color_replacements(
    zones: &[crate::format::ColorZone],
    player_colors: &[u32; 3],
) -> std::collections::HashMap<u32, Color> {
    use crate::format::TintMode;

    let mut map = std::collections::HashMap::new();

    for zone in zones {
        let slot = match zone.tint_mode {
            TintMode::Player | TintMode::Guild => {
                (zone.player_color_index as usize).saturating_sub(1)
            }
            TintMode::Spell | TintMode::AlignmentLevel => 0,
        };
        let player_color = player_colors.get(slot).copied().unwrap_or(0);
        if player_color == 0 { continue; }

        let pr = ((player_color >> 16) & 0xFF) as u8;
        let pg = ((player_color >> 8) & 0xFF) as u8;
        let pb = (player_color & 0xFF) as u8;
        let (target_h, target_s, _) = rgb_to_hsl(pr, pg, pb);

        for oc in &zone.original_colors {
            let key = (oc.r as u32) << 16 | (oc.g as u32) << 8 | oc.b as u32;
            // First zone to claim a color wins (matches Pixi's behavior for shared colors).
            map.entry(key).or_insert_with(|| {
                let orig_color = Color::from_rgba8(oc.r, oc.g, oc.b, 255);
                replace_zone_color(orig_color, target_h, target_s)
            });
        }
    }

    map
}
