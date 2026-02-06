/**
 * Spell 2114 - Unknown Spell
 *
 * A spell with rotating elements and randomized sub-animations.
 *
 * Components:
 * - anim1: Main animation that plays to frame 99 and fades at 98
 * - Rotating elements with speeds +2 and -1.3 degrees per frame
 * - Random sub-animation starting at frames 1-31, stopping at frame 55
 *
 * Original AS timing:
 * - Frame 1: Play sound fx_612.mp3
 * - Frame 76: Play sound fx_611.mp3
 * - Frame 100: Main animation stops
 * - Frame 138: Spell completes (removeMovieClip)
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
  width: 1506,
  height: 771.3,
  offsetX: -753,
  offsetY: -312,
};

export class Spell2114 extends BaseSpell {
  readonly spellId = 2114;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const mainFrames = textures.getFrames('anim1');

    this.mainAnim = this.anims.add(new FrameAnimatedSprite(
      mainFrames,
      60,
      false,
      0
    ));

    this.mainAnim.anchor.set(...calculateAnchor(ANIM1_MANIFEST));
    this.mainAnim.scale.set(init.scale);
    this.mainAnim.y = init.casterY;

    this.container.addChild(this.mainAnim);

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('fx_612.mp3'))
      .onFrame(75, () => this.callbacks.playSound('fx_611.mp3'))
      .onFrame(99, () => this.mainAnim.fadeOut(300))
      .stopAt(99);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}