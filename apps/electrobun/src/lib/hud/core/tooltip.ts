import { type Application, Container, Graphics, Text } from "pixi.js";

import { regularText } from "./theme";

const TOOLTIP_BG = 0x2a2218;
const TOOLTIP_BORDER = 0x8a7f5f;
const TOOLTIP_TEXT = 0xffffff;
const PAD_X = 8;
const PAD_Y = 5;
const MAX_WIDTH = 220;
const GAP = 6;

let canvasW = 800;
let canvasH = 600;

// Reusable tooltip — single Container+Graphics+Text, hidden when not in use
let tooltipContainer: Container | null = null;
let tooltipBg: Graphics | null = null;
let tooltipLabel: Text | null = null;
let tooltipRoot: Container | null = null;

/** Call once at init with the Pixi Application to enable proper bounds. */
export function initTooltipBounds(app: Application): void {
  canvasW = app.screen.width;
  canvasH = app.screen.height;
  app.renderer.on("resize", (w: number, h: number) => {
    canvasW = w;
    canvasH = h;
  });
}

function ensureTooltip(root: Container): void {
  if (tooltipContainer && tooltipRoot === root) return;

  // Destroy old if root changed
  if (tooltipContainer) {
    tooltipContainer.parent?.removeChild(tooltipContainer);
    tooltipContainer.destroy({ children: true });
  }

  tooltipContainer = new Container();
  tooltipContainer.label = "tooltip";
  tooltipContainer.eventMode = "none";
  tooltipContainer.visible = false;

  tooltipBg = new Graphics();
  tooltipContainer.addChild(tooltipBg);

  tooltipLabel = new Text({
    text: "",
    style: regularText(10, TOOLTIP_TEXT),
    resolution: 2,
  });
  tooltipLabel.style.wordWrap = true;
  tooltipLabel.style.wordWrapWidth = MAX_WIDTH - PAD_X * 2;
  tooltipLabel.x = PAD_X;
  tooltipLabel.y = PAD_Y;
  tooltipContainer.addChild(tooltipLabel);

  root.addChild(tooltipContainer);
  tooltipRoot = root;
}

/**
 * Show a tooltip near the cursor.
 * Reuses a single Container/Graphics/Text to avoid GC churn.
 */
export function showTooltip(
  stage: Container,
  text: string,
  globalX: number,
  globalY: number
): void {
  // Find root stage
  let root: Container = stage;
  while (root.parent) root = root.parent;

  ensureTooltip(root);

  tooltipLabel!.text = text;

  const w = Math.min(tooltipLabel!.width + PAD_X * 2, MAX_WIDTH);
  const h = tooltipLabel!.height + PAD_Y * 2;

  tooltipBg!.clear();
  tooltipBg!.roundRect(0, 0, w, h, 3);
  tooltipBg!.fill({ color: TOOLTIP_BG, alpha: 0.95 });
  tooltipBg!.stroke({ color: TOOLTIP_BORDER, width: 1 });

  // Position above cursor
  let x = globalX - w / 2;
  let y = globalY - h - GAP;

  // Flip below if above screen
  if (y < 2) y = globalY + GAP + 16;
  // Flip above if below screen
  if (y + h > canvasH - 2) y = globalY - h - GAP;

  // Clamp to canvas bounds
  x = Math.max(2, Math.min(x, canvasW - w - 2));
  y = Math.max(2, Math.min(y, canvasH - h - 2));

  tooltipContainer!.x = x;
  tooltipContainer!.y = y;
  tooltipContainer!.visible = true;

  // Ensure tooltip is on top
  root.setChildIndex(tooltipContainer!, root.children.length - 1);
}

export function hideTooltip(): void {
  if (tooltipContainer) {
    tooltipContainer.visible = false;
  }
}
