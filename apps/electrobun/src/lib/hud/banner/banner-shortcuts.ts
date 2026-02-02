import { Container, Sprite, Texture } from 'pixi.js';
import type { ShortcutCell } from '@/types/banner';

export function createShortcutCell(
  backgroundTexture: Texture,
  borderTexture: Texture,
  highlightTexture: Texture
): ShortcutCell {
  const container = new Container();

  const background = new Sprite(backgroundTexture);
  container.addChild(background);

  const border = new Sprite(borderTexture);
  container.addChild(border);

  const highlight = new Sprite(highlightTexture);
  highlight.visible = false;
  container.addChild(highlight);

  container.eventMode = 'static';
  container.cursor = 'pointer';

  container.on('pointerover', () => { highlight.visible = true; });
  container.on('pointerout', () => { highlight.visible = false; });

  return { container, background, border, highlight };
}

export function createShortcutGrid(
  backgroundTexture: Texture,
  borderTexture: Texture,
  highlightTexture: Texture,
  count: number = 14
): ShortcutCell[] {
  const cells: ShortcutCell[] = [];
  for (let i = 0; i < count; i++) {
    cells.push(createShortcutCell(backgroundTexture, borderTexture, highlightTexture));
  }
  return cells;
}

export function updateShortcutGridPositions(
  cells: ShortcutCell[],
  container: Container,
  startX: number,
  startY: number,
  cellSpacingX: number,
  cellSpacingY: number,
  textureScale: number,
  zoom: number,
  bannerOffsetY: number
): void {
  container.position.set(startX * zoom, bannerOffsetY + startY * zoom);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const row = Math.floor(i / 7);
    const col = i % 7;

    cell.container.position.set(col * cellSpacingX * zoom, row * cellSpacingY * zoom);
    cell.background.scale.set(textureScale);
    cell.border.scale.set(textureScale);
    cell.highlight.scale.set(textureScale);
  }
}
