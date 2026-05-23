import {
  Filter,
  GlProgram,
  GpuProgram,
  type TextureSource,
  TextureStyle,
  UniformGroup,
} from "pixi.js";

// ── WGSL ─────────────────────────────────────────────────────────────────
//
// `uGameTex` is bound to the FINAL level of the compositor's downsample
// pyramid — already 1/16 the source resolution, with ~256 source
// pixels bilinear-averaged into each output pixel. All the visual
// blur is baked in at that point; the filter just samples it.
//
// `uSide`:
//   -1 → left band  (game-edge at uGameTex.uv.x = 0)
//   +1 → right band (game-edge at uGameTex.uv.x = 1)
//
// Per fragment:
//   1. Compute `d` (0 at inner seam, 1 at outer canvas edge).
//   2. Sample uGameTex slightly inside the game edge along the y
//      position of the band fragment. `uMirrorDepth` controls a gentle
//      parallax shift inward as d grows.
//   3. 5-tap micro-smoothing on the already-blurred source to remove
//      any residual texel-aliasing from the pyramid steps. With the
//      source at 1/16 resolution these taps cover a small fractional
//      region but still meaningfully smooth bilinear stair-steps.
//   4. Vignette darken with d so the band fades into the page bg.
//
// `uThreshold` early-outs to solid black when the edge column is
// effectively empty (e.g. centred map on a black backdrop). On the
// pre-blurred source the edge values are already smoothed colours, so
// thresholding directly is reliable.
const WGSL = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct SideBandUniforms {
  uSide: f32,
  uMirrorDepth: f32,
  uBlurRadius: f32,
  uThreshold: f32,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> sideBandUniforms: SideBandUniforms;
@group(1) @binding(1) var uGameTex: texture_2d<f32>;
@group(1) @binding(2) var uGameSampler: sampler;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) vSpriteUv: vec2<f32>,
};

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOut {
  var out: VSOut;
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  out.position = vec4<f32>(position, 0.0, 1.0);
  out.vSpriteUv = aPosition;
  return out;
}

@fragment
fn mainFragment(@location(0) vSpriteUv: vec2<f32>) -> @location(0) vec4<f32> {
  // Touch uTexture / uSampler once with zero weight so the Pixi-bound
  // back-buffer slots stay live in the bind group even though the
  // band sprite's own content is irrelevant. textureSampleLevel
  // (explicit LOD) is used everywhere — the early-out branches the
  // shader on a value derived from texture taps, which would put the
  // micro-smoothing in non-uniform control flow and fail WGSL
  // validation if we used the implicit-LOD textureSample variant.
  let _ignore = textureSampleLevel(uTexture, uSampler, vec2<f32>(0.0, 0.0), 0.0);

  // d: 0 at the inner game-edge seam, 1 at the outer canvas edge.
  var d: f32;
  if (sideBandUniforms.uSide < 0.0) {
    d = 1.0 - vSpriteUv.x;
  } else {
    d = vSpriteUv.x;
  }

  let edgeX = select(0.0, 1.0, sideBandUniforms.uSide > 0.0);
  let inwardSign = select(1.0, -1.0, sideBandUniforms.uSide > 0.0);

  // Sample point sits a tiny step inside the game edge. The
  // small d×uMirrorDepth shift is a gentle parallax — too large
  // would re-introduce vertical streaks despite the pre-blur.
  let srcX = edgeX + inwardSign * (0.01 + d * sideBandUniforms.uMirrorDepth);
  let baseUv = vec2<f32>(srcX, vSpriteUv.y);

  // No-content early-out — 8 edge-column taps on the already-blurred
  // source. With pre-averaged values the threshold compares against
  // smoothed colour magnitudes, so it's a reliable signal.
  var maxLum: f32 = 0.0;
  for (var i: i32 = 0; i < 8; i = i + 1) {
    let yT = (f32(i) + 0.5) / 8.0;
    let s = textureSampleLevel(uGameTex, uGameSampler, vec2<f32>(edgeX, yT), 0.0);
    let lum = dot(s.rgb, vec3<f32>(0.299, 0.587, 0.114)) * s.a;
    maxLum = max(maxLum, lum);
  }
  if (maxLum < sideBandUniforms.uThreshold) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  // 5-tap cross micro-smoothing. The source is the bottom of a 4-step
  // downsample pyramid, already a soft photographic blur, so these
  // taps mainly hide bilinear texel stair-steps. uBlurRadius is in
  // pre-blurred-source UV units — even a small value covers a wide
  // game region because the source itself is at 1/16 resolution.
  let r = sideBandUniforms.uBlurRadius * (1.0 + d * 2.0);
  let s0 = textureSampleLevel(uGameTex, uGameSampler, baseUv, 0.0);
  let s1 = textureSampleLevel(uGameTex, uGameSampler, baseUv + vec2<f32>( r, 0.0), 0.0);
  let s2 = textureSampleLevel(uGameTex, uGameSampler, baseUv + vec2<f32>(-r, 0.0), 0.0);
  let s3 = textureSampleLevel(uGameTex, uGameSampler, baseUv + vec2<f32>(0.0,  r), 0.0);
  let s4 = textureSampleLevel(uGameTex, uGameSampler, baseUv + vec2<f32>(0.0, -r), 0.0);
  let color = (s0.rgb * 4.0 + (s1.rgb + s2.rgb + s3.rgb + s4.rgb) * 2.0) / 12.0;

  // Mild vignette so the band fades into the page background rather
  // than cutting hard at the canvas edge.
  let darken = 1.0 - d * 0.3;
  return vec4<f32>(color * darken + _ignore.rgb * 0.0, 1.0);
}
`;

// ── GLSL fallback (WebGL2) ────────────────────────────────────────────
//
// Used when the renderer falls back off WebGPU. Same algorithm as the
// WGSL version; Pixi's filter system synthesizes `uTexture`/`uSampler`
// + `uOutputFrame`/`uOutputTexture` etc. uniforms automatically — we
// only need to declare the custom uniforms + the extra `uGameTex`
// sampler we sample for the side band.
const GL_VERTEX = `
in vec2 aPosition;
out vec2 vSpriteUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vSpriteUv = aPosition;
}
`;

const GL_FRAGMENT = `
precision highp float;
in vec2 vSpriteUv;
out vec4 fragColor;

