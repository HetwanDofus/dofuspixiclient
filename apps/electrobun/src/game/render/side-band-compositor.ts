import {
  type Application,
  type Container,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";

import {
  DISPLAY_WIDTH,
  SIDE_BAND_WIDTH,
  VIEW_WIDTH,
} from "@/game/constants/battlefield";
import { SideBandSpilloverFilter } from "@/game/render/side-band-spillover-filter";

/**
 * Widescreen side-band compositor.
 *
 * The engine sizes the Pixi canvas to `VIEW_WIDTH × VIEW_HEIGHT` (≈
 * 1.95 aspect) but the game world still lives in the central
 * `DISPLAY_WIDTH × FULL_HEIGHT` block. This compositor positions
 * `mapContainer` at `(sideBandCss, 0)` so it renders centred on the
 * canvas, then fills the two `SIDE_BAND_WIDTH` lateral strips with a
 * heavily blurred snapshot of the game.
 *
 * Blur strategy — 4-pass bilinear downsample pyramid:
 *
 *      gameRt (full)
 *        ↓ bilinear render @ 1/2
 *      blurRt0 (1/2)
 *        ↓ bilinear render @ 1/2
 *      blurRt1 (1/4)
 *        ↓ bilinear render @ 1/2
 *      blurRt2 (1/8)
 *        ↓ bilinear render @ 1/2
 *      blurRt3 (1/16)   ← side-band filter samples this
 *
 * Each pass is one fullscreen sprite render — the GPU's bilinear
 * filter handles the 2×2 averaging. Four steps cascade into ~256
 * source pixels averaged per output pixel without any custom shader.
 * The band filter then samples this pre-blurred texture with a
 * single tap, so the result is true photographic blur, no mirror
 * stretch, no kernel artefacts.
 *
 * The offset lives directly on `mapContainer.position` (not on a
 * wrapper) — this is deliberate. The interaction handler walks
 * pointer events through `(global − mapContainer.x) / zoom` to derive
 * map-local coordinates, and `clampCameraToBounds` uses the same
 * `.x` field as its anchor. Carrying the offset on mapContainer keeps
 * all that math working with one trivial constant patch in the clamp
 * instead of a full toLocal() refactor.
 *
 * Filter + RT lifetimes are singleton — allocated once, resized in
 * place on canvas resize. On patched wgpu, freshly-allocated filter
 * pipelines leak (per `feedback_pixi_filter_singleton`).
 */
export class SideBandCompositor {
  private readonly app: Application;
  private readonly mapContainer: Container;

  /** Full-resolution game capture. */
  private gameRt: RenderTexture | null = null;
  /** Downsample pyramid — last entry feeds the band filter. */
  private blurRts: RenderTexture[] = [];
  /** Reusable sprite for the downsample chain — texture gets swapped per pass. */
  private readonly blurSprite: Sprite;

  private readonly leftBand: Sprite;
  private readonly rightBand: Sprite;
  private leftFilter: SideBandSpilloverFilter | null = null;
  private rightFilter: SideBandSpilloverFilter | null = null;

  private currentGameW = 0;
  private currentCanvasH = 0;
  private currentDpr = 1;

  /** Cached side-band CSS width (= SIDE_BAND_WIDTH × baseZoom). */
  private currentSideBandCss = 0;

  /** Number of halving passes in the blur pyramid. 4 → final RT is 1/16 size. */
  private static readonly PYRAMID_STEPS = 4;

  /**
   * Caller hands a `mapContainer` already attached to the stage. The
   * compositor:
   *  - sets `mapContainer.position` to the centring offset
   *  - allocates the gameRt + blur pyramid + two band sprites in the
   *    same stage
   *  - sizes everything to the current canvas dims
   */
  constructor(app: Application, mapContainer: Container) {
    this.app = app;
    this.mapContainer = mapContainer;

    this.blurSprite = new Sprite(Texture.WHITE);
    this.blurSprite.anchor.set(0, 0);

    this.leftBand = new Sprite(Texture.WHITE);
    this.leftBand.label = "side-band-left";
    this.leftBand.anchor.set(0, 0);
    // Bands are decorative — never participate in pointer routing
    // (otherwise wheel/click in the band area would hit the band
    // sprite first and short-circuit the interaction handler's stage
    // event flow that drives map panning + cell picking).
    this.leftBand.eventMode = "none";

    this.rightBand = new Sprite(Texture.WHITE);
    this.rightBand.label = "side-band-right";
    this.rightBand.anchor.set(0, 0);
    this.rightBand.eventMode = "none";

    // Bands render on TOP of mapContainer so any overspill from a
    // zoomed-in map (mapContainer's content extending past the game-
    // area rect into the band region) is naturally covered.
    app.stage.addChild(this.leftBand);
    app.stage.addChild(this.rightBand);

    // First resize to current canvas dims. Sizing relies on
    // `app.screen` which is populated by `engine.init()` — we expect
    // the engine to have finished init before constructing us.
    this.resize();
  }

  /**
   * Rebuild gameRt + reposition mapContainer/bands to match the
   * current canvas dims. Idempotent on unchanged inputs. Call from
   * `Battlefield.handleCanvasResize`.
   */
  resize(): void {
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const dpr = (this.app.renderer as { resolution?: number }).resolution ?? 1;

    // baseZoom — logical-to-CSS pixel ratio for the canvas.
    const baseZoom = screenW / VIEW_WIDTH;
    const sideBandCss = SIDE_BAND_WIDTH * baseZoom;
    const gameAreaCss = DISPLAY_WIDTH * baseZoom;
    this.currentSideBandCss = sideBandCss;

    if (
      gameAreaCss === this.currentGameW &&
      screenH === this.currentCanvasH &&
      dpr === this.currentDpr &&
      this.gameRt !== null
    ) {
      // Even if dims didn't change, the underlying interaction code
      // may have nuked mapContainer.x → 0 (e.g. via clampCameraToBounds
      // before the offset was applied). Re-apply the offset on every
      // resize call as a cheap idempotent guarantee.
      this.recenter();
      return;
    }
    this.currentGameW = gameAreaCss;
    this.currentCanvasH = screenH;
    this.currentDpr = dpr;

    const rtW = Math.max(1, Math.round(gameAreaCss));
    const rtH = Math.max(1, Math.round(screenH));
    // Backing-texture dimension cap. wgpu's `maxTextureDimension2d` is
    // 8192; exceeding it panics in WASM and kills every subsequent
    // render (see `feedback_map_bg_zoom_texture_limit`). Use 8000 as a
    // safety margin.
    const MAX_PHYS_DIM = 8000;
    const physMax = Math.max(rtW * dpr, rtH * dpr);
    const safeResolution =
      physMax > MAX_PHYS_DIM ? (MAX_PHYS_DIM / physMax) * dpr : dpr;

    if (this.gameRt) {
      this.gameRt.resize(rtW, rtH, safeResolution);
    } else {
      this.gameRt = RenderTexture.create({
        width: rtW,
        height: rtH,
        resolution: safeResolution,
      });
    }

    // Allocate the blur pyramid. Each step halves the previous step's
    // logical dims; we keep `resolution: 1` on every level so we don't
    // multiply storage with dpr — these RTs are already aggressively
    // averaged, so the extra pixel detail dpr would buy is wasted.
    let prevW = rtW;
    let prevH = rtH;
    for (let i = 0; i < SideBandCompositor.PYRAMID_STEPS; i++) {
      const w = Math.max(2, Math.round(prevW / 2));
      const h = Math.max(2, Math.round(prevH / 2));
      const existing = this.blurRts[i];
      if (existing) {
        existing.resize(w, h, 1);
      } else {
        this.blurRts[i] = RenderTexture.create({ width: w, height: h, resolution: 1 });
      }
      prevW = w;
      prevH = h;
    }

    this.recenter();

    this.leftBand.x = 0;
    this.leftBand.y = 0;
    this.leftBand.width = Math.max(1, sideBandCss);
    this.leftBand.height = screenH;

    this.rightBand.x = sideBandCss + gameAreaCss;
    this.rightBand.y = 0;
    this.rightBand.width = Math.max(1, sideBandCss);
    this.rightBand.height = screenH;

    const finalBlurRt = this.blurRts[this.blurRts.length - 1];
    if (!this.leftFilter) {
      this.leftFilter = new SideBandSpilloverFilter({
        side: -1,
        gameTexture: finalBlurRt.source,
      });
      this.leftBand.filters = [this.leftFilter];
    } else {
      this.leftFilter.setGameTexture(finalBlurRt.source);
    }
    if (!this.rightFilter) {
      this.rightFilter = new SideBandSpilloverFilter({
        side: 1,
        gameTexture: finalBlurRt.source,
      });
      this.rightBand.filters = [this.rightFilter];
    } else {
      this.rightFilter.setGameTexture(finalBlurRt.source);
    }
  }

  /** Side-band CSS width — exported for InteractionHandler clamp. */
  getSideBandCss(): number {
    return this.currentSideBandCss;
  }

  /**
   * Recentre mapContainer at the wider canvas's central game-area
   * origin. Call after `loadMapFromData` resets mapContainer to (0,0)
   * — without this, the game would snap to canvas-left and the
   * interaction handler's `(global − mapContainer.x) / zoom` math
   * would land clicks on the wrong cells.
   */
  recenter(): void {
    this.mapContainer.position.set(this.currentSideBandCss, 0);
  }

  /**
   * Per-frame capture into gameRt + downsample pyramid. Call AFTER
   * scene ticks but BEFORE Pixi's internal stage render — wiring
   * lives in the scene ticker (see `startSceneTicker`).
   */
  captureFrame(): void {
    if (!this.gameRt) {
      return;
    }

    // 1. Capture mapContainer → gameRt with the centring offset
    //    temporarily zeroed so gameRt origin = game origin.
    const wasX = this.mapContainer.x;
    const wasY = this.mapContainer.y;
    this.mapContainer.position.set(wasX - this.currentSideBandCss, wasY);
    this.app.renderer.render({
      container: this.mapContainer,
      target: this.gameRt,
      clear: true,
    });
    this.mapContainer.position.set(wasX, wasY);

    // 2. Cascade the downsample pyramid. Each pass renders a sprite
    //    whose texture is the previous level, scaled to fit the next
    //    (smaller) RT. Pixi's bilinear sampler handles the 2×2
    //    averaging; chaining 4 levels yields ~256 source pixels
    //    averaged per final-RT pixel.
    let source: Texture = this.gameRt;
    for (let i = 0; i < this.blurRts.length; i++) {
      const target = this.blurRts[i];
      this.blurSprite.texture = source;
      this.blurSprite.width = target.width;
      this.blurSprite.height = target.height;
      this.app.renderer.render({
        container: this.blurSprite,
        target,
        clear: true,
      });
      source = target;
    }
  }

  destroy(): void {
    this.leftBand.filters = null;
    this.rightBand.filters = null;
    if (this.leftBand.parent) {
      this.leftBand.parent.removeChild(this.leftBand);
    }
    if (this.rightBand.parent) {
      this.rightBand.parent.removeChild(this.rightBand);
    }
    this.leftBand.destroy({
      children: false,
      texture: false,
      textureSource: false,
    });
    this.rightBand.destroy({
      children: false,
      texture: false,
      textureSource: false,
    });

    if (this.leftFilter) {
      try {
        this.leftFilter.destroy();
      } catch {
        // older Pixi versions may not have destroy on Filter — fine.
      }
      this.leftFilter = null;
    }
    if (this.rightFilter) {
      try {
        this.rightFilter.destroy();
      } catch {
        // ignore
      }
      this.rightFilter = null;
    }

    this.blurSprite.destroy({
      children: false,
      texture: false,
      textureSource: false,
    });

    for (const rt of this.blurRts) {
      rt.destroy(true);
    }
    this.blurRts = [];

    if (this.gameRt) {
      this.gameRt.destroy(true);
      this.gameRt = null;
    }
  }
}
