/**
 * Spell 2114
 *
 * A composite animation spell with a single animated sprite at the target position.
 *
 * Components:
 * - anim1 (sprite): Composite animation at target position, 102 frames
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_12): Play sound 'fx_612.mp3'
 * - Frame 76 (DefineSprite_12): Play sound 'fx_611.mp3'
 * - Frame 100 (DefineSprite_12): stop()
 * - Frame 138 (main): removeMovieClip() - animation ends
 *
 * DefineSprite_9 sub-sprites rotate continuously:
 *   PlaceObject2_4_2: _rotation += 2 per frame
 *   PlaceObject2_8_10: _rotation -= 1.3 per frame
 * (These rotations are baked into the composite anim1 frames)
 *
 * DefineSprite_11 sub-sprites: gotoAndPlay(random(31)+1) on frame 1, stop() at frame 55
 * (Also baked into anim1 composite frames)
 *
 * The manifest stopFrame is 99 (0-indexed), matching frame_100 DoAction stop().
 * Hit is signaled at frame 75 (0-indexed) matching fx_611.mp3 which plays at impact.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 251,
  height: 128.55,
  offsetX: -125.5,
  offsetY: -52,
};

export class Spell2114 extends BaseSpell {
  readonly spellId = 2114;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      stopFrame: 99,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('fx_612.mp3'))
      .onFrame(75, () => {
        this.callbacks.playSound('fx_611.mp3');
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
