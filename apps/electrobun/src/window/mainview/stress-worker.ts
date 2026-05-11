/**
 * Stress test worker — runs the entire Vello + Pixi pipeline inside a
 * DedicatedWorker via OffscreenCanvas. The main thread only owns the
 * <canvas> DOM element + React HUD; everything render-related lives
 * here.
 *
 * Why a worker:
 *   - Each `renderSwfStripRangeAccessorized` / `renderSwfFrame` call
 *     is a synchronous WASM crossing that holds the JS thread for
 *     ~0.5-2ms. At 1500 players × 0.5 anim swaps/sec = 750
 *     renders/sec on the main thread, that compounds with Pixi's
 *     per-frame work and main-thread work for input/HUD. Moving
 *     Vello+Pixi into a worker frees the main thread entirely.
 *   - DevTools no longer profiles the render path — opening the
 *     console doesn't halve FPS.
 *
 * Caveats / design points:
 *   - Workers don't have `requestAnimationFrame`, so we drive the
 *     tick loop with `setInterval(16)`. Pixi's auto-ticker is
 *     stopped after init.
 *   - Vello creates the GPUDevice; Pixi adopts it via `app.init({ gpu })`.
 *     One device, no cross-thread texture handoff needed.
 *   - Stats are posted to main thread at 4Hz so React HUD updates
 *     don't perturb anything.
 */

// MUST be the first import — sets `document`/`window`/etc. polyfills
// before pixi.js evaluates. Without this, Pixi throws
// "document is not defined" during Application.init in a worker.
import "./stress-worker-bootstrap";

import { getCellPosition, getSlopeYOffset } from "@dofus/grid";
import {
  Application,
  Container,
  ExternalSource,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
} from "pixi.js";

import {
  preloadAccessoryBundles,
  resolveAccessoryBundle,
} from "@/game/assets/accessory-resolver";
import {
  type AccessoryRenderEntry,
  freeRenderTexture,
  initVello,
  isSwfBundleLoaded,
  loadSwfBundle,
  renderSwfFrame,
  renderSwfStripRangeAccessorized,
  setPixiRenderer,
  setSwfPlayerColors,
  swfAnimFrameCount,
  swfBundleFrameRate,
  type VelloSwfFrameResult,
  type VelloSwfStripResult,
} from "@/game/render/vello-loader";

// ─── constants ─────────────────────────────────────────────────────

const KNOWN_GFX_IDS = [
  10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91, 100,
  101, 110, 111, 120, 121,
];
const RANDOM_HATS = [1, 2, 5, 7, 10, 15, 20];
const RANDOM_CAPES = [1, 2, 3, 4];
const RANDOM_SHIELDS = [1, 2, 3];

const ANIM_POOL = [
  "staticR",
  "staticL",
  "staticF",
  "staticB",
  "runR",
  "runL",
  "runF",
  "runB",
] as const;
type AnimName = (typeof ANIM_POOL)[number];

const ANIM_SWITCH_PERIOD_MS = 5000;
const SPAWNS_PER_FRAME = 8;
/** Per-player animation frame rate. Dofus character SWFs are
 *  authored at 25-30fps; `swfBundleFrameRate` returns that. To
 *  play at the display refresh rate (one frame per tick = 60fps),
 *  force this constant. Cycle plays ~2-2.4× faster than original
 *  authoring — looks "snappy". */
const PLAYER_ANIM_FPS = 60;
/** Vello rasterization resolution. Higher = sharper rasterization
 *  but more GPU work per render (texture grows with res²). Sprite
 *  scale `1 / RENDER_RESOLUTION` brings the high-res texture back
 *  to stage-logical units; `STAGE_ZOOM` then up-scales the whole
 *  world for display. Bumping RES≥STAGE_ZOOM avoids upscale blur. */
const RENDER_RESOLUTION = 3.0;
/** On-screen zoom factor for the whole world (map + characters).
 *  Independent of RENDER_RESOLUTION so you dial sharpness and size
 *  separately. The stage stays centered on the canvas regardless. */
const STAGE_ZOOM = 3.0;
const TICK_INTERVAL_MS = 1000 / 60;

const MAP_URL = "/assets/data/map-35.json";
/** Tile render resolution — same scale-down trick as
 *  `RENDER_RESOLUTION`. Match it so all rasterized content has
 *  uniform crispness. */
const MAP_BG_ZOOM = 10.0;
const GROUND_BUNDLES = ["g1", "g2"] as const;
const OBJECT_BUNDLES = [
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
] as const;

// ─── types ─────────────────────────────────────────────────────────

