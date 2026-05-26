import { Filter, GlProgram, GpuProgram, UniformGroup } from "pixi.js";

/**
 * Edge-feather + progressive-blur filter for the widescreen live-map capture
 * (Composition Y).
 *
 * Applied to the captured live `mapContainer` sprite (widened to include the
 * edge-object overspill that overhangs the old game-area bounds). Per fragment
 * it computes an edge ramp `a` from the sprite UV (1 in the interior, →0 across
 * the left/right/bottom feather strips), then:
 *   - BLURS the colour with radius `(1 - a) * uBlurRadius` — so blur grows as
 *     `a` drops. Because the ramp is biased to reach 1 a little INSIDE the old
 *     crop line (see `setEdgeParams` callers), blur is already underway AT the
 *     crop and increases outward, matching the blurred neighbour behind.
 *   - multiplies alpha by `a`, cross-dissolving into the blurred neighbour.
 *
 * The blur uses a 16-tap VOGEL DISK (golden-angle spiral): an even, non-grid,
 * non-axis-aligned sample distribution. A grid/box kernel ghosts the diagonal
 * isometric tile edges into visible streaks ("raycast" artefacts); the Vogel
 * disk spreads taps evenly so the blur stays smooth. `uBlurRadius` is a vec2
 * (x,y sprite-UV) so the disk is isotropic in pixels despite the non-square
 * capture.
 *
 * Interior pixels (`a ≈ 1`) take a single-sample fast path, so the disk taps
 * only run in the thin feather margins — negligible per-frame cost.
 *
 * Top is left unfeathered (no neighbour band above this layout). Output is
 * premultiplied-alpha correct (rgb and a both scaled by `a`).
 *
 * Leak-safety: SINGLETON filter, reused every frame on a stable-size sprite
 * (`feedback_pixi_filter_singleton`).
 */

const glVertexShader = `
  in vec2 aPosition;
  out vec2 vTextureCoord;
  out vec2 vSpriteUv;

  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;

  vec4 filterVertexPosition() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }

  vec2 filterTextureCoord() {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
  }

  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vSpriteUv = aPosition;
  }
`;

const glFragmentShader = `
  precision highp float;
  in vec2 vTextureCoord;
  in vec2 vSpriteUv;
  out vec4 fragColor;

  uniform sampler2D uTexture;
  uniform vec4 uInputClamp;
  uniform vec4 featherUniforms_uFeatherUv;
  uniform vec2 featherUniforms_uBlurRadius;

  const int TAPS = 16;
  const float GOLDEN_ANGLE = 2.39996323;

  void main(void) {
    float fL = featherUniforms_uFeatherUv.x;
    float fR = featherUniforms_uFeatherUv.y;
    float fB = featherUniforms_uFeatherUv.w;

    float a = 1.0;
    if (fL > 0.0) a *= smoothstep(0.0, fL, vSpriteUv.x);
    if (fR > 0.0) a *= smoothstep(0.0, fR, 1.0 - vSpriteUv.x);
    if (fB > 0.0) a *= smoothstep(0.0, fB, 1.0 - vSpriteUv.y);

    float t = 1.0 - a;

    vec4 color;
    if (t < 0.003) {
      color = texture(uTexture, vTextureCoord);
    } else {
      vec2 radius = t * featherUniforms_uBlurRadius;
      vec2 lo = uInputClamp.xy;
      vec2 hi = uInputClamp.zw;
      vec4 acc = vec4(0.0);
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / float(TAPS));
        float theta = fi * GOLDEN_ANGLE;
        vec2 o = vec2(cos(theta), sin(theta)) * r * radius;
        acc += texture(uTexture, clamp(vTextureCoord + o, lo, hi));
      }
      color = acc / float(TAPS);
    }

    // Premultiplied-alpha output: scale rgb AND a by the ramp.
    fragColor = vec4(color.rgb * a, color.a * a);
  }
`;

