/**
 * Vello WASM renderer integration.
 *
 * Vello creates the shared `GPUDevice` (via the patched wgpu fork that
 * exposes the raw JS GPUDevice handle). Pixi adopts that same device
 * via `Application.init({ gpu: { adapter, device } })` so both
 * libraries render on ONE WebGPU device against ONE canvas. Vello
 * produces `GPUTexture` handles; Pixi wraps them as `Texture` via
 * `new ExternalSource({ resource: gpuTexture, renderer })` and uses
 * them on `Sprite`s like any other texture.
 *
 * Usage:
 *   const { renderer, gpu } = await initVello();
 *   await pixiApp.init({ gpu, preference: "webgpu" });
 *   const result = renderSwfFrame(bundle, exportName, frame, resolution);
 *   const tex = new Texture({
 *     source: new ExternalSource({ resource: result.texture, renderer: pixiApp.renderer }),
 *   });
 */

import type { Renderer as PixiRenderer } from "pixi.js";
import wasmInit, { VelloRenderer } from "vello-wasm";

import { getRenderWatchdog } from "./render-watchdog";

let renderer: VelloRenderer | null = null;
let maxTextureSize = 8192;
let pixiRenderer: PixiRenderer | null = null;
/**
 * Captured at `initVello()` from the WASM init result. Pixi's
 * `Application.init({ gpu })` consumes this so both libraries share
 * ONE `GPUDevice`. Cleared only on full teardown (Vello has no
 * device-lost recovery path here yet).
 */
let velloGpu: { adapter: GPUAdapter; device: GPUDevice } | null = null;

/**
 * Set of textureIds we've handed out to JS callers that haven't called
 * `freeRenderTexture` yet. Used to keep the watchdog's active-texture
 * counter accurate even when the same id is returned across ticks (the
 * tile pass keeps a persistent target — registering on every render
 * would over-count). The set membership check makes the counter
 * monotonic per logical texture lifetime, not per render call.
 */
const liveRenderTextureIds = new Set<number>();
/**
 * Live AVM1 spell instance ids. Each `createSwfSpellInstance` allocates
 * its own GPU output texture inside the WASM; we track the id so the
 * watchdog can observe both classes of GPU memory uniformly.
 */
const liveSpellInstanceIds = new Set<number>();

/**
 * Initialize the Vello WASM renderer. Vello creates its own
 * `wgpu::Instance` + requests an `Adapter` + `GPUDevice` internally.
 * The patched wgpu fork (`patches/wgpu`) exposes those raw JS
 * `GPUAdapter` / `GPUDevice` handles back through wasm-bindgen so we
 * can hand them to Pixi's `Application.init({ gpu })`. Pixi then
 * renders on the SAME device — no cross-device textures, no DOM
 * compositing of separate canvases.
 *
 * Caller must call `initVello()` BEFORE `pixiApp.init()` so the
 * `{adapter, device}` are available to pass into Pixi.
 */
export async function initVello(wasmUrl?: string): Promise<{
  renderer: VelloRenderer;
  gpu: { adapter: GPUAdapter; device: GPUDevice };
}> {
  // Idempotent: a second call returns the same renderer + gpu. Vello
  // owns its `wgpu::Instance` inside the WASM module, and the loaded
  // bundle set on the JS side (`loadedSwfBundles`) is module-global —
  // re-initializing would create a fresh renderer with no bundles
  // while the JS bundle set still claims they're loaded, silently
  // dropping every subsequent render. Returning the existing handles
  // keeps the two sides in sync across React re-mounts and HMR.
  if (renderer && velloGpu) {
    return { renderer, gpu: velloGpu };
  }

  if (wasmUrl) {
    await wasmInit(wasmUrl);
  } else {
    await wasmInit();
  }

  const result = await VelloRenderer.init();

  renderer = result.renderer as VelloRenderer;
  maxTextureSize = (result.maxTextureSize as number) || 8192;
  velloGpu = {
    adapter: result.adapter as GPUAdapter,
    device: result.device as GPUDevice,
  };

  // Device-loss notification still flows through the watchdog. Vello's
  // `init()` retains the JS GPUDevice on the renderer side; for now we
  // surface loss only when a render call returns false repeatedly. A
  // dedicated WASM hook for `device.lost` could be added later if a
  // sharper signal is needed.

  return { renderer, gpu: velloGpu };
}

/**
 * Get the Vello renderer instance.
 */
export function getVelloRenderer(): VelloRenderer | null {
  return renderer;
}

/**
 * The `{adapter, device}` Vello created — captured at `initVello()`
 * for Pixi to adopt via `Application.init({ gpu: getVelloGpu() })`.
 * Returns `null` if `initVello()` hasn't run yet.
 */
export function getVelloGpu(): {
  adapter: GPUAdapter;
  device: GPUDevice;
} | null {
  return velloGpu;
}

/**
 * Pixi `Renderer` is a process-wide singleton (one Pixi `Application`
 * sharing Vello's `GPUDevice`). Renderers — tile, spell, fighter — all
 * need it to wrap GPU textures as `ExternalSource`. The engine sets it
 * once right after `app.init()`; consumers retrieve it via the getter.
 */
export function setPixiRenderer(r: PixiRenderer): void {
  pixiRenderer = r;
}

export function getPixiRenderer(): PixiRenderer | null {
  return pixiRenderer;
}

export function getMaxTextureSize(): number {
  return maxTextureSize;
}

/**
 * True when the watchdog has tripped emergencyHalt (auto or manual). All
 * render entry points below check this and short-circuit to null when set,
 * so a stalled GPU stops accumulating queue work before the host driver
 * gives up. Callers already handle null gracefully.
 */
function isHalted(): boolean {
  try {
    return getRenderWatchdog().isHalted();
  } catch {
    return false;
  }
}


/** Public read-only view of in-flight Vello-allocated GPU textures. */
export function getLiveRenderTextureCount(): number {
  return liveRenderTextureIds.size + liveSpellInstanceIds.size;
}

/** SWF load queue diagnostics for the HUD. */
export function getSwfLoadStats(): {
  active: number;
  queued: number;
  loaded: number;
} {
  return {
    active: loadingNow,
    queued: loadWaiters.length,
    loaded: loadedSwfBundles.size,
  };
}

