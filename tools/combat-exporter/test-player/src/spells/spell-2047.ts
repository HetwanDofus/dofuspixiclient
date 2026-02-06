/**
 * Spell 2047 - Projectile with Decaying Wobble
 *
 * A projectile spell with a distinctive oscillating rotation that dampens over time.
 * The projectile wobbles around a 90-degree base angle with decreasing amplitude.
 *
 * Components:
 * - shoot: Main projectile animation with oscillating rotation
 *
 * Original AS timing:
 * - Frame 1-87: Projectile travels with decaying wobble motion
 * - Frame 88: Animation stops and removes itself
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

export class Spell2047 extends BaseSpell {
  readonly spellId = 2047;

  private shootAnim!: FrameAnimatedSprite;
  
  // Movement parameters from AS
  private a = 30;  // Amplitude
  private i = 0;   // Counter for oscillation

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const manifest: SpriteManifest = {
      width: 1341.6,
      height: 246.60000000000002,
      offsetX: 9.3,
      offsetY: -149.7,
    };

    // Create the shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: calculateAnchor(manifest.width, manifest.offsetX),
      anchorY: calculateAnchor(manifest.height, manifest.offsetY),
      startFrame: 0,
      animationSpeed: 1,
    }));

    // Apply scale
    this.shootAnim.scale.set(init.scale);

    // Position at caster
    this.shootAnim.position.set(0, init.casterY);

    // Add to container
    this.container.addChild(this.shootAnim);

    // Stop at frame 88 (index 87) as per AS
    this.shootAnim.stopAt(87);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Apply the oscillating rotation as per AS onEnterFrame
    // _rotation = 90 + a * Math.cos(i += 0.6);
    // a /= 1.1;
    if (!this.shootAnim.isStopped()) {
      this.shootAnim.rotation = (90 + this.a * Math.cos(this.i)) * (Math.PI / 180);
      this.i += 0.6;
      this.a /= 1.1;
    }

    // Check if animation is complete
    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}