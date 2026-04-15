/**
 * Spell 704 - Grina
 *
 * A single composite animation played at the target position.
 *
 * Components:
 * - anim1: 135-frame composite animation at target position, stops at frame 132
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_704'
 * - Frame 133 (DefineSprite_9): stop() + removeMovieClip() → animation ends
 *   (0-indexed: frame 132 = stopFrame)
 *
 * Note: DefineSprite_3 picks a random start frame from 1-3 (gotoAndStop(random(3)+1))
 * DefineSprite_5 has trajectory logic but always goes to traj1 (a=random(2), all branches same)
 * The main exported animation (anim1) is a composite that bakes all of this in.
 * The alpha fade (enterFrame: _parent._alpha -= 2.3) begins at frame 82 of DefineSprite_9.
 * stopFrame in manifest is 132 (0-indexed), matching AS frame 133 stop().
 *
 * Hit signal: at the start of the animation (frame 0), as this is an impact spell.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 390.9,
  height: 224.75,
  offsetX: -198.15,
  offsetY: -175.9,
};

export class Spell704 extends BaseSpell {
  readonly spellId = 704;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      stopFrame: 132,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .onFrame(0, () => {
        this.callbacks.playSound('grina_704');
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
