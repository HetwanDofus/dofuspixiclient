/**
 * Spell 2914 - Fireworks
 *
 * A fireworks spell with a "shoot" composite animation played at the target position.
 * The animation includes embedded particle systems (feux, plumes, plumes2) but since
 * the manifest provides the pre-composited frames as a single "shoot" animation,
 * we play those frames directly.
 *
 * Components:
 * - shoot: 291-frame composite animation at target position
 *
 * Original AS timing:
 * - DefineSprite_21/frame_58: Play sound 'explo_fireworks' (0-indexed: frame 57)
 * - DefineSprite_21/frame_64: Spawn feux/plumes2 particles (0-indexed: frame 63)
 * - DefineSprite_21/frame_85: stop() (0-indexed: frame 84) - signals hit
 * - DefineSprite_3_shoot/frame_289: _parent.removeMovieClip() + stop() (0-indexed: frame 288) - completion
 * - scripts/frame_259: this.removeMovieClip() (0-indexed: frame 258) - outer timeline end
 *
 * The main timeline has 291 frames for "shoot". The sound fires at frame 57 (0-indexed)
 * of the inner sprite_21. We map these to the composite "shoot" animation frames directly.
 *
 * Since this is a composite animation with all particles pre-rendered into the frames,
 * we simply play the "shoot" sprite sequence. The hit signal is at frame 57 (sound frame),
 * and completion when the animation ends at frame 288 (stop frame).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

export class Spell2914 extends BaseSpell {
  readonly spellId = 2914;

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

    // Sound fires at DefineSprite_21/frame_58 (1-indexed) -> 0-indexed: 57
    this.shootAnim.onFrame(57, () => this.callbacks.playSound('explo_fireworks'));

    // Hit signal at the explosion frame (DefineSprite_21/frame_64, 0-indexed: 63)
    this.shootAnim.onFrame(63, () => this.signalHit());

    // Stop at frame 288 (DefineSprite_3_shoot/frame_289 stop, 0-indexed: 288)
    this.shootAnim.stopAt(288);

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
