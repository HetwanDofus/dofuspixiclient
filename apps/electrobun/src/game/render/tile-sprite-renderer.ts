/**
 * TileSpriteRenderer — per-tile Pixi sprites for ground (layer 0) +
 * object1 (layer 1) tiles. Replaces `TileLayerRenderer`'s per-tick
 * Vello surface dispatch.
 *
 * Design (mirrors `apps/electrobun/src/window/mainview/stress-worker.ts:974-1003`):
 *   - Per visible tile placement, mount one Pixi `Sprite` in the
 *     destination layer container (groundLayer for layer=0,
 *     object1Layer for layer=1).
 *   - On placement add: `renderSwfFrame(bundle, exportName, frame,
 *     MAP_BG_ZOOM)` → wrap result GPUTexture as `ExternalSource` →
 *     point sprite.texture at it.
 *   - Animated tiles tick a per-tile accumulator; on advance,
 *     re-render the next frame and pair `oldSource.destroy()` with
 *     `freeRenderTexture(oldTextureId)` after a 2-tick settle.
 *   - Static tiles render once at `staticFrame` and never change.
 *
 * Animated-tile cardinality on a Dofus map is small (~10-30 unique
 * animated tiles per map), so per-tile per-frame on-demand keeps GPU
 * load bounded — the same reason the stress test uses this approach.
 */
