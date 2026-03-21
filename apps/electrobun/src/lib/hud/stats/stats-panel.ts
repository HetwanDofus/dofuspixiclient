import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import type { CharacterStats } from "@/types/stats";
import { i18n } from "@/i18n";
import {
  statsLabels as LABELS,
  statsTooltips as TOOLTIPS,
} from "@/i18n/hud.messages";
import { loadSvg } from "@/render/load-svg";
import { getAssetPath } from "@/themes";
import { STAT_IDS } from "@/types/stats";

import {
  boldText,
  COLORS,
  createCloseButton,
  createProgressBar,
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
    this.panelW = Math.round(240 * zoom);
    this.panelH = Math.round(417 * zoom);

    this.build();
  }

  rebuild(zoom: number): void {
    this.zoom = zoom;
    this.panelW = Math.round(240 * zoom);
    this.panelH = Math.round(417 * zoom);

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

    // Original Window layout: borderwidth=3, cornerradius tl/tr=13, titleheight=22
    const BW = p(3);     // borderwidth
    const TR = p(13);    // corner radius
    const TH = p(22);    // titleheight
    const IR = TR - BW;  // inner corner radius = 10

    // ═══════ Title bar (dark) — inside border, from (BW,BW) to (W-BW, BW+TH) ═══════
    const titleBg = new Graphics();
    titleBg.moveTo(BW + IR, BW);
    titleBg.lineTo(W - BW - IR, BW);
    titleBg.arcTo(W - BW, BW, W - BW, BW + IR, IR);
    titleBg.lineTo(W - BW, BW + TH);
    titleBg.lineTo(BW, BW + TH);
    titleBg.lineTo(BW, BW + IR);
    titleBg.arcTo(BW, BW, BW + IR, BW, IR);
    titleBg.fill({ color: COLORS.HEADER_BG });
    titleBg.eventMode = "static";
    this.container.addChild(titleBg);

    // _lblName at FLA relY=4 (from panel top), relX=57
    this.nameText = new Text({
      text: "",
      style: boldText(f(11), COLORS.TEXT_WHITE),
    });
    this.nameText.anchor.set(0, 0.5);
    this.nameText.x = p(57);
    this.nameText.y = BW + TH / 2; // vertically centered in title bar
    this.container.addChild(this.nameText);

    // _btnClose at FLA relX=220, relY=8
    const closeBtn = createCloseButton(() => {
      this.hide();
      this.onClose?.();
    }, z);
    closeBtn.x = W - BW - CLOSE_SIZE - p(3);
    closeBtn.y = BW + (TH - CLOSE_SIZE) / 2;
    this.container.addChild(closeBtn);

    // _lblLevel at FLA relX=57, relY=29.5
    this.levelText = new Text({
      text: i18n._(LABELS.level.id, { level: 1 }),
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    this.levelText.x = p(57);
    this.levelText.y = p(30);
    this.container.addChild(this.levelText);

    y = p(53); // Energy row starts at relY=53

    // _ctrAlignment at FLA relX=10, relY=10 (visually spans title+level area)
    // Scale 0.8 of base container (64px) = 51.2 ≈ ALIGN_FRAME(50)
    const alignFrame = new Container();
    const alignBg = new Graphics();
    alignBg.roundRect(0, 0, ALIGN_FRAME, ALIGN_FRAME, p(3));
    alignBg.fill({ color: COLORS.SLOT_BG });
    alignBg.stroke({ color: COLORS.ALIGN_BORDER, width: 2 });
    alignFrame.addChild(alignBg);
    alignFrame.x = p(10);
    alignFrame.y = p(10);

    const alignIcon = this.makeIcon(
      "icon-alignment.svg",
      ALIGN_FRAME - p(6),
      ALIGN_FRAME - p(6)
    );
    alignIcon.x = p(3);
    alignIcon.y = p(3);
    this.container.removeChild(alignIcon);
    alignFrame.addChild(alignIcon);

    // ═══════ CONTENT AREA BACKGROUNDS — 3 colors from SWF ═══════
    // 1. Light content bg (#c9bf9d = BG_ALT): 234x260 at relY=54, 234x60 at relY=348
    // 2. Dark alternating rows (#b4ac8d = BG_ALT_DARK): at specific row positions
    const contentBg = new Graphics();
    // Main content area (energy through agility)
    contentBg.rect(BW, p(54), W - BW * 2, p(260));
    contentBg.fill({ color: COLORS.BG_ALT });
    // Jobs area
    contentBg.rect(BW, p(348), W - BW * 2, p(60));
    contentBg.fill({ color: COLORS.BG_ALT });
    this.container.addChild(contentBg);

    // Dark alternating rows (relY = 73, 111, 147, 202, 238, 274)
    const altBg = new Graphics();
    const darkRows = [73, 111, 147, 202, 238, 274];
    for (const ry of darkRows) {
      altBg.rect(BW, p(ry), W - BW * 2, ROW_H);
      altBg.fill({ color: COLORS.BG_ALT_DARK });
    }
    this.container.addChild(altBg);

    // ═══════ ENERGY — label at relX=20 relY=53, bar at relX=124 relY=59 ═══════
    // Bar: from x=124, width=100 (FLA: _pbEnergy sx=1.0, base 100px) → ends at x=224
    const barX = p(124);
    const barW = p(100);

    const energyLabel = new Text({
      text: i18n._(LABELS.energy),
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    energyLabel.anchor.set(0, 0.5);
    energyLabel.x = p(20);
    energyLabel.y = p(53) + ROW_H / 2;
    this.container.addChild(energyLabel);
    this.withTooltip(energyLabel, i18n._(TOOLTIPS.energy));

    this.energyBar = createProgressBar(barX, p(53) + (ROW_H - BAR_H) / 2, barW, BAR_H);
    this.container.addChild(this.energyBar.graphics);
    this.withDynamicTooltip(this.energyBar.graphics, () => this.energyTip);

    // ═══════ XP — label at relX=20 relY=73, bar at relX=124 relY=78 ═══════
    const xpLabel = new Text({
      text: i18n._(LABELS.xp),
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    xpLabel.anchor.set(0, 0.5);
    xpLabel.x = p(20);
    xpLabel.y = p(73) + ROW_H / 2;
    this.container.addChild(xpLabel);
    this.withTooltip(xpLabel, i18n._(TOOLTIPS.xp));

    this.xpBar = createProgressBar(barX, p(73) + (ROW_H - BAR_H) / 2, barW, BAR_H);
    this.container.addChild(this.xpBar.graphics);
    this.withDynamicTooltip(this.xpBar.graphics, () => this.xpTip);

    y = p(92); // LP row starts at relY=92

    // ═══════ COMBAT STATS (rows 2-6) ═══════
    // LP/AP/MP: BrownLeftMediumBoldLabel (Font2) + BrownRightMediumBoldLabel (Font2)
    // Initiative/Discernment: BrownLeftMediumLabel (Font1) + BrownRightMediumLabel (Font1)
    const combatRows: Array<{
      icon: string;
      label: string;
      isLP: boolean;
      bold: boolean;
      tip: string;
      tint?: number;
      onVal: (t: Text) => void;
    }> = [
      {
        icon: "icon-hp.svg",
        label: i18n._(LABELS.hp),
        isLP: true,
        bold: true,
        tip: i18n._(TOOLTIPS.hp),
        onVal: (t) => {
          this.lpVal = t;
        },
      },
      {
        icon: "icon-ap.svg",
        label: i18n._(LABELS.ap),
        isLP: false,
        bold: true,
        tip: i18n._(TOOLTIPS.ap),
        onVal: (t) => {
          this.apVal = t;
        },
      },
      {
        icon: "icon-mp.svg",
        label: i18n._(LABELS.mp),
        isLP: false,
        bold: true,
        tip: i18n._(TOOLTIPS.mp),
        onVal: (t) => {
          this.mpVal = t;
        },
      },
      {
        icon: "icon-initiative.svg",
        label: i18n._(LABELS.initiative),
        isLP: false,
        bold: false,
        tip: i18n._(TOOLTIPS.initiative),
        onVal: (t) => {
          this.initVal = t;
        },
      },
      {
        icon: "icon-prospection.svg",
        label: i18n._(LABELS.prospection),
        isLP: false,
        bold: false,
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
        cr.bold,
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

    // ═══════ CARACTÉRISTIQUES HEADER — relX=15, relY=183 ═══════
    const caracBg = new Graphics();
    caracBg.rect(BW, y, W - BW * 2, HEADER_H);
    caracBg.fill({ color: COLORS.HEADER_BG });
    this.container.addChild(caracBg);

    const caracLabel = new Text({
      text: i18n._(LABELS.characteristics),
      style: boldText(f(11), COLORS.TEXT_WHITE),
    });
    caracLabel.anchor.set(0, 0.5);
    caracLabel.x = p(15);
    caracLabel.y = y + HEADER_H / 2;
    this.container.addChild(caracLabel);

    const quillSize = p(12);
    const quill = this.makeIcon("QuillIcon.svg", quillSize, quillSize);
    quill.x = W - PX - p(14);
    quill.y = y + (HEADER_H - quillSize) / 2;
    this.withTooltip(quill, i18n._(TOOLTIPS.quill));

    y += HEADER_H;

    // ═══════ 6 CHARACTERISTIC ROWS (rows 7-12) ═══════
    const stats = [
      {
        id: STAT_IDS.VITALITY,
        n: i18n._(LABELS.vitality),
        ic: "icon-vitality.svg",
        tip: i18n._(TOOLTIPS.vitality),
      },
      {
        id: STAT_IDS.WISDOM,
        n: i18n._(LABELS.wisdom),
        ic: "icon-wisdom.svg",
        tip: i18n._(TOOLTIPS.wisdom),
      },
      {
        id: STAT_IDS.STRENGTH,
        n: i18n._(LABELS.strength),
        ic: "icon-earth-bonus.svg",
        tip: i18n._(TOOLTIPS.strength),
      },
      {
        id: STAT_IDS.INTELLIGENCE,
        n: i18n._(LABELS.intelligence),
        ic: "icon-fire-bonus.svg",
        tip: i18n._(TOOLTIPS.intelligence),
      },
      {
        id: STAT_IDS.CHANCE,
        n: i18n._(LABELS.chance),
        ic: "icon-water-bonus.svg",
        tip: i18n._(TOOLTIPS.chance),
      },
      {
        id: STAT_IDS.AGILITY,
        n: i18n._(LABELS.agility),
        ic: "icon-air-bonus.svg",
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

    // ═══════ CAPITAL HEADER — relX=20, relY=310 ═══════
    const capBg = new Graphics();
    capBg.rect(BW, y, W - BW * 2, HEADER_H);
    capBg.fill({ color: 0x93866c });
    this.container.addChild(capBg);
    const capLabel = new Text({
      text: i18n._(LABELS.capital),
      style: boldText(f(11), COLORS.TEXT_WHITE),
    });
    capLabel.anchor.set(0, 0.5);
    capLabel.x = p(20);
    capLabel.y = y + HEADER_H / 2;
    this.container.addChild(capLabel);
    this.withTooltip(capLabel, i18n._(TOOLTIPS.capital));

    this.capitalVal = new Text({
      text: "0",
      style: boldText(f(11), COLORS.TEXT_WHITE),
    });
    this.capitalVal.anchor.set(1, 0.5);
    this.capitalVal.x = p(190); // FLA: relX=40 + width=150 = 190
    this.capitalVal.y = y + HEADER_H / 2;
    this.container.addChild(this.capitalVal);
    y += HEADER_H;

    // ═══════ MES MÉTIERS HEADER — relX=15, relY=329 ═══════
    const jobBg = new Graphics();
    jobBg.rect(BW, y, W - BW * 2, HEADER_H);
    jobBg.fill({ color: COLORS.HEADER_BG });
    this.container.addChild(jobBg);
    const jobLabel = new Text({
      text: i18n._(LABELS.jobs),
      style: boldText(f(11), COLORS.TEXT_WHITE),
    });
    jobLabel.anchor.set(0, 0.5);
    jobLabel.x = p(15);
    jobLabel.y = y + HEADER_H / 2;
    this.container.addChild(jobLabel);
    y += HEADER_H;

    // ═══════ JOB & SPEC SLOTS — exact FLA positions ═══════
    // Job slots: relX=[9, 54, 99], relY=355, scale=0.8 → 45px spacing
    // Spec label: relX=141, relY=349
    // Spec slots: relX=[146, 175, 205], relY=370, scale=0.5 → 29px spacing
    const jobSlotPositions = [9, 54, 99];
    for (const jx of jobSlotPositions) {
      const slot = createSlot(p(jx), p(355), JOB_SLOT);
      this.container.addChild(slot.graphics);
    }

    const specLabel = new Text({
      text: i18n._(LABELS.specializations),
      style: regularText(f(11), COLORS.TEXT_DARK),
    });
    specLabel.x = p(141);
    specLabel.y = p(349);
    this.container.addChild(specLabel);

    const specSlotPositions = [146, 175, 205];
    for (const sx of specSlotPositions) {
      const slot = createSlot(p(sx), p(370), SPEC_SLOT);
      this.container.addChild(slot.graphics);
    }

    // ═══════ BACKGROUND (at bottom of z-order) ═══════
    // Original Window.draw(): filled border rect, then filled background inside
    // cornerradius tl/tr=13, br/bl=0, bordercolor=0xFFFFFF, borderwidth=3

    // 1. White border — U-shape: left + top + right, NO bottom (panel sits on banner)
    const borderFill = new Graphics();
    borderFill.moveTo(0, panelH);       // bottom-left (no border here)
    borderFill.lineTo(0, TR);            // left edge up
    borderFill.arcTo(0, 0, TR, 0, TR);  // top-left corner
    borderFill.lineTo(W - TR, 0);        // top edge
    borderFill.arcTo(W, 0, W, TR, TR);  // top-right corner
    borderFill.lineTo(W, panelH);        // right edge down
    // Close with bottom at panelH, then inner path back up
    borderFill.lineTo(W - BW, panelH);
    borderFill.lineTo(W - BW, BW + IR);
    borderFill.arcTo(W - BW, BW, W - BW - IR, BW, IR);
    borderFill.lineTo(BW + IR, BW);
    borderFill.arcTo(BW, BW, BW, BW + IR, IR);
    borderFill.lineTo(BW, panelH);
    borderFill.lineTo(0, panelH);
    borderFill.fill({ color: 0xffffff });
    borderFill.eventMode = "static";
    this.container.addChildAt(borderFill, 0);

    // 2. Beige background fill (inside border, extends to bottom — no bottom border)
    const bgFill = new Graphics();
    bgFill.moveTo(BW + IR, BW);
    bgFill.lineTo(W - BW - IR, BW);
    bgFill.arcTo(W - BW, BW, W - BW, BW + IR, IR);
    bgFill.lineTo(W - BW, panelH);
    bgFill.lineTo(BW, panelH);
    bgFill.lineTo(BW, BW + IR);
    bgFill.arcTo(BW, BW, BW + IR, BW, IR);
    bgFill.fill({ color: COLORS.BG });
    this.container.addChildAt(bgFill, 1);

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
    bold: boolean,
    onVal: (t: Text) => void,
    _W: number,
    ROW_H: number,
    ICON_SIZE: number,
    _PX: number,
    f: (n: number) => number,
    tooltip?: string,
    tint?: number
  ): number {
    const midY = y + ROW_H / 2;
    const textFn = bold ? boldText : regularText;
    const p = (n: number) => Math.round(n * this.zoom);

    const ico = this.makeIcon(iconFile, ICON_SIZE, ICON_SIZE);
    ico.x = p(20);
    ico.y = y + (ROW_H - ICON_SIZE) / 2;
    if (tint != null) ico.tint = tint;

    const lbl = new Text({
      text: label,
      style: textFn(f(11), COLORS.TEXT_DARK),
    });
    lbl.anchor.set(0, 0.5);
    lbl.x = p(38);
    lbl.y = midY;
    this.container.addChild(lbl);
    if (tooltip) this.withTooltip(lbl, tooltip);

    const val = new Text({
      text: isLP ? "0 / 0" : "0",
      style: textFn(f(11), COLORS.TEXT_DARK),
    });
    val.anchor.set(1, 0.5);
    val.x = p(219); // FLA: relX=69 + width=150 = 219
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
        const origX = spr.x;
        const origY = spr.y;
        spr.texture = tex;

        // Fit within the requested box preserving aspect ratio, then center
        const tw = tex.width;
        const th = tex.height;
        if (tw > 0 && th > 0) {
          const scale = Math.min(box.w / tw, box.h / th);
          spr.width = tw * scale;
          spr.height = th * scale;
          spr.x = origX + (box.w - tw * scale) / 2;
          spr.y = origY + (box.h - th * scale) / 2;
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
