import { type Application, Container, Graphics, Text } from "pixi.js";

import { WorldMapRenderer } from "@/ank/gapi/worldmap";
import { i18n } from "@/i18n";
import { worldMapLabels } from "@/i18n/hud.messages";

import { boldText, COLORS, createCloseButton, METRICS } from "../core";

const HEADER_H = 24;
const PADDING = 8;

export class WorldMapPanel {
  public container: Container;

  private app: Application;
  private renderer: WorldMapRenderer | null = null;
  private mapContainer: Container;
  private clipMask: Graphics;
  private bg: Graphics;
  private header: Graphics;
  private closeBtn: Container;
  private loaded = false;
  private areaW = 0;
  private areaH = 0;
  private onClose?: () => void;
  private onTeleport?: (mapId: number) => void;

  constructor(app: Application) {
    this.app = app;
    this.container = new Container();
    this.container.label = "world-map-panel";
    this.container.visible = false;
    this.container.eventMode = "static";

    this.bg = new Graphics();
    this.bg.eventMode = "static";
    this.container.addChild(this.bg);

    this.header = new Graphics();
    this.container.addChild(this.header);

    const title = new Text({
      text: i18n._(worldMapLabels.title),
      style: boldText(13, COLORS.TEXT_WHITE),
    });
    title.anchor.set(0, 0.5);
    title.x = PADDING + 4;
    title.y = HEADER_H / 2;
    this.container.addChild(title);

    this.closeBtn = createCloseButton(() => this.hide());
    this.closeBtn.y = (HEADER_H - METRICS.CLOSE_SIZE) / 2;
    this.container.addChild(this.closeBtn);

    this.mapContainer = new Container();
    this.mapContainer.y = HEADER_H;
    this.container.addChild(this.mapContainer);

    // Clip mask so map content doesn't overflow the panel
    this.clipMask = new Graphics();
    this.container.addChild(this.clipMask);
    this.mapContainer.mask = this.clipMask;
  }

  /** Set the game render area size (call before show, and on resize). */
  setArea(w: number, h: number): void {
    this.areaW = w;
    this.areaH = h;

    this.bg.clear();
    this.bg.rect(0, 0, w, h);
    this.bg.fill({ color: 0x000000, alpha: 0.92 });

    this.header.clear();
    this.header.rect(0, 0, w, HEADER_H);
    this.header.fill({ color: COLORS.HEADER_BG });

    this.closeBtn.x = w - METRICS.CLOSE_SIZE - PADDING;

    // Update clip mask
    const contentH = h - HEADER_H;
    this.clipMask.clear();
    this.clipMask.rect(0, HEADER_H, w, contentH);
    this.clipMask.fill({ color: 0xffffff });

    this.renderer?.setViewSize(w, contentH);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    this.renderer = new WorldMapRenderer({
      app: this.app,
      parentContainer: this.mapContainer,
      onTeleport: (mapId) => this.onTeleport?.(mapId),
    });

    this.renderer.setViewSize(this.areaW, this.areaH - HEADER_H);
    await this.renderer.loadWorldMap(0);
    this.loaded = true;
  }

  async show(currentMapId?: number): Promise<void> {
    await this.ensureLoaded();
    this.container.visible = true;
    this.renderer?.show();
    if (currentMapId != null) {
      this.renderer?.centerOnMapId(currentMapId);
    }
  }

  hide(): void {
    this.container.visible = false;
    this.renderer?.hide();
    this.onClose?.();
  }

  toggle(currentMapId?: number): void {
    if (this.container.visible) {
      this.hide();
    } else {
      this.show(currentMapId);
    }
  }

  isVisible(): boolean {
    return this.container.visible;
  }

  setOnClose(fn: () => void): void {
    this.onClose = fn;
  }

  setOnTeleport(fn: (mapId: number) => void): void {
    this.onTeleport = fn;
  }

  destroy(): void {
    this.renderer?.destroy();
    this.renderer = null;
    this.container.destroy({ children: true });
  }
}
