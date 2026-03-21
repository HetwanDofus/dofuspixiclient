import { Graphics, Text } from "pixi.js";

import { i18n } from "@/i18n";
import { conquestLabels as L } from "@/i18n/hud.messages";

import { BasePanel } from "../core/base-panel";
import { createProgressBar, createSectionHeader } from "../core/panel-builder";
import { TabBar } from "../core/tab-bar";
import { boldText, COLORS, METRICS, regularText } from "../core/theme";

export class ConquestPanel extends BasePanel {
  private tabBar: TabBar | null = null;

  constructor(zoom: number) {
    super(zoom, 228, 358, i18n._(L.title), "conquest-panel");
  }

  protected buildContent(y: number): void {
    const W = this.panelW;
    const PX = this.p(METRICS.PX);
    const ROW_H = this.p(METRICS.ROW_H);
    const BAR_H = this.p(METRICS.BAR_H);

    // Tab bar
    this.tabBar = new TabBar(
      [
        { key: "stats", label: i18n._(L.stats) },
        { key: "zones", label: i18n._(L.zones) },
        { key: "join", label: i18n._(L.join) },
      ],
      W,
      this.zoom
    );
    this.tabBar.container.y = y;
    this.container.addChild(this.tabBar.container);
    y += this.tabBar.tabHeight;

    // Stats tab content

    // World balance section
    const worldHdr = createSectionHeader(
      y,
      W,
      i18n._(L.worldBalance),
      this.zoom
    );
    this.container.addChild(worldHdr.graphics);
    this.container.addChild(worldHdr.text);
    y = worldHdr.nextY;

    y += this.p(4);
    const barX = this.p(8);
    const barW = W - barX * 2;
    const worldBar = createProgressBar(barX, y, barW, BAR_H);
    worldBar.redraw(0.5);
    this.container.addChild(worldBar.graphics);
    y += BAR_H + this.p(12);

    // Area balance section
    const areaHdr = createSectionHeader(y, W, i18n._(L.areaBalance), this.zoom);
    this.container.addChild(areaHdr.graphics);
    this.container.addChild(areaHdr.text);
    y = areaHdr.nextY;

    y += this.p(4);
    const areaBar = createProgressBar(barX, y, barW, BAR_H);
    areaBar.redraw(0.5);
    this.container.addChild(areaBar.graphics);
    y += BAR_H + this.p(12);

    // PvP status row
    const pvpBg = new Graphics();
    pvpBg.rect(0, y, W, ROW_H);
    pvpBg.fill({ color: COLORS.BG_ALT });
    this.container.addChild(pvpBg);

    // PvP indicator circle
    const circleR = this.p(5);
    const indicator = new Graphics();
    indicator.circle(PX + circleR, y + ROW_H / 2, circleR);
    indicator.fill({ color: 0xcc3333 });
    this.container.addChild(indicator);

    const pvpLabel = new Text({
      text: i18n._(L.pvpInactive),
      style: boldText(this.f(11), COLORS.TEXT_DARK),
    });
    pvpLabel.x = PX + circleR * 2 + this.p(8);
    pvpLabel.y = y + ROW_H / 2;
    pvpLabel.anchor.set(0, 0.5);
    this.container.addChild(pvpLabel);
    y += ROW_H;

    // Alignment row
    const alignLabel = new Text({
      text: i18n._(L.alignment),
      style: boldText(this.f(11), COLORS.TEXT_DARK),
    });
    alignLabel.x = PX;
    alignLabel.y = y + ROW_H / 2;
    alignLabel.anchor.set(0, 0.5);
    this.container.addChild(alignLabel);

    const alignVal = new Text({
      text: "—",
      style: regularText(this.f(11), COLORS.TEXT_DARK),
    });
    alignVal.anchor.set(1, 0.5);
    alignVal.x = W - PX;
    alignVal.y = y + ROW_H / 2;
    this.container.addChild(alignVal);
    y += ROW_H;

    // Guild ranking section
    const rankHdr = createSectionHeader(
      y,
      W,
      i18n._(L.guildRanking),
      this.zoom
    );
    this.container.addChild(rankHdr.graphics);
    this.container.addChild(rankHdr.text);
    y = rankHdr.nextY;

    // Placeholder ranking rows
    const altBg = new Graphics();
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 1) {
        altBg.rect(0, y + i * ROW_H, W, ROW_H);
        altBg.fill({ color: COLORS.BG_ALT });
      }
    }
    this.container.addChild(altBg);
  }

  override destroy(): void {
    this.tabBar?.destroy();
    super.destroy();
  }
}
