/**
 * Spell 2067
 *
 * A projectile spell with a rotating impact effect.
 *
 * Components:
 * - shoot (sprite): At target position, plays through 42 frames
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_20): Play sound 'lance02', position at cellTo
 * - Frame 7 (DefineSprite_20): Signal hit (this.end())
 * - Frame 36 (DefineSprite_10_shoot): removeMovieClip / stop
 * - Frame 121 (DefineSprite_20): removeMovieClip (animation ends)
 *
 * DefineSprite_18 (rotating element):
 * - v = 10 + random(15)
 * - _xscale = random(50) + 50
 * - _yscale = random(50) + 50
 * - Rotates by v each frame
 * Note: DefineSprite_18 appears to be an internal component of the shoot animation,
 * rendered as part of the sprite frames. The shoot animation has 42 frames (indices 0-41)
 * corresponding to the extracted SVG frames, so we play through those.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 205.65,
  height: 149.2,
  offsetX: -103.2,
  offsetY: -87.7,
};

export class Spell2067 extends BaseSpell {
  readonly spellId = 2067;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    const shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));

    shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound 'lance02'
    shootAnim.onFrame(0, () => this.callbacks.playSound('lance02'));

    // Frame 7 (0-indexed: 6): Signal hit (this.end())
    shootAnim.onFrame(6, () => this.signalHit());

    this.container.addChild(shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
