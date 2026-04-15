/**
 * Spell 1102 - Aute
 *
 * A single animation spell played at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 104
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'aute_1102'
 * - Frame 137 (main): this.end() - signal hit
 * - Frame 159 (main): removeMovieClip() - animation ends
 * - DefineSprite_15/frame_105: stop() - anim1 stops at frame 104 (0-indexed)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 223.45,
  height: 177.05,
  offsetX: -136.35,
  offsetY: -123,
};

export class Spell1102 extends BaseSpell {
  readonly spellId = 1102;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anim1Textures = textures.getFrames('anim1');
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(new FrameAnimatedSprite({
      textures: anim1Textures,
      fps: 30,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    anim.sprite.position.set(init.targetX, init.targetY);

    anim
      .stopAt(104)
      .onFrame(0, () => this.callbacks.playSound('aute_1102'))
      .onFrame(103, () => this.signalHit());

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
