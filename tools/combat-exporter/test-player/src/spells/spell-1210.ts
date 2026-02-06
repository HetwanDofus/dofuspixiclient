/**
 * Spell 1210 - Pandawa Wave
 *
 * A directional wave effect that adapts based on casting angle.
 *
 * Components:
 * - duplicate: Main animation that flips and changes timeline based on angle
 *
 * Original AS timing:
 * - Frame 1: Play sound "panda_vague" and check angle for direction
 * - Frame 127: Remove if angle >= 0 
 * - Frame 271: Remove if angle < 0
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const DUPLICATE_MANIFEST: SpriteManifest = {
  width: 809.7,
  height: 718.8,
  offsetX: -352.2,
  offsetY: -344.1,
};

export class Spell1210 extends BaseSpell {
  readonly spellId = 1210;

  private duplicateAnim!: FrameAnimatedSprite;
  private isNegativeAngle = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Determine animation direction based on angle
    const angle = context?.angle ?? 0;
    this.isNegativeAngle = angle < 0;

    // Create main animation
    this.duplicateAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('duplicate'),
      ...calculateAnchor(DUPLICATE_MANIFEST),
      scale: init.scale,
      startFrame: this.isNegativeAngle ? 147 : 0,
    }));

    // Position at caster
    this.duplicateAnim.sprite.position.set(0, init.casterY);

    // Flip horizontally if angle > 90 or < -90 (facing left)
    if (Math.abs(angle) > 90) {
      this.duplicateAnim.sprite.scale.x = -this.duplicateAnim.sprite.scale.x;
    }

    // Play sound at frame 1
    this.duplicateAnim.onFrame(0, () => this.callbacks.playSound('panda_vague'));

    // Stop at appropriate frame based on angle
    if (this.isNegativeAngle) {
      // For negative angles, plays from 148 to 271
      this.duplicateAnim.stopAt(270);
    } else {
      // For positive angles, plays from 1 to 127
      this.duplicateAnim.stopAt(126);
    }

    this.container.addChild(this.duplicateAnim.sprite);
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