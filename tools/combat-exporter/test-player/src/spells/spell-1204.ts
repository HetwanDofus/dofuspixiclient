/**
 * Spell 1204 - Pandanlku
 *
 * A panda spell with shooting animation and particle effects.
 *
 * Components:
 * - shoot: Main animation that fades out starting at frame 39
 *
 * Original AS timing:
 * - Frame 1: Play sound "m_panda_spell_a"
 * - Frame 4: Set rotation to 0
 * - Frame 39: Start alpha fade (3.34 per frame)
 * - Frame 72: Stop animation and remove
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

export class Spell1204 extends BaseSpell {
  readonly spellId = 1204;

  private shootAnim!: FrameAnimatedSprite;
  private fadeStarted = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame callbacks matching AS behavior
    this.shootAnim
      .onFrame(0, () => this.callbacks.playSound('m_panda_spell_a'))
      .onFrame(3, () => {
        // AS frame 4 = TS frame 3
        this.shootAnim.sprite.rotation = 0;
      })
      .onFrame(38, () => {
        // AS frame 39 = TS frame 38
        this.fadeStarted = true;
      })
      .stopAt(71); // AS frame 72 = TS frame 71

    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update animations
    this.anims.update(deltaTime);

    // Apply alpha fade starting from frame 39
    if (this.fadeStarted) {
      this.shootAnim.sprite.alpha -= 3.34 * (deltaTime / 16.67); // Normalize to 60fps
      if (this.shootAnim.sprite.alpha < 0) {
        this.shootAnim.sprite.alpha = 0;
      }
    }

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}