/**
 * Spell 310 - Setag (Earth spell)
 *
 * A rock/stone projectile spell that launches from the caster position,
 * bounces with gravity, and eventually comes to rest.
 *
 * Components:
 * - shoot (composite animation): The main "shoot" sprite with 132 frames
 *   - Contains a moving rock (DefineSprite_8_shoot / DefineSprite_9_move) with
 *     gravity physics, bounce, rotation, and alpha fade-out starting at frame 103
 *   - Contains stone debris particles (DefineSprite_12_pierres)
 *   - Contains circle particles (DefineSprite_19_cercle / DefineSprite_18)
 *
 * Since the manifest exports the full composite animation as a single sprite sheet,
 * we play the pre-composited "shoot" animation directly.
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'setag_305'
 * - Frame 1 (DefineSprite_8_shoot DoAction): Play sound 'setag_310' (initial launch)
 * - Frame 103: Rock alpha starts fading (alpha -= 3 per frame)
 * - Frame 130: removeMovieClip + stop (animation ends)
 * - Hit signal: When rock first hits ground (_Y > 0), plays 'setag_310' again
 *   This happens dynamically but we approximate it at frame ~30 based on physics
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 106.85,
  height: 77.85,
  offsetX: -41.7,
  offsetY: -74.2,
};

export class Spell310 extends BaseSpell {
  readonly spellId = 310;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): Play launch sound
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('setag_305');
      this.callbacks.playSound('setag_310');
    });

    // Approximate bounce/hit moment - rock lands and plays second impact sound
    // Based on AS physics: g starts at -15 to -23, increments by 1.3 per frame
    // Rock hits ground when _Y > 0, typically around frame 15-25
    // We signal hit at frame 20 (0-indexed) as a reasonable approximation
    this.shootAnim.onFrame(20, () => {
      this.callbacks.playSound('setag_310');
      this.signalHit();
    });

    // Frame 129 (AS frame 130): animation ends
    this.shootAnim.stopAt(129);

    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
