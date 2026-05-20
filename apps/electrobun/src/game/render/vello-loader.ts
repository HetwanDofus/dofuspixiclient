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
 * Resolves the first time `initVello()` finishes wiring up `renderer`
 * + `velloGpu`. Consumers (HUD renderers, minimap, worldmap) `await
 * whenVelloReady()` before issuing the first WASM call instead of
 * checking `getVelloRenderer()` and crashing — the React component
 * tree mounts ahead of the Battlefield's `initVello()` so the gate
 * matters in practice.
 */
let velloReadyResolve: (() => void) | null = null;
const velloReadyPromise = new Promise<void>((res) => {
  velloReadyResolve = res;
});

/**
 * Resolves once `initVello()` has installed the Vello renderer + GPU
 * device on this module. Safe to call before, during, or after
 * `initVello()`: pre-init callers wait, post-init callers see an
 * already-resolved promise. Use this in any code path that touches
 * `loadSwfBundle`, `renderSwfFrame`, … from React (HUD asset
 * renderers, minimap, worldmap) — the React tree mounts ahead of the
 * Battlefield bootstrap.
 */
export function whenVelloReady(): Promise<void> {
  return velloReadyPromise;
}
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
 * The patched wgpu fork (`rust/wgpu`) exposes those raw JS
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

  // Unblock any consumers that called `whenVelloReady()` before
  // initVello finished. Subsequent calls to `whenVelloReady()` see an
  // already-resolved promise (Promise resolution is idempotent).
  velloReadyResolve?.();
  velloReadyResolve = null;

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

/** Just the render-texture-id set size (renderSwfFrame / strips). */
export function getLiveRenderTextureIdCount(): number {
  return liveRenderTextureIds.size;
}

/** Just the AVM1 spell-instance id set size (createSwfSpellInstance). */
export function getLiveSpellInstanceCount(): number {
  return liveSpellInstanceIds.size;
}

