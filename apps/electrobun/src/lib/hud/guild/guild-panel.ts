import { Graphics, Text } from "pixi.js";

import { i18n } from "@/i18n";
import { guildLabels as L } from "@/i18n/hud.messages";

import { BasePanel } from "../core/base-panel";
import {
  createProgressBar,
  createSectionHeader,
  createSlot,
} from "../core/panel-builder";
import { TabBar } from "../core/tab-bar";
import { boldText, COLORS, METRICS, regularText } from "../core/theme";

export class GuildPanel extends BasePanel {
  private tabBar: TabBar | null = null;

  constructor(zoom: number) {
    super(zoom, 320, 363, i18n._(L.title), "guild-panel");
  }

  protected buildContent(y: number): void {
    const W = this.panelW;
    const PX = this.p(METRICS.PX);
    const ROW_H = this.p(METRICS.ROW_H);
    const BAR_H = this.p(METRICS.BAR_H);

    // Tab bar (6 tabs)
    this.tabBar = new TabBar(
      [
        { key: "members", label: i18n._(L.members) },
        { key: "info", label: i18n._(L.info) },
        { key: "boosts", label: i18n._(L.boosts) },
        { key: "tax", label: i18n._(L.taxCollectors) },
        { key: "parks", label: i18n._(L.mountParks) },
        { key: "houses", label: i18n._(L.houses) },
      ],
      W,
      this.zoom
    );
    this.tabBar.container.y = y;
    this.container.addChild(this.tabBar.container);
    y += this.tabBar.tabHeight;

    // Default tab: Members

    // Emblem placeholder
    y += this.p(8);
    const emblemSize = this.p(48);
    const emblemX = (W - emblemSize) / 2;
    const emblemSlot = createSlot(emblemX, y, emblemSize);
    this.container.addChild(emblemSlot.graphics);

    const emblemLabel = new Text({
      text: i18n._(L.emblem),
      style: regularText(this.f(9), COLORS.TEXT_DARK),
    });
    emblemLabel.anchor.set(0.5, 0);
    emblemLabel.x = W / 2;
    emblemLabel.y = y + emblemSize + this.p(2);
    this.container.addChild(emblemLabel);
    y += emblemSize + this.p(18);

    // Level + XP bar
    const levelLabel = new Text({
      text: i18n._(L.level.id, { level: 1 }),
      style: boldText(this.f(12), COLORS.TEXT_DARK),
    });
    levelLabel.anchor.set(0.5, 0.5);
    levelLabel.x = W / 2;
    levelLabel.y = y + ROW_H / 2;
    this.container.addChild(levelLabel);
    y += ROW_H;

    const xpLabel = new Text({
      text: i18n._(L.xp),
      style: boldText(this.f(11), COLORS.TEXT_DARK),
    });
    xpLabel.x = PX;
    xpLabel.y = y + ROW_H / 2;
    xpLabel.anchor.set(0, 0.5);
    this.container.addChild(xpLabel);

    const barX = this.p(90);
    const xpBar = createProgressBar(
      barX,
      y + (ROW_H - BAR_H) / 2,
      W - barX - PX,
      BAR_H
    );
    xpBar.redraw(0);
    this.container.addChild(xpBar.graphics);
    y += ROW_H + this.p(4);

    // Guild note section
    const noteHdr = createSectionHeader(y, W, i18n._(L.guildNote), this.zoom);
    this.container.addChild(noteHdr.graphics);
    this.container.addChild(noteHdr.text);
    y = noteHdr.nextY;

    // Note text area placeholder
    const noteH = this.p(80);
    const noteBg = new Graphics();
    noteBg.roundRect(PX, y + this.p(4), W - PX * 2, noteH, this.p(3));
    noteBg.fill({ color: 0xffffff });
    noteBg.stroke({ color: COLORS.BORDER, width: 1 });
    this.container.addChild(noteBg);
    y += noteH + this.p(12);

    // Members list section
    const membersHdr = createSectionHeader(y, W, i18n._(L.members), this.zoom);
    this.container.addChild(membersHdr.graphics);
    this.container.addChild(membersHdr.text);
    y = membersHdr.nextY;

    // Placeholder member rows
    const altBg = new Graphics();
    const numRows = 6;
    for (let i = 0; i < numRows; i++) {
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
