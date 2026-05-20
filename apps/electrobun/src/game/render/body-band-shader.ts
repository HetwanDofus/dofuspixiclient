/**
 * Path B body-band mesh shader.
 *
 * Each per-bot Pixi container stacks N `BodyBandMesh`es vertically in
 * Z. Every mesh samples ONE body-band BGRA8 texture (Step 7) and ONE
 * R8 zone-id sidecar texture (Step 8). The shader resolves the zone
 * id at sample time and substitutes the player's HSL tint, so the
 * body bake stays per-class (cached, shared) while the tint stays
 * per-bot (a uniform group).
 *
 * For Step 7 the WGSL fragment is a colour-only pass — sample the
 * body texture, output it directly. Step 8 wires the zone-id texture
 * + HSL substitution.
 *
 * Per-frame swap is `O(1)` via `setFrame(index)`: the geometry's UVs
 * shift to the cell at (col, row) inside the strip. No allocations
 * after construction.
 */

import {
  Buffer,
  BufferUsage,
  Geometry,
  GlProgram,
  GpuProgram,
  Mesh,
  Shader,
  UniformGroup,
} from "pixi.js";

import type { BodyAtlas, BodyAtlasBand } from "@/game/render/character-cache";

/**
 * One bot's HSL zone colours, normalised 0..1 RGB packed in vec4
 * RGBa where `.a` is the "active" flag (1 = recolor this zone, 0 =
 * leave the SWF's authored colour untouched).
 *
 * Path B convention matches V1's `setSwfPlayerColors` (Rust):
 * `0xRRGGBB == 0` means "no override" so canonical class palettes
 * survive untouched. Without this flag the shader would map black
 * targets to S=0 (greyscale) and silently grey-out every fill in
 * the zone.
 */
export class BodyBandColourZones {
  readonly uniformGroup: UniformGroup;

  constructor() {
    this.uniformGroup = new UniformGroup({
      uZone1: { value: new Float32Array([0, 0, 0, 0]), type: "vec4<f32>" },
      uZone2: { value: new Float32Array([0, 0, 0, 0]), type: "vec4<f32>" },
      uZone3: { value: new Float32Array([0, 0, 0, 0]), type: "vec4<f32>" },
    });
  }

  /** Update the player's three zone colours. 0xRRGGBB → 0..1 RGB
   *  with the active flag set; pass 0 to leave a zone untouched. */
  setColours(z1: number, z2: number, z3: number): void {
    const u = this.uniformGroup.uniforms as {
      uZone1: Float32Array;
      uZone2: Float32Array;
      uZone3: Float32Array;
    };
    BodyBandColourZones.pack(u.uZone1, z1);
    BodyBandColourZones.pack(u.uZone2, z2);
    BodyBandColourZones.pack(u.uZone3, z3);
    this.uniformGroup.update();
  }

  private static pack(out: Float32Array, value: number): void {
    if (value === 0) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0; // inactive — shader skips recolor for this zone
      return;
    }
    out[0] = ((value >> 16) & 0xff) / 255;
    out[1] = ((value >> 8) & 0xff) / 255;
    out[2] = (value & 0xff) / 255;
    out[3] = 1; // active
  }
}

// Pixi's GpuMeshAdapter auto-binds @group(0)/(1) iff the variables are
// named exactly `globalUniforms` and `localUniforms` — the flag is set
// in GpuProgram.ts via `layout[0].globalUniforms !== undefined`. Keep
// these names verbatim or Pixi falls back to a path that mismatches
// our bind-group layout.
const VERTEX_WGSL = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) vUv: vec2<f32>,
};

@vertex
fn mainVertex(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUv: vec2<f32>,
) -> VSOut {
  var out: VSOut;
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let world = mvp * vec3<f32>(aPosition, 1.0);
  out.position = vec4<f32>(world.xy, 0.0, 1.0);
  out.vUv = aUv;
  return out;
}
`;

const FRAGMENT_WGSL = `
struct ColourZones {
  // .rgb = target colour; .a = active flag (1 = recolor, 0 = leave
  // the SWF authored fill alone). See \`BodyBandColourZones\` comment.
  uZone1: vec4<f32>,
  uZone2: vec4<f32>,
  uZone3: vec4<f32>,
};

@group(2) @binding(0) var uBodyTex:  texture_2d<f32>;
@group(2) @binding(1) var uBodySamp: sampler;
@group(2) @binding(2) var uZoneTex:  texture_2d<f32>;
@group(2) @binding(3) var uZoneSamp: sampler;
@group(3) @binding(0) var<uniform> zones: ColourZones;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;

