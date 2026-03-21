import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  Ticker,
} from "pixi.js";

import {
  getDirectionSuffix,
  isDirectionFlipped,
} from "@/ank/battlefield/character-sprite";
import { Direction } from "@/ecs/components";
import { i18n } from "@/i18n";
import { inventoryLabels as L } from "@/i18n/hud.messages";
import { loadSvg } from "@/render/load-svg";

import { BasePanel } from "../core/base-panel";
import { createProgressBar } from "../core/panel-builder";
import { boldText, COLORS, METRICS, regularText } from "../core/theme";
import { ThreeSliceSprite } from "../core/three-slice";

/**
 * Dofus 1.29 Inventory — pixel-perfect from SWF PlaceObject2 data.
 *
 * Two separate windows in the original:
 *   "Your inventory": X:242..720 (W=478, H=412) — equipment + item grid
 *   "Preview":        X:10..232  (W=222, H=197) — character sprite (separate window)
 *
 * BasePanel renders the inventory window. The preview is a child container
 * offset to the left with its own Window chrome.
 */

// ── Inventory window (BasePanel handles this) ──
// FLA: _winBg at tx=242, ty=18, sx=4.9, sy=4.17 → 490x417
const INV_OX = 242;
const INV_OY = 18;
const INV_W = 490;
const INV_H = 417;

// ── Preview window (separate, left of inventory) ──
const PREV_W = 222;
const PREV_H = 197;
const PREV_GAP = 10; // gap between preview right edge and inventory left edge

// ── Equipment slots (stage coords) ──
const SLOTS: Array<{ name: string; x: number; y: number; s: number }> = [
  { name: "dofus1", x: 270, y: 67, s: 25 },
  { name: "dofus2", x: 270, y: 94, s: 25 },
  { name: "dofus3", x: 270, y: 121, s: 25 },
  { name: "dofus4", x: 270, y: 148, s: 25 },
  { name: "dofus5", x: 270, y: 175, s: 25 },
  { name: "dofus6", x: 270, y: 202, s: 25 },
  { name: "shield", x: 320, y: 67, s: 40 },
  { name: "ring_l", x: 324, y: 118, s: 30 },
  { name: "hat", x: 388, y: 78, s: 30 },
  { name: "amulet", x: 383, y: 116, s: 40 },
  { name: "boots", x: 383, y: 177, s: 40 },
  { name: "ring_r", x: 456, y: 118, s: 30 },
  { name: "weapon", x: 450, y: 67, s: 40 },
  { name: "belt", x: 516, y: 67, s: 35 },
  { name: "cape", x: 516, y: 108, s: 35 },
  { name: "pet", x: 516, y: 149, s: 35 },
  { name: "mount", x: 516, y: 190, s: 35 },
];

// ── Filter buttons (stage coords from FLA Symbol 1076) ──
// Row 1: Equipment(607,76) NonEquipment(629,76) Resources(651,76) Quest(673,76)
// Row 2: Soul(607,95.8) Runes(629,95.8) Cards(651,95.8) CustomSet(673,95.8)
// FilterButton style: ButtonToggleUp/Down, 0.18 scale → ~18px wide
const FILTERS: Array<{ name: string; x: number; y: number }> = [
  { name: "equipment", x: 607, y: 76 },
  { name: "nonEquipment", x: 629, y: 76 },
  { name: "resources", x: 651, y: 76 },
  { name: "quest", x: 673, y: 76 },
  { name: "souls", x: 607, y: 96 },
  { name: "runes", x: 629, y: 96 },
  { name: "cards", x: 651, y: 96 },
  { name: "customSet", x: 673, y: 96 },
];

// FLA icon mapping: Equipment→FilterIcon0, NonEquipment→FilterIcon4,
// Resources→FilterIcon5, Quest→FilterIcon6, Soul→FilterIcon8,
// Runes→FilterIcon10, Cards→FilterIcon9, CustomSet→iconCustomSet
const FILTER_ICON_PATHS = [
  "/themes/classic/assets/panels/inventory/filter-equipment.svg",
  "/themes/classic/assets/panels/inventory/filter-non-equipment.svg",
  "/themes/classic/assets/panels/inventory/filter-resources.svg",
  "/themes/classic/assets/panels/inventory/filter-quest.svg",
  "/themes/classic/assets/panels/inventory/filter-souls.svg",
  "/themes/classic/assets/panels/inventory/filter-runes.svg",
  "/themes/classic/assets/panels/inventory/filter-cards.svg",
  "/themes/classic/assets/panels/inventory/filter-custom-set.svg",
];

