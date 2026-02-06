/**
 * Spell 2104 - Unknown
 *
 * A rotating projectile spell that shoots from caster to target.
 * Features oscillating rotation effects on the projectile.
 *
 * Components:
 * - shoot: Main projectile animation with oscillating rotation
 *
 * Original AS timing:
 * - Frames 1-64: DefineSprite_9 rotates with oscillation (a=10, i+=3.1415)
 * - Frame 64: DefineSprite_9 stops
 * - Frames 1-91: DefineSprite_11 rotates with oscillation (a=30, i+=0.6)
 * - Frame 91: Animation completes
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 178.5,
  height: 189.6,
  offsetX: -139.5,
  offsetY: -105.6,
};

// Rotation state for DefineSprite_9 (frames 0-63)
class RotatingSprite9 {
  private a = 10;
  private i = 0;
  
  update(): number {
    this.i += 3.1415;
    const rotation = 90 + this.a * Math.cos(this.i);
    this.a /= 1.3;
    return rotation * Math.PI / 180; // Convert to radians
  }
}

// Rotation state for DefineSprite_11 (entire animation)
class RotatingSprite11 {
  private a = 30;
  private i = 0;
  
  update(): number {
    this.i += 0.6;
    const rotation = 90 + this.a * Math.cos(this.i);
    this.a /= 1.1;
    return rotation * Math.PI / 180; // Convert to radians
  }
}

export class Spell2104 extends BaseSpell {
  readonly spellId = 2104;

  private shootAnim!: FrameAnimatedSprite;
  private rotator9 = new RotatingSprite9();
  private rotator11 = new RotatingSprite11();

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    
    // Position at target
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    
    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update animations
    this.anims.update(deltaTime);
    
    // Apply oscillating rotation based on current frame
    const frame = this.shootAnim.getFrame();
    
    if (frame < 64) {
      // DefineSprite_9 behavior (frames 0-63)
      this.shootAnim.sprite.rotation = this.rotator9.update();
    } else {
      // DefineSprite_11 behavior (frames 64-92)
      this.shootAnim.sprite.rotation = this.rotator11.update();
    }

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}