/** Loaded SWF bundle names in WASM (per-bundle metadata, not per-texture). */
export function getLoadedSwfBundleCount(): number {
  return loadedSwfBundles.size;
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
 * Enumerate every named export in a loaded SWF bundle. Empty array
 * when the bundle isn't loaded. Used by tools that want to build a
 * content pool from what actually shipped instead of a hand-curated
 * list (e.g. the stress test's accessory picker).
 */
export function swfBundleExports(name: string): string[] {
  if (!renderer) return [];
  if (!loadedSwfBundles.has(name)) return [];
  return renderer.swfBundleExports(name);
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

// ─── Path B body-band rasteriser ──────────────────────────────────────────
// Slices the body display list into Z-ordered bands at accessory-mount
// depths. Each band caches independently of player tint + accessory
// loadout — bots of the same class share the same body strips at steady
// state. See `RENDER_SCALING_PLAN.md`.

export interface VelloSwfBodyBandInfo {
  /** Number of (slot, depth) mounts in this export at frame 0. */
  slotCount: number;
  /** Total Z-ordered bands. Always `slotCount + 1`. Stack bands 0..N-1
   *  bottom-up; the slot at index i sits between band i and band i+1. */
  bandCount: number;
  /** Sorted by depth ascending. */
  slots: Array<{ slot: number; depth: number }>;
}

export function swfBodyBandInfo(
  bundle: string,
  exportName: string,
): VelloSwfBodyBandInfo | null {
  if (!renderer) return null;
  const result = renderer.swfBodyBandInfo(bundle, exportName);
  return (result as VelloSwfBodyBandInfo | null) ?? null;
}

export interface VelloSwfBodyAtlasBand {
  bandIndex: number;
  /** Top-left of this band's sub-rect inside the atlas, pixels. */
  atlasX: number;
  atlasY: number;
}

export interface VelloSwfBodyAtlasResult {
  /** Single colour atlas containing every band's strip. */
  colorTexture: GPUTexture;
  colorTextureId: number;
  /** Single zone-id atlas (same layout as colour). */
  zoneTexture: GPUTexture;
  zoneTextureId: number;
  /** Atlas pixel dimensions. */
  atlasWidth: number;
  atlasHeight: number;
  /** Per-band strip dims inside the atlas (every band is identical). */
  stripWidth: number;
  stripHeight: number;
  /** Per-cell dims inside a band. */
  frameWidth: number;
  frameHeight: number;
  gridCols: number;
  frameCount: number;
  /** Anchor for SWF (0,0) inside a single cell (band-local). */
  anchorX: number;
  anchorY: number;
  bandCount: number;
  slotCount: number;
  /** Sub-rect origin per band (`atlasX`, `atlasY`). */
  bands: VelloSwfBodyAtlasBand[];
  /** Transparent gutter (px) between bands; account for in UVs. */
  bandPadding: number;
}

/**
 * Render ALL Z-ordered bands of a body export into a SINGLE atlas
 * pair (colour + zone-id), bands stacked vertically with transparent
 * padding. Pixel-perfect equivalent to the per-band path; only the
 * texture layout differs. Cuts allocation count from
 * `bandCount × 2` to exactly `2` per (bundle, export, anim).
 */
export function renderSwfBodyAtlas(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  totalFrameCount: number,
  resolution: number,
  applyBFix: boolean,
): VelloSwfBodyAtlasResult | null {
  if (!renderer || isHalted()) return null;
  const result = renderer.renderSwfBodyAtlas(
    bundle,
    exportName,
    start,
    count,
    totalFrameCount,
    resolution,
    applyBFix,
  );
  const r = (result as Record<string, unknown> | null) ?? null;
  if (!r) return null;
  const colorTextureId = Number(r.colorTextureId);
  const zoneTextureId = Number(r.zoneTextureId);
  if (Number.isFinite(colorTextureId)) {
    trackRenderTexture(
      colorTextureId,
      `swfBodyAtlas:${bundle}/${exportName}|color`,
    );
  }
  if (Number.isFinite(zoneTextureId)) {
    trackRenderTexture(
      zoneTextureId,
      `swfBodyAtlas:${bundle}/${exportName}|zone`,
    );
  }
  const rawBands = (r.bands as Array<Record<string, unknown>>) ?? [];
  const bands: VelloSwfBodyAtlasBand[] = rawBands.map((b) => ({
    bandIndex: Number(b.bandIndex),
    atlasX: Number(b.atlasX),
    atlasY: Number(b.atlasY),
  }));
  return {
    colorTexture: r.colorTexture as GPUTexture,
    colorTextureId,
    zoneTexture: r.zoneTexture as GPUTexture,
    zoneTextureId,
    atlasWidth: Number(r.atlasWidth),
    atlasHeight: Number(r.atlasHeight),
    stripWidth: Number(r.stripWidth),
    stripHeight: Number(r.stripHeight),
    frameWidth: Number(r.frameWidth),
    frameHeight: Number(r.frameHeight),
    gridCols: Number(r.gridCols),
    frameCount: Number(r.frameCount),
    anchorX: Number(r.anchorX),
    anchorY: Number(r.anchorY),
    bandCount: Number(r.bandCount),
    slotCount: Number(r.slotCount),
    bands,
    bandPadding: Number(r.bandPadding),
  };
}

export interface VelloSwfAccessoryStripResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
  /** Per sub-frame cell dimensions (uniform across all 3). */
  frameWidth: number;
  frameHeight: number;
  /** Always 3 — accessory cycles `char_frame % 3` per game tick. */
  frameCount: number;
  gridCols: number;
  /** Position of the accessory's (0,0) origin within each cell. */
  anchorX: number;
  anchorY: number;
}

/**
 * Bake an accessory's 3 directional sub-frames into a single
 * 3-wide × 1-tall strip at the accessory's OWN origin. The Pixi
 * compositor positions the sprite per-frame via the body's
 * mount-transform table. Cycle frame at runtime via
 * `frames[(char_frame % 3)]`.
 *
 * `side` defaults to `dir`; pass the body's mount-declared side
 * directly (e.g. `"WR"`) to opt into canonical labelled walking
 * frames for capes/shields.
 */
export function renderSwfAccessoryStrip(
  accBundle: string,
  accExport: string,
  slot: number,
  animType: number,
  dir: string,
  side: string,
  resolution: number,
): VelloSwfAccessoryStripResult | null {
  if (!renderer || isHalted()) return null;
  const result = renderer.renderSwfAccessoryStrip(
    accBundle,
    accExport,
    slot >>> 0,
    animType >>> 0,
    dir,
    side,
    resolution,
  );
  const r = (result as VelloSwfAccessoryStripResult | null) ?? null;
  if (r) {
    trackRenderTexture(
      r.textureId,
      `swfAccStrip:${accBundle}/${accExport}/${dir}/${slot}`,
    );
  }
  return r;
}

/**
 * CPU-only mount-transform extraction. Returns a flat `Float32Array`
 * of length `count * maxSlot * 6` carrying the affine matrix
 * `(a, b, c, d, tx, ty)` at every accessory mount per frame.
 * Translations are in TWIP space; multiply by `resolution / 20` for
 * pixel space. Identity matrix where a slot has no mount in a frame.
 */
export function renderSwfMountTransforms(
  bundle: string,
  exportName: string,
  start: number,
  count: number,
  applyBFix: boolean,
  maxSlot: number,
): Float32Array | null {
  if (!renderer) return null;
  const arr = renderer.renderSwfMountTransforms(
    bundle,
    exportName,
    start >>> 0,
    count >>> 0,
    applyBFix,
    maxSlot >>> 0,
  );
  if (!arr || (arr as Float32Array).length === 0) return null;
  return arr as Float32Array;
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
 * Pure-bounds probe for a named SWF export across `totalFrameCount`
 * frames. Returns the union bounding box in twips (1/20 px), plus the
 * deepest reachable animation end frame. CPU-only walk in WASM. Pass
 * `totalFrameCount: 1` for single-frame banner-view exports
 * (`UI_BannerClockBack`, `UI_BannerCompassArrow`, …) — the result's
 * twip extents give the natural pixel size after `/ 20`.
 */
export function swfStripBounds(
  bundle: string,
  exportName: string,
  totalFrameCount: number,
): {
  minXTwip: number;
  minYTwip: number;
  maxXTwip: number;
  maxYTwip: number;
  animEnd: number;
} | null {
  if (!renderer) {
    return null;
  }
  const result = renderer.swfStripBounds(bundle, exportName, totalFrameCount);
  return (
    (result as {
      minXTwip: number;
      minYTwip: number;
      maxXTwip: number;
      maxYTwip: number;
      animEnd: number;
    } | null) ?? null
  );
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