const wgslShader = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> featherUniforms: FeatherUniforms;

struct FeatherUniforms {
  uFeatherUv: vec4<f32>,
  uBlurRadius: vec2<f32>,
};

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) spriteUv: vec2<f32>,
};

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
) -> VSOutput {
  var output: VSOutput;

  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;

  output.position = vec4<f32>(position, 0.0, 1.0);
  output.uv = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
  output.spriteUv = aPosition;

  return output;
}

const TAPS: i32 = 16;
const GOLDEN_ANGLE: f32 = 2.39996323;

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @location(1) spriteUv: vec2<f32>,
) -> @location(0) vec4<f32> {
  let fL = featherUniforms.uFeatherUv.x;
  let fR = featherUniforms.uFeatherUv.y;
  let fB = featherUniforms.uFeatherUv.w;

  var a = 1.0;
  if (fL > 0.0) { a = a * smoothstep(0.0, fL, spriteUv.x); }
  if (fR > 0.0) { a = a * smoothstep(0.0, fR, 1.0 - spriteUv.x); }
  if (fB > 0.0) { a = a * smoothstep(0.0, fB, 1.0 - spriteUv.y); }

  let t = 1.0 - a;

  var color: vec4<f32>;
  if (t < 0.003) {
    color = textureSampleLevel(uTexture, uSampler, uv, 0.0);
  } else {
    let radius = t * featherUniforms.uBlurRadius;
    let lo = gfu.uInputClamp.xy;
    let hi = gfu.uInputClamp.zw;
    var acc = vec4<f32>(0.0);
    for (var i: i32 = 0; i < TAPS; i = i + 1) {
      let fi = f32(i);
      let r = sqrt((fi + 0.5) / f32(TAPS));
      let theta = fi * GOLDEN_ANGLE;
      let o = vec2<f32>(cos(theta), sin(theta)) * r * radius;
      let suv = clamp(uv + o, lo, hi);
      acc = acc + textureSampleLevel(uTexture, uSampler, suv, 0.0);
    }
    color = acc / f32(TAPS);
  }

  // Premultiplied-alpha output: scale rgb AND a by the ramp.
  return vec4<f32>(color.rgb * a, color.a * a);
}
`;

export class NeighborFeatherFilter extends Filter {
  private readonly featherUniforms: UniformGroup;

  constructor() {
    const featherUniforms = new UniformGroup({
      uFeatherUv: { value: [0, 0, 0, 0], type: "vec4<f32>" },
      uBlurRadius: { value: [0, 0], type: "vec2<f32>" },
    });

    super({
      glProgram: GlProgram.from({
        vertex: glVertexShader,
        fragment: glFragmentShader,
      }),
      gpuProgram: GpuProgram.from({
        vertex: { source: wgslShader, entryPoint: "mainVertex" },
        fragment: { source: wgslShader, entryPoint: "mainFragment" },
      }),
      resources: { featherUniforms },
    });

    this.featherUniforms = featherUniforms;
  }

  /**
   * Feather widths as fractions of the capture sprite, `(left, right, top,
   * bottom)` — these reach 1 (fully sharp/opaque) a little INSIDE the old crop
   * so blur begins at the crop — plus the max blur radius as sprite-UV `(x, y)`
   * (kept isotropic in pixels). A side set to 0 is not feathered. Recompute on
   * canvas resize.
   */
  setEdgeParams(
    left: number,
    right: number,
    top: number,
    bottom: number,
    blurRadiusX: number,
    blurRadiusY: number
  ): void {
    const u = this.featherUniforms.uniforms;
    const v = u.uFeatherUv as number[];
    v[0] = left;
    v[1] = right;
    v[2] = top;
    v[3] = bottom;
    const b = u.uBlurRadius as number[];
    b[0] = blurRadiusX;
    b[1] = blurRadiusY;
    this.featherUniforms.update();
  }
}
