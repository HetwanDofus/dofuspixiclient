/**
 * Spell 101 - Artillerie
 *
 * A complex projectile spell with multiple particle effects including
 * bouncing particles, spiral effects, pulsing elements, and flickering components.
 *
 * Components:
 * - anim1: Main composite animation containing all visual effects
 *
 * Original AS timing:
 * - Frame 1: Play sound "arty_101"
 * - Frame 85: Signal hit (this.end())
 * - Frame 187: Remove parent (animation complete)
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 278.1,
  height: 182.7,
  offsetX: -135.60000000000002,
  offsetY: -90.6,
};

export class Spell101 extends BaseSpell {
  readonly spellId = 101;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation at caster position
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM1_MANIFEST),
      scale: init.scale,
    }));
    
    // Position at caster
    this.mainAnim.sprite.position.set(0, init.casterY);
    
    // Play sound at frame 1 (0-indexed frame 0)
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('arty_101'));
    
    // Signal hit at frame 85 (0-indexed frame 84)
    this.mainAnim.onFrame(84, () => this.signalHit());
    
    // Animation naturally completes at frame 187 (0-indexed frame 186)
    // The animation has 189 total frames, so it will complete on its own
    
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Check if animation is complete
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}