// Port of \`rust/swf-spike/src/recolor.rs::rgb_to_hsl\`.
fn rgb_to_hsl(rgb: vec3<f32>) -> vec3<f32> {
  let mx = max(rgb.r, max(rgb.g, rgb.b));
  let mn = min(rgb.r, min(rgb.g, rgb.b));
  let l = (mx + mn) * 0.5;
  if (mx - mn < 0.00001) {
    return vec3<f32>(0.0, 0.0, l);
  }
  let d = mx - mn;
  var s: f32;
  if (l > 0.5) {
    s = d / (2.0 - mx - mn);
  } else {
    s = d / (mx + mn);
  }
  var h: f32;
  if (abs(mx - rgb.r) < 0.00001) {
    var t = (rgb.g - rgb.b) / d;
    if (rgb.g < rgb.b) { t = t + 6.0; }
    h = t / 6.0;
  } else if (abs(mx - rgb.g) < 0.00001) {
    h = ((rgb.b - rgb.r) / d + 2.0) / 6.0;
  } else {
    h = ((rgb.r - rgb.g) / d + 4.0) / 6.0;
  }
  return vec3<f32>(h, s, l);
}

// Port of \`rust/swf-spike/src/recolor.rs::hsl_to_rgb\`.
fn hue2rgb(p: f32, q: f32, t_in: f32) -> f32 {
  var t = t_in;
  if (t < 0.0) { t = t + 1.0; }
  if (t > 1.0) { t = t - 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 0.5)       { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}

fn hsl_to_rgb(hsl: vec3<f32>) -> vec3<f32> {
  let h = hsl.x;
  let s = hsl.y;
  let l = hsl.z;
  if (s < 0.00001) {
    return vec3<f32>(l, l, l);
  }
  var q: f32;
  if (l < 0.5) {
    q = l * (1.0 + s);
  } else {
    q = l + s - l * s;
  }
  let p = 2.0 * l - q;
  let r = hue2rgb(p, q, h + 1.0 / 3.0);
  let g = hue2rgb(p, q, h);
  let b = hue2rgb(p, q, h - 1.0 / 3.0);
  return vec3<f32>(r, g, b);
}

// Port of recolor_to_zone: replace orig's H+S with tgt's, keep orig's
// L. Inputs already 0..1 RGB. ('target' is a WGSL reserved keyword,
// so we use 'tgt'.)
fn recolor_to_zone(orig: vec3<f32>, tgt: vec3<f32>) -> vec3<f32> {
  let target_hsl = rgb_to_hsl(tgt);
  let orig_hsl = rgb_to_hsl(orig);
  return hsl_to_rgb(vec3<f32>(target_hsl.x, target_hsl.y, orig_hsl.z));
}

@fragment
fn mainFragment(
  @location(0) vUv: vec2<f32>,
) -> @location(0) vec4<f32> {
  let colour = textureSample(uBodyTex, uBodySamp, vUv);
  // Sample zone-id with NEAREST so AA-smeared boundaries can't
  // produce intermediate ids. The R channel carries zone_id * 60
  // (60 / 120 / 180 for zones 1 / 2 / 3).
  let zid_r = textureSample(uZoneTex, uZoneSamp, vUv).r;
  let id = i32(zid_r * 255.0 + 0.5) / 60;

  var rgb = colour.rgb;
  if (id == 1 && zones.uZone1.a > 0.5) {
    rgb = recolor_to_zone(colour.rgb, zones.uZone1.rgb);
  } else if (id == 2 && zones.uZone2.a > 0.5) {
    rgb = recolor_to_zone(colour.rgb, zones.uZone2.rgb);
  } else if (id == 3 && zones.uZone3.a > 0.5) {
    rgb = recolor_to_zone(colour.rgb, zones.uZone3.rgb);
  }

  let opacity = localUniforms.uColor.a;
  return vec4<f32>(rgb * localUniforms.uColor.rgb, colour.a * opacity);
}
`;

const VERTEX_GL = `
in vec2 aPosition;
in vec2 aUv;
out vec2 vUv;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  vec3 world = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(world.xy, 0.0, 1.0);
  vUv = aUv;
}
`;

const FRAGMENT_GL = `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uBodyTex;
uniform sampler2D uZoneTex;
uniform vec4 uColor;
// vec4 layout: .rgb = target, .a = active flag (matches WGSL UBO).
uniform vec4 uZone1;
uniform vec4 uZone2;
uniform vec4 uZone3;

