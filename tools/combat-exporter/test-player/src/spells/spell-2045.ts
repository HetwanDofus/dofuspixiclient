/**
 * Spell 2045 - Unknown Name
 *
 * A projectile spell that travels from caster to target over 45 frames.
 *
 * Components:
 * - sprite_10: Main projectile animation that moves to target
 * - DefineSprite_3: Rotating element with random rotation speed
 *
 * Original AS timing:
 * - Frame 1-45: Projectile moves from caster to target
 * - Frame 46: Play sound "pok" and signal hit
 * - Frame 88: Animation ends and cleanup
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 749.7,
  height: 1110,
  offsetX: -393.29999999999995,
  offsetY: -945.5999999999999,
};

export class Spell2045 extends BaseSpell {
  readonly spellId = 2045;

  private projectileAnim!: FrameAnimatedSprite;
  private frameCount = 0;
  private dx = 0;
  private dy = 0;
  private startX = 0;
  private startY = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Calculate movement deltas (exact AS formulas)
    this.dx = init.targetX / 45;
    this.dy = (init.targetY - 20) / 45;
    this.startX = 0;
    this.startY = init.casterY;

    // Create main projectile animation
    this.projectileAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      ...calculateAnchor(SPRITE_10_MANIFEST),
      scale: init.scale,
    }));

    // Set initial position
    this.projectileAnim.sprite.position.set(this.startX, this.startY);

    // Set up frame callbacks
    this.projectileAnim
      .onFrame(45, () => {
        this.callbacks.playSound('pok');
        this.signalHit();
      })
      .stopAt(87);

    // Note: DefineSprite_3 has rotating behavior but it's internal to the sprite
    // The AS shows random rotation (r = random(90)) applied each frame
    // This would be part of the sprite animation itself

    this.container.addChild(this.projectileAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update animations
    this.anims.update(deltaTime);

    // Move projectile for first 45 frames
    if (this.frameCount < 45) {
      this.startX += this.dx;
      this.startY += this.dy;
      this.projectileAnim.sprite.position.set(this.startX, this.startY);
    }
    this.frameCount++;

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}