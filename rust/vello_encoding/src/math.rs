// Copyright 2022 the Vello Authors
// SPDX-License-Identifier: Apache-2.0 OR MIT

use std::ops::Mul;

use bytemuck::{Pod, Zeroable};
use peniko::kurbo;

/// Affine transformation matrix.
#[derive(Copy, Clone, Debug, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Transform {
    /// 2x2 matrix.
    pub matrix: [f32; 4],
    /// Translation.
    pub translation: [f32; 2],
}

impl Transform {
    /// Identity transform.
    pub const IDENTITY: Self = Self {
        matrix: [1.0, 0.0, 0.0, 1.0],
        translation: [0.0; 2],
    };

    /// Creates a transform from a kurbo affine matrix.
    pub fn from_kurbo(transform: &kurbo::Affine) -> Self {
        let c = transform.as_coeffs().map(|x| x as f32);
        Self {
            matrix: [c[0], c[1], c[2], c[3]],
            translation: [c[4], c[5]],
        }
    }

    /// Converts the transform to a kurbo affine matrix.
    pub fn to_kurbo(&self) -> kurbo::Affine {
        kurbo::Affine::new(
            [
                self.matrix[0],
                self.matrix[1],
                self.matrix[2],
                self.matrix[3],
                self.translation[0],
                self.translation[1],
            ]
            .map(|x| x as f64),
        )
    }
}

impl Mul for Transform {
    type Output = Self;

    #[inline]
    fn mul(self, other: Self) -> Self {
        Self {
            matrix: [
                self.matrix[0] * other.matrix[0] + self.matrix[2] * other.matrix[1],
                self.matrix[1] * other.matrix[0] + self.matrix[3] * other.matrix[1],
                self.matrix[0] * other.matrix[2] + self.matrix[2] * other.matrix[3],
                self.matrix[1] * other.matrix[2] + self.matrix[3] * other.matrix[3],
            ],
            translation: [
                self.matrix[0] * other.translation[0]
                    + self.matrix[2] * other.translation[1]
                    + self.translation[0],
                self.matrix[1] * other.translation[0]
                    + self.matrix[3] * other.translation[1]
                    + self.translation[1],
            ],
        }
    }
}

pub fn point_to_f32(point: kurbo::Point) -> [f32; 2] {
    [point.x as f32, point.y as f32]
}

/// Converts an `f32` to IEEE-754 binary16 format represented as the bits of a `u16`.
///
/// This implementation was adapted from Fabian Giesen's `float_to_half_fast3`()
/// function which can be found at <https://gist.github.com/rygorous/2156668#file-gistfile1-cpp-L285>
///
/// TODO: We should consider adopting <https://crates.io/crates/half> as a dependency since it nicely
/// wraps native ARM and x86 instructions for floating-point conversion.
pub(crate) fn f32_to_f16(val: f32) -> u16 {
    const INF_32: u32 = 255 << 23;
    const INF_16: u32 = 31 << 23;
    const MAGIC: u32 = 15 << 23;
    const SIGN_MASK: u32 = 0x8000_0000_u32;
    const ROUND_MASK: u32 = !0xFFF_u32;

    let u = val.to_bits();
    let sign = u & SIGN_MASK;
    let u = u ^ sign;

    // NOTE all the integer compares in this function can be safely
    // compiled into signed compares since all operands are below
    // 0x80000000. Important if you want fast straight SSE2 code
    // (since there's no unsigned PCMPGTD).

    // Inf or NaN (all exponent bits set)
    let output: u16 = if u >= INF_32 {
        // NaN -> qNaN and Inf->Inf
        if u > INF_32 { 0x7E00 } else { 0x7C00 }
    } else {
        // (De)normalized number or zero
        let mut u = u & ROUND_MASK;
        u = (f32::from_bits(u) * f32::from_bits(MAGIC)).to_bits();
        u = u.overflowing_sub(ROUND_MASK).0;

        // Clamp to signed infinity if exponent overflowed
        if u > INF_16 {
            u = INF_16;
        }
        (u >> 13) as u16 // Take the bits!
    };
    output | (sign >> 16) as u16
}