vec3 rgb_to_hsl(vec3 rgb) {
  float mx = max(rgb.r, max(rgb.g, rgb.b));
  float mn = min(rgb.r, min(rgb.g, rgb.b));
  float l = (mx + mn) * 0.5;
  if (mx - mn < 0.00001) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = (l > 0.5) ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (abs(mx - rgb.r) < 0.00001) {
    float t = (rgb.g - rgb.b) / d;
    if (rgb.g < rgb.b) t += 6.0;
    h = t / 6.0;
  } else if (abs(mx - rgb.g) < 0.00001) {
    h = ((rgb.b - rgb.r) / d + 2.0) / 6.0;
  } else {
    h = ((rgb.r - rgb.g) / d + 4.0) / 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5)     return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl_to_rgb(vec3 hsl) {
  if (hsl.y < 0.00001) return vec3(hsl.z);
  float q = (hsl.z < 0.5) ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hue2rgb(p, q, hsl.x + 1.0/3.0),
    hue2rgb(p, q, hsl.x),
    hue2rgb(p, q, hsl.x - 1.0/3.0)
  );
}

vec3 recolor_to_zone(vec3 orig, vec3 target) {
  vec3 th = rgb_to_hsl(target);
  vec3 oh = rgb_to_hsl(orig);
  return hsl_to_rgb(vec3(th.x, th.y, oh.z));
}