/** Internal helper: ensure first-time observation of a textureId is counted. */
function trackRenderTexture(textureId: number, label: string): void {
  if (textureId === 0 || textureId === -1) return;
  if (!liveRenderTextureIds.has(textureId)) {
    liveRenderTextureIds.add(textureId);
    try {
      getRenderWatchdog().registerTextureCreated(label);
    } catch {
      // ignore
    }
  }
}

// ─── SWF bundle API ────────────────────────────────────────────────────────
// Tiles, sprites, spells, icons, and portraits render directly from .swf
// files via swf-spike. The dofasset path is gone — `loadAsset` /
// `renderFrame` / `getAnimationInfo` / `getAnimationMeta` / `freeTexture`
// / `freeAsset` were removed once all consumers migrated to the SWF API.

/** Pre-warmed gfx tile bundles. Loaded once at battlefield boot. */
export const GFX_BUNDLE_NAMES = [
  "g1",
  "g2",
  "o1",
  "o2",
  "o3",
  "o4",
  "o5",
  "o6",
  "o7",
  "o8",
  "o9",
  "o10",
  "o11",
  "o12",
  "cell",
  "tactic",
] as const;

export type GfxBundleName = (typeof GFX_BUNDLE_NAMES)[number];

export interface VelloSwfFrameResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
  /** Position of SWF (0,0) origin within the rendered texture. */
  anchorX: number;
  /** Position of SWF (0,0) origin within the rendered texture. */
  anchorY: number;
}

const loadedSwfBundles = new Set<string>();
/**
 * In-flight load promises by bundle name. Multiple call sites
 * (character-sprite-loader, accessory-resolver, spell-icon-renderer) can
 * race on the same bundle; without this dedup they'd all fetch + decode
 * in parallel and the WASM `loadSwfBundle` would race to insert into the
 * shared bundle map. Coalescing to one promise per name avoids the race
 * AND amortizes the network/decode cost.
 */
const inflightSwfLoads = new Map<string, Promise<boolean>>();

/**
 * Concurrency cap for SWF bundle loading. Boot path dispatches dozens of
 * loads in parallel (gfx prewarm + spell icons + sprite + accessories
 * for the active player). Without a cap, all of them race to fetch +
 * WASM-decode at once — the decode is GPU-adjacent (Vello pre-builds
 * SVG path data into GPU-ready buffers during load), so 30 parallel
 * decodes saturate the WebGPU command queue and trip the macOS
 * WindowServer watchdog (40s no-checkin → kernel-level kill, observed
 * crash 2026-05-06). Cap at 4 — empirically keeps frame times <16ms
 * during boot on M-series and still loads the full asset set in <2s.
 */
const LOAD_CONCURRENCY = 4;
let loadingNow = 0;
const loadWaiters: Array<() => void> = [];

function acquireLoadSlot(): Promise<void> {
  if (loadingNow < LOAD_CONCURRENCY) {
    loadingNow++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => loadWaiters.push(resolve));
}

function releaseLoadSlot(): void {
  loadingNow--;
  const next = loadWaiters.shift();
  if (next) {
    loadingNow++;
    // Give the event loop one tick before resuming the next loader so
    // a long burst doesn't starve other interactive work (input, HUD).
    queueMicrotask(next);
  }
}

/**
 * Load a SWF bundle by name. Default URL is `/swf/gfx/${name}.swf`; pass
 * `url` for non-gfx bundles (sprites, spells, items). Idempotent +
 * concurrency-capped. Multiple callers asking for the same bundle
 * simultaneously share one in-flight promise (no duplicate fetch).
 */
export async function loadSwfBundle(
  name: string,
  url?: string
): Promise<boolean> {
  if (!renderer) {
    throw new Error("Vello not initialized");
  }
  if (loadedSwfBundles.has(name)) {
    return true;
  }
  // Dedup: if another caller is already loading this exact bundle,
  // ride their promise. This is the typical case at boot (player
  // sprite + accessory resolver both want sprite-NN).
  const existing = inflightSwfLoads.get(name);
  if (existing) return existing;

  const promise = (async () => {
    await acquireLoadSlot();
    try {
      // Re-check halt AFTER acquiring the slot. The load queue can be
      // long during boot; the watchdog may have flipped halt while this
      // task was waiting. Skipping the actual fetch+decode under halt
      // is the whole point of the gate — no point spending CPU on
      // bundles whose subsequent renders will return null anyway.
      if (isHalted()) return false;
      const fetchUrl = url ?? `/swf/gfx/${name}.swf`;
      const response = await fetch(fetchUrl);
      if (!response.ok) return false;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (isHalted()) return false;
      const ok = renderer!.loadSwfBundle(name, bytes);
      if (ok) loadedSwfBundles.add(name);
      return ok;
    } finally {
      inflightSwfLoads.delete(name);
      releaseLoadSlot();
    }
  })();

  inflightSwfLoads.set(name, promise);
  return promise;
}

export function isSwfBundleLoaded(name: string): boolean {
  return loadedSwfBundles.has(name);
}

/**
 * Render an exported symbol from a loaded SWF bundle. Returns the GPU
 * texture wrapped with anchor info, or null if the export is missing or the
 * renderer is not ready.
 */
export function renderSwfFrame(
  bundle: string,
  exportName: string,
  frame: number,
  resolution: number
): VelloSwfFrameResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfFrame(bundle, exportName, frame, resolution);
  const r = (result as VelloSwfFrameResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfFrame:${bundle}/${exportName}`);
  return r;
}

/**
 * Render a SWF's ROOT timeline (the main movie stage) at the given frame.
 * Used for SWFs without named exports — `clips/artworks/big/{gfxId}.swf`
 * and `clips/spells/icons/up/{spellId}.swf` place their visible content
 * directly on the root stage rather than declaring named exports.
 * Honors `setSwfPlayerColors` for portraits with applyColor zones.
 */
export function renderSwfRoot(
  bundle: string,
  frame: number,
  resolution: number
): VelloSwfFrameResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfRoot(bundle, frame, resolution);
  const r = (result as VelloSwfFrameResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfRoot:${bundle}`);
  return r;
}

