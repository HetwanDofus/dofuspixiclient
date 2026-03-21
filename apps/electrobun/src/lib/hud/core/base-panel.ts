import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import { loadSvg } from "@/render/load-svg";
import { getAssetPath } from "@/themes";

import { boldText, COLORS, METRICS } from "./theme";

export abstract class BasePanel {
  public container: Container;
  public panelW: number;
  public panelH: number;

  protected zoom: number;
  protected baseW: number;
  protected baseH: number;
  protected title: string;

  private onClose?: () => void;

  constructor(
    zoom: number,
    baseW: number,
    baseH: number,
    title: string,
    label: string,
  ) {
    this.zoom = zoom;
    this.baseW = baseW;
    this.baseH = baseH;
    this.title = title;
    this.container = new Container();
    this.container.label = label;
    this.container.visible = false;
    this.container.eventMode = "static";

    this.panelW = Math.round(baseW * zoom);
    this.panelH = Math.round(baseH * zoom);

    this.build();
  }

  /** Scale integer pixels */
  protected p(n: number): number {
    return Math.round(n * this.zoom);
  }

  /** Scale float */
  protected f(n: number): number {
    return n * this.zoom;
  }

  rebuild(zoom: number): void {
    this.zoom = zoom;
    this.panelW = Math.round(this.baseW * zoom);
    this.panelH = Math.round(this.baseH * zoom);
    this.container.removeChildren();
    this.build();
  }

  private build(): void {
    const W = this.panelW;
    const H = this.panelH;
    // Original Dofus LightBrownPanelWindow: border=3 white, cornerradius tl/tr=13 br/bl=0
    const border = this.p(3);
    const r = this.p(13);
    const titleH = this.p(22);

    const IR = r - border; // inner corner radius

    // 1. White border fill (outer U-shape, no bottom)
    const borderFill = new Graphics();
    borderFill.moveTo(0, H);
    borderFill.lineTo(0, r);
    borderFill.arcTo(0, 0, r, 0, r);
    borderFill.lineTo(W - r, 0);
    borderFill.arcTo(W, 0, W, r, r);
    borderFill.lineTo(W, H);
    // Inner cutout back up
    borderFill.lineTo(W - border, H);
    borderFill.lineTo(W - border, border + IR);
    borderFill.arcTo(W - border, border, W - border - IR, border, IR);
    borderFill.lineTo(border + IR, border);
    borderFill.arcTo(border, border, border, border + IR, IR);
    borderFill.lineTo(border, H);
    borderFill.lineTo(0, H);
    borderFill.fill({ color: 0xffffff });
    borderFill.eventMode = "static";
    this.container.addChild(borderFill);

    // 2. Background fill (inside border, no bottom border)
    const bgFill = new Graphics();
    bgFill.moveTo(border + IR, border);
    bgFill.lineTo(W - border - IR, border);
    bgFill.arcTo(W - border, border, W - border, border + IR, IR);
    bgFill.lineTo(W - border, H);
    bgFill.lineTo(border, H);
    bgFill.lineTo(border, border + IR);
    bgFill.arcTo(border, border, border + IR, border, IR);
    bgFill.fill({ color: COLORS.BG });
    this.container.addChild(bgFill);

    // 3. Title bar (dark, inside border, rounded top)
    const titleBg = new Graphics();
    titleBg.moveTo(border + IR, border);
    titleBg.lineTo(W - border - IR, border);
    titleBg.arcTo(W - border, border, W - border, border + IR, IR);
    titleBg.lineTo(W - border, border + titleH);
    titleBg.lineTo(border, border + titleH);
    titleBg.lineTo(border, border + IR);
    titleBg.arcTo(border, border, border + IR, border, IR);
    titleBg.fill({ color: COLORS.HEADER_BG });
    this.container.addChild(titleBg);

    // borderG kept as reference for z-order overlay (added at end)
    const borderG = new Container();
    borderG.eventMode = "none";

    // Title text
    const titleText = new Text({
      text: this.title,
      style: boldText(this.f(11), COLORS.TEXT_WHITE),
    });
    titleText.anchor.set(0, 0.5);
    titleText.x = border + this.p(5);
    titleText.y = border + titleH / 2;
    this.container.addChild(titleText);

    // Close button — top right of title bar (SVG from SWF)
    const closeSize = this.p(METRICS.CLOSE_SIZE);
    const closeBtn = new Container();
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";

    const closeUp = new Sprite(Texture.EMPTY);
    closeUp.width = closeSize;
    closeUp.height = closeSize;
    closeBtn.addChild(closeUp);

    const closeDown = new Sprite(Texture.EMPTY);
    closeDown.width = closeSize;
    closeDown.height = closeSize;
    closeDown.visible = false;
    closeBtn.addChild(closeDown);

    // Load close button SVGs
    const res = this.zoom * (globalThis.devicePixelRatio || 1);
    const commonPath = getAssetPath("common");
    loadSvg(`${commonPath}/close-up.svg`, res).then((tex) => {
      closeUp.texture = tex;
      closeUp.width = closeSize;
      closeUp.height = closeSize;
    }).catch(() => {});
    loadSvg(`${commonPath}/close-down.svg`, res).then((tex) => {
      closeDown.texture = tex;
      closeDown.width = closeSize;
      closeDown.height = closeSize;
    }).catch(() => {});

    closeBtn.x = W - border - closeSize - this.p(3);
    closeBtn.y = border + (titleH - closeSize) / 2;
    closeBtn.on("pointerdown", () => {
      closeUp.visible = false;
      closeDown.visible = true;
    });
    closeBtn.on("pointerup", () => {
      closeUp.visible = true;
      closeDown.visible = false;
      this.hide();
      this.onClose?.();
    });
    closeBtn.on("pointerupoutside", () => {
      closeUp.visible = true;
      closeDown.visible = false;
    });
    this.container.addChild(closeBtn);

    // Content area starts below title, inset by border
    const contentY = border + titleH;
    this.buildContent(contentY);

    // Border overlay on top
    this.container.addChild(borderG);
  }

  /** Override to add panel-specific content. `y` is the top of the content area. */
  protected abstract buildContent(y: number): void;

  // --- Public API ---

  setOnClose(fn: () => void): void {
    this.onClose = fn;
  }

  toggle(): void {
    this.container.visible = !this.container.visible;
  }

  show(): void {
    this.container.visible = true;
  }

  hide(): void {
    this.container.visible = false;
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  setPosition(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  onResize(event: { baseZoom: number }): void {
    this.rebuild(event.baseZoom);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
