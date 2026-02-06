/**
 * Spell 1003 - Licrounch
 *
 * A crunching bite attack with random visual variations and fade effects.
 *
 * Components:
 * - anim1: Main bite animation at caster position
 * - anim29: Secondary effect animation at caster position
 *
 * Original AS timing:
 * - Frame 1: Play sound "licrounch_1003" 
 * - Frame 133: Signal hit (this.end())
 * - Frame 133-169: Fade out (alpha -= 5 per frame)
 * - Frame 169: Stop animation
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM_MANIFEST: SpriteManifest = {
  width: 789.3,
  height: 355.5,
  offsetX: -226.5,
  offsetY: -218.7,
};

export class Spell1003 extends BaseSpell {
  readonly spellId = 1003;

  private mainAnim!: FrameAnimatedSprite;
  private secondaryAnim!: FrameAnimatedSprite;
  private fadeStarted = false;
  private currentAlpha = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation (anim1) at caster position
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(0, init.casterY);
    this.mainAnim
      .stopAt(167)
      .onFrame(0, () => this.callbacks.playSound('licrounch_1003'))
      .onFrame(132, () => {
        this.signalHit();
        this.fadeStarted = true;
      });
    this.container.addChild(this.mainAnim.sprite);

    // Secondary animation (anim29) at caster position
    this.secondaryAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim29'),
      ...calculateAnchor(ANIM_MANIFEST),
      scale: init.scale,
    }));
    this.secondaryAnim.sprite.position.set(0, init.casterY);
    this.secondaryAnim.stopAt(167);
    this.container.addChild(this.secondaryAnim.sprite);

    // Random starting frame for variety (as per DefineSprite_5)
    const randomFrame = Math.floor(Math.random() * 5);
    this.mainAnim.gotoFrame(randomFrame);
    this.secondaryAnim.gotoFrame(randomFrame);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Handle fade-out effect after hit
    if (this.fadeStarted) {
      this.currentAlpha -= 5 * (deltaTime / 1000) * 60; // 5 per frame at 60fps
      if (this.currentAlpha < 0) {
        this.currentAlpha = 0;
      }
      this.container.alpha = this.currentAlpha;
    }

    // Check completion
    if (this.anims.allComplete() && this.currentAlpha <= 0) {
      this.complete();
    }
  }
}