/** Result of `tickSwfCharacterFrame` — a STABLE GPU texture handle
 *  whose pixels were just overwritten with one frame of one anim.
 *  The texture id is constant for the instance's lifetime; JS Pixi
 *  wraps it ONCE via `ExternalSource` and never re-allocates. */
export interface VelloCharacterFrameResult {
  texture: GPUTexture;
  textureId: number;
  /** Constant for the instance — sized at create time. */
  width: number;
  height: number;
  /** SWF (0,0) origin within the texture. */
  anchorX: number;
  anchorY: number;
}

/** Allocate a persistent character render instance. Pre-resolves
 *  accessory bundles, computes worst-case bounds across `seedAnims`,
 *  and allocates ONE GPU texture sized for the worst-case strip.
 *  Subsequent `tickSwfCharacterStrip` calls overwrite the same
 *  texture in place. Returns 0 on failure (bundle missing,
 *  accessories unresolvable, GPU limits exceeded). */
export function createSwfCharacterInstance(
  bundle: string,
  seedAnims: string[],
  accessories: AccessoryRenderEntry[],
  colors: [number, number, number],
  resolution: number,
): number {
  if (!renderer || isHalted()) return 0;
  const accSlots = new Uint32Array(accessories.length);
  const accBundles: string[] = new Array(accessories.length);
  const accExports: string[] = new Array(accessories.length);
  const accAnimTypes = new Uint32Array(accessories.length);
  for (let i = 0; i < accessories.length; i++) {
    accSlots[i] = accessories[i].slot;
    accBundles[i] = accessories[i].bundle;
    accExports[i] = accessories[i].exportName;
    accAnimTypes[i] = accessories[i].animType;
  }
  const id = renderer.createSwfCharacterInstance(
    bundle,
    seedAnims,
    accSlots,
    accBundles,
    accExports,
    accAnimTypes,
    colors[0] >>> 0,
    colors[1] >>> 0,
    colors[2] >>> 0,
    resolution,
  );
  if (id !== 0) {
    try {
      getRenderWatchdog().registerTextureCreated(`swfCharInstance:${bundle}`);
    } catch {
      /* */
    }
  }
  return id;
}

/** Re-render `anim` into the instance's stable output texture and
 *  return the strip layout. The `texture`/`textureId` are STABLE
 *  across calls — JS Pixi only needs to wrap the texture once via
 *  `ExternalSource` at create time and re-slice into per-frame
 *  Textures whenever the layout changes. */
/** Render exactly ONE frame of `anim` at index `frame` into the
 *  instance's stable GPU texture. Returns the (constant) texture
 *  handle + dims. Caller advances `frame` per their own animation
 *  cadence — the per-call cost is one Vello dispatch on a
 *  single-frame scene, NOT a strip. */
export function tickSwfCharacterFrame(
  instanceId: number,
  anim: string,
  frame: number,
  charDirSuffix: string,
  applyBFix: boolean,
): VelloCharacterFrameResult | null {
  if (!renderer || isHalted()) return null;
  const result = renderer.tickSwfCharacterFrame(
    instanceId,
    anim,
    frame,
    charDirSuffix,
    applyBFix,
  );
  return (result as VelloCharacterFrameResult | null) ?? null;
}

/** Free the character instance's AVM state + output GPU texture.
 *  Always call when retiring a character — the patched wgpu Drop is
 *  a no-op so the texture survives until explicitly disposed. */
export function disposeSwfCharacterInstance(instanceId: number): void {
  renderer?.disposeSwfCharacterInstance(instanceId);
}

/** Result of `createWorldLayerTexture` — a viewport-sized GPU
 *  texture that the batched `renderSwfWorldLayer` mutates in place
 *  every tick. JS Pixi wraps it ONCE as an `ExternalSource` and
 *  shows it as a single sprite covering the world layer. */
export interface VelloWorldLayerTexture {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
}

/** Allocate the world-layer texture used by `renderSwfWorldLayer`.
 *  Call once at boot (re-call on viewport resize). */
export function createWorldLayerTexture(
  width: number,
  height: number,
): VelloWorldLayerTexture | null {
  if (!renderer || isHalted()) return null;
  const result = renderer.createWorldLayerTexture(width, height);
  return (result as VelloWorldLayerTexture | null) ?? null;
}

/** Update an instance's current anim + direction. Cheap state
 *  mutation — does not render. Call on anim swap; the next
 *  `renderSwfWorldLayer` will use this anim for the instance. */
export function setSwfCharacterAnim(
  instanceId: number,
  anim: string,
  dirSuffix: string,
  applyBFix: boolean,
): void {
  renderer?.setSwfCharacterAnim(instanceId, anim, dirSuffix, applyBFix);
}

/** Batch render: composes all listed character placements into ONE
 *  Vello scene, dispatches ONCE, writes the result into the
 *  world-layer texture. Returns true on success.
 *
 *  Parallel arrays — `instanceIds[i]` is rendered at frame
 *  `frames[i]` placed at pixel position `(posX[i], posY[i])`.
 *
 *  This is the "batch render" architecture: drops 400 individual
 *  Vello calls per tick to ONE call, eliminating per-call fixed
 *  overhead. After scene-cache warmup each placement is just an
 *  `append()` of a cached scene fragment — essentially memcpy. */
export function renderSwfWorldLayer(
  layerTextureId: number,
  width: number,
  height: number,
  instanceIds: Uint32Array,
  frames: Uint32Array,
  posX: Float32Array,
  posY: Float32Array,
): boolean {
  if (!renderer || isHalted()) return false;
  return renderer.renderSwfWorldLayer(
    layerTextureId,
    width,
    height,
    instanceIds,
    frames,
    posX,
    posY,
  );
}

export interface VelloSpellTickResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
  /** Pixel anchor inside the cast's stable output texture. */
  anchorX: number;
  anchorY: number;
  /** False once AS2 has called `stop()` on the root clip. */
  isPlaying: boolean;
  /** True once AS2 has called `_parent.removeMovieClip()` — JS should
   *  fire `onComplete` and stop ticking. */
  isRemoved: boolean;
  /** Wall-clock tick counter, useful for diagnostics. */
  frame: number;
}

