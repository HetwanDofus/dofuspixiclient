/**
 * Spell 1201 - (Osamodas Snake/Rope spell)
 *
 * A snake/rope-like animation that plays at the target position,
 * rotated toward the caster angle. The sprite_39 animation has 117 frames.
 *
 * Components:
 * - sprite_39: Main animation at target position, rotated by angle+90
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_39): _rotation = _parent.angle + 90
 * - Frame 4 (DefineSprite_39): Play sound 'explosion'
 * - Frame 115 (DefineSprite_39): removeMovieClip() -> spell ends
 * - Frame 2 (main timeline): stop()
 *
 * Note: DefineSprite_21 and DefineSprite_20 appear to be sub-sprites
 * within sprite_39 (composite animation) - their behavior is baked into
 * the composite frames. The main animation is sprite_39 with 117 frames,
 * ending at frame 115 (0-indexed: 114).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_39_MANIFEST: SpriteManifest = {
  width: 202,
  height: 233.3,
  offsetX: -98.75,
  offsetY: -157.75,
};

export class Spell1201 extends BaseSpell {
  readonly spellId = 1201;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SPRITE_39_MANIFEST);

    // Main animation (sprite_39) at target position
    // AS: _rotation = _parent.angle + 90
    const mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_39'),
      fps: 40,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    mainAnim.sprite.position.set(init.targetX, init.targetY);
    // AS: _rotation = _parent.angle + 90 (angle is in degrees, convert to radians)
    mainAnim.sprite.rotation = ((context?.angle ?? 0) + 90) * Math.PI / 180;

    // Frame 4 (0-indexed: 3): Play sound 'explosion'
    mainAnim.onFrame(3, () => this.callbacks.playSound('explosion'));

    // Frame 115 (0-indexed: 114): removeMovieClip() -> signal hit and end
    mainAnim.onFrame(114, () => {
      this.signalHit();
    });

    // Stop at frame 115 (0-indexed: 114) - removeMovieClip means animation ends here
    mainAnim.stopAt(114);

    this.container.addChild(mainAnim.sprite);
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
