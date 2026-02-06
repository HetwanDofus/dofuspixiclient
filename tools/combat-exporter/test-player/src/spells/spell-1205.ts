/**
 * Spell 1205 - Panda Spell
 *
 * A self-contained animation with embedded particle effects.
 *
 * Components:
 * - shoot: Main animation with embedded particles that fades out
 *
 * Original AS timing:
 * - Frame 1: Play sound "m_panda_spell_a"
 * - Frame 4: Reset rotation to 0
 * - Frame 39: Start fade out (alpha -= 3.34 per frame)
 * - Frame 72: Stop and remove
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

export class Spell1205 extends BaseSpell {
  readonly spellId = 1205;

  private shootAnim!: FrameAnimatedSprite;
  private fadeStarted = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation with embedded particles
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    
    // Position at target
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    
    // The animation controls its own timing
    this.shootAnim
      .stopAt(73)
      .onFrame(0, () => this.callbacks.playSound('m_panda_spell_a'))
      .onFrame(3, () => {
        // AS frame 4 = TS frame 3
        this.shootAnim.sprite.rotation = 0;
      })
      .onFrame(38, () => {
        // AS frame 39 = TS frame 38
        this.fadeStarted = true;
      })
      .onFrame(71, () => {
        // AS frame 72 = TS frame 71
        // The AS calls stop() and removeMovieClip() here
        this.signalHit();
      });
    
    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply fade effect starting from frame 39
    if (this.fadeStarted && this.shootAnim.sprite.alpha > 0) {
      // AS decreases alpha by 3.34 per frame
      // At 60 FPS, this is 3.34 * 60 = 200.4 per second
      this.shootAnim.sprite.alpha -= 200.4 * (deltaTime / 1000);
      if (this.shootAnim.sprite.alpha < 0) {
        this.shootAnim.sprite.alpha = 0;
      }
    }

    // Complete when animation finishes
    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}