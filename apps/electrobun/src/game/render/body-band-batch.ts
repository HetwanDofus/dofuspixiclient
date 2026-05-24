/**
 * Phase 5: instanced body-band rendering.
 *
 * Replaces the per-bot `BodyBandMesh` model. One `BodyBandBatch` per
 * `(body-atlas, band-index)` pair owns:
 *   - a shared unit-quad Geometry (4 verts, 6 indices)
 *   - a per-instance vertex buffer (atlasUV / zones / transform per bot)
 *   - a Shader bound to the body atlas's combined texture
 *   - a Mesh that renders the whole batch in ONE `drawIndexed(6, N)`
 *
 * Per-bot state collapses to `(batch, slotIdx)`. Frame changes, zone
 * changes, and slot-transform changes write 16-80 bytes into the
 * instance buffer and dispatch a partial GPU upload — no per-bot
 * Pixi Mesh maintenance cost.
 *
 * See `RENDER_INSTANCED_BANDS_PLAN.md` for full rationale.
 */

import {
  Buffer,
  BufferUsage,
  Geometry,
  GlProgram,
  GpuProgram,
  Mesh,
  Shader,
  type Texture,
  type TextureSource,
  TextureStyle,
} from "pixi.js";

/**
 * Class-atlas-shape view of the parts the batch needs to compose UVs.
 * Renderer passes a structural object built from `ClassAtlas +
 * VariantInfo`. Decoupling from a concrete `ClassAtlas` type keeps
 * the batch reusable when the renderer wants to feed it a synthetic
 * view (e.g. tests, future per-bot overrides).
 */
export interface AtlasBand {
  readonly bandIndex: number;
  readonly atlasX: number;
  readonly atlasY: number;
}

/** Bytes per instance row. 5 × vec4<f32> = 5 × 16 = 80. */
const BYTES_PER_INSTANCE = 80;
/** Floats per instance row. */
const FLOATS_PER_INSTANCE = 20;
/** Initial instance capacity. Grows 2× on overflow. */
const INITIAL_CAPACITY = 32;

/**
 * Per-instance attribute byte offsets inside the 80-byte row.
 * Matches the WGSL `@location` declarations.
 */
const OFFSET_ATLAS_UV = 0; // float32x4
const OFFSET_ZONE1 = 16; // float32x4
const OFFSET_ZONE2 = 32; // float32x4
const OFFSET_ZONE3 = 48; // float32x4
const OFFSET_TRANSFORM = 64; // float32x4

/**
 * Module-shared NEAREST `TextureStyle` for the zone-id sampling path.
 * The combined body atlas is bound twice (LINEAR + NEAREST samplers)
 * just like the per-bot path. Single shared style instance — Pixi
 * caches GPU samplers by their style options.
 */
let cachedNearestSampler: TextureStyle | null = null;
function getNearestSamplerStyle(): TextureStyle {
  if (cachedNearestSampler) return cachedNearestSampler;
  cachedNearestSampler = new TextureStyle({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    addressModeW: "clamp-to-edge",
    magFilter: "nearest",
    minFilter: "nearest",
    mipmapFilter: "nearest",
  });
  return cachedNearestSampler;
}

// ── WGSL ──────────────────────────────────────────────────────────────────

/**
 * Pixi v8's `GpuMeshAdapter` auto-binds @group(0)/@group(1) iff the
 * variables are named exactly `globalUniforms` and `localUniforms`.
 * We keep those names; `localUniforms.uTransformMatrix` is left as
 * identity (per-instance attributes carry the actual transform).
 */
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
  // Zones flow through as flat-interpolated varyings — they're
  // constant across a quad's 4 verts (per-instance attribute).
  @location(1) vZone1: vec4<f32>,
  @location(2) vZone2: vec4<f32>,
  @location(3) vZone3: vec4<f32>,
};