interface MapCell {
  id: number;
  active: boolean;
  ground: number;
  layer1: number;
  layer2: number;
  groundLevel: number;
  groundSlope: number;
  groundRot: number;
  groundFlip: boolean;
  layer1Rot: number;
  layer1Flip: boolean;
  layer2Rot?: number;
  layer2Flip: boolean;
}
interface MapData {
  id: number;
  width: number;
  height: number;
  background: number;
  cells: MapCell[];
}

interface StressPlayer {
  id: number;
  gfxId: number;
  c1: number;
  c2: number;
  c3: number;
  accessories: ({ type: number; gfxId: number } | null)[];
  sprite: Sprite;
  anim: AnimName;
  frameIndex: number;
  framesPerSec: number;
  /** Strip render result for the current anim. Replaced on anim
   *  swap; per-tick frame advance is a free Pixi Texture pointer
   *  swap from `currentFrames`. */
  currentStrip: VelloSwfStripResult | null;
  /** Pre-allocated per-frame Texture wrappers sliced from
   *  `currentSource`. Per-tick: `sprite.texture = currentFrames[i]`.
   *  ZERO allocation in the hot path. */
  currentFrames: Texture[];
  currentSource: ExternalSource | null;
  currentTextureId: number;
  lastFrameAdvanceMs: number;
  lastAnimSwitchMs: number;
  rendering: boolean;
}

export interface WorkerStatsPayload {
  spawned: number;
  active: number;
  fps: number;
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  phase: "init" | "preloading" | "loadingMap" | "spawning" | "running";
  tilesGround: number;
  tilesLayer1: number;
  tilesLayer2: number;
  accAttempted: number;
  accResolved: number;
  accMissing: number;
  note: string;
  /** Player Vello renders per second (rolling 1s window). Tells us
   *  the actual sustained render throughput. If this is far below
   *  `players × authoredFps`, we're rate-limited. */
  rendersPerSec: number;
  /** Average length of the player render queue when a tick starts.
   *  > 0 means renders are backing up faster than we drain. */
  queueDepth: number;
  /** Average per-player animation frame rate (frames/sec). This
   *  is the SWF authored fps (`swfBundleFrameRate`) — characters
   *  cycle frames at this rate regardless of the 60fps display
   *  rate. Dofus character SWFs are typically authored at 25fps. */
  playerAnimFps: number;
  /** Player count whose `currentAnimFrameCount > 1` (actually
   *  animating, not stuck on frame 0 of a static* anim). Static
   *  players don't visibly animate even though display is 60fps. */
  walkingPlayers: number;
}

export type WorkerInMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      target: number;
      width: number;
      height: number;
      /** This worker's index in the render pool [0..totalWorkers). */
      workerIndex: number;
      /** Total render workers in the pool (for player sharding). */
      totalWorkers: number;
      /** Only worker 0 renders the map tile layer; others render
       *  only their player subset onto a transparent canvas. */
      renderTiles: boolean;
    }
  | { type: "resize"; width: number; height: number }
  | { type: "shutdown" };

export type WorkerOutMessage =
  | { type: "stats"; payload: Partial<WorkerStatsPayload> }
  | { type: "error"; message: string };

// ─── helpers ───────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}
function randomColor(): number {
  return Math.floor(Math.random() * 0xffffff);
}
function buildRandomLook() {
  const gfxId = pick(KNOWN_GFX_IDS);
  const accessories: ({ type: number; gfxId: number } | null)[] = [
    null,
    null,
    null,
    null,
    null,
  ];
  if (Math.random() < 0.85)
    accessories[1] = { type: 16, gfxId: pick(RANDOM_HATS) };
  if (Math.random() < 0.4)
    accessories[2] = { type: 17, gfxId: pick(RANDOM_CAPES) };
  if (Math.random() < 0.4)
    accessories[4] = { type: 82, gfxId: pick(RANDOM_SHIELDS) };
  return {
    gfxId,
    c1: randomColor(),
    c2: randomColor(),
    c3: randomColor(),
    accessories,
  };
}
function dirSuffix(anim: AnimName): string {
  return anim[anim.length - 1] ?? "S";
}

const PERF_WINDOW = 240;
class FrameStats {
  private samples: number[] = [];
  recordTickMs(dt: number): void {
    this.samples.push(dt);
    if (this.samples.length > PERF_WINDOW) this.samples.shift();
  }
  snapshot(): { fps: number; p50: number; p95: number; p99: number } {
    if (this.samples.length === 0) return { fps: 0, p50: 0, p95: 0, p99: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    const avg = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length);
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
    };
  }
}

