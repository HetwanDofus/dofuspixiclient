/**
 * Spell 2105
 *
 * A composite animation spell with multiple sprite components.
 *
 * Components:
 * - anim1 (sprite_10): Main animation at target position, signals hit at frame 9
 *   stops at frame 69
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'pet'
 * - Frame 10 (DefineSprite_10): this.end() - signal hit
 * - Frame 70 (DefineSprite_10): stop() + removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 205.7,
  height: 109.85,
  offsetX: -103.3,
  offsetY: -56.6,
};

export class Spell2105 extends BaseSpell {
  readonly spellId = 2105;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anim1Textures = textures.getFrames('anim1');
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: anim1Textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    mainAnim.sprite.position.set(init.targetX, init.targetY);

    mainAnim
      .onFrame(0, () => this.callbacks.playSound('pet'))
      .onFrame(9, () => this.signalHit())
      .stopAt(69);

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
