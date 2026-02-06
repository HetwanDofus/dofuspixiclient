/**
 * Spell 2040 - Unknown
 *
 * A spell with rotating elements that oscillate during animation.
 *
 * Components:
 * - shoot: Main animation (93 frames total)
 * - Rotating element 1: Oscillates with amplitude 30, frequency 0.6
 * - Rotating element 2: Oscillates with amplitude 10, frequency 3.1415
 *
 * Original AS timing:
 * - Frame 64: Second rotating element stops
 * - Frame 91: Spell ends
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 227.7,
  height: 189.6,
  offsetX: -188.7,
  offsetY: -105.6,
};

export class Spell2040 extends BaseSpell {
  readonly spellId = 2040;

  private shootAnim!: FrameAnimatedSprite;
  private rotationState1 = { a: 30, i: 0 };
  private rotationState2 = { a: 10, i: 0 };
  private stopRotation2 = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    this.shootAnim.sprite.rotation = init.angleRad;
    this.shootAnim
      .onFrame(63, () => {
        this.stopRotation2 = true;
      });
    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all registered animations
    this.anims.update(deltaTime);

    // Apply rotation formulas from AS
    // DefineSprite_10_move rotation
    this.rotationState1.i += 0.6;
    const rotation1 = 90 + this.rotationState1.a * Math.cos(this.rotationState1.i);
    this.rotationState1.a /= 1.1;

    // DefineSprite_8 rotation (stops at frame 64)
    if (!this.stopRotation2) {
      this.rotationState2.i += 3.1415;
      const rotation2 = 90 + this.rotationState2.a * Math.cos(this.rotationState2.i);
      this.rotationState2.a /= 1.5;
    }

    // Check completion (frame 91 in AS = index 90)
    if (this.shootAnim.getFrame() >= 90) {
      this.complete();
    }
  }
}