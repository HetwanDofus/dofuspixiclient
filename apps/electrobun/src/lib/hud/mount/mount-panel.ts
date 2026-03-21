import { Graphics, Text } from "pixi.js";

import { i18n } from "@/i18n";
import { mountLabels as L } from "@/i18n/hud.messages";

import { BasePanel } from "../core/base-panel";
import { createProgressBar } from "../core/panel-builder";
import { boldText, COLORS, METRICS, regularText } from "../core/theme";

const STAT_ROWS = ["energy", "maturity", "love"] as const;

export class MountPanel extends BasePanel {
  constructor(zoom: number) {
    super(zoom, 250, 300, i18n._(L.title), "mount-panel");
  }

  protected buildContent(y: number): void {
    const W = this.panelW;
    const PX = this.p(METRICS.PX);
    const ROW_H = this.p(METRICS.ROW_H);
    const BAR_H = this.p(METRICS.BAR_H);

    y += this.p(8);

    // Mount viewer frame
    const frameW = this.p(140);
    const frameH = this.p(100);
    const frameX = (W - frameW) / 2;
    const frame = new Graphics();
    frame.roundRect(frameX, y, frameW, frameH, this.p(4));
    frame.fill({ color: COLORS.SLOT_BG });
    frame.stroke({ color: COLORS.BORDER, width: 2 });
    this.container.addChild(frame);

    // "No mount" placeholder text
    const noMount = new Text({
      text: i18n._(L.noMount),
      style: regularText(this.f(11), COLORS.TEXT_DARK),
    });
    noMount.anchor.set(0.5, 0.5);
    noMount.x = frameX + frameW / 2;
    noMount.y = y + frameH / 2;
    this.container.addChild(noMount);
    y += frameH + this.p(8);

    // Name row
    const nameLabel = new Text({
      text: `${i18n._(L.name)} :`,
      style: boldText(this.f(11), COLORS.TEXT_DARK),
    });
    nameLabel.x = PX;
    nameLabel.y = y + ROW_H / 2;
    nameLabel.anchor.set(0, 0.5);
    this.container.addChild(nameLabel);

    const nameVal = new Text({
      text: "—",
      style: regularText(this.f(11), COLORS.TEXT_DARK),
    });
    nameVal.anchor.set(1, 0.5);
    nameVal.x = W - PX;
    nameVal.y = y + ROW_H / 2;
    this.container.addChild(nameVal);
    y += ROW_H;

    // XP bar row
    const xpLabel = new Text({
      text: i18n._(L.xp),
      style: boldText(this.f(11), COLORS.TEXT_DARK),
    });
    xpLabel.x = PX;
    xpLabel.y = y + ROW_H / 2;
    xpLabel.anchor.set(0, 0.5);
    this.container.addChild(xpLabel);

    const barX = this.p(90);
    const bar = createProgressBar(
      barX,
      y + (ROW_H - BAR_H) / 2,
      W - barX - PX,
      BAR_H
    );
    bar.redraw(0);
    this.container.addChild(bar.graphics);
    y += ROW_H;

    // Stat rows
    const altBg = new Graphics();
    for (let i = 0; i < STAT_ROWS.length; i++) {
      const rowY = y + i * ROW_H;
      if (i % 2 === 1) {
        altBg.rect(0, rowY, W, ROW_H);
        altBg.fill({ color: COLORS.BG_ALT });
      }

      const label = new Text({
        text: i18n._(L[STAT_ROWS[i]]),
        style: boldText(this.f(11), COLORS.TEXT_DARK),
      });
      label.x = PX;
      label.y = rowY + ROW_H / 2;
      label.anchor.set(0, 0.5);
      this.container.addChild(label);

      const val = new Text({
        text: "0",
        style: boldText(this.f(11), COLORS.TEXT_DARK),
      });
      val.anchor.set(1, 0.5);
      val.x = W - PX;
      val.y = rowY + ROW_H / 2;
      this.container.addChild(val);
    }
    this.container.addChild(altBg);
    y += STAT_ROWS.length * ROW_H + this.p(8);

    // Bottom buttons: Ride / Release
    const btnW = this.p(90);
    const btnH = this.p(24);
    const btnGap = this.p(12);
    const totalBtnW = btnW * 2 + btnGap;
    const btnStartX = (W - totalBtnW) / 2;

    for (let i = 0; i < 2; i++) {
      const bx = btnStartX + i * (btnW + btnGap);
      const btn = new Graphics();
      btn.roundRect(bx, y, btnW, btnH, this.p(4));
      btn.fill({ color: COLORS.HEADER_BG });
      btn.stroke({ color: COLORS.BORDER, width: 1 });
      btn.eventMode = "static";
      btn.cursor = "pointer";
      this.container.addChild(btn);

      const btnLabel = new Text({
        text: i18n._(i === 0 ? L.ride : L.release),
        style: boldText(this.f(10), COLORS.TEXT_WHITE),
      });
      btnLabel.anchor.set(0.5, 0.5);
      btnLabel.x = bx + btnW / 2;
      btnLabel.y = y + btnH / 2;
      this.container.addChild(btnLabel);
    }
  }
}