import {
  ExternalSource,
  type Container,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import { ROT_SCALE_X, ROT_SCALE_Y } from "@/game/constants/battlefield";
import {
  freeRenderTexture,
  renderSwfFrame,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

/**
 * One renderable tile occurrence. MapHandler emits one per (cell,
 * layer) entry with a non-zero tile id; TileSpriteRenderer creates
 * one Pixi sprite per placement and routes by `layer` into the
 * corresponding container.
 */
export interface TilePlacement {
  /** Stable id for diagnostics ("ground_42", etc.). */
  tileKey: string;
  bundle: string;
  exportName: string;
  /** Cell position in logical pixel space (output of `getCellPosition`). */
  cellX: number;
  cellY: number;
  /** 0/1/2/3 — multiplied by 90° at render. */
  rotation: number;
  flip: boolean;
  /** Total frames in the timeline (1 for static). */
  frameCount: number;
  /** True when the tile auto-loops on a per-frame timer. */
  isAnimated: boolean;
  /** Frames per second for animated tiles. */
  fps: number;
  /**
   * Frame to render for *non*-animated multi-frame tiles
   * (slope/random tiles where each cell picks a fixed frame index).
   * Ignored for animated tiles (they advance via `tick`).
   */
  staticFrame: number;
}

const log = createLogger("TileSpriteRenderer");

/** Tile rasterization resolution. Matches stress-worker.ts:109 MAP_BG_ZOOM. */
const MAP_BG_ZOOM = 10;
const TICK_INTERVAL_MS = 1000 / 60;
const RETIRE_DELAY_MS = 2 * TICK_INTERVAL_MS;

/**
 * Layer-tagged variant of `TilePlacement` — caller marks the
 * destination Pixi layer per tile. MapHandler emits this when
 * building placements: ground tiles → layer 0, object1 tiles → 1.
 */
export interface LayeredTilePlacement extends TilePlacement {
  layer: 0 | 1 | 2;
}

interface TileSpriteState {
  sprite: Sprite;
  layer: 0 | 1 | 2;
  // Re-render context — kept so on-demand frame advance reuses bundle/export.
  bundle: string;
  exportName: string;
  frameCount: number;
  fps: number;
  isAnimated: boolean;
  currentFrame: number;
  accumMs: number;
  // Owned GPU resource for retire pairing.
  currentSource: ExternalSource | null;
  currentTextureId: number;
  // Cell context — for repositioning on map-scale change.
  cellX: number;
  cellY: number;
  rotation: number;
  flip: boolean;
  /** Anchor in (texture-pixel / texture-size) units, captured at create. */
  anchorFracX: number;
  anchorFracY: number;
}

function tileKey(p: LayeredTilePlacement): string {
  return `${p.layer}:${p.tileKey}@${p.cellX},${p.cellY},r${p.rotation},f${p.flip ? 1 : 0}`;
}

function applyMatrix(
  sprite: Sprite,
  cellX: number,
  cellY: number,
  rotation: number,
  flip: boolean
): void {
  // Position sprites in mapContainer-local logical pixels — exactly
  // what canonical `MapHandler.as` does (`mc._x = col * CELL_WIDTH +
  // parityOffset`). Players use the same convention so tiles + chars
  // share a coordinate space; mapContainer.scale = zoom propagates
  // the user zoom.
  sprite.x = cellX;
  sprite.y = cellY;

  // Texture is rasterized at MAP_BG_ZOOM density. Base scale
  // 1/MAP_BG_ZOOM brings texture pixels back to logical pixels;
  // rotated tiles get the canonical AS iso-projection fudge:
  //   `_xscale = 51.85, _yscale = 192.86` (Constants.as).
  // Flip mirrors the X axis (canonical `_xscale *= -1`).
  const rot = rotation & 3;
  const rotated = rot === 1 || rot === 3;
  const base = 1 / MAP_BG_ZOOM;
  const sx = rotated ? base * ROT_SCALE_X : base;
  const sy = rotated ? base * ROT_SCALE_Y : base;
  sprite.scale.set(flip ? -sx : sx, sy);
  sprite.rotation = rot * (Math.PI / 2);
}

export class TileSpriteRenderer {
  private states = new Map<string, TileSpriteState>();
  private pixiRenderer: Renderer;
  private groundLayer: Container;
  private object1Layer: Container;
  private object2Layer: Container;

  constructor(
    pixiRenderer: Renderer,
    groundLayer: Container,
    object1Layer: Container,
    object2Layer: Container
  ) {
    this.pixiRenderer = pixiRenderer;
    this.groundLayer = groundLayer;
    this.object1Layer = object1Layer;
    this.object2Layer = object2Layer;
  }

  /**
   * Diff the live sprite set against the new placement list — create
   * sprites for new entries, retire the ones that disappeared, leave
   * unchanged ones alone.
   */
  setPlacements(placements: ReadonlyArray<LayeredTilePlacement>): void {
    const nextKeys = new Set<string>();
    for (const p of placements) {
      const key = tileKey(p);
      nextKeys.add(key);
      if (this.states.has(key)) {
        continue;
      }
      this.createSprite(key, p);
    }
    for (const key of [...this.states.keys()]) {
      if (!nextKeys.has(key)) {
        this.removeSprite(key);
      }
    }
  }

  /**
   * Per-tick frame advance for animated tiles. Static tiles are no-ops
   * (their sprite was set up once and never changes).
   */
  tick(dtMs: number): void {
    for (const [, state] of this.states) {
      if (!state.isAnimated || state.fps <= 0 || state.frameCount <= 1) {
        continue;
      }
      state.accumMs += dtMs;
      const period = 1000 / state.fps;
      if (state.accumMs < period) {
        continue;
      }
      const steps = Math.floor(state.accumMs / period);
      state.accumMs -= steps * period;
      state.currentFrame = (state.currentFrame + steps) % state.frameCount;
      this.swapFrame(state);
    }
  }

  destroy(): void {
    for (const key of [...this.states.keys()]) {
      this.removeSprite(key);
    }
  }

  private createSprite(key: string, p: LayeredTilePlacement): void {
    const initialFrame = p.isAnimated ? 0 : p.staticFrame;
    const result = renderSwfFrame(
      p.bundle,
      p.exportName,
      initialFrame,
      MAP_BG_ZOOM
    );
    if (!result) {
      return;
    }
    const source = new ExternalSource({
      resource: result.texture,
      renderer: this.pixiRenderer,
      width: result.width,
      height: result.height,
      label: `tile-${p.tileKey}-f${initialFrame}`,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.format = "rgba8unorm";
    source.resolution = MAP_BG_ZOOM;
    source.autoGarbageCollect = false;

    const anchorFracX = result.width > 0 ? result.anchorX / result.width : 0;
    const anchorFracY = result.height > 0 ? result.anchorY / result.height : 0;

    const sprite = new Sprite(new Texture({ source }));
    sprite.anchor.set(anchorFracX, anchorFracY);
    applyMatrix(sprite, p.cellX, p.cellY, p.rotation, p.flip);
    // Painter's-order zIndex inside the layer: lower-cellY (back rows)
    // render first so higher-cellY (front rows) overlap correctly.
    // Mirrors canonical MapHandler depth convention.
    sprite.zIndex = Math.round(p.cellY * 100) + Math.round(p.cellX);

    const parent =
      p.layer === 0
        ? this.groundLayer
        : p.layer === 1
          ? this.object1Layer
          : this.object2Layer;
    parent.addChild(sprite);

    this.states.set(key, {
      sprite,
      layer: p.layer,
      bundle: p.bundle,
      exportName: p.exportName,
      frameCount: p.frameCount,
      fps: p.fps,
      isAnimated: p.isAnimated,
      currentFrame: initialFrame,
      accumMs: 0,
      currentSource: source,
      currentTextureId: result.textureId,
      cellX: p.cellX,
      cellY: p.cellY,
      rotation: p.rotation,
      flip: p.flip,
      anchorFracX,
      anchorFracY,
    });
  }

  private removeSprite(key: string): void {
    const state = this.states.get(key);
    if (!state) {
      return;
    }
    const oldSource = state.currentSource;
    const oldTextureId = state.currentTextureId;
    try {
      state.sprite.parent?.removeChild(state.sprite);
      state.sprite.destroy();
    } catch (e) {
      log.warn("removeSprite: destroy failed", e);
    }
    if (oldSource && oldTextureId) {
      setTimeout(() => {
        try {
          oldSource.destroy();
        } catch {}
        freeRenderTexture(oldTextureId);
      }, RETIRE_DELAY_MS);
    }
    this.states.delete(key);
  }

  private swapFrame(state: TileSpriteState): void {
    const result = renderSwfFrame(
      state.bundle,
      state.exportName,
      state.currentFrame,
      MAP_BG_ZOOM
    );
    if (!result) {
      return;
    }
    const oldSource = state.currentSource;
    const oldTextureId = state.currentTextureId;

    const newSource = new ExternalSource({
      resource: result.texture,
      renderer: this.pixiRenderer,
      width: result.width,
      height: result.height,
      label: `tile-${state.bundle}-${state.exportName}-f${state.currentFrame}`,
    });
    newSource.alphaMode = "no-premultiply-alpha";
    newSource.format = "rgba8unorm";
    newSource.resolution = MAP_BG_ZOOM;
    newSource.autoGarbageCollect = false;

    // Re-anchor in case of a rare frame-bounds shift (the WASM should
    // return uniform anchor per export, but we recompute defensively
    // — wrong anchor is visually obvious).
    state.sprite.anchor.set(
      result.width > 0 ? result.anchorX / result.width : state.anchorFracX,
      result.height > 0 ? result.anchorY / result.height : state.anchorFracY
    );
    state.sprite.texture = new Texture({ source: newSource });
    state.currentSource = newSource;
    state.currentTextureId = result.textureId;

    if (oldSource && oldTextureId) {
      setTimeout(() => {
        try {
          oldSource.destroy();
        } catch {}
        freeRenderTexture(oldTextureId);
      }, RETIRE_DELAY_MS);
    }
  }
}