/**
 * Allocate a live AVM1 cast instance for an already-loaded spell SWF
 * bundle. Subsequent host-var sets + `tickSpellFrame` calls reference
 * this id. Returns 0 on failure (bundle missing, degenerate bounds,
 * texture-size cap exceeded).
 */
export function createSwfSpellInstance(
  bundle: string,
  resolution: number
): number {
  if (!renderer || isHalted()) {
    return 0;
  }
  const id = renderer.createSwfSpellInstance(bundle, resolution);
  if (id !== 0 && !liveSpellInstanceIds.has(id)) {
    liveSpellInstanceIds.add(id);
    try {
      getRenderWatchdog().registerTextureCreated(`swfSpellInstance:${bundle}`);
    } catch {
      // ignore
    }
  }
  return id;
}

/** Inject `{x, y}` into the spell's AVM1 root vars (typically
 *  `cellFrom` / `cellTo`). Must be called before the first tick. */
export function setSwfSpellHostCell(
  instanceId: number,
  name: string,
  x: number,
  y: number
): void {
  renderer?.setSwfSpellHostCell(instanceId, name, x, y);
}

/** Inject a numeric host var (typically `level` / `angle`). */
export function setSwfSpellHostNumber(
  instanceId: number,
  name: string,
  value: number
): void {
  renderer?.setSwfSpellHostNumber(instanceId, name, value);
}

/**
 * Tick AVM1 by one frame, render the new state into the cast's
 * pre-allocated output texture. Returns null if the instance id is
 * unknown or rendering failed.
 */
export function tickSwfSpellFrame(
  instanceId: number
): VelloSpellTickResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.tickSwfSpellFrame(instanceId);
  return (result as VelloSpellTickResult | null) ?? null;
}

/** Free the AVM1 cast instance + its GPU texture. */
export function disposeSwfSpellInstance(instanceId: number): void {
  renderer?.disposeSwfSpellInstance(instanceId);
  if (liveSpellInstanceIds.delete(instanceId)) {
    try {
      getRenderWatchdog().registerTextureFreed("swfSpellInstance");
    } catch {
      // ignore
    }
  }
}

export interface VelloSwfSpellStripResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  gridCols: number;
  frameCount: number;
  anchorX: number;
  anchorY: number;
  fps: number;
}

/**
 * Run the AVM1 emulator across a spell SWF's main timeline (longest
 * `DefineSprite`) and pack every tick → render → advance frame into ONE
 * 2D-grid composite texture. Replaces the dofasset spell strip bake —
 * AS2 side-effects (`gotoAndStop`, `_alpha` fades, `_rotation += dx`)
 * drive the pixels at runtime instead of being captured at compile time.
 */
export function renderSwfSpellStrip(
  bundle: string,
  resolution: number
): VelloSwfSpellStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfSpellStrip(bundle, resolution);
  const r = (result as VelloSwfSpellStripResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfSpellStrip:${bundle}`);
  return r;
}

/**
 * Compose a spell hotbar icon by overlaying three flat-fill-tinted SWF
 * symbols (disc + frame + glyph) into ONE Vello dispatch. Mirrors the
 * legacy `tools/asset-pipeline/.../compileSpellIcons.ts` pipeline that
 * pre-baked the same composition into per-spell `.dofasset` files —
 * but applied at render time, no bake step needed.
 *
 * - `backBundle` must hold a SWF with `_spellBackground` + `_spellFrame`
 *   named exports (`/swf/spells/icons/back/<b>.swf`).
 * - `upBundle` is the SWF whose root timeline is the glyph
 *   (`/swf/spells/icons/up/<up>.swf`).
 * - Tints are `0xRRGGBB` packed; the WASM converts each into a flat-fill
 *   `OwnedColorTransform` (RGB ← target, alpha preserved).
 */
export function renderSwfSpellIcon(
  backBundle: string,
  upBundle: string,
  bcRgb: number,
  fcRgb: number,
  pcRgb: number,
  resolution: number
): VelloSwfFrameResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfSpellIcon(
    backBundle,
    upBundle,
    bcRgb,
    fcRgb,
    pcRgb,
    resolution
  );
  const r = (result as VelloSwfFrameResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfSpellIcon:${upBundle}`);
  return r;
}

/**
 * Classify a multi-frame SWF tile sprite as "animated", "random", "slope",
 * or "" (static / unknown). See vello_wasm.d.ts for the underlying rule.
 */
export function swfTileAnimKind(
  bundle: string,
  exportName: string
): "" | "animated" | "random" | "slope" {
  if (!renderer) {
    return "";
  }
  const kind = renderer.swfTileAnimKind(bundle, exportName);
  if (kind === "animated" || kind === "random" || kind === "slope") {
    return kind;
  }
  return "";
}

/** Frames-per-second from the SWF header (12 / 40 / 60 typical). */
export function swfBundleFrameRate(bundle: string): number {
  if (!renderer) {
    return 0;
  }
  return renderer.swfBundleFrameRate(bundle);
}

/** Frame count of the deepest animation reachable from this export. */
export function swfAnimFrameCount(bundle: string, exportName: string): number {
  if (!renderer) {
    return 0;
  }
  return renderer.swfAnimFrameCount(bundle, exportName);
}

/**
 * True if any placement in the export's symbol tree carries a filter
 * (DropShadow / Glow / Blur / ColorMatrix). Filter-bearing exports must
 * skip `renderSwfBundleBatch` — the halo fallback emits many extra
 * renders per filter, and clustering them into one batch scene blows
 * Vello's tile encoder budget and silently drops strokes.
 */
export function swfExportHasFilters(
  bundle: string,
  exportName: string
): boolean {
  if (!renderer) {
    return false;
  }
  return renderer.swfExportHasFilters(bundle, exportName);
}

/**
 * Set the player's three zone colours used by `renderSwfFrame` for the next
 * render. Each value is `0xRRGGBB`; pass `0` to leave a zone untinted.
 */
export function setSwfPlayerColors(c1: number, c2: number, c3: number): void {
  renderer?.setSwfPlayerColors(c1, c2, c3);
}

