/**
 * Spell 713 - Grina
 *
 * A single composite animation played at the target position.
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 132
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_704'
 * - Frame 133 (DefineSprite_9): stop() + removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const ANIM1_MANIFEST: SpriteManifest = {
  width: 390.9,
  height: 224.75,
  offsetX: -198.15,
  offsetY: -175.9,
};

export class Spell713 extends BaseSpell {
  readonly spellId = 713;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound
    anim.onFrame(0, () => this.callbacks.playSound("grina_704"));

    // Frame 133 (0-indexed: 132): stop + removeMovieClip -> signal hit and complete
    anim.stopAt(132);
    anim.onFrame(132, () => {
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