function makeTileResolver() {
  const cache = new Map<string, { bundle: string } | null>();
  return (
    bundles: readonly string[],
    tileId: number
  ): { bundle: string } | null => {
    if (tileId === 0) return null;
    const key = `${bundles[0]}:${tileId}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const exportName = String(tileId);
    for (const b of bundles) {
      if (swfAnimFrameCount(b, exportName) > 0) {
        const r = { bundle: b };
        cache.set(key, r);
        return r;
      }
    }
    cache.set(key, null);
    return null;
  };
}

// ─── worker state ──────────────────────────────────────────────────

let app: Application | null = null;
let tickHandle: ReturnType<typeof setInterval> | null = null;
let statsHandle: ReturnType<typeof setInterval> | null = null;
let destroyed = false;
/** Reference to the live `players` array so the shutdown handler
 *  can dispose all WASM character instances. Boot wires this up. */
let liveCharacters: StressPlayer[] = [];

const post = (payload: Partial<WorkerStatsPayload>) => {
  (self as DedicatedWorkerGlobalScope).postMessage({
    type: "stats",
    payload,
  } satisfies WorkerOutMessage);
};

const postError = (message: string) => {
  (self as DedicatedWorkerGlobalScope).postMessage({
    type: "error",
    message,
  } satisfies WorkerOutMessage);
};

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      await boot(
        msg.canvas,
        msg.target,
        msg.width,
        msg.height,
        msg.workerIndex,
        msg.totalWorkers,
        msg.renderTiles
      );
    } else if (msg.type === "resize") {
      app?.renderer.resize(msg.width, msg.height);
    } else if (msg.type === "shutdown") {
      destroyed = true;
      if (tickHandle) clearInterval(tickHandle);
      if (statsHandle) clearInterval(statsHandle);
      // Strip-render path doesn't use persistent character instances
      // — each player owns its own ExternalSource that gets retired
      // via the per-player setTimeout settle in renderPlayerStrip.
      // Worker terminate reclaims everything, no explicit dispose
      // needed here.
      liveCharacters.length = 0;
      try {
        app?.destroy(true, { children: true, texture: true });
      } catch {
        /* */
      }
      app = null;
    }
  } catch (err) {
    postError(err instanceof Error ? err.message : String(err));
  }
};

// ─── boot ──────────────────────────────────────────────────────────

async function boot(
  canvas: OffscreenCanvas,
  target: number,
  width: number,
  height: number,
  workerIndex: number,
  totalWorkers: number,
  renderTiles: boolean
) {
  // This worker's player share. With 500 players + 4 workers each
  // worker owns 125. Sharded by player id modulo totalWorkers so
  // contiguous spawn IDs scatter evenly across workers.
  const myPlayerCount = Math.ceil(target / totalWorkers);
  const ownsPlayer = (id: number) => id % totalWorkers === workerIndex;
  void ownsPlayer; // referenced via myPlayerCount in the spawn loop
  // 1. Vello first — creates the shared GPUDevice via patched wgpu.
  const { gpu } = await initVello();
  if (destroyed) return;

  // 2. Pixi adopts that device on the OffscreenCanvas.
  TextureSource.defaultOptions.scaleMode = "linear";
  TextureSource.defaultOptions.autoGenerateMipmaps = false;
  app = new Application();
  await app.init({
    canvas: canvas as unknown as HTMLCanvasElement,
    width,
    height,
    // Worker 0 paints the solid map background; workers 1..N
    // overlay only their player subset and MUST be transparent
    // so the map underneath shows through.
    backgroundColor: 0x1f2233,
    backgroundAlpha: renderTiles ? 1 : 0,
    resolution: 1,
    autoDensity: false,
    antialias: true,
    preference: "webgpu",
    gpu,
  } as Parameters<Application["init"]>[0]);
  if (destroyed) {
    app.destroy(true);
    app = null;
    return;
  }
  setPixiRenderer(app.renderer);
  // Pixi's auto-ticker uses rAF which doesn't exist in workers — stop
  // it and drive both tick logic and render via setInterval below.
  app.ticker.stop();

  // 3. Layer stack: ground → object1 → players → object2.
  const stage = new Container();
  const groundLayer = new Container();
  const object1Layer = new Container();
  const playersLayer = new Container();
  const object2Layer = new Container();
  app.stage.addChild(stage);
  stage.addChild(groundLayer);
  stage.addChild(object1Layer);
  stage.addChild(playersLayer);
  stage.addChild(object2Layer);
  playersLayer.sortableChildren = true;
  // Zoom the entire world for on-screen display. Sprite x/y are
  // in stage-logical units (1× space); the stage scale up-scales
  // them around the canvas center so the map stays centered.
  stage.scale.set(STAGE_ZOOM, STAGE_ZOOM);
  stage.x = (width * (1 - STAGE_ZOOM)) / 2;
  stage.y = (height * (1 - STAGE_ZOOM)) / 2;

  // 4. Pre-warm bundles. Character + accessory bundles always (each
  //    worker has its own subset of players to render, so each needs
  //    them). Tile bundles only on worker 0 since others don't paint
  //    the map.
  post({ phase: "preloading" });
  const renderer = app.renderer;
  const logLoad = (name: string) =>
    loadSwfBundle(name, `/swf/gfx/${name}.swf`)
      .then((ok) => {
        if (!ok)
          console.warn(`[stress-worker w${workerIndex}] gfx FAILED: ${name}`);
        return ok;
      })
      .catch((err) => {
        console.warn(`[stress-worker w${workerIndex}] gfx THREW: ${name}`, err);
        return false;
      });
  const tileLoadPromises = renderTiles
    ? [...GROUND_BUNDLES.map(logLoad), ...OBJECT_BUNDLES.map(logLoad)]
    : [];
  await Promise.all([
    preloadAccessoryBundles(),
    ...KNOWN_GFX_IDS.map((g) =>
      loadSwfBundle(`sprite-${g}`, `/swf/sprites/${g}.swf`).catch(() => false)
    ),
    ...tileLoadPromises,
  ]);
  if (destroyed) return;
  if (renderTiles) {
    for (const b of [...GROUND_BUNDLES, ...OBJECT_BUNDLES]) {
      if (!isSwfBundleLoaded(b)) {
        console.warn(
          `[stress-worker w${workerIndex}] retrying ${b} sequentially`
        );
        await loadSwfBundle(b, `/swf/gfx/${b}.swf`).catch(() => false);
      }
    }
  }

  // Diagnostic
  const accBundleNames = [
    "acc-a1",
    "acc-a2",
    "acc-a3",
    "acc-a4",
    "acc-a5",
    "acc-a6",
    "acc-a7",
    "acc-a8",
    "acc-default",
    "acc-autres",
  ];
  const loadedAcc = accBundleNames.filter((n) => isSwfBundleLoaded(n));
  console.log(
    "[stress-worker] acc bundles loaded:",
    loadedAcc,
    "of",
    accBundleNames.length
  );

  // 5. Map 35 fetch — every worker reads it for player placement,
  //    even non-tile workers (they need cell coords for spawning).
  post({ phase: "loadingMap" });
  let mapData: MapData | null = null;
  try {
    const res = await fetch(MAP_URL);
    if (res.ok) mapData = (await res.json()) as MapData;
  } catch (e) {
    console.warn(`[stress-worker w${workerIndex}] map-35 fetch failed:`, e);
  }
  if (destroyed) return;
  if (!mapData && renderTiles) post({ note: "map-35.json missing" });

  // 6. Tile rendering — static cache + animated per-frame on-demand.
  interface StaticTileEntry {
    kind: "static";
    texture: Texture;
    anchorX: number;
    anchorY: number;
  }
  interface AnimatedTileEntry {
    kind: "animated";
    bundle: string;
    exportName: string;
    sprites: Sprite[];
    framesPerSec: number;
    frameCount: number;
    currentFrame: number;
    lastAdvanceMs: number;
    currentTexture: Texture;
    currentTextureId: number;
    currentSource: ExternalSource;
    anchorX: number;
    anchorY: number;
  }
  type TileEntry = StaticTileEntry | AnimatedTileEntry;

  const tileCache = new Map<string, TileEntry | null>();
  const animatedTiles: AnimatedTileEntry[] = [];
  const groundResolver = makeTileResolver();
  const objectResolver = makeTileResolver();

  const wrapVelloFrame = (
    result: VelloSwfFrameResult,
    label: string
  ): { tex: Texture; source: ExternalSource } => {
    const source = new ExternalSource({
      resource: result.texture,
      renderer,
      width: result.width,
      height: result.height,
      label,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.scaleMode = "linear";
    source.format = "rgba8unorm";
    source.autoGarbageCollect = false;
    const tex = new Texture({
      source,
      frame: new Rectangle(0, 0, result.width, result.height),
    });
    return { tex, source };
  };

  const ensureTileEntry = (
    bundle: string,
    exportName: string
  ): TileEntry | null => {
    const key = `${bundle}:${exportName}`;
    if (tileCache.has(key)) return tileCache.get(key)!;
    const frameCount = swfAnimFrameCount(bundle, exportName);
    if (frameCount <= 0) {
      tileCache.set(key, null);
      return null;
    }
    if (frameCount === 1) {
      const result = renderSwfFrame(
        bundle,
        exportName,
        0,
        MAP_BG_ZOOM
      ) as VelloSwfFrameResult | null;
      if (!result) {
        tileCache.set(key, null);
        return null;
      }
      const { tex } = wrapVelloFrame(result, `tile:${key}`);
      const entry: StaticTileEntry = {
        kind: "static",
        texture: tex,
        anchorX: result.anchorX,
        anchorY: result.anchorY,
      };
      tileCache.set(key, entry);
      return entry;
    }
    // Animated tile — render first frame, hold its texture handle.
    // Per-tick advancement renders next frame and frees the previous.
    const first = renderSwfFrame(
      bundle,
      exportName,
      0,
      MAP_BG_ZOOM
    ) as VelloSwfFrameResult | null;
    if (!first) {
      tileCache.set(key, null);
      return null;
    }
    const { tex, source } = wrapVelloFrame(first, `tile-anim:${key}#0`);
    const entry: AnimatedTileEntry = {
      kind: "animated",
      bundle,
      exportName,
      sprites: [],
      framesPerSec: swfBundleFrameRate(bundle) || 12,
      frameCount,
      currentFrame: 0,
      lastAdvanceMs: performance.now(),
      currentTexture: tex,
      currentTextureId: first.textureId,
      currentSource: source,
      anchorX: first.anchorX,
      anchorY: first.anchorY,
    };
    tileCache.set(key, entry);
    animatedTiles.push(entry);
    return entry;
  };

  let groundCount = 0;
  let layer1Count = 0;
  let layer2Count = 0;
  const activeWalkable: number[] = [];

  // Tile rendering only happens on worker 0. Other workers still
  // need `activeWalkable` populated for player placement; we walk
  // the cells but skip the actual sprite creation.
  if (mapData && renderTiles) {
    const mapW = mapData.width;
    const mapPxW = (mapW - 1) * 53 + 26.5;
    const mapPxH = (mapData.height * 2 - 1) * 13.5;
    const ox = (width - mapPxW) / 2;
    const oy = (height - mapPxH) / 2;

    const placeTile = (
      entry: TileEntry,
      cell: MapCell,
      container: Container,
      rot: number,
      flip: boolean
    ) => {
      const pos = getCellPosition(cell.id, mapW, cell.groundLevel);
      const initialTex =
        entry.kind === "static" ? entry.texture : entry.currentTexture;
      const sprite = new Sprite(initialTex);
      sprite.anchor.set(0, 0);
      // Anchors come back in TEXTURE pixels (which are
      // MAP_BG_ZOOM× larger than screen pixels). Divide so the
      // sprite's screen-space (0,0) lands on the cell origin.
      sprite.x = ox + pos.x - entry.anchorX / MAP_BG_ZOOM;
      sprite.y = oy + pos.y - entry.anchorY / MAP_BG_ZOOM;
      // Scale down to compensate for the higher render resolution
      // — texture is 3× pixels per axis, but should display at
      // the same on-screen size.
      const tileScale = 1 / MAP_BG_ZOOM;
      sprite.scale.set(tileScale, tileScale);
      if (rot) sprite.rotation = (rot * Math.PI) / 2;
      if (flip) sprite.scale.x = -sprite.scale.x;
      container.addChild(sprite);
      if (entry.kind === "animated") entry.sprites.push(sprite);
    };

    for (const cell of mapData.cells) {
      if (!cell.active) continue;
      if (cell.ground !== 0) {
        const r = groundResolver(GROUND_BUNDLES, cell.ground);
        if (r) {
          const entry = ensureTileEntry(r.bundle, String(cell.ground));
          if (entry) {
            placeTile(
              entry,
              cell,
              groundLayer,
              cell.groundRot,
              cell.groundFlip
            );
            groundCount++;
          }
        }
        activeWalkable.push(cell.id);
      }
      if (cell.layer1 !== 0) {
        const r = objectResolver(OBJECT_BUNDLES, cell.layer1);
        if (r) {
          const entry = ensureTileEntry(r.bundle, String(cell.layer1));
          if (entry) {
            placeTile(
              entry,
              cell,
              object1Layer,
              cell.layer1Rot,
              cell.layer1Flip
            );
            layer1Count++;
          }
        }
      }
      if (cell.layer2 !== 0) {
        const r = objectResolver(OBJECT_BUNDLES, cell.layer2);
        if (r) {
          const entry = ensureTileEntry(r.bundle, String(cell.layer2));
          if (entry) {
            placeTile(
              entry,
              cell,
              object2Layer,
              cell.layer2Rot ?? 0,
              cell.layer2Flip
            );
            layer2Count++;
          }
        }
      }
    }
  }

  // Workers that don't render tiles still need the active-cell pool
  // for player placement. Walk the cells (no sprite creation).
  if (mapData && !renderTiles) {
    for (const cell of mapData.cells) {
      if (cell.active && cell.ground !== 0) activeWalkable.push(cell.id);
    }
  }

  post({
    phase: "spawning",
    tilesGround: groundCount,
    tilesLayer1: layer1Count,
    tilesLayer2: layer2Count,
  });

  // 7. Player spawning + render
  const players: StressPlayer[] = [];
  liveCharacters = players; // exposed for shutdown disposal
  const accStats = { attempted: 0, resolved: 0, missing: 0 };
  // Rolling render-rate window — counts player renders in the last
  // 1000ms so the HUD shows actual sustained throughput.
  const renderTimes: number[] = [];
  let queueDepthSum = 0;
  let queueDepthSamples = 0;
  const frameStats = new FrameStats();

  const mapW = mapData?.width ?? 15;
  const mapPxW = (mapW - 1) * 53 + 26.5;
  const mapPxH = ((mapData?.height ?? 17) * 2 - 1) * 13.5;
  const ox = (width - mapPxW) / 2;
  const oy = (height - mapPxH) / 2;
  const cellPool = activeWalkable.length > 0 ? activeWalkable : [0];

  const spawnOne = (id: number) => {
    const look = buildRandomLook();
    const sprite = new Sprite();
    const cellId = cellPool[Math.floor(Math.random() * cellPool.length)];
    const cell = mapData?.cells.find((c) => c.id === cellId);
    const groundLevel = cell?.groundLevel ?? 7;
    const pos = getCellPosition(cellId, mapW, groundLevel);
    const slopeY = cell ? getSlopeYOffset(cell.groundSlope ?? 1) : 0;
    sprite.anchor.set(0.5, 1.0);
    sprite.x = ox + pos.x;
    sprite.y = oy + pos.y + slopeY;
    sprite.zIndex = cellId;
    // Compensate for the higher Vello render resolution — strip
    // textures are RENDER_RESOLUTION× pixels per axis, sprite
    // scaled down to display at the original on-screen size.
    const playerScale = 1 / RENDER_RESOLUTION;
    sprite.scale.set(playerScale, playerScale);
    playersLayer.addChild(sprite);
    const player: StressPlayer = {
      id,
      ...look,
      sprite,
      anim: pick(ANIM_POOL),
      frameIndex: 0,
      framesPerSec: 25,
      currentStrip: null,
      currentFrames: [],
      currentSource: null,
      currentTextureId: 0,
      lastFrameAdvanceMs: 0,
      lastAnimSwitchMs:
        performance.now() - Math.random() * ANIM_SWITCH_PERIOD_MS,
      rendering: false,
    };
    players.push(player);
    renderQueue.add(player); // initial strip render
  };

  /** Build the resolved accessory list for a player. Walks the
   *  positional 5-slot look, drops anything whose bundle didn't load,
   *  bumps the diagnostic counters. */
  function resolveAccessories(p: StressPlayer): AccessoryRenderEntry[] {
    const out: AccessoryRenderEntry[] = [];
    // Use static animType=0 at create time; the instance handles
    // direction lookup per anim from the dir suffix passed at tick.
    const animType = 0;
    for (let i = 0; i < p.accessories.length; i++) {
      const acc = p.accessories[i];
      if (!acc) continue;
      accStats.attempted++;
      const accBundle = resolveAccessoryBundle(acc.type, acc.gfxId);
      if (!accBundle) {
        accStats.missing++;
        continue;
      }
      accStats.resolved++;
      out.push({
        slot: i,
        bundle: accBundle,
        exportName: `${acc.type}_${acc.gfxId}`,
        animType,
      });
    }
    return out;
  }

  /** Render the current anim's full strip via Vello and pre-allocate
   *  per-frame Pixi Texture wrappers. Anim swap = ONE Vello call +
   *  N free pointer swaps over the next anim cycle. This is the
   *  proven 60fps@800 architecture. */
  async function renderPlayerStrip(p: StressPlayer): Promise<void> {
    if (p.rendering) return;
    p.rendering = true;
    try {
      const bundleName = `sprite-${p.gfxId}`;
      if (!isSwfBundleLoaded(bundleName)) {
        const ok = await loadSwfBundle(
          bundleName,
          `/swf/sprites/${p.gfxId}.swf`
        );
        if (!ok) return;
      }
      // Override the SWF authored fps so animations advance at the
      // display rate (one frame per tick). Without this override
      // characters cycle at their authored 25-30fps and each frame
      // visibly holds for ~2 display ticks — looks like "30fps
      // animation on 60fps display". `swfBundleFrameRate` stays
      // useful for tile bundles (varied 12/40/60 per memory).
      p.framesPerSec = PLAYER_ANIM_FPS;
      let frameCount = swfAnimFrameCount(bundleName, p.anim);
      if (frameCount <= 0) return;
      if (p.anim.startsWith("static")) frameCount = 1;

      const accEntries = resolveAccessories(p);
      setSwfPlayerColors(p.c1, p.c2, p.c3);
      const result = renderSwfStripRangeAccessorized(
        bundleName,
        p.anim,
        0,
        frameCount,
        frameCount,
        RENDER_RESOLUTION,
        accEntries,
        dirSuffix(p.anim),
        false
      );
      if (!result) return;

      const source = new ExternalSource({
        resource: result.texture,
        renderer,
        width: result.width,
        height: result.height,
        label: `stress-char:${p.id}:${p.anim}`,
      });
      source.alphaMode = "no-premultiply-alpha";
      source.scaleMode = "linear";
      source.format = "rgba8unorm";
      source.autoGarbageCollect = false;

      // Pre-allocate per-frame Texture wrappers — zero-alloc hot
      // path for the 60fps display loop.
      const frames: Texture[] = new Array(result.frameCount);
      for (let f = 0; f < result.frameCount; f++) {
        const col = f % result.gridCols;
        const row = Math.floor(f / result.gridCols);
        frames[f] = new Texture({
          source,
          frame: new Rectangle(
            col * result.frameWidth,
            row * result.frameHeight,
            result.frameWidth,
            result.frameHeight
          ),
        });
      }

      // Retire previous strip after settle then free GPU texture
      // (patched wgpu Drop is no-op).
      const oldSource = p.currentSource;
      const oldTextureId = p.currentTextureId;
      if (oldSource) {
        setTimeout(() => {
          try {
            oldSource.destroy();
          } catch {
            /* */
          }
          if (oldTextureId) freeRenderTexture(oldTextureId);
        }, 2 * TICK_INTERVAL_MS);
      }
      p.currentSource = source;
      p.currentStrip = result;
      p.currentTextureId = result.textureId;
      p.currentFrames = frames;
      p.frameIndex = 0;
      p.sprite.texture = frames[0];
    } finally {
      p.rendering = false;
    }
  }

  // Per-player Pixi sprites are added directly to playersLayer.
  // No batch layer texture — restored to the proven config that
  // delivered 60fps@800: each player has its own Pixi Sprite
  // textured by a Vello-rendered strip, and per-tick frame
  // advance is a free Pixi pointer swap.
  const renderQueue = new Set<StressPlayer>();

  let nextId = workerIndex; // start at our shard offset
  let spawnDone = false;
  // Each worker spawns only its share. With 500 players + 4 workers
  // each spawns 125. Stride by totalWorkers so player IDs interleave
  // (player 0, 4, 8 on worker 0; 1, 5, 9 on worker 1; etc.) which
  // also evens out spawn-time GPU pressure.
  const spawnInTick = () => {
    if (spawnDone || destroyed) return;
    if (players.length >= myPlayerCount) {
      playersLayer.sortChildren();
      playersLayer.sortableChildren = false;
      spawnDone = true;
      post({ phase: "running", spawned: players.length });
      return;
    }
    const remaining = myPlayerCount - players.length;
    const batch = Math.min(SPAWNS_PER_FRAME, remaining);
    for (let i = 0; i < batch; i++) {
      spawnOne(nextId);
      nextId += totalWorkers;
    }
    post({ spawned: players.length });
  };

  // 8. Tick + render loop. setInterval drives both because workers
  //    don't have requestAnimationFrame.
  let lastTickMs = performance.now();
  const tick = () => {
    if (destroyed || !app) return;
    const now = performance.now();
    const dt = now - lastTickMs;
    lastTickMs = now;
    frameStats.recordTickMs(dt);

    spawnInTick();

    queueDepthSum += renderQueue.size;
    queueDepthSamples++;

    // Render budget removed — drain the queue every tick and let
    // actual GPU/CPU throughput dictate frame time.

    // Animated tiles — render next frame on demand, swap sprites,
    // free previous GPUTexture after settle.
    for (const at of animatedTiles) {
      if (now - at.lastAdvanceMs < 1000 / at.framesPerSec) continue;
      at.lastAdvanceMs = now;
      at.currentFrame = (at.currentFrame + 1) % at.frameCount;
      const result = renderSwfFrame(
        at.bundle,
        at.exportName,
        at.currentFrame,
        MAP_BG_ZOOM
      ) as VelloSwfFrameResult | null;
      if (!result) continue;
      const { tex, source } = wrapVelloFrame(
        result,
        `tile-anim:${at.bundle}/${at.exportName}#${at.currentFrame}`
      );
      for (const s of at.sprites) s.texture = tex;
      const oldSource = at.currentSource;
      const oldTextureId = at.currentTextureId;
      setTimeout(() => {
        try {
          oldSource.destroy();
        } catch {
          /* */
        }
        freeRenderTexture(oldTextureId);
      }, 2 * TICK_INTERVAL_MS);
      at.currentTexture = tex;
      at.currentSource = source;
      at.currentTextureId = result.textureId;
    }

    // Players: anim swap → queue render. Frame advance → free
    // pointer swap from cached strip Textures.
    const framePeriodFor = (p: StressPlayer) =>
      1000 / Math.max(1, p.framesPerSec);
    for (const p of players) {
      if (now - p.lastAnimSwitchMs >= ANIM_SWITCH_PERIOD_MS) {
        p.anim = pick(ANIM_POOL);
        p.lastAnimSwitchMs = now;
        p.frameIndex = 0;
        renderQueue.add(p);
      }
      if (p.currentStrip && p.currentStrip.frameCount > 1) {
        const period = framePeriodFor(p);
        const dt = now - p.lastFrameAdvanceMs;
        if (dt >= period) {
          // Accumulator-style advance: bump `lastFrameAdvanceMs` by
          // EXACT periods (not `now`) so subframe drift doesn't
          // accumulate. Without this, a 60fps target (period=16.67)
          // against `setInterval(16)` ticks alternates between
          // dt=16 (no advance) and dt=32 (advance, reset to 32),
          // halving effective animation rate to ~30fps.
          const steps = Math.floor(dt / period);
          p.frameIndex = (p.frameIndex + steps) % p.currentStrip.frameCount;
          p.lastFrameAdvanceMs += steps * period;
          const t = p.currentFrames[p.frameIndex];
          if (t) p.sprite.texture = t;
        }
      }
    }

    // Drain the strip-render queue every tick. Each anim-swap
    // render is ~3-5ms; if many swaps coincide a tick may exceed
    // the 16.67ms vsync target and display fps will dip — that's
    // the honest cost of doing the work, not an artificial cap.
    for (const p of renderQueue) {
      void renderPlayerStrip(p);
      renderTimes.push(now);
    }
    renderQueue.clear();
    // Trim renders older than 1s for the rolling rate window.
    const cutoff = now - 1000;
    while (renderTimes.length > 0 && renderTimes[0] < cutoff) {
      renderTimes.shift();
    }

    // Render to OffscreenCanvas (Pixi auto-presents to it).
    app.renderer.render(app.stage);
  };

  tickHandle = setInterval(tick, TICK_INTERVAL_MS);

  // 9. Stats reporting at 4Hz so the React HUD update doesn't perturb
  //    the per-tick cost.
  statsHandle = setInterval(() => {
    const snap = frameStats.snapshot();
    const avgQueue =
      queueDepthSamples > 0 ? queueDepthSum / queueDepthSamples : 0;
    queueDepthSum = 0;
    queueDepthSamples = 0;
    // Per-player anim fps + walking count diagnostic.
    let totalFps = 0;
    let walkingCount = 0;
    let withFps = 0;
    for (const p of players) {
      if (p.framesPerSec > 0) {
        totalFps += p.framesPerSec;
        withFps++;
      }
      if (p.currentStrip && p.currentStrip.frameCount > 1) walkingCount++;
    }
    post({
      active: players.length,
      fps: snap.fps,
      frameMsP50: snap.p50,
      frameMsP95: snap.p95,
      frameMsP99: snap.p99,
      accAttempted: accStats.attempted,
      accResolved: accStats.resolved,
      accMissing: accStats.missing,
      rendersPerSec: renderTimes.length,
      queueDepth: avgQueue,
      playerAnimFps: withFps > 0 ? totalFps / withFps : 0,
      walkingPlayers: walkingCount,
    });
  }, 250);
}
