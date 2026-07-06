//! Per-cell deterministic seed for the AVM1 PRNG.

pub fn seed_for_cell(cell_id: u16) -> u32 {
    let mut x = u32::from(cell_id).wrapping_add(0x9e37_79b9);
    x ^= x >> 16;
    x = x.wrapping_mul(0x85eb_ca6b);
    x ^= x >> 13;
    x = x.wrapping_mul(0xc2b2_ae35);
    x ^= x >> 16;
    if x == 0 { 0x1234_5678 } else { x }
}

/// LCM that stays within `u16` — falls back to `a.max(b)` when the true
/// LCM overflows so we keep a valid (if slightly less smooth) cycle
/// rather than panicking on weird pathological tile graphs.
pub(super) fn lcm_u16(a: u16, b: u16) -> u16 {
    if a == 0 {
        return b;
    }
    if b == 0 {
        return a;
    }
    let g = gcd_u32(u32::from(a), u32::from(b));
    let product = (u32::from(a) / g) * u32::from(b);
    if product > u32::from(u16::MAX) || product == 0 {
        a.max(b)
    } else {
        product as u16
    }
}

fn gcd_u32(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let t = a % b;
        a = b;
        b = t;
    }
    a
}

#[cfg(test)]
mod seed_tests {
    use super::*;

    #[test]
    fn lcm_matches_textbook_values() {
        assert_eq!(lcm_u16(3, 5), 15);
        assert_eq!(lcm_u16(4, 6), 12);
        assert_eq!(lcm_u16(30, 60), 60);
        assert_eq!(lcm_u16(7, 11), 77);
        assert_eq!(lcm_u16(0, 7), 7);
        assert_eq!(lcm_u16(7, 0), 7);
        assert_eq!(lcm_u16(65535, 32768), 65535);
    }
}