const ASSET_BASE = "/themes/classic/assets/panels/inventory";

/** Preview character direction — facing front (towards camera) */
const PREVIEW_DIRECTION = Direction.SOUTH;

export class InventoryPanel extends BasePanel {
  private silhouetteSprite: Sprite | null = null;
  private slotContainers: Array<{ c: Container; sz: number }> = [];
  private gridCellSprites: Sprite[] = [];
  private filterIcons: Sprite[] = [];
  private filterBtns: ThreeSliceSprite[] = [];
  private filterSelected = 0;
  private toggleUpTextures: import("../core/three-slice").ThreeSliceTextures | null = null;
  private toggleDownTextures: import("../core/three-slice").ThreeSliceTextures | null = null;
  private searchIconSprite: Sprite | null = null;
  private loadGen = 0;

  /** Character gfxId for the preview sprite */
  private charGfxId = 0;
  /** The preview container (separate window left of inventory) */
  private previewContainer: Container | null = null;
  /** Character preview sprite */
  private charSprite: Sprite | null = null;
  /** Loaded frame textures for animation */
  private charTextures: Texture[] = [];
  /** Frame animation FPS */
  private charFps = 30;
  /** Frame animation state */
  private charFrameIndex = 0;
  private charFrameTimer = 0;
  /** Display dimensions for frame animation texture swap */
  private charDisplayW = 0;
  private charDisplayH = 0;
  /** Ticker for frame animation */
  private ticker: Ticker | null = null;

  constructor(zoom: number) {
    // BasePanel = inventory window only (478 x 412)
    super(zoom, INV_W, INV_H, i18n._(L.title), "inventory-panel");
  }

  /** Set the character gfxId and load the preview sprite */
  setCharacterGfx(gfxId: number): void {
    if (this.charGfxId === gfxId) return;
    this.charGfxId = gfxId;
    if (gfxId > 0) {
      this.loadCharacterPreview(gfxId);
    }
  }

  /** Stage X → inventory-panel-relative px */
  private sx(v: number): number {
    return this.p(v - INV_OX);
  }

  /** Stage Y → inventory-panel-relative px */
  private sy(v: number): number {
    return this.p(v - INV_OY);
  }

  protected buildContent(_y: number): void {
    this.slotContainers = [];
    this.gridCellSprites = [];
    this.filterIcons = [];
    this.filterBtns = [];
    this.searchIconSprite = null;
    this.buildPreview();
    this.buildEquipment();
    this.buildGrid();
    this.loadAssets();
  }

  // ── Preview: separate window to the left ──
  private buildPreview(): void {
    const pw = this.p(PREV_W);
    const ph = this.p(PREV_H);
    const gap = this.p(PREV_GAP);
    const r = this.p(5);
    const bw = this.p(3);

    const pc = new Container();
    pc.x = -(pw + gap); // offset left of the inventory panel
    pc.y = 0;

    // Window bg
    const bg = new Graphics();
    bg.roundRect(0, 0, pw, ph, r);
    bg.fill({ color: COLORS.BG });
    bg.stroke({ color: 0xffffff, width: bw });
    pc.addChild(bg);

    // Title bar
    const tH = this.p(22);
    const tR = Math.max(r - bw, 1);
    const ix = bw;
    const iy = bw;
    const iw = pw - bw * 2;
    const titleBg = new Graphics();
    titleBg.moveTo(ix + tR, iy);
    titleBg.lineTo(ix + iw - tR, iy);
    titleBg.arcTo(ix + iw, iy, ix + iw, iy + tR, tR);
    titleBg.lineTo(ix + iw, iy + tH);
    titleBg.lineTo(ix, iy + tH);
    titleBg.lineTo(ix, iy + tR);
    titleBg.arcTo(ix, iy, ix + tR, iy, tR);
    titleBg.fill({ color: COLORS.HEADER_BG });
    pc.addChild(titleBg);

    const title = new Text({
      text: "Preview",
      style: boldText(this.f(10), COLORS.TEXT_WHITE),
    });
    title.x = ix + this.p(5);
    title.y = iy + tH / 2;
    title.anchor.set(0, 0.5);
    pc.addChild(title);

    // Character preview area — pedestal + character sprite
    const cx = pw / 2;
    const pedestalY = ph - this.p(25);
    const pedR = this.p(50);
    const pedestal = new Graphics();
    pedestal.ellipse(cx, pedestalY, pedR, pedR * 0.4);
    pedestal.fill({ color: 0x3d3529, alpha: 0.5 });
    pc.addChild(pedestal);

    this.previewContainer = pc;
    this.container.addChild(pc);

    // Load character sprite if gfxId is already set
    if (this.charGfxId > 0) {
      this.loadCharacterPreview(this.charGfxId);
    }
  }

