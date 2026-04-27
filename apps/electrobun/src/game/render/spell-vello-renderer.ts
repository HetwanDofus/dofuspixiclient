import type { VelloRenderer } from "vello-wasm";
import { ExternalSource, Rectangle, type Renderer, Texture } from "pixi.js";

import { createLogger } from "@/utils/logger";

const log = createLogger("SpellVello");

interface VelloStripResult {
  texture: GPUTexture;
  textureId: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  gridCols?: number;
  boundsOffsetX?: number;
  boundsOffsetY?: number;
  anchorX?: number;
  anchorY?: number;
}

interface VelloAnimInfo {
  frameCount: number;
  fps: number;
  offsetX: number;
  offsetY: number;
}

/** Pre-rendered animation slice: one GPU strip, sliced into Pixi Textures. */
export interface SpellAnimation {
  frames: Texture[];
  frameCount: number;
  fps: number;
  offsetX: number;
  offsetY: number;
  /**
   * Per-frame logical width/height (in CSS pixels). Equal to the texture
   * frame size — Vello returns the tight bounds across all frames in
   * the animation, NOT the canonical SWF sprite bounds. So if the
   * source manifest claims a 113.3×95.9 bounding box but the actual
   * path content only fills 80×75 (e.g., morph shapes that retract at
   * the endpoint), `frameWidth` is 80, not 113.3.
   */
  frameWidth: number;
  frameHeight: number;
  /**
   * Registration point ("anchor") in PIXEL coords within the frame.
   * Normalized for Pixi via `anchorPx / frameWidth`. Matches what the
   * SWF's `_x = 0; _y = 0;` would resolve to inside the rendered frame.
   */
  anchorPxX: number;
  anchorPxY: number;
}

/**
 * Spell counterpart to the character-sprite loader. A spell's
 * `.dofasset` binary (compiled from the SVG atlases in
 * `assets/spritesheets/spells/<id>/`) gets loaded into Vello once, then
 * per animation we call `renderAnimationStrip` to rasterize every
 * frame into a single GPU texture grid. We slice that grid into
 * per-frame Pixi Textures so FrameAnimatedSprite can swap cheaply.
 *
 * Mirroring the character-sprite approach instead of calling
 * `renderFrame` per frame gives us (a) one Vello call per animation
 * instead of N, and (b) a single GPU texture shared across all frames
 * so we don't blow the Vello texture-slot budget on long spell
 * timelines like Spell 101 (189 frames).
 */
export class SpellVelloRenderer {
  private vello: VelloRenderer | null = null;
  private nextAssetId = 10_000;

  private readonly assetIds = new Map<number, number>();
  private readonly pendingLoads = new Map<number, Promise<boolean>>();
  private readonly missingAssets = new Set<number>();
  /** Raw .dofasset bytes, kept so callers can read the Extras section. */
  private readonly assetBytes = new Map<number, Uint8Array>();
  /** Cached strip per (spellId, animation, resolution). */
  private readonly animationCache = new Map<string, SpellAnimation>();

  constructor(
    private readonly pixiRenderer: Renderer,
    private readonly basePath: string
  ) {}

  setVelloRenderer(vello: VelloRenderer): void {
    this.vello = vello;
  }

  hasAsset(spellId: number): boolean {
    return this.assetIds.has(spellId);
  }

  /** Raw dofasset bytes for a loaded spell, used to parse the Extras section. */
  getAssetBytes(spellId: number): Uint8Array | undefined {
    return this.assetBytes.get(spellId);
  }

  async loadAsset(spellId: number): Promise<boolean> {
    if (this.assetIds.has(spellId)) {
      return true;
    }
    if (this.missingAssets.has(spellId)) {
      return false;
    }
    const pending = this.pendingLoads.get(spellId);
    if (pending) {
      return pending;
    }
    const promise = this.doLoadAsset(spellId);
    this.pendingLoads.set(spellId, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(spellId);
    }
  }

  /**
   * Build (or reuse) the per-frame Pixi Textures for a given animation
   * at the current resolution. Returns null if the asset isn't
   * loaded, the animation isn't in the dofasset, or Vello fails to
   * rasterize the strip.
   */
  buildAnimation(
    spellId: number,
    animation: string,
    resolution: number
  ): SpellAnimation | null {
    const vello = this.vello;
    const assetId = this.assetIds.get(spellId);
    if (!vello || assetId === undefined) {
      return null;
    }

    const cacheKey = `${spellId}:${animation}:${resolution}`;
    const cached = this.animationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const animInfo = vello.getAnimationInfo(
      assetId,
      animation
    ) as VelloAnimInfo | null;
    if (!animInfo || animInfo.frameCount <= 0) {
      log.warn(
        `spell ${spellId} anim=${animation}: getAnimationInfo returned ${
          animInfo ? `frameCount=${animInfo.frameCount}` : "null"
        } — dofasset likely missing this animation`
      );
      return null;
    }

    const strip = vello.renderAnimationStrip(
      assetId,
      animation,
      resolution
    ) as VelloStripResult | null;
    if (!strip) {
      log.warn(
        `spell ${spellId} anim=${animation}: renderAnimationStrip null (frameCount=${animInfo.frameCount}, resolution=${resolution}) — likely GPU texture dim limit`
      );
      return null;
    }

    const stripSource = new ExternalSource({
      resource: strip.texture,
      renderer: this.pixiRenderer,
      width: strip.width,
      height: strip.height,
      label: `vello-spell:${spellId}:${animation}`,
    });
    stripSource.alphaMode = "no-premultiply-alpha";
    stripSource.format = "rgba8unorm";
    stripSource.scaleMode = "nearest";
    stripSource.resolution = resolution;
    // Lifecycle handled by us — the spell asset loader destroys these
    // textures when the spell unloads. Pixi's GC would tear the strip
    // out mid-playback otherwise.
    stripSource.autoGarbageCollect = false;

    const fw = strip.frameWidth / resolution;
    const fh = strip.frameHeight / resolution;
    const cols = strip.gridCols || strip.frameCount;
    const frames: Texture[] = [];
    for (let i = 0; i < strip.frameCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      frames.push(
        new Texture({
          source: stripSource,
          frame: new Rectangle(col * fw, row * fh, fw, fh),
        })
      );
    }

    const animation_: SpellAnimation = {
      frames,
      frameCount: strip.frameCount,
      fps: animInfo.fps,
      offsetX: animInfo.offsetX,
      offsetY: animInfo.offsetY,
      frameWidth: fw,
      frameHeight: fh,
      // strip.anchorX/Y is in render-resolution pixels; convert to logical.
      anchorPxX: (strip.anchorX ?? 0) / resolution,
      anchorPxY: (strip.anchorY ?? 0) / resolution,
    };
    this.animationCache.set(cacheKey, animation_);
    return animation_;
  }

  clearAnimationCache(): void {
    this.animationCache.clear();
  }

  private async doLoadAsset(spellId: number): Promise<boolean> {
    const vello = this.vello;
    if (!vello) {
      return false;
    }
    const url = `${this.basePath}/spells/${spellId}.dofasset`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.missingAssets.add(spellId);
        return false;
      }
      const data = new Uint8Array(await res.arrayBuffer());
      const id = this.nextAssetId++;
      vello.loadAsset(id, data);
      this.assetIds.set(spellId, id);
      this.assetBytes.set(spellId, data);
      return true;
    } catch (err) {
      log.warn(`Failed to load spell ${spellId}:`, err);
      this.missingAssets.add(spellId);
      return false;
    }
  }
}
