/**
 * Spell 2048 - Unknown
 *
 * A projectile spell with a wobbling rotation effect that travels to the target.
 *
 * Components:
 * - shoot: Main projectile animation with oscillating rotation
 *
 * Original AS timing:
 * - Frame 1: Play "pic" sound
 * - Frame 1-91: Wobbling rotation animation (amplitude dampens over time)
 * - Frame 91: Remove projectile and stop
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 77.1,
  height: 189.60000000000002,
  offsetX: -74.69999999999999,
  offsetY: -105.60000000000001,
};

export class Spell2048 extends BaseSpell {
  readonly spellId = 2048;

  private shootAnim!: FrameAnimatedSprite;
  private rotationAmplitude = 30;
  private rotationAngle = 0;
  private baseRotation = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Convert angle to radians and add 90 degrees as per AS
    this.baseRotation = init.angleRad + (Math.PI / 2);

    // Shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    this.shootAnim
      .stopAt(92) // Frame 93 in AS (1-indexed) = 92 (0-indexed)
      .onFrame(0, () => this.callbacks.playSound('pic'))
      .onFrame(90, () => this.signalHit()); // Signal hit just before removal
    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply wobbling rotation effect as per AS
    if (!this.shootAnim.isStopped() && !this.shootAnim.isComplete()) {
      this.shootAnim.sprite.rotation = this.baseRotation + (this.rotationAmplitude * Math.PI / 180) * Math.cos(this.rotationAngle);
      this.rotationAngle += 0.6;
      this.rotationAmplitude /= 1.1;
    }

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}