  private async loadCharacterPreview(gfxId: number): Promise<void> {
    const gen = this.loadGen;
    const dpr = window.devicePixelRatio || 1;
    // Original Dofus SpriteViewer: zoom=250 → 2.5× base sprite size.
    // Rasterize the SVG at this target size so we display 1:1 — no upscaling.
    const previewScale = 2.5;
    const res = previewScale * this.zoom * dpr;
    const suffix = getDirectionSuffix(PREVIEW_DIRECTION);
    const basePath = `/assets/spritesheets/sprites/${gfxId}`;

    // Try "static" + direction suffix, fallback to other suffixes
    let atlas: {
      width: number;
      height: number;
      offsetX: number;
      offsetY: number;
      frames: Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
      frameOrder: string[];
      duplicates: Record<string, string>;
      fps: number;
    } | null = null;
    let animName = `static${suffix}`;

    for (const tryName of [animName, "staticS", "staticR", "staticF"]) {
      try {
        const r = await fetch(`${basePath}/${tryName}/atlas.json`);
        if (r.ok) {
          atlas = await r.json();
          animName = tryName;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (!atlas || gen !== this.loadGen || !this.previewContainer) return;

    // Load SVG at the full preview resolution — no scaling needed after
    const svgPath = `${basePath}/${animName}/atlas.svg`;
    const alias = `inv-char:${gfxId}:${animName}:${res}:${gen}`;
    let baseTex: Texture;
    try {
      baseTex = await loadSvg(svgPath, res, alias);
    } catch {
      return;
    }
    if (gen !== this.loadGen || !this.previewContainer) return;

    // Build frame textures from atlas data
    const frameLookup = new Map<string, (typeof atlas.frames)[0]>();
    for (const frame of atlas.frames) {
      frameLookup.set(frame.id, frame);
    }
    const actualScale = baseTex.source.width / atlas.width;
    const textures: Texture[] = [];
    for (const frameId of atlas.frameOrder) {
      const resolvedId = atlas.duplicates[frameId] ?? frameId;
      const frame = frameLookup.get(resolvedId);
      if (!frame) continue;
      const fx = Math.round(frame.x * actualScale);
      const fy = Math.round(frame.y * actualScale);
      const fw = Math.round(frame.width * actualScale);
      const fh = Math.round(frame.height * actualScale);
      if (fw <= 0 || fh <= 0) continue;
      textures.push(
        new Texture({
          source: baseTex.source,
          frame: new Rectangle(fx, fy, fw, fh),
        }),
      );
    }
    if (textures.length === 0) return;

    this.charTextures = textures;
    this.charFps = atlas.fps || 30;
    this.charFrameIndex = 0;
    this.charFrameTimer = 0;

    // Remove old character sprite
    if (this.charSprite) {
      this.previewContainer.removeChild(this.charSprite);
      this.charSprite = null;
    }

    const pc = this.previewContainer;
    const pw = this.p(PREV_W);
    const ph = this.p(PREV_H);
    const flipped = isDirectionFlipped(PREVIEW_DIRECTION);
    const firstFrame = atlas.frames[0];

    // Display size: frame dimensions × previewScale × zoom, displayed 1:1
    // The texture was rasterized at res = previewScale * zoom * dpr,
    // and PixiJS divides by the source resolution automatically,
    // so at scale=1 the sprite is frameSize / dpr screen pixels.
    // We want frameSize * previewScale * zoom screen pixels.
    const displayW = firstFrame.width * previewScale * this.zoom;
    const displayH = firstFrame.height * previewScale * this.zoom;

    const sprite = new Sprite(textures[0]);
    // Anchor: use offsetX to find the character's center within the frame.
    // offsetX is negative = registration point is to the right of frame left edge.
    // anchorX = -offsetX / frameWidth puts the character's center at sprite.x.
    const anchorX = -atlas.offsetX / atlas.width;
    sprite.anchor.set(anchorX, 1);

    sprite.width = flipped ? -displayW : displayW;
    sprite.height = displayH;

    // Center the character in the preview window
    sprite.x = pw / 2;
    // Feet on pedestal
    sprite.y = ph - this.p(15);

    pc.addChild(sprite);
    this.charSprite = sprite;
    this.charDisplayW = displayW;
    this.charDisplayH = displayH;

    // Start frame animation if multi-frame
    this.startFrameAnimation();
  }

  private startFrameAnimation(): void {
    this.stopFrameAnimation();
    if (this.charTextures.length <= 1) return;

    this.ticker = new Ticker();
    this.ticker.add((tick) => {
      if (!this.charSprite || this.charTextures.length <= 1) return;
      this.charFrameTimer += tick.deltaMS;
      const frameDuration = 1000 / this.charFps;
      if (this.charFrameTimer >= frameDuration) {
        this.charFrameTimer -= frameDuration;
        this.charFrameIndex =
          (this.charFrameIndex + 1) % this.charTextures.length;
        this.charSprite.texture = this.charTextures[this.charFrameIndex];
        // Restore display size after texture swap (texture change resets it)
        this.charSprite.width =
          this.charSprite.width < 0 ? -this.charDisplayW : this.charDisplayW;
        this.charSprite.height = this.charDisplayH;
      }
    });
    this.ticker.start();
  }

  private stopFrameAnimation(): void {
    if (this.ticker) {
      this.ticker.stop();
      this.ticker.destroy();
      this.ticker = null;
    }
  }

  // ── Equipment area (center column of inventory window) ──
  private buildEquipment(): void {
    // FLA StylizedRectangle: equipment area bg at stage(251,54) sx=3.16 sy=1.85 → 316x185
    // Style: BrownAllRoundStylizedRectangle — all corners r=10, bgcolor=0x514A3C
    // Right edge: stage 251+316=567 (grid filter starts at 579, 12px gap)
    // Bottom edge: stage 54+185=239 (item viewer starts at 249, 10px gap)
    const eqBgX = this.sx(251);
    const eqBgY = this.sy(54);
    const eqBgW = this.p(316);
    const eqBgH = this.p(185);
    const eqBgR = this.p(10);
    const eqBg = new Graphics();
    eqBg.roundRect(eqBgX, eqBgY, eqBgW, eqBgH, eqBgR);
    eqBg.fill({ color: 0x514a3c });
    this.container.addChild(eqBg);

    // Slots
    for (const slot of SLOTS) {
      this.drawSlot(this.sx(slot.x), this.sy(slot.y), this.p(slot.s));
    }

    // Kamas
    const kamasIcon = new Text({
      text: "\u2696",
      style: boldText(this.f(10), 0x4a92c8),
    });
    kamasIcon.x = this.sx(300);
    kamasIcon.y = this.sy(220);
    this.container.addChild(kamasIcon);

    const kamasVal = new Text({
      text: "0",
      style: boldText(this.f(11), COLORS.TEXT_WHITE),
    });
    kamasVal.x = this.sx(320);
    kamasVal.y = this.sy(220);
    this.container.addChild(kamasVal);

    // Pods
    const podsLbl = new Text({
      text: i18n._(L.weight),
      style: boldText(this.f(9), COLORS.TEXT_WHITE),
    });
    podsLbl.x = this.sx(440);
    podsLbl.y = this.sy(210);
    this.container.addChild(podsLbl);

    const podBar = createProgressBar(
      this.sx(430),
      this.sy(224),
      this.p(80),
      this.p(METRICS.BAR_H)
    );
    podBar.redraw(0);
    this.container.addChild(podBar.graphics);

    // X button
    const xCx = this.sx(535);
    const xCy = this.sy(218);
    const xR = this.p(10);
    const xBtn = new Graphics();
    xBtn.circle(xCx, xCy, xR);
    xBtn.fill({ color: 0x993333 });
    xBtn.stroke({ color: 0x662222, width: 1 });
    this.container.addChild(xBtn);
    const xTxt = new Text({
      text: "x",
      style: boldText(this.f(11), COLORS.TEXT_WHITE),
    });
    xTxt.anchor.set(0.5, 0.5);
    xTxt.x = xCx;
    xTxt.y = xCy;
    this.container.addChild(xTxt);

    // FLA StylizedRectangle: item viewer area at stage(253,249) 316x179
    // Style: BrownTopRoundStylizedRectangle — tl=10,tr=10,br=0,bl=0, bgcolor=0x514A3C
    const ivBgX = this.sx(253);
    const ivBgY = this.sy(249);
    const ivBgW = this.p(316);
    const ivBgH = this.p(179);
    const ivBgR = this.p(10);
    const ivBg = new Graphics();
    ivBg.moveTo(ivBgX + ivBgR, ivBgY);
    ivBg.lineTo(ivBgX + ivBgW - ivBgR, ivBgY);
    ivBg.arcTo(ivBgX + ivBgW, ivBgY, ivBgX + ivBgW, ivBgY + ivBgR, ivBgR);
    ivBg.lineTo(ivBgX + ivBgW, ivBgY + ivBgH);
    ivBg.lineTo(ivBgX, ivBgY + ivBgH);
    ivBg.lineTo(ivBgX, ivBgY + ivBgR);
    ivBg.arcTo(ivBgX, ivBgY, ivBgX + ivBgR, ivBgY, ivBgR);
    ivBg.fill({ color: 0x514a3c });
    this.container.addChild(ivBg);

    const selTxt = new Text({
      text: i18n._(L.noItem),
      style: regularText(this.f(11), COLORS.TEXT_DARK),
    });
    selTxt.anchor.set(0.5, 0.5);
    selTxt.x = ivBgX + ivBgW / 2;
    selTxt.y = ivBgY + ivBgH / 2;
    this.container.addChild(selTxt);
  }

  // ── Item grid (right column) ──
  private buildGrid(): void {
    // FLA StylizedRectangle: filter area bg at stage(579,54) 142x89
    // Style: BrownTopRoundStylizedRectangle — cornerradius tl=10,tr=10,br=0,bl=0, bgcolor=0x514A3C
    const filterBgX = this.sx(579);
    const filterBgY = this.sy(54);
    const filterBgW = this.p(142);
    const filterBgH = this.p(89);
    const filterBgR = this.p(10);
    const filterBg = new Graphics();
    filterBg.moveTo(filterBgX + filterBgR, filterBgY);
    filterBg.lineTo(filterBgX + filterBgW - filterBgR, filterBgY);
    filterBg.arcTo(filterBgX + filterBgW, filterBgY, filterBgX + filterBgW, filterBgY + filterBgR, filterBgR);
    filterBg.lineTo(filterBgX + filterBgW, filterBgY + filterBgH);
    filterBg.lineTo(filterBgX, filterBgY + filterBgH);
    filterBg.lineTo(filterBgX, filterBgY + filterBgR);
    filterBg.arcTo(filterBgX, filterBgY, filterBgX + filterBgR, filterBgY, filterBgR);
    filterBg.fill({ color: 0x514a3c });
    this.container.addChild(filterBg);

    // FLA _cgGrid at stage(580,146) sx=1.4 sy=2.8 → 140x280
    // Grid area bg matches the container bounds
    const gridBgX = this.sx(580);
    const gridBgY = this.sy(146);
    const gridBgW = this.p(140);
    const gridBgH = this.p(280);
    const gridBg = new Graphics();
    gridBg.rect(gridBgX, gridBgY, gridBgW, gridBgH);
    gridBg.fill({ color: 0xbeb998 });
    this.container.addChild(gridBg);

    // _lblFilter: WhiteCenterMediumLabel — Font1(Verdana), size 11, center-aligned
    // width = 132px (FLA sx=1.32), centered text within
    const filterLabelW = this.p(132);
    const filterLabelX = this.sx(584);
    const label = new Text({
      text: i18n._(L.equipment),
      style: regularText(this.f(11), 0xffffff),
    });
    label.anchor.set(0.5, 0);
    label.x = filterLabelX + filterLabelW / 2;
    label.y = this.sy(56);
    this.container.addChild(label);

    // Filter buttons — ButtonToggleUp/Down 3-slice backgrounds, 18x18
    // FLA: FilterButton style, toggle=true, first selected by default
    const btnW = this.p(18);
    this.filterIcons = [];
    this.filterSelected = 0;
    for (let i = 0; i < FILTERS.length; i++) {
      const f = FILTERS[i];
      const bx = this.sx(f.x);
      const by = this.sy(f.y);

      // Filter icon — 14x14 box centered in 18x18 button
      const iconPad = this.p(2);
      const iconSz = btnW - iconPad * 2;
      const icon = new Sprite();
      icon.x = bx + iconPad;
      icon.y = by + iconPad;
      icon.width = iconSz;
      icon.height = iconSz;
      icon.eventMode = "none";
      this.container.addChild(icon);
      this.filterIcons.push(icon);
    }

    // _cbTypes dropdown — OrangeLeftComboBox style
    const dX = this.sx(583);
    const dY = this.sy(117);
    const dW = this.p(132);
    const dH = this.p(18);
    const drop = new Graphics();
    drop.roundRect(dX, dY, dW, dH, this.p(2));
    drop.fill({ color: 0xffffff });
    drop.stroke({ color: 0x4e4028, width: 1 });
    this.container.addChild(drop);

    const dTxt = new Text({
      text: "All types",
      style: regularText(this.f(10), COLORS.TEXT_DARK),
    });
    dTxt.x = dX + this.p(4);
    dTxt.y = dY + dH / 2;
    dTxt.anchor.set(0, 0.5);
    this.container.addChild(dTxt);

    // _btnMoreChoice (search/sort) — same 3-slice toggle button with doubleArrow icon
    const sX = this.sx(695);
    const searchContainer = new Container();
    searchContainer.x = sX;
    searchContainer.y = dY;
    searchContainer.eventMode = "static";
    searchContainer.cursor = "pointer";
    this.container.addChild(searchContainer);

    const searchIconPad = this.p(2);
    const searchIconSz = btnW - searchIconPad * 2;
    this.searchIconSprite = new Sprite();
    this.searchIconSprite.x = sX + searchIconPad;
    this.searchIconSprite.y = dY + searchIconPad;
    this.searchIconSprite.width = searchIconSz;
    this.searchIconSprite.height = searchIconSz;
    this.searchIconSprite.eventMode = "none";
    this.container.addChild(this.searchIconSprite);

    // Grid cells — FLA: _cgGrid at stage(580,146), container 140x280
    // InventoryGrid: visibleColumnCount=4, visibleRowCount=9, containermargin=2
    // Scrollbar = 12px wide → cell area = 140 - 12 = 128px
    // Cell size to fit: 4 cols in 128px with margin 2 → (128 - 3*2) / 4 ≈ 30
    //                   9 rows in 280px with margin 2 → (280 - 8*2) / 9 ≈ 29
    const scrollBarW = this.p(12);
    const cellAreaW = gridBgW - scrollBarW;
    const cMargin = this.p(2);
    const gridCols = 4;
    const gridRows = 9;
    const cSz = Math.floor((cellAreaW - (gridCols - 1) * cMargin) / gridCols);
    const gx0 = gridBgX;
    const gy0 = gridBgY;
    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const cx = gx0 + col * (cSz + cMargin);
        const cy = gy0 + row * (cSz + cMargin);
        this.drawGridCell(cx, cy, cSz);
      }
    }

    // Scrollbar track placeholder
    const sbX = gridBgX + gridBgW - scrollBarW;
    const sbBg = new Graphics();
    sbBg.rect(sbX, gridBgY, scrollBarW, gridBgH);
    sbBg.fill({ color: 0xbeb998 });
    this.container.addChild(sbBg);
  }

  /** Equipment slot — container filled by NineSliceSprite once textures load */
  private drawSlot(x: number, y: number, sz: number): void {
    const c = new Container();
    c.x = x;
    c.y = y;
    c.eventMode = "static";
    c.cursor = "pointer";
    this.slotContainers.push({ c, sz });
    this.container.addChild(c);
  }

  /** Grid cell — placeholder sprite, texture loaded async from grid-cell-bg.svg */
  private drawGridCell(x: number, y: number, sz: number): void {
    const spr = new Sprite();
    spr.x = x;
    spr.y = y;
    spr.width = sz;
    spr.height = sz;
    this.container.addChild(spr);
    this.gridCellSprites.push(spr);
  }

  private async loadAssets(): Promise<void> {
    const gen = ++this.loadGen;
    const res = this.zoom * (window.devicePixelRatio || 1);

    const loadSvgTex = async (path: string, alias: string) => {
      const tex = await loadSvg(path, res, `${alias}:${res}:${gen}`);
      if (gen !== this.loadGen) return null;
      return tex;
    };

    try {
      // Load SVGs + webp textures in parallel
      const [silTex, slotFillTex, slotHlTex, gridTex, searchIconTex, ...filterTexes] =
        await Promise.all([
          loadSvgTex(`${ASSET_BASE}/character-silhouette.svg`, "inv-sil"),
          loadSvgTex(`${ASSET_BASE}/equip-slot-fill.svg`, "inv-slot-fill"),
          loadSvgTex(`${ASSET_BASE}/equip-slot-highlight.svg`, "inv-slot-hl"),
          loadSvgTex(`${ASSET_BASE}/grid-cell-bg.svg`, "inv-grid"),
          loadSvgTex(`${ASSET_BASE}/icon-search.svg`, "inv-search-icon"),
          ...FILTER_ICON_PATHS.map((p, i) => loadSvgTex(p, `inv-filter-${i}`)),
        ]);

      if (gen !== this.loadGen) return;

      // Silhouette
      if (silTex) {
        if (this.silhouetteSprite) {
          this.container.removeChild(this.silhouetteSprite);
        }
        this.silhouetteSprite = new Sprite(silTex);
        this.silhouetteSprite.width = this.p(148);
        this.silhouetteSprite.height = this.p(159);
        this.silhouetteSprite.x = this.sx(329);
        this.silhouetteSprite.y = this.sy(63);
        this.silhouetteSprite.eventMode = "none";
        const idx = Math.min(10, this.container.children.length);
        this.container.addChildAt(this.silhouetteSprite, idx);
      }

      // Equipment slots — fill + highlight SVG sprites
      for (const { c, sz } of this.slotContainers) {
        if (slotFillTex) {
          const fill = new Sprite(slotFillTex);
          fill.width = sz;
          fill.height = sz;
          c.addChild(fill);
        }

        if (slotHlTex) {
          const hl = new Sprite(slotHlTex);
          hl.width = sz;
          hl.height = sz;
          hl.visible = false;
          c.addChild(hl);

          c.on("pointerover", () => {
            hl.visible = true;
          });
          c.on("pointerout", () => {
            hl.visible = false;
          });
        }
      }

      // Apply grid cell SVG texture
      if (gridTex) {
        for (const spr of this.gridCellSprites) {
          const w = spr.width;
          const h = spr.height;
          spr.texture = gridTex;
          spr.width = w;
          spr.height = h;
        }
      }

      // Load 3-slice toggle button texture sets (cached for toggle switching)
      const btnW = this.p(18);
      const commonBase = "/themes/classic/assets/common";

      const [upTextures, downTextures] = await Promise.all([
        ThreeSliceSprite.loadTextures(`${commonBase}/btn-toggle-up`, res).catch(() => null),
        ThreeSliceSprite.loadTextures(`${commonBase}/btn-toggle-down`, res).catch(() => null),
      ]);
      if (gen !== this.loadGen) return;
      this.toggleUpTextures = upTextures;
      this.toggleDownTextures = downTextures;

      // Create filter buttons using 3-slice, attach click handlers
      for (let i = 0; i < FILTERS.length; i++) {
        const f = FILTERS[i];
        const bx = this.sx(f.x);
        const by = this.sy(f.y);
        const isSelected = i === this.filterSelected;
        const texSet = isSelected ? downTextures : upTextures;

        if (texSet) {
          const btn = new ThreeSliceSprite(btnW, btnW);
          btn.setTextures(texSet);
          btn.x = bx;
          btn.y = by;
          btn.eventMode = "static";
          btn.cursor = "pointer";
          const idx = i;
          btn.on("pointerup", () => this.selectFilter(idx));
          // Insert behind the icon sprite
          const iconIdx = this.container.getChildIndex(this.filterIcons[i]);
          this.container.addChildAt(btn, iconIdx);
          this.filterBtns.push(btn);
        }
      }

      // Search button (always up state)
      if (upTextures) {
        const sX = this.sx(695);
        const dY = this.sy(117);
        const searchBtn = new ThreeSliceSprite(btnW, btnW);
        searchBtn.setTextures(upTextures);
        searchBtn.x = sX;
        searchBtn.y = dY;
        const iconIdx = this.searchIconSprite
          ? this.container.getChildIndex(this.searchIconSprite)
          : this.container.children.length;
        this.container.addChildAt(searchBtn, iconIdx);
      }

      // Apply search icon — fit within box
      if (searchIconTex && this.searchIconSprite) {
        const origX = this.searchIconSprite.x;
        const origY = this.searchIconSprite.y;
        const boxSz = btnW - this.p(2) * 2;
        this.searchIconSprite.texture = searchIconTex;
        const tw = searchIconTex.width;
        const th = searchIconTex.height;
        if (tw > 0 && th > 0) {
          const s = Math.min(boxSz / tw, boxSz / th);
          this.searchIconSprite.width = tw * s;
          this.searchIconSprite.height = th * s;
          this.searchIconSprite.x = origX + (boxSz - tw * s) / 2;
          this.searchIconSprite.y = origY + (boxSz - th * s) / 2;
        }
      }

      // Apply filter icons — fit within icon box, preserving aspect ratio
      const iconPad = this.p(2);
      const iconSz = btnW - iconPad * 2;
      for (let i = 0; i < filterTexes.length && i < this.filterIcons.length; i++) {
        const tex = filterTexes[i];
        if (tex) {
          const spr = this.filterIcons[i];
          const origX = spr.x;
          const origY = spr.y;
          spr.texture = tex;
          // Fit within iconSz x iconSz preserving aspect ratio
          const tw = tex.width;
          const th = tex.height;
          if (tw > 0 && th > 0) {
            const s = Math.min(iconSz / tw, iconSz / th);
            spr.width = tw * s;
            spr.height = th * s;
            // Re-center within the icon box
            spr.x = origX + (iconSz - tw * s) / 2;
            spr.y = origY + (iconSz - th * s) / 2;
          } else {
            spr.width = iconSz;
            spr.height = iconSz;
          }
        }
      }
    } catch {
      // Asset loading failed
    }
  }

  private selectFilter(idx: number): void {
    if (idx === this.filterSelected) return;

    // Swap textures: previous -> up, new -> down
    const prevBtn = this.filterBtns[this.filterSelected];
    if (prevBtn && this.toggleUpTextures) {
      prevBtn.setTextures(this.toggleUpTextures);
    }

    this.filterSelected = idx;
    const nextBtn = this.filterBtns[idx];
    if (nextBtn && this.toggleDownTextures) {
      nextBtn.setTextures(this.toggleDownTextures);
    }
  }

  override destroy(): void {
    this.loadGen++;
    this.stopFrameAnimation();
    this.charSprite = null;
    this.charTextures = [];
    this.previewContainer = null;
    this.filterIcons = [];
    super.destroy();
  }
}
