/**
 * Spell 803 - Vlad
 *
 * A single animation spell that plays at the target position.
 * Contains a sub-sprite (DefineSprite_8) that starts at a random frame
 * and fades out over time, but this is baked into the composite animation.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 216
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_9): Play sounds 'gonfle' and 'vlad_803'
 * - Frame 13 (DefineSprite_9): Play sound 'vlad_803'
 * - Frame 217 (DefineSprite_9): stop() + removeMovieClip() -> animation ends
 *
 * DefineSprite_8 sub-sprite:
 * - onLoad: gotoAndPlay(random(45)), _alpha = 150
 * - onEnterFrame: _alpha -= 0.6
 * (This behavior is baked into the composite anim1 frames)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 83.3,
  height: 166.75,
  offsetX: -37.55,
  offsetY: -106.8,
};

export class Spell803 extends BaseSpell {
  readonly spellId = 803;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim1 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    anim1.sprite.position.set(init.targetX, init.targetY);

    anim1
      .stopAt(216)
      .onFrame(0, () => {
        this.callbacks.playSound('gonfle');
        this.callbacks.playSound('vlad_803');
      })
      .onFrame(12, () => {
        this.callbacks.playSound('vlad_803');
        this.signalHit();
      });

    anim1.addTo(this.container);
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
