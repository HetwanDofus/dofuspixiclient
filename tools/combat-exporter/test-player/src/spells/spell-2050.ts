/**
 * Spell 2050 - Aspiration
 *
 * A suction/aspiration spell with a main animation containing embedded particle effects.
 *
 * Components:
 * - anim1: Main animation that plays and stops at frame 63
 *
 * Original AS timing:
 * - Frame 1: Play "aspiration" sound
 * - DefineSprite_11: Random Y position (-10 to +10), 25% chance of vertical flip, stops at frame 48
 * - DefineSprite_12: Stops and removes at frame 64
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 2939.1,
  height: 196.5,
  offsetX: -26.4,
  offsetY: -93,
};

export class Spell2050 extends BaseSpell {
  readonly spellId = 2050;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM1_MANIFEST),
      scale: init.scale,
    }));
    
    // Position at target
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    
    // Stop at frame 63 as per manifest stopFrame
    this.mainAnim
      .stopAt(62)
      .onFrame(0, () => this.callbacks.playSound('aspiration'));
    
    this.container.addChild(this.mainAnim.sprite);
    
    // Signal hit when animation completes
    this.mainAnim.onComplete(() => this.signalHit());
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when animation finishes
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}