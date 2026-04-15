/**
 * Spell 511 - Ronce (Bramble)
 *
 * A single composite animation at the target position.
 * The animation plays sounds at frames 1, 4, and 7 (0-indexed: 0, 3, 6),
 * then stops at frame 148 (0-indexed: 147).
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 147
 *
 * Original AS timing:
 * - Frame 1 (0-indexed: 0): Play sound 'ronce'
 * - Frame 4 (0-indexed: 3): Play sound 'ronce'
 * - Frame 7 (0-indexed: 6): Play sound 'ronce'
 * - Frame 148 (0-indexed: 147): stop() + removeMovieClip()
 *
 * DefineSprite_8 (inner particle) onClipEvent(load):
 * - gotoAndPlay(random(45)) -> random start frame 0..44
 * - _alpha = 150 (but alpha fades at 1.3/frame via enterFrame)
 * Note: The composite anim1 already bakes this behavior into its frames.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 56.4,
  height: 130.25,
  offsetX: -30.7,
  offsetY: -83.3,
};

export class Spell511 extends BaseSpell {
  readonly spellId = 511;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('anim1'),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      }),
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    anim
      .stopAt(147)
      .onFrame(0, () => this.callbacks.playSound('ronce'))
      .onFrame(3, () => this.callbacks.playSound('ronce'))
      .onFrame(6, () => {
        this.callbacks.playSound('ronce');
        this.signalHit();
      });

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
