/**
 * Spell 2069 - Unknown Spell
 *
 * A simple animated effect with randomized alpha transparency.
 *
 * Components:
 * - anim1: Main animation at caster position
 *
 * Original AS timing:
 * - Frame 1: Set alpha to 30 + random(90)
 * - Frame 58: Stop animation
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM_MANIFEST: SpriteManifest = {
  width: 653.7,
  height: 804.5999999999999,
  offsetX: -432,
  offsetY: -578.4000000000001,
};

export class Spell2069 extends BaseSpell {
  readonly spellId = 2069;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation at caster position
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM_MANIFEST),
      scale: init.scale,
    }));
    
    // Set randomized alpha as per AS: _alpha = 30 + random(90)
    // AS alpha is 0-100, PIXI uses 0-1, so divide by 100
    const alphaValue = (30 + Math.floor(Math.random() * 90)) / 100;
    this.mainAnim.sprite.alpha = alphaValue;
    
    // Position at caster
    this.mainAnim.sprite.position.set(0, init.casterY);
    
    // Stop at frame 58 as per AS (frame_58/DoAction.as has stop())
    // AS frame 58 = TS frame 57 (0-indexed)
    this.mainAnim.stopAt(57);
    
    // Signal hit when animation completes
    this.mainAnim.onFrame(57, () => this.signalHit());
    
    this.container.addChild(this.mainAnim.sprite);
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