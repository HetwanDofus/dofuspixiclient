import { Graphics, Text } from "pixi.js";

import { i18n } from "@/i18n";
import { friendsLabels as L } from "@/i18n/hud.messages";

import { BasePanel } from "../core/base-panel";
import { createSectionHeader } from "../core/panel-builder";
import { TabBar } from "../core/tab-bar";
import { boldText, COLORS, METRICS } from "../core/theme";

export class FriendsPanel extends BasePanel {
  private tabBar: TabBar | null = null;

  constructor(zoom: number) {
    super(zoom, 280, 368, i18n._(L.title), "friends-panel");
  }

  protected buildContent(y: number): void {
    const W = this.panelW;
    const PX = this.p(METRICS.PX);
    const ROW_H = this.p(METRICS.ROW_H);

    // Tab bar
    this.tabBar = new TabBar(
      [
        { key: "friends", label: i18n._(L.friends) },
        { key: "enemies", label: i18n._(L.enemies) },
        { key: "ignored", label: i18n._(L.ignored) },
      ],
      W,
      this.zoom
    );
    this.tabBar.container.y = y;
    this.container.addChild(this.tabBar.container);
    y += this.tabBar.tabHeight;

    // Online section
    const onlineHdr = createSectionHeader(y, W, i18n._(L.online), this.zoom);
    this.container.addChild(onlineHdr.graphics);
    this.container.addChild(onlineHdr.text);
    y = onlineHdr.nextY;

    // Online list (placeholder - 5 empty rows)
    const altBg1 = new Graphics();
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 1) {
        altBg1.rect(0, y + i * ROW_H, W, ROW_H);
        altBg1.fill({ color: COLORS.BG_ALT });
      }
    }
    this.container.addChild(altBg1);
    y += 5 * ROW_H;

    // Offline section
    const offlineHdr = createSectionHeader(y, W, i18n._(L.offline), this.zoom);
    this.container.addChild(offlineHdr.graphics);
    this.container.addChild(offlineHdr.text);
    y = offlineHdr.nextY;

    // Offline list (placeholder - 5 empty rows)
    const altBg2 = new Graphics();
    for (let i = 0; i < 5; i++) {
      if (i % 2 === 1) {
        altBg2.rect(0, y + i * ROW_H, W, ROW_H);
        altBg2.fill({ color: COLORS.BG_ALT });
      }
    }
    this.container.addChild(altBg2);
    y += 5 * ROW_H;

    // Add friend input area
    y += this.p(4);
    const addLabel = new Text({
      text: i18n._(L.addFriend),
      style: boldText(this.f(10), COLORS.TEXT_DARK),
    });
    addLabel.x = PX;
    addLabel.y = y;
    this.container.addChild(addLabel);
    y += this.p(16);

    // Input placeholder
    const inputH = this.p(20);
    const inputW = W - PX * 2 - this.p(50);
    const inputBg = new Graphics();
    inputBg.roundRect(PX, y, inputW, inputH, this.p(3));
    inputBg.fill({ color: 0xffffff });
    inputBg.stroke({ color: COLORS.BORDER, width: 1 });
    this.container.addChild(inputBg);

    // Add button
    const btnW = this.p(44);
    const btnX = PX + inputW + this.p(4);
    const btn = new Graphics();
    btn.roundRect(btnX, y, btnW, inputH, this.p(3));
    btn.fill({ color: COLORS.HEADER_BG });
    btn.eventMode = "static";
    btn.cursor = "pointer";
    this.container.addChild(btn);

    const btnText = new Text({
      text: i18n._(L.add),
      style: boldText(this.f(9), COLORS.TEXT_WHITE),
    });
    btnText.anchor.set(0.5, 0.5);
    btnText.x = btnX + btnW / 2;
    btnText.y = y + inputH / 2;
    this.container.addChild(btnText);
  }

  override destroy(): void {
    this.tabBar?.destroy();
    super.destroy();
  }
}
