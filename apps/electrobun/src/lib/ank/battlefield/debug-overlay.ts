import { Container, Graphics, Text, Sprite, type FederatedPointerEvent } from 'pixi.js';
import type { ExtendedTexture } from '@/types';

export interface SpriteDebugInfo {
  sprite: Sprite;
  tileId: number;
  cellId: number;
  layer: number; // 0=ground, 1=object1, 2=object2
  type: 'ground' | 'objects';
}

export class DebugOverlay {
  private container: Container;
  private tooltip: Container;
  private tooltipBg: Graphics;
  private tooltipText: Text;
  private sprites: SpriteDebugInfo[] = [];
  private enabled = false;
  private mapContainer: Container | null = null;
  private screenWidth = 1484;
  private screenHeight = 1114;

  constructor(parentContainer: Container) {
    this.container = new Container();
    this.container.label = 'debug-overlay';
    this.container.zIndex = 10000;
    parentContainer.addChild(this.container);

    // Create tooltip
    this.tooltip = new Container();
    this.tooltip.visible = false;

    this.tooltipBg = new Graphics();
    this.tooltip.addChild(this.tooltipBg);

    this.tooltipText = new Text({
      text: '',
      style: {
        fontFamily: 'monospace',
        fontSize: 12,
        fill: 0xffffff,
        wordWrap: false,
      },
    });
    this.tooltipText.x = 8;
    this.tooltipText.y = 6;
    this.tooltip.addChild(this.tooltipText);

    this.container.addChild(this.tooltip);
  }

  setMapContainer(mapContainer: Container): void {
    this.mapContainer = mapContainer;
  }

  registerSprite(info: SpriteDebugInfo): void {
    this.sprites.push(info);

    // Make sprite interactive for hover detection
    info.sprite.eventMode = 'static';
    info.sprite.cursor = 'pointer';

    info.sprite.on('pointerenter', (e: FederatedPointerEvent) => this.showTooltip(info, e));
    info.sprite.on('pointermove', (e: FederatedPointerEvent) => this.updateTooltipPosition(e));
    info.sprite.on('pointerleave', () => this.hideTooltip());
  }

  clear(): void {
    this.sprites = [];
    this.hideTooltip();
  }

  enable(): void {
    this.enabled = true;
    this.container.visible = true;
  }

  disable(): void {
    this.enabled = false;
    this.container.visible = false;
    this.hideTooltip();
  }

  toggle(): boolean {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private showTooltip(info: SpriteDebugInfo, e: FederatedPointerEvent): void {
    if (!this.enabled) return;

    const tex = info.sprite.texture as ExtendedTexture;
    const scale = tex._scale ?? 'unknown';
    const isFallback = tex._isFallback ?? false;
    const requestedScale = tex._requestedScale;

    const layerNames = ['ground', 'object1', 'object2'];
    const layerName = layerNames[info.layer] ?? `layer${info.layer}`;

    let text = `Tile: ${info.type}_${info.tileId}\n`;
    text += `Cell: ${info.cellId}\n`;
    text += `Layer: ${layerName}\n`;
    text += `Scale: ${scale}`;

    if (isFallback && requestedScale !== undefined) {
      text += ` (FALLBACK! wanted ${requestedScale})`;
    }

    this.tooltipText.text = text;

    // Update background
    const padding = 8;
    const width = this.tooltipText.width + padding * 2;
    const height = this.tooltipText.height + padding * 2;

    this.tooltipBg.clear();
    this.tooltipBg.roundRect(0, 0, width, height, 4);
    this.tooltipBg.fill({ color: isFallback ? 0x990000 : 0x000000, alpha: 0.9 });
    this.tooltipBg.stroke({ color: isFallback ? 0xff0000 : 0x666666, width: 1 });

    // Position tooltip at mouse cursor
    this.positionTooltipAtMouse(e.global.x, e.global.y, width, height);

    this.tooltip.visible = true;
  }

  private updateTooltipPosition(e: FederatedPointerEvent): void {
    if (!this.tooltip.visible) return;

    const width = this.tooltipBg.width;
    const height = this.tooltipBg.height;
    this.positionTooltipAtMouse(e.global.x, e.global.y, width, height);
  }

  private positionTooltipAtMouse(mouseX: number, mouseY: number, width: number, height: number): void {
    const margin = 15;

    // Try to position to the right and above the cursor
    let x = mouseX + margin;
    let y = mouseY - height - margin;

    // If tooltip goes off the right edge, position to the left of cursor
    if (x + width > this.screenWidth) {
      x = mouseX - width - margin;
    }

    // If still off screen on left, clamp to left edge
    if (x < 0) {
      x = margin;
    }

    // If tooltip goes off the top, position below the cursor
    if (y < 0) {
      y = mouseY + margin;
    }

    // If still off screen on bottom, clamp to bottom
    if (y + height > this.screenHeight) {
      y = this.screenHeight - height - margin;
    }

    this.tooltip.x = x;
    this.tooltip.y = y;
  }

  setScreenSize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  private hideTooltip(): void {
    this.tooltip.visible = false;
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