/// Converts a 16-bit precision IEEE-754 binary16 float to a `f32`.
///
/// This implementation was adapted from Fabian Giesen's `half_to_float()`
/// function which can be found at <https://gist.github.com/rygorous/2156668#file-gistfile1-cpp-L574>
pub fn f16_to_f32(bits: u16) -> f32 {
    let bits = bits as u32;
    const MAGIC: u32 = 113 << 23;
    const SHIFTED_EXP: u32 = 0x7c00 << 13; // exponent mask after shift

    let mut o = (bits & 0x7fff) << 13; // exponent/mantissa bits
    let exp = SHIFTED_EXP & o; // just the exponent
    o += (127 - 15) << 23; // exponent adjust

    // handle exponent special cases
    if exp == SHIFTED_EXP {
        // Inf/NaN?
        o += (128 - 16) << 23; // extra exp adjust
    } else if exp == 0 {
        // Zero/Denormal?
        o += 1 << 23; // extra exp adjust
        o = (f32::from_bits(o) - f32::from_bits(MAGIC)).to_bits(); // normalize
    }

    f32::from_bits(o | ((bits & 0x8000) << 16)) // sign bit
}

#[cfg(test)]
mod tests {
    use super::{Transform, f16_to_f32, f32_to_f16};

    /// Rust mirror of the column-major Transform composition done by
    /// `instance_expand_slab.wgsl`. Validates the shader's formulas
    /// against `vello_encoding::Transform::Mul` (the canonical source
    /// of truth used everywhere else in the codebase). If this test
    /// fails, the WGSL composition is wrong and bodies will render
    /// with subtly bad geometry.
    fn shader_compose(world: Transform, local: Transform) -> Transform {
        let r_m0 = world.matrix[0] * local.matrix[0] + world.matrix[2] * local.matrix[1];
        let r_m1 = world.matrix[1] * local.matrix[0] + world.matrix[3] * local.matrix[1];
        let r_m2 = world.matrix[0] * local.matrix[2] + world.matrix[2] * local.matrix[3];
        let r_m3 = world.matrix[1] * local.matrix[2] + world.matrix[3] * local.matrix[3];
        let r_t0 = world.matrix[0] * local.translation[0]
            + world.matrix[2] * local.translation[1]
            + world.translation[0];
        let r_t1 = world.matrix[1] * local.translation[0]
            + world.matrix[3] * local.translation[1]
            + world.translation[1];
        Transform {
            matrix: [r_m0, r_m1, r_m2, r_m3],
            translation: [r_t0, r_t1],
        }
    }

    #[test]
    fn shader_compose_matches_transform_mul() {
        let a = Transform {
            matrix: [1.5, 0.25, -0.5, 2.0],
            translation: [10.0, 20.0],
        };
        let b = Transform {
            matrix: [0.8, -0.1, 0.3, 1.2],
            translation: [-5.0, 7.0],
        };
        let expected = a * b;
        let actual = shader_compose(a, b);
        for k in 0..4 {
            assert!(
                (expected.matrix[k] - actual.matrix[k]).abs() < 1e-6,
                "matrix[{}] mismatch: expected {}, got {}",
                k,
                expected.matrix[k],
                actual.matrix[k],
            );
        }
        for k in 0..2 {
            assert!(
                (expected.translation[k] - actual.translation[k]).abs() < 1e-6,
                "translation[{}] mismatch: expected {}, got {}",
                k,
                expected.translation[k],
                actual.translation[k],
            );
        }
    }

    #[test]
    fn shader_compose_identity_preserves_local() {
        let id = Transform {
            matrix: [1.0, 0.0, 0.0, 1.0],
            translation: [0.0, 0.0],
        };
        let local = Transform {
            matrix: [0.7, 0.1, -0.2, 0.9],
            translation: [3.0, 4.0],
        };
        let composed = shader_compose(id, local);
        assert_eq!(composed.matrix, local.matrix);
        assert_eq!(composed.translation, local.translation);
    }

    #[test]
    fn test_f32_to_f16_simple() {
        let input: f32 = std::f32::consts::PI;
        let output: u16 = f32_to_f16(input);
        assert_eq!(0x4248_u16, output); // 3.141
    }

