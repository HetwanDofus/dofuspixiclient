/**
 * Spell 705 - Grina
 *
 * A single animation spell that plays at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 105
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_11): Play sound 'grina_705'
 * - Frame 106 (DefineSprite_11): removeMovieClip() / stop() - animation ends
 * - manifest stopFrame: 105
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 391.25,
  height: 262.15,
  offsetX: -207.6,
  offsetY: -224.8,
};

export class Spell705 extends BaseSpell {
  readonly spellId = 705;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound 'grina_705'
    anim.onFrame(0, () => this.callbacks.playSound('grina_705'));

    // Frame 106 (0-indexed: 105): stop - animation ends, signal hit
    anim.stopAt(105);
    anim.onFrame(105, () => this.signalHit());

    anim.addTo(this.container);
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
