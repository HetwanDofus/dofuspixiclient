/**
 * ThreeSliceSprite — PixiJS equivalent of Flash's ButtonBackground.
 *
 * Replicates the Flash 3-slice horizontal layout:
 *   left_mc | middle_mc | right_mc
 *
 * - Left and right caps maintain aspect ratio (bBorderAspectRatio=true)
 * - Middle stretches to fill remaining width
 * - All three scale vertically to target height
 *
 * Based on ank.gapi.controls.button.ButtonBackground.setSize()
 */

import { Container, Sprite, Texture } from "pixi.js";

import { loadSvg } from "@/render/load-svg";

export interface ThreeSliceTextures {
  left: Texture;
  middle: Texture;
  right: Texture;
}

export class ThreeSliceSprite extends Container {
  private leftSprite: Sprite;
  private middleSprite: Sprite;
  private rightSprite: Sprite;
  private targetW: number;
  private targetH: number;

  constructor(w: number, h: number) {
    super();
    this.targetW = w;
    this.targetH = h;

    this.leftSprite = new Sprite(Texture.EMPTY);
    this.middleSprite = new Sprite(Texture.EMPTY);
    this.rightSprite = new Sprite(Texture.EMPTY);

    this.addChild(this.leftSprite);
    this.addChild(this.middleSprite);
    this.addChild(this.rightSprite);
  }

  /** Set the 3-slice textures and arrange them. */
  setTextures(textures: ThreeSliceTextures): void {
    this.leftSprite.texture = textures.left;
    this.middleSprite.texture = textures.middle;
    this.rightSprite.texture = textures.right;

    // Native dimensions from the texture source
    const leftNatW = textures.left.width;
    const leftNatH = textures.left.height;
    const rightNatW = textures.right.width;

    // bBorderAspectRatio: scale X = scale Y for left/right caps
    // scaleY = targetH / nativeH
    const scaleY = this.targetH / leftNatH;

    // Left cap: maintain aspect ratio
    const leftW = leftNatW * scaleY;
    this.leftSprite.x = 0;
    this.leftSprite.y = 0;
    this.leftSprite.width = leftW;
    this.leftSprite.height = this.targetH;

    // Right cap: maintain aspect ratio
    const rightW = rightNatW * scaleY;
    this.rightSprite.x = this.targetW - rightW;
    this.rightSprite.y = 0;
    this.rightSprite.width = rightW;
    this.rightSprite.height = this.targetH;

    // Middle: stretch to fill
    this.middleSprite.x = leftW;
    this.middleSprite.y = 0;
    this.middleSprite.width = this.targetW - leftW - rightW;
    this.middleSprite.height = this.targetH;

  }

  /** Resize to new dimensions and re-arrange. */
  resize(w: number, h: number): void {
    this.targetW = w;
    this.targetH = h;
    if (this.leftSprite.texture !== Texture.EMPTY) {
      this.setTextures({
        left: this.leftSprite.texture,
        middle: this.middleSprite.texture,
        right: this.rightSprite.texture,
      });
    }
  }

  /** Load just the textures from a directory (for caching/reuse) */
  static async loadTextures(
    basePath: string,
    resolution?: number
  ): Promise<ThreeSliceTextures> {
    const res = resolution ?? (globalThis.devicePixelRatio || 1);
    const [left, middle, right] = await Promise.all([
      loadSvg(`${basePath}/left.svg`, res),
      loadSvg(`${basePath}/middle.svg`, res),
      loadSvg(`${basePath}/right.svg`, res),
    ]);
    return { left, middle, right };
  }

  /** Load 3-slice textures from a directory containing left.svg, middle.svg, right.svg */
  static async load(
    basePath: string,
    w: number,
    h: number,
    resolution?: number
  ): Promise<ThreeSliceSprite> {
    const res = resolution ?? (globalThis.devicePixelRatio || 1);
    const [left, middle, right] = await Promise.all([
      loadSvg(`${basePath}/left.svg`, res),
      loadSvg(`${basePath}/middle.svg`, res),
      loadSvg(`${basePath}/right.svg`, res),
    ]);

    const sprite = new ThreeSliceSprite(w, h);
    sprite.setTextures({ left, middle, right });
    return sprite;
  }
}