export interface VelloSwfStripResult {
  texture: GPUTexture;
  textureId: number;
  /** Composite texture's full pixel dims. */
  width: number;
  height: number;
  /** Per-cell pixel dims (uniform across all frames). */
  frameWidth: number;
  frameHeight: number;
  /** Number of cells per row in the 2D grid. */
  gridCols: number;
  /** Number of valid frames (may be less than `requestedFrameCount`). */
  frameCount: number;
  /** Position of the SWF (0,0) origin within each cell — same for all frames. */
  anchorX: number;
  anchorY: number;
}

/**
 * Render `requestedFrameCount` consecutive frames of an export as a 2D-grid
 * strip in ONE Vello dispatch. Caller slices the composite into per-frame
 * Pixi sub-rectangles. Stops at the first degenerate frame.
 */
export function renderSwfStrip(
  bundle: string,
  exportName: string,
  requestedFrameCount: number,
  resolution: number
): VelloSwfStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfStrip(
    bundle,
    exportName,
    requestedFrameCount,
    resolution
  );
  const r = (result as VelloSwfStripResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfStrip:${bundle}/${exportName}`);
  return r;
}

/**
 * Render a contiguous frame window `[start, start + count)` of an export as
 * a 2D-grid strip in ONE Vello dispatch, while keeping per-cell anchors
 * uniform with all other windows of the SAME `totalFrameCount`. Use to
 * split long animations (>~60 frames of typical tile geometry) into
 * multiple chunk textures so each Vello scene stays under the
 * tile-encoder budget — without this, long anims silently drop strokes
 * (per the `Vello tile-encoder overflows` memory note) and stall the
 * prefetch pass for several hundred ms.
 *
 * Pass the same `totalFrameCount` for every chunk of one animation; the
 * Rust side computes the bounds union over that full range so anchor +
 * frame_w/frame_h match across chunks. Per-frame Pixi Textures from
 * different chunks share neither texture nor source but DO land at the
 * exact same world-space anchor — frames at chunk seams animate
 * seamlessly.
 */
export function renderSwfStripRange(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number
): VelloSwfStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfStripRange(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution
  );
  const r = (result as VelloSwfStripResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfStripRange:${bundle}/${exportName}`);
  return r;
}

export interface AccessoryRenderEntry {
  /** AS2 mount slot id matching `applyAccessory(this, slot, side)`. */
  slot: number;
  /** Bundle name where the accessory SWF was loaded. */
  bundle: string;
  /** Export name within that bundle (typically `"<type>_<gfxId>"`). */
  exportName: string;
  /**
   * Animation classification for the character: 0=static, 1=walk,
   * 2=run. Selects which slot-specific direction fallback table the
   * renderer walks. Per-character-frame cycling within the chosen
   * direction is handled by the Rust side; the caller doesn't pick a
   * specific accessory frame.
   */
  animType: number;
}

/**
 * Same as `renderSwfStripRange` but composes accessory SWFs at the
 * base character's body part mount points. Each accessory entry has
 * its own (slot, bundle, exportName, animType). The Rust renderer
 * pulls mounts out of the loaded base bundle's `accessory_mounts`
 * cache (built from `applyAccessory` AS2 calls at SWF load time),
 * matches by slot, and resolves the accessory's frame per character
 * frame using the body part's mount-declared `side` plus the
 * canonical Dofus direction truth table.
 */
export function renderSwfStripRangeAccessorized(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number,
  accessories: AccessoryRenderEntry[],
  /**
   * Direction-suffix character ('R'|'L'|'S'|'F'|'B') the WASM uses
   * for slot-3 (pet) named-export resolution + accessory frame-label
   * lookup. Pulled from the export name's last char (`walkR` → 'R').
   */
  charDirSuffix: string,
  /**
   * True when the caller will follow this render with a JS-side
   * `sprite.scale.x = -1` (canonical Dofus directions 3/4/7 —
   * SW/W/NE). Triggers the bFix body-part X-mirror so accessories
   * with `b_fix=true` mounts (capes, shields) end up on the
   * canonical side after the JS flip is applied.
   */
  applyBFix: boolean
): VelloSwfStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const slots = new Uint32Array(accessories.length);
  const bundles: string[] = [];
  const exports: string[] = [];
  const animTypes = new Uint32Array(accessories.length);
  for (let i = 0; i < accessories.length; i++) {
    slots[i] = accessories[i].slot >>> 0;
    bundles.push(accessories[i].bundle);
    exports.push(accessories[i].exportName);
    animTypes[i] = accessories[i].animType >>> 0;
  }
  const result = renderer.renderSwfStripRangeAccessorized(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution,
    slots,
    bundles,
    exports,
    animTypes,
    charDirSuffix,
    applyBFix
  );
  const r = (result as VelloSwfStripResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfStripAcc:${bundle}/${exportName}`);
  return r;
}

export interface VelloSwfStaticBaseResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

/**
 * Render the STATIC parts of a multi-frame tile export at the FULL
 * animation's union bounds. Returns one texture sized identically to a
 * `renderSwfTileDynamicStripRange` cell, so the two compose
 * pixel-perfectly when stacked at the same anchor. Encodes only depths
 * whose placement data is constant across the timeline AND whose placed
 * character has no multi-frame sub-tree.
 */
export function renderSwfTileStaticBase(
  bundle: string,
  exportName: string,
  totalFrameCount: number,
  resolution: number
): VelloSwfStaticBaseResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfTileStaticBase(
    bundle,
    exportName,
    totalFrameCount,
    resolution
  );
  const r = (result as VelloSwfStaticBaseResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfTileStatic:${bundle}/${exportName}`);
  return r;
}

/**
 * Render the DYNAMIC parts of a multi-frame tile across a contiguous
 * frame range. Output is a strip texture at the FULL animation's union
 * bounds (same canvas size as `renderSwfTileStaticBase`). Each cell
 * contains ONLY the placements whose data varies across frames OR whose
 * placed character has multi-frame sub-trees — static placements are
 * skipped because they already live on the static base.
 */
