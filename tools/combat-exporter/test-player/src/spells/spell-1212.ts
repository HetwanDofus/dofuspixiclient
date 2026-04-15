/**
 * Spell 1212 - Panda Souillure
 *
 * A target-position effect with a composite animation.
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 177
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'panda_souillure'
 * - Frame 118 (DefineSprite_17): Begin alpha fade (-1.67 per frame)
 * - Frame 178 (DefineSprite_17): removeMovieClip / stop
 * - DefineSprite_15: Static decoration sprites with random alpha/rotation/scale
 * - DefineSprite_16: Growing scale sprites with random alpha/rotation
 * - DefineSprite_8: Drifting particles with random scale/alpha
 *
 * Since anim1 is a composite (pre-rendered), the animation already bakes all
 * sub-sprite behavior. We play it through and stop at frame 177 (0-indexed).
 * Hit is signaled at frame 117 (0-indexed, corresponds to AS frame 118 where
 * the fade begins — this is the impact moment).
 * Animation completes when it stops at frame 177.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 145.5,
  height: 161.1,
  offsetX: -60.6,
  offsetY: -141.45,
};

export class Spell1212 extends BaseSpell {
  readonly spellId = 1212;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .stopAt(177)
      .onFrame(0, () => this.callbacks.playSound('panda_souillure'))
      .onFrame(117, () => this.signalHit());

    this.container.addChild(this.mainAnim.sprite);
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