uniform sampler2D uTexture;
uniform sampler2D uGameTex;
uniform float sideBandUniforms_uSide;
uniform float sideBandUniforms_uMirrorDepth;
uniform float sideBandUniforms_uBlurRadius;
uniform float sideBandUniforms_uThreshold;

void main(void) {
  float d = sideBandUniforms_uSide < 0.0 ? 1.0 - vSpriteUv.x : vSpriteUv.x;
  float edgeX = sideBandUniforms_uSide > 0.0 ? 1.0 : 0.0;
  float inwardSign = sideBandUniforms_uSide > 0.0 ? -1.0 : 1.0;
  float srcX = edgeX + inwardSign * (0.01 + d * sideBandUniforms_uMirrorDepth);
  vec2 baseUv = vec2(srcX, vSpriteUv.y);

  float maxLum = 0.0;
  for (int i = 0; i < 8; i++) {
    float yT = (float(i) + 0.5) / 8.0;
    vec4 s = textureLod(uGameTex, vec2(edgeX, yT), 0.0);
    float lum = dot(s.rgb, vec3(0.299, 0.587, 0.114)) * s.a;
    maxLum = max(maxLum, lum);
  }
  if (maxLum < sideBandUniforms_uThreshold) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float r = sideBandUniforms_uBlurRadius * (1.0 + d * 2.0);
  vec4 s0 = textureLod(uGameTex, baseUv, 0.0);
  vec4 s1 = textureLod(uGameTex, baseUv + vec2( r, 0.0), 0.0);
  vec4 s2 = textureLod(uGameTex, baseUv + vec2(-r, 0.0), 0.0);
  vec4 s3 = textureLod(uGameTex, baseUv + vec2(0.0,  r), 0.0);
  vec4 s4 = textureLod(uGameTex, baseUv + vec2(0.0, -r), 0.0);
  vec3 color = (s0.rgb * 4.0 + (s1.rgb + s2.rgb + s3.rgb + s4.rgb) * 2.0) / 12.0;

  float darken = 1.0 - d * 0.3;
  fragColor = vec4(color * darken + textureLod(uTexture, vec2(0.0), 0.0).rgb * 0.0, 1.0);
}
`;

// ── Program singletons ────────────────────────────────────────────────
//
// Filters MUST share their GpuProgram / GlProgram across instances or
// every `new Filter()` pays a fresh pipeline-compile cost (and leaks
// the prior pipeline on this project's patched wgpu, per
// `feedback_pixi_wgpu_texture_lifetime`). Two `SideBandSpilloverFilter`
// instances exist (one per band); both pull from these cached
// programs.
let cachedGpuProgram: GpuProgram | null = null;
let cachedGlProgram: GlProgram | null = null;
let cachedSamplerStyle: TextureStyle | null = null;

function getGpuProgram(): GpuProgram {
  if (!cachedGpuProgram) {
    cachedGpuProgram = GpuProgram.from({
      vertex: { source: WGSL, entryPoint: "mainVertex" },
      fragment: { source: WGSL, entryPoint: "mainFragment" },
    });
  }
  return cachedGpuProgram;
}

function getGlProgram(): GlProgram {
  if (!cachedGlProgram) {
    cachedGlProgram = GlProgram.from({
      vertex: GL_VERTEX,
      fragment: GL_FRAGMENT,
    });
  }
  return cachedGlProgram;
}

function getSamplerStyle(): TextureStyle {
  if (!cachedSamplerStyle) {
    cachedSamplerStyle = new TextureStyle({
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
      // mipmapFilter pinned to "nearest" because we sample with
      // textureSampleLevel(…, 0.0) only — no mip chain on the RT. A
      // "linear" mipmap filter against a single-level texture trips
      // WebGPU pipeline validation in some configurations.
      mipmapFilter: "nearest",
    });
  }
  return cachedSamplerStyle;
}

/** -1 = left band, +1 = right band. */
export type SideBandSide = -1 | 1;

export interface SideBandSpilloverOptions {
  side: SideBandSide;
  /** game texture rendered to a RenderTexture; sampled for the spillover. */
  gameTexture: TextureSource;
  /**
   * Fraction of the game width (0..1) the band mirrors. At the canvas
   * edge of the band, the shader samples `mirrorDepth` of the way into
   * the game; near the inner seam it samples the game's actual edge.
   */
  mirrorDepth?: number;
  /**
   * Gaussian-blur tap spacing in gameRt UV units (0..1). Multiplied by
   * `(0.3 + 0.7 × d)` inside the shader so the seam stays sharper than
   * the outer edge.
   */
  blurRadius?: number;
  /**
   * Max-luminance threshold (0..1). If the actual edge column of
   * `gameTexture` has nothing brighter than this, the band returns
   * pure black instead of blurring noise.
   */
  threshold?: number;
}

/**
 * Side-band spillover filter — see file header. Allocated ONCE per
 * side at compositor construction; never per frame. Reuse rules per
 * `feedback_pixi_filter_singleton` apply (pipeline + bind group leak
 * on patched wgpu otherwise).
 */
export class SideBandSpilloverFilter extends Filter {
  private readonly uniforms: UniformGroup;

  constructor(options: SideBandSpilloverOptions) {
    const uniforms = new UniformGroup({
      uSide: { value: options.side, type: "f32" },
      // Tiny parallax shift in source UV. Far smaller than the prior
      // mirror-stretch (was 0.12); the LOD averaging does the visual
      // work now, so a bigger value here just reintroduces detail
      // that ripples.
      uMirrorDepth: { value: options.mirrorDepth ?? 0.04, type: "f32" },
      // Micro-smoothing radius in PRE-BLURRED-source UV units. The
      // source is already a 4-step downsample pyramid (~256 source
      // pixels averaged per output pixel), so this value only needs
      // to hide bilinear texel stair-steps on the final mini-texture.
      uBlurRadius: { value: options.blurRadius ?? 0.01, type: "f32" },
      // Threshold for the no-content early-out, evaluated against the
      // already-blurred edge column.
      uThreshold: { value: options.threshold ?? 0.005, type: "f32" },
    });

    super({
      gpuProgram: getGpuProgram(),
      glProgram: getGlProgram(),
      resources: {
        sideBandUniforms: uniforms,
        uGameTex: options.gameTexture,
        uGameSampler: getSamplerStyle(),
      },
    });

    this.uniforms = uniforms;
  }

  /** Replace the source game texture (e.g. after a DPR-driven resize). */
  setGameTexture(source: TextureSource): void {
    this.resources.uGameTex = source;
  }

  /** Live-tune the mirror depth (0..1). */
  setMirrorDepth(value: number): void {
    this.uniforms.uniforms.uMirrorDepth = value;
  }

  /** Live-tune the Gaussian blur radius. */
  setBlurRadius(value: number): void {
    this.uniforms.uniforms.uBlurRadius = value;
  }

  /** Live-tune the no-content luminance threshold. */
  setThreshold(value: number): void {
    this.uniforms.uniforms.uThreshold = value;
  }
}