export function renderSwfTileDynamicStripRange(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number
): VelloSwfStripResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfTileDynamicStripRange(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution
  );
  const r = (result as VelloSwfStripResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfTileDyn:${bundle}/${exportName}`);
  return r;
}

export interface VelloSwfBundleBatchResult {
  texture: GPUTexture;
  textureId: number;
  /** Composite texture's full pixel dims. */
  width: number;
  height: number;
  /** Per-item parallel arrays — index by export position passed in. */
  itemX: Uint32Array;
  itemY: Uint32Array;
  itemW: Uint32Array;
  itemH: Uint32Array;
  itemAnchorX: Float64Array;
  itemAnchorY: Float64Array;
  /** 1 = rendered, 0 = export missing or degenerate bounds. */
  itemValid: Uint8Array;
}

/**
 * Render multiple exports of one bundle at the same frame as a shelf-packed
 * composite in ONE Vello dispatch. Caller groups tiles by bundle and slices
 * the composite into per-tile sub-rectangles using the parallel `item*`
 * arrays.
 */
export function renderSwfBundleBatch(
  bundle: string,
  exports: string[],
  frame: number,
  resolution: number
): VelloSwfBundleBatchResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfBundleBatch(
    bundle,
    exports,
    frame,
    resolution
  );
  const r = (result as VelloSwfBundleBatchResult | null) ?? null;
  if (r) trackRenderTexture(r.textureId, `swfBundleBatch:${bundle}`);
  return r;
}

export interface VelloTilePassResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
}

/**
 * Render an arbitrary set of placements into one output texture in a
 * single Vello dispatch. The new tile-rendering pipeline calls this
 * once per Pixi tick per layer (ground/object1/object2) — no raster
 * cache, no per-frame texture map. Each placement's `matrix` is a
 * 6-element 2D affine `[a, b, c, d, tx, ty]` that maps SWF twip space
 * directly to output pixels.
 *
 * Caller responsibilities:
 *  - Build `bundles` + `exports` as deduplicated string tables (small,
 *    typically ≤14 bundles + ≤50 exports per call).
 *  - `bundleIdx[i]`, `exportIdx[i]`, `frames[i]`, `matrices[i*6 + 0..5]`
 *    must all align (one entry per placement).
 *  - Hold the returned `Texture` until the next tick's render lands;
 *    free the previous texture via `freeRenderTexture(textureId)`.
 */
export function renderTilePass(
  targetWidth: number,
  targetHeight: number,
  bundles: string[],
  exports: string[],
  bundleIdx: Uint32Array,
  exportIdx: Uint32Array,
  frames: Uint32Array,
  matrices: Float32Array
): VelloTilePassResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderTilePass(
    targetWidth,
    targetHeight,
    bundles,
    exports,
    bundleIdx,
    exportIdx,
    frames,
    matrices
  );
  const r = (result as VelloTilePassResult | null) ?? null;
  // The tile pass keeps a persistent target texture across ticks — the
  // same textureId comes back every tick until the size changes. The
  // tracker's set membership check makes registration a one-shot per
  // logical lifetime, so this doesn't double-count steady-state ticks.
  if (r) trackRenderTexture(r.textureId, "tilePass");
  return r;
}

/**
 * Render the unified L3 World layer in one Vello dispatch.
 *
 * Heterogeneous placement-list dispatch matching canonical Object2.
 * Encoding (parallel arrays per placement; length = `kinds.length`):
 *   - `kinds[i]`: 0=tile, 1=char, 2=spell, 3=decal.
 *   - `bundles` + `exports`: dedup'd string tables. Accessory bundles
 *     + exports MUST be added to these tables too.
 *   - `bundleIdx[i]`, `exportIdx[i]`, `frames[i]`: per placement.
 *     For Spell (kind=2), `frames[i]` reuses the slot to carry the
 *     AVM1 instance id.
 *   - `depths[i]`: integer depth key (`cellNum × 100 + sub-offset`).
 *     **Caller MUST sort placements by depth ascending.**
 *   - `matrices`: 6 × n floats (`a, b, c, d, tx, ty`).
 *   - `alphas[i]`: per-placement opacity. <1 wraps in a Vello layer.
 *   - `colorZones`: 3 × n u32s `[c1, c2, c3]` per placement. Sentinel
 *     `0xFFFFFFFF` = absent. Char-only.
 *   - `charDirs[i]`: ASCII direction byte ('R','L','F','B','S').
 *     0 for non-Char.
 *   - `charBFix[i]`: 0/1; non-zero triggers AS2 bFix mirror for
 *     accessories with `b_fix=true` mounts (capes, shields).
 *   - **Accessory CSR layout**: `accOffsets[i]..accOffsets[i+1]`
 *     slices `accSlots / accBundleIdx / accExportIdx / accAnimTypes`.
 *     `accOffsets` length is n+1 (last entry = total accessory count).
 *
 * Static foreground-tile content prepended via `static_world_scene`
 * (built once by `setStaticWorldTiles`). Per-tick dispatch only
 * encodes the dynamic subset on top.
 *
 * Returns the layer's persistent texture handle (stable until target
 * size changes), or null on input mismatch / halted state.
 */
export function renderWorldPass(
  targetWidth: number,
  targetHeight: number,
  kinds: Uint8Array,
  bundles: string[],
  exports: string[],
  bundleIdx: Uint32Array,
  exportIdx: Uint32Array,
  frames: Uint32Array,
  depths: Int32Array,
  matrices: Float32Array,
  alphas: Float32Array,
  colorZones: Uint32Array,
  charDirs: Uint8Array,
  charBFix: Uint8Array,
  accOffsets: Uint32Array,
  accSlots: Uint8Array,
  accBundleIdx: Uint32Array,
  accExportIdx: Uint32Array,
  accAnimTypes: Uint8Array
): VelloTilePassResult | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const r = renderer.renderWorldPass(
    targetWidth,
    targetHeight,
    kinds,
    bundles,
    exports,
    bundleIdx,
    exportIdx,
    frames,
    depths,
    matrices,
    alphas,
    colorZones,
    charDirs,
    charBFix,
    accOffsets,
    accSlots,
    accBundleIdx,
    accExportIdx,
    accAnimTypes
  ) as VelloTilePassResult | null;
  if (r) trackRenderTexture(r.textureId, "worldPass");
  return r;
}

/**
 * Pre-encode the unified L3 World layer's static foreground-tile
 * subset into one cached Vello scene. Called whenever the static
 * set changes (map load, zoom step, tactic-mode toggle); world pass
 * appends it via memcpy on every dispatch. Empty input clears.
 */
export function setStaticWorldTiles(
  bundles: string[],
  exports: string[],
  bundleIdx: Uint32Array,
  exportIdx: Uint32Array,
  frames: Uint32Array,
  matrices: Float32Array
): void {
  if (!renderer) {
    return;
  }
  renderer.setStaticWorldTiles(
    bundles,
    exports,
    bundleIdx,
    exportIdx,
    frames,
    matrices
  );
}

/**
 * Synthetic world-pass benchmark for the M1 architecture gate.
 * Builds a grid of Char + Tile + Spell placements and times one
 * dispatch. JS caller wraps with `performance.now()` to derive
 * dispatch ms — gate criterion before any consumer migration.
 */
export interface WorldPassBenchResult {
  placements: number;
  status: "ok" | "fail";
}

export function renderWorldPassBench(
  nChars: number,
  nTiles: number,
  nSpells: number
): WorldPassBenchResult | null {
  if (!renderer) {
    return null;
  }
  return renderer.renderWorldPassBench(
    nChars,
    nTiles,
    nSpells
  ) as WorldPassBenchResult | null;
}

/**
 * Drop the GPU storage backing a previously-allocated tile-pass texture.
 * Pixi may still hold a reference to the GPUTexture handle until its
 * frame upload finishes, so the GPU storage is released by the wgpu side
 * dropping its `wgpu::Texture` (the JS GPUTexture handle remains valid
 * for the rest of the current Pixi frame).
 */
export function freeRenderTexture(textureId: number): void {
  if (!renderer) {
    return;
  }
  renderer.freeRenderTexture(textureId);
  if (liveRenderTextureIds.delete(textureId)) {
    try {
      getRenderWatchdog().registerTextureFreed("renderTexture");
    } catch {
      // ignore
    }
  }
}

/**
 * Pre-encode every static tile placement into one cached Vello scene
 * inside the renderer. Called whenever the static set changes (map
 * load, zoom step, viewport resize) — never per tick. Subsequent
 * `renderTilePass` calls append this cached scene with a memcpy-cost
 * path, keeping per-frame encoding work proportional to *animated*
 * placements only. Pass empty arrays to clear the cache (teardown).
 */
export function setStaticTilePlacements(
  bundles: string[],
  exports: string[],
  bundleIdx: Uint32Array,
  exportIdx: Uint32Array,
  frames: Uint32Array,
  matrices: Float32Array
): void {
  if (!renderer) {
    return;
  }
  renderer.setStaticTilePlacements(
    bundles,
    exports,
    bundleIdx,
    exportIdx,
    frames,
    matrices
  );
}

/**
 * Path-cache observability.
 * Returns counts + estimated cached bytes for the WASM-side path
 * caches (`tile_render_caches` per-bundle + `tile_subscenes` per
 * `(bundle, export, frame)`). Returns null when the renderer hasn't
 * initialized yet.
 */
export interface PathCacheStats {
  bundleCacheCount: number;
  sceneCacheCount: number;
  sceneBytesEstimate: number;
}

export function getPathCacheStats(): PathCacheStats | null {
  if (!renderer) {
    return null;
  }
  return (
    renderer as unknown as { pathCacheStats(): PathCacheStats }
  ).pathCacheStats();
}

/**
 * Drop both long-lived path caches (per-bundle render cache + scene
 * cache). Use for memory-pressure recovery, or after unloading a
 * bundle whose symbol IDs are about to be reused. Does NOT affect
 * spell instances, the static tile scene, or in-flight GPU textures.
 */
export function clearPathCache(): void {
  if (!renderer) {
    return;
  }
  (renderer as unknown as { clearPathCache(): void }).clearPathCache();
}

// ─── Canvas Surface API (three-canvas migration, Phase 2) ─────────────────
// Each Vello-driven `<canvas>` (ground+Object1, Object2, HUD slices) is
// attached as its own `wgpu::Surface`. Subsequent `renderXxxToSurface`
// dispatches target the swap chain directly — no Pixi `ExternalSource`,
// no GPUTexture extraction. The browser composites the canvases via DOM
// stacking; Vello and Pixi no longer need to share a `GPUDevice`.
//
// Lifecycle:
//   const id = attachCanvasSurface(canvasEl, w, h);  // returns 0 on failure
//   // ...renderTilePassToSurface(id, ...) per tick...
//   configureSurface(id, newW, newH);                // resize / DPR change
//   detachSurface(id);                               // teardown

/**
 * Per-surface labels for watchdog instrumentation. Keyed by surfaceId
 * so detach can report the same label that was registered on attach.
 * Free-form descriptors (e.g. `"battlefield-bottom"`, `"hud-atlas"`,
 * `"spell-icon:1054@48"`) — surfaced in warning logs when the active
 * surface count crosses the threshold.
 */
const surfaceLabels = new Map<number, string>();

/**
 * Attach a `<canvas>` as a Vello render target. The canvas element is
 * consumed by the WASM surface (its WebGPU context is taken over by
 * wgpu). Returns the surface id (≥ 1) used by all subsequent surface
 * APIs, or 0 on failure (invalid size, surface creation error).
 *
 * The surface is configured at the supplied physical dimensions —
 * caller is responsible for DPR multiplication. CSS sizing is independent
 * (canvas attribute width/height = physical pixels; CSS width/height =
 * logical pixels for compositing).
 *
 * The optional `label` is recorded for watchdog diagnostics; it has no
 * runtime semantics. Pair every `attachCanvasSurface` with a
 * `detachSurface` (cache eviction, component unmount, scene teardown)
 * so the watchdog's `surfaceCountActive` returns to baseline.
 */
export function attachCanvasSurface(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  label?: string,
): number {
  if (!renderer) {
    return 0;
  }
  const id = renderer.attachCanvasSurface(canvas, width >>> 0, height >>> 0);
  if (id) {
    surfaceLabels.set(id, label ?? `surface:${id}`);
    try {
      getRenderWatchdog().registerSurfaceAttached(label ?? `surface:${id}`);
    } catch {
      // watchdog not available in test context — best effort.
    }
  }
  return id;
}

/**
 * Reconfigure a previously-attached surface. Use when the host viewport
 * resizes or device pixel ratio changes. Idempotent if dims match the
 * current configuration. No-op on unknown id.
 */
export function configureSurface(
  id: number,
  width: number,
  height: number,
): void {
  if (!renderer) {
    return;
  }
  renderer.configureSurface(id >>> 0, width >>> 0, height >>> 0);
}

/**
 * Drop the surface attachment. Subsequent renders to this id no-op. The
 * underlying `<canvas>` element is released back to the page; the
 * browser GC reclaims it once no DOM references remain.
 */
export function detachSurface(id: number): void {
  if (!renderer) {
    return;
  }
  const normalized = id >>> 0;
  renderer.detachSurface(normalized);
  if (surfaceLabels.has(normalized)) {
    const label = surfaceLabels.get(normalized);
    surfaceLabels.delete(normalized);
    try {
      getRenderWatchdog().registerSurfaceDetached(label);
    } catch {
      // watchdog not available in test context — best effort.
    }
  }
}

/**
 * Render a tile-pass dispatch directly into a canvas surface. Identical
 * scene contract to `renderTilePass` (string-pool encoded placements +
 * cached static_tile_scene + per-cell matrices); the only difference is
 * the destination — the swap chain frame view of `surfaceId`'s canvas
 * instead of an internally-managed off-screen RT.
 *
 * Returns `true` on success, `false` on any failure (unknown surface
 * id, lost surface, render error). Callers can treat `false` like the
 * old `renderTilePass(...) === null` and skip the bind-to-sprite step.
 */
export function renderTilePassToSurface(
  surfaceId: number,
  bundles: string[],
  exports: string[],
  bundleIdx: Uint32Array,
  exportIdx: Uint32Array,
  frames: Uint32Array,
  matrices: Float32Array,
): boolean {
  if (!renderer || isHalted()) {
    return false;
  }
  return renderer.renderTilePassToSurface(
    surfaceId >>> 0,
    bundles,
    exports,
    bundleIdx,
    exportIdx,
    frames,
    matrices,
  );
}

/**
 * Pure-bounds probe for the spell-icon composition. Returns the natural
 * pixel rectangle `{width, height}` at resolution 1 without touching
 * the GPU. Replaces the throwaway-render natural-size discovery — a
 * `symbol_bounds` walk is microseconds vs. the milliseconds of an
 * attach-render-detach roundtrip. Returns null on missing bundle,
 * missing required layers, or degenerate root bounds.
 */
export function swfSpellIconNaturalSize(
  backBundle: string,
  upBundle: string,
): { width: number; height: number } | null {
  if (!renderer) {
    return null;
  }
  const result = renderer.swfSpellIconNaturalSize(backBundle, upBundle);
  return (result as { width: number; height: number } | null) ?? null;
}

/**
 * Pure-bounds probe for an SWF root timeline. Returns `{width, height}`
 * at resolution 1 without touching the GPU. Used by the fighter
 * portrait renderer to size its slot canvas before allocating a Vello
 * paint. Returns null on missing bundle or degenerate bounds.
 */
export function swfRootNaturalSize(
  bundle: string,
  frame: number,
): { width: number; height: number } | null {
  if (!renderer) {
    return null;
  }
  const result = renderer.swfRootNaturalSize(bundle, frame >>> 0);
  return (result as { width: number; height: number } | null) ?? null;
}

/**
 * Render the spell-icon composition (back disc + frame + glyph, each
 * flat-tinted) directly into the surface attached to `surfaceId`'s
 * canvas. Returns the painted natural rectangle `{width, height}` on
 * success, or null on failure. The canvas's CSS sizing is independent
 * (consumer-managed via React).
 */
export function renderSwfSpellIconToSurface(
  surfaceId: number,
  backBundle: string,
  upBundle: string,
  bcRgb: number,
  fcRgb: number,
  pcRgb: number,
  resolution: number,
): { width: number; height: number } | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfSpellIconToSurface(
    surfaceId >>> 0,
    backBundle,
    upBundle,
    bcRgb,
    fcRgb,
    pcRgb,
    resolution,
  );
  return (result as { width: number; height: number } | null) ?? null;
}

/**
 * Render the SWF root timeline directly into the surface attached to
 * `surfaceId`'s canvas. Used for HUD portraits / banner artwork. Returns
 * `{width, height, anchorX, anchorY}` so the React caller can compute
 * intrinsic content positioning.
 */
export function renderSwfRootToSurface(
  surfaceId: number,
  bundle: string,
  frame: number,
  resolution: number,
): {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
} | null {
  if (!renderer || isHalted()) {
    return null;
  }
  const result = renderer.renderSwfRootToSurface(
    surfaceId >>> 0,
    bundle,
    frame >>> 0,
    resolution,
  );
  return (
    (result as {
      width: number;
      height: number;
      anchorX: number;
      anchorY: number;
    } | null) ?? null
  );
}

/**
 * Render a world-pass dispatch (Object2 band: chars + foreground tiles +
 * spells + decals) directly into a canvas surface. Same encoding contract
 * as `renderWorldPass` (kinds + parallel arrays + accessory CSR). Returns
 * `true` on success, `false` on failure.
 */
export function renderWorldPassToSurface(
  surfaceId: number,
  kinds: Uint8Array,
  bundles: string[],
  exports: string[],
  bundleIdx: Uint32Array,
  exportIdx: Uint32Array,
  frames: Uint32Array,
  depths: Int32Array,
  matrices: Float32Array,
  alphas: Float32Array,
  colorZones: Uint32Array,
  charDirs: Uint8Array,
  charBFix: Uint8Array,
  accOffsets: Uint32Array,
  accSlots: Uint8Array,
  accBundleIdx: Uint32Array,
  accExportIdx: Uint32Array,
  accAnimTypes: Uint8Array,
): boolean {
  if (!renderer || isHalted()) {
    return false;
  }
  return renderer.renderWorldPassToSurface(
    surfaceId >>> 0,
    kinds,
    bundles,
    exports,
    bundleIdx,
    exportIdx,
    frames,
    depths,
    matrices,
    alphas,
    colorZones,
    charDirs,
    charBFix,
    accOffsets,
    accSlots,
    accBundleIdx,
    accExportIdx,
    accAnimTypes,
  );
}