@vertex
fn mainVertex(
  @location(0) aPosition:  vec2<f32>,   // unit-quad corner: (0,0), (1,0), (1,1), (0,1)
  @location(1) aAtlasUV:   vec4<f32>,   // PER-INSTANCE: (u0,v0,u1,v1) atlas frame sub-rect
  @location(2) aZone1:     vec4<f32>,   // PER-INSTANCE
  @location(3) aZone2:     vec4<f32>,   // PER-INSTANCE
  @location(4) aZone3:     vec4<f32>,   // PER-INSTANCE
  @location(5) aTransform: vec4<f32>,   // PER-INSTANCE: (slotX, slotY, scaledW, scaledH)
) -> VSOut {
  // atlas-pixel position = slot origin + unit-corner × scaled frame dims.
  // aTransform.zw is pre-scaled by the bot's slot-fit factor so we
  // don't need a separate scale uniform — the renderer bakes
  // (frameWidth × scale, frameHeight × scale) into the instance.
  let bodyPx = aTransform.xy + aPosition * aTransform.zw;
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  let world = mvp * vec3<f32>(bodyPx, 1.0);

  var out: VSOut;
  out.position = vec4<f32>(world.xy, 0.0, 1.0);
  // Sub-rect of the body atlas for this instance's current frame.
  out.vUv = vec2<f32>(
    mix(aAtlasUV.x, aAtlasUV.z, aPosition.x),
    mix(aAtlasUV.y, aAtlasUV.w, aPosition.y),
  );
  out.vZone1 = aZone1;
  out.vZone2 = aZone2;
  out.vZone3 = aZone3;
  return out;
}
`;

const FRAGMENT_WGSL = `
@group(2) @binding(0) var uBodyTexLinear:   texture_2d<f32>;
@group(2) @binding(1) var uBodyLinearSamp:  sampler;
@group(2) @binding(2) var uBodyTexNearest:  texture_2d<f32>;
@group(2) @binding(3) var uBodyNearestSamp: sampler;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;

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

fn recolor_to_zone(orig: vec3<f32>, tgt: vec3<f32>) -> vec3<f32> {
  let target_hsl = rgb_to_hsl(tgt);
  let orig_hsl = rgb_to_hsl(orig);
  return hsl_to_rgb(vec3<f32>(target_hsl.x, target_hsl.y, orig_hsl.z));
}

@fragment
fn mainFragment(
  @location(0) vUv:   vec2<f32>,
  @location(1) vZone1: vec4<f32>,
  @location(2) vZone2: vec4<f32>,
  @location(3) vZone3: vec4<f32>,
) -> @location(0) vec4<f32> {
  let sampled = textureSample(uBodyTexLinear, uBodyLinearSamp, vUv);
  let pma_alpha = sampled.a;
  var straight_rgb = vec3<f32>(0.0);
  if (pma_alpha > 0.0001) {
    straight_rgb = sampled.rgb / pma_alpha;
  }
  let nearest = textureSample(uBodyTexNearest, uBodyNearestSamp, vUv);
  let nearest_byte = u32(nearest.a * 255.0 + 0.5);
  let id = i32(nearest_byte & 0x3u);

  var rgb = straight_rgb;
  if (id == 1 && vZone1.a > 0.5) {
    rgb = recolor_to_zone(straight_rgb, vZone1.rgb);
  } else if (id == 2 && vZone2.a > 0.5) {
    rgb = recolor_to_zone(straight_rgb, vZone2.rgb);
  } else if (id == 3 && vZone3.a > 0.5) {
    rgb = recolor_to_zone(straight_rgb, vZone3.rgb);
  }

  let opacity = localUniforms.uColor.a;
  let tinted = rgb * localUniforms.uColor.rgb;
  let alpha_byte = u32(pma_alpha * 255.0 + 0.5) & 0xFCu;
  let body_alpha = f32(alpha_byte) / 252.0;
  let final_alpha = clamp(body_alpha * opacity, 0.0, 1.0);
  return vec4<f32>(tinted * final_alpha, final_alpha);
}
`;

// ── GLSL fallback (WebGL2) ────────────────────────────────────────────────

const VERTEX_GL = `
in vec2 aPosition;
in vec4 aAtlasUV;
in vec4 aZone1;
in vec4 aZone2;
in vec4 aZone3;
in vec4 aTransform;
out vec2 vUv;
flat out vec4 vZone1;
flat out vec4 vZone2;
flat out vec4 vZone3;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  vec2 bodyPx = aTransform.xy + aPosition * aTransform.zw;
  vec3 world = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(bodyPx, 1.0);
  gl_Position = vec4(world.xy, 0.0, 1.0);
  vUv = vec2(
    mix(aAtlasUV.x, aAtlasUV.z, aPosition.x),
    mix(aAtlasUV.y, aAtlasUV.w, aPosition.y)
  );
  vZone1 = aZone1;
  vZone2 = aZone2;
  vZone3 = aZone3;
}
`;

const FRAGMENT_GL = `
precision highp float;
in vec2 vUv;
flat in vec4 vZone1;
flat in vec4 vZone2;
flat in vec4 vZone3;
out vec4 fragColor;

