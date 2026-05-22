/**
 * "Fée d'artifice invocatrice de cœurs" — Dofus 1.29 heart firework.
 *
 * AVM1-driven: each E press allocates a live spell instance
 * (`createSwfSpellInstance` over `clips/items/74/32.swf`) whose AS2
 * runs frame-by-frame via `tickSwfSpellFrame`. The Vello-side renders
 * each tick into the cast's shared GPUTexture, which we wrap as a
 * Pixi `ExternalSource` so a single Pixi sprite shows the live AS2
 * mutations. The cast self-disposes when AS2 calls
 * `_parent.removeMovieClip()` (isRemoved=true) or after a safety
 * timeout.
 */
import {
  type Application,
  type Container,
  ExternalSource,
  type Renderer,
  Sprite,
  Texture,
  Ticker,
} from "pixi.js";

import {
  createSwfSpellInstance,
  disposeSwfSpellInstance,
  isSwfBundleLoaded,
  loadSwfBundle,
  tickSwfSpellFrame,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("FeeCoeur");

const BUNDLE_NAME = "fee-coeur";
const BUNDLE_URL = "/swf/items/74/32.swf";
const RESOLUTION = 4;
/** Safety cap — if AS2 never calls removeMovieClip we still tear down. */
const MAX_LIFETIME_MS = 6000;

let bundleReady: Promise<boolean> | null = null;

async function ensureBundle(): Promise<boolean> {
  if (isSwfBundleLoaded(BUNDLE_NAME)) return true;
  if (bundleReady) return bundleReady;
  bundleReady = (async () => {
    log.info(`loading bundle ${BUNDLE_URL}`);
    const ok = await loadSwfBundle(BUNDLE_NAME, BUNDLE_URL);
    if (!ok) log.warn(`failed to load ${BUNDLE_URL}`);
    return ok;
  })();
  try {
    return await bundleReady;
  } finally {
    bundleReady = null;
  }
}

interface LiveCast {
  instanceId: number;
  sprite: Sprite;
  source: ExternalSource | null;
  spawnMs: number;
  worldX: number;
  worldY: number;
}

const active: LiveCast[] = [];
let tickerCb: ((t: Ticker) => void) | null = null;

function ensureTicker(renderer: Renderer): void {
  if (tickerCb) return;
  tickerCb = () => {
    if (active.length === 0) return;
    const now = performance.now();
    for (let i = active.length - 1; i >= 0; i--) {
      const cast = active[i];
      const r = tickSwfSpellFrame(cast.instanceId);
      if (!r || r.isRemoved || now - cast.spawnMs > MAX_LIFETIME_MS) {
        cast.sprite.parent?.removeChild(cast.sprite);
        cast.sprite.destroy();
        cast.source?.destroy();
        disposeSwfSpellInstance(cast.instanceId);
        active.splice(i, 1);
        continue;
      }
      // First non-null tick — adopt the GPUTexture into Pixi.
      if (!cast.source) {
        const source = new ExternalSource({
          resource: r.texture,
          renderer,
          width: r.width,
          height: r.height,
          label: `fee-coeur:cast:${cast.instanceId}`,
        });
        source.alphaMode = "no-premultiply-alpha";
        source.scaleMode = "linear";
        source.format = "rgba8unorm";
        source.autoGarbageCollect = false;
        cast.source = source;
        cast.sprite.texture = new Texture({ source });
        cast.sprite.anchor.set(
          r.anchorX / r.width,
          r.anchorY / r.height,
        );
        // Anchor lives at (worldX, worldY) — set after texture/anchor.
        cast.sprite.x = cast.worldX;
        cast.sprite.y = cast.worldY;
      }
    }
  };
  Ticker.shared.add(tickerCb);
}

export interface FeeCoeurSpawnOpts {
  /** Mount target — typically the battlefield `mapContainer`. */
  container: Container;
  /** Needed for renderer access (wgpu device adoption). */
  app: Application;
  /** Burst origin in `container`-local coordinates. */
  x: number;
  y: number;
}

/**
 * Throw ONE AVM1-driven heart firework at (x, y). AS2 inside
 * `items/74/32.swf` is what actually animates — we just adopt the
 * resulting GPUTexture and tick it each frame.
 */
export async function spawnFeeCoeurAt(
  opts: FeeCoeurSpawnOpts,
): Promise<boolean> {
  const ok = await ensureBundle();
  if (!ok) return false;

  const instanceId = createSwfSpellInstance(BUNDLE_NAME, RESOLUTION);
  if (instanceId === 0) {
    log.warn("createSwfSpellInstance returned 0 — bundle unusable");
    return false;
  }
  log.info(
    `spawned spell instance ${instanceId} at (${opts.x.toFixed(1)}, ${opts.y.toFixed(1)})`,
  );

  ensureTicker(opts.app.renderer);

  // Empty placeholder Sprite — gets a real texture on the first tick.
  const sprite = new Sprite();
  sprite.x = opts.x;
  sprite.y = opts.y;
  opts.container.addChild(sprite);

  active.push({
    instanceId,
    sprite,
    source: null,
    spawnMs: performance.now(),
    worldX: opts.x,
    worldY: opts.y,
  });
  return true;
}

/** Tear down all live casts + remove the ticker. Idempotent. */
export function clearFeeCoeur(): void {
  for (const cast of active) {
    cast.sprite.parent?.removeChild(cast.sprite);
    cast.sprite.destroy();
    cast.source?.destroy();
    disposeSwfSpellInstance(cast.instanceId);
  }
  active.length = 0;
  if (tickerCb) {
    Ticker.shared.remove(tickerCb);
    tickerCb = null;
  }
}
