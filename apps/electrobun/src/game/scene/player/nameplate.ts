import { type Container, Graphics, Text, TextStyle } from "pixi.js";

// TextFormat("Verdana", 10, 0xFFFFFF, true) with embedFonts=true in original Dofus client.
const NAME_FONT_FAMILY = "DofusVerdana, Verdana, sans-serif";
const NAME_FONT_SIZE = 10;
const NAME_COLOR = 0xffffff;

// Fixed offset above the sprite — matches original client's DEFAULT_SPRITE_HEIGHT = 50.
// Fixed (not derived from frame height) prevents jiggle when animations change frame size.
const TOP_Y = -50;
const TEXT_RESOLUTION = 4;

const BG_WIDTH_SPACER = 4;
const BG_HEIGHT_SPACER = 4;
const BG_FLASH_TEXT_HEIGHT = 12;
const BG_CORNER_RADIUS = 3;
const BG_COLOR = 0x000000;
const BG_ALPHA = 0.7;

function createNameStyle(): TextStyle {
  return new TextStyle({
    fontFamily: NAME_FONT_FAMILY,
    fontSize: NAME_FONT_SIZE,
    fontWeight: "bold",
    fill: NAME_COLOR,
    align: "center",
  });
}

/** Owns the name label and its background for a single player. */
export class PlayerNameplate {
  readonly text: Text;
  readonly bg: Graphics;

  constructor(name: string) {
    this.text = new Text({ text: name, style: createNameStyle() });
    this.text.resolution = TEXT_RESOLUTION;
    this.text.anchor.set(0.5, 0.5);
    this.text.y = TOP_Y - (BG_FLASH_TEXT_HEIGHT + BG_HEIGHT_SPACER * 2) / 2;
    this.text.visible = false;

    this.bg = new Graphics();
    this.bg.visible = false;
  }

  setName(name: string): void {
    this.text.text = name;
  }

  getName(): string {
    return this.text.text;
  }

  setResolution(resolution: number): void {
    this.text.resolution = resolution;
  }

  show(container: Container): void {
    this.redrawBackground();

    if (!this.bg.parent) {
      container.addChild(this.bg);
    }

    if (!this.text.parent) {
      container.addChild(this.text);
    }

    this.bg.visible = true;
    this.text.visible = true;
  }

  hide(container: Container): void {
    this.text.visible = false;
    this.bg.visible = false;

    if (this.text.parent) {
      container.removeChild(this.text);
    }

    if (this.bg.parent) {
      container.removeChild(this.bg);
    }
  }

  private redrawBackground(): void {
    const w = Math.ceil(this.text.width) + BG_WIDTH_SPACER * 2;
    const h = BG_FLASH_TEXT_HEIGHT + BG_HEIGHT_SPACER * 2;
    this.bg.clear();
    this.bg.roundRect(-w / 2, this.text.y - h / 2, w, h, BG_CORNER_RADIUS);
    this.bg.fill({ color: BG_COLOR, alpha: BG_ALPHA });
  }
}
