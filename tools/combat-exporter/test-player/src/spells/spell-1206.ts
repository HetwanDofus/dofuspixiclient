/**
 * Spell 1206 - Panda Spell
 *
 * A projectile spell with particle trail effects.
 *
 * Components:
 * - shoot (DefineSprite_8_shoot): Main projectile animation at caster position,
 *   rotated toward target. Frame 4: _rotation = 0. Frame 39: alpha fades by 3.34/frame.
 *   Frame 72: stop() and removeMovieClip().
 *
 * The shoot sprite is a composite animation with 74 frames.
 * At frame 4 (0-indexed: 3), _rotation is set to 0.
 * Starting at frame 39 (0-indexed: 38), alpha decreases by 3.34 per frame.
 * At frame 72 (0-indexed: 71), stop() is called.
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'm_panda_spell_a'
 * - Frame 4 (shoot): _rotation = 0
 * - Frame 39 (shoot): Begin alpha fade (-3.34 per frame)
 * - Frame 72 (shoot): stop() + removeMovieClip()
 *
 * Hit signal: at frame 39 when the alpha fade begins (projectile reaches target)
 */

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

export class Spell1206 extends BaseSpell {
  readonly spellId = 1206;

  private shootAnim!: FrameAnimatedSprite;
  private alphaFading = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    // Main shoot animation at caster position, rotated toward target
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 1 (0-indexed: 0): Play sound
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('m_panda_spell_a');
    });

    // Frame 4 (0-indexed: 3): _rotation = 0
    this.shootAnim.onFrame(3, () => {
      this.shootAnim.sprite.rotation = 0;
    });

    // Frame 39 (0-indexed: 38): Begin alpha fade, signal hit
    this.shootAnim.onFrame(38, () => {
      this.alphaFading = true;
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

    // Apply alpha fade once frame 39 is reached (-3.34 per frame)
    // deltaTime is in ms, frame time is 1000/60 ms
    if (this.alphaFading) {
      const framesElapsed = deltaTime / (1000 / 60);
      this.shootAnim.sprite.alpha = Math.max(0, this.shootAnim.sprite.alpha - 3.34 / 100 * framesElapsed);
    }

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
