/**
 * Spell 514 - Many (Iop)
 *
 * A single composite animation played at the target position.
 * Sub-sprites within the animation rotate continuously (+5 degrees per frame).
 * A particle-like overlay flickers its alpha randomly (50 + random(50)).
 *
 * Components:
 * - anim1: 98-frame composite animation at target position
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'many_503'
 * - Frame 11: Sub-sprites start flickering alpha (50 + random(50))
 * - Frame 97 (0-indexed: 96): removeMovieClip() - animation ends
 *
 * Note: The rotating sub-sprites (DefineSprite_5, _7, _9, _11) and the
 * flickering overlay (DefineSprite_18) are baked into the composite frames
 * of anim1. The alpha flicker is approximated by randomizing alpha each frame
 * between frames 11-96 (0-indexed: 10-95).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 131.45,
  height: 101.25,
  offsetX: -64,
  offsetY: -50.5,
};

export class Spell514 extends BaseSpell {
  readonly spellId = 514;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 50,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('many_503'));

    // Frame 11 (0-indexed: 10): flickering alpha begins
    // Signal hit when the impact effect begins (frame 11 in AS = index 10)
    this.mainAnim.onFrame(10, () => this.signalHit());

    // Frame 97 (0-indexed: 96): removeMovieClip() - animation ends
    // The animation has 98 frames (indices 0-97), so we stop at index 96
    this.mainAnim.stopAt(96);
    this.mainAnim.onFrame(96, () => this.complete());

    this.mainAnim.addTo(this.container);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply alpha flicker between frames 10-95 (AS frames 11-96)
    // AS: _alpha = 50 + random(50)
    const frame = this.mainAnim.getFrame();
    if (frame >= 10 && frame <= 95) {
      this.mainAnim.sprite.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
    } else {
      this.mainAnim.sprite.alpha = 1;
    }

    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}
