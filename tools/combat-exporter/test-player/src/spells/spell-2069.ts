/**
 * Spell 2069
 *
 * A single animation effect at the target position.
 * DefineSprite_5 instances have random alpha (30-119%).
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 57
 *
 * Original AS timing:
 * - DefineSprite_5/frame_1: _alpha = 30 + random(90)  (random alpha per instance)
 * - DefineSprite_8/frame_58: stop()  (inner sprite stops)
 * - DefineSprite_7/frame_181: _parent._parent.removeMovieClip(); stop()  (outer container ends)
 * - anim1 stopFrame: 57 (0-indexed from manifest)
 *
 * Hit signal: at frame 0 (instant hit on target)
 * Completion: when anim1 stops at frame 57
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 108.95,
  height: 134.1,
  offsetX: -72,
  offsetY: -96.4,
};

export class Spell2069 extends BaseSpell {
  readonly spellId = 2069;

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

    // AS: _alpha = 30 + random(90) (at frame 1, i.e. index 0)
    this.mainAnim.sprite.alpha = (30 + Math.floor(Math.random() * 90)) / 100;

    // Stop at frame 57 (0-indexed, matching manifest stopFrame)
    this.mainAnim.stopAt(57);

    // Signal hit immediately when animation starts
    this.mainAnim.onFrame(0, () => this.signalHit());

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
