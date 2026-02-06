/**
 * Spell 111 - Artillery
 *
 * An artillery spell with repeated sound effects and random starting frame.
 *
 * Components:
 * - anim1: Main animation with 69 frames, stops at frame 67
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_3): gotoAndPlay(random(60) + 2) - randomizes starting frame
 * - Frame 1 (DefineSprite_13): Play sound "arty_111"
 * - Frame 10 (DefineSprite_13): Play sound "arty_111"
 * - Frame 19 (DefineSprite_13): Play sound "arty_111"
 * - Frame 31 (DefineSprite_13): Play sound "arty_111"
 * - Frame 67 (DefineSprite_14): Stop animation and remove
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 948,
  height: 1008.9,
  offsetX: -495.3,
  offsetY: -972.3,
};

export class Spell111 extends BaseSpell {
  readonly spellId = 111;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anim1Textures = textures.getFrames('anim1');
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Calculate random starting frame: random(60) + 2 in AS (1-indexed)
    // In TypeScript (0-indexed): Math.floor(Math.random() * 60) + 1
    const randomStartFrame = Math.floor(Math.random() * 60) + 1;

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: anim1Textures,
      fps: 60,
      loop: false,
      startFrame: randomStartFrame,
      stopFrame: 66,  // AS frame 67 is index 66
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.container.addChild(this.mainAnim.sprite);

    // Sound effects at specific frames (AS 1-indexed to TS 0-indexed)
    // Frame 1 -> 0, Frame 10 -> 9, Frame 19 -> 18, Frame 31 -> 30
    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('arty_111'))
      .onFrame(9, () => this.callbacks.playSound('arty_111'))
      .onFrame(18, () => this.callbacks.playSound('arty_111'))
      .onFrame(30, () => this.callbacks.playSound('arty_111'));

    // No explicit hit signal in AS, so signal hit at completion
    this.mainAnim.onStop(() => this.signalHit());
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Check for completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}