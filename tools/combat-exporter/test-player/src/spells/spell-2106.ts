/**
 * Spell 2106 - Unknown
 *
 * A projectile spell with rotating elements that oscillate during animation.
 *
 * Components:
 * - shoot: Main animation with embedded oscillating sprites
 *
 * Original AS timing:
 * - Frame 1: Two sprites start oscillating rotations
 * - Frame 64: One sprite stops (DefineSprite_8)
 * - Frame 91: Animation completes
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

export class Spell2106 extends BaseSpell {
  readonly spellId = 2106;

  private shootAnim!: FrameAnimatedSprite;
  
  // Oscillation state for DefineSprite_10_move
  private a1 = 30;
  private i1 = 0;
  
  // Oscillation state for DefineSprite_8
  private a2 = 10;
  private i2 = 0;
  private sprite8Active = true;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: 184.5 / 223.5,
      anchorY: 105.6 / 200.1,
      scale: init.scale,
    }));
    
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    this.shootAnim.sprite.rotation = init.angleRad;
    
    // Frame 91 is when the spell completes
    this.shootAnim.stopAt(92);
    
    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Get current frame of shoot animation
    const currentFrame = this.shootAnim.getCurrentFrame();
    
    // Apply oscillating rotations based on AS code
    // DefineSprite_10_move continues throughout
    // AS: _rotation = 90 + a * Math.cos(i += 0.6);
    this.i1 += 0.6;
    this.a1 /= 1.1;
    const rotation1 = (90 + this.a1 * Math.cos(this.i1)) * Math.PI / 180;
    
    // DefineSprite_8 stops at frame 64 (0-indexed: 63)
    if (this.sprite8Active && currentFrame < 63) {
      // AS: _rotation = 90 + a * Math.cos(i += 3.1415);
      this.i2 += 3.1415;
      this.a2 /= 1.5;
      const rotation2 = (90 + this.a2 * Math.cos(this.i2)) * Math.PI / 180;
      
      // Since we can't directly rotate sub-sprites in a composite animation,
      // we apply the combined effect to the main sprite
      // In the original, these would be rotating independently
      this.shootAnim.sprite.rotation = init.angleRad + (rotation1 + rotation2) / 2;
    } else {
      if (currentFrame >= 63) {
        this.sprite8Active = false;
      }
      // Only apply rotation from DefineSprite_10_move
      this.shootAnim.sprite.rotation = init.angleRad + rotation1;
    }
    
    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}