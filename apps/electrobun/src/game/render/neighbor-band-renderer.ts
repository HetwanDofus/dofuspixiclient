import {
  type Application,
  Container,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";

import type { MapData } from "@/game/datacenter/map";
import {
  BOTTOM_BAND_HEIGHT,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  SIDE_BAND_WIDTH,
  VIEW_WIDTH,
} from "@/game/constants/battlefield";
import {
  Z_GROUND_LAYER,
  Z_OBJECT1_LAYER,
  Z_OBJECT2_LAYER_ROOT,
} from "@/game/constants/z-index";
import { computeMapScale } from "@/game/datacenter";
import { NeighborFeatherFilter } from "@/game/render/neighbor-feather-filter";
import { TileResolver } from "@/game/render/tile-resolver";
import { TileSpriteRenderer } from "@/game/render/tile-sprite-renderer";
import { buildBaseMapPlacements } from "@/game/scene/map/placements";
import { createLogger } from "@/utils/logger";

const log = createLogger("NeighborBandRenderer");

export type NeighborSide = "left" | "right" | "bottom";

/**
 * Downsample-pyramid depth for the peripheral blur. Each step halves the
 * logical dims; the GPU's bilinear sampler averages 2×2 per step, so N steps
 * ≈ a 2^N-wide box blur. 3 → final level ≈ 93×54 (from 742×432). Tunable.
 */
const NEIGHBOR_BLUR_STEPS = 3;

/**
 * Feather / overspill margin, in map-logical px. The live capture is widened
 * by this much on the left/right/bottom so the current map's edge objects
 * (which overhang the game-area rect) are captured, then the feather filter
 * fades them to 0 at the capture boundary so they cross-dissolve into the
 * blurred neighbour. Must stay below SIDE_BAND_WIDTH (≈292) and
 * BOTTOM_BAND_HEIGHT (124). Tunable.
 */
const NEIGHBOR_FEATHER_LOGICAL = 48;

/**
 * How far INSIDE the old crop line (map-logical px) the edge ramp reaches full
 * opacity/sharpness. Biasing the ramp inward means the blur+fade is already
 * underway AT the old crop instead of only beginning outside it.
 */
const NEIGHBOR_FADE_IN_LOGICAL = 28;

/**
 * Max blur radius applied to the live overspill, as a fraction of the feather
 * margin. The per-fragment radius is `(1 - edgeAlpha) * this`, so the overspill
 * blurs progressively (0 deep inside, max at the outer edge).
 */
const NEIGHBOR_OVERSPILL_BLUR_FACTOR = 0.6;

/** wgpu maxTextureDimension2d is 8192; stay under it for the capture RT. */
const MAX_PHYS_DIM = 8000;

/**
 * Widescreen neighbour-band compositor (Composition Y).
 *
 *   ┌────────────────────────────────────────┐
 *   │ L │          game capture (top)       │R│   bands = SOLID blurred
 *   │   ├───────────────────────────────────┤ │   neighbour, drawn BEHIND
 *   │   │          bottom band              │ │   the feathered live capture
 *   └────────────────────────────────────────┘
 *
 * - Neighbour maps (whose descriptors arrive over GDA) are baked into
 *   off-screen RTs once per map join, then blurred via a downsample pyramid
 *   and cropped into the three SOLID band sprites. The bands sit behind the
 *   live map.
 * - The live `mapContainer` is captured every frame into a persistent
 *   `gameRt` (widened by the feather margin so edge-object overspill — trees,
 *   houses — that overhangs the game-area rect is included), and drawn on top
 *   via `gameSprite` carrying a singleton `NeighborFeatherFilter`. The filter
 *   ramps alpha to 0 at the left/right/bottom edges, so the current map's edge
 *   objects cross-dissolve into the blurred neighbour instead of being cut.
 * - `mapContainer.renderable = false` (set by the bootstrap) keeps Pixi from
 *   drawing it directly in the stage pass — it renders only into `gameRt`.
 *   The explicit `render({ container: mapContainer })` path renders it anyway
 *   (it only honours `visible`, not `renderable`), so the capture works.
 *
 * Leak-safety (patched wgpu fork): every RT is a persistent singleton
 * allocated once and resized in place; the only filter is a singleton. No
 * Pixi `.mask`, no `BlurFilter` — both churn TexturePool, which leaks here.
 */
export class NeighborBandRenderer {
  private readonly app: Application;
  private readonly mapContainer: Container;

  private readonly blackBg: Sprite;
  private readonly bands: Record<NeighborSide, Sprite>;
  private readonly rts: Record<NeighborSide, RenderTexture | null> = {
    left: null,
    right: null,
    bottom: null,
  };

  /**
   * Backing-texture density for the neighbour bake + blur RTs. Tracks the live
   * display density (baseZoom × dpr) so neighbours rasterise at the SAME
   * resolution as the live map (not a fixed 1×, which upscaled/blurred them).
   * Updated in `resize`; a change re-bakes the stored neighbours.
   */
  private bakeRes = 0;

  /** Last map baked per side, so a resolution change can re-bake in place. */
  private readonly lastMapData: Record<NeighborSide, MapData | null> = {
    left: null,
    right: null,
    bottom: null,
  };

  // Shared off-screen bake rig.
  private readonly bakeRoot = new Container();
  private readonly bakeGround = new Container();
  private readonly bakeObject1 = new Container();
  private readonly bakeObject2 = new Container();
  private readonly bakeRenderer: TileSpriteRenderer;
  private readonly tileResolver = new TileResolver();

  // Dual-filter blur: one reused sprite + shared halving scratch RTs (resized
  // with the bake density in `ensureBakeRes`). The neighbour is downsampled
  // then UPSAMPLED back to full bake res, so the per-side blurred RT stays
  // 742×432 logical and the band samples it ~1:1 (no big upscale → no blocky
  // bilinear artefacts). The per-side final RT must persist (the band texture
  // samples it; sharing would let one side's bake clobber another's).
  private readonly blurSprite = new Sprite(Texture.EMPTY);
  private readonly blurScratch: RenderTexture[] = [];
  private readonly blurRts: Record<NeighborSide, RenderTexture | null> = {
    left: null,
    right: null,
    bottom: null,
  };

  // Per-frame live-map capture composited on top of the bands.
  private gameRt: RenderTexture | null = null;
  private readonly gameSprite: Sprite;
  private readonly featherFilter = new NeighborFeatherFilter();

  private currentSideBandCss = 0;
  private currentFeatherCss = 0;

  constructor(app: Application, mapContainer: Container) {
    this.app = app;
    this.mapContainer = mapContainer;

    this.blackBg = new Sprite(Texture.WHITE);
    this.blackBg.label = "neighbor-black-bg";
    this.blackBg.tint = 0x000000;
    this.blackBg.eventMode = "none";
    app.stage.addChildAt(this.blackBg, 0);

    this.bands = {
      left: this.makeBand("neighbor-band-left"),
      right: this.makeBand("neighbor-band-right"),
      bottom: this.makeBand("neighbor-band-bottom"),
    };
    // Bands render BEHIND the live capture (added before gameSprite). They are
    // solid blurred neighbour; the live capture feathers over them.
    app.stage.addChild(this.bands.left);
    app.stage.addChild(this.bands.right);
    app.stage.addChild(this.bands.bottom);

    // Live-map capture sprite — on TOP, carries the feather filter.
    this.gameSprite = new Sprite(Texture.EMPTY);
    this.gameSprite.label = "neighbor-game-capture";
    this.gameSprite.eventMode = "none";
    this.gameSprite.filters = [this.featherFilter];
    app.stage.addChild(this.gameSprite);

    // Bake rig.
    this.bakeGround.zIndex = Z_GROUND_LAYER;
    this.bakeObject1.zIndex = Z_OBJECT1_LAYER;
    this.bakeObject2.zIndex = Z_OBJECT2_LAYER_ROOT;
    this.bakeGround.sortableChildren = true;
    this.bakeObject1.sortableChildren = true;
    this.bakeObject2.sortableChildren = true;
    this.bakeRoot.sortableChildren = true;
    this.bakeRoot.addChild(this.bakeGround, this.bakeObject1, this.bakeObject2);
    this.bakeRenderer = new TileSpriteRenderer(
      this.app.renderer,
      this.bakeGround,
      this.bakeObject1,
      this.bakeObject2
    );

    // Blur scratch + per-side RTs are allocated/resized at the live display
    // density by `resize` → `ensureBakeRes` (called next).
    this.resize();
  }

  private makeBand(label: string): Sprite {
    const s = new Sprite(Texture.WHITE);
    s.label = label;
    s.anchor.set(0, 0);
    s.eventMode = "none";
    s.visible = false; // hidden until a neighbour is baked
    return s;
  }

  /** Logical dims of downsample-pyramid level `i` (0-based). */
  private blurLevelDims(i: number): [number, number] {
    const f = 2 ** (i + 1);
    return [
      Math.max(2, Math.round(DISPLAY_WIDTH / f)),
      Math.max(2, Math.round(DISPLAY_HEIGHT / f)),
    ];
  }

  /**
   * Recentre mapContainer at the wider canvas's central game-area origin.
   * Call after `loadMapFromData` resets mapContainer to (0,0).
   */
  recenter(): void {
    this.mapContainer.position.set(this.currentSideBandCss, 0);
  }

  /**
   * Reposition + resize the backdrop, bands, and the live-capture RT/sprite
   * for the current canvas dims. The neighbour RTs are bake-space (fixed) so
   * they don't resize here.
   */
  resize(): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const baseZoom = screenW / VIEW_WIDTH;
    const dpr = (this.app.renderer as { resolution?: number }).resolution ?? 1;

    const sideBandCss = SIDE_BAND_WIDTH * baseZoom;
    const gameAreaCss = DISPLAY_WIDTH * baseZoom;
    const displayHeightCss = DISPLAY_HEIGHT * baseZoom;
    const bottomBandCss = BOTTOM_BAND_HEIGHT * baseZoom;
    const featherCss = NEIGHBOR_FEATHER_LOGICAL * baseZoom;
    const fadeInCss = NEIGHBOR_FADE_IN_LOGICAL * baseZoom;
    this.currentSideBandCss = sideBandCss;
    this.currentFeatherCss = featherCss;

    this.blackBg.x = 0;
    this.blackBg.y = 0;
    this.blackBg.width = screenW;
    this.blackBg.height = screenH;

    // Bands extend INWARD past the old crop by the feather's inner reach
    // (`fadeInCss` + a small safety margin) so the live capture's inward fade
    // is backed by solid blurred neighbour — not the black backdrop, which
    // would otherwise show through as a dark seam line. The extra is hidden
    // behind the (fully opaque) game interior.
    const innerExt = fadeInCss + 6 * baseZoom;
    // Side bands also reach down past the game's bottom edge by the feather so
    // the bottom-corner feather (where side + bottom margins overlap) is backed
    // by neighbour rather than black.
    const sideBandH = displayHeightCss + featherCss + innerExt;

    this.bands.left.x = 0;
    this.bands.left.y = 0;
    this.bands.left.width = Math.max(1, sideBandCss + innerExt);
    this.bands.left.height = Math.max(1, sideBandH);

    this.bands.right.x = sideBandCss + gameAreaCss - innerExt;
    this.bands.right.y = 0;
    this.bands.right.width = Math.max(1, sideBandCss + innerExt);
    this.bands.right.height = Math.max(1, sideBandH);

    this.bands.bottom.x = sideBandCss;
    this.bands.bottom.y = displayHeightCss - innerExt;
    this.bands.bottom.width = Math.max(1, gameAreaCss);
    this.bands.bottom.height = Math.max(1, bottomBandCss + innerExt);

    // Live-capture RT: game area widened by the feather margin (left/right and
    // bottom — top is flush with the canvas top, no neighbour above).
    const rtW = Math.max(1, Math.round(gameAreaCss + 2 * featherCss));
    const rtH = Math.max(1, Math.round(displayHeightCss + featherCss));
    const physMax = Math.max(rtW * dpr, rtH * dpr);
    const safeRes =
      physMax > MAX_PHYS_DIM ? (MAX_PHYS_DIM / physMax) * dpr : dpr;
    if (this.gameRt) {
      this.gameRt.resize(rtW, rtH, safeRes);
    } else {
      this.gameRt = RenderTexture.create({
        width: rtW,
        height: rtH,
        resolution: safeRes,
      });
    }
    this.gameSprite.texture = this.gameRt;
    this.gameSprite.x = sideBandCss - featherCss;
    this.gameSprite.y = 0;
    this.gameSprite.width = rtW;
    this.gameSprite.height = rtH;

    // Feather widths reach 1 (sharp) `fadeInCss` INSIDE the crop, so the ramp
    // straddles the old crop line (blur visible AT the crop, not only outside).
    // Blur radius is sprite-UV (x,y), isotropic in pixels.
    const edgeX = (featherCss + fadeInCss) / rtW;
    const edgeY = (featherCss + fadeInCss) / rtH;
    const blurRpx = featherCss * NEIGHBOR_OVERSPILL_BLUR_FACTOR;
    this.featherFilter.setEdgeParams(
      edgeX, // left
      edgeX, // right
      0, // top (flush)
      edgeY, // bottom
      blurRpx / rtW, // blur radius x (UV)
      blurRpx / rtH // blur radius y (UV)
    );

    // Match the neighbour bake density to the live display density so the
    // bands rasterise at the SAME resolution as the live map (not a fixed 1×).
    // A change resizes the blur RTs and re-bakes the stored neighbours.
    const bakeRes = Math.min(baseZoom * dpr, MAX_PHYS_DIM / DISPLAY_WIDTH);
    if (this.ensureBakeRes(bakeRes)) {
      for (const side of ["left", "right", "bottom"] as const) {
        const md = this.lastMapData[side];
        if (md) {
          this.applyNeighbor(side, md);
        }
      }
    }

    this.recenter();
  }

  /**
   * Allocate/resize the blur scratch + per-side bake/blur RTs to `res`.
   * Returns true if the density changed (caller re-bakes neighbours).
   */
  private ensureBakeRes(res: number): boolean {
    if (Math.abs(res - this.bakeRes) < 1e-3) {
      return false;
    }
    this.bakeRes = res;

    for (let i = 0; i < NEIGHBOR_BLUR_STEPS; i++) {
      const [w, h] = this.blurLevelDims(i);
      const existing = this.blurScratch[i];
      if (existing) {
        existing.resize(w, h, res);
      } else {
        this.blurScratch[i] = RenderTexture.create({
          width: w,
          height: h,
          resolution: res,
        });
      }
    }
    for (const side of ["left", "right", "bottom"] as const) {
      this.rts[side]?.resize(DISPLAY_WIDTH, DISPLAY_HEIGHT, res);
      this.blurRts[side]?.resize(DISPLAY_WIDTH, DISPLAY_HEIGHT, res);
    }
    return true;
  }

  /**
   * Bake a neighbour map, blur it, and crop the facing edge into the band
   * sprite. `null` hides the band (flat-black via the backdrop).
   */
  setNeighbor(side: NeighborSide, mapData: MapData | null): void {
    this.lastMapData[side] = mapData;
    if (!mapData) {
      this.bands[side].visible = false;
      return;
    }
    this.applyNeighbor(side, mapData);
  }

  /** Bake + blur a neighbour and point its band at the result. */
  private applyNeighbor(side: NeighborSide, mapData: MapData): void {
    const band = this.bands[side];
    try {
      const blurred = this.bakeNeighbor(side, mapData);
      band.texture = new Texture({
        source: blurred.source,
        frame: this.cropFor(side),
      });
      band.visible = true;
    } catch (e) {
      log.warn(`bake ${side} failed:`, e);
      band.visible = false;
    }
  }

  /** Crop rectangle (bake-space coords) of the neighbour's facing edge. */
  private cropFor(side: NeighborSide): Rectangle {
    switch (side) {
      case "left":
        return new Rectangle(
          DISPLAY_WIDTH - SIDE_BAND_WIDTH,
          0,
          SIDE_BAND_WIDTH,
          DISPLAY_HEIGHT
        );
      case "right":
        return new Rectangle(0, 0, SIDE_BAND_WIDTH, DISPLAY_HEIGHT);
      case "bottom":
        return new Rectangle(0, 0, DISPLAY_WIDTH, BOTTOM_BAND_HEIGHT);
    }
  }

  /** Render `blurSprite` (textured with `src`) into `target`, filling it. */
  private blurPass(src: Texture, target: RenderTexture): void {
    this.blurSprite.texture = src;
    this.blurSprite.width = target.width;
    this.blurSprite.height = target.height;
    this.app.renderer.render({
      container: this.blurSprite,
      target,
      clear: true,
    });
  }

  /**
   * Render `mapData` into the side's sharp RT, then blur it with a dual-filter
   * (downsample then upsample back to full bake res) into the per-side blurred
   * RT. Returns the blurred RT, which stays 742×432 so the band samples it
   * ~1:1 (a clean blur, not a blocky upscale of a tiny texture).
   */
  private bakeNeighbor(side: NeighborSide, mapData: MapData): RenderTexture {
    let rt = this.rts[side];
    if (!rt) {
      rt = RenderTexture.create({
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        resolution: this.bakeRes,
      });
      this.rts[side] = rt;
    }

    const mapScale = computeMapScale(mapData.width, mapData.height);
    for (const layer of [this.bakeGround, this.bakeObject1, this.bakeObject2]) {
      layer.scale.set(mapScale.scale);
      layer.position.set(mapScale.offsetX, mapScale.offsetY);
    }

    const placements = buildBaseMapPlacements(mapData, this.tileResolver);
    this.bakeRenderer.setPlacements(placements);
    this.app.renderer.render({
      container: this.bakeRoot,
      target: rt,
      clear: true,
    });
    this.bakeRenderer.setPlacements([]);

    let blurRt = this.blurRts[side];
    if (!blurRt) {
      blurRt = RenderTexture.create({
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        resolution: this.bakeRes,
      });
      this.blurRts[side] = blurRt;
    }

    // Down-leg: sharp rt → scratch[0] → … → scratch[last] (each a bilinear
    // 2× downsample = a 2×2 box average per step).
    let source: Texture = rt;
    for (let i = 0; i < NEIGHBOR_BLUR_STEPS; i++) {
      this.blurPass(source, this.blurScratch[i]);
      source = this.blurScratch[i];
    }
    // Up-leg: scratch[last] → scratch[…] → blurRt (full res). Cascaded
    // bilinear upsamples reconstruct a smooth blur with no blocky stair-steps.
    for (let i = NEIGHBOR_BLUR_STEPS - 2; i >= 0; i--) {
      this.blurPass(source, this.blurScratch[i]);
      source = this.blurScratch[i];
    }
    this.blurPass(source, blurRt);

    return blurRt;
  }

  /**
   * Capture the live `mapContainer` (widened by the feather margin) into
   * `gameRt`. Called once per frame from the scene ticker, before Pixi's
   * stage render. The game-area origin is shifted to land at `(featherCss, 0)`
   * inside the RT while preserving any camera pan.
   */
  captureFrame(): void {
    if (!this.gameRt) {
      return;
    }
    const origX = this.mapContainer.x;
    this.mapContainer.x =
      origX - this.currentSideBandCss + this.currentFeatherCss;
    try {
      this.app.renderer.render({
        container: this.mapContainer,
        target: this.gameRt,
        clear: true,
      });
    } finally {
      this.mapContainer.x = origX;
    }
  }

  destroy(): void {
    this.bakeRenderer.destroy();

    for (const s of [
      this.blackBg,
      this.bands.left,
      this.bands.right,
      this.bands.bottom,
      this.gameSprite,
    ]) {
      s.parent?.removeChild(s);
      s.destroy({ children: false, texture: false, textureSource: false });
    }

    this.featherFilter.destroy();
    this.blurSprite.destroy({ texture: false, textureSource: false });

    for (const side of ["left", "right", "bottom"] as const) {
      this.rts[side]?.destroy(true);
      this.rts[side] = null;
      this.blurRts[side]?.destroy(true);
      this.blurRts[side] = null;
    }
    for (const rt of this.blurScratch) {
      rt.destroy(true);
    }
    this.blurScratch.length = 0;

    this.gameRt?.destroy(true);
    this.gameRt = null;
  }
}
