import { Container, Graphics, Text, TextStyle, CanvasTextMetrics } from 'pixi.js';

const ROW_HEIGHT = 30;
const PADDING = 2;
const BORDER_WIDTH = 2;
const MENU_OFFSET_X = 20; // Offset to the right of cursor

const COLOR_BROWN = 0x514A3C;
const COLOR_BEIGE = 0xD5CFAA;
const COLOR_BROWN_TEXT = 0xada57e;
const COLOR_BEIGE_TEXT = 0x514A3C;
const COLOR_WHITE = 0xFFFFFF;

// bitMini6 bitmap font at normal size (matching Dofus PopupTextArea)
const FONT_SCALE = 1;
const TEXT_STYLE = new TextStyle({
  fontFamily: 'bitMini6',
  fontSize: 12,
  align: 'left',
  fontWeight: 'normal',
});

// Cached measurement texts for efficient sizing
const measurementTexts = {
  zaap: CanvasTextMetrics.measureText('Zaap', TEXT_STYLE),
  use: CanvasTextMetrics.measureText('Use', TEXT_STYLE),
};

export class ZaapContextMenu {
  private container: Container;
  private isVisible: boolean = false;
  private onUseCallback: (() => void) | null = null;
  private menuWidth: number = 0;

  constructor(onUseCallback?: () => void) {
    this.container = new Container();
    this.container.zIndex = 1000; // Ensure menu is on top
    if (onUseCallback) {
      this.onUseCallback = onUseCallback;
    }
    this.calculateMenuWidth();
    this.buildMenu();
  }

  private calculateMenuWidth(): void {
    const maxWidth = Math.max(measurementTexts.zaap.width, measurementTexts.use.width);
    // Account for the scale applied to text (6px font scaled up by FONT_SCALE)
    const scaledWidth = maxWidth * FONT_SCALE;
    this.menuWidth = scaledWidth + PADDING * 2 + 15;
  }

  private buildMenu(): void {
    const totalWidth = this.menuWidth + BORDER_WIDTH * 4;
    const totalHeight = ROW_HEIGHT * 2 + BORDER_WIDTH * 4;

    // Outer white border
    const outerBorder = new Graphics();
    outerBorder.rect(0, 0, totalWidth, totalHeight);
    outerBorder.fill(COLOR_WHITE);
    this.container.addChild(outerBorder);

    // Inner brown border
    const innerBorder = new Graphics();
    innerBorder.rect(BORDER_WIDTH, BORDER_WIDTH, this.menuWidth + BORDER_WIDTH * 2, totalHeight - BORDER_WIDTH * 2);
    innerBorder.fill(COLOR_BROWN);
    this.container.addChild(innerBorder);

    // Row 1: "Zaap" - brown background, brown text
    const row1 = this.createRow('Zaap', COLOR_BROWN, COLOR_BROWN_TEXT, BORDER_WIDTH * 2);
    this.container.addChild(row1);

    // Row 2: "Use" - beige background, brown text
    const row2 = this.createRow('Use', COLOR_BEIGE, COLOR_BEIGE_TEXT, BORDER_WIDTH * 2 + ROW_HEIGHT);
    this.container.addChild(row2);
  }

  private createRow(label: string, backgroundColor: number, textColor: number, yOffset: number): Container {
    const row = new Container();
    row.position.set(BORDER_WIDTH * 2, yOffset);

    // Background
    const background = new Graphics();
    background.rect(0, 0, this.menuWidth, ROW_HEIGHT);
    background.fill(backgroundColor);
    row.addChild(background);

    // Text - use same style as measurement but with color override
    const textStyle = new TextStyle({
      fontFamily: 'bitMini6',
      fontSize: 12,
      fill: textColor,
    });
    const text = new Text({
      text: label,
      style: textStyle,
      scale: FONT_SCALE,
    });
    text.position.set(PADDING, ROW_HEIGHT / 2 - text.height / 2);
    row.addChild(text);

    // Interactive area
    row.eventMode = 'static';
    row.cursor = 'pointer';

    row.on('pointerdown', () => {
      this.onRowClicked(label);
    });

    // Hover effect
    row.on('pointerenter', () => {
      background.alpha = 0.8;
    });

    row.on('pointerleave', () => {
      background.alpha = 1;
    });

    return row;
  }

  private onRowClicked(label: string): void {
    console.log(`Zaap context menu: ${label} clicked`);
    this.hide();

    // Handle "Use" button click
    if (label === 'Use') {
      if (this.onUseCallback) {
        this.onUseCallback();
      }
      this.container.emit('zaap-use');
    }
  }

  public show(x: number, y: number, parentContainer: Container): void {
    // Position menu to the right of the cursor
    this.container.position.set(x + MENU_OFFSET_X, y);
    parentContainer.addChild(this.container);
    this.isVisible = true;
  }

  public hide(): void {
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }
    this.isVisible = false;
  }

  public isOpen(): boolean {
    return this.isVisible;
  }

  public getContainer(): Container {
    return this.container;
  }

  public destroy(): void {
    this.hide();
    this.container.destroy({
      children: true,
      texture: true,
    });
  }
}
