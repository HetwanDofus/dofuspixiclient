//! HSL-preserving recolor for the SWF zone-tinting path. Mirrors the
//! algorithm used by the dofasset renderer (`packages/renderer/src/color.rs`):
//! preserve the lightness of the original fill, replace its hue and
//! saturation with the player's chosen colour for that zone. This keeps
//! shading/highlight gradation intact while painting the body part in
//! the right palette.

use vello::peniko::Color;

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let r = f64::from(r) / 255.0;
    let g = f64::from(g) / 255.0;
    let b = f64::from(b) / 255.0;
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

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    if s.abs() < f64::EPSILON {
        let v = (l * 255.0).round().clamp(0.0, 255.0) as u8;
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
    let r = (hue2rgb(p, q, h + 1.0 / 3.0) * 255.0).round().clamp(0.0, 255.0) as u8;
    let g = (hue2rgb(p, q, h) * 255.0).round().clamp(0.0, 255.0) as u8;
    let b = (hue2rgb(p, q, h - 1.0 / 3.0) * 255.0).round().clamp(0.0, 255.0) as u8;
    (r, g, b)
}

/// Replace `orig`'s hue+saturation with `target`'s, keeping `orig`'s lightness.
/// `target` is 0xRRGGBB. Alpha is preserved.
pub fn recolor_to_zone(orig: Color, target_rgb: u32) -> Color {
    let rgba = orig.to_rgba8();
    let tr = ((target_rgb >> 16) & 0xff) as u8;
    let tg = ((target_rgb >> 8) & 0xff) as u8;
    let tb = (target_rgb & 0xff) as u8;
    let (target_h, target_s, _) = rgb_to_hsl(tr, tg, tb);
    let (_, _, orig_l) = rgb_to_hsl(rgba.r, rgba.g, rgba.b);
    let (nr, ng, nb) = hsl_to_rgb(target_h, target_s, orig_l);
    Color::from_rgba8(nr, ng, nb, rgba.a)
}

/// Player's three zone colours. None = leave fills as-authored. RGB packed
/// as 0xRRGGBB.
#[derive(Clone, Copy, Default, Debug)]
pub struct PlayerColors(pub [Option<u32>; 3]);

impl PlayerColors {
    pub fn lookup(&self, zone: u8) -> Option<u32> {
        if zone == 0 {
            return None;
        }
        self.0.get((zone - 1) as usize).copied().flatten()
    }
}
