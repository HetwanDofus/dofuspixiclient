import { Graphics, Text } from "pixi.js";

import { i18n } from "@/i18n";
import { questsLabels as L } from "@/i18n/hud.messages";

import { BasePanel } from "../core/base-panel";
import { createSectionHeader } from "../core/panel-builder";
import { TabBar } from "../core/tab-bar";
import { boldText, COLORS, METRICS, regularText } from "../core/theme";

export class QuestsPanel extends BasePanel {
  private tabBar: TabBar | null = null;

  constructor(zoom: number) {
    super(zoom, 280, 312, i18n._(L.title), "quests-panel");
  }

  protected buildContent(y: number): void {
    const W = this.panelW;
    const PX = this.p(METRICS.PX);
    const ROW_H = this.p(METRICS.ROW_H);

    // Tab bar
    this.tabBar = new TabBar(
      [
        { key: "current", label: i18n._(L.currentStep) },
        { key: "all", label: i18n._(L.stepsList) },
      ],
      W,
      this.zoom
    );
    this.tabBar.container.y = y;
    this.container.addChild(this.tabBar.container);
    y += this.tabBar.tabHeight;

    // Column headers
    const hdr = createSectionHeader(y, W, "", this.zoom);
    this.container.addChild(hdr.graphics);

    const statusCol = new Text({
      text: i18n._(L.status),
      style: boldText(this.f(10), COLORS.TEXT_WHITE),
    });
    statusCol.x = PX;
    statusCol.y = y + this.p(METRICS.HEADER_H) / 2;
    statusCol.anchor.set(0, 0.5);
    this.container.addChild(statusCol);

    const nameCol = new Text({
      text: i18n._(L.name),
      style: boldText(this.f(10), COLORS.TEXT_WHITE),
    });
    nameCol.x = this.p(60);
    nameCol.y = statusCol.y;
    nameCol.anchor.set(0, 0.5);
    this.container.addChild(nameCol);
    y = hdr.nextY;

    // Quest list rows (placeholder - 10 empty rows)
    const altBg = new Graphics();
    const numRows = 10;
    for (let i = 0; i < numRows; i++) {
      if (i % 2 === 1) {
        altBg.rect(0, y + i * ROW_H, W, ROW_H);
        altBg.fill({ color: COLORS.BG_ALT });
      }
    }
    this.container.addChild(altBg);
    y += numRows * ROW_H;

    // Finished quests toggle row
    const toggleH = this.p(22);
    const toggleBg = new Graphics();
    toggleBg.rect(0, y, W, toggleH);
    toggleBg.fill({ color: COLORS.BG_ALT });
    this.container.addChild(toggleBg);

    // Checkbox placeholder
    const cbSize = this.p(12);
    const cb = new Graphics();
    cb.rect(PX, y + (toggleH - cbSize) / 2, cbSize, cbSize);
    cb.fill({ color: COLORS.SLOT_BG });
    cb.stroke({ color: COLORS.BORDER, width: 1 });
    cb.eventMode = "static";
    cb.cursor = "pointer";
    this.container.addChild(cb);

    const finLabel = new Text({
      text: i18n._(L.finishedQuests),
      style: regularText(this.f(10), COLORS.TEXT_DARK),
    });
    finLabel.x = PX + cbSize + this.p(6);
    finLabel.y = y + toggleH / 2;
    finLabel.anchor.set(0, 0.5);
    this.container.addChild(finLabel);
    y += toggleH;

    // Quest count footer
    const footerH = this.p(20);
    const countText = new Text({
      text: i18n._(L.questCount.id, { count: 0 }),
      style: regularText(this.f(10), COLORS.TEXT_DARK),
    });
    countText.anchor.set(1, 0.5);
    countText.x = W - PX;
    countText.y = y + footerH / 2;
    this.container.addChild(countText);
  }

  override destroy(): void {
    this.tabBar?.destroy();
    super.destroy();
  }
}
