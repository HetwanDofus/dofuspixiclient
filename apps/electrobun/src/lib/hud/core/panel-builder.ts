import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import { getAssetPath } from "@/themes";
import { loadSvg } from "@/render/load-svg";

import { boldText, COLORS, METRICS } from "./theme";

export function createPanelBackground(w: number, h: number): Graphics {
  const bg = new Graphics();
  bg.roundRect(0, 0, w, h, 3);
  bg.fill({ color: COLORS.BG });
  bg.stroke({ color: COLORS.BORDER, width: 2 });
  bg.eventMode = "static";
  return bg;
}

export function createSectionHeader(
  y: number,
  w: number,
  label: string,
  zoom = 1
): { graphics: Graphics; text: Text; nextY: number } {
  const HEADER_H = Math.round(METRICS.HEADER_H * zoom);
  const PX = Math.round(METRICS.PX * zoom);

  const graphics = new Graphics();
  graphics.rect(0, y, w, HEADER_H);
  graphics.fill({ color: COLORS.HEADER_BG });

  const text = new Text({
    text: label,
    style: boldText(11 * zoom, COLORS.TEXT_WHITE),
  });
  text.anchor.set(0, 0.5);
  text.x = PX;
  text.y = y + HEADER_H / 2;

  return { graphics, text, nextY: y + HEADER_H };
}

export function createAlternatingRow(
  y: number,
  w: number,
  rowIndex: number
): Graphics | null {
  if (rowIndex % 2 === 1) {
    const row = new Graphics();
    row.rect(0, y, w, METRICS.ROW_H);
    row.fill({ color: COLORS.BG_ALT });
    return row;
  }
  return null;
}

export function createProgressBar(
  x: number,
  y: number,
  w: number,
  h: number
): { graphics: Graphics; redraw: (pct: number) => void } {
  const r = h / 2;
  const graphics = new Graphics();
  graphics.x = x;
  graphics.y = y;
  // Initial empty bar
  graphics.roundRect(0, 0, w, h, r);
  graphics.fill({ color: COLORS.BAR_BG });
  graphics.roundRect(0, 0, w, h, r);
  graphics.stroke({ color: COLORS.BAR_BORDER, width: 1 });

  const redraw = (pct: number): void => {
    graphics.clear();
    graphics.roundRect(0, 0, w, h, r);
    graphics.fill({ color: COLORS.BAR_BG });
    if (pct > 0) {
      const fw = Math.max(h, (w - 2) * Math.min(pct, 1));
      graphics.roundRect(1, 1, fw, h - 2, r - 1);
      graphics.fill({ color: COLORS.BAR_FILL });
    }
    graphics.roundRect(0, 0, w, h, r);
    graphics.stroke({ color: COLORS.BAR_BORDER, width: 1 });
  };

  return { graphics, redraw };
}

export function createCloseButton(onClick: () => void, zoom = 1): Container {
  const CLOSE_SIZE = Math.round(METRICS.CLOSE_SIZE * zoom);
  const c = new Container();
  c.eventMode = "static";
  c.cursor = "pointer";

  const upSprite = new Sprite(Texture.EMPTY);
  upSprite.width = CLOSE_SIZE;
  upSprite.height = CLOSE_SIZE;
  c.addChild(upSprite);

  const downSprite = new Sprite(Texture.EMPTY);
  downSprite.width = CLOSE_SIZE;
  downSprite.height = CLOSE_SIZE;
  downSprite.visible = false;
  c.addChild(downSprite);

  // Load SVG textures from theme
  const res = zoom * (globalThis.devicePixelRatio || 1);
  const basePath = getAssetPath("common");
  loadSvg(`${basePath}/close-up.svg`, res).then((tex) => {
    upSprite.texture = tex;
    upSprite.width = CLOSE_SIZE;
    upSprite.height = CLOSE_SIZE;
  }).catch(() => {});
  loadSvg(`${basePath}/close-down.svg`, res).then((tex) => {
    downSprite.texture = tex;
    downSprite.width = CLOSE_SIZE;
    downSprite.height = CLOSE_SIZE;
  }).catch(() => {});

  c.on("pointerdown", () => {
    upSprite.visible = false;
    downSprite.visible = true;
  });
  c.on("pointerup", () => {
    upSprite.visible = true;
    downSprite.visible = false;
    onClick();
  });
  c.on("pointerupoutside", () => {
    upSprite.visible = true;
    downSprite.visible = false;
  });

  return c;
}

export function createSlot(
  x: number,
  y: number,
  size: number,
  borderColor?: number
): { graphics: Graphics; iconSprite: Sprite } {
  const graphics = new Graphics();
  graphics.rect(x, y, size, size);
  graphics.fill({ color: COLORS.SLOT_BG });
  graphics.stroke({ color: borderColor ?? COLORS.BORDER, width: 1.5 });

  const iconSprite = new Sprite(Texture.EMPTY);
  iconSprite.width = size - 6;
  iconSprite.height = size - 6;
  iconSprite.x = x + 3;
  iconSprite.y = y + 3;

  return { graphics, iconSprite };
}
