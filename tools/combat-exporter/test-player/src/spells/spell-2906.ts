/**
 * Spell 2906 - (Eniripsa candle/flame effect)
 *
 * A flame animation that plays at the target position.
 * The sprite oscillates (sways) using sine-wave rotation and horizontal movement,
 * simulating a flickering candle flame with a slow upward drift.
 *
 * Components:
 * - anim1: Composite flame animation at target position, stops at frame 387
 *
 * Original AS timing:
 * - DefineSprite_9 (outermost): per-frame drift upward + fade after t > 330
 * - DefineSprite_8: horizontal sine oscillation (vamp = 0.1 * random)
 * - DefineSprite_7: rotational sine oscillation using parent.vamp
 * - DefineSprite_4: rotational sine oscillation (amplitude 20) using grandparent.vamp
 * - DefineSprite_5: rotational sine oscillation (amplitude 15) using parent.vamp
 * - frame_13/DoAction: stop() — main timeline stops at frame 13 (index 12)
 * - DefineSprite_9/frame_388/DoAction: removeMovieClip + stop at frame 388 (index 387)
 *
 * The composite anim1 encodes all of this visual complexity per-frame.
 * We play anim1 at the target position and stop at frame 387.
 * Hit is signaled immediately (it's a self/target buff-style effect).
 * Completion when the animation stops.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 13.3,
  height: 36.45,
  offsetX: -5.9,
  offsetY: -54.15,
};

export class Spell2906 extends BaseSpell {
  readonly spellId = 2906;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('anim1'),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      }),
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame_13/DoAction: stop() — main timeline stops at frame 13 (0-indexed: 12)
    // However this is the outer timeline; the composite anim encodes behavior.
    // The inner DefineSprite_9/frame_388/DoAction removes itself at frame 388 (0-indexed: 387).
    // We stop at frame 387 (0-indexed) per manifest stopFrame.
    this.mainAnim.stopAt(387);

    // Signal hit immediately (this is a buff/effect on the target cell)
    this.mainAnim.onFrame(0, () => this.signalHit());

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