void main() {
  vec4 colour = texture(uBodyTex, vUv);
  float zid_r = texture(uZoneTex, vUv).r;
  int id = int(zid_r * 255.0 + 0.5) / 60;
  vec3 rgb = colour.rgb;
  if (id == 1 && uZone1.a > 0.5) rgb = recolor_to_zone(colour.rgb, uZone1.rgb);
  else if (id == 2 && uZone2.a > 0.5) rgb = recolor_to_zone(colour.rgb, uZone2.rgb);
  else if (id == 3 && uZone3.a > 0.5) rgb = recolor_to_zone(colour.rgb, uZone3.rgb);
  fragColor = vec4(rgb * uColor.rgb, colour.a * uColor.a);
}
`;

let cachedGpuProgram: GpuProgram | null = null;
let cachedGlProgram: GlProgram | null = null;

function getGpuProgram(): GpuProgram {
  if (!cachedGpuProgram) {
    cachedGpuProgram = GpuProgram.from({
      vertex: { source: VERTEX_WGSL, entryPoint: "mainVertex" },
      fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
      name: "body-band-shader",
    });
  }
  return cachedGpuProgram;
}

function getGlProgram(): GlProgram {
  if (!cachedGlProgram) {
    cachedGlProgram = GlProgram.from({
      vertex: VERTEX_GL,
      fragment: FRAGMENT_GL,
      name: "body-band-shader",
    });
  }
  return cachedGlProgram;
}

/**
 * Build a fresh quad geometry sized to one strip cell. Position
 * vertices are local pixel coords (0..frameWidth, 0..frameHeight);
 * the mesh transform handles world placement. UVs initialise to cell
 * (0, 0); `setFrame()` updates them in-place.
 */
function buildGeometry(frameWidth: number, frameHeight: number): {
  geometry: Geometry;
  posBuffer: Buffer;
  uvBuffer: Buffer;
} {
  const positions = new Float32Array([
    0, 0,
    frameWidth, 0,
    frameWidth, frameHeight,
    0, frameHeight,
  ]);
  const uvs = new Float32Array(8);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const posBuffer = new Buffer({
    data: positions,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    label: "body-band-positions",
  });
  const uvBuffer = new Buffer({
    data: uvs,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    label: "body-band-uvs",
  });
  const idxBuffer = new Buffer({
    data: indices,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    label: "body-band-indices",
  });
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: posBuffer, format: "float32x2" },
      aUv: { buffer: uvBuffer, format: "float32x2" },
    },
    indexBuffer: idxBuffer,
  });
  return { geometry, posBuffer, uvBuffer };
}

function writeQuadPositions(
  positions: Float32Array,
  frameWidth: number,
  frameHeight: number,
): void {
  positions[0] = 0;
  positions[1] = 0;
  positions[2] = frameWidth;
  positions[3] = 0;
  positions[4] = frameWidth;
  positions[5] = frameHeight;
  positions[6] = 0;
  positions[7] = frameHeight;
}

/**
 * Compute UVs for `frameIndex` inside one band's atlas sub-region.
 * The band lives at (atlasX, atlasY) within the larger atlas, and
 * holds its anim frames as a `gridCols × N` cell grid. UVs are
 * normalised against the full atlas dimensions so the same shader
 * + same texture pipeline samples whichever band/frame combination
 * the caller asks for.
 */
function writeAtlasFrameUvs(
  uvs: Float32Array,
  atlas: BodyAtlas,
  band: BodyAtlasBand,
  frameIndex: number,
): void {
  const cols = Math.max(1, atlas.gridCols);
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols);
  const cellPx = band.atlasX + col * atlas.frameWidth;
  const cellPy = band.atlasY + row * atlas.frameHeight;
  const u0 = cellPx / atlas.atlasWidth;
  const v0 = cellPy / atlas.atlasHeight;
  const u1 = (cellPx + atlas.frameWidth) / atlas.atlasWidth;
  const v1 = (cellPy + atlas.frameHeight) / atlas.atlasHeight;
  uvs[0] = u0;
  uvs[1] = v0;
  uvs[2] = u1;
  uvs[3] = v0;
  uvs[4] = u1;
  uvs[5] = v1;
  uvs[6] = u0;
  uvs[7] = v1;
}

/**
 * One body band's Pixi `Mesh`. Owns its geometry + shader; the
 * shader's `colourZones` UBO is supplied externally (per-bot) so
 * 400 bots share the body bake but each gets its own tint.
 */
export class BodyBandMesh {
  readonly mesh: Mesh<Geometry, Shader>;
  private posBuffer: Buffer;
  private posData: Float32Array;
  private uvBuffer: Buffer;
  private uvData: Float32Array;
  private atlas: BodyAtlas;
  private band: BodyAtlasBand;

  constructor(
    atlas: BodyAtlas,
    band: BodyAtlasBand,
    zones: BodyBandColourZones,
  ) {
    this.atlas = atlas;
    this.band = band;
    const { geometry, posBuffer, uvBuffer } = buildGeometry(
      atlas.frameWidth,
      atlas.frameHeight,
    );
    this.posBuffer = posBuffer;
    this.posData = posBuffer.data as Float32Array;
    this.uvBuffer = uvBuffer;
    this.uvData = uvBuffer.data as Float32Array;
    writeAtlasFrameUvs(this.uvData, atlas, band, 0);
    uvBuffer.update();

    const shader = new Shader({
      gpuProgram: getGpuProgram(),
      glProgram: getGlProgram(),
      resources: {
        uBodyTex: atlas.colorTexture.source,
        uBodySamp: atlas.colorTexture.source.style,
        uZoneTex: atlas.zoneTexture.source,
        uZoneSamp: atlas.zoneTexture.source.style,
        zones: zones.uniformGroup,
      },
    });
    this.mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    // Anchor: the atlas's anchorX/Y inside each cell is where SWF
    // (0,0) lives — identical across every band, so all bands of a
    // body align pixel-perfectly when parented to the same container.
    this.mesh.pivot.set(atlas.anchorX, atlas.anchorY);
  }

  /**
   * Swap to a different atlas/band (anim change). Caller has already
   * acquired a ref on `nextAtlas` and released the previous atlas
   * via `CharacterCache.releaseBodyAtlas`.
   */
  setStrip(nextAtlas: BodyAtlas, nextBand: BodyAtlasBand): void {
    this.atlas = nextAtlas;
    this.band = nextBand;
    const shader = this.mesh.shader;
    if (!shader) {
      return;
    }
    const resources = shader.resources;
    resources.uBodyTex = nextAtlas.colorTexture.source;
    resources.uBodySamp = nextAtlas.colorTexture.source.style;
    resources.uZoneTex = nextAtlas.zoneTexture.source;
    resources.uZoneSamp = nextAtlas.zoneTexture.source.style;
    // Anim swaps can change per-frame cell dimensions (static vs
    // walk vs run). Rewrite the vertex quad to the new cell size,
    // or the pixels render compressed (the "squashed sprite" bug).
    writeQuadPositions(this.posData, nextAtlas.frameWidth, nextAtlas.frameHeight);
    this.posBuffer.update();
    this.mesh.pivot.set(nextAtlas.anchorX, nextAtlas.anchorY);
    writeAtlasFrameUvs(this.uvData, nextAtlas, nextBand, 0);
    this.uvBuffer.update();
  }

  /** O(1) per-tick frame swap — rewrites only 8 floats then dirties. */
  setFrame(frameIndex: number): void {
    writeAtlasFrameUvs(this.uvData, this.atlas, this.band, frameIndex);
    this.uvBuffer.update();
  }

  destroy(): void {
    // Pixi v8's Mesh.destroy doesn't recurse into its Geometry or
    // Shader — they're treated as potentially-shared. Our Geometry
    // + per-mesh Shader are exclusive to this mesh, so we have to
    // free them explicitly or every anim swap leaks 3 GPU Buffers
    // (positions, uvs, indices) + 1 Geometry + 1 Shader resource
    // group. At 400 bots × N bands × frequent anim swaps this is
    // the dominant GPU memory leak.
    const geometry = this.mesh.geometry;
    const shader = this.mesh.shader;
    this.mesh.destroy({ children: true });
    try {
      geometry?.destroy(true /* destroyBuffers */);
    } catch {}
    try {
      // destroyPrograms=false — the GpuProgram / GlProgram are
      // module-level singletons shared across every BodyBandMesh.
      shader?.destroy(false);
    } catch {}
  }
}

export const BodyBandShaderInternal = {
  getGpuProgram,
  getGlProgram,
};
