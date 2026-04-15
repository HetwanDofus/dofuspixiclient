/**
 * Spell 707 - Grina
 *
 * A composite animation spell that plays at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 22
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_707'
 * - Frame 23 (DefineSprite_8): stop()
 * - Frame 67 (main): removeMovieClip() - animation ends
 *
 * Note: DefineSprite_3 picks a random still frame (1-3) and stops.
 *       DefineSprite_5 always goes to 'traj1' label regardless of random(2).
 *       The composite anim1 captures all sub-sprite behavior in its frames.
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
  width: 397.95,
  height: 222.8,
  offsetX: -201.35,
  offsetY: -101.8,
};

export class Spell707 extends BaseSpell {
  readonly spellId = 707;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 40,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound
    anim.onFrame(0, () => this.callbacks.playSound("grina_707"));

    // Frame 23 (0-indexed: 22): stop() - matches manifest stopFrame
    anim.stopAt(22);

    // Signal hit when animation reaches stop frame
    anim.onFrame(22, () => this.signalHit());

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
