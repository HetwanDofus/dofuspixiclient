/**
 * Spell 2105 - Pet Spell
 *
 * A pet-related spell animation with randomized visual elements.
 *
 * Components:
 * - anim1: Main composite animation with stop at frame 69
 *
 * Original AS timing:
 * - Frame 1: Play "pet" sound
 * - Frame 10 (DefineSprite_10): Call this.end()
 * - Frame 70 (DefineSprite_10): Stop and remove parent
 * - Various sprites have randomized scale/rotation
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 1234.2,
  height: 659.1,
  offsetX: -619.8,
  offsetY: -339.6,
};

export class Spell2105 extends BaseSpell {
  readonly spellId = 2105;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM1_MANIFEST),
      scale: init.scale,
    }));
    
    // Position at target (pet spells typically appear at target)
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    
    // Set up animation callbacks
    this.mainAnim
      .stopAt(68) // AS frame 69 is 0-indexed 68
      .onFrame(0, () => this.callbacks.playSound('pet')) // Frame 1 in AS
      .onFrame(9, () => this.signalHit()); // Frame 10 in AS calls this.end()
    
    // Add to container
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}