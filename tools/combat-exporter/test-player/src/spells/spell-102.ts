/**
 * Spell 102 - Arty
 *
 * A single composite animation played at the target position.
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 48
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'arty_102'
 * - Frame 49 (0-indexed 48): stop()
 * - Frame 172 (main): removeMovieClip()
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 138.55,
  height: 91.55,
  offsetX: -70.4,
  offsetY: -73.5,
};

export class Spell102 extends BaseSpell {
  readonly spellId = 102;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
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
      .stopAt(48)
      .onFrame(0, () => {
        this.callbacks.playSound('arty_102');
        this.signalHit();
      });

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
