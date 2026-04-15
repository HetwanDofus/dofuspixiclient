/**
 * Spell 1204 - Panda Spell
 *
 * A projectile spell with a "shoot" animation that travels from caster to target.
 * Contains particle-like sprites (DefineSprite_4 and DefineSprite_6) that have
 * physics-based movement, and a "move" sprite (DefineSprite_9_move) with flickering alpha.
 *
 * The main "shoot" animation:
 * - Frame 4 (0-indexed: 3): _rotation = 0 (resets rotation)
 * - Frame 72 (0-indexed: 71): stop() + removeMovieClip() → animation ends
 * - From frame 39 (0-indexed: 38): a child clip starts decreasing _alpha by 3.34 each frame
 *
 * Sound:
 * - Frame 1 (0-indexed: 0): Play 'm_panda_spell_a'
 *
 * The shoot animation is positioned at caster, rotated toward target.
 * Hit is signaled when the projectile reaches the target (around when alpha fade begins ~ frame 38)
 * or when animation stops at frame 71.
 *
 * Components:
 * - shoot (DefineSprite_8_shoot): Main projectile animation at caster, rotated toward target
 *   - Stops at frame 71
 *   - From frame 38: alpha fades by 3.34 per frame
 *   - Frame 3: rotation reset to 0 (already handled by rotation applied at setup)
 *
 * Original AS timing:
 * - Frame 1 (main timeline): Play sound 'm_panda_spell_a'
 * - Frame 4 (shoot): _rotation = 0
 * - Frame 39 (shoot): child clip starts alpha -= 3.34 per frame
 * - Frame 72 (shoot): stop() + removeMovieClip()
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1204 extends BaseSpell {
  readonly spellId = 1204;

  private shootAnim!: FrameAnimatedSprite;
  private alphaFading = false;
  private alphaValue = 100;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const shootTextures = textures.getFrames('shoot');
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: shootTextures,
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Position at caster, rotated toward target
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 1 (0-indexed: 0): Play sound
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('m_panda_spell_a');
    });

    // Frame 4 (0-indexed: 3): _rotation = 0
    // In context of the spell, we keep the rotation toward target so this is a no-op
    // but we replicate it as: reset rotation to 0 as the AS does
    this.shootAnim.onFrame(3, () => {
      this.shootAnim.sprite.rotation = 0;
    });

    // Frame 39 (0-indexed: 38): start alpha fade (child clip alpha -= 3.34 per frame)
    // Signal hit at this point (projectile has reached target area)
    this.shootAnim.onFrame(38, () => {
      this.alphaFading = true;
      this.alphaValue = 100;
      this.signalHit();
    });

    // Frame 72 (0-indexed: 71): stop()
    this.shootAnim.stopAt(71);

    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply alpha fade from frame 39 onward (AS: _parent._alpha -= 3.34 per enterFrame)
    // Each frame is ~16.67ms at 60fps, deltaTime in ms
    if (this.alphaFading) {
      const framesElapsed = deltaTime / (1000 / 60);
      this.alphaValue -= 3.34 * framesElapsed;
      const clampedAlpha = Math.max(0, this.alphaValue);
      this.shootAnim.sprite.alpha = clampedAlpha / 100;
    }

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
