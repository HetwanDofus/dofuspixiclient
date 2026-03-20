import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import { loadSvg } from "@/render/load-svg";

import type { CharacterStats } from "@/types/stats";
import { i18n } from "@/i18n";
import {
  statsLabels as LABELS,
  statsTooltips as TOOLTIPS,
} from "@/i18n/hud.messages";
import { getAssetPath } from "@/themes";
import { STAT_IDS } from "@/types/stats";

import {
  boldText,
  COLORS,
  createCloseButton,
  createProgressBar,
  createSectionHeader,
  createSlot,
  hideTooltip,
  METRICS,
  regularText,
  showTooltip,
} from "../core";
import { getBoostCost } from "./boost-costs";
import { StatRow } from "./stat-row";

const ICON = () => getAssetPath("stats");

export class StatsPanel {
  public container: Container;

  /** Actual pixel dimensions after zoom */
  public panelW: number;
  public panelH: number;

  private nameText!: Text;
  private levelText!: Text;
  private energyBar!: { graphics: Graphics; redraw: (pct: number) => void };
  private xpBar!: { graphics: Graphics; redraw: (pct: number) => void };
  private lpVal!: Text;
  private apVal!: Text;
  private mpVal!: Text;
  private initVal!: Text;
  private discVal!: Text;
  private capitalVal!: Text;
  private statRows = new Map<number, StatRow>();
  private iconSizes = new Map<Sprite, { w: number; h: number }>();
  private classId = 0;
  private energyTip = "";
  private xpTip = "";
  private zoom: number;

  // State for rebuild
  private storedName = "";
  private storedStats: CharacterStats | null = null;

  private onBoostStat?: (statId: number) => void;
  private onClose?: () => void;
  private loadGeneration = 0;

  constructor(zoom: number) {
    this.zoom = zoom;
    this.container = new Container();
    this.container.label = "stats-panel";
    this.container.visible = false;
    this.container.eventMode = "static";

    // Compute zoomed dimensions
    this.panelW = Math.round(250 * zoom);
    this.panelH = Math.round(420 * zoom);

    this.build();
  }

  rebuild(zoom: number): void {
    this.zoom = zoom;
    this.panelW = Math.round(250 * zoom);
    this.panelH = Math.round(420 * zoom);

    // Clear old children
    for (const row of this.statRows.values()) row.destroy();
    this.statRows.clear();
    this.iconSizes.clear();
    this.container.removeChildren();

    this.build();

    // Restore state
    if (this.storedName) this.nameText.text = this.storedName;
    if (this.storedStats) this.updateStats(this.storedStats);
  }

