/**
 * Spell 1051 - Sacrieur Spell
 *
 * A chaotic visual effect with randomized scaling and flickering.
 *
 * Components:
 * - sprite_6: Main animation at caster position with random scale
 *
 * Original AS timing:
 * - Frame 1: Play sound, set random scale (20-100%)
 * - Frame 1: Flickering effect with random alpha/scale/rotation each frame
 * - Frame 39: Stop animation
 * - Frame 47: Complete and remove
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_MANIFEST: SpriteManifest = {
  width: 871.2,
  height: 612,
  offsetX: -47.4,
  offsetY: -306.6,
};

export class Spell1051 extends BaseSpell {
  readonly spellId = 1051;

  private mainAnim!: FrameAnimatedSprite;
  private flickerTimer = 0;
  private flickerInterval = 1000 / 40; // 40 FPS for flicker effect

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation with random scale from AS: t = 20 + random(80)
    const randomScale = (20 + Math.floor(Math.random() * 80)) / 100;
    
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_6'),
      ...calculateAnchor(SPRITE_MANIFEST),
      scale: init.scale * randomScale,
    }));
    
    this.mainAnim.sprite.position.set(0, init.casterY);
    
    // Stop at frame 39 as per AS
    this.mainAnim.stopAt(38);
    
    // Play sound at frame 1
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('sacrieur_1051'));
    
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Flickering effect from AS onClipEvent(enterFrame)
    this.flickerTimer += deltaTime;
    if (this.flickerTimer >= this.flickerInterval) {
      this.flickerTimer -= this.flickerInterval;
      
      // Random alpha: -20 to 60 -> normalized to 0 to 0.8
      const alphaValue = (-20 + Math.floor(Math.random() * 81));
      this.mainAnim.sprite.alpha = Math.max(0, alphaValue / 100);
      
      // Random scale: 90% to 100% of current scale
      const scaleMultiplier = (90 + Math.floor(Math.random() * 11)) / 100;
      const baseScale = this.mainAnim.sprite.scale.x / scaleMultiplier; // Get original scale
      this.mainAnim.sprite.scale.set(baseScale * scaleMultiplier);
      
      // Random rotation: 0-360 degrees
      this.mainAnim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
    }

    // Complete at frame 47 (total timeline duration)
    // 47 frames at 40 FPS = 1175ms
    if (this.mainAnim.isComplete() && this.mainAnim.elapsedTime >= 1175) {
      this.complete();
    }
  }
}