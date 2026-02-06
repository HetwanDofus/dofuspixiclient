/**
 * Spell 2071
 *
 * A simple animated effect with physics-based motion and random properties.
 *
 * Components:
 * - anim1: Main animation with random scale and physics motion
 *
 * Original AS timing:
 * - Frame 1: Initialize random scale (50-109%), velocity, and start frame
 * - Frame 106: Animation stops
 * - Frame 109: Complete spell
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 327.6,
  height: 269.4,
  offsetX: -163.8,
  offsetY: -130.8,
};

export class Spell2071 extends BaseSpell {
  readonly spellId = 2071;

  private mainAnim!: FrameAnimatedSprite;
  private vx = 0;
  private vy = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Random scale between 50-109% (AS: t = 50 + random(60))
    const t = 50 + Math.floor(Math.random() * 60);
    const randomScale = (t / 100) * init.scale;

    // Random velocities (exact AS formulas)
    this.vx = 6 * (-0.5 + Math.random());
    this.vy = -3 - 5 * Math.random();

    // Random starting frame (AS: gotoAndPlay(random(30) + 1))
    const startFrame = Math.floor(Math.random() * 30);

    // Create main animation
    const anim1Anchor = calculateAnchor(ANIM1_MANIFEST);
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      scale: randomScale,
      startFrame: startFrame,
      stopFrame: 107, // AS frame 108 (0-indexed)
    }));

    // Position at caster
    this.mainAnim.sprite.position.set(0, init.casterY);
    
    // Add to container
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update animation
    this.anims.update(deltaTime);

    // Apply physics (AS onEnterFrame logic)
    if (!this.mainAnim.isStopped()) {
      this.mainAnim.sprite.x += this.vx;
      this.mainAnim.sprite.y += this.vy;
      this.vx *= 0.9;
      this.vy *= 0.9;
    }

    // Check if we've reached frame 109 (AS DefineSprite_8 frame 109)
    if (this.mainAnim.getFrame() >= 108) {
      this.complete();
    }
  }
}