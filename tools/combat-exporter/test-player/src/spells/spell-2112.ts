/**
 * Spell 2112 - Unknown
 *
 * A spell animation with randomized starting frame and sound effect.
 *
 * Components:
 * - anim1: Main animation at target position
 *
 * Original AS timing:
 * - Frame 1: Jumps to random frame between 1-15
 * - Frame 7: Plays sound "dodge_610"
 * - Frame 40: Animation stops
 * - Frame 94: Spell completes
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 423,
  height: 1672.8000000000002,
  offsetX: -213.29999999999998,
  offsetY: -1551.6000000000001,
};

export class Spell2112 extends BaseSpell {
  readonly spellId = 2112;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation at target position
    const anim1Anchor = calculateAnchor(ANIM1_MANIFEST);
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      scale: init.scale,
    }));

    // Position at target
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // AS: gotoAndPlay(random(15) + 1) - random frame between 1-15
    // In 0-indexed: random frame between 0-14
    const randomStartFrame = Math.floor(Math.random() * 15);
    this.mainAnim.gotoFrame(randomStartFrame);
    
    // AS: frame 7 plays sound (0-indexed: frame 6)
    this.mainAnim.onFrame(6, () => this.callbacks.playSound('dodge_610'));
    
    // AS: frame 94 calls _parent.removeMovieClip() - spell completes
    // 0-indexed: frame 93
    this.mainAnim.onFrame(93, () => this.complete());
    
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
  }
}