    #[test]
    fn test_f32_to_f16_nan_overflow() {
        // A signaling NaN with unset high bits but a low bit that could get accidentally masked
        // should get converted to a quiet NaN and not infinity.
        let input: f32 = f32::from_bits(0x7F800001_u32);
        assert!(input.is_nan());
        let output: u16 = f32_to_f16(input);
        assert_eq!(0x7E00, output);
    }

    #[test]
    fn test_f32_to_f16_inf() {
        let input: f32 = f32::from_bits(0x7F800000_u32);
        assert!(input.is_infinite());
        let output: u16 = f32_to_f16(input);
        assert_eq!(0x7C00, output);
    }

    #[test]
    fn test_f32_to_f16_exponent_rebias() {
        let input: f32 = 0.00003051758;
        let output: u16 = f32_to_f16(input);
        assert_eq!(0x0200, output); // 0.00003052
    }

    #[test]
    fn test_f32_to_f16_exponent_overflow() {
        let input: f32 = 1.701412e38;
        let output: u16 = f32_to_f16(input);
        assert_eq!(0x7C00, output); // +inf
    }

    #[test]
    fn test_f32_to_f16_exponent_overflow_neg_inf() {
        let input: f32 = -1.701412e38;
        let output: u16 = f32_to_f16(input);
        assert_eq!(0xFC00, output); // -inf
    }

    #[test]
    fn test_f16_to_f32_simple() {
        let input: u16 = 0x4248_u16;
        let output: f32 = f16_to_f32(input);
        assert_eq!(3.140625, output);
    }

    #[test]
    fn test_f16_to_f32_inf() {
        let input: u16 = 0x7C00;
        let output = f16_to_f32(input);
        assert!(output.is_infinite());
    }

    #[test]
    fn test_f16_to_f32_neg_inf() {
        let input: u16 = 0xFC00;
        let output = f16_to_f32(input);
        assert!(output.is_infinite());
    }

    #[test]
    fn test_f16_to_f32_inf_roundtrip() {
        let input: u16 = 0x7C00;
        let output = f32_to_f16(f16_to_f32(input));
        assert_eq!(input, output);
    }

    #[test]
    fn test_f16_to_f32_neg_inf_roundtrip() {
        let input: u16 = 0xFC00;
        let output = f32_to_f16(f16_to_f32(input));
        assert_eq!(input, output);
    }

    #[test]
    fn test_f16_to_f32_nan() {
        let input: u16 = 0x7C01;
        let output = f16_to_f32(input);
        assert!(output.is_nan());
    }

    #[test]
    fn test_f16_to_f32_nan_roundtrip() {
        let input: u16 = 0x7C01;
        // Roundtrip 3 times and land on a f32 to check that NaN'ness is preserved.
        let output = f16_to_f32(f32_to_f16(f16_to_f32(input)));
        assert!(output.is_nan());
    }

    #[test]
    fn test_f16_to_f32_large_pos_roundtrip() {
        let input: u16 = 0x7BFF; // 65504.0
        let output = f32_to_f16(f16_to_f32(input));
        assert_eq!(input, output);
    }

    #[test]
    fn test_f16_to_f32_large_neg_roundtrip() {
        let input: u16 = 0xFBFF; // -65504.0
        let output = f32_to_f16(f16_to_f32(input));
        assert_eq!(input, output);
    }

    #[test]
    fn test_f16_to_f32_small_pos_roundtrip() {
        let input: u16 = 0x0001; // 5.97e-8
        let output = f32_to_f16(f16_to_f32(input));
        assert_eq!(input, output);
    }

    #[test]
    fn test_f16_to_f32_small_neg_roundtrip() {
        let input: u16 = 0x8001; // -5.97e-8
        let output = f32_to_f16(f16_to_f32(input));
        assert_eq!(input, output);
    }

    #[test]
    fn test_f16_to_f32_roundtrip() {
        const EPS: f32 = 0.001;
        let input: f32 = std::f32::consts::PI;
        assert!((input - f16_to_f32(f32_to_f16(input))).abs() < EPS);
    }
}
