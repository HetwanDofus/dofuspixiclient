/**
 * Spell 1206 - Pandania
 *
 * A projectile spell with integrated particle effects.
 *
 * Components:
 * - shoot: Main animation with embedded particles
 *
 * Original AS timing:
 * - Frame 1: Play sound "m_panda_spell_a"
 * - Frame 4: Set rotation to 0
 * - Frame 39: Start fading (alpha -= 3.34 per frame)
 * - Frame 72: Stop and complete
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 691.5,
  height: 387,
  offsetX: -396,
  offsetY: -193.79999999999998,
};

export class Spell1206 extends BaseSpell {
  readonly spellId = 1206;

  private shootAnim!: FrameAnimatedSprite;
  private fadeStarted = false;
  private hitSignaledFlag = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));

    // Position at target
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    
    // Set initial rotation based on angle
    this.shootAnim.sprite.rotation = init.angleRad;

    // Set up animation callbacks
    this.shootAnim
      .onFrame(0, () => this.callbacks.playSound('m_panda_spell_a'))
      .onFrame(3, () => {
        // AS frame 4 = 0-indexed frame 3
        this.shootAnim.sprite.rotation = 0;
      })
      .onFrame(38, () => {
        // AS frame 39 = 0-indexed frame 38
        this.fadeStarted = true;
      })
      .stopAt(71); // AS frame 72 = 0-indexed frame 71

    this.container.addChild(this.shootAnim.sprite);

    // Signal hit at a reasonable time (around middle of animation)
    this.shootAnim.onFrame(35, () => {
      if (!this.hitSignaledFlag) {
        this.hitSignaledFlag = true;
        this.signalHit();
      }
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Handle fade effect (AS: _parent._alpha -= 3.34)
    if (this.fadeStarted && this.shootAnim.sprite.alpha > 0) {
      // 3.34 per frame at 60fps
      this.shootAnim.sprite.alpha -= 3.34 * (deltaTime / (1000 / 60)) / 100;
      if (this.shootAnim.sprite.alpha < 0) {
        this.shootAnim.sprite.alpha = 0;
      }
    }

    // Check completion
    if (this.shootAnim.isStopped()) {
      this.complete();
    }
  }
}