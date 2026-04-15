/**
 * Spell 706 - Grina
 *
 * A single animated effect at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 57
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_706'
 * - Frame 58 (DefineSprite_8/DefineSprite_5): stop()
 * - Frame 115 (main): removeMovieClip() - animation ends
 *
 * Note: DefineSprite_3 picks a random frame (1-3) on load (decorative variant).
 * DefineSprite_5 frame_1 always goes to "traj1" regardless of random(2) value.
 * The composite animation (anim1) captures all of this with 60 frames, stopping at frame 57.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 837.4,
  height: 390.55,
  offsetX: -383.9,
  offsetY: -172.2,
};

export class Spell706 extends BaseSpell {
  readonly spellId = 706;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      scale: init.scale,
      ...calculateAnchor(ANIM1_MANIFEST),
      stopFrame: 57,
    }));

    anim.sprite.position.set(init.targetX, init.targetY);

    anim.onFrame(0, () => {
      this.callbacks.playSound('grina_706');
    });

    anim.onFrame(30, () => {
      this.signalHit();
    });

    this.container.addChild(anim.sprite);
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