uniform sampler2D uBodyTexLinear;
uniform sampler2D uBodyTexNearest;
uniform vec4 uColor;

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
  vec4 sampled = texture(uBodyTexLinear, vUv);
  float pma_alpha = sampled.a;
  vec3 straight_rgb = vec3(0.0);
  if (pma_alpha > 0.0001) straight_rgb = sampled.rgb / pma_alpha;
  vec4 nearest = texture(uBodyTexNearest, vUv);
  int nearest_byte = int(nearest.a * 255.0 + 0.5);
  int id = nearest_byte & 0x3;
  vec3 rgb = straight_rgb;
  if (id == 1 && vZone1.a > 0.5) rgb = recolor_to_zone(straight_rgb, vZone1.rgb);
  else if (id == 2 && vZone2.a > 0.5) rgb = recolor_to_zone(straight_rgb, vZone2.rgb);
  else if (id == 3 && vZone3.a > 0.5) rgb = recolor_to_zone(straight_rgb, vZone3.rgb);
  vec3 tinted = rgb * uColor.rgb;
  int alpha_byte = int(pma_alpha * 255.0 + 0.5) & 0xFC;
  float body_alpha = float(alpha_byte) / 252.0;
  float final_alpha = clamp(body_alpha * uColor.a, 0.0, 1.0);
  fragColor = vec4(tinted * final_alpha, final_alpha);
}
`;

let cachedGpuProgram: GpuProgram | null = null;
let cachedGlProgram: GlProgram | null = null;

function getGpuProgram(): GpuProgram {
  if (!cachedGpuProgram) {
    cachedGpuProgram = GpuProgram.from({
      vertex: { source: VERTEX_WGSL, entryPoint: "mainVertex" },
      fragment: { source: FRAGMENT_WGSL, entryPoint: "mainFragment" },
      name: "body-band-batch-shader",
    });
  }
  return cachedGpuProgram;
}

function getGlProgram(): GlProgram {
  if (!cachedGlProgram) {
    cachedGlProgram = GlProgram.from({
      vertex: VERTEX_GL,
      fragment: FRAGMENT_GL,
      name: "body-band-batch-shader",
    });
  }
  return cachedGlProgram;
}

// ── Geometry ──────────────────────────────────────────────────────────────

/**
 * Build the shared unit-quad geometry + per-instance buffer. The quad
 * is 4 verts at (0,0), (1,0), (1,1), (0,1) — the vertex shader scales
 * + offsets these by the per-instance transform.
 *
 * The instance buffer is interleaved (one 80-byte row per instance).
 * Five attribute views (aAtlasUV, aZone1, aZone2, aZone3, aTransform)
 * share the same buffer at different byte offsets, all stepping per
 * instance.
 */
function buildBatchGeometry(initialCapacity: number): {
  geometry: Geometry;
  posBuffer: Buffer;
  idxBuffer: Buffer;
  instanceBuffer: Buffer;
} {
  // Unit-quad vertex positions (shared across all instances).
  const positions = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  const posBuffer = new Buffer({
    data: positions,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    label: "body-band-batch-positions",
  });
  const idxBuffer = new Buffer({
    data: indices,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    label: "body-band-batch-indices",
  });

  // Instance buffer: zeroed initially. Each row is 80 bytes (20 floats).
  // Inactive rows have aTransform.zw = 0 → degenerate quad → no fragments.
  const instanceData = new Float32Array(initialCapacity * FLOATS_PER_INSTANCE);
  const instanceBuffer = new Buffer({
    data: instanceData,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    label: "body-band-batch-instances",
  });

  const geometry = new Geometry({
    attributes: {
      aPosition: {
        buffer: posBuffer,
        format: "float32x2",
      },
      aAtlasUV: {
        buffer: instanceBuffer,
        format: "float32x4",
        instance: true,
        offset: OFFSET_ATLAS_UV,
        stride: BYTES_PER_INSTANCE,
      },
      aZone1: {
        buffer: instanceBuffer,
        format: "float32x4",
        instance: true,
        offset: OFFSET_ZONE1,
        stride: BYTES_PER_INSTANCE,
      },
      aZone2: {
        buffer: instanceBuffer,
        format: "float32x4",
        instance: true,
        offset: OFFSET_ZONE2,
        stride: BYTES_PER_INSTANCE,
      },
      aZone3: {
        buffer: instanceBuffer,
        format: "float32x4",
        instance: true,
        offset: OFFSET_ZONE3,
        stride: BYTES_PER_INSTANCE,
      },
      aTransform: {
        buffer: instanceBuffer,
        format: "float32x4",
        instance: true,
        offset: OFFSET_TRANSFORM,
        stride: BYTES_PER_INSTANCE,
      },
    },
    indexBuffer: idxBuffer,
    instanceCount: 0,
  });

  return { geometry, posBuffer, idxBuffer, instanceBuffer };
}

// ── BodyBandBatch ─────────────────────────────────────────────────────────

/**
 * One batched mesh per (body-atlas, band-index). Owns the instance
 * buffer and slot allocator. Per-bot writes go through `setUV` /
 * `setZones` / `setTransform`; releases mark the slot inactive by
 * zeroing `aTransform.zw` (degenerate quad emits no fragments).
 */
export class BodyBandBatch {
  readonly mesh: Mesh<Geometry, Shader>;
  readonly combinedTexture: Texture;
  readonly band: AtlasBand;

  private geometry: Geometry;
  private instanceBuffer: Buffer;
  private instanceData: Float32Array;
  private capacity: number;
  private freeSlots: number[] = [];
  /** Next slot to use when no free slots are available. */
  private highWaterMark: number = 0;
  /** Bytes per row in the GPU instance buffer (matches FLOATS × 4). */
  private readonly stride = BYTES_PER_INSTANCE;
  /** Dirty flag for instance buffer. Set on any setUV/setZones/
   *  setTransform/zeroInstance write; cleared in `flush()` after a
   *  full upload. Pixi v8's `Buffer.update(sizeInBytes?)` only
   *  supports uploads from offset 0, so we batch all writes per
   *  frame into a single `update(highWaterMark × stride)` call. */
  private dirty: boolean = false;

  constructor(combinedTexture: Texture, band: AtlasBand) {
    this.combinedTexture = combinedTexture;
    this.band = band;

    const { geometry, instanceBuffer } = buildBatchGeometry(INITIAL_CAPACITY);
    this.geometry = geometry;
    this.instanceBuffer = instanceBuffer;
    this.instanceData = instanceBuffer.data as Float32Array;
    this.capacity = INITIAL_CAPACITY;

    const shader = new Shader({
      gpuProgram: getGpuProgram(),
      glProgram: getGlProgram(),
      resources: {
        uBodyTexLinear: combinedTexture.source,
        uBodyLinearSamp: combinedTexture.source.style,
        uBodyTexNearest: combinedTexture.source,
        uBodyNearestSamp: getNearestSamplerStyle(),
      },
    });

    this.mesh = new Mesh<Geometry, Shader>({ geometry, shader });
    // All instances live in atlas-pixel coordinates; the mesh itself
    // sits at the root with identity transform. Per-instance attrs
    // carry the positioning.
    this.mesh.position.set(0, 0);
    this.mesh.scale.set(1, 1);
  }

  /** Allocate a fresh instance slot. Grows the buffer if needed. */
  allocate(): number {
    const idx = this.freeSlots.length > 0
      ? (this.freeSlots.pop() as number)
      : this.highWaterMark++;
    if (idx >= this.capacity) {
      this.grow(idx + 1);
    }
    if (idx + 1 > (this.geometry.instanceCount ?? 0)) {
      this.geometry.instanceCount = idx + 1;
    }
    return idx;
  }

  /**
   * Release a slot back to the freelist. The row is zeroed so the
   * instance renders nothing — cheaper than compacting the buffer.
   * `geometry.instanceCount` stays at the high-water mark; degenerate
   * rows cost zero fragment work.
   */
  release(idx: number): void {
    this.zeroInstance(idx);
    this.freeSlots.push(idx);
  }

  /**
   * Total active instances. Used by the renderer to decide when a
   * batch is empty enough to destroy (all slots free + highWaterMark
   * has nothing live above the freelist).
   */
  activeCount(): number {
    return this.highWaterMark - this.freeSlots.length;
  }

  isEmpty(): boolean {
    return this.activeCount() === 0;
  }

  /** True if any setUV/setZones/setTransform/zeroInstance write
   *  happened since the last `flush()`. Used by instrumentation. */
  isDirty(): boolean {
    return this.dirty;
  }

  /** Write atlas UV sub-rect (4 floats). Caller must call `flush()`
   *  before the next render to materialise the change on the GPU. */
  setUV(idx: number, u0: number, v0: number, u1: number, v1: number): void {
    const o = idx * FLOATS_PER_INSTANCE + OFFSET_ATLAS_UV / 4;
    this.instanceData[o] = u0;
    this.instanceData[o + 1] = v0;
    this.instanceData[o + 2] = u1;
    this.instanceData[o + 3] = v1;
    this.dirty = true;
  }

  /**
   * Write three zone colours (12 floats). Each zone is `(r, g, b,
   * active)` with `active = 1` to apply recolour, `active = 0` to
   * leave the SWF's authored palette alone.
   *
   * Packing convention matches the legacy `BodyBandColourZones.pack`:
   *   value === 0 → (0, 0, 0, 0) inactive
   *   else        → (R/255, G/255, B/255, 1) active
   */
  setZones(idx: number, z1: number, z2: number, z3: number): void {
    const o = idx * FLOATS_PER_INSTANCE + OFFSET_ZONE1 / 4;
    BodyBandBatch.packZone(this.instanceData, o, z1);
    BodyBandBatch.packZone(this.instanceData, o + 4, z2);
    BodyBandBatch.packZone(this.instanceData, o + 8, z3);
    this.dirty = true;
  }

  /**
   * Write slot transform (4 floats).
   *
   * @param slotX        atlas-pixel X of the slot's origin (where the
   *                     bot's bbox.min lands)
   * @param slotY        atlas-pixel Y of the slot's origin
   * @param scaledWidth  frame_width × slot-fit scale (pre-multiplied
   *                     so the shader doesn't need a per-batch dim
   *                     uniform)
   * @param scaledHeight frame_height × slot-fit scale
   */
  setTransform(
    idx: number,
    slotX: number,
    slotY: number,
    scaledWidth: number,
    scaledHeight: number,
  ): void {
    const o = idx * FLOATS_PER_INSTANCE + OFFSET_TRANSFORM / 4;
    this.instanceData[o] = slotX;
    this.instanceData[o + 1] = slotY;
    this.instanceData[o + 2] = scaledWidth;
    this.instanceData[o + 3] = scaledHeight;
    this.dirty = true;
  }

  /**
   * Materialise pending instance-data writes to the GPU. The renderer
   * MUST call this before each `composeAll` render pass so per-bot
   * setUV/setZones/setTransform writes since the last flush become
   * visible on the GPU. No-op when the batch is clean.
   *
   * We upload the active range only (`highWaterMark × stride` bytes)
   * — Pixi v8's `Buffer.update(sizeInBytes)` always starts from byte
   * 0 so we can't skip leading instances, but capping the upload
   * length avoids touching the empty tail of the capacity.
   */
  flush(): void {
    if (!this.dirty) return;
    const activeBytes = this.highWaterMark * this.stride;
    if (activeBytes > 0) {
      this.instanceBuffer.update(activeBytes);
    }
    this.dirty = false;
  }

  /** Drop the GPU buffers + Mesh. Caller must have released all slots. */
  destroy(): void {
    try {
      this.mesh.destroy({ children: true });
    } catch {}
    try {
      this.geometry.destroy(true /* destroyBuffers */);
    } catch {}
  }

  // ── private ────────────────────────────────────────────────────────────

  /** Returns the same `TextureSource` we're sampling. Lets the atlas's
   *  batch registry key off `source.uid`. */
  sourceUid(): number {
    return (this.combinedTexture.source as TextureSource & { uid: number })
      .uid;
  }

  /**
   * Grow the instance buffer to fit `minCapacity`. Allocates a new
   * Float32Array at the next power-of-two size, copies existing rows,
   * destroys the old GPU buffer, creates a new one, and re-wires the
   * geometry's attribute views.
   *
   * Amortised O(1) per allocate; rare in steady state.
   */
  private grow(minCapacity: number): void {
    let next = this.capacity * 2;
    while (next < minCapacity) next *= 2;
    const newData = new Float32Array(next * FLOATS_PER_INSTANCE);
    newData.set(this.instanceData);
    this.instanceData = newData;

    // Re-create the GPU buffer (Buffer doesn't expose a "resize"
    // primitive). The new buffer takes over the old buffer's slot in
    // every attribute view, so we have to swap the buffer reference
    // inside the geometry attributes too.
    const old = this.instanceBuffer;
    this.instanceBuffer = new Buffer({
      data: newData,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      label: "body-band-batch-instances",
    });
    // Rewire each attribute to the new buffer. Pixi v8 stores
    // attributes by name; we mutate their `buffer` pointer.
    const attrs = this.geometry.attributes as Record<
      string,
      { buffer?: Buffer }
    >;
    for (const name of [
      "aAtlasUV",
      "aZone1",
      "aZone2",
      "aZone3",
      "aTransform",
    ]) {
      if (attrs[name]) attrs[name].buffer = this.instanceBuffer;
    }
    try {
      old.destroy();
    } catch {}
    this.capacity = next;
  }

  /** Mark a row as a degenerate quad (zero scaled dims → no fragments). */
  private zeroInstance(idx: number): void {
    const o = idx * FLOATS_PER_INSTANCE;
    for (let i = 0; i < FLOATS_PER_INSTANCE; i++) {
      this.instanceData[o + i] = 0;
    }
    this.dirty = true;
  }

  private static packZone(
    out: Float32Array,
    base: number,
    value: number,
  ): void {
    if (value === 0) {
      out[base] = 0;
      out[base + 1] = 0;
      out[base + 2] = 0;
      out[base + 3] = 0;
      return;
    }
    out[base] = ((value >> 16) & 0xff) / 255;
    out[base + 1] = ((value >> 8) & 0xff) / 255;
    out[base + 2] = (value & 0xff) / 255;
    out[base + 3] = 1;
  }
}

// ── Atlas-band UV helper ──────────────────────────────────────────────────

/** Atlas-dim inputs `computeBandFrameUV` consumes from the class atlas. */
export interface AtlasDims {
  readonly atlasWidth: number;
  readonly atlasHeight: number;
}

/** Per-variant layout inputs `computeBandFrameUV` consumes. */
export interface VariantFrameLayout {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly gridCols: number;
}

/**
 * Compute the atlas UV sub-rect (u0, v0, u1, v1) for a given band's
 * cell at `frameIndex`. Class atlas dims drive normalisation; the
 * variant's per-frame layout (frame size + grid cols) drives the
 * column/row stepping inside the variant's sub-rect. `band.atlasX/Y`
 * are absolute pixel positions inside the class atlas.
 */
export function computeBandFrameUV(
  atlasDims: AtlasDims,
  variantLayout: VariantFrameLayout,
  band: AtlasBand,
  frameIndex: number,
): { u0: number; v0: number; u1: number; v1: number } {
  const cols = Math.max(1, variantLayout.gridCols);
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols);
  const cellPx = band.atlasX + col * variantLayout.frameWidth;
  const cellPy = band.atlasY + row * variantLayout.frameHeight;
  return {
    u0: cellPx / atlasDims.atlasWidth,
    v0: cellPy / atlasDims.atlasHeight,
    u1: (cellPx + variantLayout.frameWidth) / atlasDims.atlasWidth,
    v1: (cellPy + variantLayout.frameHeight) / atlasDims.atlasHeight,
  };
}
