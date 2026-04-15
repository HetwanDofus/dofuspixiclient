/**
 * Spell 3003 - Multi-element spell (shoot animation)
 *
 * Components:
 * - shoot: Main animation at target position, 93 frames
 *   - DefineSprite_19 (wobble): internal clip with oscillating rotation, stops at frame 66
 *   - DefineSprite_21_move (move wobble): internal clip with slower oscillating rotation
 *   - DefineSprite_20_shoot: removes parent at frame 91
 *
 * The "shoot" sprite plays through 93 frames and then completes.
 * Hit is signaled when the animation reaches frame 91 (0-indexed: 90)
 * which is when _parent.removeMovieClip() is called.
 *
 * Original AS timing:
 * - Frame 91 (DefineSprite_20_shoot): _parent.removeMovieClip() -> animation ends
 * - Frame 66 (DefineSprite_19): stop() -> internal wobble stops
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 34.5,
  height: 30.75,
  offsetX: -23.25,
  offsetY: -14.1,
};

export class Spell3003 extends BaseSpell {
  readonly spellId = 3003;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const shootTextures = textures.getFrames('shoot');
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    const shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      }),
    );

    shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 91 (0-indexed: 90): _parent.removeMovieClip() - signal hit and end
    shootAnim.onFrame(90, () => {
      this.signalHit();
    });

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
