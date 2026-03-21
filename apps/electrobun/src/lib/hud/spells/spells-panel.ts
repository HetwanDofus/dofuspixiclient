import { Graphics, Text } from "pixi.js";

import { i18n } from "@/i18n";
import { spellsLabels as L } from "@/i18n/hud.messages";

import { BasePanel } from "../core/base-panel";
import { createSectionHeader, createSlot } from "../core/panel-builder";
import { boldText, COLORS, METRICS } from "../core/theme";

const FILTER_KEYS = [
  "filterAll",
  "filterGuild",
  "filterWater",
  "filterFire",
  "filterEarth",
  "filterAir",
  "filterUpgradable",
] as const;
const FILTER_COLORS = [
  0x888888, 0x996633, 0x3399ff, 0xff6633, 0x669933, 0xcccccc, 0xffcc00,
];

export class SpellsPanel extends BasePanel {
  private activeFilter = 0;

  constructor(zoom: number) {
    super(zoom, 250, 390, i18n._(L.title), "spells-panel");
  }

  protected buildContent(y: number): void {
    const W = this.panelW;
    const PX = this.p(METRICS.PX);
    const ROW_H = this.p(METRICS.ROW_H);

    // Filter type label
    const typeLabel = new Text({
      text: i18n._(L.spellType),
      style: boldText(this.f(10), COLORS.TEXT_DARK),
    });
    typeLabel.x = PX;
    typeLabel.y = y + this.p(4);
    this.container.addChild(typeLabel);
    y += this.p(18);

    // Filter buttons row
    const filterSize = this.p(18);
    const filterGap = this.p(4);
    const filterStartX = PX;
    for (let i = 0; i < FILTER_KEYS.length; i++) {
      const fx = filterStartX + i * (filterSize + filterGap);
      const bg = new Graphics();
      bg.roundRect(fx, y, filterSize, filterSize, this.p(2));
      bg.fill({
        color: i === this.activeFilter ? FILTER_COLORS[i] : COLORS.SLOT_BG,
      });
      bg.stroke({ color: COLORS.BORDER, width: 1 });
      bg.eventMode = "static";
      bg.cursor = "pointer";
      this.container.addChild(bg);
    }
    y += filterSize + this.p(8);

    // Spell list section header
    const hdr = createSectionHeader(y, W, i18n._(L.spellList), this.zoom);
    this.container.addChild(hdr.graphics);
    this.container.addChild(hdr.text);
    y = hdr.nextY;

    // Column headers
    const nameLabel = new Text({
      text: i18n._(L.name),
      style: boldText(this.f(10), COLORS.TEXT_WHITE),
    });
    nameLabel.x = PX + this.p(28);
    nameLabel.y = y - this.p(METRICS.HEADER_H) + this.p(2);
    // Place inside header area - reuse y
    const levelLabel = new Text({
      text: i18n._(L.level),
      style: boldText(this.f(10), COLORS.TEXT_WHITE),
    });
    levelLabel.anchor.set(1, 0);
    levelLabel.x = W - PX;
    levelLabel.y = nameLabel.y;

    // Spell list rows (placeholder - 12 empty rows)
    const altBg = new Graphics();
    const numRows = 12;
    for (let i = 0; i < numRows; i++) {
      if (i % 2 === 1) {
        altBg.rect(0, y + i * ROW_H, W, ROW_H);
        altBg.fill({ color: COLORS.BG_ALT });
      }
    }
    this.container.addChild(altBg);

    // Spell slot placeholders in rows
    const slotSize = this.p(20);
    for (let i = 0; i < numRows; i++) {
      const rowY = y + i * ROW_H;
      const slot = createSlot(PX, rowY + (ROW_H - slotSize) / 2, slotSize);
      this.container.addChild(slot.graphics);
    }
    y += numRows * ROW_H;

    // Footer: boost points
    const footerH = this.p(24);
    const footerBg = new Graphics();
    footerBg.rect(0, y, W, footerH);
    footerBg.fill({ color: COLORS.HEADER_BG });
    this.container.addChild(footerBg);

    const boostLabel = new Text({
      text: `${i18n._(L.boostPoints)} : 0`,
      style: boldText(this.f(11), COLORS.TEXT_WHITE),
    });
    boostLabel.anchor.set(0.5, 0.5);
    boostLabel.x = W / 2;
    boostLabel.y = y + footerH / 2;
    this.container.addChild(boostLabel);
  }
}
