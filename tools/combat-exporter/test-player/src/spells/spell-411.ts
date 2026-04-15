/**
 * Spell 411 - Lakam
 *
 * A composite animation spell with randomized instances at the target position.
 *
 * Components:
 * - anim1 (composite): Main animation at target position, 150 frames, stops at frame 147
 *   - Each instance (DefineSprite_5) has random rotation, random scale (30-79%),
 *     and starts at a random frame (0-20)
 *   - DefineSprite_8 frame 148: removeMovieClip + stop (animation ends)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_409'
 * - DefineSprite_5 frame 1: _rotation = random(360), t = random(50)+30, gotoAndPlay(random(21))
 * - DefineSprite_5 frame 109: stop()
 * - DefineSprite_8 frame 148: _parent.removeMovieClip(); stop()
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 160.7,
  height: 55.7,
  offsetX: 2.25,
  offsetY: -36.8,
};

export class Spell411 extends BaseSpell {
  readonly spellId = 411;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);
    const allFrames = textures.getFrames('anim1');

    // The main composite animation plays through all frames at target position.
    // DefineSprite_5 instances each have:
    //   - Random rotation: random(360) -> 0..359
    //   - Random scale: t = random(50) + 30 -> 30..79 (as percentage)
    //   - Random start frame: random(21) -> 0..20
    // Since anim1 is a composite (pre-rendered), we play it as a single animation.
    // The composite includes all the sub-sprite randomness baked in.
    // However, the manifest says isComposite: true and the AS shows multiple instances
    // of DefineSprite_5 with randomized properties - the pre-rendered frames capture this.

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: allFrames,
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('lakam_409'));

    // DefineSprite_8 frame 148 (0-indexed: 147): removeMovieClip + stop -> signal hit and end
    // The manifest stopFrame is 147 (0-indexed)
    this.mainAnim
      .stopAt(147)
      .onFrame(147, () => this.signalHit());

    this.mainAnim.addTo(this.container);
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