  private build(): void {
    const z = this.zoom;
    const W = this.panelW;
    const panelH = this.panelH;

    // Scaled helpers
    const p = (n: number) => Math.round(n * z);
    const f = (n: number) => n * z;

    // Scaled metrics
    const ROW_H = p(METRICS.ROW_H);
    const HEADER_H = p(METRICS.HEADER_H);
    const PX = p(METRICS.PX);
    const ICON_SIZE = p(METRICS.ICON_SIZE);
    const BAR_H = p(METRICS.BAR_H);
    const CLOSE_SIZE = p(METRICS.CLOSE_SIZE);
    const ALIGN_FRAME = p(METRICS.ALIGN_FRAME);
    const JOB_SLOT = p(METRICS.JOB_SLOT);
    const SPEC_SLOT = p(METRICS.SPEC_SLOT);

    let y = 0;

    // ═══════ TOP: Name header (dark) ═══════
    const headerH = p(28);
    const headerR = p(10); // inner radius = cornerradius(13) - borderwidth(3)
    const headerBg = new Graphics();
    headerBg.moveTo(headerR, 0);
    headerBg.lineTo(W - headerR, 0);
    headerBg.arcTo(W, 0, W, headerR, headerR);
    headerBg.lineTo(W, headerH);
    headerBg.lineTo(0, headerH);
    headerBg.lineTo(0, headerR);
    headerBg.arcTo(0, 0, headerR, 0, headerR);
    headerBg.fill({ color: COLORS.HEADER_BG });
    headerBg.eventMode = "static";
    this.container.addChild(headerBg);

    this.nameText = new Text({
      text: "",
      style: boldText(f(13), COLORS.TEXT_WHITE),
    });
    this.nameText.anchor.set(0, 0.5);
    this.nameText.x = ALIGN_FRAME + PX + p(12);
    this.nameText.y = headerH / 2;
    this.container.addChild(this.nameText);

    const closeBtn = createCloseButton(() => {
      this.hide();
      this.onClose?.();
    }, z);
    closeBtn.x = W - p(19);
    closeBtn.y = (headerH - CLOSE_SIZE) / 2;
    this.container.addChild(closeBtn);

    // ═══════ Level (below header, beige zone) ═══════
    this.levelText = new Text({
      text: i18n._(LABELS.level.id, { level: 1 }),
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    this.levelText.x = ALIGN_FRAME + PX + p(6);
    this.levelText.y = headerH + p(8);
    this.container.addChild(this.levelText);

    y = headerH + ROW_H + p(18);

    // Alignment icon frame — added at end for z-index
    const alignFrame = new Container();
    const alignBg = new Graphics();
    alignBg.roundRect(0, 0, ALIGN_FRAME, ALIGN_FRAME, p(3));
    alignBg.fill({ color: COLORS.SLOT_BG });
    alignBg.stroke({ color: COLORS.ALIGN_BORDER, width: 2 });
    alignFrame.addChild(alignBg);
    alignFrame.x = PX;
    alignFrame.y = p(4);

    const alignIcon = this.makeIcon(
      "AlignIcon.svg",
      ALIGN_FRAME - p(6),
      ALIGN_FRAME - p(6)
    );
    alignIcon.x = p(3);
    alignIcon.y = p(3);
    this.container.removeChild(alignIcon);
    alignFrame.addChild(alignIcon);

    // ═══════ ALTERNATING ROW BACKGROUNDS — single Graphics ═══════
    const totalRows = 13;
    const altBg = new Graphics();
    let tempY = y;
    for (let i = 0; i < totalRows; i++) {
      if (i % 2 === 1) {
        altBg.rect(0, tempY, W, ROW_H);
        altBg.fill({ color: COLORS.BG_ALT });
      }
      tempY += ROW_H;
      if (i === 6) tempY += HEADER_H;
    }
    this.container.addChild(altBg);

    // ═══════ ENERGY BAR (row 0) ═══════
    const barLabelX = p(90);
    this.energyBar = createProgressBar(
      barLabelX,
      y + (ROW_H - BAR_H) / 2,
      W - barLabelX - PX,
      BAR_H
    );
    const energyLabel = new Text({
      text: i18n._(LABELS.energy),
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    energyLabel.anchor.set(0, 0.5);
    energyLabel.x = PX;
    energyLabel.y = y + ROW_H / 2;
    this.container.addChild(energyLabel);
    this.withTooltip(energyLabel, i18n._(TOOLTIPS.energy));
    this.container.addChild(this.energyBar.graphics);
    this.withDynamicTooltip(this.energyBar.graphics, () => this.energyTip);
    y += ROW_H;

    // ═══════ XP BAR (row 1) ═══════
    this.xpBar = createProgressBar(
      barLabelX,
      y + (ROW_H - BAR_H) / 2,
      W - barLabelX - PX,
      BAR_H
    );
    const xpLabel = new Text({
      text: i18n._(LABELS.xp),
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    xpLabel.anchor.set(0, 0.5);
    xpLabel.x = PX;
    xpLabel.y = y + ROW_H / 2;
    this.container.addChild(xpLabel);
    this.withTooltip(xpLabel, i18n._(TOOLTIPS.xp));
    this.container.addChild(this.xpBar.graphics);
    this.withDynamicTooltip(this.xpBar.graphics, () => this.xpTip);
    y += ROW_H;

    // ═══════ COMBAT STATS (rows 2-6) ═══════
    const combatRows: Array<{
      icon: string;
      label: string;
      isLP: boolean;
      tip: string;
      tint?: number;
      onVal: (t: Text) => void;
    }> = [
      {
        icon: "icon-heart.svg",
        label: i18n._(LABELS.hp),
        isLP: true,
        tip: i18n._(TOOLTIPS.hp),
        onVal: (t) => {
          this.lpVal = t;
        },
      },
      {
        icon: "StarSymbol.svg",
        label: i18n._(LABELS.ap),
        isLP: false,
        tip: i18n._(TOOLTIPS.ap),
        tint: 0xffcc00,
        onVal: (t) => {
          this.apVal = t;
        },
      },
      {
        icon: "IconMP.svg",
        label: i18n._(LABELS.mp),
        isLP: false,
        tip: i18n._(TOOLTIPS.mp),
        onVal: (t) => {
          this.mpVal = t;
        },
      },
      {
        icon: "IconInit.svg",
        label: i18n._(LABELS.initiative),
        isLP: false,
        tip: i18n._(TOOLTIPS.initiative),
        onVal: (t) => {
          this.initVal = t;
        },
      },
      {
        icon: "IconPP.svg",
        label: i18n._(LABELS.prospection),
        isLP: false,
        tip: i18n._(TOOLTIPS.prospection),
        onVal: (t) => {
          this.discVal = t;
        },
      },
    ];
    for (const cr of combatRows) {
      y = this.addCombatRow(
        y,
        cr.icon,
        cr.label,
        cr.isLP,
        cr.onVal,
        W,
        ROW_H,
        ICON_SIZE,
        PX,
        f,
        cr.tip,
        cr.tint
      );
    }

    // ═══════ CARACTÉRISTIQUES HEADER ═══════
    const caracHdr = createSectionHeader(
      y,
      W,
      i18n._(LABELS.characteristics),
      z
    );
    this.container.addChild(caracHdr.graphics);
    this.container.addChild(caracHdr.text);

    const quillSize = p(12);
    const quill = this.makeIcon("QuillIcon.svg", quillSize, quillSize);
    quill.x = W - PX - p(14);
    quill.y = y + (HEADER_H - quillSize) / 2;
    this.withTooltip(quill, i18n._(TOOLTIPS.quill));

    y = caracHdr.nextY;

    // ═══════ 6 CHARACTERISTIC ROWS (rows 7-12) ═══════
    const stats = [
      {
        id: STAT_IDS.VITALITY,
        n: i18n._(LABELS.vitality),
        ic: "IconVita.svg",
        tip: i18n._(TOOLTIPS.vitality),
      },
      {
        id: STAT_IDS.WISDOM,
        n: i18n._(LABELS.wisdom),
        ic: "IconWisdom.svg",
        tip: i18n._(TOOLTIPS.wisdom),
      },
      {
        id: STAT_IDS.STRENGTH,
        n: i18n._(LABELS.strength),
        ic: "IconEarth.svg",
        tip: i18n._(TOOLTIPS.strength),
      },
      {
        id: STAT_IDS.INTELLIGENCE,
        n: i18n._(LABELS.intelligence),
        ic: "IconFire.svg",
        tip: i18n._(TOOLTIPS.intelligence),
      },
      {
        id: STAT_IDS.CHANCE,
        n: i18n._(LABELS.chance),
        ic: "IconWater.svg",
        tip: i18n._(TOOLTIPS.chance),
      },
      {
        id: STAT_IDS.AGILITY,
        n: i18n._(LABELS.agility),
        ic: "IconAir.svg",
        tip: i18n._(TOOLTIPS.agility),
      },
    ];

    for (const s of stats) {
      const row = new StatRow(s.n, `${ICON()}/${s.ic}`, W, s.tip, z);
      row.container.y = y;
      row.setOnBoost(() => this.onBoostStat?.(s.id));
      this.statRows.set(s.id, row);
      this.container.addChild(row.container);
      y += ROW_H;
    }

    // ═══════ CAPITAL HEADER ═══════
    const capBg = new Graphics();
    capBg.rect(0, y, W, HEADER_H);
    capBg.fill({ color: 0x7a7a56 });
    this.container.addChild(capBg);
    const capLabel = new Text({
      text: i18n._(LABELS.capital),
      style: boldText(f(11), COLORS.TEXT_WHITE),
    });
    capLabel.anchor.set(0, 0.5);
    capLabel.x = PX;
    capLabel.y = y + HEADER_H / 2;
    this.container.addChild(capLabel);
    this.withTooltip(capLabel, i18n._(TOOLTIPS.capital));

    this.capitalVal = new Text({
      text: "0",
      style: boldText(f(12), COLORS.TEXT_WHITE),
    });
    this.capitalVal.anchor.set(1, 0.5);
    this.capitalVal.x = W - PX;
    this.capitalVal.y = y + HEADER_H / 2;
    this.container.addChild(this.capitalVal);
    y += HEADER_H;

    // ═══════ MES MÉTIERS HEADER ═══════
    const jobHdr = createSectionHeader(y, W, i18n._(LABELS.jobs), z);
    this.container.addChild(jobHdr.graphics);
    this.container.addChild(jobHdr.text);
    y = jobHdr.nextY;

    // ═══════ JOB & SPEC SLOTS — side by side, centered vertically ═══════
    const jobAreaH = panelH - y;
    const jobGap = p(4);
    const specGap = p(3);
    const midGap = p(8);
    const jobTotalW = 3 * JOB_SLOT + 2 * jobGap;
    const specTotalW = 3 * SPEC_SLOT + 2 * specGap;
    const allW = jobTotalW + midGap + specTotalW;
    const startX = (W - allW) / 2;
    const jobY = y + (jobAreaH - JOB_SLOT) / 2;

    for (let i = 0; i < 3; i++) {
      const sx = startX + i * (JOB_SLOT + jobGap);
      const slot = createSlot(sx, jobY, JOB_SLOT);
      this.container.addChild(slot.graphics);
    }

    const specX = startX + jobTotalW + midGap;
    const specBlockH = p(10) + SPEC_SLOT;
    const specTopY = jobY + (JOB_SLOT - specBlockH) / 2;
    const specLabel = new Text({
      text: i18n._(LABELS.specializations),
      style: regularText(f(8), COLORS.TEXT_DARK),
    });
    specLabel.x = specX;
    specLabel.y = specTopY;
    this.container.addChild(specLabel);
    const specSlotY = specTopY + p(12);
    for (let i = 0; i < 3; i++) {
      const sx = specX + i * (SPEC_SLOT + specGap);
      const slot = createSlot(sx, specSlotY, SPEC_SLOT);
      this.container.addChild(slot.graphics);
    }

    // ═══════ FIXED HEIGHT background (at bottom of z-order) ═══════
    // Rounded top corners, flat bottom (glued to banner)
    // Original: cornerradius=13, borderwidth=3, bordercolor=0xFFFFFF
    const r = p(13);
    const bgFill = new Graphics();
    bgFill.moveTo(r, 0);
    bgFill.lineTo(W - r, 0);
    bgFill.arcTo(W, 0, W, r, r);
    bgFill.lineTo(W, panelH);
    bgFill.lineTo(0, panelH);
    bgFill.lineTo(0, r);
    bgFill.arcTo(0, 0, r, 0, r);
    bgFill.fill({ color: COLORS.BG });
    bgFill.eventMode = "static";
    this.container.addChildAt(bgFill, 0);

    // Border overlay — white, open bottom (no bottom edge)
    const borderOverlay = new Graphics();
    borderOverlay.moveTo(0, panelH);
    borderOverlay.lineTo(0, r);
    borderOverlay.arcTo(0, 0, r, 0, r);
    borderOverlay.lineTo(W - r, 0);
    borderOverlay.arcTo(W, 0, W, r, r);
    borderOverlay.lineTo(W, panelH);
    borderOverlay.stroke({ color: 0xffffff, width: p(3) });
    borderOverlay.eventMode = "none";
    this.container.addChild(borderOverlay);

    // Alignment frame on top
    this.container.addChild(alignFrame);

    this.loadIcons();
  }

  // ─── Helpers ───

  private withDynamicTooltip(target: Container, getTip: () => string): void {
    target.eventMode = "static";
    target.cursor = "default";
    target.on("pointerover", (e) => {
      showTooltip(this.container, getTip(), e.global.x, e.global.y);
    });
    target.on("pointerout", () => hideTooltip());
  }

  private withTooltip(target: Container, tip: string): void {
    target.eventMode = "static";
    target.cursor = "default";
    target.on("pointerover", (e) => {
      showTooltip(this.container, tip, e.global.x, e.global.y);
    });
    target.on("pointerout", () => hideTooltip());
  }

  private makeIcon(label: string, w: number, h: number): Sprite {
    const spr = new Sprite(Texture.EMPTY);
    spr.width = w;
    spr.height = h;
    spr.label = label;
    this.iconSizes.set(spr, { w, h });
    this.container.addChild(spr);
    return spr;
  }

  private addCombatRow(
    y: number,
    iconFile: string,
    label: string,
    isLP: boolean,
    onVal: (t: Text) => void,
    W: number,
    ROW_H: number,
    ICON_SIZE: number,
    PX: number,
    f: (n: number) => number,
    tooltip?: string,
    tint?: number
  ): number {
    const midY = y + ROW_H / 2;

    const ico = this.makeIcon(iconFile, ICON_SIZE, ICON_SIZE);
    ico.x = PX;
    ico.y = y + (ROW_H - ICON_SIZE) / 2;
    if (tint != null) ico.tint = tint;

    const lbl = new Text({
      text: label,
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    lbl.anchor.set(0, 0.5);
    lbl.x = PX + Math.round(18 * this.zoom);
    lbl.y = midY;
    this.container.addChild(lbl);
    if (tooltip) this.withTooltip(lbl, tooltip);

    const val = new Text({
      text: isLP ? "0 / 0" : "0",
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    val.anchor.set(1, 0.5);
    val.x = W - PX;
    val.y = midY;
    this.container.addChild(val);
    onVal(val);
    return y + ROW_H;
  }

  private async loadIcons(): Promise<void> {
    const gen = ++this.loadGeneration;
    const res = this.zoom * (window.devicePixelRatio || 1);
    const entries: Array<{ spr: Sprite; path: string }> = [];
    for (const [spr] of this.iconSizes) {
      entries.push({ spr, path: `${ICON()}/${spr.label}` });
    }

    const results = await Promise.allSettled(
      entries.map((e) => loadSvg(e.path, res))
    );

    if (gen !== this.loadGeneration) return;

    for (let i = 0; i < entries.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled" && result.value) {
        const { spr } = entries[i];
        const box = this.iconSizes.get(spr)!;
        const tex = result.value as Texture;
        spr.texture = tex;

        // Fit within the requested box while preserving aspect ratio
        const tw = tex.width;
        const th = tex.height;
        if (tw > 0 && th > 0) {
          const scale = Math.min(box.w / tw, box.h / th);
          spr.width = tw * scale;
          spr.height = th * scale;
        } else {
          spr.width = box.w;
          spr.height = box.h;
        }
      }
    }
  }

  // ─── Public API ───

  setOnBoostStat(fn: (statId: number) => void): void {
    this.onBoostStat = fn;
  }
  setOnClose(fn: () => void): void {
    this.onClose = fn;
  }
  setClassId(classId: number): void {
    this.classId = classId;
  }

  setCharacterName(name: string): void {
    this.storedName = name;
    this.nameText.text = name;
  }

  updateStats(stats: CharacterStats): void {
    this.storedStats = stats;

    const level = stats.level ?? 1;
    this.levelText.text = i18n._(LABELS.level.id, { level });

    const energy = stats.energy ?? 0;
    const maxEnergy = stats.maxEnergy ?? 1;
    const ePct = maxEnergy > 0 ? energy / maxEnergy : 0;
    this.energyBar.redraw(ePct);
    this.energyTip = i18n._(LABELS.energyTip.id, { energy, maxEnergy });

    const xp = stats.xp ?? 0;
    const xpLow = stats.xpLow ?? 0;
    const xpHigh = stats.xpHigh ?? 0;
    const xpRange = xpHigh - xpLow;
    const xPct = xpRange > 0 ? (xp - xpLow) / xpRange : 0;
    this.xpBar.redraw(xPct);
    this.xpTip = i18n._(LABELS.xpTip.id, {
      current: xp - xpLow,
      range: xpRange,
      level,
    });

    this.lpVal.text = `${stats.hp ?? 0} / ${stats.maxHp ?? 0}`;
    this.apVal.text = String(stats.ap ?? 0);
    this.mpVal.text = String(stats.mp ?? 0);
    this.initVal.text = String(stats.initiative ?? 0);
    this.discVal.text = String(stats.discernment ?? 0);

    const keys: [number, keyof CharacterStats][] = [
      [STAT_IDS.VITALITY, "vitality"],
      [STAT_IDS.WISDOM, "wisdom"],
      [STAT_IDS.STRENGTH, "strength"],
      [STAT_IDS.INTELLIGENCE, "intelligence"],
      [STAT_IDS.CHANCE, "chance"],
      [STAT_IDS.AGILITY, "agility"],
    ];
    const bp = stats.bonusPoints ?? 0;
    for (const [id, key] of keys) {
      const row = this.statRows.get(id);
      const v = stats[key] as
        | { base: number; items: number; boost: number }
        | undefined;
      const stat = v ?? { base: 0, items: 0, boost: 0 };
      row?.update(stat);
      const cost = getBoostCost(this.classId, id, stat.base);
      row?.setBoostCost(cost);
      row?.setBoostEnabled(bp >= cost);
    }

    this.capitalVal.text = String(bp);
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

  getContainer(): Container {
    return this.container;
  }

  destroy(): void {
    for (const row of this.statRows.values()) row.destroy();
    this.statRows.clear();
    this.iconSizes.clear();
    this.container.destroy({ children: true });
  }
}
