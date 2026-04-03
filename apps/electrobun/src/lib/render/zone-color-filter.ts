/**
 * Custom Pixi.js v8 Filter for per-zone HSL color replacement.
 *
 * Uses a zone mask texture (R=zone1, G=zone2, B=zone3, black=no-zone)
 * to determine which pixels should have their hue/saturation replaced.
 * Accessories render as opaque black in the mask, preventing color bleed.
 */
import { Filter, GpuProgram, Texture } from "pixi.js";

// Single WGSL source with both vertex and fragment entry points,
// matching Pixi.js v8 filter convention (group 0 = pixi globals, group 1 = filter).
const ZONE_COLOR_WGSL = /* wgsl */ `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct ZoneUniforms {
  uZone1HS: vec2<f32>,
  uZone2HS: vec2<f32>,
  uZone3HS: vec2<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

@group(1) @binding(0) var<uniform> zoneUniforms: ZoneUniforms;
@group(1) @binding(1) var uZoneMask: texture_2d<f32>;
@group(1) @binding(2) var uZoneSampler: sampler;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(
    filterVertexPosition(aPosition),
    filterTextureCoord(aPosition),
  );
}

fn rgb2hsl(c: vec3<f32>) -> vec3<f32> {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let l = (mx + mn) * 0.5;
  if (mx == mn) { return vec3(0.0, 0.0, l); }
  let d = mx - mn;
  let s = select(d / (mx + mn), d / (2.0 - mx - mn), l > 0.5);
  var h: f32;
  if (mx == c.r) { h = (c.g - c.b) / d + select(0.0, 6.0, c.g < c.b); }
  else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; }
  else { h = (c.r - c.g) / d + 4.0; }
  h /= 6.0;
  return vec3(h, s, l);
}

fn hue2rgb(p: f32, q: f32, t_in: f32) -> f32 {
  var t = t_in;
  if (t < 0.0) { t += 1.0; }
  if (t > 1.0) { t -= 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 0.5) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}

fn hsl2rgb(hsl: vec3<f32>) -> vec3<f32> {
  if (hsl.y == 0.0) { return vec3(hsl.z); }
  let q = select(hsl.z + hsl.y - hsl.z * hsl.y, hsl.z * (1.0 + hsl.y), hsl.z < 0.5);
  let p = 2.0 * hsl.z - q;
  return vec3(
    hue2rgb(p, q, hsl.x + 1.0 / 3.0),
    hue2rgb(p, q, hsl.x),
    hue2rgb(p, q, hsl.x - 1.0 / 3.0),
  );
}

@fragment
fn mainFragment(
  @location(0) uv: vec2<f32>,
  @builtin(position) position: vec4<f32>,
) -> @location(0) vec4<f32> {
  let color = textureSample(uTexture, uSampler, uv);
  let mask = textureSample(uZoneMask, uZoneSampler, uv);

  // Skip transparent or non-zone pixels (opaque black = no zone)
  let zoneStrength = max(mask.r, max(mask.g, mask.b));
  if (zoneStrength < 0.3) { return color; }

  // Determine zone and target H/S
  var targetHS: vec2<f32>;
  if (mask.r > mask.g && mask.r > mask.b) {
    targetHS = zoneUniforms.uZone1HS;
  } else if (mask.g > mask.r && mask.g > mask.b) {
    targetHS = zoneUniforms.uZone2HS;
  } else {
    targetHS = zoneUniforms.uZone3HS;
  }

  // HSL replace: keep original lightness, use target hue/saturation
  let hsl = rgb2hsl(color.rgb);
  let newRgb = hsl2rgb(vec3(targetHS.x, targetHS.y, hsl.z));
  return vec4(newRgb, color.a);
}
`;

function hexToHsl(hex: number): [number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return [0, 0];
  const d = mx - mn;
  const l = (mx + mn) / 2;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s];
}

export class ZoneColorFilter extends Filter {
  constructor(zoneMaskTexture: Texture) {
    const gpuProgram = GpuProgram.from({
      vertex: {
        source: ZONE_COLOR_WGSL,
        entryPoint: "mainVertex",
      },
      fragment: {
        source: ZONE_COLOR_WGSL,
        entryPoint: "mainFragment",
      },
    });

    super({
      gpuProgram,
      resources: {
        zoneUniforms: {
          uZone1HS: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
          uZone2HS: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
          uZone3HS: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
        },
        uZoneMask: zoneMaskTexture.source,
        uZoneSampler: zoneMaskTexture.source.style,
      },
    });
  }

  /** Set the 3 target zone colors as 0xRRGGBB values. -1 = no replacement. */
  setColors(color1: number, color2: number, color3: number): void {
    const [h1, s1] = color1 >= 0 ? hexToHsl(color1) : [0, 0];
    const [h2, s2] = color2 >= 0 ? hexToHsl(color2) : [0, 0];
    const [h3, s3] = color3 >= 0 ? hexToHsl(color3) : [0, 0];

    const u = this.resources.zoneUniforms.uniforms;
    u.uZone1HS[0] = h1; u.uZone1HS[1] = s1;
    u.uZone2HS[0] = h2; u.uZone2HS[1] = s2;
    u.uZone3HS[0] = h3; u.uZone3HS[1] = s3;
  }
}
